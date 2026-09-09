# Actualizaciones por wifi (OTA) — ChorApp

Publicar cambios de la app **sin pasar el APK al móvil cada vez**. El zip con
el nuevo `www/` se sube a **Cloudflare R2**, la app de Maite lo detecta al
abrirse (o por notificación) y se actualiza sola en unos segundos.

```
Tu PC                         Cloudflare              Móvil de Maite
─────                         ──────────              ──────────────
npm run ota                                           al abrir la app / al recibir push
 ├─ build  src/ → www/                                  │
 ├─ zip    www/ → v42.zip ──► R2  chorapp-updates/       │  lee /updates/latest (Firebase)
 ├─ sha256                        bundles/v42.zip        │  ¿bundle 42 > el instalado?
 ├─ wrangler put ───────────►                            │      │ sí
 └─ POST /ota ──► Worker ──► Firebase /updates/latest    │      ▼
                        └──► push FCM ──────────────────►│  descarga v42.zip de R2
                                                         │  → aplica → recarga
                                                         │  (si no arranca → vuelve sola al anterior)
```

## Qué se puede actualizar así y qué no

**OTA sí** — todo lo que vive en `www/`: HTML, CSS, JS, imágenes, audios de
`src/audio/`, PDF.js, textos, animaciones, lógica de pantallas.

**OTA no** (sigue necesitando `npm run release` + pasar el APK a mano):

- Añadir/actualizar un plugin de Capacitor (cambia `package.json`).
- Cambios en `capacitor.config.json`, permisos de Android, `scripts/android-fix.js`, `patches/`.
- Icono, splash, subir versión nativa, Capacitor/SDK.

`npm run ota` **se niega a publicar** si detecta cambios en esos ficheros
(salvo `--forzar`, para cuando el cambio nativo ya está en un APK instalado).

---

## Montaje — SOLO LA PRIMERA VEZ (~15 min)

Ya tienes hecho el Worker de push (`worker/README.md`) y `npx wrangler login`.
Esto reutiliza los dos.

### 1. Crear el bucket de R2

1. [dash.cloudflare.com](https://dash.cloudflare.com) → menú lateral **R2**.
   La primera vez pide activar R2 (plan gratuito, sin tarjeta para el uso de
   esta app; si pide método de pago, R2 tiene 10 GB y 1 M escrituras al mes
   gratis y aquí no te acercas ni de lejos).
2. **Create bucket** → nombre `chorapp-updates` → **Create bucket**.
3. Dentro del bucket → pestaña **Settings** → **Public Development URL** →
   **Enable**. Copia la URL que aparece, tipo
   `https://pub-abc123def456.r2.dev`. Esa es tu `publicBase`.

> El dominio `r2.dev` tiene un límite de peticiones bajo, pero para una única
> usuaria descargando un zip de vez en cuando sobra. Si algún día quieres,
> puedes conectarle un dominio propio; no hace falta.

### 2. Comprobar que wrangler puede escribir en R2

`npx wrangler login` (el del Worker) ya da permiso de R2. Prueba:

```bash
cd worker
npx wrangler r2 bucket list
```

Debe listar `chorapp-updates`. Si dice que no tienes permiso, vuelve a
`npx wrangler login` y marca el permiso de R2.

### 3. Añadir la ruta `/ota` al Worker

El código ya está en `worker/src/index.js`. Solo hay que redesplegar:

```bash
cd worker
npx wrangler deploy
```

Usa los secretos que ya tiene (`SERVICE_ACCOUNT`, `PANEL_SECRET`, `DB_URL`).
No hay que añadir ninguno nuevo.

### 4. Reglas de la base de datos (Firebase)

La app lee `/updates/latest` **sin login** (igual que `/control`). En
[console.firebase.google.com](https://console.firebase.google.com) → proyecto
**chorapp** → **Realtime Database** → **Reglas**, asegúrate de que `updates`
es legible:

```json
{
  "rules": {
    "control":  { ".read": true, ".write": "auth != null" },
    "status":   { ".read": true, ".write": true },
    "updates":  { ".read": true, ".write": "auth != null" }
  }
}
```

(El Worker escribe con credenciales de admin, así que se salta las reglas; el
panel escribe autenticado.)

### 5. Config local del script

```bash
cp scripts/ota.local.json.ejemplo scripts/ota.local.json
```

Rellena `scripts/ota.local.json` (está en `.gitignore`):

```json
{
  "bucket": "chorapp-updates",
  "publicBase": "https://pub-abc123def456.r2.dev",
  "workerUrl": "https://chorapp-push.TU-SUBDOMINIO.workers.dev",
  "secret": "la-MISMA-frase-de-PANEL_SECRET"
}
```

### 6. Instalar el plugin y generar EL ÚLTIMO APK manual

```bash
npm install --legacy-peer-deps      # instala @capgo/capacitor-updater
npm run release
```

Pasa ese APK al móvil de Maite como siempre. **A partir de este, las
actualizaciones normales van por wifi.**

> Este APK lleva `src/data/version.json` con `bundle: 1`. Cada `npm run ota`
> sube ese número y lo commitea, así los APK que generes después nunca se
> creerán más viejos que la última OTA.

---

## Cada vez que quieras actualizar la app

1. **Haz tus cambios** en `src/` y pruébalos:

   ```bash
   npm run dev
   ```

2. **Publica la OTA:**

   ```bash
   npm run ota
   ```

   Opciones:

   ```bash
   npm run ota 1.18                               # además fija el nombre visible
   npm run ota -- --nota "Arreglado el visor de partituras"
   npm run ota -- --obligatoria                   # se aplica sin preguntar
   npm run ota -- --forzar                        # ignora el aviso de cambio nativo
   ```

   El comando hace, y se para si algo falla:

   - comprueba que no has tocado ficheros nativos;
   - sube `src/data/version.json` (bundle +1) y `npm run build`;
   - zipea `www/` → `dist/chorapp-v<N>.zip` + sha256;
   - `wrangler r2 object put` → sube el zip a R2;
   - `POST /ota` al Worker → escribe `/updates/latest` en Firebase y manda la
     notificación a Maite.

3. **En el móvil de Maite:** si tiene la app abierta le sale la tarjeta *"Hay
   novedades en ChorApp 🎶 · Actualizar"* en unos segundos; si no, le llega la
   notificación y la verá al abrir. Toca → 2-3 s → app recargada con lo nuevo.
   Si marcaste `--obligatoria`, se aplica sola.

4. **Guarda el código:**

   ```bash
   git add -A && git commit -m "OTA bundle <N>"
   ```

   (El zip de `dist/` no se versiona; el histórico son tus commits.)

### Desde el panel del hijo (sin PC)

En [el panel](../panel/index.html) → sección **Actualización de la app (OTA)**:

- ver qué bundle es el último publicado;
- editar la **nota** que ve Maite / marcarlo **obligatoria**;
- **Volver a la versión anterior** si algo salió mal (restaura el bundle
  previo; Maite lo recibe en la siguiente apertura).

Además, Capgo revierte **solo** al bundle anterior si la app no llega a
arrancar tras aplicar uno nuevo (`notifyAppReady`).

---

## Resolución de problemas

| Síntoma | Causa probable |
|---|---|
| `Falta scripts/ota.local.json` | No has hecho el paso 5 del montaje. |
| `wrangler ... no such bucket` | Nombre de bucket mal en `ota.local.json`, o falta el paso 1. |
| El Worker responde 401 | `secret` de `ota.local.json` ≠ `PANEL_SECRET` del Worker. |
| El Worker responde 500 `SERVICE_ACCOUNT` | Redespliega el Worker (paso 3). |
| La app no ve la actualización | Reglas de Firebase (paso 4): `/updates` sin `.read: true`. |
| La app descarga pero no aplica | Mira el logcat del móvil; suele ser el zip mal formado (el `index.html` debe estar en la raíz del zip — `Compress-Archive` lo hace bien). |
| `npm run ota` dice "cambios nativos" | Tienes cambios en `package.json`/`capacitor.config.json`. Si van en el zip web y ya están en un APK instalado: `--forzar`. Si no: `npm run release`. |

Logs del Worker en vivo: `cd worker && npx wrangler tail`.

Probar la tarjeta en el móvil sin publicar nada: en la consola del WebView
(`chrome://inspect`), `window.OTA.simularBanner()`.
