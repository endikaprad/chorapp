# Panel privado de ChorApp

Canal privado **tú → Maite**: lanzar avisos cortos en su pantalla y bloquear
la app durante X minutos. Ella no ve ni tiene acceso a este panel.

Los **avisos** y el **bloqueo** funcionan solo mientras Maite tiene la app
abierta (la app consulta el servidor cada ~10 s).

Para **notificaciones con la app cerrada** hay un canal aparte por push (FCM):
ver [`../worker/README.md`](../worker/README.md). Es opcional; si no lo montas,
"Notificación al móvil" se comporta como los avisos.

---

## Cómo funciona

- **Firebase Realtime Database** hace de buzón en la nube (gratis, sin servidor propio).
- El panel (`panel/index.html`) **escribe** en `/control` — requiere login, solo tú.
- La app de Maite (`src/js/control-remoto.js`) **lee** `/control` cada 10 s y
  reacciona: muestra el aviso o pone la pantalla de pausa.
- La app escribe de vuelta en `/status` (última vez abierta, si está bloqueada)
  para que veas el estado desde el panel.
- La app también sube a **`/status/resumen`** un resumen de cómo va Maite
  (`src/js/progreso.js`, máx. 1 vez cada 6 h): racha, días del mes, canciones
  aprendidas, logros, grabaciones, último estudio y el resumen del mes anterior.
  El panel lo muestra en la sección **"Cómo va Maite"**. No hace falta tocar
  las reglas: `/status` ya es escribible por la app y solo lo lees tú.

---

## Puesta en marcha (una vez, ~10 min)

### 1. Crear el proyecto Firebase
1. <https://console.firebase.google.com> → **Agregar proyecto** (nombre: `chorapp`).
   Puedes desactivar Google Analytics.

### 2. Realtime Database
1. Menú **Compilación → Realtime Database → Crear base de datos**.
2. Región: **Europa (europe-west1)**. Empezar en **modo bloqueado**.
3. Copia la **URL** que aparece arriba (algo como
   `https://chorapp-xxxx-default-rtdb.europe-west1.firebasedatabase.app`).
4. Pestaña **Reglas** → pega el contenido de [`../database.rules.json`](../database.rules.json)
   y **Publicar** (o despliégalas con la CLI, ver más abajo):

```json
{
  "rules": {
    "control": {
      ".read": true,
      ".write": "auth != null"
    },
    "status": {
      ".read": "auth != null",
      ".write": true
    }
  }
}
```

> `control` lo lee cualquiera (solo contiene el texto del aviso y la hora de fin
> del bloqueo — nada sensible) pero solo tú, autenticado, puedes escribirlo.
> `status` (incluido `/status/resumen`, lo que hace Maite) solo lo puedes leer tú.
> Estas reglas viven en `database.rules.json` en la raíz del repo, así que
> `firebase deploy` (o `firebase deploy --only database`) las mantiene al día.

### 3. Autenticación (tu cuenta del panel)
1. **Compilación → Authentication → Comenzar**.
2. **Sign-in method → Correo electrónico/contraseña → Habilitar** (solo la primera opción) → Guardar.
3. Pestaña **Users → Agregar usuario**: tu correo y una contraseña. Apúntala.

### 4. Clave de API web
1. Rueda dentada ⚙️ → **Configuración del proyecto → General**.
2. Copia **Clave de API web** (`AIza…`).

### 5. Rellenar la configuración

Copia `panel/config.local.js.ejemplo` a **`panel/config.local.js`** (no se versiona) y rellena:
```js
window.FIREBASE = {
  apiKey: "AIza...",                                   // paso 4
  dbUrl: "https://chorapp-xxxx-default-rtdb.europe-west1.firebasedatabase.app"  // paso 2, sin barra final
};
```
`config.local.js` debe desplegarse junto a `index.html` (Firebase Hosting lo sube solo).

**`src/data/control.json`** (solo la URL, la app no necesita la clave):
```json
{
  "dbUrl": "https://chorapp-xxxx-default-rtdb.europe-west1.firebasedatabase.app",
  "segundosSondeo": 10,
  "ventanaAvisoHoras": 6
}
```

### 6. Publicar el cambio en la app de Maite
```
npm run sync
```
Luego genera el APK como siempre y vuelve a instalarlo en su móvil.

### 7. Tener el panel a mano en tu móvil
El panel es un único archivo. Opciones:

- **Firebase Hosting** (mismo proyecto, gratis):
  `npm i -g firebase-tools` → `firebase login` → `firebase deploy`.
  El `firebase.json` del repo ya está configurado (hosting = carpeta `panel`,
  reglas de la base de datos = `database.rules.json`), así que `firebase deploy`
  sube el panel **y** publica las reglas de la RTDB de una vez. Te da una URL;
  guárdala en favoritos del móvil.
  (Si es la primera vez y `firebase-tools` pide `firebase init`, elige
  Hosting + Realtime Database y **no** sobrescribas `firebase.json` ni
  `database.rules.json`.)
- **Netlify Drop** (<https://app.netlify.com/drop>): arrastra la carpeta `panel`.
- **En local**: abre `panel/index.html` en el navegador del móvil (por ejemplo
  compartiéndolo por tu almacenamiento en la nube). El login sigue protegiéndolo.

---

## Uso diario

1. Abre el panel, entra con tu correo y contraseña (se recuerda la sesión).
2. **Avisos rápidos**: un toque y aparece en la pantalla de Maite en ~10 s.
   Ella tiene que pulsar "Entendido" para cerrarlo (así sabes que lo ha visto).
3. **Aviso personalizado**: escribe cualquier mensaje corto.
4. **Bloquear la app**: elige minutos (o escribe los que quieras). Maite ve una
   pantalla de "Pausa de estudio" con cuenta atrás; la app vuelve sola al
   terminar. "Desbloquear ahora" la libera antes.
5. **Estado**: cuándo abrió la app por última vez y si está bloqueada.

Para cambiar los mensajes predefinidos, edita las listas `AVISOS` y
`BLOQUEOS_MIN` al principio del `<script>` de `panel/index.html`.

---

## Nota

Esto bloquea la herramienta de estudio de Maite y le muestra mensajes que no
puede desactivar. Que ella sepa que el panel existe: si no, puede pensar que la
app falla sola. La idea es que sea algo cómplice entre vosotros, no una sorpresa.
