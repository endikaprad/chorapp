/* ============================================================
   progreso.js — Sube un resumen del progreso de Maite a Firebase
   para que el hijo lo vea desde el panel sin preguntarle.

   Escribe en /status/resumen de la misma base de datos que usan
   control-remoto.js y push.js (config en data/control.json). No
   necesita login: /status ya es escribible por la app (igual que
   vistaPorUltimaVez o fcmToken).

   Se llama en cada arranque (app.js), pero solo sube de verdad
   una vez cada ~6 h para no machacar la base de datos.

   Solo actúa en el APK (esNativo). En el navegador (npm run dev)
   no sube nada, para no pisar el resumen real del panel.
   ============================================================ */

window.Progreso = (function () {
  'use strict';

  var CLAVE_ULTIMO = 'chorapp:progreso:subido';   // timestamp del último PATCH
  var CADA_MS = 6 * 60 * 60 * 1000;       // 6 horas

  // Solo desde el móvil de Maite (el APK). En `npm run dev` no subimos nada,
  // que si no cada arranque de desarrollo pisaría el resumen real del panel.
  function esNativo() {
    var Cap = window.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  function _num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

  function construir() {
    var P = window.Practica, L = window.Logros, RM = window.ResumenMes;
    var out = { generado: Date.now() };

    if (P) {
      out.racha = _num(P.racha && P.racha());
      out.rachaMejor = _num(P.mejorRacha && P.mejorRacha());
      var info = P.rachaInfo && P.rachaInfo();
      out.hoyHecho = !!(info && info.hoyHecho);

      // Días practicados este mes.
      var reg = P.leer ? P.leer() : {};
      var ahora = new Date();
      var pre = ahora.getFullYear() + '-' + String(ahora.getMonth() + 1).padStart(2, '0');
      var nMes = 0;
      Object.keys(reg).forEach(function (d) {
        if (d.indexOf(pre) === 0 && Array.isArray(reg[d]) && reg[d].length) nMes++;
      });
      out.diasMes = nMes;
      out.diasTotales = _num(P.diasPracticados && P.diasPracticados().length);
      out.sesionesTotales = _num(P.sesionesTotales && P.sesionesTotales());
    }

    if (window.Canciones && window.Canciones.listar) {
      var cs = window.Canciones.listar();
      out.repertorio = cs.length;
      var apr = cs.filter(function (c) { return c.estado === 'aprendida'; });
      out.aprendidas = apr.length;
      out.aprendidasTitulos = apr.slice(0, 8).map(function (c) { return c.titulo; });
    }

    if (window.Grabaciones && window.Grabaciones.listar) {
      out.grabaciones = window.Grabaciones.listar().length;
    }

    if (L && L.resumen) {
      var r = L.resumen();
      out.logros = { hechos: r.hechos, total: r.total };
      if (r.siguiente) {
        out.logroSiguiente = {
          titulo: r.siguiente.titulo, valor: r.siguiente.valor, objetivo: r.siguiente.objetivo
        };
      }
    }

    var ultimo = window.Almacen ? window.Almacen.leer('estudio:ultimo', null) : null;
    if (ultimo && ultimo.cuando) {
      out.ultimoEstudio = { cuando: ultimo.cuando, titulo: ultimo.titulo || '' };
    }

    // Resumen del mes anterior (el mismo que ve Maite en la hoja).
    if (RM && RM.ultimoMes && RM.datosDe) {
      try {
        var am = RM.ultimoMes();
        var d = RM.datosDe(am.anio, am.mes);
        out.mesAnterior = {
          nombre: d.nombreMes,
          etiqueta: d.etiqueta,
          dias: d.dias,
          diasDelMes: d.diasDelMes,
          canciones: d.canciones,
          aprendidas: d.aprendidas,
          trozos: d.trozos,
          grabaciones: d.grabaciones.n,
          rachaMax: d.rachaMaxMes,
          logros: d.logros.map(function (x) { return x.titulo; }),
          frase: d.frase
        };
      } catch (e) {}
    }

    return out;
  }

  // forzar: salta el intervalo de 6 h (lo usa study.js al estudiar el 1.er
  // rato del día). El filtro "solo APK" se mantiene siempre en las llamadas
  // automáticas; para empujar desde el navegador está subirAhora().
  function iniciar(forzar) {
    if (!window.Almacen || !esNativo()) return;
    if (!forzar) {
      var ult = 0;
      try { ult = parseInt(localStorage.getItem(CLAVE_ULTIMO), 10) || 0; } catch (e) {}
      if (Date.now() - ult < CADA_MS) return;
    }
    _subir();
  }

  // Empuje inmediato sin ningún filtro. Para pruebas desde la consola.
  function subirAhora() { _subir(); }

  function _subir() {
    if (!window.Almacen) return;
    fetch('data/control.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        var dbUrl = cfg && cfg.dbUrl ? String(cfg.dbUrl).replace(/\/+$/, '') : null;
        if (!dbUrl) return;
        return fetch(dbUrl + '/status.json', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resumen: construir() })
        }).then(function (res) {
          if (res && res.ok) {
            try { localStorage.setItem(CLAVE_ULTIMO, String(Date.now())); } catch (e) {}
          }
        });
      })
      .catch(function () { /* sin red / sin config: se reintenta al próximo arranque */ });
  }

  return { iniciar: iniciar, subirAhora: subirAhora, construir: construir };
})();
