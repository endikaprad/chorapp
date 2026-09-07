/* ============================================================
   audiomp3.js — Convierte una grabación (audio/webm, mp4…) a MP3.

   El navegador y el WebView de Android graban en webm/opus o mp4,
   nunca en MP3. Para que Ama pueda enviar/guardar un .mp3 de verdad
   (y no un archivo con la extensión cambiada que luego no abre),
   aquí se decodifica el audio a PCM con la Web Audio API y se
   recodifica a MP3 con lamejs (vendorizado en src/vendor/lame.min.js).

   window.AudioMP3.disponible()        -> true si se puede convertir
   window.AudioMP3.aMp3(blob, opts)    -> Promise<Blob audio/mpeg>
       opts.kbps   (por defecto 128)
       opts.onProgreso(fraccion 0..1)

   Si algo falla, la promesa se rechaza y quien llama debe caer al
   blob original.
   ============================================================ */

window.AudioMP3 = (function () {
  'use strict';

  function _ctxClase() {
    return window.OfflineAudioContext || window.webkitOfflineAudioContext ||
           window.AudioContext || window.webkitAudioContext || null;
  }

  function disponible() {
    return !!(_ctxClase() && window.lamejs && window.lamejs.Mp3Encoder);
  }

  // Decodifica el blob a un AudioBuffer usando un AudioContext temporal.
  function _decodificar(blob) {
    return blob.arrayBuffer().then(function (datos) {
      var AC = window.AudioContext || window.webkitAudioContext ||
               window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var ctx = (AC === window.OfflineAudioContext || AC === window.webkitOfflineAudioContext)
        ? new AC(1, 1, 44100)
        : new AC();
      return new Promise(function (res, rej) {
        var p = ctx.decodeAudioData(datos, res, rej);
        if (p && p.then) p.then(res, rej);
      }).then(function (buf) {
        if (ctx.close) { try { ctx.close(); } catch (e) {} }
        return buf;
      });
    });
  }

  // Mezcla todos los canales a mono (las tomas son de voz) y devuelve
  // un Int16Array con las muestras.
  function _aMonoInt16(buffer) {
    var n = buffer.length, canales = buffer.numberOfChannels;
    var salida = new Int16Array(n);
    var datosCanales = [];
    for (var c = 0; c < canales; c++) datosCanales.push(buffer.getChannelData(c));
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var c2 = 0; c2 < canales; c2++) s += datosCanales[c2][i];
      s = s / canales;
      s = Math.max(-1, Math.min(1, s));
      salida[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return salida;
  }

  function aMp3(blob, opts) {
    opts = opts || {};
    var kbps = opts.kbps || 128;
    var onProgreso = typeof opts.onProgreso === 'function' ? opts.onProgreso : function () {};

    if (!disponible()) return Promise.reject(new Error('conversión MP3 no disponible'));

    return _decodificar(blob).then(function (buffer) {
      var muestras = _aMonoInt16(buffer);
      var sr = buffer.sampleRate;
      var enc = new window.lamejs.Mp3Encoder(1, sr, kbps);
      var BLOQUE = 1152;
      var trozos = [];
      var total = muestras.length;

      return new Promise(function (res) {
        var i = 0;
        function paso() {
          var fin = Math.min(i + BLOQUE * 200, total);   // ~200 frames por tanda
          for (; i < fin; i += BLOQUE) {
            var trozo = muestras.subarray(i, Math.min(i + BLOQUE, total));
            var mp3 = enc.encodeBuffer(trozo);
            if (mp3.length) trozos.push(mp3);
          }
          onProgreso(total ? i / total : 1);
          if (i < total) {
            setTimeout(paso, 0);   // no bloquear el hilo de UI
          } else {
            var cola = enc.flush();
            if (cola.length) trozos.push(cola);
            res(new Blob(trozos, { type: 'audio/mpeg' }));
          }
        }
        paso();
      });
    });
  }

  return { disponible: disponible, aMp3: aMp3 };
})();
