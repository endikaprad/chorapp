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
    if (onda && picos && picos.length) {
      barra.hidden = true;
      onda.hidden = false;
      onda.innerHTML = '';
      picos.forEach(function (p) {
        var i = document.createElement('i');
        i.style.setProperty('--h', Math.round(Math.max(0.08, p) * 100) + '%');
        onda.appendChild(i);
        barras.push(i);
      });
      var buscar = function (ev) {
        var r = onda.getBoundingClientRect();
        var x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        var pct = Math.max(0, Math.min(1, x / r.width));
        var d = dur();
        if (d) { audio.currentTime = pct * d; pintaOnda(pct); }
      };
      onda.addEventListener('click', buscar);
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
