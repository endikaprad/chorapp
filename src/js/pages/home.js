/* ============================================================
   Pagina_home — Inicio (resumen del repertorio)
   ============================================================ */

window.Pagina_home = (function () {
  'use strict';

  function iniciar(contenedor) {
    var raiz = contenedor.querySelector('[data-modulo="home"]');
    if (!raiz) return;

    var canciones = window.Canciones ? window.Canciones.listar() : [];
    var total = canciones.length;

    raiz.querySelector('[data-num-canciones]').textContent = String(total);

    var card = raiz.querySelector('[data-continuar]');
    var eyebrow = raiz.querySelector('[data-continuar-eyebrow]');
    var titulo = raiz.querySelector('[data-continuar-titulo]');
    var vacio = raiz.querySelector('[data-vacio]');

    if (total === 0) {
      card.disabled = true;
      return;
    }

    // Última canción tocada por la usuaria (por ahora: la más reciente).
    var ultima = canciones.slice().sort(function (a, b) {
      return (b.actualizada || 0) - (a.actualizada || 0);
    })[0];

    card.disabled = false;
    eyebrow.textContent = total === 1 ? 'Tu canción' : 'Seguir estudiando';
    titulo.textContent = ultima.titulo;
    if (vacio) vacio.hidden = true;

    card.addEventListener('click', function () {
      // Fase 5: abrirá el Modo estudio de esta canción.
      window.App.ir('canciones');
    });
  }

  return { iniciar: iniciar };
})();
