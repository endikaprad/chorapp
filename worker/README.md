# Worker de push — ChorApp

Envía notificaciones a Maite **aunque tenga la app cerrada**, usando Firebase
Cloud Messaging (FCM). El panel llama a este Worker y el Worker habla con FCM.

Todo es **gratis**: FCM no cobra y esto entra de sobra en el plan gratuito de
Cloudflare Workers (100.000 peticiones/día; aquí harás unas pocas al mes).

```
Panel  ──POST {title,body}──▶  Worker  ──▶  FCM  ──▶  móvil de Maite
                                  │
                                  └── lee /status/fcmToken de la RTDB
```

---

## Puesta en marcha (una vez, ~15 min)

### 1. Activar Cloud Messaging en Firebase
1. <https://console.firebase.google.com> → proyecto **chorapp**.
2. Rueda ⚙️ → **Configuración del proyecto → Cloud Messaging**. Si aparece
   "Firebase Cloud Messaging API (V1)" como **Habilitada**, listo. Si no, pulsa
   para habilitarla (te lleva a Google Cloud → **Habilitar**).

### 2. `google-services.json` (para el APK)
1. **Configuración del proyecto → General → Tus apps**.
2. Si no hay una app Android: **Agregar app → Android**.
   - Nombre del paquete: `com.chorapp.mama` (el `appId` de `capacitor.config.json`).
   - El resto puedes dejarlo vacío. Registrar.
3. **Descarga `google-services.json`** y guárdalo en la carpeta **`resources/`**
   del proyecto (junto a `icon.png`). No se versiona; `scripts/android-fix.js`
   lo copia a Android en cada `npm run sync`.

### 3. Service account (para el Worker)
1. **Configuración del proyecto → Cuentas de servicio**.
2. **Generar nueva clave privada** → se descarga un JSON (`chorapp-...json`).
   Guárdalo bien: **es un secreto de verdad**, da acceso de admin al proyecto.

### 4. Desplegar el Worker
```bash
cd worker
npm install
npx wrangler login          # abre el navegador, entra en tu cuenta Cloudflare
```

Edita `wrangler.toml` si tu `DB_URL` no coincide (debe ser la de
`src/data/control.json`).

Carga los dos secretos:
```bash
npx wrangler secret put SERVICE_ACCOUNT
# pega TODO el contenido del JSON del paso 3 y Enter

npx wrangler secret put PANEL_SECRET
# inventa una frase larga, p. ej.:  bihotsak-2026-una-frase-larga-y-rara
```

Despliega:
```bash
npx wrangler deploy
```
Te da una URL tipo `https://chorapp-push.TU-SUBDOMINIO.workers.dev`. Cópiala.

### 5. Conectar el panel
En **`panel/config.local.js`** (el que se despliega con el panel):
```js
window.PUSH = {
  workerUrl: "https://chorapp-push.TU-SUBDOMINIO.workers.dev",
  secret: "bihotsak-2026-una-frase-larga-y-rara"   // la MISMA del paso 4
};
```
Vuelve a desplegar el panel (Firebase Hosting / Netlify).

### 6. Actualizar la app de Maite
```bash
npm install          # instala @capacitor/push-notifications
npm run sync
```
Genera el APK y reinstálalo en su móvil. **La primera vez que abra la app**,
Android le pedirá permiso de notificaciones (di que sí) y se guarda su token.

---

## Probar

1. Con la app de Maite abierta al menos una vez (para que suba el token),
   ciérrala del todo (deslízala de recientes).
2. Desde el panel → **Notificación al móvil** → escribe algo → Enviar.
3. Debe aparecer en su móvil en 1–5 s.

Si el panel dice *"aún no hay token del móvil"*: la app no ha llegado a
registrarse. Ábrela, espera 5 s, y reintenta.

Logs del Worker en vivo:
```bash
npx wrangler tail
```

---

## Tarjeta "Del coro" (Instagram) — ruta `GET /coro`

El mismo Worker sirve la última publicación de Instagram del coro para la
pantalla de Inicio. **Instagram bloquea (401) las peticiones directas tanto
desde el móvil como desde Cloudflare**, así que el Worker lee un *feed JSON*
del perfil público generado con **RSS.app** (gratis), lo normaliza y lo
cachea 30 min.

### Montarlo

1. **Crear el feed en RSS.app**
   - Entra en <https://rss.app> y crea una cuenta gratis.
   - *New Feed* → pega `https://www.instagram.com/bihotsak/` → *Generate*.
   - Abre el feed creado → pestaña **API / JSON** → copia la **URL del JSON**
     (algo como `https://rss.app/feeds/v1.1/XXXXXXXX.json`).

2. **Dársela al Worker** (es un secreto, no va en `wrangler.toml`):
   ```bash
   cd worker
   npx wrangler secret put CORO_FEED_URL
   # pega la URL del JSON y Enter
   npx wrangler deploy
   ```

3. **Conectar la app**: en **`src/data/coro.json`** pon la URL del Worker
   (sin barra final) en `worker`:
   ```json
   { "worker": "https://chorapp-push.bihotsak-coro.workers.dev", ... }
   ```

4. `npm run sync`, regenera el APK y reinstala.

Probar: `https://chorapp-push.bihotsak-coro.workers.dev/coro?handle=bihotsak`
debe devolver un JSON con `imagen`, `texto`, `fecha`, `enlace`. Si da
`{"error":"instagram no respondió"}` revisa `CORO_FEED_URL`.

> Plan gratis de RSS.app: el feed se refresca cada pocas horas, suficiente
> para esta tarjeta. Si el perfil del coro cambia de nombre, regenera el feed.

---

## Ojo con el ahorro de batería (Xiaomi, Huawei, Samsung, Oppo…)

Algunas capas de Android matan la app y bloquean las push si no la marcas como
**"sin restricciones"** de batería. En el móvil de Maite:

*Ajustes → Aplicaciones → ChorApp → Batería → Sin restricciones* (el nombre
exacto varía). Hazlo al instalar el APK.
