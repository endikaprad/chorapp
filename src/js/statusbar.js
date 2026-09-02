/* ============================================================
   statusbar.js — Ajusta la barra de estado de Android.
   La app dibuja bajo la barra (overlaysWebView), así que aquí
   solo fijamos el color de los iconos según el tema:
   - tema claro  -> iconos oscuros  (style LIGHT)
   - tema oscuro -> iconos claros   (style DARK)
   Sin efecto en navegador; solo corre dentro del APK.

   tema.js llama a BarraEstado.sincronizar(oscuro) cuando la
   usuaria cambia el modo desde el botón de la cabecera.
   ============================================================ */
(function () {
  'use strict';

  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function plugin() {
    var Cap = window.Capacitor;
    if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return null;
    return (Cap.Plugins && Cap.Plugins.StatusBar) || null;
  }

  function sincronizar(oscuro) {
    var SB = plugin();
    if (!SB) return;
    SB.setStyle({ style: oscuro ? 'DARK' : 'LIGHT' });
    if (SB.setBackgroundColor) {
      SB.setBackgroundColor({ color: oscuro ? '#12100E' : '#FBF8F3' });
    }
  }

  window.BarraEstado = { sincronizar: sincronizar };

  // Estado inicial (por si tema.js aún no ha corrido) y cambios del
  // sistema mientras el modo sea 'auto' — tema.js reenvía el resto.
  sincronizar(mq.matches);
  mq.addEventListener('change', function () {
    if (!window.Tema || window.Tema.modo() === 'auto') sincronizar(mq.matches);
  });
})();
