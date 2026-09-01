// =========================================================
// Build de ChorApp.
// No hay bundler: la app es HTML/CSS/JS vanilla.
// "Construir" = copiar src/ -> www/ (el webDir que espera Capacitor).
// Queda como punto de enganche por si en el futuro hay que
// minificar, versionar o inyectar variables.
// =========================================================
import { existsSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(raiz, 'src');
const www = resolve(raiz, 'www');

if (!existsSync(src)) {
  console.error('No existe src/. Nada que construir.');
  process.exit(1);
}

if (existsSync(www)) rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(src, www, { recursive: true });

console.log('Build OK — www/ listo para `npx cap sync`.');
