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
  var FLUSH_MS = 30000;      // cada cuánto se vuelca a Almacen lo acumulado en memoria

  var ultimo = null;
  var intervalId = null;
  var pendienteMs = 0;       // milisegundos acumulados desde el último volcado a storage
  var pendienteISO = null;   // día al que pertenece pendienteMs

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

  function flush() {
    if (!pendienteMs || !pendienteISO) return;
    try {
      var reg = _leer();
      reg[pendienteISO] = (reg[pendienteISO] || 0) + pendienteMs / 1000;
      _guardar(reg);
      pendienteMs = 0;
      pendienteISO = null;
    } catch (e) {
      if (window.console) console.warn('Tiempo: no se pudo guardar', e);
    }
  }

  function sumar(ms) {
    if (!(ms > 0)) return;
    var iso = hoyISO();
    if (pendienteISO && pendienteISO !== iso) flush();   // cambió el día: vuelca lo anterior
    pendienteISO = iso;
    pendienteMs += ms;
    if (pendienteMs >= FLUSH_MS) flush();
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
      else { latido(); flush(); }
    });
    window.addEventListener('pagehide', function () { latido(); flush(); });
    window.addEventListener('beforeunload', function () { latido(); flush(); });
  }

  function segundosDe(iso) {
    var r = _leer();
    var total = r[iso] || 0;
    if (pendienteISO === iso) total += pendienteMs / 1000;
    return Math.round(total);
  }

  function segundosEntre(iniISO, finISO) {
    var r = _leer();
    var total = 0;
    Object.keys(r).forEach(function (k) {
      if (k >= iniISO && k <= finISO) total += (r[k] || 0);
    });
    if (pendienteISO && pendienteISO >= iniISO && pendienteISO <= finISO) total += pendienteMs / 1000;
    return Math.round(total);
  }

  function todos() {
    var r = _leer();
    if (pendienteISO) r[pendienteISO] = (r[pendienteISO] || 0) + pendienteMs / 1000;
    return r;
  }

  return {
    iniciar: iniciar,
    hoyISO: hoyISO,
    segundosDe: segundosDe,
    segundosEntre: segundosEntre,
    todos: todos,
  };
})();
