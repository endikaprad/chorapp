/* ============================================================
   wrapped-audio.js — El sonido del Wrapped.

   Dos capas:
   1. Música de fondo, generada al vuelo por wrapped-music.js (una
      paleta por mes; versión especial para el Wrapped anual). No hay
      archivos: siempre suena, sin depender de assets.
   2. Cuando un slide habla de una canción concreta de Maite, esa
      canción suena unos segundos —empezando por la mitad, no desde el
      principio— por encima de la música de fondo, que baja de volumen.
      Al cambiar de slide se vuelve a la música de fondo.

   La canción de Maite se saca de sus sesiones: se busca por título en
   window.Canciones, se pide la última marca (window.Sesiones) y se
   reproduce el audio de esa sesión (window.Archivos) saltando a la
   mitad de la marca.

   API (la usa js/wrapped.js):
     WrappedAudio.iniciar(mes)          mes 0-11 | 'anual'
     WrappedAudio.estandar()            volver a la música de fondo
     WrappedAudio.pista(titulo, cb)     sonar la canción de Maite (cb(ok))
     WrappedAudio.desbloquear()         reintentar tras un gesto
     WrappedAudio.alternarSilencio()    -> nuevo estado (bool)
     WrappedAudio.silenciado()          -> bool
     WrappedAudio.parar()               cortar todo
   ============================================================ */

window.WrappedAudio = (function () {
  'use strict';

  var CLAVE_MUTE = 'chorapp:wrapped:mute';
  var NIVEL_FONDO = 1;        // música de fondo a tope (wrapped-music ya la deja suave)
  var NIVEL_FONDO_BAJO = 0.14; // mientras suena una canción de Maite
  var VOL_CANCION = 0.9;

  var clip = null;       // <audio> de la canción de Maite
  var clipUrl = null;    // object URL a liberar
  var pistaActual = null;
  var muteo = false;
  var reanudarActiva = false;  // había una canción de Maite sonando al abrir

  function leerMute() {
    try { return localStorage.getItem(CLAVE_MUTE) === '1'; } catch (e) { return false; }
  }
  function guardarMute(v) {
    try { localStorage.setItem(CLAVE_MUTE, v ? '1' : '0'); } catch (e) {}
  }
  function norm(s) {
    s = (s == null ? '' : String(s)).toLowerCase().trim();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }
  function intentarPlay(a) {
    if (!a) return;
    try { var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  function fade(a, destino, ms, cb) {
    if (!a) { if (cb) cb(); return; }
    var ini = a.volume || 0;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    a._fadeId = (a._fadeId || 0) + 1;
    var mio = a._fadeId;
    function paso() {
      if (a._fadeId !== mio) return;
      var ahora = (window.performance && performance.now) ? performance.now() : Date.now();
      var k = ms <= 0 ? 1 : Math.min(1, (ahora - t0) / ms);
      try { a.volume = Math.max(0, Math.min(1, ini + (destino - ini) * k)); } catch (e) {}
      if (k < 1) requestAnimationFrame(paso);
      else if (cb) cb();
    }
    requestAnimationFrame(paso);
  }
  function liberarClipUrl() {
    if (clipUrl && window.Archivos) window.Archivos.liberar(clipUrl);
    clipUrl = null;
  }
  function fondoNivel(v) {
    if (window.WrappedMusic) { try { window.WrappedMusic.nivel(v); } catch (e) {} }
  }

  /* ---------- arranque ---------- */
  function iniciar(mes) {
    parar();
    muteo = leerMute();

    // Pausar la canción de Maite (barra flotante) y recuperarla al cerrar.
    reanudarActiva = false;
    try {
      if (window.CancionActiva && window.CancionActiva.reproduciendo) {
        window.CancionActiva.alternar();
        reanudarActiva = true;
      }
    } catch (e) {}

    if (window.WrappedMusic) {
      try {
        window.WrappedMusic.iniciar(mes);
        window.WrappedMusic.nivel(muteo ? 0 : NIVEL_FONDO);
      } catch (e) {}
    }
  }

  function desbloquear() {
    if (window.WrappedMusic) { try { window.WrappedMusic.reanudar(); } catch (e) {} }
    if (clip && clip.paused && pistaActual) intentarPlay(clip);
  }

  /* ---------- volver a la música de fondo ---------- */
  function estandar() {
    pistaActual = null;
    if (clip) {
      var c = clip;
      fade(c, 0, 280, function () { try { c.pause(); } catch (e) {} });
    }
    fondoNivel(muteo ? 0 : NIVEL_FONDO);
  }

  /* ---------- sonar una canción de Maite ---------- */
  function pista(titulo, cb) {
    cb = typeof cb === 'function' ? cb : function () {};
    if (pistaActual === titulo) { cb(true); return; }
    pistaActual = titulo;

    resolver(titulo).then(function (r) {
      if (pistaActual !== titulo) return;
      if (!r) { cb(false); return; }

      fondoNivel(muteo ? 0 : NIVEL_FONDO_BAJO);

      if (!clip) {
        clip = new Audio();
        clip.preload = 'auto';
        clip.addEventListener('error', function () {});
      }
      liberarClipUrl();
      clipUrl = r.url;
      clip.src = r.url;
      clip.volume = 0;

      var saltado = false;
      function alPunto() {
        if (saltado) return;
        saltado = true;
        var seek = r.seek;
        if (isFinite(clip.duration) && clip.duration > 15) seek = Math.min(seek, clip.duration - 8);
        try { clip.currentTime = Math.max(0, seek || 0); } catch (e) {}
      }
      clip.onloadedmetadata = alPunto;

      intentarPlay(clip);
      if (!muteo) fade(clip, VOL_CANCION, 380);
      if (isFinite(clip.duration) && clip.duration > 0) alPunto();
      cb(true);
    }).catch(function () { cb(false); });
  }

  // titulo -> { url, seek } | null
  function resolver(titulo) {
    if (!titulo || !window.Canciones || !window.Sesiones || !window.Archivos) {
      return Promise.resolve(null);
    }
    var n = norm(titulo);
    var lista = window.Canciones.listar();
    var c = null;
    for (var i = 0; i < lista.length; i++) {
      if (norm(lista[i].titulo) === n) { c = lista[i]; break; }
    }
    if (!c) {
      for (var j = 0; j < lista.length; j++) {
        if (norm(lista[j].titulo).indexOf(n) === 0) { c = lista[j]; break; }
      }
    }
    if (!c) return Promise.resolve(null);

    var ref = window.Sesiones.ultimaMarcaDeCancion
      ? window.Sesiones.ultimaMarcaDeCancion(c.id) : null;
    if (!ref || !ref.sesion) return Promise.resolve(null);

    var m = ref.marca || {};
    var ini = m.segundo || 0;
    var seek = (m.finSegundo && m.finSegundo > ini)
      ? ini + (m.finSegundo - ini) * 0.4
      : ini + 35;

    return window.Archivos.url(ref.sesion.id + ':audio').then(function (u) {
      return u ? { url: u, seek: seek } : null;
    }).catch(function () { return null; });
  }

  /* ---------- silencio ---------- */
  function alternarSilencio() {
    muteo = !muteo;
    guardarMute(muteo);
    fondoNivel(muteo ? 0 : (pistaActual ? NIVEL_FONDO_BAJO : NIVEL_FONDO));
    if (clip && pistaActual) fade(clip, muteo ? 0 : VOL_CANCION, 200);
    return muteo;
  }
  function silenciado() { return muteo; }

  /* ---------- cierre ---------- */
  function parar() {
    pistaActual = null;
    if (window.WrappedMusic) { try { window.WrappedMusic.parar(); } catch (e) {} }
    if (clip) {
      try { clip.pause(); } catch (e) {}
      try { clip.src = ''; clip.load(); } catch (e) {}
      clip = null;
    }
    liberarClipUrl();
    if (reanudarActiva) {
      try { if (window.CancionActiva) window.CancionActiva.alternar(); } catch (e) {}
      reanudarActiva = false;
    }
  }

  return {
    iniciar: iniciar,
    estandar: estandar,
    pista: pista,
    desbloquear: desbloquear,
    alternarSilencio: alternarSilencio,
    silenciado: silenciado,
    parar: parar,
  };
})();
