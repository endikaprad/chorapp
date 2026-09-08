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
  // Escudos de racha (estilo Duolingo, pero amable): cubren UN día sin
  // estudiar para que la racha no se rompa. Se gana uno por cada 7 días
  // seguidos, con un máximo de 2 guardados.
  var CLAVE_ESCUDOS = 'racha:escudos';
  var MAX_ESCUDOS = 2;

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

  /* --- Escudos de racha ---------------------------------------- */

  function leerEscudos() {
    var e = window.Almacen.leer(CLAVE_ESCUDOS, {});
    if (!e || typeof e !== 'object') e = {};
    e.saldo = Math.max(0, Math.min(MAX_ESCUDOS, Math.round(e.saldo || 0)));
    e.hitoConcedido = Math.max(0, Math.round(e.hitoConcedido || 0));
    if (!e.gastados || typeof e.gastados !== 'object') e.gastados = {};
    return e;
  }
  function guardarEscudos(e) { window.Almacen.guardar(CLAVE_ESCUDOS, e); }

  // Nº de escudos disponibles ahora mismo.
  function escudos() { return leerEscudos().saldo; }

  // Días que un escudo ha "tapado" (no se estudió, pero cuentan para la racha).
  function _diasTapados() { return leerEscudos().gastados; }

  function _ayerISO() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return hoyISO(d);
  }

  /* Mantenimiento diario de la racha. Se llama al abrir Inicio o Práctica:
     1) si ayer no se estudió y había una racha viva, gasta un escudo para
        salvarla; 2) concede un escudo nuevo al llegar a cada múltiplo de 7. */
  function revisar() {
    var e = leerEscudos();
    var reg = leer();
    var hechoReal = {};
    Object.keys(reg).forEach(function (d) {
      if (Array.isArray(reg[d]) && reg[d].length) hechoReal[d] = true;
    });
    var hecho = function (iso) { return hechoReal[iso] || !!e.gastados[iso]; };

    var ayer = _ayerISO();
    var anteayer = new Date();
    anteayer.setDate(anteayer.getDate() - 2);
    var anteayerISO = hoyISO(anteayer);

    var cambiado = false;
    // Salvar la racha: ayer sin estudiar, pero anteayer sí -> gasta escudo.
    if (!hecho(ayer) && hecho(anteayerISO) && e.saldo > 0) {
      e.gastados[ayer] = true;
      e.saldo -= 1;
      cambiado = true;
    }

    // Conceder escudos por hitos de 7 días (una sola vez por hito).
    var n = _rachaCon(hechoReal, e.gastados);
    var hito = n - (n % 7);
    if (hito >= 7 && hito > e.hitoConcedido) {
      e.saldo = Math.min(MAX_ESCUDOS, e.saldo + 1);
      e.hitoConcedido = hito;
      cambiado = true;
    }
    if (cambiado) guardarEscudos(e);
  }

  // Racha consecutiva contando días estudiados o tapados por un escudo.
  function _rachaCon(hechoReal, tapados) {
    var hecho = function (iso) { return hechoReal[iso] || !!tapados[iso]; };
    var cursor = new Date();
    if (!hecho(hoyISO(cursor))) cursor.setDate(cursor.getDate() - 1);
    var n = 0;
    while (hecho(hoyISO(cursor))) {
      n++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return n;
  }

  // Racha de días consecutivos que termina hoy o ayer.
  function racha() {
    var reg = leer();
    var hechoReal = {};
    Object.keys(reg).forEach(function (d) {
      if (Array.isArray(reg[d]) && reg[d].length) hechoReal[d] = true;
    });
    return _rachaCon(hechoReal, _diasTapados());
  }

  /* Todo lo que la pantalla de racha necesita de un vistazo. */
  function rachaInfo() {
    var reg = leer();
    var hoy = hoyISO();
    var hoyHecho = Array.isArray(reg[hoy]) && reg[hoy].length > 0;
    var n = racha();
    var tapados = _diasTapados();

    // Tira de la semana (lunes a domingo).
    var d0 = new Date();
    var lunes = new Date(d0);
    lunes.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
    var NOMBRES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    var semana = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      var iso = hoyISO(d);
      semana.push({
        nombre: NOMBRES[i],
        iso: iso,
        hecho: (Array.isArray(reg[iso]) && reg[iso].length > 0),
        escudo: !!tapados[iso],
        hoy: iso === hoy,
        futuro: iso > hoy,
      });
    }

    return {
      dias: n,
      hoyHecho: hoyHecho,
      enPeligro: n > 0 && !hoyHecho,           // hay racha viva pero hoy pende
      mejor: mejorRacha(),
      escudos: escudos(),
      escudoAyer: !!tapados[_ayerISO()],
      semana: semana,
    };
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

  // Rango de la mejor racha: { dias, ini, fin } (o null si no hay).
  // Cuenta días estudiados o tapados por un escudo, igual que racha().
  function mejorRachaRango() {
    var reg = leer();
    var tapados = _diasTapados();
    var set = {};
    Object.keys(reg).forEach(function (d) {
      if (Array.isArray(reg[d]) && reg[d].length) set[d] = true;
    });
    Object.keys(tapados).forEach(function (d) { set[d] = true; });
    var dias = Object.keys(set).sort();
    if (!dias.length) return null;

    var mejor = { dias: 1, ini: dias[0], fin: dias[0] };
    var iniAct = dias[0], nAct = 1;
    for (var i = 1; i < dias.length; i++) {
      var previo = new Date(dias[i - 1] + 'T00:00:00');
      previo.setDate(previo.getDate() + 1);
      if (hoyISO(previo) === dias[i]) {
        nAct++;
      } else {
        iniAct = dias[i];
        nAct = 1;
      }
      if (nAct > mejor.dias) mejor = { dias: nAct, ini: iniAct, fin: dias[i] };
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

  // Nº de canciones distintas estudiadas en todo el histórico.
  function cancionesDistintas() {
    var reg = leer();
    var vistas = {};
    Object.keys(reg).forEach(function (d) {
      (reg[d] || []).forEach(function (id) { if (id) vistas[id] = true; });
    });
    return Object.keys(vistas).length;
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
    rachaInfo: rachaInfo,
    revisar: revisar,
    escudos: escudos,
    mejorRacha: mejorRacha,
    mejorRachaRango: mejorRachaRango,
    sesionesTotales: sesionesTotales,
    cancionesDistintas: cancionesDistintas,
    curiosidades: curiosidades,
    cancionesSemana: cancionesSemana,
  };
})();
