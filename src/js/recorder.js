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

  // Reduce una lista larga de niveles a `n` valores (0..1), estilo
  // onda de audio de WhatsApp. Cada bucket es el pico de su tramo.
  function _resumirOnda(crudos, n) {
    n = n || 48;
    if (!crudos.length) return [];
    var out = [], porBucket = crudos.length / n, max = 0;
    for (var i = 0; i < n; i++) {
      var ini = Math.floor(i * porBucket), fin = Math.floor((i + 1) * porBucket);
      var p = 0;
      for (var j = ini; j < fin; j++) if (crudos[j] > p) p = crudos[j];
      out.push(p);
      if (p > max) max = p;
    }
    // Normaliza al pico global para que la onda siempre "llene".
    if (max > 0) for (var k = 0; k < out.length; k++) {
      out[k] = Math.round(Math.min(1, out[k] / max) * 100) / 100;
    }
    return out;
  }

  function crear() {
    var rec = null, trozos = [], stream = null, mime = '';
    var ctx = null, analiz = null, muestreo = null, niveles = [], onda = [];

    function _escucharNiveles() {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        var fuente = ctx.createMediaStreamSource(stream);
        analiz = ctx.createAnalyser();
        analiz.fftSize = 1024;
        fuente.connect(analiz);
        var buf = new Uint8Array(analiz.fftSize);
        muestreo = setInterval(function () {
          analiz.getByteTimeDomainData(buf);
          var sum = 0;
          for (var i = 0; i < buf.length; i++) {
            var v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          niveles.push(Math.sqrt(sum / buf.length));
        }, 60);
      } catch (e) { /* sin onda, no pasa nada */ }
    }

    function _pararNiveles() {
      if (muestreo) { clearInterval(muestreo); muestreo = null; }
      onda = _resumirOnda(niveles, 48);
      if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
      analiz = null;
    }

    function iniciar() {
      return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s;
        mime = mejorMime();
        rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
        trozos = [];
        niveles = [];
        onda = [];
        rec.ondataavailable = function (e) { if (e.data && e.data.size) trozos.push(e.data); };
        rec.start();
        _escucharNiveles();
      });
    }

    function _soltarStream() {
      _pararNiveles();
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
      // Onda de amplitud (array de 0..1) de la toma; [] si no se pudo medir.
      picos: function () { return onda.slice(); },
      get grabando() { return !!rec && rec.state === 'recording'; },
    };
  }

  return { crear: crear, soportado: soportado };
})();
