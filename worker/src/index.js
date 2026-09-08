/* ============================================================
   Cloudflare Worker — enviar una push a Maite vía Firebase FCM.

   El panel (panel/index.html) hace POST aquí con:
     Authorization: Bearer <PANEL_SECRET>
     { "title": "...", "body": "..." }

   El Worker:
     1. comprueba el secreto,
     2. saca un token OAuth del "service account" de Firebase
        (JWT RS256 firmado con WebCrypto),
     3. lee el token FCM del móvil en /status/fcmToken de la RTDB,
     4. llama a FCM HTTP v1 para enviar la notificación.

   Todo entra en el plan gratuito de Cloudflare y de Firebase.

   Variables (wrangler secret put / vars):
     SERVICE_ACCOUNT   secreto  — JSON del service account de Firebase
     PANEL_SECRET      secreto  — frase larga, la misma que en el panel
     DB_URL            var      — https://chorapp-xxxx-...firebasedatabase.app
   ============================================================ */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const { pathname, searchParams } = new URL(request.url);

    // --- Tarjeta "Del coro": última publicación pública de Instagram ---
    // La app (APK) llama aquí en vez de a Instagram directamente: desde
    // el móvil Instagram devuelve "login_required", pero desde el Worker
    // (server-side, con cabeceras de navegador) sí responde. Respuesta
    // ya normalizada + cache de 30 min para no machacar a Instagram.
    if (request.method === 'GET' && /\/coro\/?$/.test(pathname)) {
      return coro(searchParams.get('handle') || '', cors, env);
    }

    if (request.method !== 'POST') {
      return json({ error: 'usa POST' }, 405, cors);
    }

    // 1. Secreto compartido con el panel
    const auth = request.headers.get('Authorization') || '';
    const dado = auth.replace(/^Bearer\s+/i, '').trim();
    if (!env.PANEL_SECRET || dado !== env.PANEL_SECRET) {
      return json({ error: 'no autorizado' }, 401, cors);
    }

    let cuerpo;
    try { cuerpo = await request.json(); } catch (e) { cuerpo = {}; }
    const title = String(cuerpo.title || 'ChorApp').trim() || 'ChorApp';
    const body = String(cuerpo.body || '').trim();
    if (!body) return json({ error: 'falta "body"' }, 400, cors);

    let sa;
    try { sa = JSON.parse(env.SERVICE_ACCOUNT); }
    catch (e) { return json({ error: 'SERVICE_ACCOUNT no es JSON válido' }, 500, cors); }

    try {
      const accessToken = await getAccessToken(sa);

      // 3. Token FCM del móvil, guardado por push.js
      const dbUrl = String(env.DB_URL || '').replace(/\/+$/, '');
      const tRes = await fetch(
        `${dbUrl}/status/fcmToken.json?access_token=${encodeURIComponent(accessToken)}`
      );
      const fcmToken = await tRes.json();
      if (!fcmToken || typeof fcmToken !== 'string') {
        return json({ error: 'aún no hay token del móvil (abre la app de Maite una vez)' }, 409, cors);
      }

      // 4. Enviar
      const msg = {
        message: {
          token: fcmToken,
          notification: { title, body },
          android: {
            priority: 'high',
            notification: {
              icon: 'ic_stat_bihotsak',
              color: '#1512D6',
              // Canal "chorapp" (lo crea la app): SIN sonido, CON vibración.
              channel_id: 'chorapp',
              default_vibrate_timings: true,
            },
          },
        },
      };
      const sendRes = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(msg),
        }
      );
      const out = await sendRes.json();
      if (!sendRes.ok) {
        return json({ error: 'FCM rechazó el envío', detalle: out }, 502, cors);
      }
      return json({ ok: true, id: out.name }, 200, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  });
}

/* ---------- Tarjeta "Del coro" (Instagram público) ---------- */

const IG_APP_ID = '936619743392459';
const IG_HEADERS = {
  'x-ig-app-id': IG_APP_ID,
  'x-asbd-id': '129477',
  'x-ig-www-claim': '0',
  'Accept': '*/*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

async function coro(handleRaw, cors, env) {
  const handle = String(handleRaw || '').replace(/[^a-z0-9._]/gi, '').toLowerCase();
  if (!handle) return json({ error: 'falta "handle"' }, 400, cors);

  // Cache de Cloudflare: 30 min. Evita pedir a Instagram en cada apertura.
  // (En workers.dev la Cache API puede ser no-op; entonces simplemente
  //  se pide a Instagram cada vez. Con un solo usuario no pasa nada.)
  const cache = caches.default;
  const claveCache = new Request('https://coro.cache/' + handle);
  let cacheado = null;
  try { cacheado = await cache.match(claveCache); } catch (e) { /* sin cache */ }
  if (cacheado) {
    const body = await cacheado.text();
    return new Response(body, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT', ...cors },
    });
  }

  let pub = null;
  let ultimoError = '';

  // 0) Fuente preferida: un feed JSON de RSS.app del perfil público.
  //    Instagram bloquea las peticiones directas (401) tanto desde el
  //    móvil como desde Cloudflare, así que RSS.app hace de intermediario.
  //    Se configura con:  npx wrangler secret put CORO_FEED_URL
  const feedUrl = String((env && env.CORO_FEED_URL) || '').trim();
  if (feedUrl) {
    try {
      const r = await fetch(feedUrl, { headers: { Accept: 'application/json' } });
      if (r.ok) {
        pub = extraerDeFeed(await r.json(), handle);
        if (!pub) ultimoError = 'feed sin items';
      } else {
        ultimoError = 'feed HTTP ' + r.status;
      }
    } catch (e) {
      ultimoError = 'feed: ' + String((e && e.message) || e);
    }
  }

  // 1) Reserva: endpoints internos de Instagram (suelen dar 401 desde
  //    datacenter, pero si algún día vuelven a abrir, esto lo aprovecha).
  const endpoints = pub ? [] : [
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' +
      encodeURIComponent(handle),
    'https://www.instagram.com/api/v1/feed/user/' +
      encodeURIComponent(handle) + '/username/?count=3',
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: {
          ...IG_HEADERS,
          Referer: 'https://www.instagram.com/' + handle + '/',
        },
      });
      if (!r.ok) { ultimoError = 'HTTP ' + r.status; continue; }
      const data = await r.json();
      pub = extraer(data, handle);
      if (pub) break;
      ultimoError = 'sin publicaciones';
    } catch (e) {
      ultimoError = String((e && e.message) || e);
    }
  }

  if (!pub) return json({ error: 'instagram no respondió', detalle: ultimoError }, 502, cors);

  const salida = JSON.stringify(pub);
  // Guarda en cache 30 min (solo la respuesta buena).
  try {
    await cache.put(
      claveCache,
      new Response(salida, {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=1800',
        },
      })
    );
  } catch (e) { /* sin cache: da igual */ }
  return new Response(salida, {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS', ...cors },
  });
}

// Normaliza cualquiera de los dos formatos de Instagram a
// { imagen, texto, fecha, enlace, usuario }.
function extraer(data, handle) {
  // 1) web_profile_info
  const edges =
    data && data.data && data.data.user &&
    data.data.user.edge_owner_to_timeline_media &&
    data.data.user.edge_owner_to_timeline_media.edges;
  if (edges && edges.length) {
    const n = edges
      .map((e) => e.node)
      .filter(Boolean)
      .sort((a, b) => (b.taken_at_timestamp || 0) - (a.taken_at_timestamp || 0))[0];
    if (!n) return null;
    const hijo =
      n.edge_sidecar_to_children &&
      n.edge_sidecar_to_children.edges &&
      n.edge_sidecar_to_children.edges[0] &&
      n.edge_sidecar_to_children.edges[0].node;
    const texto =
      (n.edge_media_to_caption &&
        n.edge_media_to_caption.edges &&
        n.edge_media_to_caption.edges[0] &&
        n.edge_media_to_caption.edges[0].node &&
        n.edge_media_to_caption.edges[0].node.text) || '';
    return armar({
      imagen: (hijo && hijo.display_url) || n.display_url || n.thumbnail_src || '',
      texto,
      ts: n.taken_at_timestamp,
      code: n.shortcode,
      handle,
    });
  }

  // 2) feed/user
  const items = (data && data.items) || [];
  if (items.length) {
    const it = items
      .slice()
      .sort((a, b) => (b.taken_at || 0) - (a.taken_at || 0))[0];
    const iv =
      it.image_versions2 ||
      (it.carousel_media &&
        it.carousel_media[0] &&
        it.carousel_media[0].image_versions2);
    const cand = (iv && iv.candidates) || [];
    return armar({
      imagen: cand.length ? cand[0].url : '',
      texto: (it.caption && it.caption.text) || '',
      ts: it.taken_at,
      code: it.code,
      handle,
    });
  }

  return null;
}

// Normaliza un feed JSON (formato JSON Feed de RSS.app) a la publicación.
function extraerDeFeed(data, handle) {
  const items = (data && data.items) || [];
  if (!items.length) return null;
  const it = items
    .slice()
    .sort((a, b) => fecha(b.date_published) - fecha(a.date_published))[0];

  let imagen = it.image || '';
  if (!imagen && Array.isArray(it.attachments) && it.attachments[0]) {
    imagen = it.attachments[0].url || '';
  }
  if (!imagen && it.content_html) {
    const m = it.content_html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) imagen = m[1];
  }

  // content_text trae la descripción completa; title suele venir cortado.
  let texto = it.content_text || it.title || '';
  if (!texto && it.content_html) {
    texto = it.content_html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const ts = it.date_published ? Math.floor(fecha(it.date_published) / 1000) : 0;
  const code = (String(it.url || '').match(/\/(?:p|reel)\/([^/?#]+)/) || [])[1];

  return armar({ imagen, texto, ts, code, handle, enlaceDirecto: it.url });
}

function fecha(s) {
  const t = Date.parse(s || '');
  return isNaN(t) ? 0 : t;
}

function armar({ imagen, texto, ts, code, handle, enlaceDirecto }) {
  let t = String(texto || '').replace(/(\s*#[\wÀ-ÿ]+)+\s*$/u, '').trim();
  return {
    imagen: imagen || '',
    texto: t || 'Nueva publicación del coro',
    fecha: ts ? new Date(ts * 1000).toISOString() : '',
    enlace: code
      ? 'https://www.instagram.com/p/' + code + '/'
      : (enlaceDirecto || 'https://www.instagram.com/' + handle + '/'),
    usuario: '@' + handle,
  };
}

/* ---------- OAuth2: JWT RS256 firmado con la clave del service account ---------- */

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPES,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(claim)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(jwt),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('OAuth falló: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer;
}
