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
  // Notificación multimedia (reproductor en la barra de estado / bloqueo)
  // que aporta el plugin @jofr/capacitor-media-session.
  // POST_NOTIFICATIONS: en Android 13+ sin él la notificación se descarta en silencio.
  // FOREGROUND_SERVICE_MEDIA_PLAYBACK: obligatorio en Android 14+ (targetSdk 34+)
  //   o el servicio en primer plano del plugin peta al arrancar.
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
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
