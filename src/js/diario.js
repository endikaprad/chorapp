/* ============================================================
   diario.js — Bitácora diaria de actividad.

   Un registro de "qué pasó cada día" que se rellena solo desde
   el resto de la app: abrir el modo estudio, darle al play,
   marcar un trozo difícil, cambiar el estado de una canción,
   grabarse cantando, abrir una sesión…

   Con esto, la pantalla de Práctica puede enseñar, al tocar un
   día del calendario, un resumen de todo lo que Maite hizo ese
   día (qué estudió, cuántas veces lo escuchó, qué marcó como
   aprendido, etc.).

   Formato en Almacen ('diario'):
     { "YYYY-MM-DD": [ { t, ts, ...datos }, ... ], ... }

   Tipos de evento (t):
     'estudio'      abrir el modo estudio de una canción
     'reproduccion' empezar a sonar el audio (sesión / canción)
     'estado'       cambiar el estado de una canción  (extra: { de, a })
     'fragmento'    marcar un trozo difícil
     'grabacion'    guardar una grabación cantando     (extra: { dur })
     'sesion'       abrir una sesión del coro          (extra: { fecha })

   Cada evento lleva los ids que apliquen (cancionId, sesionId,
   marcaId) y un `titulo` legible.
   ============================================================ */

window.Diario = (function () {
  'use strict';

  var CLAVE = 'diario';
  var TOPE_DIA = 500;          // techo de eventos por día (paranoia anti-bucle)
  var MIN_REPETIR_MS = 4000;   // ignora el mismo evento repetido antes de esto

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

  // ¿El último evento del día es "el mismo" que este y demasiado reciente?
  // Evita contar dobles por rebotes de play/pausa o re-render de una página.
  function _esRepeticion(lista, ev) {
    for (var i = lista.length - 1; i >= 0 && i >= lista.length - 6; i--) {
      var p = lista[i];
      if (p.t !== ev.t) continue;
      var mismo = p.cancionId === ev.cancionId &&
                  p.sesionId === ev.sesionId &&
                  p.marcaId === ev.marcaId;
      if (mismo && (ev.ts - (p.ts || 0)) < MIN_REPETIR_MS) return true;
      if (mismo) return false;
    }
    return false;
  }

  // Registra un evento con la fecha y hora de ahora. Silencioso y tolerante:
  // nunca lanza (no debe tumbar la acción que lo dispara).
  function registrar(tipo, datos) {
    try {
      if (!tipo) return;
      datos = datos || {};
      var ev = {
        t: tipo,
        ts: Date.now(),
        cancionId: datos.cancionId || null,
        sesionId: datos.sesionId || null,
        marcaId: datos.marcaId || null,
        titulo: (datos.titulo || '').trim() || null,
      };
      if (datos.extra && typeof datos.extra === 'object') ev.extra = datos.extra;

      var reg = _leer();
      var clave = hoyISO();
      var lista = Array.isArray(reg[clave]) ? reg[clave] : [];
      if (_esRepeticion(lista, ev)) return;
      lista.push(ev);
      if (lista.length > TOPE_DIA) lista = lista.slice(lista.length - TOPE_DIA);
      reg[clave] = lista;
      _guardar(reg);
    } catch (e) {
      if (window.console) console.warn('Diario: no se pudo registrar', e);
    }
  }

  // Días (YYYY-MM-DD) con al menos un evento.
  function dias() { return Object.keys(_leer()); }

  function delDia(iso) {
    var l = _leer()[iso];
    return Array.isArray(l) ? l.slice() : [];
  }

  function hayAlgo(iso) {
    var d = delDia(iso);
    if (d.length) return true;
    // Días antiguos: puede haber práctica registrada antes de existir el diario.
    var p = window.Practica && window.Practica.leer ? window.Practica.leer()[iso] : null;
    return !!(p && p.length);
  }

  /* ----------------------------------------------------------
     Resumen agregado de un día. Devuelve un objeto pensado para
     pintarse tal cual en la pantalla de Práctica.
     ---------------------------------------------------------- */
  function resumenDia(iso) {
    var evs = delDia(iso);

    var estudio = {};        // clave -> { titulo, cancionId, sesionId, marcaId, veces }
    var repro = {};          // clave -> { titulo, veces }
    var aprendidas = [];     // [{ titulo }]
    var otrosEstados = [];   // [{ titulo, de, a }]
    var fragmentos = 0;
    var fragPorTitulo = {};  // titulo -> n
    var grabaciones = [];    // [{ titulo, dur }]
    var sesiones = {};       // sesionId -> { titulo, fecha, veces }
    var primera = null, ultima = null;

    var ETQ_ESTADO = { pendiente: 'Pendiente', progreso: 'En progreso', aprendida: 'Aprendida' };

    evs.forEach(function (ev) {
      if (ev.ts) {
        if (primera == null || ev.ts < primera) primera = ev.ts;
        if (ultima == null || ev.ts > ultima) ultima = ev.ts;
      }
      var tit = ev.titulo || tituloDe(ev) || 'Canción';

      if (ev.t === 'estudio') {
        var ke = ev.marcaId || ev.cancionId || tit;
        if (!estudio[ke]) {
          estudio[ke] = {
            titulo: tit, cancionId: ev.cancionId, sesionId: ev.sesionId,
            marcaId: ev.marcaId, veces: 0,
          };
        }
        estudio[ke].veces++;
      } else if (ev.t === 'reproduccion') {
        var kr = ev.sesionId || ev.cancionId || tit;
        if (!repro[kr]) repro[kr] = { titulo: tit, veces: 0 };
        repro[kr].veces++;
      } else if (ev.t === 'estado') {
        var a = ev.extra && ev.extra.a;
        var de = ev.extra && ev.extra.de;
        if (a === 'aprendida') aprendidas.push({ titulo: tit });
        else otrosEstados.push({ titulo: tit, de: ETQ_ESTADO[de] || de, a: ETQ_ESTADO[a] || a });
      } else if (ev.t === 'fragmento') {
        fragmentos++;
        fragPorTitulo[tit] = (fragPorTitulo[tit] || 0) + 1;
      } else if (ev.t === 'grabacion') {
        grabaciones.push({ titulo: tit, dur: (ev.extra && ev.extra.dur) || 0 });
      } else if (ev.t === 'sesion') {
        var ks = ev.sesionId || tit;
        if (!sesiones[ks]) {
          sesiones[ks] = { titulo: tit, fecha: (ev.extra && ev.extra.fecha) || null, veces: 0 };
        }
        sesiones[ks].veces++;
      }
    });

    var estudiado = Object.keys(estudio).map(function (k) { return estudio[k]; });

    // Días antiguos sin eventos de 'estudio': recuperar de Práctica qué se abrió.
    if (!estudiado.length) {
      var p = window.Practica && window.Practica.leer ? window.Practica.leer()[iso] : null;
      (p || []).forEach(function (id) {
        var c = (id && id.indexOf('marca:') !== 0 && window.Canciones)
          ? window.Canciones.obtener(id) : null;
        estudiado.push({
          titulo: c ? c.titulo : 'Canción',
          cancionId: c ? c.id : null, sesionId: null, marcaId: null, veces: 0,
        });
      });
    }

    var reproducciones = Object.keys(repro).map(function (k) { return repro[k]; })
      .sort(function (a, b) { return b.veces - a.veces; });
    var sesionesAbiertas = Object.keys(sesiones).map(function (k) { return sesiones[k]; });
    var fragmentosLista = Object.keys(fragPorTitulo).map(function (t) {
      return { titulo: t, n: fragPorTitulo[t] };
    });

    var hay = !!(estudiado.length || reproducciones.length || aprendidas.length ||
                 otrosEstados.length || fragmentos || grabaciones.length ||
                 sesionesAbiertas.length);

    return {
      iso: iso,
      hayAlgo: hay,
      estudiado: estudiado,
      reproducciones: reproducciones,
      aprendidas: aprendidas,
      cambiosEstado: otrosEstados,
      fragmentos: fragmentos,
      fragmentosLista: fragmentosLista,
      grabaciones: grabaciones,
      sesionesAbiertas: sesionesAbiertas,
      primera: primera,
      ultima: ultima,
      totalEventos: evs.length,
    };
  }

  function tituloDe(ev) {
    if (ev.cancionId && window.Canciones) {
      var c = window.Canciones.obtener(ev.cancionId);
      if (c) return c.titulo;
    }
    return null;
  }

  return {
    hoyISO: hoyISO,
    registrar: registrar,
    dias: dias,
    delDia: delDia,
    hayAlgo: hayAlgo,
    resumenDia: resumenDia,
  };
})();
