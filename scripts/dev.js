// =========================================================
// Servidor de desarrollo de ChorApp.
// Sirve src/ directamente (sin build) para probar en el navegador.
// Vista recomendada: móvil 375–430px (DevTools).
// Sin dependencias: solo módulos de Node.
// =========================================================
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(raiz, 'src');
const PUERTO = process.env.PORT || 5173;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let ruta = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (ruta === '/' || ruta === '\\') ruta = '/index.html';

  // Proxy solo-desarrollo: permite probar la tarjeta "Del coro" en el
  // navegador sin el bloqueo CORS de Instagram. En el APK la app llama a
  // Instagram directamente (CapacitorHttp), así que esta ruta no se usa
  // en producción — y en la PWA publicada simplemente devuelve 404.
  if (url.pathname === '/api/coro') {
    const handle = url.searchParams.get('handle') || '';
    try {
      const r = await fetch(
        'https://www.instagram.com/api/v1/feed/user/' +
          encodeURIComponent(handle) + '/username/?count=3',
        {
          headers: {
            'x-ig-app-id': '936619743392459',
            'x-asbd-id': '129477',
            'x-requested-with': 'XMLHttpRequest',
            'x-ig-www-claim': '0',
            'Referer': 'https://www.instagram.com/' + encodeURIComponent(handle) + '/',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          },
        }
      );
      const cuerpo = await r.text();
      res.writeHead(r.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(cuerpo);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('proxy coro: ' + e.message);
    }
    return;
  }

  // Proxy solo-desarrollo para la traducción automática de letras. En el APK
  // la app llama a translate.googleapis.com directamente (CapacitorHttp evita
  // CORS); aquí hacemos de puente para poder probarlo en el navegador.
  if (url.pathname === '/api/traducir') {
    const q = url.searchParams.get('q') || '';
    const sl = url.searchParams.get('sl') || 'auto';
    const tl = url.searchParams.get('tl') || 'es';
    const hosts = ['translate.googleapis.com', 'translate.google.com', 'clients5.google.com'];
    try {
      let r;
      for (let i = 0; i < hosts.length; i++) {
        r = await fetch(
          'https://' + hosts[i] + '/translate_a/single?client=gtx&dt=t' +
            '&sl=' + encodeURIComponent(sl) +
            '&tl=' + encodeURIComponent(tl) +
            '&q=' + encodeURIComponent(q),
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (r.ok || (r.status !== 429 && r.status < 500)) break;
      }
      const cuerpo = await r.text();
      res.writeHead(r.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(cuerpo);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('proxy traducir: ' + e.message);
    }
    return;
  }

  let archivo = join(base, ruta);
  if (!existsSync(archivo) && !extname(archivo)) archivo = join(base, 'index.html');

  try {
    const datos = await readFile(archivo);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(datos);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — no encontrado');
  }
}).listen(PUERTO, () => {
  console.log(`\n  ChorApp — desarrollo`);
  console.log(`  http://localhost:${PUERTO}\n`);
});
