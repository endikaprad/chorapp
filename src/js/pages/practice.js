/* ============================================================
   Pagina_practice — Registro de práctica (Fase 6)
   Estadísticas (racha, canciones de la semana) + calendario.
   ============================================================ */

window.Pagina_practice = (function () {
  'use strict';

  function iniciar(contenedor) {
    var raiz = contenedor.querySelector('[data-modulo="practice"]');
    if (!raiz) return;

    var dias = window.Practica ? window.Practica.diasPracticados() : [];
    var racha = window.Practica ? window.Practica.racha() : 0;
    var semana = window.Practica ? window.Practica.cancionesSemana() : 0;

    var elRacha = raiz.querySelector('[data-racha]');
    var elRachaLabel = raiz.querySelector('[data-racha-label]');
    var elSemana = raiz.querySelector('[data-semana]');
    var elSemanaLabel = raiz.querySelector('[data-semana-label]');

    elRacha.textContent = String(racha);
    elRachaLabel.textContent = racha === 1 ? 'día seguido' : 'días seguidos';
    elSemana.textContent = String(semana);
    elSemanaLabel.textContent = semana === 1 ? 'canción esta semana' : 'canciones esta semana';

    raiz.querySelector('[data-vacio]').hidden = dias.length > 0;

    // Calendario del mes.
    window.Calendario.crear(raiz.querySelector('[data-calendario]'), {
      practicados: dias,
    });

    // Pie con el total acumulado.
    var pie = raiz.querySelector('[data-pie]');
    if (dias.length > 0) {
      raiz.querySelector('[data-pie-txt]').textContent =
        dias.length === 1
          ? 'Has estudiado 1 día. Sigue así 🎶'
          : 'Has estudiado ' + dias.length + ' días en total.';
      pie.hidden = false;
    }
  }

  return { iniciar: iniciar };
})();
