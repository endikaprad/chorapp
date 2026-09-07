/* ============================================================
   push.js — Notificaciones push reales (con la app CERRADA).

   window.Push.iniciar() registra el móvil en Firebase Cloud
   Messaging (FCM) y guarda su "token" en la base de datos que ya
   usa el panel (/status/fcmToken). Desde el panel, el botón
   "Notificación al móvil" llama a un pequeño servidor (Cloudflare
   Worker) que usa ese token para enviar la notificación — y le
   llega a Maite aunque tenga la app cerrada o el móvil en reposo.

   Diferencia con control-remoto.js: aquel solo funciona con la app
   abierta (consulta cada 10 s). Esto funciona siempre.

   Es gratis: FCM no cobra y el Worker entra en el plan gratuito.

   Solo actúa en el APK. En el navegador (npm run dev) no hace nada:
   las push nativas no existen en web.

   Requiere el plugin @capacitor/push-notifications (Fase 2):
     npm i @capacitor/push-notifications
     npm run sync
   y el fichero google-services.json de Firebase en resources/
   (ver panel/README.md).
   ============================================================ */

window.Push = (function () {
  'use strict';

  var CLAVE_TOKEN = 'chorapp:push:token'; // último token subido (evita PATCH inútiles)
  var dbUrl = null;

  function plugin() {
    var Cap = window.Capacitor;
    return (Cap && Cap.Plugins && Cap.Plugins.PushNotifications) || null;
  }
  function esNativo() {
    var Cap = window.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  function iniciar() {
    var PN = plugin();
    if (!esNativo() || !PN) return;

    // La URL de la base de datos vive en el mismo sitio que para
    // control-remoto.js. Si no está configurada, no hacemos nada.
    fetch('data/control.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        dbUrl = cfg && cfg.dbUrl ? String(cfg.dbUrl).replace(/\/+$/, '') : null;
        if (!dbUrl) return;
        registrar(PN);
      })
      .catch(function () { /* sin config: nada */ });
  }

  function registrar(PN) {
    // Cuando FCM nos da el token del dispositivo.
    PN.addListener('registration', function (t) {
      var token = t && t.value;
      if (token) subirToken(token);
    });

    PN.addListener('registrationError', function (e) {
      if (window.console) console.warn('Push: no se pudo registrar', e);
    });

    // Push recibida con la app EN PRIMER PLANO: Android no la muestra
    // sola, así que la enseñamos como notificación local (Avisos) para
    // que Maite la vea igual.
    PN.addListener('pushNotificationReceived', function (n) {
      var titulo = (n && n.title) || (n && n.data && n.data.title) || 'ChorApp';
      var cuerpo = (n && n.body) || (n && n.data && n.data.body) || '';
      if (cuerpo && window.Avisos && window.Avisos.emitir) {
        window.Avisos.emitir(titulo, cuerpo);
      }
    });

    PN.checkPermissions()
      .then(function (res) {
        if (res && res.receive === 'granted') return res;
        return PN.requestPermissions();
      })
      .then(function (res) {
        if (res && res.receive === 'granted') return PN.register();
      })
      .catch(function (e) {
        if (window.console) console.warn('Push: permiso denegado', e);
      });
  }

  function subirToken(token) {
    var previo = '';
    try { previo = localStorage.getItem(CLAVE_TOKEN) || ''; } catch (e) {}
    if (token === previo) return; // ya está subido

    fetch(dbUrl + '/status.json', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fcmToken: token, fcmTokenFecha: Date.now() })
    })
      .then(function (r) {
        if (r.ok) {
          try { localStorage.setItem(CLAVE_TOKEN, token); } catch (e) {}
        }
      })
      .catch(function () { /* sin red: se reintenta en el próximo arranque */ });
  }

  return { iniciar: iniciar };
})();
