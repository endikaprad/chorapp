# Mantenimiento de ChorApp

Guía breve para el desarrollo continuo (añadir canciones, publicar el APK).
El uso diario de Maite **no necesita nada de esto**: ella solo abre la app.

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

`appId`: `com.chorapp.mama` · `appName`: `ChorApp` (ver `capacitor.config.json`).

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

## Publicar cambios de la web en Android

```bash
npm run sync        # build + cap sync
```

Después, recompilar el APK (paso 3 de "Generar el APK firmado").

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
