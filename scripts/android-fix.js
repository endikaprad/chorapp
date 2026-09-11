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

// --- Audio mudo para el canal de notificaciones ------------------------
// El canal "chorapp" (src/js/avisos.js) va SIN sonido pero CON vibración.
// El plugin no tiene opción "sin sonido", así que se le pasa un WAV mudo.
// Se genera aquí para no versionar un binario. res/raw exige nombre a-z0-9_.
const rawSilencio = resolve(raiz, 'android/app/src/main/res/raw/silencio.wav');
{
  const sr = 8000, seg = 0.4, n = Math.floor(sr * seg), data = n * 2; // 16-bit mono
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);            // PCM
  wav.writeUInt16LE(1, 22);            // mono
  wav.writeUInt32LE(sr, 24);
  wav.writeUInt32LE(sr * 2, 28);       // byteRate
  wav.writeUInt16LE(2, 32);            // blockAlign
  wav.writeUInt16LE(16, 34);           // bitsPerSample
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);         // el resto ya es 0 = silencio
  if (!existsSync(rawSilencio) || !readFileSync(rawSilencio).equals(wav)) {
    mkdirSync(dirname(rawSilencio), { recursive: true });
    writeFileSync(rawSilencio, wav);
    console.log('android-fix: res/raw/silencio.wav (audio mudo del canal) generado.');
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

    // firebase-messaging: el plugin @capacitor/push-notifications lo trae
    // como dependencia "implementation" suya, que Gradle NO expone al
    // módulo :app — así que ChorAppMessagingService.java no compila sin
    // añadirlo aquí explícitamente.
    if (!g.includes('com.google.firebase:firebase-messaging')) {
      g = g.replace(
        /(implementation project\(':capacitor-cordova-android-plugins'\)\n)/,
        `$1    implementation platform('com.google.firebase:firebase-bom:33.5.1')\n    implementation 'com.google.firebase:firebase-messaging'\n`
      );
      writeFileSync(gradleApp, g);
      console.log('android-fix: dependencia firebase-messaging añadida a android/app/build.gradle.');
    }
  }
} else {
  console.log('android-fix: sin resources/google-services.json — push (FCM) desactivada, APK compila igual.');
}

// --- Recibir "Compartir con ChorApp" desde WhatsApp/Galería (plugin propio) ---
// android/ está en .gitignore; las fuentes viven en native/plantillas-android/
// (NO "native/android/": .gitignore tiene "android/" sin barra inicial, que
// ignora cualquier carpeta llamada así a cualquier profundidad) y se copian
// aquí. CompartidoPlugin.java es nuevo; MainActivity.java sustituye al stub
// que genera `cap add android` para registrar el plugin y capturar el
// Intent. Ver src/js/compartido.js.
{
  const javaDir = resolve(raiz, 'android/app/src/main/java/com/chorapp/ama');
  const archivos = ['CompartidoPlugin.java', 'MainActivity.java', 'ChorAppMessagingService.java'];
  for (const nombre of archivos) {
    const src = resolve(raiz, 'native/plantillas-android', nombre);
    const dst = resolve(javaDir, nombre);
    if (!existsSync(src)) continue;
    const contenido = readFileSync(src, 'utf8');
    if (!existsSync(dst) || readFileSync(dst, 'utf8') !== contenido) {
      mkdirSync(javaDir, { recursive: true });
      writeFileSync(dst, contenido);
      console.log(`android-fix: ${nombre} (recibir compartido) actualizado.`);
    }
  }
}

// Nota: el modo oscuro NO necesita tocar el MainActivity ni
// setAlgorithmicDarkeningAllowed. Basta con que la web declare
// `color-scheme` y ponga `data-theme` (lo hace el script del <head> de
// index.html leyendo matchMedia). Así el WebView no aplica su propio
// oscurecido y el fondo se ve con los mismos colores que en el navegador.

let xml = readFileSync(manifest, 'utf8');
let cambiado = false;

// --- Rendimiento del WebView -------------------------------------------
// hardwareAccelerated: fuerza composición por GPU de toda la app (es el
//   valor por defecto, pero lo dejamos explícito para que no dependa de
//   cambios de plantilla).
// largeHeap: sube el techo de memoria del proceso. La app decodifica
//   audio entero (waveforms, calibración), abre PDF con PDF.js y maneja
//   blobs de imagen desde IndexedDB; con más heap el recolector de basura
//   entra menos y se notan menos tirones al abrir una canción.
if (!xml.includes('android:hardwareAccelerated')) {
  xml = xml.replace(
    /<application\b/,
    '<application android:hardwareAccelerated="true" android:largeHeap="true"'
  );
  cambiado = true;
}

// --- Bloqueo de orientación: la app es solo vertical ------------------
// Maite la usa siempre en vertical. El giro descoloca el modo estudio,
// la bienvenida a pantalla completa y el reproductor, y no aporta nada.
// Se fija en la <activity> principal (además del configChanges que ya
// trae Capacitor, que evita recrear la Activity al girar el sensor).
if (!xml.includes('android:screenOrientation')) {
  xml = xml.replace(
    /(<activity\b)/,
    '$1 android:screenOrientation="portrait"'
  );
  cambiado = true;
}

// Icono y color por defecto de las notificaciones push de FCM.
if (hayFCM && !xml.includes('com.google.firebase.messaging.default_notification_icon')) {
  xml = xml.replace(
    /(\s*)(<\/application>)/,
    `$1    <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_bihotsak" />` +
    `$1    <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="chorapp" />` +
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

// --- Recibir "Compartir con ChorApp" ------------------------------------
// Intent-filter para aparecer en el menú "Compartir con..." de Android al
// compartir un audio, PDF o imagen (p. ej. desde WhatsApp). Lo captura
// CompartidoPlugin.java / MainActivity.java (ver más arriba).
if (!xml.includes('compartir-whatsapp')) {
  const filtroCompartir =
    '\n            <!-- compartir-whatsapp: recibir audio/PDF/imagen compartidos -->\n' +
    '            <intent-filter>\n' +
    '                <action android:name="android.intent.action.SEND" />\n' +
    '                <category android:name="android.intent.category.DEFAULT" />\n' +
    '                <data android:mimeType="audio/*" />\n' +
    '                <data android:mimeType="image/*" />\n' +
    '                <data android:mimeType="application/pdf" />\n' +
    '            </intent-filter>\n' +
    '        ';
  xml = xml.replace(/(\s*)(<\/activity>)/, filtroCompartir + '$2');
  cambiado = true;
}

// --- Notificación completa (BigTextStyle) con la app cerrada -----------
// El SDK de FCM solo pinta una línea sin este servicio (ver
// ChorAppMessagingService.java / worker/src/index.js, que manda "data" en
// vez de "notification" para que siempre pase por aquí).
if (hayFCM && !xml.includes('ChorAppMessagingService')) {
  const servicio =
    '\n        <!-- Notificación completa (BigTextStyle) también con la app cerrada:\n' +
    '             ver ChorAppMessagingService. -->\n' +
    '        <service\n' +
    '            android:name=".ChorAppMessagingService"\n' +
    '            android:exported="false">\n' +
    '            <intent-filter>\n' +
    '                <action android:name="com.google.firebase.MESSAGING_EVENT" />\n' +
    '            </intent-filter>\n' +
    '        </service>\n' +
    '    ';
  xml = xml.replace(/(\s*)(<\/application>)/, `$1${servicio}$2`);
  cambiado = true;
}

if (cambiado) {
  writeFileSync(manifest, xml);
  console.log('android-fix: permisos de micrófono añadidos al AndroidManifest.');
} else {
  console.log('android-fix: AndroidManifest ya está al día.');
}
