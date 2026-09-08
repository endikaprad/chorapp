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

     OJO: el WebView de Android NO implementa la Media Session API de la web,
     así que `navigator.mediaSession` no pinta ninguna notificación en el móvil.
     Para eso hace falta el plugin nativo `@jofr/capacitor-media-session`, que
     Capacitor expone en `window.Capacitor.Plugins.MediaSession`. Si está,
     lo usamos; si no (navegador de escritorio), caemos a `navigator.mediaSession`.

     `meta` = { titulo, compositor }. `acciones` = { alternar, retroceder,
     adelantar, irA }. */
  function conectarMediaSession(audio, meta, acciones) {
    meta = meta || {};
    var nativo = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MediaSession;
    var web = ('mediaSession' in navigator) ? navigator.mediaSession : null;
    if (!nativo && !web) return function () {};

    // OJO: @jofr/capacitor-media-session peta con NullPointerException si se
    // llama a setMetadata SIN la clave `artwork` (hace artwork.toList() sin
    // comprobar null → cierra la app entera). Siempre debe ir, aunque vacío.
    var metadatos = {
      title: meta.titulo || 'Canción',
      artist: meta.compositor || 'Coro Bihotsak',
      album: 'ChorApp',
      artwork: [],
    };

    var manejadores = {
      play: function () { acciones.alternar(); },
      pause: function () { acciones.alternar(); },
      seekbackward: function (d) { acciones.retroceder((d && d.seekOffset) || 5); },
      seekforward: function (d) { acciones.adelantar((d && d.seekOffset) || 5); },
      seekto: function (d) { if (d && typeof d.seekTime === 'number') acciones.irA(d.seekTime); },
      // OJO: NO registramos previoustrack/nexttrack. En el reproductor de
      // Android (notificación / pantalla de bloqueo) esos handlers pintan los
      // iconos de "canción anterior / siguiente", que aquí no tienen sentido:
      // no hay lista de reproducción, solo una canción que se estudia. Dejamos
      // solo seek(backward|forward) → botones de retroceder / adelantar 5 s.
      // Para que esos botones salgan también en la vista COMPACTA de la
      // notificación (la que se ve al salir de la app), scripts/android-fix.js
      // parchea `possibleCompactViewActions` del plugin @jofr/capacitor-media-session.
    };
    var acis = Object.keys(manejadores);

    // --- Plugin nativo (@jofr/capacitor-media-session) ---
    // No tocamos el plugin hasta la 1ª reproducción real: así su servicio en
    // primer plano (tipo "mediaPlayback") solo arranca cuando de verdad suena
    // algo, que es lo que Android espera.
    var nativoListo = false;

    function initNativo() {
      if (nativoListo || !nativo) return;
      nativoListo = true;
      try {
        nativo.setMetadata(metadatos);
        acis.forEach(function (a) {
          try { nativo.setActionHandler({ action: a }, manejadores[a]); } catch (e) {}
        });
      } catch (e) { nativoListo = false; }
    }

    if (!nativo && web) {
      try {
        web.metadata = new window.MediaMetadata(metadatos);
      } catch (e) {}
      acis.forEach(function (a) {
        try { web.setActionHandler(a, manejadores[a]); } catch (e) {}
      });
    }

    function sincronizar() {
      var sonando = !audio.paused && !audio.ended;
      var pos = null;
      if (isFinite(audio.duration) && audio.duration > 0) {
        pos = {
          duration: audio.duration,
          playbackRate: audio.playbackRate || 1,
          position: Math.min(audio.currentTime || 0, audio.duration),
        };
      }
      if (nativo) {
        // Hasta la 1ª reproducción no despertamos el servicio nativo.
        if (!nativoListo) {
          if (!sonando) return;
          initNativo();
          if (!nativoListo) return;
        }
        try {
          nativo.setPlaybackState({ playbackState: sonando ? 'playing' : 'paused' });
          if (pos) nativo.setPositionState(pos);
        } catch (e) {}
      } else {
        web.playbackState = sonando ? 'playing' : 'paused';
        try { if (pos) web.setPositionState(pos); } catch (e) {}
      }
    }
    audio.addEventListener('play', sincronizar);
    audio.addEventListener('pause', sincronizar);
    audio.addEventListener('timeupdate', sincronizar);
    audio.addEventListener('loadedmetadata', sincronizar);

    return function desconectar() {
      audio.removeEventListener('play', sincronizar);
      audio.removeEventListener('pause', sincronizar);
      audio.removeEventListener('timeupdate', sincronizar);
      audio.removeEventListener('loadedmetadata', sincronizar);
      if (nativo) {
        if (!nativoListo) return;
        try { nativo.setPlaybackState({ playbackState: 'none' }); } catch (e) {}
        acis.forEach(function (a) {
          try { nativo.setActionHandler({ action: a }, null); } catch (e) {}
        });
      } else {
        acis.forEach(function (a) {
          try { web.setActionHandler(a, null); } catch (e) {}
        });
        try { web.metadata = null; } catch (e) {}
      }
    };
  }

  function crear(audio, cb) {
    cb = cb || {};
    var velocidad = 1;
    var bucle = null;   // { a, b } en segundos: repite ese trozo sin parar

    function emitir() {
      if (cb.onEstado) cb.onEstado({
        reproduciendo: !audio.paused && !audio.ended,
        actual: audio.currentTime || 0,
        total: isFinite(audio.duration) ? audio.duration : 0,
        velocidad: velocidad,
        bucle: bucle ? { a: bucle.a, b: bucle.b } : null,
      });
    }

    // Bucle A–B: al llegar a B se vuelve a A. Se comprueba en cada
    // timeupdate (~4/s), suficiente para estudiar un pasaje.
    audio.addEventListener('timeupdate', function () {
      if (bucle && (audio.currentTime || 0) >= bucle.b) {
        audio.currentTime = bucle.a;
      }
    });

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
    function fijarBucle(a, b) {
      a = Math.max(0, Number(a) || 0);
      b = Number(b) || 0;
      if (!(b > a + 0.2)) return null;
      bucle = { a: a, b: b };
      if ((audio.currentTime || 0) < a || (audio.currentTime || 0) >= b) {
        audio.currentTime = a;
      }
      emitir();
      return { a: a, b: b };
    }
    function quitarBucle() {
      bucle = null;
      emitir();
    }
    var desconectarMS = conectarMediaSession(audio, cb.meta, {
      alternar: alternar, retroceder: retroceder, adelantar: adelantar, irA: irA,
    });

    function destruir() {
      bucle = null;
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
      fijarBucle: fijarBucle,
      quitarBucle: quitarBucle,
      destruir: destruir,
      get reproduciendo() { return !audio.paused && !audio.ended; },
    };
  }

  return { crear: crear, VEL_MIN: VEL_MIN, VEL_MAX: VEL_MAX, VEL_PASO: VEL_PASO };
})();
