/* ============================================================
   resumenmes.js — Datos del "Resumen del mes".

   El resumen del mes ES el Wrapped a pantalla completa (js/wrapped.js):
   este módulo solo calcula los DATOS y decide CUÁNDO ofrecerlos.

   - Inicio: el día 1–12 sale solo el resumen del mes anterior (tono
     cabrón). En enero NO: el recap de diciembre lo absorbe el Wrapped
     anual del 31 de diciembre (tono cálido, es el regalo dentro del
     regalo).
   - Práctica: botón para reabrirlo. El mensual, los 5 días siguientes a
     que saliera. El anual dura mucho más: 30 días desde que se vio (y si
     no se llegó a ver, durante la ventana de captura 31 dic – 12 ene).

   Se calcula al vuelo desde Practica + Diario + Grabaciones + Logros +
   Conciertos. En Almacen solo se guarda qué se ha visto ya y cuándo
   ('resumenmes:visto', ':visto-cuando', ':anual-visto', ':anual-visto-cuando').

   window.ResumenMes.datosDe(anio, mes)      -> datos de un mes (0-11)
   window.ResumenMes.datosAnuales(anio)      -> datos del año (esAnual:true)
   window.ResumenMes.pendiente()             -> resumen del mes que sale solo en Inicio
   window.ResumenMes.anualPendiente()        -> Wrapped anual que sale solo (31 dic)
   window.ResumenMes.disponiblePractica()    -> lo que muestra el botón de Práctica
   window.ResumenMes.marcarVisto(a, m) / marcarAnualVisto(anio)
   ============================================================ */

window.ResumenMes = (function () {
  'use strict';

  var CLAVE_VISTO = 'resumenmes:visto';
  var CLAVE_CUANDO = 'resumenmes:visto-cuando';        // ISO del día en que salió
  var CLAVE_CUANDO_CLAVE = 'resumenmes:visto-cuando-de'; // a qué mes ("YYYY-MM") corresponde esa fecha
  var CLAVE_ANUAL_VISTO = 'resumenmes:anual-visto';     // año del último Wrapped anual visto
  var CLAVE_ANUAL_CUANDO = 'resumenmes:anual-visto-cuando'; // ISO del día en que se vio el anual
  var DIA_TOPE_AUTO = 12;   // pasado el día 12 ya no salta solo (sí desde Práctica)
  var DIAS_VENTANA_PRACTICA = 5;   // días que el botón MENSUAL sigue visible en Práctica tras salir
  var DIAS_VENTANA_ANUAL = 30;     // el Wrapped ANUAL dura mucho más: un mes desde que sale

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function _iso(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var x = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + x;
  }
  function claveMes(a, m) { return a + '-' + String(m + 1).padStart(2, '0'); }
  function nombreMes(m) { return MESES[m] || ''; }
  function capitaliza(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function mesAnterior(hoy) {
    hoy = hoy || new Date();
    var m = hoy.getMonth() - 1, a = hoy.getFullYear();
    if (m < 0) { m = 11; a--; }
    return { anio: a, mes: m };
  }

  // Racha más larga de días consecutivos DENTRO de un conjunto de ISOs.
  function _rachaMax(setISO) {
    var dias = Object.keys(setISO).sort();
    if (!dias.length) return 0;
    var mejor = 1, act = 1;
    for (var i = 1; i < dias.length; i++) {
      var prev = new Date(dias[i - 1] + 'T00:00:00');
      prev.setDate(prev.getDate() + 1);
      if (_iso(prev) === dias[i]) { act++; if (act > mejor) mejor = act; }
      else act = 1;
    }
    return mejor;
  }

  function _tituloCancion(id) {
    if (id && id.indexOf('marca:') !== 0 && window.Canciones) {
      var c = window.Canciones.obtener(id);
      if (c) return c.titulo;
    }
    return null;
  }

  /* Recorre día a día un rango de meses (mesIni..mesFin, ambos incluidos, 0-11)
     y devuelve los agregados en bruto. Lo comparten datosDe (un mes) y
     datosAnuales (los doce). */
  var DIAS_SEMANA = ['los domingos', 'los lunes', 'los martes', 'los miércoles',
                     'los jueves', 'los viernes', 'los sábados'];

  function _escanear(anio, mesIni, mesFin) {
    var reg = window.Practica && window.Practica.leer ? window.Practica.leer() : {};
    var diasSet = {};       // ISO -> true (días con estudio)
    var porCancion = {};    // id -> nº de días que aparece
    var titulos = {};       // id -> titulo
    var diasPorMes = {};    // mes 0-11 -> nº de días con estudio
    var porDiaSemana = [0, 0, 0, 0, 0, 0, 0];  // 0=domingo … 6=sábado
    var reproPorTitulo = {};  // titulo -> nº de veces al play
    var escuchas = 0, trozos = 0;
    var aprendidas = [], vistasAprend = {};

    // Suma 1 al contador de una canción (una vez por día, con `vistasHoy`).
    function apunta(vistasHoy, id, titulo) {
      if (!id || vistasHoy[id]) return;
      vistasHoy[id] = true;
      porCancion[id] = (porCancion[id] || 0) + 1;
      if (!titulos[id]) titulos[id] = titulo || _tituloCancion(id) || 'una canción';
    }

    for (var mes = mesIni; mes <= mesFin; mes++) {
      var diasDelMes = new Date(anio, mes + 1, 0).getDate();
      for (var d = 1; d <= diasDelMes; d++) {
        var iso = _iso(new Date(anio, mes, d));
        var practica = Array.isArray(reg[iso]) ? reg[iso] : [];
        var evs = window.Diario && window.Diario.delDia ? window.Diario.delDia(iso) : [];

        // Un día "cuenta" si hay práctica registrada o un evento de estudio.
        var estudiadoHoy = practica.length > 0 ||
          evs.some(function (ev) { return ev.t === 'estudio'; });
        if (estudiadoHoy) {
          diasSet[iso] = true;
          diasPorMes[mes] = (diasPorMes[mes] || 0) + 1;
          porDiaSemana[new Date(anio, mes, d).getDay()]++;
        }

        var vistasHoy = {};
        practica.forEach(function (id) { apunta(vistasHoy, id); });
        evs.forEach(function (ev) {
          if (ev.t === 'estudio') {
            apunta(vistasHoy, ev.cancionId || ('marca:' + (ev.marcaId || '')), ev.titulo);
          } else if (ev.t === 'reproduccion') {
            escuchas++;
            var rt = ev.titulo || _tituloCancion(ev.cancionId);
            if (rt) reproPorTitulo[rt] = (reproPorTitulo[rt] || 0) + 1;
          } else if (ev.t === 'fragmento') {
            trozos++;
          } else if (ev.t === 'estado' && ev.extra && ev.extra.a === 'aprendida') {
            var tit = ev.titulo || _tituloCancion(ev.cancionId) || 'una canción';
            if (!vistasAprend[tit]) { vistasAprend[tit] = true; aprendidas.push(tit); }
          }
        });
      }
    }

    // Diario de sensaciones del rango (un emoji por día).
    var sensaciones = null;
    try {
      if (window.Sensaciones && window.Sensaciones.entre) {
        var iniISO = _iso(new Date(anio, mesIni, 1));
        var finISO = _iso(new Date(anio, mesFin + 1, 0));
        sensaciones = window.Sensaciones.resumen(window.Sensaciones.entre(iniISO, finISO));
      }
    } catch (e) {}

    return {
      diasSet: diasSet, porCancion: porCancion, titulos: titulos,
      diasPorMes: diasPorMes, porDiaSemana: porDiaSemana, reproPorTitulo: reproPorTitulo,
      escuchas: escuchas, trozos: trozos, aprendidas: aprendidas,
      sensaciones: sensaciones,
    };
  }

  // Top n canciones más estudiadas (por días abiertos) de un _escanear.
  function _topEstudiadas(e, min, n) {
    return Object.keys(e.porCancion)
      .filter(function (id) { return e.porCancion[id] >= (min || 2); })
      .sort(function (a, b) { return e.porCancion[b] - e.porCancion[a]; })
      .slice(0, n || 3)
      .map(function (id) { return { titulo: e.titulos[id] || 'una canción', veces: e.porCancion[id] }; });
  }

  // Top n canciones más escuchadas (por veces al play) de un _escanear.
  function _topEscuchadas(e, min, n) {
    var m = e.reproPorTitulo;
    return Object.keys(m)
      .filter(function (t) { return m[t] >= (min || 3); })
      .sort(function (a, b) { return m[b] - m[a]; })
      .slice(0, n || 3)
      .map(function (t) { return { titulo: t, veces: m[t] }; });
  }

  // Día de la semana en que más estudia (o null si no destaca).
  function _diaFavorito(porDiaSemana, minTotal) {
    var total = porDiaSemana.reduce(function (a, b) { return a + b; }, 0);
    if (total < (minTotal || 6)) return null;
    var maxI = 0;
    for (var i = 1; i < 7; i++) if (porDiaSemana[i] > porDiaSemana[maxI]) maxI = i;
    if (porDiaSemana[maxI] < 3) return null;
    var segundo = 0;
    for (var j = 0; j < 7; j++) if (j !== maxI && porDiaSemana[j] > segundo) segundo = porDiaSemana[j];
    if (porDiaSemana[maxI] <= segundo) return null;   // hay empate: no destaca
    return { nombre: DIAS_SEMANA[maxI], veces: porDiaSemana[maxI] };
  }

  // Grabaciones creadas dentro de un rango [ini, fin) de timestamps.
  function _grabacionesEntre(iniTs, finTs) {
    var n = 0, seg = 0;
    if (window.Grabaciones && window.Grabaciones.listar) {
      window.Grabaciones.listar().forEach(function (g) {
        var t = new Date(g.creado || 0).getTime();
        if (t >= iniTs && t < finTs) { n++; seg += Number(g.dur) || 0; }
      });
    }
    return { n: n, seg: Math.round(seg) };
  }

  // Logros conseguidos dentro de un rango [ini, fin) de timestamps.
  function _logrosEntre(iniTs, finTs) {
    var out = [];
    if (window.Logros && window.Logros.listar && window.Logros.fechaDe) {
      window.Logros.listar().forEach(function (l) {
        if (!l.hecho) return;
        var ts = window.Logros.fechaDe(l.id);
        if (!ts) return;
        if (ts >= iniTs && ts < finTs) out.push({ titulo: l.titulo, icono: l.icono });
      });
    }
    return out;
  }

  function datosDe(anio, mes) {
    var diasDelMes = new Date(anio, mes + 1, 0).getDate();

    var e = _escanear(anio, mes, mes);
    var diasSet = e.diasSet;
    var porCancion = e.porCancion;
    var titulos = e.titulos;
    var escuchas = e.escuchas;
    var trozos = e.trozos;
    var aprendidas = e.aprendidas;

    // Canción más trabajada del mes (solo si destaca sobre las demás).
    var ids = Object.keys(porCancion).sort(function (a, b) { return porCancion[b] - porCancion[a]; });
    var cancionTop = null;
    if (ids.length >= 2 && porCancion[ids[0]] >= 3 && porCancion[ids[0]] > porCancion[ids[1]]) {
      cancionTop = { titulo: titulos[ids[0]] || 'una canción', veces: porCancion[ids[0]] };
    }

    var topEstudiadas = _topEstudiadas(e, 2, 3);
    var topEscuchadas = _topEscuchadas(e, 3, 3);
    var topJuego = _topEstudiadas(e, 2, 4);   // lista más laxa para los mini-juegos
    var diaSemana = _diaFavorito(e.porDiaSemana, 6);

    // Grabaciones y logros del mes (por su timestamp de creación).
    var iniTs = new Date(anio, mes, 1).getTime();
    var finTs = new Date(anio, mes + 1, 1).getTime();
    var grab = _grabacionesEntre(iniTs, finTs);
    var grabN = grab.n, grabSeg = grab.seg;
    var logros = _logrosEntre(iniTs, finTs);

    var nDias = Object.keys(diasSet).length;
    var nCanciones = Object.keys(porCancion).length;

    var datos = {
      anio: anio,
      mes: mes,
      nombreMes: nombreMes(mes),
      etiqueta: capitaliza(nombreMes(mes)) + (anio !== new Date().getFullYear() ? ' de ' + anio : ''),
      clave: claveMes(anio, mes),
      dias: nDias,
      diasDelMes: diasDelMes,
      rachaMaxMes: _rachaMax(diasSet),
      canciones: nCanciones,
      cancionTop: cancionTop,
      topEstudiadas: topEstudiadas,
      topEscuchadas: topEscuchadas,
      topJuego: topJuego,
      diaSemana: diaSemana,
      aprendidas: aprendidas,
      trozos: trozos,
      escuchas: escuchas,
      grabaciones: { n: grabN, seg: Math.round(grabSeg) },
      logros: logros,
      sensaciones: e.sensaciones,
    };
    datos.hayAlgo = nDias > 0 || grabN > 0 || aprendidas.length > 0 || logros.length > 0 ||
      (e.sensaciones && e.sensaciones.n > 0);
    datos.frase = frase(datos);
    return datos;
  }

  /* ---------- Resumen ANUAL (Wrapped especial del 31 de diciembre) ----------
     Recorre el año entero. Tono cálido, no cabrón: es el regalo dentro del
     regalo. El recap de diciembre se salta porque este ya lo incluye. */
  function datosAnuales(anio) {
    var e = _escanear(anio, 0, 11);
    var iniTs = new Date(anio, 0, 1).getTime();
    var finTs = new Date(anio + 1, 0, 1).getTime();
    var diasDelAnio = Math.round((finTs - iniTs) / 86400000);

    var ids = Object.keys(e.porCancion).sort(function (a, b) {
      return e.porCancion[b] - e.porCancion[a];
    });
    var cancionTop = null;
    if (ids.length >= 2 && e.porCancion[ids[0]] >= 5 && e.porCancion[ids[0]] > e.porCancion[ids[1]]) {
      cancionTop = { titulo: e.titulos[ids[0]] || 'una canción', dias: e.porCancion[ids[0]] };
    }

    // Mes más constante del año.
    var mesTop = null, mejor = 0;
    Object.keys(e.diasPorMes).forEach(function (k) {
      if (e.diasPorMes[k] > mejor) { mejor = e.diasPorMes[k]; mesTop = +k; }
    });
    mesTop = (mesTop != null && mejor >= 3) ? { nombre: nombreMes(mesTop), dias: mejor } : null;

    var topEstudiadas = _topEstudiadas(e, 3, 5);   // el anual enseña top 5
    var topEscuchadas = _topEscuchadas(e, 5, 5);
    var topJuego = _topEstudiadas(e, 2, 4);   // lista más laxa para los mini-juegos
    var diaSemana = _diaFavorito(e.porDiaSemana, 20);

    var grab = _grabacionesEntre(iniTs, finTs);
    var logros = _logrosEntre(iniTs, finTs);

    var conciertos = 0;
    var recuerdos = [];
    if (window.Conciertos && window.Conciertos.listar) {
      window.Conciertos.listar().forEach(function (c) {
        if (String(c.fecha || '').slice(0, 4) !== String(anio)) return;
        conciertos++;
        var r = c.recuerdo || {};
        if (r.nota || r.foto) {
          recuerdos.push({
            titulo: c.lugar || 'Un concierto',
            fecha: c.fecha,
            nota: r.nota || '',
            tieneFoto: !!r.foto,
            fotoClave: window.Conciertos.claveFoto
              ? window.Conciertos.claveFoto(c.id) : ('concierto:' + c.id + ':foto'),
          });
        }
      });
    }

    var nDias = Object.keys(e.diasSet).length;
    var datos = {
      esAnual: true,
      anio: anio,
      nombreMes: '',
      etiqueta: String(anio),
      dias: nDias,
      diasDelAnio: diasDelAnio,
      rachaMaxAno: _rachaMax(e.diasSet),
      canciones: Object.keys(e.porCancion).length,
      cancionTop: cancionTop,
      topEstudiadas: topEstudiadas,
      topEscuchadas: topEscuchadas,
      topJuego: topJuego,
      diaSemana: diaSemana,
      aprendidas: e.aprendidas,
      trozos: e.trozos,
      escuchas: e.escuchas,
      grabaciones: grab,
      logros: logros,
      mesTop: mesTop,
      conciertos: conciertos,
      recuerdos: recuerdos,
      sensaciones: e.sensaciones,
    };
    datos.hayAlgo = nDias > 0 || grab.n > 0 || e.aprendidas.length > 0 ||
      logros.length > 0 || recuerdos.length > 0 || (e.sensaciones && e.sensaciones.n > 0);
    datos.frase = fraseAnual(datos);
    return datos;
  }

  function fraseAnual(d) {
    if (!d.hayAlgo) {
      return 'Un año flojito en la app, Ama. El que viene lo llenamos de música, ¿vale?';
    }
    return elegir([
      'Un año entero cantando casi cada día. Bihotsak no sería lo mismo sin ti, Ama.',
      d.dias + ' días de música en doce meses. Eso no es una afición, es tu manera de vivir.',
      'Doce meses, muchas canciones y una constancia de las que no se ven. Feliz año, Ama.',
      'Este año has cantado, has aprendido y casi no has faltado. Orgullo del bueno.',
      'Cerramos el año como empieza el siguiente: contigo cantando. Gracias por tanto, Ama.'
    ]);
  }

  /* ---------- Frase de cierre (tono cabrón) ---------- */
  function frase(d) {
    var mes = capitaliza(d.nombreMes);
    if (!d.hayAlgo) {
      return elegir([
        mes + ': cero patatero. El coro esperándote y los vecinos dándote las gracias.',
        'Este mes no has tocado la app. Bihotsak sigue, tú ya veremos.',
        mes + ' en blanco. Espero que al menos hayas cantado en la ducha.'
      ]);
    }
    var ratio = d.dias / d.diasDelMes;
    if (ratio >= 0.8) {
      return elegir([
        d.dias + ' días de ' + d.diasDelMes + '. Bestial. A este paso te sale una nota limpia sin querer.',
        'Casi el mes entero cantando. La familia pide una tregua; tú ni caso.',
        d.dias + ' de ' + d.diasDelMes + ' días. Constancia de hierro y oído de… bueno, de hierro también.'
      ]);
    }
    if (ratio >= 0.45) {
      return elegir([
        d.dias + ' días este mes. Bien. Ni de lejos afinada, pero bien.',
        mes + ' decente: ' + d.dias + ' días. El mes que viene, a por más, que hay margen. Mucho.',
        d.dias + ' días de estudio. Se nota el esfuerzo. En el resultado un poquito menos, pero se nota.'
      ]);
    }
    return elegir([
      'Solo ' + d.dias + (d.dias === 1 ? ' día' : ' días') + ' este mes. El coro no se aprende por ósmosis, Ama.',
      mes + ' flojito: ' + d.dias + (d.dias === 1 ? ' día' : ' días') + '. La próxima, un poquito más, aunque sea mal.',
      d.dias + (d.dias === 1 ? ' día' : ' días') + '. Menos que los polvorones que te comes. Espabila.'
    ]);
  }

  function elegir(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ---------- Cuándo enseñarlo ----------
     El "resumen del mes" ES el Wrapped a pantalla completa (js/wrapped.js).
     Aquí solo se decide QUÉ datos tocan y CUÁNDO ofrecerlos. */

  function _hoyISO() { return _iso(new Date()); }

  // Guarda que el resumen del mes (a, m) ya se ha visto, y —solo la primera
  // vez— la fecha en que "salió", para la ventana de 5 días en Práctica.
  function marcarVisto(a, m) {
    if (!window.Almacen) return;
    var clave = claveMes(a, m);
    window.Almacen.guardar(CLAVE_VISTO, clave);
    if (window.Almacen.leer(CLAVE_CUANDO_CLAVE, '') !== clave) {
      window.Almacen.guardar(CLAVE_CUANDO_CLAVE, clave);
      window.Almacen.guardar(CLAVE_CUANDO, _hoyISO());
    }
  }
  // Marca el Wrapped anual como visto y —solo la primera vez de ese año— guarda
  // la fecha, para la ventana de 30 días en Práctica.
  function marcarAnualVisto(anio) {
    if (!window.Almacen) return;
    var previo = window.Almacen.leer(CLAVE_ANUAL_VISTO, '');
    window.Almacen.guardar(CLAVE_ANUAL_VISTO, String(anio));
    if (previo !== String(anio)) window.Almacen.guardar(CLAVE_ANUAL_CUANDO, _hoyISO());
  }

  function ultimoMes() { return mesAnterior(); }

  // Días transcurridos entre una fecha ISO y hoy (0 si es hoy).
  function _diasDesde(iso) {
    if (!iso) return Infinity;
    var t = new Date(iso + 'T00:00:00').getTime();
    if (!isFinite(t)) return Infinity;
    return Math.floor((Date.now() - t) / 86400000);
  }

  // Año del recap anual "vigente" según el calendario: en diciembre es el año
  // en curso; en enero, el que acaba de terminar; el resto del año, ninguno.
  function _anioRecapCalendario(hoy) {
    var m = hoy.getMonth(), y = hoy.getFullYear();
    if (m === 11) return y;
    if (m === 0) return y - 1;
    return null;
  }

  // ¿Estamos aún en la ventana de "captura" en la que el anual puede aparecer
  // por primera vez? (Nochevieja y los primeros días de enero.)
  function _enCapturaAnual(hoy) {
    var m = hoy.getMonth(), d = hoy.getDate();
    if (m === 11) return d === 31;
    if (m === 0) return d <= DIA_TOPE_AUTO;
    return false;
  }

  // Año del Wrapped anual que debe verse en el BOTÓN de Práctica, o null.
  // - Si ya se vio: mientras no pasen DIAS_VENTANA_ANUAL desde que se vio.
  // - Si aún no se vio: durante la ventana de captura (31 dic – 12 ene).
  function _anualParaPractica() {
    var hoy = new Date();
    var anioCal = _anioRecapCalendario(hoy);

    var vistoAnio = window.Almacen.leer(CLAVE_ANUAL_VISTO, '');
    if (vistoAnio) {
      var cuando = window.Almacen.leer(CLAVE_ANUAL_CUANDO, '');
      if (_diasDesde(cuando) <= DIAS_VENTANA_ANUAL) return parseInt(vistoAnio, 10);
      // Ventana agotada. Si era el recap del año en curso, fuera del todo;
      // si es de un año viejo, seguimos por si toca uno nuevo sin ver.
      if (String(anioCal) === vistoAnio) return null;
    }
    return _enCapturaAnual(hoy) ? anioCal : null;
  }

  // Wrapped anual que debe SALIR SOLO en Inicio: Nochevieja y —si no se abrió la
  // app ese día— también los primeros días de enero, mientras no se haya visto.
  function anualPendiente() {
    if (!window.Almacen) return null;
    var hoy = new Date();
    if (!_enCapturaAnual(hoy)) return null;
    var anio = _anioRecapCalendario(hoy);
    if (anio == null) return null;
    if (window.Almacen.leer(CLAVE_ANUAL_VISTO, '') === String(anio)) return null;
    var d;
    try { d = datosAnuales(anio); } catch (e) { return null; }
    return (d && d.hayAlgo) ? d : null;
  }

  // Resumen mensual que debe SALIR SOLO en Inicio (día 1–12, mes no visto y
  // con algo que contar). En enero NO sale: el recap de diciembre se lo come
  // el Wrapped anual del 31.  O null.
  function pendiente() {
    if (!window.Almacen) return null;
    var hoy = new Date();
    var ant = mesAnterior(hoy);
    if (ant.mes === 11) return null;                       // diciembre: lo cubre el anual
    var clave = claveMes(ant.anio, ant.mes);
    if (window.Almacen.leer(CLAVE_VISTO, '') === clave) return null;
    if (hoy.getDate() > DIA_TOPE_AUTO) return null;

    var d = datosDe(ant.anio, ant.mes);
    if (!d.hayAlgo) { marcarVisto(ant.anio, ant.mes); return null; }
    return d;
  }

  // Lo que debe verse en el BOTÓN de Práctica: el Wrapped anual durante su
  // ventana; si no, el resumen del mes anterior pero solo los 5 días
  // siguientes a que saliera. Fuera de eso, null (el botón se esconde).
  function disponiblePractica() {
    if (!window.Almacen) return null;

    var anioAnual = _anualParaPractica();
    if (anioAnual != null) {
      try {
        var da = datosAnuales(anioAnual);
        if (da && da.hayAlgo) return da;
      } catch (e) {}
    }

    var hoy = new Date();
    var ant = mesAnterior(hoy);
    if (ant.mes === 11) return null;                       // diciembre: sin resumen suelto
    var clave = claveMes(ant.anio, ant.mes);

    var d;
    try { d = datosDe(ant.anio, ant.mes); } catch (e) { return null; }
    if (!d || !d.hayAlgo) return null;

    var visto = window.Almacen.leer(CLAVE_VISTO, '') === clave;
    if (visto) {
      var cuandoClave = window.Almacen.leer(CLAVE_CUANDO_CLAVE, '');
      var cuando = window.Almacen.leer(CLAVE_CUANDO, '');
      if (cuandoClave === clave && _diasDesde(cuando) <= DIAS_VENTANA_PRACTICA) return d;
      return null;   // pasados los 5 días: fuera
    }
    // Aún sin ver: disponible mientras siga en la ventana de auto-apertura.
    return hoy.getDate() <= DIA_TOPE_AUTO ? d : null;
  }

  /* ---------- Apertura (delega en el Wrapped) ---------- */
  function abrirHoja(d) {
    if (window.Wrapped && window.Wrapped.abrir) window.Wrapped.abrir(d);
  }
  function cerrarHoja() {
    if (window.Wrapped && window.Wrapped.cerrar) window.Wrapped.cerrar();
  }

  return {
    datosDe: datosDe,
    datosAnuales: datosAnuales,
    pendiente: pendiente,
    anualPendiente: anualPendiente,
    disponiblePractica: disponiblePractica,
    ultimoMes: ultimoMes,
    marcarVisto: marcarVisto,
    marcarAnualVisto: marcarAnualVisto,
    nombreMes: nombreMes,
    abrirHoja: abrirHoja,
    cerrarHoja: cerrarHoja,
  };
})();
