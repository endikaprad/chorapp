/* ============================================================
   Pagina_study — Modo estudio de una canción (Fase 5)

   - Reproductor de audio (player.js)
   - Visor de letra (texto o PDF) y de partitura (imagen o PDF)
   - Marcar fragmentos difíciles con nota
   - Grabarse cantando (recorder.js); las grabaciones se sincronizan
     con el apartado Grabaciones de la app
   - Al entrar se registra la sesión de práctica (practica.js)

   app.js llama iniciar(contenedor, { id }).
   ============================================================ */

window.Pagina_study = (function () {
  'use strict';

  var cont, cancion, reproductor, grabadora, obs;
  var vistaSub = null;        // baja de window.CancionActiva mientras la pantalla vive
  var transporte = null;      // píldora flotante de controles (letra/partitura a pantalla completa)
  var transObs = null;        // observa la apertura de visores a pantalla completa
  var urls = [];              // object URLs a revocar al salir
  var cronoNota = null;       // intervalo del contador de grabación
  var estaGrabando = false;   // true mientras se graba (para mostrar el transporte a mano)
  var notaT0 = 0;             // inicio de la grabación de nota (ms)
  var notaOffset = null;      // segundo de la canción original al empezar la toma (o null)
  var tiempoActual = 0;       // posición del audio ahora mismo (s)
  var duracionAudio = 0;      // duración total del audio (s)

  function iniciar(contenedor, datos) {
    destruir();   // por si se re-entra desde otra canción
    cont = contenedor;
    var id = datos && datos.id;
    cancion = id ? window.Canciones.obtener(id) : null;

    if (!cancion) {
      cont.querySelector('[data-modulo="study"]').innerHTML =
        '<p class="vacio">No se encontró esta canción.</p>';
      return;
    }

    // Registrar sesión de práctica (silencioso).
    if (window.Practica) window.Practica.registrar(cancion.id);

    pintarCabecera();
    montarAudio();
    pintarLetra();
    pintarPartitura();
    pintarFragmentos();
    migrarNotasVozAntiguas();
    pintarGrabaciones();
    montarLightbox();

    cont.querySelector('[data-editar]').addEventListener('click', function () {
      window.Pagina_songs.editar(cancion.id);
    });
    cont.querySelector('[data-marcar]').addEventListener('click', marcarFragmento);
    cont.querySelector('[data-grabar-nota]').addEventListener('click', alternarGrabacion);
    document.addEventListener('chorapp:bloqueo', pararGrabacionPorBloqueo);

    // Limpieza al abandonar la pantalla.
    var vista = document.getElementById('vista');
    obs = new MutationObserver(function () {
      if (!document.body.contains(cont)) destruir();
    });
    obs.observe(vista, { childList: true, subtree: true });
  }

  function destruir() {
    if (obs) { obs.disconnect(); obs = null; }
    document.removeEventListener('chorapp:bloqueo', pararGrabacionPorBloqueo);
    // La canción NO se para al salir: sigue sonando en window.CancionActiva
    // y aparece la barra flotante. Solo soltamos nuestra vista.
    if (vistaSub) { vistaSub(); vistaSub = null; }
    if (window.CancionActiva) window.CancionActiva.fijarVistaAbierta(false);
    reproductor = null;
    if (grabadora) { grabadora.cancelar(); grabadora = null; }
    if (cronoNota) { clearInterval(cronoNota); cronoNota = null; }
    estaGrabando = false;
    tiempoActual = 0; duracionAudio = 0;
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];
    if (window.VisorPDF) window.VisorPDF.cerrar();
    desmontarTransporte();
    desmontarLightbox();
  }

  function refrescar() {
    cancion = window.Canciones.obtener(cancion.id) || cancion;
  }

  /* ---------- Cabecera ---------- */

  function pintarCabecera() {
    var est = window.Canciones.ESTADOS[cancion.estado] || window.Canciones.ESTADOS.pendiente;
    q('[data-titulo]').textContent = cancion.titulo;
    var meta = q('[data-meta]');
    if (cancion.compositor) { meta.textContent = cancion.compositor; meta.hidden = false; }
    var chip = q('[data-chip]');
    chip.textContent = est.etiqueta;
    chip.className = 'chip chip--' + est.token;
  }

  /* ---------- Audio ---------- */

  function montarAudio() {
    var seccion = q('[data-player]');
    if (!cancion.archivos || !cancion.archivos.audio) { seccion.hidden = true; return; }
    window.CancionActiva.fijarVistaAbierta(true);   // mientras estemos aquí, sin barra flotante

    var barra = q('[data-barra]');
    var tAct = q('[data-t-actual]');
    var tTot = q('[data-t-total]');
    var btnPlay = q('[data-play]');
    var icPlay = btnPlay.querySelector('.ic-play');
    var icPause = btnPlay.querySelector('.ic-pause');
    var velBarra = q('[data-vel-barra]');
    var velValor = q('[data-vel-valor]');
    var btnBucleA = q('[data-bucle-a]');
    var btnBucleB = q('[data-bucle-b]');
    var btnBucleOff = q('[data-bucle-off]');
    var bucleInfo = q('[data-bucle-info]');
    var bucleZona = q('[data-bucle-zona]');
    var bucleA = null;   // A pendiente de fijar (aún sin B)

    // El <audio> y la lógica viven en window.CancionActiva (persisten al
    // navegar). Aquí solo cargamos la canción y nos suscribimos a su estado.
    reproductor = window.CancionActiva;

    window.Archivos.url(cancion.id + ':audio').then(function (u) {
      if (!u) { seccion.hidden = true; return; }
      seccion.hidden = false;
      window.CancionActiva.cargar(cancion, u);
      window.CancionActiva.fijarVistaAbierta(true);
    });

    vistaSub = window.CancionActiva.suscribir(function (s) {
      // .hidden como propiedad no existe en <svg>: hay que tocar el atributo.
      icPlay.toggleAttribute('hidden', s.reproduciendo);
      icPause.toggleAttribute('hidden', !s.reproduciendo);
      btnPlay.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
      btnPlay.classList.toggle('is-sonando', s.reproduciendo);
      tiempoActual = s.actual || 0;
      if (s.total && s.total !== duracionAudio) { duracionAudio = s.total; pintarMarcas(); }
      tAct.textContent = fmtTiempo(s.actual);
      tTot.textContent = fmtTiempo(s.total);
      if (s.total && !barra.matches(':active')) {
        barra.value = String(Math.round((s.actual / s.total) * 1000));
      }
      velValor.textContent = fmtVel(s.velocidad);
      if (!velBarra.matches(':active')) velBarra.value = String(s.velocidad);
      pintarBucle(s.bucle);
      sincronizarTransporte(s);
    });

    /* ---- Bucle A–B ---- */

    function pintarBucle(bc) {
      if (bc) {
        bucleA = bc.a;
        btnBucleA.classList.add('is-set');
        btnBucleA.textContent = 'A ' + fmtTiempo(bc.a);
        btnBucleB.disabled = false;
        btnBucleB.classList.add('is-set');
        btnBucleB.textContent = 'B ' + fmtTiempo(bc.b);
        btnBucleOff.hidden = false;
        bucleInfo.textContent = 'Sonando en bucle ' + fmtTiempo(bc.a) + ' – ' + fmtTiempo(bc.b) +
          '. Pulsa B para mover el final o Quitar para salir.';
        if (duracionAudio) {
          var izq = Math.max(0, Math.min(100, (bc.a / duracionAudio) * 100));
          var der = Math.max(0, Math.min(100, (bc.b / duracionAudio) * 100));
          bucleZona.style.left = izq + '%';
          bucleZona.style.width = Math.max(0, der - izq) + '%';
          bucleZona.hidden = false;
        }
        return;
      }
      // Sin bucle activo.
      btnBucleOff.hidden = true;
      bucleZona.hidden = true;
      btnBucleB.classList.remove('is-set');
      if (bucleA == null) {
        btnBucleA.classList.remove('is-set');
        btnBucleA.textContent = 'A';
        btnBucleB.disabled = true;
        btnBucleB.textContent = 'B';
      } else {
        // A ya marcada, esperando B.
        btnBucleA.classList.add('is-set');
        btnBucleA.textContent = 'A ' + fmtTiempo(bucleA);
        btnBucleB.disabled = false;
        btnBucleB.textContent = 'B';
      }
      bucleInfo.textContent = bucleA == null
        ? 'Repite un trozo difícil: pulsa A donde empieza y B donde acaba.'
        : 'Ahora escucha hasta el final del trozo y pulsa B.';
    }

    btnBucleA.addEventListener('click', function () {
      reproductor.quitarBucle();      // si había uno, se rehace desde aquí
      bucleA = tiempoActual;
      pintarBucle(null);
    });
    btnBucleB.addEventListener('click', function () {
      if (bucleA == null) return;
      if (tiempoActual <= bucleA + 0.5) {
        window.UI.aviso('La B tiene que ir después de la A.');
        return;
      }
      reproductor.fijarBucle(bucleA, tiempoActual);
    });
    btnBucleOff.addEventListener('click', function () {
      bucleA = null;
      reproductor.quitarBucle();
    });

    btnPlay.addEventListener('click', function () { reproductor.alternar(); });
    q('[data-retro]').addEventListener('click', function () { reproductor.retroceder(5); });
    q('[data-adelante]').addEventListener('click', function () { reproductor.adelantar(5); });
    velBarra.addEventListener('input', function () {
      var v = reproductor.fijarVelocidad(parseFloat(velBarra.value));
      velValor.textContent = fmtVel(v);
    });
    barra.addEventListener('input', function () {
      if (duracionAudio) reproductor.irA((barra.value / 1000) * duracionAudio);
    });

    montarTransporte();

    // Opción "sonar la canción mientras grabo" (solo con audio disponible).
    var opt = q('[data-grabar-con-audio]');
    var chkAudio = q('[data-grabar-con-audio-chk]');
    if (opt && chkAudio) {
      opt.hidden = false;
      chkAudio.checked = window.Almacen.leer('estudio:grabarConAudio', true) !== false;
      chkAudio.addEventListener('change', function () {
        window.Almacen.guardar('estudio:grabarConAudio', chkAudio.checked);
      });
    }
  }

  /* ---------- Transporte flotante ----------
     Maite abre la letra o la partitura a pantalla completa mientras
     escucha la canción. En ese modo el reproductor de la página queda
     tapado, así que sacamos una píldora fija abajo con lo imprescindible:
     −5 s, play/pausa y +5 s. Vale para imagen (lightbox) y para PDF
     (visor-pdf-full), y no estorba: es estrecha y pegada al borde. */

  function montarTransporte() {
    if (transporte || !reproductor) return;

    transporte = document.createElement('div');
    transporte.className = 'transporte';
    transporte.setAttribute('role', 'group');
    transporte.setAttribute('aria-label', 'Controles de la canción');
    transporte.innerHTML =
      '<button type="button" class="transporte__btn" data-tp-retro aria-label="Retroceder 5 segundos">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 4 11l7 7"/><path d="M4 11h10a6 6 0 0 1 0 12h-3"/></svg>' +
        '<span>5</span>' +
      '</button>' +
      '<button type="button" class="transporte__btn transporte__play" data-tp-play aria-label="Reproducir">' +
        '<svg class="tp-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5a1 1 0 0 1 1.53-.85l12 7.5a1 1 0 0 1 0 1.7l-12 7.5A1 1 0 0 1 7 19.5z"/></svg>' +
        '<svg class="tp-ic-pause" viewBox="0 0 24 24" aria-hidden="true" hidden><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>' +
      '</button>' +
      '<button type="button" class="transporte__btn" data-tp-adelante aria-label="Adelantar 5 segundos">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 4l7 7-7 7"/><path d="M20 11H10a6 6 0 0 0 0 12h3"/></svg>' +
        '<span>5</span>' +
      '</button>' +
      '<span class="transporte__tiempo" data-tp-tiempo aria-hidden="true">0:00</span>';

    document.body.appendChild(transporte);

    transporte.querySelector('[data-tp-play]').addEventListener('click', function () { reproductor.alternar(); });
    transporte.querySelector('[data-tp-retro]').addEventListener('click', function () { reproductor.retroceder(5); });
    transporte.querySelector('[data-tp-adelante]').addEventListener('click', function () { reproductor.adelantar(5); });

    // Mostrarlo solo cuando hay un visor a pantalla completa abierto.
    transObs = new MutationObserver(evaluarTransporte);
    transObs.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'],
    });
    evaluarTransporte();
  }

  function visorAPantallaCompletaAbierto() {
    return !!(document.querySelector('.visor-pdf-full') ||
              document.querySelector('.lightbox:not([hidden])'));
  }

  function evaluarTransporte() {
    if (!transporte) return;
    // A mano cuando hay un visor a pantalla completa abierto o mientras se graba.
    transporte.classList.toggle('is-visible',
      visorAPantallaCompletaAbierto() || estaGrabando);
  }

  function sincronizarTransporte(s) {
    if (!transporte) return;
    var btn = transporte.querySelector('[data-tp-play]');
    var icPlay = transporte.querySelector('.tp-ic-play');
    var icPause = transporte.querySelector('.tp-ic-pause');
    icPlay.toggleAttribute('hidden', s.reproduciendo);
    icPause.toggleAttribute('hidden', !s.reproduciendo);
    btn.classList.toggle('is-sonando', s.reproduciendo);
    btn.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
    transporte.querySelector('[data-tp-tiempo]').textContent = fmtTiempo(s.actual);
  }

  function desmontarTransporte() {
    if (transObs) { transObs.disconnect(); transObs = null; }
    if (transporte && transporte.parentNode) transporte.parentNode.removeChild(transporte);
    transporte = null;
  }

  /* ---------- Letra ---------- */

  function pintarLetra() {
    var vacio = q('[data-letra-vacio]');
    var pre = q('[data-letra-texto]');
    var doc = q('[data-letra-doc]');
    pre.hidden = true; doc.hidden = true;

    if (cancion.letraTexto && cancion.letraTexto.trim()) {
      pre.textContent = cancion.letraTexto;
      pre.hidden = false;
      vacio.hidden = true;
      return;
    }
    var meta = cancion.archivos && cancion.archivos.letra;
    if (!meta) { vacio.hidden = false; return; }

    vacio.hidden = true;
    var esPdf = /pdf/i.test(meta.mime) || /\.pdf$/i.test(meta.nombre || '');
    var esImagen = /^image\//i.test(meta.mime) || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(meta.nombre || '');
    window.Archivos.obtener(cancion.id + ':letra').then(function (blob) {
      if (!blob) { vacio.hidden = false; return; }
      if (esPdf) {
        doc.innerHTML = '<div class="visor-pdf" data-pdf-caja></div>' +
          '<button type="button" class="visor-doc__abrir" data-pdf-abrir>Abrir la letra a pantalla completa</button>';
        var caja = doc.querySelector('[data-pdf-caja]');
        window.VisorPDF.render(caja, blob, { paginas: 3 }).catch(function () {});
        caja.addEventListener('click', function () { window.VisorPDF.abrir(blob, 'Letra'); });
        doc.querySelector('[data-pdf-abrir]').addEventListener('click', function () {
          window.VisorPDF.abrir(blob, 'Letra');
        });
        doc.hidden = false;
      } else if (esImagen) {
        var ui = URL.createObjectURL(blob); urls.push(ui);
        doc.innerHTML = '<img class="visor-doc__img" alt="Letra" />';
        var im = doc.querySelector('img');
        im.src = ui;
        im.addEventListener('click', function () { abrirLightbox(ui); });
        doc.hidden = false;
      } else {
        blob.text().then(function (t) { pre.textContent = t; pre.hidden = false; });
      }
    });
  }

  /* ---------- Partitura ---------- */

  function pintarPartitura() {
    var vacio = q('[data-partitura-vacio]');
    var cajaImg = q('[data-partitura-img]');
    var img = q('[data-partitura-src]');
    var doc = q('[data-partitura-doc]');
    cajaImg.hidden = true; doc.hidden = true;

    var meta = cancion.archivos && cancion.archivos.partitura;
    if (!meta) { vacio.hidden = false; return; }
    vacio.hidden = true;

    var esPdf = /pdf/i.test(meta.mime) || /\.pdf$/i.test(meta.nombre || '');
    if (esPdf) {
      window.Archivos.obtener(cancion.id + ':partitura').then(function (blob) {
        if (!blob) { vacio.hidden = false; return; }
        doc.innerHTML = '<div class="visor-pdf" data-pdf-caja></div>' +
          '<button type="button" class="visor-doc__abrir" data-pdf-abrir>Abrir la partitura a pantalla completa</button>';
        var caja = doc.querySelector('[data-pdf-caja]');
        window.VisorPDF.render(caja, blob).catch(function () {});
        caja.addEventListener('click', function () { window.VisorPDF.abrir(blob, 'Partitura'); });
        doc.querySelector('[data-pdf-abrir]').addEventListener('click', function () {
          window.VisorPDF.abrir(blob, 'Partitura');
        });
        doc.hidden = false;
      });
      return;
    }
    window.Archivos.url(cancion.id + ':partitura').then(function (u) {
      if (!u) { vacio.hidden = false; return; }
      urls.push(u);
      img.src = u;
      cajaImg.hidden = false;
      cajaImg.onclick = function () { abrirLightbox(u); };
    });
  }

  /* ---------- Fragmentos difíciles ---------- */

  function marcarFragmento() {
    // Solo se guarda el momento del audio: Maite no tiene que escribir nada.
    if (!reproductor || !duracionAudio) {
      window.UI.aviso('Carga el audio de la canción para poder marcar el minuto difícil.');
      return;
    }
    window.Canciones.agregarFragmento(cancion.id, '', tiempoActual);
    refrescar();
    pintarFragmentos();
    pintarMarcas();
  }

  /* Marcas sobre la barra del reproductor que señalan cada fragmento difícil. */
  function pintarMarcas() {
    var caja = q('[data-marcas]');
    if (!caja) return;
    caja.innerHTML = '';
    if (!duracionAudio) return;
    (cancion.fragmentos || []).forEach(function (f) {
      if (typeof f.segundo !== 'number' || !isFinite(f.segundo)) return;
      var pct = Math.min(100, Math.max(0, (f.segundo / duracionAudio) * 100));
      var m = document.createElement('span');
      m.className = 'player__marca';
      m.style.left = pct + '%';
      m.title = f.texto ? (fmtTiempo(f.segundo) + ' · ' + f.texto) : fmtTiempo(f.segundo);
      caja.appendChild(m);
    });
  }

  /* Repetir en bucle desde un fragmento marcado: de su minuto hasta el
     siguiente fragmento cercano, o 15 s si no hay ninguno. */
  function bucleDesdeFragmento(seg) {
    if (!reproductor || !duracionAudio) return;
    var fin = Math.min(duracionAudio, seg + 15);
    (cancion.fragmentos || []).forEach(function (f) {
      if (typeof f.segundo === 'number' && f.segundo > seg + 1.5 && f.segundo < fin) {
        fin = f.segundo;
      }
    });
    reproductor.irA(seg);
    reproductor.fijarBucle(seg, fin);
    if (!reproductor.reproduciendo) reproductor.alternar();
  }

  function pintarFragmentos() {
    var caja = q('[data-fragmentos]');
    var frags = cancion.fragmentos || [];
    if (!frags.length) {
      caja.innerHTML = '<p class="visor-vacio">Mientras suena el audio, pulsa “Marcar este minuto” en las partes que se te resisten.</p>';
      return;
    }
    caja.innerHTML = '';
    frags.slice().reverse().forEach(function (f) {
      var fila = document.createElement('div');
      var tieneTiempo = typeof f.segundo === 'number' && isFinite(f.segundo);
      var soloTiempo = tieneTiempo && !f.texto;
      fila.className = soloTiempo ? 'ficha ficha--solo' : 'ficha';
      fila.innerHTML =
        (tieneTiempo
          ? '<button type="button" class="ficha__tiempo" aria-label="Ir a este momento del audio">' +
              '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5a1 1 0 0 1 1.53-.85l9 6.5a1 1 0 0 1 0 1.7l-9 6.5A1 1 0 0 1 8 18.5z"/></svg>' +
              fmtTiempo(f.segundo) + '</button>'
          : '') +
        (tieneTiempo
          ? '<button type="button" class="ficha__bucle" aria-label="Repetir este fragmento en bucle">⟲</button>'
          : '') +
        (f.texto ? '<p class="ficha__texto">' + escapar(f.texto) + '</p>' : '') +
        '<button type="button" class="ficha__quitar" aria-label="Quitar fragmento">✕</button>';
      if (tieneTiempo) {
        fila.querySelector('.ficha__tiempo').addEventListener('click', function () {
          if (reproductor) reproductor.irA(f.segundo);
        });
        fila.querySelector('.ficha__bucle').addEventListener('click', function () {
          bucleDesdeFragmento(f.segundo);
        });
      }
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        window.Canciones.borrarFragmento(cancion.id, f.id);
        refrescar();
        pintarFragmentos();
        pintarMarcas();
      });
      caja.appendChild(fila);
    });
  }

  /* ---------- Grabaciones de la canción ----------
     Grabar cantando mientras se estudia. Cada grabación se guarda en
     window.Grabaciones, así que aparece aquí y también en el apartado
     Grabaciones de la app, todas juntas. */

  /* ¿Hay audio de la canción para acompañar la grabación? */
  function tieneAudio() {
    return !!(reproductor && cancion.archivos && cancion.archivos.audio);
  }

  // Si el hijo bloquea la app en mitad de una toma, la cerramos como si
  // Maite hubiera pulsado "Detener" (se guarda lo grabado hasta ahí).
  function pararGrabacionPorBloqueo() {
    if (grabadora && grabadora.grabando) alternarGrabacion();
  }

  function alternarGrabacion() {
    var btn = q('[data-grabar-nota]');
    var txt = q('[data-grabar-nota-txt]');
    var opt = q('[data-grabar-con-audio]');
    var chkAudio = q('[data-grabar-con-audio-chk]');

    if (grabadora && grabadora.grabando) {
      var g = grabadora; grabadora = null;
      if (cronoNota) { clearInterval(cronoNota); cronoNota = null; }
      btn.disabled = true;
      // Al terminar la toma, parar la canción que la acompañaba.
      if (reproductor && reproductor.reproduciendo) reproductor.alternar();
      estaGrabando = false;
      evaluarTransporte();
      var dur = Math.round((Date.now() - notaT0) / 1000);
      g.parar().then(function (blob) {
        btn.disabled = false;
        btn.classList.remove('is-grabando');
        txt.textContent = 'Grabar';
        if (opt) opt.classList.remove('is-bloqueada');
        if (chkAudio) chkAudio.disabled = false;
        if (!blob || !blob.size) return;
        return window.Grabaciones.crear({
          cancionId: cancion.id,
          titulo: cancion.titulo,
          mime: blob.type,
          dur: dur,
          picos: g.picos(),
          audioOffset: notaOffset,
        }, blob).then(pintarGrabaciones);
      });
      return;
    }

    if (!window.Grabadora.soportado()) {
      window.UI.aviso('Este dispositivo no permite grabar audio desde la app.', { tipo: 'error' });
      return;
    }
    var conAudio = tieneAudio() && chkAudio && chkAudio.checked;
    notaOffset = null;

    grabadora = window.Grabadora.crear();
    grabadora.iniciar().then(function () {
      btn.classList.add('is-grabando');
      notaT0 = Date.now();
      txt.textContent = 'Detener (0:00)';
      cronoNota = setInterval(function () {
        txt.textContent = 'Detener (' + fmtTiempo((Date.now() - notaT0) / 1000) + ')';
      }, 500);

      estaGrabando = true;
      evaluarTransporte();               // saca el reproductor "a mano"
      if (opt) opt.classList.add('is-bloqueada');
      if (chkAudio) chkAudio.disabled = true;

      // Acompañar la voz con la canción: si la casilla está marcada, suena
      // desde donde esté ahora (o desde el principio si está parada).
      if (conAudio && reproductor && !reproductor.reproduciendo) {
        notaOffset = Math.max(0, tiempoActual || 0);
        reproductor.alternar();
      }
      // Si la canción está sonando al empezar la toma (por la casilla o
      // porque Maite le dio al play), guardamos el segundo exacto: así en
      // Grabaciones se puede oír SOLO ese trozo de la pista original,
      // sincronizado con la voz (de tiempoActual a tiempoActual + duración).
      if (reproductor && reproductor.reproduciendo && (cancion.archivos && cancion.archivos.audio)) {
        notaOffset = Math.max(0, tiempoActual || 0);
      }
    }).catch(function () {
      grabadora = null;
      window.UI.aviso('No se pudo acceder al micrófono.', { tipo: 'error' });
    });
  }

  /* Migra notas de voz antiguas (guardadas en la canción) a Grabaciones,
     una sola vez. Antes del cambio vivían en Archivos "<cancionId>:voz:<id>". */
  function migrarNotasVozAntiguas() {
    var viejas = (cancion.notasVoz || []).slice();
    if (!viejas.length) return;
    viejas.forEach(function (n) {
      window.Archivos.obtener(cancion.id + ':voz:' + n.id).then(function (blob) {
        window.Canciones.borrarNotaVoz(cancion.id, n.id);
        window.Archivos.borrar(cancion.id + ':voz:' + n.id);
        if (blob && blob.size) {
          window.Grabaciones.crear({
            cancionId: cancion.id,
            titulo: cancion.titulo,
            mime: blob.type,
            dur: n.dur || 0,
          }, blob).then(pintarGrabaciones);
        }
      });
    });
    refrescar();
  }

  function pintarGrabaciones() {
    var caja = q('[data-notas-voz]');
    var grabs = window.Grabaciones.listarDeCancion(cancion.id);
    if (!grabs.length) {
      caja.innerHTML = '<p class="visor-vacio">Grábate cantando mientras estudias para escucharte luego.</p>';
      return;
    }
    caja.innerHTML = '';
    grabs.forEach(function (g) {
      var fila = document.createElement('div');
      fila.className = 'nota-voz';
      fila.innerHTML =
        '<span class="nota-voz__fecha">' + fmtFecha(g.creado) + '</span>' +
        window.MiniPlayer.plantilla() +
        '<button type="button" class="ficha__quitar" aria-label="Eliminar grabación">✕</button>';
      var audio = fila.querySelector('audio');
      window.MiniPlayer.montar(fila.querySelector('[data-mp]'), g.dur || 0, g.picos);
      window.Grabaciones.url(g.id).then(function (u) {
        if (u) { urls.push(u); audio.src = u; }
      });
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        window.UI.confirmar('¿Eliminar esta grabación? No se puede deshacer.', {
          ok: 'Eliminar', peligro: true,
        }).then(function (ok) {
          if (ok) window.Grabaciones.borrar(g.id).then(pintarGrabaciones);
        });
      });
      caja.appendChild(fila);
    });
  }

  /* ---------- Lightbox ---------- */

  var lb, lbImg, lbZoom;

  function montarLightbox() {
    lb = q('[data-lightbox]');
    lbImg = lb.querySelector('[data-lightbox-src]');

    // Portal al <body>: un ancestro con transform (.pantalla anima al navegar)
    // haría que `position: fixed` se posicione respecto a esa pantalla y no
    // respecto a la ventana. Sacándolo al body siempre abre centrado.
    document.body.appendChild(lb);

    lb.querySelector('[data-lightbox-cerrar]').addEventListener('click', cerrarLightbox);
    lb.addEventListener('click', function (e) { if (e.target === lb) cerrarLightbox(); });
    document.addEventListener('keydown', cerrarConEsc);

    lbZoom = crearZoom(lb, lbImg);
  }

  function cerrarConEsc(e) {
    if (e.key === 'Escape' && lb && !lb.hidden) cerrarLightbox();
  }

  function abrirLightbox(u) {
    lbImg.style.transition = 'none';
    lbImg.src = u;
    lb.hidden = false;
    if (lbZoom) lbZoom.reset();
  }
  function cerrarLightbox() {
    if (!lb) return;
    lb.hidden = true;
    lbImg.removeAttribute('src');
    if (lbZoom) lbZoom.reset();
  }
  function desmontarLightbox() {
    document.removeEventListener('keydown', cerrarConEsc);
    if (lb && lb.parentNode === document.body) lb.parentNode.removeChild(lb);
    lb = lbImg = lbZoom = null;
  }

  /* Zoom/desplazamiento del visor: rueda, doble toque y pellizco con dos dedos.
     Solo actúa sobre `transform` (escala + traslado) para mantener 60fps. */
  function crearZoom(caja, img) {
    var MIN = 1, MAX = 4;
    var esc = 1, x = 0, y = 0;
    var puntos = new Map();
    var pinchIni = 0, escIni = 1, arrastreIni = null;

    function aplicar() {
      img.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + esc + ')';
      img.style.cursor = esc > MIN ? 'grab' : 'zoom-in';
    }
    function limitar() {
      if (esc <= MIN) { esc = MIN; x = 0; y = 0; return; }
      var r = img.getBoundingClientRect();
      var mX = Math.max(0, (r.width - caja.clientWidth) / 2);
      var mY = Math.max(0, (r.height - caja.clientHeight) / 2);
      x = Math.min(mX, Math.max(-mX, x));
      y = Math.min(mY, Math.max(-mY, y));
    }
    function suave(on) { img.style.transition = on ? 'transform 160ms var(--curva)' : 'none'; }

    caja.addEventListener('wheel', function (e) {
      e.preventDefault();
      suave(false);
      esc = Math.min(MAX, Math.max(MIN, esc * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      limitar(); aplicar();
    }, { passive: false });

    img.addEventListener('dblclick', function () {
      suave(true);
      if (esc > MIN) { esc = MIN; x = 0; y = 0; } else { esc = 2.4; }
      limitar(); aplicar();
    });

    img.addEventListener('pointerdown', function (e) {
      img.setPointerCapture(e.pointerId);
      suave(false);
      puntos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (puntos.size === 2) {
        var p = Array.from(puntos.values());
        pinchIni = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        escIni = esc;
      } else if (esc > MIN) {
        arrastreIni = { x: e.clientX - x, y: e.clientY - y };
      }
    });
    img.addEventListener('pointermove', function (e) {
      if (!puntos.has(e.pointerId)) return;
      puntos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var p = Array.from(puntos.values());
      if (puntos.size === 2 && pinchIni) {
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        esc = Math.min(MAX, Math.max(MIN, escIni * (d / pinchIni)));
        limitar(); aplicar();
      } else if (puntos.size === 1 && arrastreIni) {
        x = e.clientX - arrastreIni.x;
        y = e.clientY - arrastreIni.y;
        limitar(); aplicar();
      }
    });
    function soltar(e) {
      puntos.delete(e.pointerId);
      if (puntos.size < 2) pinchIni = 0;
      if (puntos.size === 0) {
        arrastreIni = null;
        if (esc <= MIN) { suave(true); esc = MIN; x = 0; y = 0; aplicar(); }
      }
    }
    img.addEventListener('pointerup', soltar);
    img.addEventListener('pointercancel', soltar);

    return {
      reset: function () {
        esc = MIN; x = 0; y = 0; puntos.clear(); pinchIni = 0; arrastreIni = null;
        suave(false); aplicar();
      }
    };
  }

  /* ---------- Utilidades ---------- */

  function q(sel) { return cont.querySelector(sel); }

  function fmtTiempo(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var m = Math.floor(seg / 60);
    var s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtVel(v) {
    v = Math.round((v || 1) * 100) / 100;
    return (v % 1 === 0 ? v : v.toFixed(2).replace(/0$/, '')) + '×';
  }

  function fmtFecha(ts) {
    try {
      return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) +
        ' · ' + new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
