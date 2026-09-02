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

  /* Controles del sistema (pantalla de bloqueo / notificación estilo Spotify).
     Usa la Media Session API: funciona en el WebView de Android y en Chrome.
     `meta` = { titulo, compositor }. `acciones` = { alternar, retroceder,
     adelantar, irA }. */
  function conectarMediaSession(audio, meta, acciones) {
    if (!('mediaSession' in navigator)) return function () {};
    var ms = navigator.mediaSession;
    meta = meta || {};

    try {
      ms.metadata = new window.MediaMetadata({
        title: meta.titulo || 'Canción',
        artist: meta.compositor || 'Coro Bihotsak',
        album: 'ChorApp',
      });
    } catch (e) { /* MediaMetadata puede no existir */ }

    function fija(accion, fn) {
      try { ms.setActionHandler(accion, fn); } catch (e) {}
    }
    fija('play', function () { acciones.alternar(); });
    fija('pause', function () { acciones.alternar(); });
    fija('seekbackward', function (d) { acciones.retroceder((d && d.seekOffset) || 5); });
    fija('seekforward', function (d) { acciones.adelantar((d && d.seekOffset) || 5); });
    fija('previoustrack', function () { acciones.retroceder(5); });
    fija('nexttrack', function () { acciones.adelantar(5); });
    fija('seekto', function (d) {
      if (d && typeof d.seekTime === 'number') acciones.irA(d.seekTime);
    });

    function sincronizar() {
      ms.playbackState = (!audio.paused && !audio.ended) ? 'playing' : 'paused';
      try {
        if (isFinite(audio.duration) && audio.duration > 0) {
          ms.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(audio.currentTime || 0, audio.duration),
          });
        }
      } catch (e) {}
    }
    audio.addEventListener('play', sincronizar);
    audio.addEventListener('pause', sincronizar);
    audio.addEventListener('timeupdate', sincronizar);
    audio.addEventListener('loadedmetadata', sincronizar);

    return function desconectar() {
      ['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack',
       'nexttrack', 'seekto'].forEach(function (a) { fija(a, null); });
      try { ms.metadata = null; } catch (e) {}
      audio.removeEventListener('play', sincronizar);
      audio.removeEventListener('pause', sincronizar);
      audio.removeEventListener('timeupdate', sincronizar);
      audio.removeEventListener('loadedmetadata', sincronizar);
    };
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
    var desconectarMS = conectarMediaSession(audio, cb.meta, {
      alternar: alternar, retroceder: retroceder, adelantar: adelantar, irA: irA,
    });

    function destruir() {
      desconectarMS();
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
