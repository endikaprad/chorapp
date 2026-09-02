// =========================================================
// release.js — Genera un APK firmado de release en un paso.
//
//   npm run release            -> sube el parche (1.3 -> 1.4)
//   npm run release 2.0        -> fija versionName = 2.0
//   npm run release -- --code  -> solo sube versionCode, deja versionName
//
// Hace: sube versión en android/app/build.gradle -> npm run sync
//       -> gradlew assembleRelease -> copia a ChorApp-<versión>.apk
//
// Requiere: plataforma android/ ya creada, keystore.properties con las
// credenciales, y el SDK de Android + un JDK. Si ANDROID_HOME / JAVA_HOME
// no están definidos, intenta rutas habituales de Windows.
// =========================================================
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const esWin = platform() === 'win32';
const gradleBuild = resolve(raiz, 'android/app/build.gradle');

function abortar(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }

if (!existsSync(gradleBuild)) {
  abortar('No existe android/. Ejecuta antes:  npx cap add android');
}
if (!existsSync(resolve(raiz, 'keystore.properties'))) {
  abortar('Falta keystore.properties (copia keystore.properties.ejemplo y rellénalo).');
}

/* ---------- 1. Subir la versión ---------- */

const args = process.argv.slice(2).filter((a) => a !== '--');
const soloCode = args.includes('--code');
const nombrePedido = args.find((a) => /^\d+(\.\d+){1,2}$/.test(a)) || null;

let gradle = readFileSync(gradleBuild, 'utf8');

const mCode = gradle.match(/versionCode\s+(\d+)/);
const mName = gradle.match(/versionName\s+"([^"]+)"/);
if (!mCode || !mName) abortar('No encuentro versionCode / versionName en app/build.gradle.');

const nuevoCode = Number(mCode[1]) + 1;
let nuevoName = mName[1];
if (nombrePedido) {
  nuevoName = nombrePedido;
} else if (!soloCode) {
  // Sube el último número que ya tiene (1.3 -> 1.4 ; 1.3.1 -> 1.3.2).
  const p = nuevoName.split('.').map(Number);
  p[p.length - 1] += 1;
  nuevoName = p.join('.');
}

gradle = gradle
  .replace(/versionCode\s+\d+/, 'versionCode ' + nuevoCode)
  .replace(/versionName\s+"[^"]+"/, 'versionName "' + nuevoName + '"');
writeFileSync(gradleBuild, gradle);
console.log(`\n▶ Versión  ${mName[1]} (code ${mCode[1]})  →  ${nuevoName} (code ${nuevoCode})\n`);

/* ---------- 2. Entorno de compilación ---------- */

const env = { ...process.env };
if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
  const cand = [
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ];
  const sdk = cand.find(existsSync);
  if (sdk) { env.ANDROID_HOME = sdk; console.log('  ANDROID_HOME = ' + sdk); }
}
if (!env.JAVA_HOME) {
  const cand = [
    'C:\\Program Files\\Java\\jdk-21',
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21',
  ];
  const jdk = cand.find(existsSync);
  if (jdk) { env.JAVA_HOME = jdk; console.log('  JAVA_HOME = ' + jdk); }
}

const run = (cmd, cmdArgs, cwd) =>
  execFileSync(cmd, cmdArgs, { cwd: cwd || raiz, env, stdio: 'inherit', shell: esWin });

const gradlew = resolve(raiz, 'android', esWin ? 'gradlew.bat' : 'gradlew');

/* ---------- 3. Sync + compilar ---------- */

console.log('\n▶ npm run sync\n');
run('npm', ['run', 'sync']);

console.log('\n▶ gradlew assembleRelease  (la primera vez tarda unos minutos)\n');
run(gradlew, ['assembleRelease'], resolve(raiz, 'android'));

/* ---------- 4. Copiar el APK ---------- */

const apk = resolve(raiz, 'android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(apk)) abortar('El build terminó pero no encuentro el APK en ' + apk);

const destino = resolve(raiz, `ChorApp-${nuevoName}.apk`);
copyFileSync(apk, destino);

const mb = (readFileSync(destino).length / 1048576).toFixed(1);
console.log(`\n✓ Listo:  ChorApp-${nuevoName}.apk  (${mb} MB, versionCode ${nuevoCode})`);
console.log('  Instálalo encima de la versión anterior en el móvil.\n');
