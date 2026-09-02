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

    pintarRepasar(raiz);

    // Calendario del mes.
    window.Calendario.crear(raiz.querySelector('[data-calendario]'), {
      practicados: dias,
    });

    pintarDatos(raiz);
  }

  /* ----------------------------------------------------------
     Curiosidades bajo el calendario — datitos que está bien
     saber, sin pretensión de panel de estadísticas.
     ---------------------------------------------------------- */
  function pintarDatos(raiz) {
    var ul = raiz.querySelector('[data-datos]');
    if (!ul || !window.Practica) return;

    var datos = window.Practica.curiosidades();
    if (!datos.length) return;

    ul.innerHTML = datos.map(function (t, i) {
      return '<li style="animation-delay:' + (i * 40) + 'ms">' + escapar(t) + '</li>';
    }).join('');
    ul.hidden = false;
  }

  /* ----------------------------------------------------------
     Fragmentos difíciles pendientes — invita a repasarlos.
     Solo cuentan las canciones que aún no están aprendidas.
     ---------------------------------------------------------- */
  function pintarRepasar(raiz) {
    var btn = raiz.querySelector('[data-repasar]');
    if (!btn || !window.Canciones) return;

    var conFrag = window.Canciones.listar().filter(function (c) {
      return c.estado !== 'aprendida' &&
             Array.isArray(c.fragmentos) && c.fragmentos.length > 0;
    }).sort(function (a, b) {
      return (b.actualizada || 0) - (a.actualizada || 0);
    });
    if (conFrag.length === 0) return;

    var trozos = conFrag.reduce(function (n, c) { return n + c.fragmentos.length; }, 0);
    var destino = conFrag[0];

    raiz.querySelector('[data-repasar-titulo]').textContent =
      trozos === 1 ? '1 trozo marcado como difícil' : trozos + ' trozos marcados como difíciles';
    raiz.querySelector('[data-repasar-nota]').textContent =
      conFrag.length === 1
        ? 'En «' + destino.titulo + '», esperándote'
        : 'En ' + conFrag.length + ' canciones, esperándote';

    btn.addEventListener('click', function () {
      window.App.ir('estudio', { datos: { id: destino.id } });
    });
    btn.hidden = false;
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
