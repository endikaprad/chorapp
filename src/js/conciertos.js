/* ============================================================
   conciertos.js — Días de concierto del coro Bihotsak.

   Maite marca en el calendario de Práctica los días que el coro
   actúa. Un día de concierto:
     - se pinta de otro color en el calendario (.cal__dia--concierto)
     - al tocarlo, muestra los detalles (lugar, hora, notas)
     - ese día, la frase de Inicio es una especial de concierto
     - ese día, a las 9:00, salta una notificación de ánimo
       (textos con retranca en frases.js: CONCIERTOS / AVISOS_CONCIERTO)

   Guardado en Almacen ('conciertos') como lista:
     {
       id:    string,
       fecha: 'YYYY-MM-DD',   // día del concierto (puede ser futuro)
       lugar: string,         // opcional
       hora:  string,         // opcional, texto libre ('19:30', 'tarde'…)
       notas: string,         // opcional
       programa: [cancionId], // orden de las canciones en el concierto (setlist)
       recuerdo: { nota, foto: null | { mime, guardado } },  // "cómo fue" (tras el concierto)
       creado: number,
       actualizado: number
     }

   La foto del recuerdo (blob) va en window.Archivos con clave
   "concierto:<id>:foto".
   ============================================================ */

window.Conciertos = (function () {
  'use strict';

  var CLAVE = 'conciertos';
  var CLAVE_SEED = 'conciertos:seed2';

  // Concierto que viene de fábrica: el único fijado por ahora.
  var POR_DEFECTO = [{
    fecha: '2026-09-12',
    lugar: 'Iglesia de San Pedro de Lamuza, Llodio',
    hora: '20:00',
    notas: '',
  }];

  function nuevoId() {
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function hoyISO(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function _leer() {
    var l = window.Almacen ? window.Almacen.leer(CLAVE, []) : [];
    return Array.isArray(l) ? l : [];
  }
  function _guardarTodo(l) {
    if (window.Almacen) window.Almacen.guardar(CLAVE, l);
  }

  function _saneaPrograma(p) {
    if (!Array.isArray(p)) return [];
    var visto = {};
    return p.filter(function (id) {
      if (typeof id !== 'string' || !id || visto[id]) return false;
      visto[id] = true;
      return true;
    });
  }

  function _saneaRecuerdo(r) {
    if (!r || typeof r !== 'object') return { nota: '', foto: null };
    var foto = null;
    if (r.foto && typeof r.foto === 'object') {
      foto = { mime: String(r.foto.mime || ''), guardado: r.foto.guardado || Date.now() };
    }
    return { nota: String(r.nota || '').trim(), foto: foto };
  }

  function _sanea(c) {
    return {
      id: c.id || nuevoId(),
      fecha: String(c.fecha || '').slice(0, 10),
      lugar: String(c.lugar || '').trim(),
      hora: String(c.hora || '').trim(),
      notas: String(c.notas || '').trim(),
      programa: _saneaPrograma(c.programa),
      recuerdo: _saneaRecuerdo(c.recuerdo),
      creado: c.creado || Date.now(),
      actualizado: Date.now(),
    };
  }

  // Clave del blob de la foto del recuerdo en window.Archivos.
  function claveFoto(id) { return 'concierto:' + id + ':foto'; }

  // Lista completa, ordenada por fecha ascendente.
  function listar() {
    return _leer().slice().sort(function (a, b) {
      return String(a.fecha).localeCompare(String(b.fecha));
    });
  }

  function obtener(id) {
    var l = _leer();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  // Concierto de un día concreto (ISO 'YYYY-MM-DD'), o null.
  function porFecha(iso) {
    var l = _leer();
    for (var i = 0; i < l.length; i++) if (l[i].fecha === iso) return l[i];
    return null;
  }

  // { 'YYYY-MM-DD': true } — cómodo para el calendario.
  function mapa() {
    var m = {};
    _leer().forEach(function (c) { if (c.fecha) m[c.fecha] = true; });
    return m;
  }

  // Concierto de hoy, o null.
  function hoy(fecha) {
    return porFecha(hoyISO(fecha));
  }

  // Alta o edición. Si `datos.id` existe y coincide, actualiza; si no, crea.
  // Solo puede haber un concierto por fecha: si ya hay otro ese día, lo
  // reemplaza (se queda el que se está guardando).
  function guardar(datos) {
    datos = datos || {};
    var c = _sanea(datos);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha)) return null;

    // El formulario de edición no toca el programa ni el recuerdo: si no
    // vienen, se conservan.
    if ((datos.programa === undefined || datos.recuerdo === undefined) && datos.id) {
      var previo = obtener(datos.id);
      if (previo) {
        if (datos.programa === undefined) c.programa = _saneaPrograma(previo.programa);
        if (datos.recuerdo === undefined) c.recuerdo = _saneaRecuerdo(previo.recuerdo);
      }
    }

    var l = _leer().filter(function (x) {
      return x.id !== c.id && x.fecha !== c.fecha;
    });
    l.push(c);
    _guardarTodo(l);
    return c;
  }

  function eliminar(id) {
    var l = _leer().filter(function (c) { return c.id !== id; });
    _guardarTodo(l);
    if (window.Archivos) window.Archivos.borrarPrefijo('concierto:' + id + ':');
  }

  /* ---------- Recuerdo del concierto (foto + nota de "cómo fue") ---------- */

  function recuerdoDe(id) {
    var c = obtener(id);
    return c ? _saneaRecuerdo(c.recuerdo) : { nota: '', foto: null };
  }

  function fijarNotaRecuerdo(id, nota) {
    return _mutar(id, function (c) {
      c.recuerdo = _saneaRecuerdo(c.recuerdo);
      c.recuerdo.nota = String(nota || '').trim();
    });
  }

  // meta = { mime } tras guardar el blob en Archivos, o null para quitar.
  function fijarFotoRecuerdo(id, meta) {
    return _mutar(id, function (c) {
      c.recuerdo = _saneaRecuerdo(c.recuerdo);
      c.recuerdo.foto = meta ? { mime: meta.mime || '', guardado: Date.now() } : null;
    });
  }

  /* ---------- Programa del concierto (setlist) ---------- */

  // Aplica fn(concierto) y persiste. Devuelve el concierto resultante o null.
  function _mutar(id, fn) {
    var l = _leer();
    var res = null;
    for (var i = 0; i < l.length; i++) {
      if (l[i].id !== id) continue;
      var cop = _sanea(l[i]);
      fn(cop);
      cop.programa = _saneaPrograma(cop.programa);
      l[i] = cop;
      res = cop;
      break;
    }
    if (res) _guardarTodo(l);
    return res;
  }

  // Programa resuelto: [{ id, titulo, compositor, estado }] en orden.
  // Filtra canciones que ya no existen en el repertorio.
  function programaDe(id) {
    var c = obtener(id);
    if (!c || !Array.isArray(c.programa)) return [];
    return c.programa.map(function (cid) {
      var s = window.Canciones ? window.Canciones.obtener(cid) : null;
      return s ? {
        id: s.id, titulo: s.titulo, compositor: s.compositor || '', estado: s.estado,
      } : null;
    }).filter(Boolean);
  }

  function fijarPrograma(id, ids) { return _mutar(id, function (c) { c.programa = ids || []; }); }

  function agregarAlPrograma(id, cancionId) {
    return _mutar(id, function (c) {
      if (c.programa.indexOf(cancionId) === -1) c.programa.push(cancionId);
    });
  }

  function quitarDelPrograma(id, cancionId) {
    return _mutar(id, function (c) {
      c.programa = c.programa.filter(function (x) { return x !== cancionId; });
    });
  }

  // Mueve la canción de la posición `desde` a la posición `hasta`.
  function moverEnPrograma(id, desde, hasta) {
    return _mutar(id, function (c) {
      var p = c.programa;
      if (desde < 0 || desde >= p.length) return;
      hasta = Math.max(0, Math.min(p.length - 1, hasta));
      var it = p.splice(desde, 1)[0];
      p.splice(hasta, 0, it);
    });
  }

  // Quita una canción de TODOS los programas (al borrarla del repertorio).
  function limpiarCancion(cancionId) {
    var l = _leer();
    var cambiado = false;
    l.forEach(function (c) {
      if (Array.isArray(c.programa) && c.programa.indexOf(cancionId) !== -1) {
        c.programa = c.programa.filter(function (x) { return x !== cancionId; });
        cambiado = true;
      }
    });
    if (cambiado) _guardarTodo(l);
  }

  // Próximo concierto (hoy o más adelante), con cuántos días faltan.
  // Devuelve el objeto del concierto + `dias` (0 = hoy), o null si no hay.
  function siguiente(desde) {
    var base = desde ? new Date(desde) : new Date();
    base.setHours(0, 0, 0, 0);
    var lista = listar();
    for (var i = 0; i < lista.length; i++) {
      var d = _deISO(lista[i].fecha);
      if (!d) continue;
      d.setHours(0, 0, 0, 0);
      if (d < base) continue;
      var dias = Math.round((d - base) / 86400000);
      var c = {};
      for (var k in lista[i]) if (lista[i].hasOwnProperty(k)) c[k] = lista[i][k];
      c.dias = dias;
      return c;
    }
    return null;
  }

  // Conciertos futuros (incluido hoy) dentro de los próximos `dias` días.
  // Para programar notificaciones. Devuelve [{ id, fecha (Date, 9:00), texto }].
  function proximos(dias, desde) {
    dias = dias || 400;
    var base = desde ? new Date(desde) : new Date();
    base.setHours(0, 0, 0, 0);
    var limite = new Date(base);
    limite.setDate(limite.getDate() + dias);

    var avisoTexto = (window.Frases && window.Frases.avisoConcierto) || null;

    return listar().filter(function (c) {
      var d = _deISO(c.fecha);
      return d && d >= base && d <= limite;
    }).map(function (c) {
      var d = _deISO(c.fecha);
      var at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 13, 0, 0, 0);
      var ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      var extra = c.lugar ? ' ' + c.lugar + '.' : '';
      var extraHora = c.hora ? ' (' + c.hora + ')' : '';
      var texto = avisoTexto ? avisoTexto() : 'Hoy hay concierto con Bihotsak.';
      return {
        // id propio, fuera del rango de las fechas de frases.js (evita choques
        // el día que un concierto cae en una fecha marcada).
        id: 5000000 + ymd,
        fecha: at,
        texto: texto + extra + extraHora,
      };
    });
  }

  function _deISO(s) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null;
  }

  // Deja la agenda con el concierto de fábrica una sola vez (primera vez
  // que corre esta versión). A partir de ahí, Maite manda: si lo borra o
  // añade otros, no se vuelve a tocar.
  function _seed() {
    try {
      if (!window.Almacen) return;
      if (window.Almacen.leer(CLAVE_SEED, false)) return;
      window.Almacen.guardar(CLAVE_SEED, true);
      // Sustituye lo que hubiera (solo puede ser de pruebas: la función
      // es nueva) para que el estado inicial sea exactamente el de fábrica.
      _guardarTodo(POR_DEFECTO.map(_sanea));
    } catch (e) {}
  }
  _seed();

  return {
    hoyISO: hoyISO,
    listar: listar,
    obtener: obtener,
    porFecha: porFecha,
    mapa: mapa,
    hoy: hoy,
    siguiente: siguiente,
    guardar: guardar,
    eliminar: eliminar,
    proximos: proximos,
    claveFoto: claveFoto,
    recuerdoDe: recuerdoDe,
    fijarNotaRecuerdo: fijarNotaRecuerdo,
    fijarFotoRecuerdo: fijarFotoRecuerdo,
    programaDe: programaDe,
    fijarPrograma: fijarPrograma,
    agregarAlPrograma: agregarAlPrograma,
    quitarDelPrograma: quitarDelPrograma,
    moverEnPrograma: moverEnPrograma,
    limpiarCancion: limpiarCancion,
  };
})();
