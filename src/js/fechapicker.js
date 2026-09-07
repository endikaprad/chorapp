/* ============================================================
   fechapicker.js — window.FechaPicker

   Selector de fecha propio, con la estética de la app (el
   <input type="date"> del navegador es feo e inconsistente).
   Pensado para elegir el día de un ensayo: casi siempre es hoy
   o ayer, así que esos van primero; "Otro día" abre un
   calendario mensual. No permite fechas futuras.

   Uso:
     var fp = window.FechaPicker.montar(contenedor, {
       valor: '2026-09-05',        // ISO, opcional (por defecto hoy)
       onCambio: function (iso) {},
       maxHoy: true                // no dejar elegir días futuros
     });
     fp.valor();      // -> 'YYYY-MM-DD'
     fp.fijar(iso);
     fp.destruir();
   ============================================================ */

window.FechaPicker = (function () {
  'use strict';

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  function iso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function deISO(s) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
  }
  function mismaFecha(a, b) { return a && b && iso(a) === iso(b); }

  function textoLargo(d) {
    try {
      var t = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) {
      return d.getDate() + ' de ' + MESES[d.getMonth()];
    }
  }

  function montar(contenedor, opts) {
    opts = opts || {};
    var maxHoy = opts.maxHoy !== false;

    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);

    var sel = deISO(opts.valor) || new Date(hoy);
    sel.setHours(0, 0, 0, 0);
    if (maxHoy && sel > hoy) sel = new Date(hoy);

    var vistaAnio = sel.getFullYear();
    var vistaMes = sel.getMonth();

    contenedor.classList.add('fpk');
    contenedor.innerHTML =
      '<p class="fpk__resumen" data-resumen></p>' +
      '<div class="fpk__rapidos">' +
        '<button type="button" class="fpk__rap" data-rap="hoy">Hoy</button>' +
        '<button type="button" class="fpk__rap" data-rap="ayer">Ayer</button>' +
        '<button type="button" class="fpk__rap fpk__rap--otro" data-rap="otro">' +
          'Otro día' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="fpk__cal" data-cal hidden>' +
        '<div class="cal__cab">' +
          '<button class="cal__nav" type="button" data-prev aria-label="Mes anterior">‹</button>' +
          '<span class="cal__mes" data-mes></span>' +
          '<button class="cal__nav" type="button" data-next aria-label="Mes siguiente">›</button>' +
        '</div>' +
        '<div class="cal__semana">' + DIAS.map(function (d) { return '<span>' + d + '</span>'; }).join('') + '</div>' +
        '<div class="cal__grid" data-grid></div>' +
      '</div>';

    var elResumen = contenedor.querySelector('[data-resumen]');
    var elCal = contenedor.querySelector('[data-cal]');
    var elMes = contenedor.querySelector('[data-mes]');
    var elGrid = contenedor.querySelector('[data-grid]');
    var raps = contenedor.querySelectorAll('[data-rap]');

    function fijar(d, abrirCalNo) {
      d = new Date(d); d.setHours(0, 0, 0, 0);
      if (maxHoy && d > hoy) d = new Date(hoy);
      sel = d;
      vistaAnio = d.getFullYear();
      vistaMes = d.getMonth();
      pintar();
      if (typeof opts.onCambio === 'function') opts.onCambio(iso(sel));
    }

    function pintarResumen() {
      elResumen.textContent = textoLargo(sel);
    }

    function pintarRapidos() {
      raps.forEach(function (b) {
        var k = b.getAttribute('data-rap');
        var activo =
          (k === 'hoy' && mismaFecha(sel, hoy)) ||
          (k === 'ayer' && mismaFecha(sel, ayer));
        b.classList.toggle('is-activa', activo);
      });
      contenedor.querySelector('[data-rap="otro"]')
        .classList.toggle('is-activa', !elCal.hidden);
    }

    function pintarGrid() {
      elMes.textContent = MESES[vistaMes].charAt(0).toUpperCase() + MESES[vistaMes].slice(1) + ' ' + vistaAnio;

      var primero = (new Date(vistaAnio, vistaMes, 1).getDay() + 6) % 7;
      var total = new Date(vistaAnio, vistaMes + 1, 0).getDate();

      elGrid.innerHTML = '';
      for (var i = 0; i < primero; i++) {
        var v = document.createElement('span');
        v.className = 'cal__dia cal__dia--vacio';
        elGrid.appendChild(v);
      }
      for (var dia = 1; dia <= total; dia++) {
        var fecha = new Date(vistaAnio, vistaMes, dia);
        var futuro = maxHoy && fecha > hoy;
        var cel = document.createElement('button');
        cel.type = 'button';
        cel.className = 'cal__dia fpk__dia';
        cel.textContent = String(dia);
        if (mismaFecha(fecha, sel)) cel.classList.add('fpk__dia--sel');
        if (mismaFecha(fecha, hoy)) cel.classList.add('cal__dia--hoy');
        if (futuro) { cel.classList.add('fpk__dia--off'); cel.disabled = true; }
        else {
          (function (f) {
            cel.addEventListener('click', function () { fijar(f); });
          })(fecha);
        }
        elGrid.appendChild(cel);
      }
    }

    function pintar() {
      pintarResumen();
      pintarRapidos();
      pintarGrid();
    }

    contenedor.querySelector('[data-prev]').addEventListener('click', function () {
      vistaMes--; if (vistaMes < 0) { vistaMes = 11; vistaAnio--; } pintarGrid();
    });
    contenedor.querySelector('[data-next]').addEventListener('click', function () {
      if (maxHoy && vistaAnio === hoy.getFullYear() && vistaMes >= hoy.getMonth()) return;
      vistaMes++; if (vistaMes > 11) { vistaMes = 0; vistaAnio++; } pintarGrid();
    });

    raps.forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-rap');
        if (k === 'hoy') { elCal.hidden = true; fijar(hoy); }
        else if (k === 'ayer') { elCal.hidden = true; fijar(ayer); }
        else {
          elCal.hidden = !elCal.hidden;
          if (!elCal.hidden) { vistaAnio = sel.getFullYear(); vistaMes = sel.getMonth(); pintarGrid(); }
          pintarRapidos();
        }
      });
    });

    // Si arranca en un día que no es hoy ni ayer, mostrar ya el calendario.
    if (!mismaFecha(sel, hoy) && !mismaFecha(sel, ayer)) elCal.hidden = false;
    pintar();

    return {
      valor: function () { return iso(sel); },
      fijar: function (s) { var d = deISO(s); if (d) fijar(d); },
      destruir: function () { contenedor.innerHTML = ''; contenedor.classList.remove('fpk'); },
    };
  }

  return { montar: montar };
})();
