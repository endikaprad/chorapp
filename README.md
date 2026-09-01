# ChorApp

App de estudio para **Maite**, del coro **Bihotsak**. Regalo de cumpleaños.

Web vanilla (HTML/CSS/JS, sin framework ni bundler) empaquetada como APK de Android
con **Capacitor**. Ver `claude.md` para el contexto completo, la paleta y las fases.

## Desarrollo

```bash
npm run dev
```

Abre `http://localhost:5173` y usa la vista de móvil del navegador (375–430px de ancho).
El servidor sirve `src/` directamente; al guardar, recarga la página.

## Estructura

| Carpeta | Qué es |
|---|---|
| `src/` | Código fuente. **Es lo único que se edita.** |
| `src/index.html` | Shell: cabecera + `<main>` + navegación inferior |
| `src/css/styles.css` | Estilos globales. Paleta Bihotsak en `:root` |
| `src/js/app.js` | Router mínimo + navegación |
| `src/js/storage.js` | `window.Almacen` — persistencia (localStorage) |
| `src/js/player.js` · `calendar.js` · `recorder.js` | Stubs (Fases 5–7) |
| `src/pages/*.html` | Contenido de cada pantalla |
| `scripts/` | `dev.js` (servidor) y `build.js` (copia `src/` → `www/`) |
| `www/` | Generado. No editar. En `.gitignore`. |
| `android/` | Generado por Capacitor. En `.gitignore`. |

Los `<script>` se cargan como clásicos (no módulos): cada archivo expone un global.

## Empaquetar como APK (a partir de la Fase 2)

```bash
npm run build          # copia src/ -> www/
npx cap add android    # solo la primera vez
npm run sync           # build + npx cap sync
npm run android        # abre Android Studio
```

En Android Studio: **Build → Build APK(s)**. El APK sale en
`android/app/build/outputs/apk/`.

## Estado

- [x] Fase 1 — Andamiaje (shell, navegación, paleta, movimiento base)
- [ ] Fase 2 — Capacitor + plataforma Android
- [ ] Fase 3 — Datos y biblioteca de canciones
- [ ] Fases 4–10 — ver `claude.md`
