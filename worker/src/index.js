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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
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
              sound: 'default',
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
