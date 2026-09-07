// =========================================================
// Parches sobre la plataforma Android generada por Capacitor.
// android/ está en .gitignore y se regenera con `npx cap add android`,
// así que estos ajustes deben poder reaplicarse solos.
//
// Se ejecuta tras `npx cap sync` (ver package.json). Es idempotente.
// =========================================================
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(raiz, 'android/app/src/main/AndroidManifest.xml');

if (!existsSync(manifest)) {
  console.log('android-fix: no hay plataforma Android todavía — nada que parchear.');
  process.exit(0);
}

// --- Icono monocromo para la barra de estado (notificaciones) -----------
// android/ está en .gitignore; el fuente vive en resources/ y se copia aquí.
const iconoSrc = resolve(raiz, 'resources/ic_stat_bihotsak.xml');
const iconoDst = resolve(raiz, 'android/app/src/main/res/drawable/ic_stat_bihotsak.xml');
if (existsSync(iconoSrc)) {
  const contenido = readFileSync(iconoSrc, 'utf8');
  if (!existsSync(iconoDst) || readFileSync(iconoDst, 'utf8') !== contenido) {
    mkdirSync(dirname(iconoDst), { recursive: true });
    writeFileSync(iconoDst, contenido);
    console.log('android-fix: icono de notificación ic_stat_bihotsak actualizado.');
  }
}

// --- Firebase Cloud Messaging (push con la app cerrada) -----------------
// google-services.json NO se versiona (lleva ids del proyecto). El fuente
// vive en resources/ y se copia a android/app/. Si no está, se omite todo
// lo de push y el APK sigue compilando igual (sin regresión).
const gsSrc = resolve(raiz, 'resources/google-services.json');
const gsDst = resolve(raiz, 'android/app/google-services.json');
const hayFCM = existsSync(gsSrc);

if (hayFCM) {
  const gs = readFileSync(gsSrc, 'utf8');
  if (!existsSync(gsDst) || readFileSync(gsDst, 'utf8') !== gs) {
    writeFileSync(gsDst, gs);
    console.log('android-fix: google-services.json copiado a android/app/.');
  }

  // Plugin de Gradle google-services: classpath en el build.gradle raíz…
  const gradleRaiz = resolve(raiz, 'android/build.gradle');
  if (existsSync(gradleRaiz)) {
    let g = readFileSync(gradleRaiz, 'utf8');
    if (!g.includes('com.google.gms:google-services')) {
      g = g.replace(
        /(classpath ['"]com\.android\.tools\.build:gradle[^\n]*\n)/,
        `$1        classpath 'com.google.gms:google-services:4.4.2'\n`
      );
      writeFileSync(gradleRaiz, g);
      console.log('android-fix: classpath google-services añadido a android/build.gradle.');
    }
  }

  // …y "apply plugin" al final del build.gradle del módulo app.
  const gradleApp = resolve(raiz, 'android/app/build.gradle');
  if (existsSync(gradleApp)) {
    let g = readFileSync(gradleApp, 'utf8');
    if (!g.includes("com.google.gms.google-services")) {
      g = g.trimEnd() + "\n\napply plugin: 'com.google.gms.google-services'\n";
      writeFileSync(gradleApp, g);
      console.log('android-fix: apply plugin google-services añadido a android/app/build.gradle.');
    }
  }
} else {
  console.log('android-fix: sin resources/google-services.json — push (FCM) desactivada, APK compila igual.');
}

let xml = readFileSync(manifest, 'utf8');
let cambiado = false;

// Icono y color por defecto de las notificaciones push de FCM.
if (hayFCM && !xml.includes('com.google.firebase.messaging.default_notification_icon')) {
  xml = xml.replace(
    /(\s*)(<\/application>)/,
    `$1    <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_bihotsak" />` +
    `$1$2`
  );
  cambiado = true;
}

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
