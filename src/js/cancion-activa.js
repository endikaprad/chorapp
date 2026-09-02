/* ============================================================
   cancion-activa.js — window.CancionActiva

   La canción del modo estudio "vive" aquí, no dentro de la página.
   Así sigue sonando cuando Maite sale de estudio y navega por la
   app, y aparece una barra flotante (sobre el bottom nav) para
   pausar, retroceder 5 s y cambiar la velocidad sin volver a la
   pantalla. Al tocar el título vuelve al modo estudio de esa canción.

   El <audio> y la lógica (window.Reproductor) son de aquí; el modo
   estudio (js/pages/study.js) se engancha como una "vista":

     window.CancionActiva.cargar(cancion, urlDelMp3)   // o promesa
     var off = window.CancionActiva.suscribir(fn)      // estado -> UI
     window.CancionActiva.alternar() / retroceder(5) / irA(s) / ...
     window.CancionActiva.fijarVistaAbierta(true|false)

   El estado que llega a los suscriptores:
     { reproduciendo, actual, total, velocidad }
   ============================================================ */

window.CancionActiva = (function () {
  'use strict';

  var VELOCIDADES = [0.75, 1, 1.25, 1.5];

  var audio = null;         // <audio> persistente, colgado del <body>
  var control = null;       // instancia de window.Reproductor
  var cancionActual = null; // { id, titulo, compositor }
  var urlActual = null;     // object URL del MP3 en curso (se libera aquí)
  var subs = [];
  var vistaAbierta = false; // true mientras el modo estudio de ESTA canción está montado
  var ultimoEstado = { reproduciendo: false, actual: 0, total: 0, velocidad: 1, bucle: null };
  var barra = null;         // UI flotante (o null si aún no se creó)

  /* ---------- Suscripción / difusión de estado ---------- */

  function suscribir(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    try { fn(ultimoEstado); } catch (e) {}
    return function () { subs = subs.filter(function (f) { return f !== fn; }); };
  }

  function emitir(s) {
    ultimoEstado = s;
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](s); } catch (e) {}
    }
    pintarBarra(s);
  }

  function mismaCancion(id) {
    return !!(cancionActual && cancionActual.id === id);
  }

  /* ---------- Carga / descarte de la canción ---------- */

  // cancion: objeto con { id, titulo, compositor }.
  // fuenteUrl: object URL del MP3, o una promesa que resuelve a él.
  function cargar(cancion, fuenteUrl) {
    if (!cancion || !cancion.id) return Promise.resolve();

    // Ya está cargada y sonando: no la reiniciamos, solo refrescamos metadatos.
    if (mismaCancion(cancion.id) && audio) {
      cancionActual.titulo = cancion.titulo;
      cancionActual.compositor = cancion.compositor;
      metaBarra();
      return Promise.resolve();
    }

    descartar(); // corta la anterior y libera su URL

    cancionActual = {
      id: cancion.id,
      titulo: cancion.titulo || 'Canción',
      compositor: cancion.compositor || '',
    };

    audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.setAttribute('data-audio-global', '');
    document.body.appendChild(audio);

    control = window.Reproductor.crear(audio, {
      meta: { titulo: cancionActual.titulo, compositor: cancionActual.compositor },
      onEstado: emitir,
    });

    var id = cancion.id;
    return Promise.resolve(fuenteUrl).then(function (u) {
      // Puede haber cambiado de canción mientras resolvía la URL.
      if (!u) return;
      if (!mismaCancion(id) || !audio) { window.Archivos.liberar(u); return; }
      urlActual = u;
      audio.src = u;
      evaluarBarra();
    }).catch(function () {});
  }

  function descartar() {
    if (control) { try { control.destruir(); } catch (e) {} control = null; }
    if (audio && audio.parentNode) audio.parentNode.removeChild(audio);
    audio = null;
    if (urlActual) { window.Archivos.liberar(urlActual); urlActual = null; }
    cancionActual = null;
    ultimoEstado = { reproduciendo: false, actual: 0, total: 0, velocidad: 1, bucle: null };
    ocultarBarra();
  }

  /* ---------- Control (proxys; no hacen nada sin canción) ---------- */

  function proxy(metodo) {
    return function (arg) {
      if (control && typeof control[metodo] === 'function') return control[metodo](arg);
      return undefined;
    };
  }

  function siguienteVelocidad() {
    var actual = ultimoEstado.velocidad || 1;
    var idx = 0;
    for (var i = 0; i < VELOCIDADES.length; i++) {
      if (Math.abs(VELOCIDADES[i] - actual) < 0.001) { idx = i; break; }
      if (VELOCIDADES[i] <= actual) idx = i;
    }
    var v = VELOCIDADES[(idx + 1) % VELOCIDADES.length];
    return proxy('fijarVelocidad')(v);
  }

  /* ---------- Vista de estudio abierta / cerrada ---------- */

  function fijarVistaAbierta(abierta) {
    vistaAbierta = !!abierta;
    evaluarBarra();
  }

  /* ---------- Barra flotante ---------- */

  function crearBarra() {
    if (barra) return;
    barra = document.createElement('div');
    barra.className = 'barra-repro';
    barra.setAttribute('role', 'group');
    barra.setAttribute('aria-label', 'Canción en curso');
    barra.innerHTML =
      '<input type="range" class="barra-repro__prog" data-br-prog min="0" max="1000" value="0" step="1" aria-label="Posición de la canción">' +
      '<button type="button" class="barra-repro__info" data-br-abrir>' +
        '<span class="barra-repro__tit" data-br-tit></span>' +
        '<span class="barra-repro__sub" data-br-sub></span>' +
      '</button>' +
      '<button type="button" class="barra-repro__btn barra-repro__play" data-br-play aria-label="Reproducir">' +
        '<svg class="br-ic-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5a1 1 0 0 1 1.53-.85l12 7.5a1 1 0 0 1 0 1.7l-12 7.5A1 1 0 0 1 7 19.5z"/></svg>' +
        '<svg class="br-ic-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" hidden><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>' +
      '</button>' +
      '<span class="barra-repro__bucle" data-br-bucle hidden aria-label="Bucle activo">⟲</span>' +
      '<button type="button" class="barra-repro__vel" data-br-vel aria-label="Cambiar velocidad">1×</button>' +
      '<button type="button" class="barra-repro__cerrar" data-br-cerrar aria-label="Cerrar y detener">✕</button>';

    document.body.appendChild(barra);

    barra.querySelector('[data-br-abrir]').addEventListener('click', function () {
      if (cancionActual && window.App) window.App.ir('estudio', { datos: { id: cancionActual.id } });
    });
    barra.querySelector('[data-br-play]').addEventListener('click', function () { proxy('alternar')(); });

    var prog = barra.querySelector('[data-br-prog]');
    prog.addEventListener('input', function () {
      var t = ultimoEstado.total;
      prog.style.setProperty('--pct', (prog.value / 10) + '%');
      if (t) proxy('irA')((prog.value / 1000) * t);
    });
    barra.querySelector('[data-br-vel]').addEventListener('click', siguienteVelocidad);
    barra.querySelector('[data-br-cerrar]').addEventListener('click', descartar);

    metaBarra();
    pintarBarra(ultimoEstado);
  }

  function metaBarra() {
    if (!barra || !cancionActual) return;
    barra.querySelector('[data-br-tit]').textContent = cancionActual.titulo;
    var sub = barra.querySelector('[data-br-sub]');
    sub.textContent = cancionActual.compositor || 'Coro Bihotsak';
  }

  function fmtVel(v) {
    v = Math.round((v || 1) * 100) / 100;
    return (v % 1 === 0 ? v : v.toFixed(2).replace(/0$/, '')) + '×';
  }

  function pintarBarra(s) {
    if (!barra) return;
    barra.querySelector('.br-ic-play').toggleAttribute('hidden', s.reproduciendo);
    barra.querySelector('.br-ic-pause').toggleAttribute('hidden', !s.reproduciendo);
    var play = barra.querySelector('[data-br-play]');
    play.classList.toggle('is-sonando', s.reproduciendo);
    play.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
    barra.querySelector('[data-br-vel]').textContent = fmtVel(s.velocidad);
    barra.querySelector('[data-br-bucle]').toggleAttribute('hidden', !s.bucle);
    var prog = barra.querySelector('[data-br-prog]');
    var pct = s.total ? Math.max(0, Math.min(1, s.actual / s.total)) : 0;
    if (!prog.matches(':active')) {
      prog.value = String(Math.round(pct * 1000));
      prog.style.setProperty('--pct', (pct * 100).toFixed(1) + '%');
    }
  }

  // ¿Debe verse la barra? Hay canción cargada y el modo estudio de esa
  // canción NO está en pantalla.
  function evaluarBarra() {
    if (audio && urlActual && cancionActual && !vistaAbierta) mostrarBarra();
    else ocultarBarra();
  }

  function debeVerse() {
    return !!(barra && audio && urlActual && cancionActual && !vistaAbierta);
  }

  function mostrarBarra() {
    var recienCreada = !barra;
    crearBarra();
    metaBarra();
    if (recienCreada) void barra.offsetWidth;   // reflow: que la transición de entrada arranque
    // pequeño respiro y revalidación por si volvió a abrirse el modo estudio.
    setTimeout(function () { if (debeVerse()) barra.classList.add('is-visible'); }, 20);
  }

  function ocultarBarra() {
    if (barra) barra.classList.remove('is-visible');
  }

  /* ---------- API pública ---------- */

  return {
    cargar: cargar,
    descartar: descartar,
    suscribir: suscribir,
    fijarVistaAbierta: fijarVistaAbierta,
    estado: function () { return ultimoEstado; },
    cancionId: function () { return cancionActual && cancionActual.id; },
    hayCancion: function () { return !!(audio && urlActual); },
    alternar: proxy('alternar'),
    retroceder: proxy('retroceder'),
    adelantar: proxy('adelantar'),
    irA: proxy('irA'),
    fijarVelocidad: proxy('fijarVelocidad'),
    fijarBucle: function (a, b) {
      return (control && typeof control.fijarBucle === 'function')
        ? control.fijarBucle(a, b) : undefined;
    },
    quitarBucle: proxy('quitarBucle'),
    get reproduciendo() { return !!(control && control.reproduciendo); },
  };
})();
