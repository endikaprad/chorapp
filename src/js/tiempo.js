/* ============================================================
   tiempo.js — Minutos reales que Maite pasa con la app abierta.

   Late cada pocos segundos mientras la pestaña está visible y suma el
   hueco desde el último latido al día de hoy. Si el hueco es muy largo
   (pantalla bloqueada, cambio de app, el móvil se durmió) no se cuenta:
   evita que un "olvidado con la app abierta" infle las cifras.

   Formato en Almacen ('tiempo'): { "YYYY-MM-DD": segundos, ... }

   window.Tiempo.iniciar()                 -> arranca el latido (una vez, en app.js)
   window.Tiempo.segundosDe(iso)           -> segundos de un día
   window.Tiempo.segundosEntre(iniISO, finISO) -> suma en un rango [ini, fin] inclusive
   window.Tiempo.todos()                   -> { iso: segundos }
   ============================================================ */

window.Tiempo = (function () {
  'use strict';

  var CLAVE = 'tiempo';
  var INTERVALO_MS = 5000;   // frecuencia del latido mientras está visible
  var TOPE_GAP_MS = 30000;   // huecos mayores que esto no cuentan como estudio activo

  var ultimo = null;
  var intervalId = null;

  function hoyISO(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function _leer() {
    var r = window.Almacen.leer(CLAVE, {});
    return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
  }
  function _guardar(reg) { window.Almacen.guardar(CLAVE, reg); }

  function sumar(ms) {
    if (!(ms > 0)) return;
    try {
      var reg = _leer();
      var iso = hoyISO();
      reg[iso] = (reg[iso] || 0) + ms / 1000;
      _guardar(reg);
    } catch (e) {
      if (window.console) console.warn('Tiempo: no se pudo guardar', e);
    }
  }

  function latido() {
    var ahora = Date.now();
    if (ultimo != null && document.visibilityState === 'visible') {
      var gap = ahora - ultimo;
      if (gap > 0 && gap <= TOPE_GAP_MS) sumar(gap);
    }
    ultimo = ahora;
  }

  function iniciar() {
    if (intervalId || !window.Almacen) return;   // ya arrancado
    ultimo = Date.now();
    intervalId = setInterval(latido, INTERVALO_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') ultimo = Date.now();
      else latido();
    });
    window.addEventListener('pagehide', latido);
    window.addEventListener('beforeunload', latido);
  }

  function segundosDe(iso) {
    var r = _leer();
    return Math.round(r[iso] || 0);
  }

  function segundosEntre(iniISO, finISO) {
    var r = _leer();
    var total = 0;
    Object.keys(r).forEach(function (k) {
      if (k >= iniISO && k <= finISO) total += (r[k] || 0);
    });
    return Math.round(total);
  }

  function todos() { return _leer(); }

  return {
    iniciar: iniciar,
    hoyISO: hoyISO,
    segundosDe: segundosDe,
    segundosEntre: segundosEntre,
    todos: todos,
  };
})();
