/* ============================================================
   control-remoto.js — Canal privado hijo -> Maite.

   La app consulta cada pocos segundos una base de datos en la
   nube (Firebase Realtime Database, vía REST — sin SDK) mientras
   está abierta. Desde el panel privado (carpeta panel/, solo lo
   usa el hijo) se pueden:
     - lanzar un aviso corto que aparece en pantalla
       ("Baja un poco el volumen", etc.)
     - bloquear la app durante X minutos

   Maite no ve nada de esto: para ella es una app que, de vez en
   cuando, le muestra una nota o le pide una pausa.

   Requiere conexión (como el resto de la app). Si no hay red o no
   está configurado (`data/control.json` sin `dbUrl`), no hace nada.

   Se carga como script clásico y expone window.ControlRemoto.
   ============================================================ */

window.ControlRemoto = (function () {
  'use strict';

  var CLAVE_AVISO_VISTO = 'chorapp:control:avisoVisto';
  var CLAVE_NOTIF_VISTA = 'chorapp:control:notifVista';

  var cfg = null;          // { dbUrl, segundosSondeo, ventanaAvisoHoras }
  var temporizador = null; // id del setInterval de sondeo
  var relojBloqueo = null;  // id del setInterval del contador del bloqueo
  var capaBloqueo = null;   // nodo del overlay de bloqueo, si está puesto
  var bloqueoHasta = 0;     // epoch ms hasta el que la app está bloqueada
  var avisoEnPantalla = false;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------
     Sonido — se genera con la Web Audio API, sin archivos.
     'aviso'  : dos notas suaves ascendentes.
     'bloqueo': zumbido áspero y repetido, más agresivo.
     Los navegadores exigen un gesto previo para reproducir
     audio; enganchamos uno al primer toque de la usuaria.
     -------------------------------------------------------- */

  var audioCtx = null;
  var bloqueoSonado = 0;   // valor de `hasta` para el que ya sonó el aviso de bloqueo

  function ctx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  (function desbloquearAudio() {
    function unlock() {
      ctx();
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    }
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock);
  })();

  function tono(ac, freq, inicio, dur, tipo, volumen) {
    var osc = ac.createOscillator();
    var gan = ac.createGain();
    osc.type = tipo;
    osc.frequency.value = freq;
    var t0 = ac.currentTime + inicio;
    gan.gain.setValueAtTime(0, t0);
    gan.gain.linearRampToValueAtTime(volumen, t0 + 0.015);
    gan.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gan).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function reproducir(ac, tipo) {
    try {
      if (tipo === 'bloqueo') {
        // Tres ráfagas ásperas y disonantes.
        for (var i = 0; i < 3; i++) {
          var t = i * 0.22;
          tono(ac, 196, t, 0.16, 'sawtooth', 0.32);
          tono(ac, 208, t, 0.16, 'square', 0.22); // batido -> suena áspero
        }
      } else {
        tono(ac, 659, 0, 0.18, 'sine', 0.18);
        tono(ac, 988, 0.16, 0.28, 'sine', 0.16);
      }
    } catch (e) { /* sin audio: da igual */ }
  }

  function sonar(tipo) {
    var ac = ctx();
    if (!ac) return;
    // Si el contexto aún se está reanudando, programar tonos ahora da un
    // primer sonido comprimido/glitcheado y luego se repite. Esperamos a
    // que esté 'running' antes de reproducir.
    if (ac.state === 'running') {
      reproducir(ac, tipo);
      return;
    }
    var sonado = false;
    var lanzar = function () {
      if (sonado || ac.state !== 'running') return;
      sonado = true;
      reproducir(ac, tipo);
    };
    if (ac.resume) {
      try { ac.resume().then(lanzar, function () {}); } catch (e) {}
    }
    setTimeout(lanzar, 250); // respaldo por si `resume()` no resuelve
  }

  /* --------------------------------------------------------
     Arranque
     -------------------------------------------------------- */

  function iniciar() {
    fetch('data/control.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        cfg = json || {};
        if (!cfg.dbUrl) return; // función desactivada: sin configurar
        cfg.dbUrl = String(cfg.dbUrl).replace(/\/+$/, '');
        cfg.segundosSondeo = Math.max(5, cfg.segundosSondeo || 10);
        cfg.ventanaAvisoHoras = cfg.ventanaAvisoHoras || 6;
        cfg.ventanaNotifHoras = cfg.ventanaNotifHoras || 24;

        sondear();
        temporizador = setInterval(sondear, cfg.segundosSondeo * 1000);

        // Al volver a la app (pestaña visible o "resume" de Android)
        // consultamos enseguida, sin esperar al siguiente ciclo.
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) sondear();
        });
        var Cap = window.Capacitor;
        var App = Cap && Cap.Plugins && Cap.Plugins.App;
        if (App && App.addListener) {
          App.addListener('resume', sondear);
        }
      })
      .catch(function () { /* sin config: no pasa nada */ });
  }

  /* --------------------------------------------------------
     Sondeo: leer /control y /status de la base de datos
     -------------------------------------------------------- */

  function sondear() {
    if (!cfg || !cfg.dbUrl) return;

    fetch(cfg.dbUrl + '/control.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (control) {
        aplicarControl(control || {});
      })
      .catch(function () { /* sin red: se reintenta al siguiente ciclo */ });

    // Latido de vuelta: el panel puede ver que la app está abierta
    // y si el bloqueo está activo. Es "mejor esfuerzo": si falla, da igual.
    enviarEstado();
  }

  function aplicarControl(control) {
    var ahora = Date.now();

    // --- Bloqueo -------------------------------------------------
    var hasta = Number(control.bloqueoHasta) || 0;
    bloqueoHasta = hasta;
    if (hasta > ahora) {
      ponerBloqueo(hasta, control.motivoBloqueo || '');
    } else {
      quitarBloqueo();
    }

    // --- Aviso -------------------------------------------------
    var aviso = control.aviso;
    if (aviso && aviso.id && aviso.texto) {
      var visto = leerAvisoVisto();
      var frescura = ahora - (Number(aviso.fecha) || 0);
      var esNuevo = String(aviso.id) !== visto;
      var esReciente = frescura < cfg.ventanaAvisoHoras * 3600 * 1000;
      if (esNuevo && esReciente && !avisoEnPantalla) {
        mostrarAviso(aviso);
      }
    }

    // --- Notificación personalizada del panel -----------------
    // A diferencia del "aviso" (tarjeta en pantalla), esta sale como
    // notificación del sistema: le llega aunque tenga la app en 2º plano
    // o la abra más tarde dentro de la ventana de frescura.
    var notif = control.notif;
    if (notif && notif.id && notif.texto && window.Avisos && window.Avisos.emitir) {
      var vistaN = leerNotifVista();
      var frescN = ahora - (Number(notif.fecha) || 0);
      if (String(notif.id) !== vistaN &&
          frescN < cfg.ventanaNotifHoras * 3600 * 1000) {
        guardarNotifVista(notif.id);
        window.Avisos.emitir(notif.titulo, notif.texto);
        enviarEstado();
      }
    }
  }

  /* --------------------------------------------------------
     Overlay de bloqueo — tapa toda la app
     -------------------------------------------------------- */

  // Al caer un bloqueo, callar cualquier audio en curso: la canción del
  // modo estudio y una grabación que estuviera en marcha.
  function silenciarTodo() {
    try {
      if (window.CancionActiva && window.CancionActiva.reproduciendo) {
        window.CancionActiva.alternar();
      }
    } catch (e) {}
    try {
      document.dispatchEvent(new CustomEvent('chorapp:bloqueo'));
    } catch (e) {}
  }

  function ponerBloqueo(hasta, motivo) {
    if (capaBloqueo) {
      actualizarContador(hasta);
      return;
    }

    // El sondeo se repite cada pocos segundos: el aviso sonoro debe sonar
    // una sola vez por episodio de bloqueo (identificado por `hasta`).
    var debeSonar = hasta !== bloqueoSonado;
    bloqueoSonado = hasta;

    silenciarTodo();

    capaBloqueo = document.createElement('div');
    capaBloqueo.className = 'bloqueo-remoto';
    capaBloqueo.setAttribute('role', 'dialog');
    capaBloqueo.setAttribute('aria-modal', 'true');
    capaBloqueo.innerHTML =
      '<div class="bloqueo-remoto__caja">' +
        '<span class="bloqueo-remoto__ic" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/>' +
            '<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>' +
        '</span>' +
        '<h2 class="bloqueo-remoto__titulo">Pausa de estudio</h2>' +
        '<p class="bloqueo-remoto__texto" data-motivo></p>' +
        '<p class="bloqueo-remoto__reloj" data-reloj>--:--</p>' +
        '<p class="bloqueo-remoto__pie">La app volverá sola cuando termine.</p>' +
      '</div>';

    var elMotivo = capaBloqueo.querySelector('[data-motivo]');
    elMotivo.textContent = motivo ||
      'Tómate un respiro. Seguimos en un ratito 🎶';

    if (debeSonar) sonar('bloqueo');
    document.body.appendChild(capaBloqueo);
    // Bloquea el scroll de fondo mientras dure.
    document.body.classList.add('con-bloqueo-remoto');
    void capaBloqueo.offsetWidth;
    capaBloqueo.classList.add('is-visible');

    actualizarContador(hasta);
    relojBloqueo = setInterval(function () {
      actualizarContador(bloqueoHasta);
    }, 1000);
  }

  function actualizarContador(hasta) {
    if (!capaBloqueo) return;
    var restante = hasta - Date.now();
    if (restante <= 0) {
      quitarBloqueo();
      return;
    }
    var totalSeg = Math.ceil(restante / 1000);
    var min = Math.floor(totalSeg / 60);
    var seg = totalSeg % 60;
    var el = capaBloqueo.querySelector('[data-reloj]');
    if (el) el.textContent = min + ':' + (seg < 10 ? '0' : '') + seg;
  }

  function quitarBloqueo() {
    if (relojBloqueo) { clearInterval(relojBloqueo); relojBloqueo = null; }
    bloqueoSonado = 0;
    if (!capaBloqueo) return;
    var nodo = capaBloqueo;
    capaBloqueo = null;
    document.body.classList.remove('con-bloqueo-remoto');
    nodo.classList.remove('is-visible');
    var quita = function () { if (nodo.parentNode) nodo.parentNode.removeChild(nodo); };
    if (reduce) quita();
    else {
      nodo.addEventListener('transitionend', quita, { once: true });
      setTimeout(quita, 400);
    }
  }

  /* --------------------------------------------------------
     Aviso — tarjeta cálida que hay que cerrar a mano
     (así sabemos que lo ha visto)
     -------------------------------------------------------- */

  function mostrarAviso(aviso) {
    avisoEnPantalla = true;
    sonar('aviso');

    var capa = document.createElement('div');
    capa.className = 'aviso-remoto';
    capa.innerHTML =
      '<div class="aviso-remoto__fondo"></div>' +
      '<div class="aviso-remoto__panel" role="dialog" aria-modal="true">' +
        '<span class="aviso-remoto__ic" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M12 21s-7-4.35-9.5-8.5C1 9 3 5.5 6.5 5.5 8.7 5.5 10.5 7 12 9c1.5-2 3.3-3.5 5.5-3.5C21 5.5 23 9 21.5 12.5 19 16.65 12 21 12 21z"/>' +
          '</svg>' +
        '</span>' +
        '<p class="aviso-remoto__texto"></p>' +
        '<button type="button" class="btn btn--primario aviso-remoto__ok">Entendido</button>' +
      '</div>';

    capa.querySelector('.aviso-remoto__texto').textContent = aviso.texto;

    document.body.appendChild(capa);
    void capa.offsetWidth;
    capa.classList.add('is-abierta');
    var btn = capa.querySelector('.aviso-remoto__ok');
    btn.focus();

    function cerrar() {
      guardarAvisoVisto(aviso.id);
      enviarEstado(aviso.id);
      avisoEnPantalla = false;
      capa.classList.remove('is-abierta');
      var quita = function () { if (capa.parentNode) capa.parentNode.removeChild(capa); };
      if (reduce) quita();
      else {
        capa.addEventListener('transitionend', quita, { once: true });
        setTimeout(quita, 400);
      }
    }

    btn.addEventListener('click', cerrar);
    capa.querySelector('.aviso-remoto__fondo').addEventListener('click', cerrar);
  }

  /* --------------------------------------------------------
     Estado de vuelta (mejor esfuerzo)
     -------------------------------------------------------- */

  function enviarEstado(avisoVistoId) {
    if (!cfg || !cfg.dbUrl) return;
    var cuerpo = {
      vistaPorUltimaVez: Date.now(),
      bloqueada: bloqueoHasta > Date.now()
    };
    if (avisoVistoId) cuerpo.ultimoAvisoVisto = String(avisoVistoId);
    try {
      fetch(cfg.dbUrl + '/status.json', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo)
      }).catch(function () {});
    } catch (e) { /* da igual */ }
  }

  /* --------------------------------------------------------
     Recordar el último aviso mostrado
     -------------------------------------------------------- */

  function leerAvisoVisto() {
    try { return localStorage.getItem(CLAVE_AVISO_VISTO) || ''; }
    catch (e) { return ''; }
  }
  function guardarAvisoVisto(id) {
    try { localStorage.setItem(CLAVE_AVISO_VISTO, String(id)); } catch (e) {}
  }

  function leerNotifVista() {
    try { return localStorage.getItem(CLAVE_NOTIF_VISTA) || ''; }
    catch (e) { return ''; }
  }
  function guardarNotifVista(id) {
    try { localStorage.setItem(CLAVE_NOTIF_VISTA, String(id)); } catch (e) {}
  }

  /* -------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', iniciar);

  return { iniciar: iniciar, sondear: sondear };
})();
