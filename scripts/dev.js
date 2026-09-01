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
