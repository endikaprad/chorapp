/* ============================================================
   statusbar.js — Ajusta la barra de estado de Android.
   La app dibuja bajo la barra (overlaysWebView), así que aquí
   solo fijamos el color de los iconos según el tema:
   - tema claro  -> iconos oscuros  (style LIGHT)
   - tema oscuro -> iconos claros   (style DARK)
   Sin efecto en navegador; solo corre dentro del APK.
   ============================================================ */
(function () {
  'use strict';

  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;

  var SB = Cap.Plugins && Cap.Plugins.StatusBar;
  if (!SB) return;

  var oscuro = window.matchMedia('(prefers-color-scheme: dark)');

  function aplicar() {
    SB.setStyle({ style: oscuro.matches ? 'DARK' : 'LIGHT' });
    if (SB.setBackgroundColor) {
      SB.setBackgroundColor({ color: oscuro.matches ? '#12100E' : '#FBF8F3' });
    }
  }

  aplicar();
  oscuro.addEventListener('change', aplicar);
})();
