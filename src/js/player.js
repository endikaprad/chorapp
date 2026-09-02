/* ============================================================
   player.js — Reproductor de audio del modo estudio.
   Controles: play/pausa, −5 s, velocidad 0.75x / 1x / 1.25x.

   window.Reproductor.crear(elAudio, callbacks) devuelve un
   controlador. La UI (botones, barra) la pinta pages/study.js;
   aquí solo vive la lógica del <audio>.
   ============================================================ */

window.Reproductor = (function () {
  'use strict';

  var VELOCIDADES = [0.75, 1, 1.25];

  function crear(audio, cb) {
    cb = cb || {};
    var velIdx = 1;

    function emitir() {
      if (cb.onEstado) cb.onEstado({
        reproduciendo: !audio.paused && !audio.ended,
        actual: audio.currentTime || 0,
        total: isFinite(audio.duration) ? audio.duration : 0,
        velocidad: VELOCIDADES[velIdx],
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
    function irA(seg) {
      if (isFinite(audio.duration)) {
        audio.currentTime = Math.min(audio.duration, Math.max(0, seg));
        emitir();
      }
    }
    function ciclarVelocidad() {
      velIdx = (velIdx + 1) % VELOCIDADES.length;
      audio.playbackRate = VELOCIDADES[velIdx];
      emitir();
      return VELOCIDADES[velIdx];
    }
    function destruir() {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    return {
      alternar: alternar,
      retroceder: retroceder,
      irA: irA,
      ciclarVelocidad: ciclarVelocidad,
      destruir: destruir,
      get reproduciendo() { return !audio.paused && !audio.ended; },
    };
  }

  return { crear: crear, VELOCIDADES: VELOCIDADES };
})();
