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

    // Racha de días de estudio (practica.js).
    var racha = window.Practica ? window.Practica.racha() : 0;
    var elRacha = raiz.querySelector('[data-num-racha]');
    if (elRacha) elRacha.textContent = String(racha);
    var elRachaLabel = raiz.querySelector('[data-racha-label]');
    if (elRachaLabel) elRachaLabel.textContent = racha === 1 ? 'día seguido' : 'días seguidos';

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
      window.App.ir('estudio', { datos: { id: ultima.id } });
    });
  }

  return { iniciar: iniciar };
})();
