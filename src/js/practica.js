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

  // Racha más larga de días consecutivos en todo el histórico.
  function mejorRacha() {
    var dias = diasPracticados().sort();
    if (!dias.length) return 0;
    var mejor = 1, actual = 1;
    for (var i = 1; i < dias.length; i++) {
      var previo = new Date(dias[i - 1] + 'T00:00:00');
      previo.setDate(previo.getDate() + 1);
      if (hoyISO(previo) === dias[i]) {
        actual++;
        if (actual > mejor) mejor = actual;
      } else {
        actual = 1;
      }
    }
    return mejor;
  }

  // Nº total de sesiones registradas (canción-día), en todo el histórico.
  function sesionesTotales() {
    var reg = leer();
    var n = 0;
    Object.keys(reg).forEach(function (d) {
      n += Array.isArray(reg[d]) ? reg[d].length : 0;
    });
    return n;
  }

  /* --- Curiosidades ---------------------------------------------
     Datitos sin pretensión de "estadística" para poner bajo el
     calendario: cosas que está bien saber. Cada una solo aparece
     si tiene sentido con los datos que hay. */
  var DIAS_SEMANA = ['los domingos', 'los lunes', 'los martes', 'los miércoles',
                     'los jueves', 'los viernes', 'los sábados'];
  var NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function curiosidades() {
    var reg = leer();
    var fechas = Object.keys(reg).sort();
    if (!fechas.length) return [];

    var lista = [];
    var total = fechas.length;

    // Día de la semana en que más practica.
    var porDia = [0, 0, 0, 0, 0, 0, 0];
    var porMes = {};
    var porCancion = {};
    fechas.forEach(function (f) {
      var d = new Date(f + 'T00:00:00');
      porDia[d.getDay()]++;
      var m = d.getMonth();
      porMes[m] = (porMes[m] || 0) + 1;
      (reg[f] || []).forEach(function (id) {
        porCancion[id] = (porCancion[id] || 0) + 1;
      });
    });

    if (total >= 4) {
      var maxDia = porDia.indexOf(Math.max.apply(null, porDia));
      lista.push({ ico: 'calendario', texto: 'Sueles estudiar sobre todo ' + DIAS_SEMANA[maxDia] });
    }

    var mejor = mejorRacha();
    if (mejor >= 3) {
      lista.push({ ico: 'racha', texto: 'Tu récord son ' + mejor + ' días seguidos sin fallar' });
    }

    // Días desde la primera sesión registrada.
    var primero = new Date(fechas[0] + 'T00:00:00');
    var diasDesde = Math.round((Date.now() - primero.getTime()) / 86400000);
    if (diasDesde >= 14) {
      lista.push({ ico: 'nota', texto: 'Llevas ' + total + ' días de estudio; empezaste hace ' + diasDesde + ' días' });
    } else {
      lista.push({ ico: 'nota', texto: 'Llevas ' + total + (total === 1 ? ' día' : ' días') + ' de estudio en total' });
    }

    // Mes más cantado (solo si destaca sobre el resto).
    var mesesOrden = Object.keys(porMes).sort(function (a, b) { return porMes[b] - porMes[a]; });
    if (mesesOrden.length >= 2 && porMes[mesesOrden[0]] >= porMes[mesesOrden[1]] + 2) {
      lista.push({ ico: 'mes', texto: capitalizar(NOMBRE_MES[mesesOrden[0]]) + ' ha sido tu mes más cantado' });
    }

    // Canción a la que más veces has vuelto.
    var idsOrden = Object.keys(porCancion).sort(function (a, b) { return porCancion[b] - porCancion[a]; });
    if (idsOrden.length && porCancion[idsOrden[0]] >= 3 && window.Canciones) {
      var c = window.Canciones.obtener(idsOrden[0]);
      if (c) lista.push({ ico: 'estrella', texto: '«' + c.titulo + '» es la que más has trabajado (' + porCancion[idsOrden[0]] + ' veces)' });
    }

    // Constancia sobre el tiempo transcurrido.
    if (diasDesde >= 10) {
      var deCada7 = Math.round((total / (diasDesde + 1)) * 7);
      if (deCada7 >= 1 && deCada7 <= 6) {
        lista.push({ ico: 'constancia', texto: 'De media practicas ' + deCada7 + ' de cada 7 días' });
      }
    }

    return lista;
  }

  function capitalizar(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

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
    mejorRacha: mejorRacha,
    sesionesTotales: sesionesTotales,
    curiosidades: curiosidades,
    cancionesSemana: cancionesSemana,
  };
})();
