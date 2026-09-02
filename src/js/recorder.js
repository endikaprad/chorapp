/* ============================================================
   recorder.js — Grabación de voz con MediaRecorder.

   Núcleo compartido: la "nota de voz rápida" del modo estudio
   (Fase 5) y la grabadora personal completa (Fase 7) usan esto.

   window.Grabadora.crear() -> controlador:
     await ctrl.iniciar()   pide micrófono y empieza a grabar
     await ctrl.parar()     devuelve un Blob (audio/webm o mp4)
     ctrl.cancelar()        corta y descarta
     ctrl.soportado()       false si el navegador no puede grabar
   ============================================================ */

window.Grabadora = (function () {
  'use strict';

  function soportado() {
    return !!(navigator.mediaDevices &&
              navigator.mediaDevices.getUserMedia &&
              window.MediaRecorder);
  }

  function mejorMime() {
    var cand = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (var i = 0; i < cand.length; i++) {
      if (window.MediaRecorder.isTypeSupported &&
          window.MediaRecorder.isTypeSupported(cand[i])) return cand[i];
    }
    return '';
  }

  function crear() {
    var rec = null, trozos = [], stream = null, mime = '';

    function iniciar() {
      return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s;
        mime = mejorMime();
        rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        trozos = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) trozos.push(e.data); };
        rec.start();
      });
    }

    function _soltarStream() {
      if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    }

    function parar() {
      return new Promise(function (resolve) {
        if (!rec || rec.state === 'inactive') { _soltarStream(); return resolve(null); }
        rec.onstop = function () {
          var blob = new Blob(trozos, { type: rec.mimeType || mime || 'audio/webm' });
          _soltarStream();
          resolve(blob);
        };
        rec.stop();
      });
    }

    function cancelar() {
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {}
      trozos = [];
      _soltarStream();
    }

    return {
      iniciar: iniciar,
      parar: parar,
      cancelar: cancelar,
      soportado: soportado,
      get grabando() { return !!rec && rec.state === 'recording'; },
    };
  }

  return { crear: crear, soportado: soportado };
})();
