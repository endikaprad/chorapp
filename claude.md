# 🎵 ChorApp — App de estudio para coro (Regalo de cumpleaños)

## Contexto del proyecto

Aplicación web progresiva (PWA) diseñada como regalo de cumpleaños personalizado para una mujer que canta en un coro y estudia canciones casi todos los días. El objetivo es que sea su herramienta diaria de estudio: práctica, íntima y pensada exclusivamente para ella.

No es una app genérica de música. Es una app personal, con su nombre, su repertorio y su forma de estudiar.

---

## Stack técnico

- **Frontend:** HTML5, CSS3, JavaScript vanilla **sin framework ni bundler** — el desarrollador conoce bien este stack
- **Empaquetado:** [Capacitor](https://capacitorjs.com/) para generar el APK real instalable en Android. **No se usa el UI framework de Ionic**: el CLI moderno ya no tiene starter vanilla y sus web components añaden peso innecesario. La navegación, las transiciones y los componentes se hacen a mano (ver "Animaciones y movimiento"). `webDir` = `www/`, generado copiando `src/` con `npm run build`.
- **Almacenamiento:** localStorage / Capacitor Preferences para datos de progreso y notas. Los archivos (audio, PDF, imágenes) se gestionan con el plugin Capacitor Filesystem
- **Plugins nativos necesarios:**
  - `@capacitor/filesystem` — acceso a archivos del dispositivo
  - `@capacitor/preferences` — almacenamiento clave-valor persistente
  - `@capacitor-community/media` — acceso a galería/audio si es necesario
- **Tipo de app:** APK de Android real, instalable directamente sin pasar por Play Store
- **Requiere conexión:** Sí, siempre tiene datos. No es necesario soporte offline completo.
- **Backend:** No necesario. Todo funciona en local en el dispositivo.

### Flujo de desarrollo
1. `npm run dev` → servidor local en `http://localhost:5173` (sirve `src/`, sin build). Probar en navegador con vista móvil 375–430px.
2. `npm run build` → copia `src/` a `www/`.
3. `npx cap add android` (solo la primera vez) para añadir la plataforma.
4. `npm run sync` (= build + `npx cap sync`) para sincronizar los cambios web con Android.
5. `npm run android` abre el proyecto en Android Studio → generar APK → instalar en el móvil de Maite.

### Estructura real del proyecto
```
chorapp/
├── package.json          scripts dev / build / sync / android (sin dependencias)
├── capacitor.config.ts   (Fase 2)
├── scripts/
│   ├── dev.js            servidor de desarrollo (Node, sin deps)
│   └── build.js          copia src/ -> www/
├── src/                  código fuente (lo que se edita)
│   ├── index.html        shell: cabecera + <main> + bottom nav
│   ├── css/styles.css    paleta Bihotsak en :root + sistema de movimiento
│   ├── js/
│   │   ├── app.js        router mínimo (carga pages/*.html en #vista) + nav
│   │   ├── storage.js    window.Almacen — wrapper de localStorage
│   │   ├── player.js     Fase 5    calendar.js  Fase 6    recorder.js  Fase 7
│   └── pages/            home / songs / study / practice / recordings .html
├── www/                  generado por build.js — NO editar (en .gitignore)
└── android/              generado por Capacitor (en .gitignore)
```

> Los `<script>` se cargan como **clásicos** (no módulos ES): cada `js/*.js` expone un global (`window.Almacen`, `window.App`, …). Es lo más robusto para el WebView de Android. Cada página puede tener un módulo opcional `window.Pagina_<archivo>` con un método `iniciar(contenedor, datos)`.

---

## Usuarios

- **Único usuario:** Maite (la madre). Solo ella usa la app, no hay otros roles ni colaboradores.
- **Perfil:** Mujer mayor (no experta en tecnología), usa el móvil a diario. La interfaz debe ser clara, con texto legible, botones grandes y navegación sencilla.
- **Coro:** Bihotsak ("corazones" en euskera). El logo es un corazón formado por una clave de sol y una clave de fa.

---

## Funcionalidades principales

### 1. Biblioteca de canciones
- Lista de canciones del repertorio del coro
- Cada canción tiene:
  - Título y compositor
  - Estado: `Aprendida` / `En progreso` / `Pendiente`
  - Archivos adjuntos: audio MP3, letra (PDF o texto), partitura (imagen o PDF)
  - Notas personales por canción (texto libre)
  - Fragmentos marcados como "difíciles" con nota específica

### 2. Modo estudio (pantalla principal de cada canción)
- Reproductor de audio integrado con controles básicos: play/pause, retroceder 5s, velocidad (0.75x / 1x / 1.25x)
- Visualización de la letra (si está disponible en texto)
- Visualizador de partitura (imagen o PDF con zoom)
- Botón para grabar nota de voz rápida sobre ese momento del estudio
- Botón "Marcar fragmento difícil" con texto explicativo

### 3. Registro de práctica
- Calendario visual que muestra los días que ha practicado
- Al abrir una canción en modo estudio se registra automáticamente la sesión
- Estadísticas simples: racha actual de días, canciones practicadas esta semana

### 4. Grabadora personal
- Puede grabarse cantando directamente desde la app
- Las grabaciones se guardan por canción y fecha
- Puede reproducirlas y eliminarlas
- Útil para escucharse y mejorar

---

## Diseño y UI

### Estilo visual
- Diseño **minimalista y cálido** — no genérico, no de app de música comercial
- **Acento = azul cobalto del coro Bihotsak** sobre base cálida (crema), para que "sea del coro" sin sentirse fría ni tech
- Tipografía legible, máximo 2 fuentes, tamaño generoso (la usuaria no es joven)
- **Mobile-first obligatorio** — se diseña primero para pantalla de móvil (375–430px)

### Paleta de color (coro Bihotsak)

Colores extraídos del logo del coro (`images/bihotsak_logo.jpg`): azul cobalto `#1512D6`, negro `#070707`, blanco.

| Rol | Token CSS | Hex | Uso |
|---|---|---|---|
| Acento | `--color-acento` | `#1512D6` | botones, elemento activo del nav, racha, corazón del logo |
| Acento pulsado/hover | `--color-acento-oscuro` | `#0E0B9E` | estados presionados |
| Acento tenue (fondos) | `--color-acento-suave` | `#ECEBFB` | chips, resaltados, fondo de selección |
| Texto principal | `--color-texto` | `#1A1A1A` | como la clave de fa del logo |
| Texto secundario | `--color-texto-2` | `#6B6560` | metadatos, subtítulos |
| Fondo app | `--color-fondo` | `#FBF8F3` | crema cálido, nunca blanco clínico |
| Superficies / tarjetas | `--color-superficie` | `#FFFFFF` | |
| Borde sutil | `--color-borde` | `#E9E3DA` | |
| Estado "Aprendida" | `--estado-aprendida` | `#4C7A5A` | verde apagado |
| Estado "En progreso" | `--estado-progreso` | `#C98A2E` | ámbar |
| Estado "Pendiente" | `--estado-pendiente` | `#9A9490` | gris cálido |

- Definir todos los colores como variables CSS en `:root`. Nunca hardcodear hex en componentes.
- El azul cobalto es el color de acción: si algo es tocable/activo, lleva cobalto. El resto respira en crema y negro.

### Animaciones y movimiento

La app debe sentirse **moderna, fluida y viva** — sin caer en efectos genéricos de IA ni en parallax de scroll gratuito.

- **Transiciones entre pantallas:** deslizamiento horizontal (entra desde la derecha) al navegar dentro de una sección; fundido suave al cambiar de pestaña del bottom nav. Implementado con animaciones CSS sobre `.pantalla` en `styles.css`.
- **Curva y duración:** 200–280ms para transiciones de página, 150–180ms para microinteracciones. Curva `cubic-bezier(0.4, 0, 0.2, 1)` (ease-out estándar). Nada dura más de 320ms.
- **Microinteracciones obligatorias:**
  - Botones y tarjetas: escala a `0.97` al pulsar (`:active`), con rebote suave al soltar.
  - Bottom nav: el icono activo se agranda ligeramente y el color transiciona a cobalto; indicador que se desliza entre pestañas.
  - Play/pause del reproductor: transición morfológica entre iconos + pulso sutil del botón mientras suena.
  - Marcar "Aprendida" / completar racha: pequeña celebración (check animado, no confeti agresivo).
  - Añadir/eliminar canción o grabación: entrada con fade+slide, salida con collapse de altura.
- **Listas:** aparición escalonada (stagger de 30–40ms por elemento) al cargar una pantalla, solo la primera vez.
- **Calendario de práctica:** los días practicados se rellenan con una animación de "sello" al entrar en la vista; el día de hoy late suavemente.
- **Feedback de carga:** skeletons con shimmer, nunca spinners bruscos.
- **Respetar accesibilidad:** si `prefers-reduced-motion: reduce`, desactivar desplazamientos y escalados; mantener solo fundidos de opacidad ≤120ms.
- **Rendimiento:** animar solo `transform` y `opacity` (nunca `width`, `top`, `margin`). 60fps en un móvil de gama media. `will-change` con moderación.
- **Preferir CSS/Web Animations API.** Si hace falta una librería para orquestar secuencias, usar una ligera (p. ej. `motion` / Motion One, ~5KB) — nunca GSAP completo ni Lottie salvo para el check de celebración.

### Tono de la interfaz
- **Personal y cercano**, no corporativo
- El nombre de Maite debe aparecer en la app (ej: "Hola, Maite 🎶")
- Textos en español, claros, en voz activa
- Vacíos con dirección: si no hay canciones, decir "Añade tu primera canción para empezar"

### Navegación
- Bottom navigation bar (estilo móvil nativo): Inicio / Canciones / Práctica / Grabaciones
- Sin menús ocultos ni hamburguer menu si es posible

---

## Empaquetado como APK Android

- La app se genera con **Capacitor** (sin Ionic UI), produciendo un APK real instalable en Android
- Configurar `capacitor.config.ts` con el nombre de la app y el appId (ej: `com.chorapp.ama`)
- Icono personalizado en `resources/icon.png` — basado en el corazón/claves del logo de Bihotsak sobre fondo crema o cobalto, no genérico
- Splash screen configurado en `resources/splash.png`
- El APK final se instala directamente en el móvil de la madre (activar "Instalar apps desconocidas" en Android)

---

## Estructura de archivos

Ver "Estructura real del proyecto" en la sección **Stack técnico**. Además, en Fase 9:

```
resources/
├── icon.png     ← 1024x1024px  (basado en el logo de Bihotsak)
└── splash.png   ← 2732x2732px
```

---

## Lo que NO debe hacer esta app

- No debe parecer una app de Spotify ni de karaoke comercial
- No debe tener login, registro ni nada complejo
- No debe tener anuncios, notificaciones agresivas ni dark patterns
- No debe ser responsive solo en teoría — debe funcionar perfectamente en móvil real
- No debe usar librerías pesadas innecesarias

---

## Fases del proyecto

El desarrollo se organiza en fases incrementales. Cada fase deja la app funcionando y probable en navegador.

### Fase 0 — Requisitos previos ✅
Node.js, Capacitor CLI (`npx cap`), Android Studio + SDK, JDK 21. `ANDROID_HOME` definido.

### Fase 1 — Andamiaje del proyecto ✅
- Estructura `src/` + `scripts/` + `package.json` (scripts `dev` / `build` / `sync` / `android`, sin dependencias).
- `scripts/dev.js` (servidor local) y `scripts/build.js` (copia `src/` → `www/`).
- Shell: cabecera contextual "Hola, Maite 🎶", `<main>` para páginas, bottom nav con indicador deslizante (Inicio / Canciones / Práctica / Grabaciones).
- `js/app.js`: router mínimo que carga `pages/*.html`, gestiona cabecera, nav e historial (botón atrás).
- `js/storage.js`: `window.Almacen` sobre localStorage. Stubs de `player` / `recorder` / `calendar`.
- `css/styles.css`: paleta Bihotsak en `:root` + sistema de movimiento (curva, duraciones, stagger, `prefers-reduced-motion`).
- Páginas con estado vacío con dirección. Verificado en navegador (móvil 375px).
- `git init` + primer commit.

### Fase 2 — Capacitor y plataforma Android
- Instalar `@capacitor/core`, `@capacitor/android` y plugins: `@capacitor/filesystem`, `@capacitor/preferences`, `@capacitor-community/media`.
- `capacitor.config.ts` con `appId: com.chorapp.ama`, `appName: ChorApp`, `webDir: www`.
- `npx cap add android` + `npx cap sync`. Verificar que arranca en emulador/dispositivo.

### Fase 3 — Datos y biblioteca de canciones
- `storage.js`: capa de persistencia sobre Capacitor Preferences (fallback `localStorage`). Modelo de canción (título, compositor, estado, archivos, notas, fragmentos difíciles).
- Página **Canciones**: lista con estados, alta/edición/borrado, búsqueda simple.
- Estado vacío con dirección ("Añade tu primera canción para empezar").
- Página **Inicio**: saludo, canción del día / continuar estudiando, resumen de racha.

### Fase 4 — Gestión de archivos
- Importar audio MP3, letra (PDF/texto) y partitura (imagen/PDF) desde el dispositivo con `@capacitor/filesystem`.
- Almacenamiento organizado por canción. Fallback web con `File API` / `IndexedDB`.

### Fase 5 — Modo estudio
- `player.js`: reproductor de audio (play/pause, −5s, velocidad 0.75x/1x/1.25x).
- Visor de letra (texto) y de partitura (imagen/PDF con zoom).
- Botón "Marcar fragmento difícil" con nota específica.
- Nota de voz rápida sobre el momento de estudio.
- Al abrir el modo estudio se registra automáticamente la sesión de práctica.

### Fase 6 — Registro de práctica
- `calendar.js`: calendario visual de días practicados.
- Estadísticas: racha actual, canciones practicadas esta semana.
- Animación de "sello" al rellenar días; el día de hoy late.

### Fase 7 — Grabadora personal
- `recorder.js`: grabar cantando con `MediaRecorder`.
- Grabaciones guardadas por canción y fecha; reproducir y eliminar.

### Fase 8 — Pulido de movimiento y UI
- Transiciones de página, microinteracciones, stagger de listas, skeletons con shimmer.
- Revisión de accesibilidad (`prefers-reduced-motion`, tamaños táctiles, contraste).
- Rendimiento: 60fps en gama media, animar solo `transform`/`opacity`.

### Fase 9 — Identidad y empaquetado
- `resources/icon.png` (1024²) y `resources/splash.png` (2732²) basados en el logo de Bihotsak.
- Generar recursos nativos (`@capacitor/assets`).
- Generar APK firmado (release) en Android Studio con keystore propio (guardarlo).

### Fase 10 — Entrega
- Instalar el APK en el móvil de Maite.
- Cargar el repertorio real del coro.
- Guía breve de mantenimiento para añadir canciones en el futuro.

### Fase 11 — Actualizaciones por wifi (OTA) ✅
- `@capgo/capacitor-updater` en modo self-hosted (sin cuenta Capgo): el zip del
  nuevo `www/` se aloja en **Cloudflare R2** y la app lo aplica sola.
- `src/js/ota.js` (`window.OTA`): en cada arranque hace `notifyAppReady()`, lee
  `/updates/latest` de la RTDB (misma de `control.json`) y, si el `bundle` es
  mayor que el instalado, descarga y muestra una tarjeta (`.ota-banner`) o la
  aplica sola si es `obligatoria`. `src/data/version.json` = bundle de fábrica.
- `scripts/ota.js` (`npm run ota`): guardia de cambios nativos → build → zip →
  `wrangler r2 object put` → `POST /ota` al Worker. Config en
  `scripts/ota.local.json` (gitignore).
- Worker: ruta `POST /ota` escribe `/updates/latest` (+ `/updates/anterior`) y
  manda push a Maite. Panel: sección para ajustar nota/obligatoria y revertir.
- Guía: **`docs/actualizaciones.md`**. Solo para cambios de `www/`; los cambios
  nativos siguen necesitando `npm run release` + APK a mano.

---

## Entrega esperada

Una PWA funcional, instalable en móvil, que la madre pueda usar desde el primer día sin explicaciones. El código debe estar limpio, comentado en español y organizado para que el desarrollador (el hijo) pueda seguir añadiendo canciones y funciones fácilmente.

El regalo no es solo la app — es que cada vez que la abra, sienta que alguien la hizo pensando en ella.
