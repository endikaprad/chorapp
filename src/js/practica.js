/* ============================================================
   practica.js — Registro de sesiones de estudio.

   Capa de datos que se rellena SOLA al abrir el modo estudio
   (Fase 5). La vista de calendario y las estadísticas completas
   se construyen sobre esto en la Fase 6 (calendar.js).

   Formato en Almacen ('practica'):
     { "2026-09-02": ["c-abc…", "c-def…"], ... }   // ids de canción por día
   ============================================================ */

window.Practica = (function () {
  'use strict';

  var CLAVE = 'practica';

  function hoyISO(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function leer() {
    var r = window.Almacen.leer(CLAVE, {});
    return (r && typeof r === 'object') ? r : {};
  }

  // Registra que hoy se ha estudiado `cancionId`. Idempotente por día.
  function registrar(cancionId) {
    var reg = leer();
    var clave = hoyISO();
    var lista = Array.isArray(reg[clave]) ? reg[clave] : [];
    if (cancionId && lista.indexOf(cancionId) === -1) lista.push(cancionId);
    reg[clave] = lista;
    window.Almacen.guardar(CLAVE, reg);
    return reg;
  }

  function diasPracticados() {
    return Object.keys(leer());
  }

  // Racha de días consecutivos que termina hoy o ayer.
  function racha() {
    var dias = {};
    diasPracticados().forEach(function (d) { dias[d] = true; });
    var cursor = new Date();
    // Si hoy aún no se ha estudiado, la racha puede venir de ayer.
    if (!dias[hoyISO(cursor)]) cursor.setDate(cursor.getDate() - 1);
    var n = 0;
    while (dias[hoyISO(cursor)]) {
      n++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return n;
  }

  // Nº de canciones distintas estudiadas en los últimos 7 días.
  function cancionesSemana() {
    var reg = leer();
    var limite = new Date();
    limite.setDate(limite.getDate() - 6);
    var vistas = {};
    Object.keys(reg).forEach(function (d) {
      if (d >= hoyISO(limite)) {
        (reg[d] || []).forEach(function (id) { vistas[id] = true; });
      }
    });
    return Object.keys(vistas).length;
  }

  return {
    hoyISO: hoyISO,
    leer: leer,
    registrar: registrar,
    diasPracticados: diasPracticados,
    racha: racha,
    cancionesSemana: cancionesSemana,
  };
})();
