/* ============================================================
   tema.js — Modo claro / oscuro de ChorApp.

   Tres modos, que se ciclan al pulsar el botón de la cabecera:
     'auto'   → sigue el ajuste del móvil (claro u oscuro).  [por defecto]
     'claro'  → siempre claro, ignora el ajuste del móvil.
     'oscuro' → siempre oscuro, ignora el ajuste del móvil.

   El modo se guarda en localStorage y se aplica antes de pintar
   nada (este script va en el <head> conceptual: se carga primero).

   Implementación: se escribe el atributo data-theme en <html>.
     - 'auto'   → se quita el atributo (manda @media prefers-color-scheme).
     - 'claro'  → data-theme="light"
     - 'oscuro' → data-theme="dark"
   styles.css ya contempla los tres casos.
   ============================================================ */

window.Tema = (function () {
  'use strict';

  var CLAVE = 'chorapp:tema';
  var MODOS = ['auto', 'claro', 'oscuro'];

  // Color de la barra de estado del sistema para cada fondo.
  var COLOR_CLARO = '#FBF8F3';
  var COLOR_OSCURO = '#12100E';

  var mqOscuro = window.matchMedia('(prefers-color-scheme: dark)');

  function leerModo() {
    try {
      var v = localStorage.getItem(CLAVE);
      return MODOS.indexOf(v) >= 0 ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function guardarModo(modo) {
    try { localStorage.setItem(CLAVE, modo); } catch (e) {}
  }

  // ¿Se ve oscuro ahora mismo, según el modo elegido?
  function oscuroEfectivo(modo) {
    if (modo === 'oscuro') return true;
    if (modo === 'claro') return false;
    return mqOscuro.matches;
  }

  function aplicar(modo) {
    var raiz = document.documentElement;
    // Siempre se escribe data-theme explícito (light|dark), incluso en 'auto'.
    // Antes, 'auto' quitaba el atributo y confiaba en @media
    // (prefers-color-scheme); pero algunos WebView de Android (Samsung) NO
    // propagan esa media query al contenido y encima le aplican su propio
    // "modo oscuro forzado", que oscurece los fondos sólidos pero deja los
    // degradados claros → la app se ve a medio pintar. Con data-theme
    // explícito manda el selector [data-theme="..."], que sí funciona
    // siempre, y las @media siguen coincidiendo cuando el sistema las honra.
    var oscuro = oscuroEfectivo(modo);
    raiz.setAttribute('data-theme', oscuro ? 'dark' : 'light');

    // theme-color: que la barra de estado acompañe al fondo real.
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', oscuro ? COLOR_OSCURO : COLOR_CLARO);
    });

    if (window.BarraEstado && typeof window.BarraEstado.sincronizar === 'function') {
      window.BarraEstado.sincronizar(oscuro);
    }
  }

  /* ----------------------------------------------------------
     Iconos del botón — estilo de línea, a juego con el nav.
     ---------------------------------------------------------- */
  function icono(modo) {
    var abre = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    if (modo === 'claro') {
      // Sol
      return abre +
        '<circle cx="12" cy="12" r="4.2"/>' +
        '<path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4' +
        'M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
    }
    if (modo === 'oscuro') {
      // Luna
      return abre + '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.2 6.2 0 0 0 9.5 9.5Z"/></svg>';
    }
    // 'auto' — círculo con media luna sombreada (sigue al sistema)
    return abre +
      '<circle cx="12" cy="12" r="8.5"/>' +
      '<path class="tema-auto-arco" d="M12 3.5a8.5 8.5 0 0 0 0 17Z" fill="currentColor" stroke="none"/>' +
      '</svg>';
  }

  var ETIQUETA = {
    auto: 'Tema: automático (sigue el móvil). Toca para fijar claro.',
    claro: 'Tema: claro. Toca para fijar oscuro.',
    oscuro: 'Tema: oscuro. Toca para volver a automático.'
  };

  function pintarBoton(btn, modo) {
    btn.innerHTML = icono(modo);
    btn.setAttribute('aria-label', ETIQUETA[modo]);
    btn.setAttribute('title', ETIQUETA[modo]);
  }

  var modoActual = leerModo();
  // Aplica cuanto antes para evitar destello del tema equivocado.
  aplicar(modoActual);

  function siguiente() {
    var i = MODOS.indexOf(modoActual);
    modoActual = MODOS[(i + 1) % MODOS.length];
    guardarModo(modoActual);
    aplicar(modoActual);
    var btn = document.getElementById('btn-tema');
    if (btn) pintarBoton(btn, modoActual);
  }

  // Si el modo es 'auto', reaccionar a los cambios del sistema.
  var alCambiarSistema = function () {
    if (modoActual === 'auto') aplicar('auto');
  };
  if (mqOscuro.addEventListener) mqOscuro.addEventListener('change', alCambiarSistema);
  else if (mqOscuro.addListener) mqOscuro.addListener(alCambiarSistema);

  function conectarBoton() {
    var btn = document.getElementById('btn-tema');
    if (!btn) return;
    pintarBoton(btn, modoActual);
    btn.addEventListener('click', siguiente);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', conectarBoton);
  } else {
    conectarBoton();
  }

  return {
    modo: function () { return modoActual; },
    ciclar: siguiente
  };
})();
