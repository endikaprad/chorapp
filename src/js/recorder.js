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

  // Marco rojo global + botón flotante de parada mientras se graba.
  // <body>.app-grabando enciende el borde de #marco-grabando y muestra
  // #btn-parar-grabando, siempre a mano aunque Maite haya subido a leer
  // la letra. Contador por si hubiera más de una grabación viva.
  var _activas = 0;
  var _pararActual = null;   // función que detiene la toma en curso
  var _t0 = 0, _crono = null;

  function _fmtTiempo(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60);
    return m + ':' + ('0' + (s % 60)).slice(-2);
  }

  function _pintarBoton() {
    var b = document.getElementById('btn-parar-grabando');
    if (!b) return;
    var t = b.querySelector('[data-parar-txt]');
    if (t) t.textContent = _fmtTiempo((Date.now() - _t0) / 1000);
  }

  function _marcoGrabando(on) {
    _activas = Math.max(0, _activas + (on ? 1 : -1));
    var activo = _activas > 0;
    if (document.body) document.body.classList.toggle('app-grabando', activo);

    var b = document.getElementById('btn-parar-grabando');
    if (b && !b._enlazado) {
      b._enlazado = true;
      b.addEventListener('click', function () {
        if (typeof _pararActual === 'function') { var f = _pararActual; _pararActual = null; f(); }
      });
    }

    if (activo) {
      _t0 = Date.now();
      _pintarBoton();
      if (_crono) clearInterval(_crono);
      _crono = setInterval(_pintarBoton, 500);
    } else {
      _pararActual = null;
      if (_crono) { clearInterval(_crono); _crono = null; }
    }
  }

  // La página registra aquí cómo detener/guardar su toma, para que el
  // botón flotante global pueda pararla desde cualquier scroll.
  function alParar(fn) { _pararActual = typeof fn === 'function' ? fn : null; }

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
    // Sin señal medible (contexto silenciado, permiso raro…): mejor no
    // devolver nada y que el mini-reproductor use su barra lisa.
    if (max < 0.002) return [];
    // Normaliza al pico global para que la onda siempre "llene".
    for (var k = 0; k < out.length; k++) {
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
        // En el WebView de Android el contexto nace "suspended": sin
        // resume() el analizador solo lee silencio y la onda sale plana.
        if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
        var fuente = ctx.createMediaStreamSource(stream);
        analiz = ctx.createAnalyser();
        analiz.fftSize = 1024;
        fuente.connect(analiz);
        // Algunos motores (WebView de Android incluido) solo hacen "correr"
        // el analizador si la cadena llega hasta la salida. Lo colgamos de un
        // GainNode a 0: el grafo está vivo pero no se oye nada por el altavoz.
        var mudo = ctx.createGain();
        mudo.gain.value = 0;
        analiz.connect(mudo);
        mudo.connect(ctx.destination);
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
        _marcoGrabando(true);
        _escucharNiveles();
      });
    }

    function _soltarStream() {
      _marcoGrabando(false);
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

  /* ============================================================
     Calibración de latencia (test de bucle / loopback).

     Reproduce varios "clics" cortos por el altavoz o los auriculares
     y los graba con el micro a la vez. La diferencia entre el
     instante en que sonó cada clic y el instante en que el micro lo
     "oyó" es la latencia real de ida y vuelta de ESTE dispositivo
     con ESTA salida de audio. Se repite varias veces y se promedia.

     window.Grabadora.calibrarLatencia({ onPaso })  -> Promise
        resuelve { latencia, muestras } (segundos)
        rechaza  { motivo: 'permiso' | 'sinapi' | 'sinsenal' }

     onPaso(hecho, total) se llama tras cada clic para poder mostrar
     progreso ("Pitido 2 de 4…").
     ============================================================ */
  function calibrarLatencia(opciones) {
    opciones = opciones || {};
    var onPaso = typeof opciones.onPaso === 'function' ? opciones.onPaso : function () {};
    var CLICS = 4;            // número de mediciones
    var ESPERA_CLIC = 0.7;    // segundos entre clic y clic
    var LEAD = 0.25;          // margen antes de disparar el primer clic
    var VENTANA = 0.85;       // margen máximo para "oír" el clic de vuelta
    var DUR_CLIC = 0.05;      // duración del pitido

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject({ motivo: 'sinapi' });
    }

    var ctx, stream, analiz, buf;

    function cerrar() {
      try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      try { if (ctx) ctx.close(); } catch (e) {}
      stream = null; ctx = null; analiz = null;
    }

    // Nivel de sonido instantáneo del micro (0..1), sin bloquear.
    function nivel() {
      analiz.getByteTimeDomainData(buf);
      var max = 0;
      for (var i = 0; i < buf.length; i++) {
        var v = Math.abs((buf[i] - 128) / 128);
        if (v > max) max = v;
      }
      return max;
    }

    // Dispara un clic en `cuando` (reloj de ctx) y devuelve una promesa
    // con la latencia medida, o null si no se detectó nada claro.
    function medirUno(cuando, ruido) {
      return new Promise(function (resolve) {
        var osc = ctx.createOscillator();
        var gan = ctx.createGain();
        osc.frequency.value = 1200;
        osc.connect(gan); gan.connect(ctx.destination);
        gan.gain.setValueAtTime(0.0001, cuando);
        gan.gain.exponentialRampToValueAtTime(0.9, cuando + 0.004);
        gan.gain.exponentialRampToValueAtTime(0.0001, cuando + DUR_CLIC);
        osc.start(cuando);
        osc.stop(cuando + DUR_CLIC + 0.02);

        var umbral = Math.max(0.12, ruido * 4);
        var t0 = cuando;
        var limite = cuando + VENTANA;
        var raf;
        function mira() {
          var ahora = ctx.currentTime;
          // No empezamos a mirar hasta pasado el propio clic + un pelín,
          // para no confundir la fuga directa con el eco acústico.
          if (ahora > t0 + 0.015 && nivel() > umbral) {
            cancelAnimationFrame(raf);
            return resolve(ahora - t0);
          }
          if (ahora > limite) { cancelAnimationFrame(raf); return resolve(null); }
          raf = requestAnimationFrame(mira);
        }
        raf = requestAnimationFrame(mira);
      });
    }

    return navigator.mediaDevices.getUserMedia({
      // Clave: sin cancelación de eco ni supresión de ruido, o el
      // sistema se "comería" justo el clic que queremos medir.
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    }).then(function (s) {
      stream = s;
      ctx = new AC();
      var fuente = ctx.createMediaStreamSource(stream);
      analiz = ctx.createAnalyser();
      analiz.fftSize = 1024;
      fuente.connect(analiz);
      buf = new Uint8Array(analiz.fftSize);

      return (ctx.resume ? ctx.resume() : Promise.resolve()).then(function () {
        // Ruido de fondo de referencia (primeros ~200 ms).
        return new Promise(function (r) {
          var picos = [], t = setInterval(function () {
            picos.push(nivel());
            if (picos.length >= 12) {
              clearInterval(t);
              picos.sort(function (a, b) { return a - b; });
              r(picos[Math.floor(picos.length / 2)] || 0);
            }
          }, 16);
        });
      }).then(function (ruido) {
        var muestras = [];
        var cadena = Promise.resolve();
        for (var i = 0; i < CLICS; i++) {
          (function (idx) {
            cadena = cadena.then(function () {
              var cuando = ctx.currentTime + LEAD;
              return medirUno(cuando, ruido).then(function (lat) {
                if (lat != null) muestras.push(lat);
                onPaso(idx + 1, CLICS);
                return new Promise(function (r) { setTimeout(r, ESPERA_CLIC * 1000); });
              });
            });
          })(i);
        }
        return cadena.then(function () { return muestras; });
      });
    }).then(function (muestras) {
      cerrar();
      var validas = filtrarMuestras(muestras);
      if (validas.length < 2) return Promise.reject({ motivo: 'sinsenal' });
      var media = validas.reduce(function (a, b) { return a + b; }, 0) / validas.length;
      return { latencia: media, muestras: validas };
    }).catch(function (err) {
      cerrar();
      if (err && err.motivo) return Promise.reject(err);
      return Promise.reject({ motivo: 'permiso' });
    });
  }

  // Quita valores dispares: nos quedamos con los cercanos a la mediana.
  function filtrarMuestras(m) {
    if (m.length < 2) return m.slice();
    var orden = m.slice().sort(function (a, b) { return a - b; });
    var med = orden[Math.floor(orden.length / 2)];
    return orden.filter(function (x) { return Math.abs(x - med) <= 0.12; });
  }

  return { crear: crear, soportado: soportado, calibrarLatencia: calibrarLatencia, alParar: alParar };
})();
