// =========================================================
// Parches sobre la plataforma Android generada por Capacitor.
// android/ está en .gitignore y se regenera con `npx cap add android`,
// así que estos ajustes deben poder reaplicarse solos.
//
// Se ejecuta tras `npx cap sync` (ver package.json). Es idempotente.
// =========================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(raiz, 'android/app/src/main/AndroidManifest.xml');

if (!existsSync(manifest)) {
  console.log('android-fix: no hay plataforma Android todavía — nada que parchear.');
  process.exit(0);
}

let xml = readFileSync(manifest, 'utf8');
let cambiado = false;

// Permisos de la grabadora de voz. Sin ellos, getUserMedia() en el
// WebView falla sin pedir permiso al usuario.
const permisos = [
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
];

for (const p of permisos) {
  if (!xml.includes(p)) {
    xml = xml.replace(
      /(\s*)<uses-permission android:name="android\.permission\.INTERNET" \/>/,
      `$1<uses-permission android:name="android.permission.INTERNET" />$1<uses-permission android:name="${p}" />`
    );
    cambiado = true;
  }
}

if (cambiado) {
  writeFileSync(manifest, xml);
  console.log('android-fix: permisos de micrófono añadidos al AndroidManifest.');
} else {
  console.log('android-fix: AndroidManifest ya está al día.');
}
