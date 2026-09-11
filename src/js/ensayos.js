/* ============================================================
   ensayos.js — Días fijos de ensayo semanal del coro.

   Maite elige qué días de la semana suele tener ensayo (p. ej.
   martes y jueves). Con eso: 1) el calendario de Práctica bordea
   esos días, y 2) el día que toque, Práctica sugiere un repaso
   rápido de las canciones más flojas antes de ir al ensayo.

   También puede marcar "pausas" (vacaciones, semanas sin coro…):
   mientras dura una pausa, esos días dejan de contar como ensayo
   aunque caigan en el día de la semana configurado.

   Formato en Almacen:
   - 'ensayos:dias'   → array de nº de día (0 = Lunes … 6 = Domingo,
                        igual que calendar.js).
   - 'ensayos:pausas' → array de { id, desde, hasta, nota } (ISO).
   ============================================================ */

window.Ensayos = (function () {
  'use strict';

  var CLAVE = 'ensayos:dias';
  var CLAVE_PAUSAS = 'ensayos:pausas';
  var NOMBRES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var ABREV = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  // Por defecto (antes de que Maite lo configure a mano): martes y miércoles.
  var DIAS_POR_DEFECTO = [1, 2];

  function hoyISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function dias() {
    var r = window.Almacen.leer(CLAVE, null);
    if (r == null) return DIAS_POR_DEFECTO.slice();
    if (!Array.isArray(r)) return [];
    return r.filter(function (n) { return Number.isInteger(n) && n >= 0 && n <= 6; }).sort();
  }

  function guardarDias(arr) {
    var limpio = (arr || []).filter(function (n) { return Number.isInteger(n) && n >= 0 && n <= 6; }).sort();
    window.Almacen.guardar(CLAVE, limpio);
    return limpio;
  }

  // Día de la semana de hoy, en el mismo formato (0 = Lunes … 6 = Domingo).
  function diaSemanaHoy() {
    return (new Date().getDay() + 6) % 7;
  }

  function hayConfigurado() { return dias().length > 0; }

  /* --- Pausas (vacaciones, sin coro…) ---------------------------- */

  function _valida(p) {
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p.desde) && /^\d{4}-\d{2}-\d{2}$/.test(p.hasta) && p.desde <= p.hasta;
  }

  function listarPausas() {
    var r = window.Almacen.leer(CLAVE_PAUSAS, []);
    if (!Array.isArray(r)) return [];
    return r.filter(_valida).sort(function (a, b) { return a.desde < b.desde ? -1 : 1; });
  }

  function guardarPausa(p) {
    if (!_valida(p)) return null;
    var lista = listarPausas();
    var id = p.id || ('pausa-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    var registro = { id: id, desde: p.desde, hasta: p.hasta, nota: (p.nota || '').trim() };
    var i = lista.findIndex(function (x) { return x.id === id; });
    if (i === -1) lista.push(registro); else lista[i] = registro;
    window.Almacen.guardar(CLAVE_PAUSAS, lista);
    return registro;
  }

  function borrarPausa(id) {
    var lista = listarPausas().filter(function (p) { return p.id !== id; });
    window.Almacen.guardar(CLAVE_PAUSAS, lista);
  }

  // ¿Cae `iso` dentro de alguna pausa guardada?
  function enPausa(iso) {
    if (!iso) return false;
    return listarPausas().some(function (p) { return iso >= p.desde && iso <= p.hasta; });
  }

  function esHoyEnsayo() {
    var d = dias();
    return d.length > 0 && d.indexOf(diaSemanaHoy()) !== -1 && !enPausa(hoyISO());
  }

  // Texto corto tipo "martes y jueves" para mostrar en la UI.
  function textoResumen() {
    var d = dias();
    if (!d.length) return '';
    var nombres = d.map(function (n) { return NOMBRES[n].toLowerCase(); });
    if (nombres.length === 1) return nombres[0];
    return nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1];
  }

  return {
    NOMBRES: NOMBRES,
    ABREV: ABREV,
    dias: dias,
    guardarDias: guardarDias,
    hayConfigurado: hayConfigurado,
    esHoyEnsayo: esHoyEnsayo,
    diaSemanaHoy: diaSemanaHoy,
    textoResumen: textoResumen,
    hoyISO: hoyISO,
    listarPausas: listarPausas,
    guardarPausa: guardarPausa,
    borrarPausa: borrarPausa,
    enPausa: enPausa,
  };
})();
