// =========================================================
// ota.js — Publica una actualización por wifi (OTA).
//
//   npm run ota                         sube el bundle (+1) y publica
//   npm run ota 1.18                    además fija el nombre visible a 1.18
//   npm run ota -- --nota "Arreglado el visor de partituras"
//   npm run ota -- --obligatoria        se aplica en el móvil sin preguntar
//   npm run ota -- --forzar             salta el aviso de "cambio nativo"
//
// Hace:
//   1. comprueba que no has tocado nada NATIVO (package.json /
//      capacitor.config.json) — eso necesita APK, no OTA.
//   2. sube data/version.json (bundle +1) y npm run build.
//   3. zipea www/  ->  dist/chorapp-v<N>.zip  + sha256.
//   4. sube el zip a Cloudflare R2 con wrangler.
//   5. POST al Worker (/ota): escribe /updates/latest en Firebase
//      y manda una notificación a Maite.
//
// Config (una vez): copia scripts/ota.local.json.ejemplo a
// scripts/ota.local.json y rellénalo. Requiere `npx wrangler login`
// hecho en worker/ (el mismo de las push). Ver docs/actualizaciones.md.
// =========================================================
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const esWin = platform() === 'win32';
const P = (rel) => resolve(raiz, rel);

function abortar(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd: cwd || raiz, stdio: 'inherit', shell: esWin });
const runCapturado = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd: cwd || raiz, encoding: 'utf8', shell: esWin });

/* ---------- 0. Configuración local ---------- */

const cfgPath = P('scripts/ota.local.json');
if (!existsSync(cfgPath)) {
  abortar(
    'Falta scripts/ota.local.json.\n' +
    '  Copia scripts/ota.local.json.ejemplo, rellénalo y vuelve a lanzar.\n' +
    '  Guía completa: docs/actualizaciones.md'
  );
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
for (const k of ['bucket', 'publicBase', 'workerUrl', 'secret']) {
  if (!cfg[k]) abortar('scripts/ota.local.json: falta "' + k + '".');
}
const publicBase = String(cfg.publicBase).replace(/\/+$/, '');
const workerUrl = String(cfg.workerUrl).replace(/\/+$/, '');

/* ---------- 1. Argumentos ---------- */

const args = process.argv.slice(2).filter((a) => a !== '--');
const forzar = args.includes('--forzar');
const obligatoria = args.includes('--obligatoria');
const iNota = args.indexOf('--nota');
const nota = iNota >= 0 ? String(args[iNota + 1] || '').trim() : '';
const nombrePedido = args.find((a) => /^\d+(\.\d+){1,2}$/.test(a)) || null;

/* ---------- 2. Guardia de cambios nativos ---------- */

if (!forzar) {
  let sucio = '';
  try {
    sucio = runCapturado('git', ['status', '--porcelain', '--',
      'package.json', 'package-lock.json', 'capacitor.config.json',
      'scripts/android-fix.js', 'patches']).trim();
  } catch (e) { /* sin git: seguimos */ }
  if (sucio) {
    abortar(
      'Has tocado ficheros NATIVOS (abajo). Un cambio así NO viaja por OTA:\n' +
      sucio.split('\n').map((l) => '    ' + l).join('\n') + '\n\n' +
      '  Si de verdad va todo en el zip web y esos cambios ya están en un APK\n' +
      '  instalado, repite con:   npm run ota -- --forzar\n' +
      '  Si no, genera un APK nuevo:   npm run release'
    );
  }
}

/* ---------- 3. Subir versión + build ---------- */

const verPath = P('src/data/version.json');
const ver = existsSync(verPath)
  ? JSON.parse(readFileSync(verPath, 'utf8'))
  : { bundle: 0, nombre: '0' };
const nuevoBundle = Number(ver.bundle || 0) + 1;

// Nombre visible: una OTA es un "parche" sobre la versión del APK.
//   1.18    -> 1.18.1      (añade el 3.er número)
//   1.18.3  -> 1.18.4      (sube el 3.er número)
// `npm run release` sube el 2.º número (1.18 -> 1.19) y deja la app en un
// nombre limpio para la siguiente tanda de OTAs.
function siguienteParche(nombre) {
  const p = String(nombre || '1.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (p.length < 3) p.push(0);
  p[2] += 1;
  return p.slice(0, 3).join('.');
}
const nuevoNombre = nombrePedido || siguienteParche(ver.nombre);
writeFileSync(verPath, JSON.stringify({ bundle: nuevoBundle, nombre: nuevoNombre }, null, 2) + '\n');
console.log(`\n▶ Versión  ${ver.nombre || '?'}  →  ${nuevoNombre}   (bundle ${ver.bundle || 0} → ${nuevoBundle})`);

console.log('\n▶ npm run build\n');
run('npm', ['run', 'build']);

/* ---------- 4. Zip de www/ + sha256 ---------- */

const dist = P('dist');
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
const zip = resolve(dist, `chorapp-v${nuevoBundle}.zip`);

console.log('\n▶ Empaquetando www/  →  ' + zip.replace(raiz + (esWin ? '\\' : '/'), ''));
try { rmSync(zip, { force: true }); } catch (e) { /* no existía */ }
if (esWin) {
  // OJO: NO usar `Compress-Archive` (PowerShell 5.1) ni la API .NET ZipFile:
  // ambas escriben las rutas del zip con "\" en vez de "/" y Capgo (Java) no
  // lo descomprime -> "Download failed with status: error".
  // El `tar` de Windows (bsdtar, C:\Windows\System32\tar.exe) sí genera un
  // zip estándar con separadores "/" e index.html en la raíz.
  const tarWin = resolve(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  run(tarWin, ['-a', '-c', '-f', zip, '-C', P('www'), '.']);
} else {
  run('zip', ['-r', '-q', zip, '.'], P('www'));
}

const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');
const mb = (readFileSync(zip).length / 1048576).toFixed(2);
console.log(`  ${mb} MB · sha256 ${sha256.slice(0, 16)}…`);

/* ---------- 5. Subida a R2 ---------- */

const clave = `bundles/v${nuevoBundle}.zip`;
console.log('\n▶ Subiendo a R2  (' + cfg.bucket + '/' + clave + ')\n');

// wrangler 3: la subida a la nube es la predeterminada (`--local` para local).
// wrangler 4: invirtió el defecto y hay que pedir `--remote` explícitamente.
let wranglerV4 = false;
try {
  const v = runCapturado('npx', ['wrangler', '--version'], P('worker'));
  const m = v.match(/wrangler\s+(\d+)\./i);
  wranglerV4 = m ? Number(m[1]) >= 4 : false;
} catch (e) { /* si falla, asumimos v3 */ }

const putArgs = ['wrangler', 'r2', 'object', 'put', `${cfg.bucket}/${clave}`,
  '--file', zip, '--content-type', 'application/zip'];
if (wranglerV4) putArgs.push('--remote');
run('npx', putArgs, P('worker'));

const url = `${publicBase}/${clave}`;

/* ---------- 6. Avisar al Worker (Firebase + push) ---------- */

const payload = {
  bundle: nuevoBundle,
  nombre: nuevoNombre,
  url,
  sha256,
  nota,
  obligatoria
};

console.log('\n▶ Publicando en Firebase + notificando a Maite\n');
const res = await fetch(workerUrl + '/ota', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.secret },
  body: JSON.stringify(payload)
});
const salida = await res.json().catch(() => ({}));
if (!res.ok) {
  abortar('El Worker respondió ' + res.status + ': ' + JSON.stringify(salida));
}

console.log('✓ OTA publicada:  bundle ' + nuevoBundle + '  ·  ' + url);
console.log('  ' + (salida.push ? 'Notificación enviada a Maite.' : 'Sin push (revisa el Worker).'));
if (obligatoria) console.log('  Es OBLIGATORIA: se aplicará sola en el móvil.');
console.log('\n  Último paso:  git add -A && git commit -m "OTA bundle ' + nuevoBundle + '"\n');
