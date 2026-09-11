/* ============================================================
   calendar.js — Calendario visual de días practicados (Fase 6).

   window.Calendario.crear(contenedor, opts) pinta un mes con
   navegación anterior/siguiente. Los días con práctica se
   rellenan con una animación de "sello"; el día de hoy late.

   opts.practicados : { "YYYY-MM-DD": true }  (o array de fechas)
   opts.onMes(iso)  : callback opcional al cambiar de mes
   ============================================================ */

window.Calendario = (function () {
  'use strict';

  var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  var DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  function iso(a, m, d) {
    return a + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function crear(contenedor, opts) {
    opts = opts || {};
    var practicados = opts.practicados || {};
    if (Array.isArray(practicados)) {
      var set = {};
      practicados.forEach(function (f) { set[f] = true; });
      practicados = set;
    }

    // Días con "algo que contar" (aunque no cuenten como práctica). Si se
    // pasa `onDia`, esos días y los practicados se vuelven pulsables.
    var conActividad = opts.conActividad || {};
    if (Array.isArray(conActividad)) {
      var setA = {};
      conActividad.forEach(function (f) { setA[f] = true; });
      conActividad = setA;
    }

    // Días de concierto del coro. Se pintan de otro color y son pulsables
    // aunque estén en el futuro (para consultar los detalles).
    var conciertos = opts.conciertos || {};
    if (Array.isArray(conciertos)) {
      var setC = {};
      conciertos.forEach(function (f) { setC[f] = true; });
      conciertos = setC;
    }

    // Días de la semana con ensayo fijo (0 = Lunes … 6 = Domingo). Se
    // bordean todos los días del mes que caen en esos días de semana,
    // salvo que `opts.enPausa(iso)` diga que ese día está en vacaciones
    // o sin coro.
    var diasEnsayo = opts.diasEnsayo || [];
    var enPausa = typeof opts.enPausa === 'function' ? opts.enPausa : function () { return false; };

    var hoy = new Date();
    var isoHoy = iso(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    var vistaAnio = hoy.getFullYear();
    var vistaMes = hoy.getMonth();

    contenedor.classList.add('cal');
    contenedor.innerHTML =
      '<div class="cal__cab">' +
        '<button class="cal__nav" type="button" data-prev aria-label="Mes anterior">‹</button>' +
        '<span class="cal__mes" data-mes></span>' +
        '<button class="cal__nav" type="button" data-next aria-label="Mes siguiente">›</button>' +
      '</div>' +
      '<div class="cal__semana">' + DIAS.map(function (d) {
        return '<span>' + d + '</span>';
      }).join('') + '</div>' +
      '<div class="cal__grid" data-grid></div>';

    var elMes = contenedor.querySelector('[data-mes]');
    var elGrid = contenedor.querySelector('[data-grid]');

    if (opts.onDia) {
      var abrir = function (el) {
        var iso = el && el.getAttribute('data-dia');
        if (iso) opts.onDia(iso);
      };
      elGrid.addEventListener('click', function (ev) {
        abrir(ev.target.closest('.cal__dia--abrible'));
      });
      elGrid.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var el = ev.target.closest && ev.target.closest('.cal__dia--abrible');
        if (el) { ev.preventDefault(); abrir(el); }
      });
    }

    contenedor.querySelector('[data-prev]').addEventListener('click', function () {
      vistaMes--; if (vistaMes < 0) { vistaMes = 11; vistaAnio--; } pintar(-1);
    });
    contenedor.querySelector('[data-next]').addEventListener('click', function () {
      vistaMes++; if (vistaMes > 11) { vistaMes = 0; vistaAnio++; } pintar(1);
    });

    function pintar(dir) {
      elMes.textContent = MESES[vistaMes] + ' ' + vistaAnio;

      // Lunes = 0 … Domingo = 6
      var primero = (new Date(vistaAnio, vistaMes, 1).getDay() + 6) % 7;
      var totalDias = new Date(vistaAnio, vistaMes + 1, 0).getDate();

      var celdas = '';
      for (var i = 0; i < primero; i++) celdas += '<span class="cal__dia cal__dia--vacio"></span>';
      for (var d = 1; d <= totalDias; d++) {
        var clave = iso(vistaAnio, vistaMes, d);
        var clases = 'cal__dia';
        var esConcierto = !!conciertos[clave];
        var diaSemana = (new Date(vistaAnio, vistaMes, d).getDay() + 6) % 7;
        var pulsable = !!opts.onDia && (esConcierto ||
                       (clave <= isoHoy && (practicados[clave] || conActividad[clave])));
        if (practicados[clave]) clases += ' cal__dia--hecho';
        if (diasEnsayo.indexOf(diaSemana) !== -1 && !enPausa(clave)) clases += ' cal__dia--ensayo';
        if (enPausa(clave)) clases += ' cal__dia--pausa';
        if (esConcierto) clases += ' cal__dia--concierto';
        if (clave === isoHoy) clases += ' cal__dia--hoy';
        if (clave > isoHoy && !esConcierto) clases += ' cal__dia--futuro';
        if (pulsable) clases += ' cal__dia--abrible';
        var etq = esConcierto
          ? 'Ver el concierto del ' + d
          : 'Ver lo que hiciste el ' + d;
        celdas += '<span class="' + clases + '"' +
          (pulsable ? ' role="button" tabindex="0" data-dia="' + clave + '"' +
            ' aria-label="' + etq + '"' : '') +
          '>' + d + '</span>';
      }
      elGrid.innerHTML = celdas;

      // Animación de "sello" escalonada solo para los días practicados.
      var hechos = elGrid.querySelectorAll('.cal__dia--hecho');
      Array.prototype.forEach.call(hechos, function (el, n) {
        el.style.animationDelay = (n * 35) + 'ms';
      });

      // Transición al cambiar de mes: desliza según la dirección.
      if (dir) {
        elGrid.style.animation = 'none';
        elMes.style.animation = 'none';
        /* forzar reflow para reiniciar la animación */
        void elGrid.offsetWidth;
        elGrid.style.animation = '';
        elMes.style.animation = '';
        elGrid.classList.remove('cal__grid--der', 'cal__grid--izq');
        elMes.classList.remove('cal__mes--der', 'cal__mes--izq');
        void elGrid.offsetWidth;
        elGrid.classList.add(dir > 0 ? 'cal__grid--der' : 'cal__grid--izq');
        elMes.classList.add(dir > 0 ? 'cal__mes--der' : 'cal__mes--izq');
      }

      if (opts.onMes) opts.onMes(iso(vistaAnio, vistaMes, 1));
    }

    pintar();
    return { pintar: pintar };
  }

  return { crear: crear };
})();
