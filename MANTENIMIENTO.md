# Mantenimiento de ChorApp

Guía breve para el desarrollo continuo (añadir canciones, publicar versiones).
El uso diario de Maite **no necesita nada de esto**: ella solo abre la app.

---

## Publicar una versión nueva — cuál de los dos caminos

Hay dos formas de que un cambio llegue al móvil de Maite. **Elige según lo
que hayas tocado:**

### ▶ Camino A — OTA (por wifi, sin cable)  ·  el 90 % de las veces

Para cambios que van **solo dentro de `src/`**: pantallas, CSS, JS, textos,
animaciones, audios de `src/audio/`, frases, lógica de una página.

```bash
npm run dev            # 1. haces el cambio en src/ y lo pruebas
npm run ota            # 2. publica: sube el bundle, zip a R2, avisa a Maite
git add -A && git commit -m "OTA bundle N — <qué cambia>"   # 3. guarda
```

En el móvil de Maite sale la tarjeta *"Hay novedades 🎶 · Actualizar"* al abrir
la app (o le llega notificación si está cerrada). Toca y en 2-3 s está.

Opciones de `npm run ota`:

| Comando | Efecto |
|---|---|
| `npm run ota` | sube la versión de parche (1.18 → 1.18.1) y el bundle interno |
| `npm run ota 1.20` | fija el nombre visible a `1.20` a mano |
| `npm run ota -- --nota "Arreglado el visor de partituras"` | texto que ve Maite en la tarjeta |
| `npm run ota -- --obligatoria` | se aplica sola, sin tarjeta |
| `npm run ota -- --forzar` | ignora la guardia de "cambio nativo" (ver abajo) |

El script **se niega a publicar** si detecta cambios en `package.json`,
`capacitor.config.json`, `scripts/android-fix.js` o `patches/` → eso es el
camino B.

Guía de montaje y detalle interno: **[docs/actualizaciones.md](docs/actualizaciones.md)**.

### ▶ Camino B — APK a mano  ·  solo para cambios nativos

Necesario cuando tocas:

- un **plugin de Capacitor** (instalar/actualizar/quitar → cambia `package.json`),
- `capacitor.config.json`, permisos de Android, `scripts/android-fix.js`, `patches/`,
- icono, splash, versión nativa, Capacitor/SDK.

```bash
npm run release        # sube versionCode/Name, sync, compila ChorApp-<v>.apk
```

Pasas el `.apk` al móvil y lo instalas encima (ver "Generar el APK firmado").
`npm run release` sube la versión menor (1.18.4 → **1.19**) y la escribe en
Gradle; el `versionCode` de Android es el mismo contador `bundle`.

### Versiones

`src/data/version.json` `{ bundle, nombre }` es la **única fuente**:

- **`bundle`** — contador interno, `+1` en *cada* `npm run ota` **y** cada
  `npm run release`. Es también el `versionCode` de Android. Nunca baja.
- **`nombre`** — la versión visible. `npm run ota` sube el 3.er número
  (`1.18` → `1.18.1` → `1.18.2`); `npm run release` sube el 2.º y limpia el
  parche (`1.18.2` → `1.19`). `npm run ota 1.20` lo fija a mano.

Así, mirando la versión sabes si hiciste falta reinstalar: `1.19` fue un APK,
`1.19.x` fueron OTAs sobre él. **Commitea siempre `version.json`.**

### Reglas rápidas

- ¿Editaste solo `.html` / `.css` / `.js` / textos dentro de `src/`? → **OTA**.
- ¿`npm install` de algo, o tocaste config/permisos/icono? → **APK**.
- Si una OTA sale mal: el panel del hijo tiene *"Volver a la versión anterior"*,
  y Capgo revierte solo si la app no arranca tras aplicarla.

---

## Poner en marcha el entorno

```bash
npm install --legacy-peer-deps      # (--legacy-peer-deps: el plugin media aún pide Capacitor 6)
npm run dev                          # http://localhost:5173  (probar en móvil 375–430px)
```

> `@capacitor-community/media` se quitó: su versión 7.0.1 no compila contra
> Capacitor 7 (`PluginCall.success()` ya no existe) y la app no lo necesita
> (archivos por IndexedDB en `archivos.js`, grabación por `MediaRecorder`).

Variable necesaria para compilar Android (una vez):

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```

---

## Añadir o editar canciones

Se hace **desde la propia app**, no tocando código:

1. Pestaña **Canciones** → botón **+**.
2. Título, compositor, estado y (opcional) notas y letra en texto.
3. **Archivos**: audio MP3, letra (PDF o `.txt`) y partitura (imagen o PDF).
   Se guardan en el dispositivo (IndexedDB en web, WebView en Android).
4. Tocar una canción abre el **Modo estudio**: reproductor, letra, partitura,
   fragmentos difíciles y notas de voz. Abrir el modo estudio registra la
   sesión en el calendario de **Práctica** automáticamente.

Los datos viven solo en el móvil. No hay backend ni copia en la nube.

---

## Estructura del código

| Carpeta / archivo | Qué es |
|---|---|
| `src/` | Código fuente (lo que se edita) |
| `src/index.html` | Shell: cabecera + `<main id="vista">` + bottom nav |
| `src/js/app.js` | Router mínimo: carga `pages/*.html` en `#vista` |
| `src/js/storage.js` | `window.Almacen` — wrapper de localStorage (clave/valor) |
| `src/js/archivos.js` | `window.Archivos` — blobs en IndexedDB (audio, PDF, imágenes, voz) |
| `src/js/canciones.js` | `window.Canciones` — modelo + CRUD de la biblioteca |
| `src/js/grabaciones.js` | `window.Grabaciones` — grabadora personal |
| `src/js/practica.js` | `window.Practica` — registro de sesiones y racha |
| `src/js/player.js` | `window.Reproductor` — audio del modo estudio |
| `src/js/recorder.js` | `window.Grabadora` — MediaRecorder (voz y grabaciones) |
| `src/js/calendar.js` | `window.Calendario` — rejilla mensual de práctica |
| `src/js/pages/*.js` | Un módulo por pantalla: `window.Pagina_<archivo>.iniciar(cont, datos)` |
| `src/css/styles.css` | Paleta Bihotsak en `:root` + sistema de movimiento |
| `www/` | Generado por `npm run build` (copia de `src/`). **No editar.** |
| `android/` | Generado por Capacitor. **No editar** salvo config nativa. |

Los `<script>` se cargan como **clásicos** (no módulos ES): cada archivo
expone un global. Es lo más robusto para el WebView de Android.

Convenciones: código y comentarios en español; colores siempre por variable
CSS; animar solo `transform` y `opacity`; respetar `prefers-reduced-motion`.

---

## Generar el APK firmado (release)

`appId`: `com.chorapp.ama` · `appName`: `ChorApp` (ver `capacitor.config.json`).

### 1. Crear el keystore — SOLO LA PRIMERA VEZ

En la carpeta del proyecto (donde está `package.json`):

```bash
keytool -genkey -v -keystore chorapp.jks -alias chorapp \
  -keyalg RSA -keysize 2048 -validity 10000
```

(`keytool` viene con el JDK. Si "no se reconoce", usa la ruta completa:
`"C:\Program Files\Java\jdk-21\bin\keytool.exe"` o la que corresponda.)

Te pedirá:
- **Contraseña del keystore** → invéntala y **apúntala**.
- Nombre, organización, etc. → puedes dejarlo casi todo en blanco (Enter).
- **Contraseña de la clave** `chorapp` → Enter para usar la misma.

Genera `chorapp.jks` en la carpeta. **Guarda ese archivo y las dos
contraseñas en un sitio seguro** (gestor de contraseñas + copia en la nube).
Sin ellos, Android no aceptará futuras actualizaciones como la misma app.

### 2. Configurar las credenciales — SOLO LA PRIMERA VEZ

```bash
cp keystore.properties.ejemplo keystore.properties
```

Edita `keystore.properties` con tus contraseñas reales. Ese archivo está en
`.gitignore`, nunca se sube.

### 3. Compilar (cada versión) — un solo comando

```bash
npm run release            # 1.3 -> 1.4 (sube el último número)
npm run release 2.0        # fija versionName = 2.0
npm run release -- --code  # solo sube versionCode, deja el nombre
```

Hace todo: sube `versionCode` (+1) y `versionName` en `android/app/build.gradle`,
`npm run sync`, `gradlew assembleRelease`, y copia el resultado a
**`ChorApp-<versión>.apk`** en la raíz. Si `ANDROID_HOME` / `JAVA_HOME` no
están definidos, prueba rutas habituales de Windows.

<details><summary>A mano, si hiciera falta</summary>

```bash
# subir versionCode y versionName en android/app/build.gradle
npm run sync
cd android && ./gradlew assembleRelease      # Windows: .\gradlew.bat assembleRelease
# APK en android/app/build/outputs/apk/release/app-release.apk
```
</details>

### 4. Instalar en el móvil

Pasa el `.apk` al teléfono (cable, Drive, Telegram…). En el móvil: activar
"Instalar apps desconocidas" para esa app y tocar el archivo. Se instala
encima de la versión anterior y **conserva todos los datos** (mismo keystore).

> `android/` está en `.gitignore`: si algún día rehaces `npx cap add android`,
> vuelve a aplicar el bloque `signingConfigs` de `app/build.gradle` (está más
> abajo en este archivo) y recrea `colors.xml` (ver sección del icono).

---

## Icono y splash (Fase 9)

Fuentes en `resources/` (el corazón de clave de sol + clave de fa de Bihotsak):

| Archivo | Qué es |
|---|---|
| `icon.png` | 1024² — icono cuadrado heredado: símbolo crema sobre cobalto |
| `icon-foreground.png` | 1024² con transparencia — capa delantera del icono adaptativo |
| `icon-background.png` | 1024² — cobalto liso `#1512D6` (capa de fondo) |
| `splash.png` / `splash-dark.png` | 2732² — símbolo cobalto centrado sobre crema |
| `logo.svg` | boceto vectorial de referencia |

Regenerar los recursos nativos (tras cambiar cualquier PNG):

```bash
npm i -D @capacitor/assets --legacy-peer-deps      # solo la primera vez
npx capacitor-assets generate --android \
  --iconBackgroundColor "#1512D6" --iconBackgroundColorDark "#1512D6" \
  --splashBackgroundColor "#F8F5EC" --splashBackgroundColorDark "#F8F5EC"
```

**Después, dos retoques manuales en `android/`** (se pierden si se rehace
`npx cap add android`, no si solo se hace `cap sync`):

1. `android/app/src/main/res/values/colors.xml` — crear si falta:
   `colorPrimary #1512D6`, `colorPrimaryDark #0E0B9E`, `colorAccent #1512D6`.
2. `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` y
   `ic_launcher_round.xml` — poner el fondo como color sin `inset`:
   ```xml
   <background android:drawable="@color/ic_launcher_background" />
   ```
   y en `values/ic_launcher_background.xml` el color `#1512D6`.

---

## Publicar cambios en el móvil

Ver **"Publicar una versión nueva"** al principio de este archivo: camino A
(OTA por wifi, `npm run ota`) para cambios de `src/`, camino B
(`npm run release` + APK) para cambios nativos.

`npm run sync` (build + `cap sync`) solo hace falta suelto si vas a abrir
Android Studio a mano; los dos comandos de arriba ya lo llaman.

---

## Apéndice: bloque de firma de `android/app/build.gradle`

Si hay que rehacer la plataforma Android, vuelve a añadir esto (arriba del
bloque `android { }` el primer trozo, y dentro de `android { }` el segundo):

```gradle
def keystorePropsFile = rootProject.file("../keystore.properties")
def keystoreProps = new Properties()
if (keystorePropsFile.exists()) {
    keystoreProps.load(new FileInputStream(keystorePropsFile))
}
```

```gradle
    signingConfigs {
        release {
            if (keystorePropsFile.exists()) {
                storeFile rootProject.file("../" + keystoreProps['storeFile'])
                storePassword keystoreProps['storePassword']
                keyAlias keystoreProps['keyAlias']
                keyPassword keystoreProps['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            // ...lo que ya había...
            if (keystorePropsFile.exists()) {
                signingConfig signingConfigs.release
            }
        }
    }
```
