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

    contenedor.querySelector('[data-prev]').addEventListener('click', function () {
      vistaMes--; if (vistaMes < 0) { vistaMes = 11; vistaAnio--; } pintar();
    });
    contenedor.querySelector('[data-next]').addEventListener('click', function () {
      vistaMes++; if (vistaMes > 11) { vistaMes = 0; vistaAnio++; } pintar();
    });

    function pintar() {
      elMes.textContent = MESES[vistaMes] + ' ' + vistaAnio;

      // Lunes = 0 … Domingo = 6
      var primero = (new Date(vistaAnio, vistaMes, 1).getDay() + 6) % 7;
      var totalDias = new Date(vistaAnio, vistaMes + 1, 0).getDate();

      var celdas = '';
      for (var i = 0; i < primero; i++) celdas += '<span class="cal__dia cal__dia--vacio"></span>';
      for (var d = 1; d <= totalDias; d++) {
        var clave = iso(vistaAnio, vistaMes, d);
        var clases = 'cal__dia';
        if (practicados[clave]) clases += ' cal__dia--hecho';
        if (clave === isoHoy) clases += ' cal__dia--hoy';
        if (clave > isoHoy) clases += ' cal__dia--futuro';
        celdas += '<span class="' + clases + '">' + d + '</span>';
      }
      elGrid.innerHTML = celdas;

      // Animación de "sello" escalonada solo para los días practicados.
      var hechos = elGrid.querySelectorAll('.cal__dia--hecho');
      Array.prototype.forEach.call(hechos, function (el, n) {
        el.style.animationDelay = (n * 35) + 'ms';
      });

      if (opts.onMes) opts.onMes(iso(vistaAnio, vistaMes, 1));
    }

    pintar();
    return { pintar: pintar };
  }

  return { crear: crear };
})();
