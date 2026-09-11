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

    // --- Ayuda de IA para las letras: ruta POST /ia ---
    // La app (APK y navegador) llama aquí para generar "cómo se pronuncia"
    // una letra, su traducción, el comentario de "la profe" tras el test de
    // memoria o la sincronía de la letra con el audio
    // (tarea: 'fonetica' | 'traduccion' | 'comentario' | 'sincronia'). El prompt
    // se arma en el servidor; el móvil solo manda { tarea, texto, idioma } (o,
    // para 'sincronia', { lineas, audio, mime, dur }). Usa Gemini Flash (gratuito
    // de Google AI Studio) y cachea el resultado por texto para no gastar
    // cuota si Maite vuelve a pulsar el botón. Ver worker/README.md.
    if (request.method === 'POST' && /\/ia\/?$/.test(pathname)) {
      return ia(request, cors, env);
    }

    // --- Actualización por wifi (OTA): ruta POST /ota ---
    // La lanza scripts/ota.js con el secreto del panel. Escribe
    // /updates/latest en la RTDB (y guarda la anterior en /updates/anterior)
    // y manda una notificación a Maite. Ver docs/actualizaciones.md.
    if (request.method === 'POST' && /\/ota\/?$/.test(pathname)) {
      return ota(request, cors, env);
    }

    // --- Copia de seguridad en la nube: ruta GET /backups ---
    // Las reglas de la RTDB solo dejan LEER /backups con auth (para que no
    // sea pública); ESCRIBIR sí está abierto, por eso backup.js sube la copia
    // directo desde el móvil pero para el botón "Sincronizar con la nube"
    // hace falta pasar por aquí: el Worker sí tiene credenciales (service
    // account) para leer la última copia y devolvérsela a la app.
    if (request.method === 'GET' && /\/backups\/?$/.test(pathname)) {
      return backups(cors, env);
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
              // En Android 8+ manda el patrón del canal; esto es el respaldo
              // para cuando la push llega antes de que la app cree el canal:
              // una única vibración corta, nada de zumbido largo.
              channel_id: 'chorapp',
              default_vibrate_timings: false,
              vibrate_timings: ['0s', '0.4s'],
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

/* ---------- Actualización por wifi (ruta POST /ota) ---------- */

async function ota(request, cors, env) {
  // Mismo secreto que las push del panel.
  const auth = request.headers.get('Authorization') || '';
  const dado = auth.replace(/^Bearer\s+/i, '').trim();
  if (!env.PANEL_SECRET || dado !== env.PANEL_SECRET) {
    return json({ error: 'no autorizado' }, 401, cors);
  }

  let c;
  try { c = await request.json(); } catch (e) { c = {}; }
  const bundle = parseInt(c.bundle, 10);
  const url = String(c.url || '').trim();
  if (!bundle || bundle < 1) return json({ error: 'falta "bundle" (entero ≥ 1)' }, 400, cors);
  if (!/^https:\/\/.+\.zip($|\?)/i.test(url)) return json({ error: '"url" debe ser un https://…zip' }, 400, cors);

  const registro = {
    bundle,
    nombre: String(c.nombre || bundle).slice(0, 40),
    url,
    sha256: String(c.sha256 || '').slice(0, 64),
    nota: String(c.nota || '').slice(0, 240),
    obligatoria: !!c.obligatoria,
    fecha: Date.now(),
  };

  let sa;
  try { sa = JSON.parse(env.SERVICE_ACCOUNT); }
  catch (e) { return json({ error: 'SERVICE_ACCOUNT no es JSON válido' }, 500, cors); }

  const dbUrl = String(env.DB_URL || '').replace(/\/+$/, '');

  try {
    const accessToken = await getAccessToken(sa);
    const q = `?access_token=${encodeURIComponent(accessToken)}`;

    // Guarda la última como "anterior" (para el botón "volver atrás" del panel).
    try {
      const prev = await (await fetch(`${dbUrl}/updates/latest.json${q}`)).json();
      if (prev && typeof prev === 'object' && prev.bundle) {
        await fetch(`${dbUrl}/updates/anterior.json${q}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prev),
        });
      }
    } catch (e) { /* no crítico */ }

    const put = await fetch(`${dbUrl}/updates/latest.json${q}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registro),
    });
    if (!put.ok) {
      return json({ error: 'no se pudo escribir /updates/latest', detalle: await put.text() }, 502, cors);
    }

    // Notificación a Maite (mejor esfuerzo: si no hay token, no es error).
    let push = false;
    try {
      push = await enviarPush(sa, accessToken, {
        title: 'Actualización disponible',
        body: registro.nota || 'Hay una actualización lista. Ábrela para ponerte al día.',
        data: { tipo: 'ota', bundle: String(bundle) },
      }, dbUrl);
    } catch (e) { /* da igual */ }

    return json({ ok: true, bundle, push }, 200, cors);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500, cors);
  }
}

// GET /backups: devuelve el contenido de /backups/ultima de la RTDB.
async function backups(cors, env) {
  let sa;
  try { sa = JSON.parse(env.SERVICE_ACCOUNT); }
  catch (e) { return json({ error: 'SERVICE_ACCOUNT no es JSON válido' }, 500, cors); }

  const dbUrl = String(env.DB_URL || '').replace(/\/+$/, '');
  try {
    const accessToken = await getAccessToken(sa);
    const r = await fetch(
      `${dbUrl}/backups/ultima.json?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!r.ok) return json({ error: 'no se pudo leer la copia' }, 502, cors);
    const datos = await r.json();
    if (!datos) return json({ error: 'todavía no hay ninguna copia en la nube' }, 404, cors);
    return json(datos, 200, cors);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500, cors);
  }
}

// Envía una notificación al móvil de Maite vía FCM. Devuelve true si se envió.
async function enviarPush(sa, accessToken, { title, body, data }, dbUrl) {
  const tRes = await fetch(
    `${dbUrl}/status/fcmToken.json?access_token=${encodeURIComponent(accessToken)}`
  );
  const fcmToken = await tRes.json();
  if (!fcmToken || typeof fcmToken !== 'string') return false;

  const msg = {
    message: {
      token: fcmToken,
      notification: { title, body },
      data: data || {},
      android: {
        priority: 'high',
        notification: {
          icon: 'ic_stat_bihotsak',
          color: '#1512D6',
          channel_id: 'chorapp',
          default_vibrate_timings: false,
          vibrate_timings: ['0s', '0.4s'],
        },
      },
    },
  };
  const r = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    }
  );
  return r.ok;
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...(cors || {}) },
  });
}

/* ---------- Ayuda de IA para las letras (ruta POST /ia) ---------- */

// Modelo Flash actual (sept 2026). Historial de este proyecto:
//   gemini-2.0-flash  -> retirado
//   gemini-2.5-flash  -> retirado para cuentas nuevas
//   gemini-flash-latest -> apunta a preview (3.8) con cuota mínima (5/min) y 503 frecuentes
// gemini-3.6-flash es el que Google recomienda y tiene límite gratuito holgado.
// El reintento de abajo cubre los 429/503 puntuales igualmente.
// Cadena de modelos Flash gratuitos. Cada modelo tiene su PROPIO cupo diario
// (RPD, ~20/día en el nivel gratis), así que al agotarse el primero (429) se
// prueba el siguiente y se multiplica el aguante del día. Todos sin tarjeta.
// Ver el uso en https://ai.dev/rate-limit
// De más a menos capaz. Los "lite" y los 2.x son peores para recordar letras
// pero valen de último recurso. Un id que no exista para la cuenta se salta solo.
const IA_MODELOS = [
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];
// Para 'fonetica' y 'traduccion' (transcripción mecánica verso a verso) NO hace
// falta un modelo que "razone": los 2.0 sin "pensar" contestan en 1-2 s y su
// cupo gratuito diario es más holgado. Los 3.x quedan de reserva por si los 2.0
// fallan. Esto evita las esperas largas y los timeouts del cliente.
const IA_MODELOS_RAPIDOS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];
// Retirados sept 2026: 'gemini-2.5-flash' / '-lite' -> "no longer available to
// new users" (400). El aviso de Google recomienda 3.6-flash, que ya es [0].
const IA_MAX_CARACTERES = 6000;

function urlModelo(modelo, env) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' +
    modelo + ':generateContent?key=' + encodeURIComponent(env.GEMINI_API_KEY);
}

// Arma el prompt según la tarea. `idioma` es el nombre en español
// ('Latín', 'Alemán'…) o '' si no se sabe.
function promptIA(tarea, texto, idioma, compositor) {
  const deIdioma = idioma
    ? `en ${idioma}`
    : 'en su idioma original (detéctalo tú)';

  if (tarea === 'letra') {
    // `texto` es el título de la canción. `compositor` es opcional.
    const quien = compositor ? ` de «${compositor}»` : '';
    const enIdioma = idioma ? ` Está ${deIdioma}.` : '';
    return (
      `Dame la letra de la canción «${texto}»${quien}${enIdioma}.\n\n` +
      `Puede ser de cualquier género (coral, clásica, sacra, tradicional, ` +
      `pop, reggaetón, rock, folk…). Reproduce la letra tal como la conozcas.\n\n` +
      `Formato: solo el texto, verso por verso, con una línea en blanco entre ` +
      `estrofas. Nada de título, artista, numeración, acordes, marcas de ` +
      `sección ([Estribillo], [Verso]…), comentarios ni notas. Si hay ` +
      `estribillo repetido, escríbelo cada vez que suena. Si solo recuerdas ` +
      `parte de la letra, devuelve esa parte igualmente.\n\n` +
      `Responde con la única palabra NO_ENCONTRADA SOLO si no conoces esa ` +
      `canción.`
    );
  }
  if (tarea === 'comentario') {
    return (
      `Eres la profe de canto de un coro, cálida y cercana. ` +
      `Una alumna acaba de jugar a memorizar la letra de una canción. ` +
      `Abajo van los datos del intento (canción, versos que acertó y versos que falló).\n\n` +
      `Escríbele SOLO a ella, tuteándola, exactamente 2 frases (máximo 35 palabras en total):\n` +
      `1) Reconoce con naturalidad algo que ha hecho bien.\n` +
      `2) Si falló algún verso, dile en qué fijarse la próxima vez y cita entre comillas 2 o 3 ` +
      `palabras de uno de los versos fallados. Si no falló ninguno, solo felicítala.\n\n` +
      `Prohibido: repetir los datos de abajo, dar números o porcentajes, hacer listas, ` +
      `usar emojis o despedidas. Devuelve únicamente esas 2 frases.\n\n` +
      `--- DATOS DEL INTENTO ---\n${texto}`
    );
  }
  // fonetica / traduccion: se numeran los versos NO vacíos y se pide la salida
  // con el MISMO número delante, para poder recomponerla verso a verso y que
  // encaje 1:1 con la letra original (imprescindible para la sincronía y la
  // vista "Todo junto").
  const numeradas = texto.split('\n')
    .filter((l) => l.trim())
    .map((l, i) => (i + 1) + '. ' + l.trim())
    .join('\n');

  if (tarea === 'traduccion') {
    return (
      `Traduce al español esta letra de una canción ${deIdioma}. ` +
      `Es un texto para cantar en un coro: prioriza una traducción natural y fiel al sentido.\n` +
      `Te doy los versos NUMERADOS. Devuelve EXACTAMENTE un verso traducido por cada número, ` +
      `con el mismo número delante y en el mismo orden:\n` +
      `1. <traducción del verso 1>\n2. <traducción del verso 2>\n...\n` +
      `NO juntes ni partas versos: si un verso tiene varias frases, TODA su traducción va en ` +
      `esa misma línea numerada. Traduce TODOS los versos, también los cortos o repetidos. ` +
      `Nada de texto fuera de la lista numerada.\n\n` +
      `VERSOS:\n${numeradas}`
    );
  }
  // 'fonetica' (por defecto)
  return (
    `Eres una ayuda para una integrante de un coro que habla español. ` +
    `Te doy la letra de una canción ${deIdioma}, con los versos NUMERADOS.\n` +
    `Devuelve cómo se pronuncia, escrita para que una persona hispanohablante la lea tal ` +
    `cual y suene bien al cantar. Usa solo letras del español, NADA de alfabeto fonético ` +
    `(AFI) ni símbolos raros. Separa las sílabas largas con guiones si ayuda.\n` +
    `Devuelve EXACTAMENTE una línea por cada número, con el mismo número delante y en el ` +
    `mismo orden:\n1. <cómo suena el verso 1>\n2. <cómo suena el verso 2>\n...\n` +
    `NO juntes ni partas versos. Haz TODOS los versos. Nada de texto fuera de la lista numerada.\n\n` +
    `VERSOS:\n${numeradas}`
  );
}

// Recompone la salida numerada de fonetica/traduccion para que tenga
// EXACTAMENTE la misma estructura de líneas que la letra original (una línea de
// salida por cada verso no vacío; las líneas en blanco se conservan en su
// sitio). Devuelve null si el modelo no numeró lo suficiente -> se usa la
// salida cruda tal cual.
function reconstruirNumerado(original, salida) {
  const mapa = {};
  let actual = null;
  String(salida || '').split('\n').forEach((l) => {
    const m = l.match(/^\s*(\d{1,3})\s*[.)\-:]\s*(.*)$/);
    if (m) {
      actual = +m[1];
      mapa[actual] = (m[2] || '').trim();
    } else if (actual != null && l.trim()) {
      // Continuación de un verso que el modelo partió en varias líneas.
      mapa[actual] = (mapa[actual] ? mapa[actual] + ' ' : '') + l.trim();
    }
  });
  const orig = original.split('\n');
  const nNoVacias = orig.filter((l) => l.trim()).length;
  if (Object.keys(mapa).length < Math.max(2, Math.floor(nNoVacias * 0.6))) return null;
  let k = 0;
  return orig.map((l) => {
    if (!l.trim()) return '';
    k += 1;
    return (mapa[k] != null && mapa[k] !== '') ? mapa[k] : l.trim();
  }).join('\n');
}

// Busca la letra en LRCLIB (https://lrclib.net) — base de datos abierta de
// letras, gratis, sin clave ni límite práctico. Devuelve la letra en texto
// plano o '' si no la encuentra. Nunca lanza.
async function letraDeLrclib(titulo, compositor) {
  const cabeceras = { 'User-Agent': 'ChorApp (https://github.com/endikaprad/chorapp)' };
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  const urls = [];
  if (compositor) {
    urls.push('https://lrclib.net/api/search?track_name=' +
      encodeURIComponent(titulo) + '&artist_name=' + encodeURIComponent(compositor));
  }
  urls.push('https://lrclib.net/api/search?q=' +
    encodeURIComponent(compositor ? titulo + ' ' + compositor : titulo));

  const objetivoT = norm(titulo);
  const objetivoA = norm(compositor);

  for (const url of urls) {
    let lista;
    try {
      const r = await fetch(url, { headers: cabeceras });
      if (!r.ok) continue;
      lista = await r.json();
    } catch (e) { continue; }
    if (!Array.isArray(lista) || !lista.length) continue;

    const validos = lista.filter((x) => x && !x.instrumental &&
      typeof x.plainLyrics === 'string' && x.plainLyrics.trim().length > 20);
    if (!validos.length) continue;

    // Mejor coincidencia: el título tiene que encajar; si dimos artista, que
    // también aparezca. Si nada encaja bien, no arriesgamos (mejor Gemini).
    const puntua = (x) => {
      const t = norm(x.trackName), a = norm(x.artistName);
      let p = 0;
      if (t === objetivoT) p += 3;
      else if (t.includes(objetivoT) || objetivoT.includes(t)) p += 2;
      if (objetivoA) {
        if (a === objetivoA) p += 3;
        else if (a.includes(objetivoA) || objetivoA.includes(a)) p += 2;
      }
      return p;
    };
    validos.sort((x, y) => puntua(y) - puntua(x));
    const mejor = validos[0];
    if (puntua(mejor) < (objetivoA ? 4 : 2)) continue;

    return limpiarLetra(mejor.plainLyrics);
  }
  return '';
}

// Quita marcas de sección ([Verso], [Chorus]…), créditos y espacios sobrantes.
function limpiarLetra(txt) {
  return String(txt || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*\[[^\]]+\]\s*$/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function ia(request, cors, env) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: 'IA no configurada (falta GEMINI_API_KEY)' }, 500, cors);
  }

  // Verja suave: si hay IA_TOKEN definido, la app debe mandarlo. No es un
  // secreto de verdad (viaja en el APK), solo frena el abuso casual.
  if (env.IA_TOKEN) {
    const dado = (request.headers.get('X-IA-Token') || '').trim();
    if (dado !== env.IA_TOKEN) return json({ error: 'no autorizado' }, 401, cors);
  }

  let cuerpo;
  try { cuerpo = await request.json(); } catch (e) { cuerpo = {}; }
  const tarea = (cuerpo.tarea === 'traduccion' || cuerpo.tarea === 'comentario' ||
    cuerpo.tarea === 'sincronia' || cuerpo.tarea === 'letra')
    ? cuerpo.tarea : 'fonetica';

  // La sincronía de la letra con el audio va por su propio camino: el
  // cuerpo trae audio (base64) y las líneas de la letra, no un texto suelto.
  if (tarea === 'sincronia') return sincronia(cuerpo, cors, env);

  const idioma = String(cuerpo.idioma || '').trim().slice(0, 40);
  const compositor = String(cuerpo.compositor || '').trim().slice(0, 120);
  let texto = String(cuerpo.texto || '').replace(/\r\n?/g, '\n').trim();
  if (!texto) return json({ error: 'falta "texto"' }, 400, cors);
  if (texto.length > IA_MAX_CARACTERES) texto = texto.slice(0, IA_MAX_CARACTERES);

  // Cache por contenido: misma letra + tarea + idioma => misma respuesta,
  // sin volver a gastar cuota de Gemini. 30 días.
  const cache = caches.default;
  // El sufijo versionado en 'letra' invalida lo cacheado con prompts viejos.
  const claveTarea = tarea === 'letra' ? 'letra-v6'
    : (tarea === 'traduccion' ? 'traduccion-v2'
      : (tarea === 'fonetica' ? 'fonetica-v2' : tarea));
  const hash = await sha256(claveTarea + '|' + idioma + '|' + compositor + '|' + texto);
  const claveCache = new Request('https://ia.cache/' + hash);
  try {
    const hit = await cache.match(claveCache);
    if (hit) {
      const body = await hit.text();
      return new Response(body, {
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT', ...cors },
      });
    }
  } catch (e) { /* sin cache: seguimos */ }

  // Para buscar la letra: primero LRCLIB (base de datos de letras abierta,
  // gratis, sin clave ni cuota, y con canciones nuevas que el modelo aún no
  // conoce). Si no la tiene, se cae al modelo Gemini de abajo.
  if (tarea === 'letra') {
    const web = await letraDeLrclib(texto, compositor);
    if (web) {
      const respuesta = JSON.stringify({ texto: web });
      try {
        await cache.put(claveCache, new Response(respuesta, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' },
        }));
      } catch (e) { /* sin caché: da igual */ }
      return new Response(respuesta, {
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS', 'X-Fuente': 'lrclib', ...cors },
      });
    }
  }

  try {
    const prompt = promptIA(tarea, texto, idioma, compositor);

    // Para el comentario de "la profe" pedimos poco "pensar" y salida corta,
    // para que conteste en 1-3 s. Si el modelo no acepta alguno de esos
    // ajustes (cambian de nombre entre versiones de Gemini), se reintenta
    // con la config mínima en vez de fallar.
    const configs =
      tarea === 'comentario'
        ? [
            // maxOutputTokens alto: en Gemini 3 los tokens de "pensar" también
            // cuentan aquí, y con el tope bajo el comentario salía cortado a
            // media frase. El prompt ya lo limita a 2 frases / ~35 palabras.
            { temperature: 0.6, maxOutputTokens: 2000, thinkingConfig: { thinkingLevel: 'low' } },
            { temperature: 0.6, maxOutputTokens: 2000, thinkingConfig: { thinkingBudget: 0 } },
            { temperature: 0.6, maxOutputTokens: 600 },
            { temperature: 0.6 },
          ]
        : tarea === 'letra'
        ? [
            // Necesita espacio: la letra entera + los tokens de "pensar" de
            // Gemini 3 cuentan en el mismo tope. Poco "pensar", algo de
            // temperatura para que no se atasque negándose.
            { temperature: 0.5, maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: 'low' } },
            { temperature: 0.5, maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } },
            { temperature: 0.5, maxOutputTokens: 4000 },
            { temperature: 0.5 },
          ]
        : [
            // fonetica / traduccion: transcripción mecánica línea a línea, CERO
            // razonamiento. Sin desactivar el "pensar", Gemini 3 Flash tarda
            // 20-40 s y a veces agota el tope pensando y devuelve vacío (de ahí
            // los "errores sin motivo": el cliente aborta antes). Con
            // thinkingBudget 0 responde en 1-3 s -> es el PRIMER intento.
            // thinkingLevel 'low' solo de reserva por si el modelo no acepta
            // budget 0. maxOutputTokens holgado (8192) para una letra entera
            // numerada sin que se corte a media lista.
            { temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
            { temperature: 0.2, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } },
            { temperature: 0.2, maxOutputTokens: 8192 },
            { temperature: 0.2 },
          ];

    // Nota: NO se usa `tools: [{ google_search: {} }]` para buscar la letra.
    // El grounding con Google no entra en el nivel gratuito de Gemini
    // (devuelve 429 "exceeded your quota" en cada llamada), y el proyecto
    // va sin tarjeta. La letra sale de lo que el modelo sabe de su
    // entrenamiento; si no la conoce, responde NO_ENCONTRADA.
    //
    // Bucle doble: por cada MODELO de `IA_MODELOS` se reintenta ante 429/503
    // (saturación o cuota) con espera creciente; si aun así falla por cuota,
    // se pasa al siguiente modelo (su cupo diario es independiente). Los 4xx
    // "de verdad" (401…) cortan; el 400 "invalid argument" baja la config.
    let r, data;
    const rapida = tarea === 'fonetica' || tarea === 'traduccion';
    const modelos = rapida ? IA_MODELOS_RAPIDOS : IA_MODELOS;
    // Menos reintentos y espera más corta en las tareas rápidas: así el Worker
    // responde dentro del tope del cliente en vez de encadenar backoffs largos.
    const maxIntentos = tarea === 'comentario' ? 1 : (rapida ? 2 : 3);
    const backoff = rapida ? 700 : 1500;
    let ci = 0;
    for (let mi = 0; mi < modelos.length; mi++) {
      const urlGemini = urlModelo(modelos[mi], env);
      for (let intento = 0; intento < maxIntentos; ) {
        if (intento > 0) await new Promise((res) => setTimeout(res, intento * backoff));
        r = await fetch(urlGemini, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: configs[ci],
          }),
        });
        data = await r.json();
        if (r.ok) break;
        const msg = (data && data.error && data.error.message) || '';
        // 400 por un argumento no soportado: menos ajustes, sin gastar intento.
        if (r.status === 400 && /invalid argument/i.test(msg) && ci < configs.length - 1) {
          ci++;
          continue;
        }
        // 429 = cuota del día agotada para ESTE modelo: no insistir, saltar ya
        // al siguiente. 503 = saturación puntual: sí merece reintento.
        if (r.status === 429) break;
        if (r.status !== 503) break;
        intento++;
      }
      if (r.ok) break;
      // Este modelo no pudo (cuota agotada, no disponible, id inválido…):
      // probamos con el siguiente, que tiene su propio cupo. Si es un 401/403
      // de verdad, los siguientes también fallarán rápido y se devuelve el error.
      ci = 0;
    }
    if (!r.ok) {
      const detalle = (data && data.error && data.error.message) || ('HTTP ' + r.status);
      return json({ error: 'Gemini rechazó la petición', detalle }, 502, cors);
    }
    const partes =
      (data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts) || [];
    let salida = partes.map((p) => p.text || '').join('')
      .replace(/\n{3,}/g, '\n\n').trim();
    if (!salida) return json({ error: 'Gemini no devolvió texto' }, 502, cors);

    // fonetica/traduccion: recomponer verso a verso para que encaje 1:1 con
    // la letra original (quita la numeración y respeta las líneas en blanco).
    if (tarea === 'fonetica' || tarea === 'traduccion') {
      const rec = reconstruirNumerado(texto, salida);
      if (rec) salida = rec;
    }

    const respuesta = JSON.stringify({ texto: salida });
    // No guardamos en caché un "no encontrada": la próxima vez que se
    // pida (o tras afinar el prompt) merece un intento nuevo.
    const noCachear = tarea === 'letra' && /^NO_ENCONTRADA/i.test(salida);
    try {
      if (noCachear) throw new Error('sin caché');
      await cache.put(
        claveCache,
        new Response(respuesta, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=2592000',
          },
        })
      );
    } catch (e) { /* sin cache: da igual */ }

    return new Response(respuesta, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS', ...cors },
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500, cors);
  }
}

/* ---------- Sincronía de la letra con el audio (tarea 'sincronia') ----------
   El móvil manda un recorte del audio (base64) + la letra en líneas + el
   idioma. Gemini escucha y devuelve el segundo en que empieza a cantarse
   cada línea. La app resalta la línea que suena y deja tocar para saltar.
   No es exacto en coro (notas largas, varias voces); Maite lo retoca luego
   con "Ajustar", así que basta con quedar cerca. */

function promptSincro(lineas, dur) {
  const num = lineas.map((l, i) => i + ': ' + l).join('\n');
  const media = dur > 0 ? (dur / Math.max(1, lineas.length)).toFixed(1) : '?';
  return (
    'Te doy el AUDIO de un coro cantando una canción y su LETRA dividida en líneas ' +
    'numeradas desde 0. El audio dura unos ' + Math.round(dur) + ' segundos y hay ' +
    lineas.length + ' versos, o sea ~' + media + ' s por verso de media.\n' +
    'Devuelve ÚNICAMENTE un JSON: un array con un número por CADA verso, en orden ' +
    'desde el 0 hasta el último. Cada número es el segundo (con un decimal) en que ' +
    'empieza a cantarse ese verso, medido desde el comienzo del audio.\n' +
    'Escucha el audio de principio a fin ANTES de responder. Sigue la melodía y la ' +
    'letra a la vez: identifica dónde entra la voz por primera vez, y ve marcando ' +
    'el instante de cada nuevo verso según lo que oyes, no repartiendo a ojo. ' +
    'Comprueba tu respuesta contra el audio antes de darla.\n' +
    'Reglas:\n' +
    '- Los números nunca decrecen.\n' +
    '- USA TODA la duración del audio (' + Math.round(dur) + ' s). Error MUY frecuente: ' +
    'amontonar todos los versos en la primera mitad. El ÚLTIMO verso suele empezar ' +
    'cerca del final del audio (hacia el segundo ' + Math.round(dur * 0.85) + '). Antes ' +
    'de responder, comprueba que tus números llegan hasta el final.\n' +
    '- El coro canta de forma bastante CONTINUA. Entre dos versos seguidos lo normal ' +
    'son 1-3 segundos. Reparte los versos parejos, cerca de la media de ~' + media + ' s.\n' +
    '- Si hay introducción instrumental, el verso 0 empieza cuando entra la voz.\n' +
    '- SOLO deja un hueco de más de 5 segundos entre dos versos si en el audio se oye ' +
    'CLARAMENTE una sección instrumental larga o tarareos sin letra ("na na na", "oh"). ' +
    'Si no estás seguro, NO dejes hueco grande.\n' +
    '- Ante la duda, es mejor que un verso entre un poco ANTES que un poco después.\n' +
    '- Puede ser un tema de práctica vocal con sílabas repetidas (konnakol, ' +
    '"tarekita…", vocalizaciones) o hecho con IA: aunque los versos se parezcan, ' +
    'guíate por el RITMO del audio y reparte igualmente un número por verso.\n' +
    'Devuelve solo el array de números. Ejemplo: [0.0, 4.2, 8.1, 12.7]\n\n' +
    'LETRA:\n' + num
  );
}

// Interpreta la respuesta de Gemini y la deja como un array de `n` segundos
// no decrecientes. Acepta [1.2, 3.4] y también [{ "i":0, "t":1.2 }, …].
function parseTiempos(salida, n) {
  let txt = String(salida || '').trim();
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) txt = fence[1].trim();
  const i = txt.indexOf('[');
  const j = txt.lastIndexOf(']');
  if (i === -1 || j === -1 || j < i) return null;
  let arr;
  try { arr = JSON.parse(txt.slice(i, j + 1)); } catch (e) { return null; }
  if (!Array.isArray(arr) || !arr.length) return null;

  let vals = arr
    .map((x) => (x && typeof x === 'object') ? Number(x.t) : Number(x))
    .filter((v) => isFinite(v) && v >= 0);
  if (vals.length < Math.min(2, n)) return null;

  if (vals.length > n) vals = vals.slice(0, n);
  while (vals.length < n) vals.push(vals[vals.length - 1] + 2);
  for (let k = 1; k < vals.length; k++) {
    if (vals[k] < vals[k - 1]) vals[k] = vals[k - 1];
  }
  return vals.map((v) => Math.round(v * 10) / 10);
}

// Reparto APROXIMADO cuando la IA no está disponible (503 "high demand",
// cuota agotada…): así "Sincronizar" nunca falla del todo — Maite recibe una
// base razonable y la afina con "Ajustar los tiempos". Deja ~8% de intro y
// reparte los versos proporcional a su longitud por el resto del audio.
function tiemposAprox(lineas, dur) {
  const n = lineas.length;
  const intro = Math.min(dur * 0.08, 4);
  const outro = Math.min(dur * 0.05, 3);
  const util = Math.max(1, dur - intro - outro);
  const pesos = lineas.map((l) => Math.max(4, String(l || '').trim().length));
  const total = pesos.reduce((a, b) => a + b, 0) || n;
  const out = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    out.push(Math.round((intro + (acc / total) * util) * 10) / 10);
    acc += pesos[i];
  }
  return out;
}

/* ---------- Forced alignment con Whisper (Groq) ----------
   Transcribe el recorte de audio con marcas de tiempo por palabra y alinea
   los versos conocidos contra ese flujo. Devuelve { tiempos:[seg…] } o null
   (no transcribió bastante para anclar). Gratis en Groq: whisper-large-v3-turbo. */

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Palabra "desnuda": minúsculas, sin acentos ni signos, solo letras/números.
function normPal(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '');
}

function idiomaISO(nombre) {
  const s = String(nombre || '').toLowerCase();
  if (/eusk|vasco/.test(s)) return 'eu';
  if (/lat[ií]n/.test(s)) return 'la';
  if (/ital/.test(s)) return 'it';
  if (/alem|deuts|german/.test(s)) return 'de';
  if (/ingl|english/.test(s)) return 'en';
  if (/fran[cç]/.test(s)) return 'fr';
  if (/portug/.test(s)) return 'pt';
  if (/catal/.test(s)) return 'ca';
  if (/espa[nñ]|castell/.test(s)) return 'es';
  return '';
}

// Recorta bloques de actividad a la ventana [a,b].
function actividadEntre(bloques, a, b) {
  const out = [];
  for (const bl of (bloques || [])) {
    const x0 = Math.max(a, bl[0]), x1 = Math.min(b, bl[1]);
    if (x1 > x0) out.push([x0, x1]);
  }
  return out;
}
function mapearActividad(bloques, seg) {
  let acc = 0;
  for (const b of bloques) {
    const d = b[1] - b[0];
    if (seg <= acc + d) return b[0] + (seg - acc);
    acc += d;
  }
  const ult = bloques[bloques.length - 1];
  return ult ? ult[1] : seg;
}

// Rellena los versos sin ancla. `bloques` (opcional) son los tramos donde
// Whisper detecta canto real: si un hueco entre dos anclas contiene un tramo
// de silencio/instrumental de por medio (p.ej. un puente musical), los versos
// intermedios se reparten dentro de lo que de verdad se canta, no en línea
// recta por todo el hueco (que los metía en plena parte instrumental).
function rellenarInterp(starts, dur, bloques) {
  const n = starts.length;
  const out = starts.slice();
  let first = -1, last = -1;
  for (let i = 0; i < n; i++) if (out[i] != null) { if (first < 0) first = i; last = i; }
  if (first < 0) return null;
  for (let i = 0; i < first; i++) out[i] = Math.max(0, out[first] * (i + 1) / (first + 1));
  const fin = Math.min(dur, (out[last] != null ? out[last] : dur) + 3);
  for (let i = last + 1; i < n; i++) {
    out[i] = out[last] + (fin - out[last]) * (i - last) / (n - last);
  }
  let i = first;
  while (i < last) {
    if (out[i] == null) { i++; continue; }
    let k = i + 1;
    while (k <= last && out[k] == null) k++;
    if (k <= last && k > i + 1) {
      const sub = bloques ? actividadEntre(bloques, out[i], out[k]) : null;
      const totalAct = sub ? sub.reduce((s, b) => s + (b[1] - b[0]), 0) : 0;
      // Si dentro del hueco hay de verdad un tramo sin cantar (>25% del hueco
      // es silencio), se reparte solo por lo activo. Si no, línea recta normal.
      const usarActividad = sub && totalAct > 0 && totalAct < (out[k] - out[i]) * 0.75;
      for (let m = i + 1; m < k; m++) {
        // Interpolación con un pelín de SESGO TARDÍO: que un verso interpolado
        // entre "un poco tarde" molesta menos que "un poco antes" (si entra
        // antes, la letra se adelanta y luego espera parada). Curva suave que
        // atrasa más los del centro del hueco.
        const f = (m - i) / (k - i);
        const fSesg = f + 0.12 * Math.sin(f * Math.PI);
        out[m] = usarActividad
          ? mapearActividad(sub, fSesg * totalAct)
          : out[i] + (out[k] - out[i]) * fSesg;
      }
    }
    i = k;
  }
  for (let m = 1; m < n; m++) if (out[m] < out[m - 1]) out[m] = out[m - 1];
  return out.map((v) => Math.round(Math.max(0, v || 0) * 10) / 10);
}

// ¿"la misma palabra"? Exacto, o mismo prefijo de 4 (Whisper masca las
// terminaciones al cantar), o distancia de edición <=1.
function palIgual(a, b) {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

// Descarta anclas que se salen del patrón: si el tiempo de un verso anclado se
// aleja > TOL segundos de lo que predicen sus vecinos anclados, es un falso
// positivo del emparejado (palabra suelta que coincidió por casualidad en otro
// punto de la canción). Se quita y se repite hasta que todo cuadra.
function depurarAnclas(starts, pace) {
  const idx = [];
  for (let i = 0; i < starts.length; i++) if (starts[i] != null) idx.push(i);
  // 1) monotonía: un ancla anterior a la previa es basura segura.
  for (let p = 1; p < idx.length; p++) {
    if (starts[idx[p]] < starts[idx[p - 1]] - 0.3) { starts[idx[p]] = null; idx.splice(p, 1); p--; }
  }
  // 1b) versos DISTINTOS que anclan prácticamente al mismo segundo: red de
  // seguridad contra un futuro fallo del estilo "alucinación al segundo 0"
  // (varios versos "cantándose" a la vez es imposible en un coro homofónico).
  for (let p = 1; p < idx.length; p++) {
    if (Math.abs(starts[idx[p]] - starts[idx[p - 1]]) < 0.15) { starts[idx[p]] = null; idx.splice(p, 1); p--; }
  }
  // 1c) RITMO IMPOSIBLE: una racha de anclas mucho más juntas entre sí que el
  // ritmo medio de la canción (versos/segundo) no es que se cante rapidísimo
  // ahí — es que palabras cortas o muy comunes (artículos, conjunciones: "der",
  // "die", "and"…) casaron por casualidad, todas cerca unas de otras en la
  // transcripción, y arrastraron consigo varios versos que en realidad van
  // repartidos por la canción. Caso real: alemán, 10 versos "anclados" en
  // apenas 8 s cuando la canción dura 101 s para 32 versos. Cada ancla de la
  // racha, vista solo contra sus vecinas INMEDIATAS, parece consistente (por
  // eso el filtro de abajo no la pilla) — hay que compararla con el ritmo
  // GLOBAL. Se descarta la racha entera menos la primera.
  if (pace > 0) {
    const minGap = Math.max(0.6, pace * 0.3);
    let p = 1;
    while (p < idx.length) {
      if (starts[idx[p]] - starts[idx[p - 1]] < minGap) {
        let q = p;
        while (q < idx.length && starts[idx[q]] - starts[idx[q - 1]] < minGap) q++;
        const quitar = idx.slice(p, q);
        quitar.forEach((i) => { starts[i] = null; });
        idx.splice(p, q - p);
      } else {
        p++;
      }
    }
  }
  // 2) outliers frente a la recta local de vecinos.
  let sigue = true;
  while (idx.length >= 4 && sigue) {
    sigue = false;
    let peor = -1, peorDev = 0;
    for (let p = 1; p < idx.length - 1; p++) {
      const iA = idx[p - 1], iB = idx[p + 1], iM = idx[p];
      const pred = starts[iA] + (starts[iB] - starts[iA]) * (iM - iA) / (iB - iA);
      const dev = Math.abs(starts[iM] - pred);
      if (dev > peorDev) { peorDev = dev; peor = p; }
    }
    if (peor > 0 && peorDev > 9) {
      starts[idx[peor]] = null;
      idx.splice(peor, 1);
      sigue = true;
    }
  }
}

// Alinea los versos contra la transcripción cronometrada de Whisper con un LCS
// monotónico sobre las palabras: así los "yeah yeah" que mete Whisper y los
// trozos que no transcribe bien no descolocan el resto. Cada verso se ancla al
// segundo de su primera palabra emparejada; los versos sin ancla se interpolan.
function alinearVersos(lineas, words, dur) {
  const W = (words || []).filter((x) => x && x.w && isFinite(x.t));
  if (W.length < 4) return null;

  const V = [];
  lineas.forEach((l, vi) => {
    String(l).split(/\s+/).map(normPal).filter((t) => t.length >= 2)
      .forEach((t) => V.push({ t: t, vi: vi }));
  });
  const n = V.length, m = W.length;
  if (!n) return null;

  // Por verso: nº de palabras emparejadas, tiempo de la 1ª y longitud del
  // token más largo que casó. Un verso se ANCLA solo si tiene señal de sobra:
  // 2+ palabras emparejadas, o 1 pero larga (>=8) y poco ambigua.
  const cnt = new Array(lineas.length).fill(0);
  const t1 = new Array(lineas.length).fill(null);
  const tokMax = new Array(lineas.length).fill(0);

  if (n * m <= 6000000) {
    const ancho = m + 1;
    const dp = new Uint16Array((n + 1) * ancho);
    for (let i = 1; i <= n; i++) {
      const vt = V[i - 1].t;
      const fila = i * ancho, prev = (i - 1) * ancho;
      for (let j = 1; j <= m; j++) {
        if (palIgual(vt, W[j - 1].w)) {
          dp[fila + j] = dp[prev + j - 1] + 1;
        } else {
          const a = dp[prev + j], b = dp[fila + j - 1];
          dp[fila + j] = a >= b ? a : b;
        }
      }
    }
    let i = n, j = m;
    while (i > 0 && j > 0) {
      if (palIgual(V[i - 1].t, W[j - 1].w) &&
          dp[i * ancho + j] === dp[(i - 1) * ancho + j - 1] + 1) {
        const vi = V[i - 1].vi;
        cnt[vi]++;
        t1[vi] = W[j - 1].t;   // hacia atrás: la última asignación es la más temprana
        if (V[i - 1].t.length > tokMax[vi]) tokMax[vi] = V[i - 1].t.length;
        i--; j--;
      } else if (dp[(i - 1) * ancho + j] >= dp[i * ancho + j - 1]) {
        i--;
      } else {
        j--;
      }
    }
  } else {
    let j = 0;
    for (let vi = 0; vi < lineas.length; vi++) {
      const toks = String(lineas[vi]).split(/\s+/).map(normPal).filter((t) => t.length >= 5);
      for (let ti = 0; ti < toks.length; ti++) {
        for (let k = j; k < Math.min(m, j + 40); k++) {
          if (palIgual(toks[ti], W[k].w)) {
            cnt[vi]++;
            if (t1[vi] == null) t1[vi] = W[k].t;
            if (toks[ti].length > tokMax[vi]) tokMax[vi] = toks[ti].length;
            j = k + 1; break;
          }
        }
      }
    }
  }

  const starts = new Array(lineas.length).fill(null);
  for (let vi = 0; vi < lineas.length; vi++) {
    if (t1[vi] != null) starts[vi] = t1[vi];
  }
  depurarAnclas(starts, dur / Math.max(1, lineas.length));   // ritmo medio de la canción

  const anclas = starts.filter((x) => x != null).length;
  if (anclas < 2) return null;
  const tiempos = rellenarInterp(starts, dur, bloquesActividad(words, dur));
  return tiempos ? { tiempos, anclas } : null;
}

async function sincroniaWhisper(lineas, audioB64, mime, dur, idiomaNombre, groqKey) {
  let bytes;
  try { bytes = b64ToBytes(audioB64); } catch (e) { return { nota: 'audio ilegible' }; }
  const ext = /wav/i.test(mime) ? 'wav' : (/mp3|mpeg/i.test(mime) ? 'mp3' : 'm4a');
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: mime || 'audio/wav' }), 'audio.' + ext);
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  fd.append('temperature', '0');
  const lang = idiomaISO(idiomaNombre);
  if (lang) fd.append('language', lang);
  // QUITADO `prompt` con la letra: parecía buena idea (sesgar la transcripción
  // hacia las palabras reales) pero Whisper tiene un fallo conocido — si el
  // prompt se parece mucho a lo que va a oír, a veces "alucina" que ya lo está
  // cantando desde el segundo 0, aunque ahí solo haya melodía/silencio (caso
  // real: "Serenata para la tierra de uno", empezaba a la 3ª línea con
  // tiempos [0,0,0,...]). Sin prompt no pasaba. No se vuelve a usar.

  let r;
  try {
    r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + String(groqKey || '').trim() },
      body: fd,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) { return { nota: 'groq timeout/red' }; }
  if (!r || !r.ok) {
    let d = '';
    try { d = (await r.json()).error?.message || ('HTTP ' + r.status); } catch (e) { d = 'HTTP ' + (r && r.status); }
    return { nota: 'groq ' + d };
  }
  let data;
  try { data = await r.json(); } catch (e) { return { nota: 'groq json' }; }

  let words = [];
  if (Array.isArray(data.words) && data.words.length) {
    words = data.words
      .map((x) => ({ w: normPal(x.word), t: Number(x.start), e: Number(x.end) }))
      .filter((x) => x.w && isFinite(x.t));
  } else if (Array.isArray(data.segments)) {
    // Sin marcas por palabra: se reparten las palabras del segmento por su ventana.
    for (const seg of data.segments) {
      const ws = String(seg.text || '').split(/\s+/).filter(Boolean);
      const s = Number(seg.start), e = Number(seg.end);
      if (!isFinite(s) || !isFinite(e) || e <= s || !ws.length) continue;
      for (let i = 0; i < ws.length; i++) {
        words.push({
          w: normPal(ws[i]),
          t: s + (e - s) * (i / ws.length),
          e: s + (e - s) * ((i + 1) / ws.length),
        });
      }
    }
    words = words.filter((x) => x.w);
  }
  const muestra = words.slice(0, 12).map((x) => x.w).join(' ');
  console.log('[sincronia] whisper transcribió', words.length, 'palabras. Muestra:', muestra);

  // Letras de práctica con sílabas repetidas (konnakol "tarekita tarekita…",
  // pistas hechas con IA para calentar voz): identificar QUÉ palabra es no
  // sirve de nada, todas se parecen. Ahí no se busca casar palabras, se usa el
  // RITMO real: bloques de canto continuo (silencios/instrumental de por
  // medio se saltan) y se reparten los versos proporcional a su longitud
  // dentro de esos bloques. Sigue siendo mejor que repartir a ciegas sobre
  // toda la duración (que es lo que hacía `tiemposAprox`).
  if (repetitiva(lineas)) {
    const t = tiemposPorActividad(lineas, words, dur);
    if (t) {
      console.log('[sincronia] letra repetitiva -> reparto por actividad real del audio');
      return { tiempos: t, anclas: 0, actividad: true };
    }
  }

  const al = alinearVersos(lineas, words, dur);
  if (al) return al;

  // Emparejado por palabras sin suficientes anclas (letra rara, mala
  // transcripción…): antes de rendirse a Gemini, el reparto por actividad real
  // del audio (si hubo transcripción) ya es mejor que el aproximado a ciegas.
  if (words.length >= 6) {
    const t = tiemposPorActividad(lineas, words, dur);
    if (t) return { tiempos: t, anclas: 0, actividad: true };
  }
  return { nota: 'pocas anclas (' + words.length + ' palabras transcritas)' };
}

// ¿Letra de práctica con sílabas repetidas? Muy poca variedad de palabras
// (relación tipos/token baja) o un patrón "misma palabra muchas veces".
function repetitiva(lineas) {
  const toks = [];
  lineas.forEach((l) => String(l).split(/\s+/).map(normPal).filter(Boolean).forEach((t) => toks.push(t)));
  if (toks.length < 6) return false;
  const uniq = new Set(toks);
  return (uniq.size / toks.length) < 0.32;
}

// Bloques de canto continuo a partir de las palabras cronometradas: se separan
// donde hay un hueco > GAP segundos (silencio, parte instrumental).
function bloquesActividad(words, dur) {
  // OJO: es un CORO, no habla normal. La última sílaba de la frase se alarga
  // cantada ("vos" -> "voooos") varios segundos, y Whisper solo marca dónde
  // EMPIEZA la palabra, no lo que dura la nota sostenida — durante esa nota no
  // hay palabras nuevas, así que sin este margen parecía "silencio" y partía
  // el bloque de actividad justo donde en realidad se seguía cantando.
  const SOSTENIDO = 1.6;   // colchón tras cada palabra por si su vocal se alarga
  const GAP = 3.4;         // hueco real (silencio/instrumental) para cortar bloque
  const pts = (words || [])
    .filter((x) => x && isFinite(x.t))
    .map((x) => [x.t, (isFinite(x.e) && x.e > x.t ? x.e : x.t + 0.3) + SOSTENIDO])
    .sort((a, b) => a[0] - b[0]);
  if (!pts.length) return [[0, dur]];
  const bloques = [];
  let ini = Math.max(0, pts[0][0] - 0.3), fin = pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] - fin > GAP) { bloques.push([ini, fin]); ini = Math.max(0, pts[i][0] - 0.3); }
    if (pts[i][1] > fin) fin = pts[i][1];
  }
  bloques.push([ini, Math.min(dur, fin)]);
  return bloques.filter((b) => b[1] > b[0]);
}

// Reparte los versos proporcional a su longitud, pero SOLO dentro de los
// tramos donde de verdad se canta (salta los huecos entre bloques).
function tiemposPorActividad(lineas, words, dur) {
  const bloques = bloquesActividad(words, dur);
  const total = bloques.reduce((s, b) => s + (b[1] - b[0]), 0);
  if (!(total > 1)) return null;
  const pesos = lineas.map((l) => Math.max(4, String(l || '').trim().length));
  const suma = pesos.reduce((a, b) => a + b, 0) || lineas.length;
  const out = [];
  let acc = 0;
  for (let i = 0; i < lineas.length; i++) {
    out.push(mapearActividad(bloques, (acc / suma) * total));
    acc += pesos[i];
  }
  for (let m = 1; m < out.length; m++) if (out[m] < out[m - 1]) out[m] = out[m - 1];
  return out.map((v) => Math.round(Math.max(0, v) * 10) / 10);
}

async function sincronia(cuerpo, cors, env) {
  try {
    return await sincroniaInterna(cuerpo, cors, env);
  } catch (e) {
    // Nunca dejamos que reviente hacia Cloudflare (devolvería un 502 en HTML
    // que el móvil no sabe interpretar). Siempre JSON.
    return json({ error: 'fallo en la sincronía', detalle: String((e && e.message) || e) }, 502, cors);
  }
}

async function sincroniaInterna(cuerpo, cors, env) {
  const lineas = Array.isArray(cuerpo.lineas)
    ? cuerpo.lineas.map((l) => String(l == null ? '' : l).trim()).filter(Boolean).slice(0, 200)
    : [];
  const audio = String(cuerpo.audio || '');
  const mime = (String(cuerpo.mime || 'audio/mpeg').split(';')[0].trim()) || 'audio/mpeg';
  const dur = Math.max(1, Math.min(3600, Number(cuerpo.dur) || 0));
  // Plantilla: fracciones (0..1) de un ajuste a mano previo de esta MISMA
  // canción, una por verso. Solo se admite si encaja exactamente con el nº
  // de versos de hoy (si la letra cambió, se ignora).
  let plantilla = null;
  if (Array.isArray(cuerpo.plantilla) && cuerpo.plantilla.length === lineas.length) {
    const p = cuerpo.plantilla.map(Number);
    if (p.every((x) => isFinite(x) && x >= 0 && x <= 1)) plantilla = p;
  }

  if (lineas.length < 2) return json({ error: 'faltan líneas de letra' }, 400, cors);
  if (audio.length < 100) return json({ error: 'falta el audio' }, 400, cors);
  if (audio.length > 16 * 1024 * 1024) return json({ error: 'el audio es demasiado largo' }, 413, cors);

  // SIN caché: la app guarda `marca.sincro` en el dispositivo, así que solo
  // llega aquí cuando Maite pulsa "Sincronizar" a propósito (típicamente para
  // REHACER una que salió mal). Cachear solo servía para devolverle el mismo
  // resultado malo una y otra vez.

  let tiempos = null, ultDetalle = '', clave = false, via = 'gemini';

  // 1º — WHISPER (Groq): transcribe el audio con marcas de tiempo POR PALABRA y
  // se alinean los versos conocidos contra ese flujo de palabras reales. Es lo
  // que de verdad clava los tiempos: Gemini "escuchando" el tema entero se los
  // inventaba (los amontonaba en la primera mitad, "se lanzaba el triple").
  // Solo activo si hay GROQ_API_KEY. Si no transcribe bastante (latín, sílabas
  // repetidas de las pistas de práctica…) devuelve null y se sigue con Gemini.
  if (env.GROQ_API_KEY) {
    try {
      const w = await sincroniaWhisper(lineas, audio, mime, dur, cuerpo.idioma, env.GROQ_API_KEY);
      // `via` distingue el emparejado por palabras (preciso, "fiable" en la
      // app) del reparto por actividad real del audio (mejor que a ciegas,
      // pero sigue siendo un reparto: se trata como Gemini, tolerante).
      if (w && w.tiempos) { tiempos = w.tiempos; via = w.actividad ? 'whisper-actividad' : 'whisper'; }
      else if (w && w.nota) ultDetalle = w.nota;
      console.log('[sincronia] dur=' + Math.round(dur) + 's lineas=' + lineas.length +
        ' whisper ->', w && w.tiempos
          ? ('OK via=' + (w.actividad ? 'actividad' : (w.anclas + '/' + lineas.length + ' anclas')) +
             ' | tiempos: ' + JSON.stringify(w.tiempos.slice(0, 10)))
          : ('NO: ' + (w && w.nota)));
    } catch (e) { ultDetalle = 'whisper: ' + ((e && e.message) || e); console.log('[sincronia] whisper EXC', ultDetalle); }
  } else {
    console.log('[sincronia] sin GROQ_API_KEY');
  }

  // 2º — GEMINI: solo si Whisper no dio resultado.
  // Se serializa UNA sola vez (el audio en base64 son varios MB; volver a
  // hacer JSON.stringify en cada reintento se comía el límite de CPU del
  // Worker y el runtime lo mataba -> 502 en HTML).
  // `responseSchema` OBLIGA a Gemini a devolver un array de números: sin esto,
  // con canciones raras (konnakol "TaReKiTa", temas hechos con IA…) se ponía a
  // "explicar" la letra en prosa y no había JSON que interpretar.
  //
  // Con thinkingBudget 0 respondía en 2-3 s pero "se lo inventaba": repartía
  // los versos a ojo sin escuchar de verdad el audio. Ubicar cada verso en una
  // grabación de coro SÍ necesita razonar (seguir la melodía, distinguir voz de
  // instrumental, contar compases). Le damos un presupuesto de "pensar"
  // proporcional al nº de versos; el maxOutputTokens tiene que cubrir además
  // esos tokens de pensamiento. Sigue habiendo respaldo `aprox` si se cuelga.
  if (!tiempos) {
  const pensar = Math.min(6000, 1200 + lineas.length * 90);
  const bodyGemini = JSON.stringify({
    contents: [{ parts: [
      { text: promptSincro(lineas, dur) },
      { inlineData: { mimeType: mime, data: audio } },
    ] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: Math.min(16384, pensar + 900 + lineas.length * 14),
      thinkingConfig: { thinkingBudget: pensar },
      responseMimeType: 'application/json',
      responseSchema: { type: 'ARRAY', items: { type: 'NUMBER' } },
    },
  });

  // Cadena de intentos: cada modelo hasta 2 veces (el 503 "high demand" del
  // nivel gratis suele ser puntual). Cada modelo tiene su propio cupo diario.
  const MODELOS_SINCRO = ['gemini-3.6-flash', 'gemini-flash-latest'];
  outer:
  for (const modelo of MODELOS_SINCRO) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      modelo + ':generateContent?key=' + encodeURIComponent(env.GEMINI_API_KEY);
    for (let intento = 0; intento < 2; intento++) {
      if (intento > 0) await new Promise((res) => setTimeout(res, 2500));
      let r = null, data = null;
      try {
        r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyGemini,
          signal: AbortSignal.timeout(90000),
        });
      } catch (e) {
        ultDetalle = 'timeout/red: ' + ((e && e.message) || e);
        continue;
      }
      try { data = await r.json(); } catch (e) { data = null; }
      if (!r.ok) {
        ultDetalle = (data && data.error && data.error.message) || ('HTTP ' + r.status);
        if (r.status === 401 || r.status === 403) { clave = true; break outer; }
        if (r.status === 503) continue;          // saturación: reintento
        break;                                    // 429/otro: siguiente modelo
      }
      const partes =
        (data && data.candidates && data.candidates[0] &&
          data.candidates[0].content && data.candidates[0].content.parts) || [];
      const salida = partes.map((p) => p.text || '').join('').trim();
      tiempos = parseTiempos(salida, lineas.length);
      if (tiempos) break outer;
      ultDetalle = 'respuesta sin JSON: ' + salida.slice(0, 160);
      break;   // parseó mal: siguiente modelo
    }
  }
  }

  // PLANTILLA: si Maite ya ajustó esta canción a mano alguna vez (en
  // cualquier ensayo), esa forma — en qué fracción de la pieza entra cada
  // verso — vale para la grabación de HOY. No es la IA "aprendiendo" (Whisper
  // y Gemini son modelos ajenos, no se pueden reeducar), es la app recordando
  // cómo va SU repertorio. Se usa de dos formas:
  //  - si ningún motor sacó nada, ES la respuesta (mejor que el reparto a
  //    ciegas de `tiemposAprox`).
  //  - si sí hubo resultado, corrige los versos que se hayan ido MUY lejos de
  //    donde suele entrar ese verso (un despiste puntual del emparejado).
  if (plantilla) {
    if (!tiempos) {
      tiempos = plantilla.map((f) => Math.round(f * dur * 10) / 10);
      via = 'plantilla';
      console.log('[sincronia] sin whisper ni gemini -> usando plantilla de ajustes anteriores');
    } else {
      let corregidos = 0;
      tiempos = tiempos.map((t, i) => {
        const esperado = plantilla[i] * dur;
        if (Math.abs(t - esperado) > Math.max(8, dur * 0.15)) { corregidos++; return Math.round(esperado * 10) / 10; }
        return t;
      });
      for (let m = 1; m < tiempos.length; m++) if (tiempos[m] < tiempos[m - 1]) tiempos[m] = tiempos[m - 1];
      if (corregidos) console.log('[sincronia] plantilla corrigió', corregidos, 'versos fuera de sitio');
    }
  }

  let aprox = false;
  if (!tiempos) {
    if (clave) {
      return json({ error: 'Gemini rechazó la petición', detalle: ultDetalle }, 502, cors);
    }
    // La IA no está disponible: en vez de fallar, damos un reparto aproximado
    // para que Maite pueda ajustarlo. Se marca `aprox` para avisarla.
    tiempos = tiemposAprox(lineas, dur);
    aprox = true;
  }

  const respuesta = JSON.stringify(
    aprox ? { tiempos, aprox: true, via: 'aprox', nota: ultDetalle } : { tiempos, via: via });

  return new Response(respuesta, {
    headers: {
      'Content-Type': 'application/json',
      'X-Via': aprox ? 'aprox' : via,
      ...cors,
    },
  });
}

async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
