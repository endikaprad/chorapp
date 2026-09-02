# Mantenimiento de ChorApp

Guía breve para el desarrollo continuo (añadir canciones, publicar el APK).
El uso diario de Maite **no necesita nada de esto**: ella solo abre la app.

---

## Poner en marcha el entorno

```bash
npm install --legacy-peer-deps      # (--legacy-peer-deps: el plugin media aún pide Capacitor 6)
npm run dev                          # http://localhost:5173  (probar en móvil 375–430px)
```

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

## Generar el APK

```bash
npm run android      # build + cap sync + abre Android Studio
```

En Android Studio:

- **APK de pruebas** (rápido, para instalar ya en el móvil de Maite):
  `Build > Build APK(s)`. Instalar activando "Instalar apps desconocidas".
- **APK firmado (release)** — Fase 9:
  1. `Build > Generate Signed Bundle / APK > APK`.
  2. *Create new…* keystore. **Guardar el archivo `.keystore` y sus
     contraseñas en un lugar seguro** (sin él no se pueden publicar
     actualizaciones que Android acepte como la misma app).
  3. Variant `release`, firmar y generar.

`appId`: `com.chorapp.mama` · `appName`: `ChorApp` (ver `capacitor.config.json`).

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

Después, recompilar el APK en Android Studio.
