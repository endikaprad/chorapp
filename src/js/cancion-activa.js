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
  var forzarBarra = false;  // el modo estudio pide la barra aunque su vista esté abierta
                            // (p. ej. Maite ha bajado y ya no ve el reproductor de la página)
  var oculta = false;       // alguien (p. ej. la hoja de añadir canción/sesión) pide
                            // esconder la barra flotante mientras esté en pantalla
  var ultimoEstado = { reproduciendo: false, actual: 0, total: 0, velocidad: 1, bucle: null };
  var barra = null;         // UI flotante (o null si aún no se creó)
  var arrastrandoBarra = false; // Maite tiene el dedo en la barra de progreso
  var bucleVentana = false; // "repetir la canción entera sin parar": al llegar
                            // al final de la ventana vuelve al principio. Lo
                            // alternan el botón del modo estudio y el de la
                            // notificación del móvil; persiste al navegar.
  var recorte = null;       // { ini, fin } en segundos: la canción es un TROZO
                            // del audio (una marca dentro del ensayo). La barra
                            // flotante trabaja relativa a esa ventana, no al
                            // ensayo entero. fin == null => hasta el final.

  // Ventana real de la canción dentro del audio, resolviendo el fin abierto
  // con la duración total conocida.
  function ventana(s) {
    var total = (s && s.total) || ultimoEstado.total || 0;
    if (!recorte) return { ini: 0, fin: total, span: total };
    var ini = Math.max(0, recorte.ini || 0);
    var fin = (recorte.fin != null && recorte.fin > ini) ? recorte.fin : total;
    return { ini: ini, fin: fin, span: Math.max(0, fin - ini) };
  }

  /* ---------- Suscripción / difusión de estado ---------- */

  function suscribir(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    try { fn(ultimoEstado); } catch (e) {}
    return function () { subs = subs.filter(function (f) { return f !== fn; }); };
  }

  function emitir(s) {
    // Anota en la bitácora cada vez que la canción PASA a sonar (no cada tick).
    if (s && s.reproduciendo && !ultimoEstado.reproduciendo && cancionActual && window.Diario) {
      window.Diario.registrar('reproduccion', {
        sesionId: cancionActual.id,
        titulo: cancionActual.titulo,
      });
    }
    s.repite = bucleVentana;
    // Repetir la canción entera: al llegar al final de su ventana, al principio.
    if (bucleVentana && s.reproduciendo) {
      var w = ventana(s);
      if (w.fin > w.ini && s.actual >= w.fin - 0.15) {
        proxy('irA')(w.ini);
        return;
      }
    }
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

  // cancion: objeto con { id, titulo, compositor, abrir? }.
  //   abrir: { ruta, datos } al que vuelve la barra flotante al tocar el
  //          título (por defecto, el modo estudio con { id }).
  // fuenteUrl: object URL del MP3, o una promesa que resuelve a él.
  function cargar(cancion, fuenteUrl) {
    if (!cancion || !cancion.id) return Promise.resolve();

    var abrir = cancion.abrir || { ruta: 'estudio', datos: { id: cancion.id } };

    // Ya está cargada y sonando: no la reiniciamos, solo refrescamos metadatos.
    if (mismaCancion(cancion.id) && audio) {
      cancionActual.titulo = cancion.titulo;
      cancionActual.compositor = cancion.compositor;
      cancionActual.abrir = abrir;
      recorte = cancion.recorte || null;
      metaBarra();
      pintarBarra(ultimoEstado);
      return Promise.resolve();
    }

    descartar(); // corta la anterior y libera su URL

    cancionActual = {
      id: cancion.id,
      titulo: cancion.titulo || 'Canción',
      compositor: cancion.compositor || '',
      abrir: abrir,
    };
    recorte = cancion.recorte || null;

    audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.setAttribute('data-audio-global', '');
    document.body.appendChild(audio);

    control = window.Reproductor.crear(audio, {
      meta: { titulo: cancionActual.titulo, compositor: cancionActual.compositor },
      onEstado: emitir,
      onAlternarBucle: alternarBucle,   // botón "loop" de la notificación
    });
    if (control.marcarBucle) control.marcarBucle(bucleVentana);

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
    recorte = null;
    bucleVentana = false;
    forzarBarra = false;
    ultimoEstado = { reproduciendo: false, actual: 0, total: 0, velocidad: 1, bucle: null };
    ocultarBarra();
    // Avisar a quien esté escuchando (p. ej. el modo estudio, para recolocar
    // su contenido ahora que ya no hay barra flotante).
    try { document.dispatchEvent(new CustomEvent('chorapp:cancion-descartada')); } catch (e) {}
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

  function bucleActivo() { return bucleVentana; }

  // Alterna "repetir la canción entera". Si se activa estando al final (o antes
  // del principio de la ventana), rebobina para que empiece a repetir ya.
  function fijarBucleVentana(on) {
    bucleVentana = !!on;
    if (control && control.marcarBucle) control.marcarBucle(bucleVentana);
    if (bucleVentana) {
      var w = ventana(ultimoEstado);
      var t = ultimoEstado.actual || 0;
      if (w.span && (t >= w.fin - 0.3 || t < w.ini)) proxy('irA')(w.ini);
      if (!ultimoEstado.reproduciendo) proxy('alternar')();
    }
    ultimoEstado.repite = bucleVentana;
    emitir(ultimoEstado);
  }
  function alternarBucle() { fijarBucleVentana(!bucleVentana); }

  /* ---------- Vista de estudio abierta / cerrada ---------- */

  function fijarVistaAbierta(abierta) {
    vistaAbierta = !!abierta;
    if (!vistaAbierta) forzarBarra = false;
    evaluarBarra();
  }

  // El modo estudio pide (o retira) la barra flotante aunque su vista siga
  // montada: se usa cuando Maite baja y el reproductor de la página deja de
  // verse. La barra entra con su misma animación de deslizar + fundido.
  function fijarForzarBarra(f) {
    f = !!f;
    if (f === forzarBarra) return;
    forzarBarra = f;
    evaluarBarra();
  }

  // Esconde/restaura la barra flotante a petición externa (hojas de alta de
  // canción o sesión). No para el audio: solo oculta la UI.
  function fijarOculta(o) {
    o = !!o;
    if (o === oculta) return;
    oculta = o;
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
      '<button type="button" class="barra-repro__vel" data-br-vel aria-label="Cambiar velocidad">1×</button>' +
      '<button type="button" class="barra-repro__cerrar" data-br-cerrar aria-label="Cerrar y detener">✕</button>';

    document.body.appendChild(barra);

    barra.querySelector('[data-br-abrir]').addEventListener('click', function () {
      if (cancionActual && window.App) {
        var a = cancionActual.abrir || { ruta: 'estudio', datos: { id: cancionActual.id } };
        window.App.ir(a.ruta, { datos: a.datos });
      }
    });
    barra.querySelector('[data-br-play]').addEventListener('click', function () { proxy('alternar')(); });

    var prog = barra.querySelector('[data-br-prog]');
    // Mientras Maite arrastra NO tocamos audio.currentTime en cada 'input':
    // el timeupdate seguiría llegando con la posición vieja y pintarBarra
    // devolvería el pulgar al inicio. Solo movemos la reproducción al soltar.
    prog.addEventListener('input', function () {
      arrastrandoBarra = true;
      prog.style.setProperty('--pct', (prog.value / 10) + '%');
    });
    var soltar = function () {
      if (!arrastrandoBarra) return;
      arrastrandoBarra = false;
      var w = ventana(ultimoEstado);
      if (w.span) proxy('irA')(w.ini + (prog.value / 1000) * w.span);
    };
    prog.addEventListener('change', soltar);
    prog.addEventListener('pointerup', soltar);
    prog.addEventListener('touchend', soltar);
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

  /* RENDIMIENTO — esto se ejecuta en cada `timeupdate` (unas 4 veces por
     segundo) durante TODA la canción. Hacía cinco `querySelector` cada vez
     y reescribía valores que casi nunca cambian (la velocidad, los iconos),
     y `setProperty` de una variable CSS obliga a recalcular estilo. Se
     cachean los nodos y solo se escribe lo que de verdad ha cambiado. */
  var _br = null;
  function refsBarra() {
    if (!barra) return null;
    if (!_br || _br.raiz !== barra) {
      _br = {
        raiz: barra,
        icPlay: barra.querySelector('.br-ic-play'),
        icPause: barra.querySelector('.br-ic-pause'),
        play: barra.querySelector('[data-br-play]'),
        vel: barra.querySelector('[data-br-vel]'),
        prog: barra.querySelector('[data-br-prog]'),
        vSonando: null, vVel: null, vProg: null, vPct: null
      };
    }
    return _br;
  }

  function pintarBarra(s) {
    var R = refsBarra();
    if (!R) return;
    if (R.vSonando !== s.reproduciendo) {
      R.vSonando = s.reproduciendo;
      R.icPlay.toggleAttribute('hidden', s.reproduciendo);
      R.icPause.toggleAttribute('hidden', !s.reproduciendo);
      R.play.classList.toggle('is-sonando', s.reproduciendo);
      R.play.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
    }
    var vel = fmtVel(s.velocidad);
    if (R.vVel !== vel) { R.vVel = vel; R.vel.textContent = vel; }

    var w = ventana(s);
    var pct = w.span ? Math.max(0, Math.min(1, (s.actual - w.ini) / w.span)) : 0;
    if (!arrastrandoBarra && !R.prog.matches(':active')) {
      var v = String(Math.round(pct * 1000));
      if (R.vProg !== v) { R.vProg = v; R.prog.value = v; }
      // La barra mide ~300 px: por debajo de una décima de porcentaje no se
      // mueve ni un píxel, así que no merece un recálculo de estilo.
      var cs = (pct * 100).toFixed(1) + '%';
      if (R.vPct !== cs) { R.vPct = cs; R.prog.style.setProperty('--pct', cs); }
    }
  }

  // ¿Debe verse la barra? Hay canción cargada y el modo estudio de esa
  // canción NO está en pantalla.
  function evaluarBarra() {
    if (!oculta && audio && urlActual && cancionActual && (!vistaAbierta || forzarBarra)) mostrarBarra();
    else ocultarBarra();
  }

  function debeVerse() {
    return !!(!oculta && barra && audio && urlActual && cancionActual && (!vistaAbierta || forzarBarra));
  }

  function mostrarBarra() {
    var recienCreada = !barra;
    crearBarra();
    metaBarra();
    if (recienCreada) void barra.offsetWidth;   // reflow: que la transición de entrada arranque
    // pequeño respiro y revalidación por si volvió a abrirse el modo estudio.
    setTimeout(function () {
      if (debeVerse()) {
        barra.classList.add('is-visible');
        document.body.classList.add('con-barra-repro');
      }
    }, 20);
  }

  function ocultarBarra() {
    if (barra) barra.classList.remove('is-visible');
    document.body.classList.remove('con-barra-repro');
  }

  /* ---------- API pública ---------- */

  return {
    cargar: cargar,
    descartar: descartar,
    suscribir: suscribir,
    fijarVistaAbierta: fijarVistaAbierta,
    fijarForzarBarra: fijarForzarBarra,
    fijarOculta: fijarOculta,
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
    alternarBucle: alternarBucle,
    bucleActivo: bucleActivo,
    get reproduciendo() { return !!(control && control.reproduciendo); },
  };
})();
