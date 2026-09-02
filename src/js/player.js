/* ============================================================
   player.js — Reproductor de audio del modo estudio.
   Controles: play/pausa, −5 s, velocidad regulable 0.25x – 2.5x
   con una barra deslizante.

   window.Reproductor.crear(elAudio, callbacks) devuelve un
   controlador. La UI (botones, barra) la pinta pages/study.js;
   aquí solo vive la lógica del <audio>.
   ============================================================ */

window.Reproductor = (function () {
  'use strict';

  var VEL_MIN = 0.25;
  var VEL_MAX = 2.5;
  var VEL_PASO = 0.05;

  function limitarVel(v) {
    v = Math.round((v || 1) / VEL_PASO) * VEL_PASO;
    return Math.min(VEL_MAX, Math.max(VEL_MIN, Number(v.toFixed(2))));
  }

  function crear(audio, cb) {
    cb = cb || {};
    var velocidad = 1;

    function emitir() {
      if (cb.onEstado) cb.onEstado({
        reproduciendo: !audio.paused && !audio.ended,
        actual: audio.currentTime || 0,
        total: isFinite(audio.duration) ? audio.duration : 0,
        velocidad: velocidad,
      });
    }

    audio.addEventListener('timeupdate', emitir);
    audio.addEventListener('play', emitir);
    audio.addEventListener('pause', emitir);
    audio.addEventListener('ended', emitir);
    audio.addEventListener('loadedmetadata', emitir);

    function alternar() {
      if (audio.paused || audio.ended) audio.play(); else audio.pause();
    }
    function retroceder(seg) {
      audio.currentTime = Math.max(0, (audio.currentTime || 0) - (seg || 5));
      emitir();
    }
    function adelantar(seg) {
      var tope = isFinite(audio.duration) ? audio.duration : Infinity;
      audio.currentTime = Math.min(tope, (audio.currentTime || 0) + (seg || 5));
      emitir();
    }
    function irA(seg) {
      if (isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, Math.max(0, seg));
        emitir();
      }
    }
    function fijarVelocidad(v) {
      velocidad = limitarVel(v);
      audio.playbackRate = velocidad;
      emitir();
      return velocidad;
    }
    function destruir() {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    return {
      alternar: alternar,
      retroceder: retroceder,
      adelantar: adelantar,
      irA: irA,
      fijarVelocidad: fijarVelocidad,
      destruir: destruir,
      get reproduciendo() { return !audio.paused && !audio.ended; },
    };
  }

  return { crear: crear, VEL_MIN: VEL_MIN, VEL_MAX: VEL_MAX, VEL_PASO: VEL_PASO };
})();
