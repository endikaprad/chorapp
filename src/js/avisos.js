/* ============================================================
   avisos.js — Notificaciones en fechas señaladas.

   window.Avisos.iniciar() programa notificaciones locales para las
   fechas de window.Frases (cumpleaños, fiestas…) de los próximos
   ~13 meses. Salen en el móvil a las 17:00 SIN abrir la app.

   window.Avisos.emitir(titulo, texto) lanza una notificación al
   instante. Lo usa control-remoto.js cuando el panel del hijo manda
   una notificación personalizada.

   Es 100% local: usa @capacitor/local-notifications, no hace falta
   servidor ni internet. Cada vez que se abre la app se vuelven a
   programar, así la ventana de fechas siempre está al día.

   En el navegador (npm run dev) no hace nada: las notificaciones
   locales solo existen en el APK.

   Requiere el plugin @capacitor/local-notifications (Fase 2):
     npm i @capacitor/local-notifications
     npm run sync
   ============================================================ */

window.Avisos = (function () {
  'use strict';

  // Rango de ids que usamos, para no pisar otras notificaciones y poder
  // limpiar solo las nuestras. proximasFechas() da ids tipo 20260912.
  var ID_MIN = 20000000;
  var ID_MAX = 30000000;
  var DIAS_VISTA = 400; // ~13 meses por delante

  function plugin() {
    var Cap = window.Capacitor;
    return (Cap && Cap.Plugins && Cap.Plugins.LocalNotifications) || null;
  }
  function esNativo() {
    var Cap = window.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  function iniciar() {
    var LN = plugin();
    if (!esNativo() || !LN || !window.Frases || !window.Frases.proximasFechas) return;

    LN.checkPermissions()
      .then(function (res) {
        if (res && res.display === 'granted') return { display: 'granted' };
        return LN.requestPermissions();
      })
      .then(function (res) {
        if (!res || res.display !== 'granted') return;
        return reprogramar(LN);
      })
      .catch(function (e) {
        if (window.console) console.warn('Avisos: no se pudieron programar', e);
      });
  }

  function reprogramar(LN) {
    var fechas = window.Frases.proximasFechas(DIAS_VISTA);

    return LN.getPending()
      .then(function (pend) {
        // Cancela las nuestras que ya estén puestas (evita duplicados y
        // quita las que hayan cambiado de texto).
        var mias = ((pend && pend.notifications) || []).filter(function (n) {
          return n.id >= ID_MIN && n.id < ID_MAX;
        });
        if (!mias.length) return;
        return LN.cancel({ notifications: mias.map(function (n) { return { id: n.id }; }) });
      })
      .then(function () {
        if (!fechas.length) return;
        var notifs = fechas.map(function (f) {
          return {
            id: f.id,
            title: 'ChorApp',
            body: f.texto,
            schedule: { at: f.fecha }
          };
        });
        return LN.schedule({ notifications: notifs });
      });
  }

  /* ---------- Notificación inmediata (panel del hijo) ---------- */
  // Devuelve una promesa. En web (sin plugin) no hace nada.
  function emitir(titulo, texto) {
    var LN = plugin();
    texto = String(texto || '').trim();
    if (!esNativo() || !LN || !texto) return Promise.resolve(false);
    return LN.checkPermissions()
      .then(function (r) { return (r && r.display === 'granted') ? r : LN.requestPermissions(); })
      .then(function (r) {
        if (!r || r.display !== 'granted') return false;
        return LN.schedule({ notifications: [{
          // id rotatorio fuera del rango de las fechas (20M–30M).
          id: 18000000 + (Date.now() % 1000000),
          title: String(titulo || 'ChorApp').trim() || 'ChorApp',
          body: texto,
          schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true }
        }] }).then(function () { return true; });
      })
      .catch(function () { return false; });
  }

  /* ---------- Ayudas para probar (usar desde la consola del WebView) ----------
     window.Avisos.pendientes()  -> lista lo que hay programado
     window.Avisos.probar(20)    -> notificación de prueba dentro de 20 s
     window.Avisos.iniciar()     -> reprograma ahora mismo             */
  function pendientes() {
    var LN = plugin();
    if (!LN) return Promise.resolve([]);
    return LN.getPending().then(function (p) {
      var l = (p && p.notifications) || [];
      if (window.console) console.table(l.map(function (n) {
        return { id: n.id, cuando: n.schedule && n.schedule.at, texto: n.body };
      }));
      return l;
    });
  }

  function probar(segundos) {
    var LN = plugin();
    if (!LN) { if (window.console) console.warn('Avisos: solo en el APK'); return; }
    segundos = segundos || 15;
    return LN.checkPermissions()
      .then(function (r) { return r.display === 'granted' ? r : LN.requestPermissions(); })
      .then(function () {
        return LN.schedule({ notifications: [{
          id: 19999999,
          title: 'ChorApp (prueba)',
          body: 'Si ves esto, las notificaciones funcionan.',
          schedule: { at: new Date(Date.now() + segundos * 1000), allowWhileIdle: true }
        }] });
      })
      .then(function () { if (window.console) console.log('Aviso de prueba en', segundos, 's'); });
  }

  return { iniciar: iniciar, emitir: emitir, pendientes: pendientes, probar: probar };
})();
