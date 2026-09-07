/* ============================================================
   window.MiniPlayer — reproductor de audio compacto y con la
   estética Bihotsak. Sustituye al <audio controls> nativo en
   las notas de voz (modo estudio) y en las grabaciones.

   Uso:
     contenedor.innerHTML = window.MiniPlayer.plantilla();
     window.MiniPlayer.montar(contenedor.querySelector('[data-mp]'), duracionSegundos);
     // luego, cuando tengas la URL del audio:
     contenedor.querySelector('[data-mp-audio]').src = url;
   ============================================================ */

window.MiniPlayer = (function () {
  'use strict';

  function plantilla() {
    return '' +
      '<div class="mini-player" data-mp>' +
        '<button type="button" class="mini-player__play" data-mp-play aria-label="Reproducir">' +
          '<svg class="mini-player__i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' +
          '<svg class="mini-player__i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' +
        '</button>' +
        '<input type="range" class="mini-player__barra" data-mp-barra min="0" max="1000" value="0" step="1" aria-label="Progreso" disabled>' +
        '<div class="mini-player__onda" data-mp-onda hidden aria-hidden="true"></div>' +
        '<span class="mini-player__tiempo" data-mp-tiempo>0:00</span>' +
        '<audio preload="metadata" data-mp-audio></audio>' +
      '</div>';
  }

  // Calcula ~48 picos de amplitud (0..1) directamente del audio ya grabado.
  // Sirve para grabaciones guardadas sin onda (o cuando la medición falló).
  var _AC = window.AudioContext || window.webkitAudioContext;
  function ondaDesdeAudio(url) {
    if (!_AC || !url) return Promise.resolve([]);
    return fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var ctx = new _AC();
      return ctx.decodeAudioData(buf).then(function (audioBuf) {
        try { ctx.close(); } catch (e) {}
        var datos = audioBuf.getChannelData(0);
        var n = 48, out = [], porBucket = Math.floor(datos.length / n) || 1, max = 0;
        for (var i = 0; i < n; i++) {
          var ini = i * porBucket, fin = Math.min(datos.length, ini + porBucket), p = 0;
          for (var j = ini; j < fin; j++) {
            var v = Math.abs(datos[j]);
            if (v > p) p = v;
          }
          out.push(p);
          if (p > max) max = p;
        }
        if (max < 0.002) return [];
        for (var k = 0; k < out.length; k++) {
          out[k] = Math.round(Math.min(1, out[k] / max) * 100) / 100;
        }
        return out;
      });
    });
  }

  function fmt(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var m = Math.floor(seg / 60), s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function montar(mp, durInicial, picos) {
    var audio = mp.querySelector('[data-mp-audio]');
    var btn = mp.querySelector('[data-mp-play]');
    var barra = mp.querySelector('[data-mp-barra]');
    var onda = mp.querySelector('[data-mp-onda]');
    var tiempo = mp.querySelector('[data-mp-tiempo]');
    var arrastrando = false;
    var barras = [];

    // Onda estilo nota de voz de WhatsApp: barritas de amplitud que se
    // "encienden" según avanza la reproducción. Sustituye a la barra lisa.
    function dibujarOnda(vals) {
      if (!onda || !vals || !vals.length) return;
      barra.hidden = true;
      onda.hidden = false;
      // Cuántas barras caben de verdad en el ancho disponible (cada una ~3px
      // con su hueco). Si hay más muestras que sitio, se agrupan por el pico
      // de cada tramo: así la onda se ve aunque el hueco sea estrecho (el
      // mini-reproductor de modo estudio comparte fila con la fecha).
      var n = Math.min(vals.length, 32);
      var comp = [];
      if (n >= vals.length) {
        comp = vals.slice();
      } else {
        var paso = vals.length / n;
        for (var b = 0; b < n; b++) {
          var ini = Math.floor(b * paso), fin = Math.floor((b + 1) * paso), pk = 0;
          for (var j = ini; j < fin; j++) if (vals[j] > pk) pk = vals[j];
          comp.push(pk);
        }
      }
      onda.innerHTML = '';
      barras = [];
      comp.forEach(function (p) {
        var i = document.createElement('i');
        i.style.setProperty('--h', Math.round(Math.max(0.2, p) * 100) + '%');
        onda.appendChild(i);
        barras.push(i);
      });
      pintaOnda(barra.value / 1000 || 0);
    }

    onda && onda.addEventListener('click', function (ev) {
      if (!barras.length) return;
      var r = onda.getBoundingClientRect();
      var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      var pct = Math.max(0, Math.min(1, x / r.width));
      var d = dur();
      if (d) { audio.currentTime = pct * d; pintaOnda(pct); }
    });

    // Una onda "plana" (todo el pico casi a cero) es basura de la medición
    // antigua: la tratamos como si no hubiera y la recalculamos del audio.
    function ondaUtil(vals) {
      if (!vals || !vals.length) return false;
      var max = 0;
      for (var i = 0; i < vals.length; i++) if (vals[i] > max) max = vals[i];
      return max >= 0.05;
    }

    if (ondaUtil(picos)) {
      dibujarOnda(picos);
    } else if (onda) {
      // Grabación sin onda guardada (datos viejos o medición fallida): la
      // calculamos decodificando el propio archivo. No dependemos de que el
      // <audio> llegue a decodificar (con webm/opus y preload="metadata"
      // puede no pasar de los metadatos hasta que se pulsa play), así que
      // en cuanto haya `src` lo leemos nosotros con fetch + decodeAudioData.
      var intento = 0;
      var probar = function () {
        var src = audio.currentSrc || audio.src;
        if (!src || barras.length) return;
        ondaDesdeAudio(src).then(function (vals) {
          if (vals && vals.length && !barras.length) dibujarOnda(vals);
        }).catch(function () {});
      };
      audio.addEventListener('loadstart', probar);
      audio.addEventListener('loadeddata', probar);
      // Red de seguridad: el src se asigna justo después de montar().
      var t = setInterval(function () {
        intento++;
        probar();
        if (barras.length || intento > 20) clearInterval(t);
      }, 150);
    }

    function pintaOnda(pct) {
      var corte = pct * barras.length;
      for (var i = 0; i < barras.length; i++) {
        barras[i].classList.toggle('is-hecho', i < corte);
      }
    }

    function pinta(pct) {
      barra.style.setProperty('--pct', (Math.max(0, Math.min(1, pct)) * 100).toFixed(1) + '%');
      if (barras.length) pintaOnda(Math.max(0, Math.min(1, pct)));
    }
    function dur() {
      return isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (durInicial || 0);
    }

    // Las grabaciones webm/opus de MediaRecorder llegan con duration === Infinity
    // y sin rango "seekable": al asignar currentTime el WebView lo ignora y la
    // barra vuelve a 0. Truco conocido: saltar a un tiempo enorme fuerza al
    // navegador a indexar el archivo y rellenar duration + seekable.
    var duracionArreglada = false;
    function arreglarDuracion() {
      if (duracionArreglada) return;
      if (audio.duration === Infinity || isNaN(audio.duration)) {
        duracionArreglada = true;
        var alPrincipio = function () {
          audio.removeEventListener('timeupdate', alPrincipio);
          audio.currentTime = 0;
        };
        audio.addEventListener('timeupdate', alPrincipio);
        try { audio.currentTime = 1e101; } catch (e) {}
      } else {
        duracionArreglada = true;
      }
    }

    tiempo.textContent = fmt(durInicial);
    pinta(0);

    btn.addEventListener('click', function () {
      if (audio.paused) audio.play(); else audio.pause();
    });
    audio.addEventListener('play', function () { mp.classList.add('is-sonando'); });
    audio.addEventListener('pause', function () { mp.classList.remove('is-sonando'); });
    audio.addEventListener('ended', function () {
      mp.classList.remove('is-sonando');
      audio.currentTime = 0;
      pinta(0);
      tiempo.textContent = fmt(dur());
    });
    audio.addEventListener('loadedmetadata', function () {
      barra.disabled = false;
      if (!arrastrando) tiempo.textContent = fmt(dur());
    });
    audio.addEventListener('timeupdate', function () {
      if (arrastrando) return;
      var d = dur();
      if (d) {
        var r = audio.currentTime / d;
        barra.value = Math.round(r * 1000);
        pinta(r);
        tiempo.textContent = fmt(d - audio.currentTime);
      }
    });
    barra.addEventListener('input', function () {
      arrastrando = true;
      var d = dur();
      pinta(barra.value / 1000);
      if (d) tiempo.textContent = fmt(d - (barra.value / 1000) * d);
    });
    barra.addEventListener('change', function () {
      var d = dur();
      if (d) audio.currentTime = (barra.value / 1000) * d;
      arrastrando = false;
    });
  }

  return { plantilla: plantilla, montar: montar };
})();
