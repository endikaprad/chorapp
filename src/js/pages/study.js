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

  var cont, sesion, marca, cancion, reproductor, grabadora, obs;

  // Colores elegibles para el marcador de cada fragmento difícil.
  // El id se guarda en el fragmento; aquí traducimos a color y nombre.
  var COLORES_FRAG = {
    cobalto: { hex: '#1512D6', nombre: 'Cobalto' },
    verde:   { hex: '#4C7A5A', nombre: 'Verde' },
    ambar:   { hex: '#C98A2E', nombre: 'Ámbar' },
    rojo:    { hex: '#B4453C', nombre: 'Rojo' },
    morado:  { hex: '#7A4CA0', nombre: 'Morado' },
    gris:    { hex: '#6B6560', nombre: 'Gris' },
  };
  function colorFrag(f) {
    return (f && f.color && COLORES_FRAG[f.color]) ? COLORES_FRAG[f.color].hex : COLORES_FRAG.rojo.hex;
  }
  var pendienteSalto = null;  // segundo de la sesión al que saltar al cargar el audio

  // Segmento de la canción dentro del audio del ensayo. El reproductor
  // enseña un carril de 0:00 a la duración de la canción, no de la sesión
  // entera: así es más fácil moverse por ella.
  var segIni = 0;             // segundo real donde empieza la canción
  var segFinRaw = null;       // segundo real donde acaba (o null = hasta el final del audio)
  var bucleClip = false;      // repetir la canción entera sin parar (botón "Bucle")
  function segFin() { return (segFinRaw != null && segFinRaw > segIni) ? segFinRaw : duracionAudio; }
  function segTotal() { return Math.max(0, segFin() - segIni); }
  function rel(t) { return Math.min(segTotal(), Math.max(0, (t || 0) - segIni)); }
  var vistaSub = null;        // baja de window.CancionActiva mientras la pantalla vive
  var transporte = null;      // píldora flotante de controles (letra/partitura a pantalla completa)
  var transObs = null;        // observa la apertura de visores a pantalla completa
  var playerObs = null;       // observa si el reproductor de la página está a la vista
  var playerFuera = false;    // true cuando Maite ha bajado y ya no ve el reproductor
  var urls = [];              // object URLs a revocar al salir
  var cronoNota = null;       // intervalo del contador de grabación
  var estaGrabando = false;   // true mientras se graba (para mostrar el transporte a mano)
  var notaT0 = 0;             // inicio de la grabación de nota (ms)
  var notaOffset = null;      // segundo de la canción original al empezar la toma (o null)
  var tiempoActual = 0;       // posición del audio ahora mismo (s)
  var duracionAudio = 0;      // duración total del audio (s)
  var selEscucha = null;      // selector Altavoz/Auriculares (window.Sincronia)
  var panelTono = null;       // panel "Dame el tono" (window.Tono)

  function iniciar(contenedor, datos) {
    destruir();   // por si se re-entra desde otra canción
    cont = contenedor;
    datos = datos || {};

    // Resolver sesión + marca. Se puede entrar de dos formas:
    //   { sesionId, marcaId }  -> directo
    //   { id: cancionId }      -> la última vez que se marcó esa canción
    if (datos.sesionId && datos.marcaId) {
      sesion = window.Sesiones.obtener(datos.sesionId);
      marca = sesion && (sesion.marcas || []).filter(function (m) { return m.id === datos.marcaId; })[0];
    } else if (datos.id) {
      var ref = window.Sesiones.ultimaMarcaDeCancion(datos.id);
      if (ref) { sesion = ref.sesion; marca = ref.marca; }
      else {
        var c0 = window.Canciones.obtener(datos.id);
        cont.querySelector('[data-modulo="study"]').innerHTML =
          '<div class="vacio"><p>Aún no has marcado «' +
          escapar(c0 ? c0.titulo : 'esta canción') +
          '» en ninguna sesión.<br>Abre una sesión del coro y márcala mientras suena.</p>' +
          '<button type="button" class="btn btn--primario" data-ir-sesiones>Ir a las sesiones</button></div>';
        var b = cont.querySelector('[data-ir-sesiones]');
        if (b) b.addEventListener('click', function () { window.App.ir('sesiones'); });
        return;
      }
    }

    if (!sesion || !marca) {
      cont.querySelector('[data-modulo="study"]').innerHTML =
        '<p class="vacio">No se encontró esta canción.</p>';
      return;
    }

    cancion = marca.cancionId ? window.Canciones.obtener(marca.cancionId) : null;
    segIni = marca.segundo || 0;
    segFinRaw = (typeof marca.finSegundo === 'number' && marca.finSegundo > segIni) ? marca.finSegundo : null;
    pendienteSalto = segIni;

    // Recordar dónde estaba estudiando, para el botón "Continuar" de Inicio.
    window.Almacen.guardar('estudio:ultimo', {
      sesionId: sesion.id, marcaId: marca.id, titulo: marca.titulo, cuando: Date.now(),
    });

    // Registrar sesión de práctica (silencioso).
    if (window.Practica) window.Practica.registrar(cancion ? cancion.id : 'marca:' + marca.id);
    if (window.Diario) {
      window.Diario.registrar('estudio', {
        cancionId: cancion ? cancion.id : null,
        sesionId: sesion.id,
        marcaId: marca.id,
        titulo: marca.titulo,
      });
    }

    pintarCabecera();
    montarAudio();
    pintarLetra();
    pintarPartitura();
    pintarFragmentos();
    montarTono();
    pintarNotas();
    if (cancion) migrarNotasVozAntiguas();
    pintarGrabaciones();
    montarLightbox();

    cont.querySelector('[data-editar]').addEventListener('click', function () {
      if (cancion) window.Pagina_songs.editar(cancion.id);
      else vincularMarca();
    });
    cont.querySelector('[data-marcar]').addEventListener('click', marcarFragmento);
    cont.querySelector('[data-grabar-nota]').addEventListener('click', alternarGrabacion);
    document.addEventListener('chorapp:bloqueo', pararGrabacionPorBloqueo);
    // Si Maite cierra la barra flotante con la ✕, la canción se descarta:
    // quitamos el hueco del final y volvemos el botón "Grabar" a su sitio.
    document.addEventListener('chorapp:cancion-descartada', evaluarBarraFlotante);

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
    document.removeEventListener('chorapp:cancion-descartada', evaluarBarraFlotante);
    // La canción NO se para al salir: sigue sonando en window.CancionActiva
    // y aparece la barra flotante. Solo soltamos nuestra vista.
    if (vistaSub) { vistaSub(); vistaSub = null; }
    if (window.CancionActiva) window.CancionActiva.fijarVistaAbierta(false);
    cerrarSelectoresTono();
    if (panelTono) { panelTono.destruir(); panelTono = null; }
    reproductor = null;
    selEscucha = null;
    bucleClip = false;
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
    sesion = window.Sesiones.obtener(sesion.id) || sesion;
    marca = (sesion.marcas || []).filter(function (m) { return m.id === marca.id; })[0] || marca;
    cancion = marca.cancionId ? (window.Canciones.obtener(marca.cancionId) || cancion) : null;
  }

  // Marca sin ficha del repertorio: ofrecer vincularla (vuelve a la sesión).
  function vincularMarca() {
    window.UI.aviso('Vincula esta canción desde la sesión: toca ✎ en su marca.');
    window.App.ir('sesion', { datos: { id: sesion.id } });
  }

  /* ---------- Cabecera ---------- */

  function pintarCabecera() {
    q('[data-titulo]').textContent = marca.titulo;
    var meta = q('[data-meta]');
    var sub = cancion && cancion.compositor ? cancion.compositor : '';
    if (sub) { meta.textContent = sub; meta.hidden = false; } else { meta.hidden = true; }
    var chip = q('[data-chip]');
    if (cancion) {
      var est = window.Canciones.ESTADOS[cancion.estado] || window.Canciones.ESTADOS.pendiente;
      chip.textContent = est.etiqueta;
      chip.className = 'chip chip--' + est.token;
      chip.hidden = false;
    } else {
      chip.hidden = true;
    }
  }

  /* ---------- Notas personales ---------- */

  function pintarNotas() {
    // Apunte de la toma de este día (marca de la sesión).
    var dia = marca && marca.nota ? marca.nota : '';
    var tDia = q('[data-nota-dia]');
    tDia.textContent = dia;
    tDia.hidden = !dia;

    // Nota general de la canción (ficha del repertorio).
    var caja = q('[data-notas]');
    var texto = cancion && cancion.notas ? cancion.notas : '';
    caja.textContent = texto;
    caja.hidden = !texto;
  }

  /* ---------- Audio ---------- */

  function montarAudio() {
    var seccion = q('[data-player]');
    if (!sesion.archivo) { seccion.hidden = true; return; }
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

    var yaEsEstaSesion = window.CancionActiva.cancionId() === sesion.id &&
                         window.CancionActiva.hayCancion();

    window.Archivos.url(sesion.id + ':audio').then(function (u) {
      if (!u) { seccion.hidden = true; return; }
      seccion.hidden = false;
      observarReproductor(seccion);
      window.CancionActiva.cargar({
        id: sesion.id,
        titulo: marca.titulo,
        compositor: (cancion && cancion.compositor) || sesion.lugar || 'Ensayo del coro',
        abrir: { ruta: 'estudio', datos: { sesionId: sesion.id, marcaId: marca.id } },
        // La "canción" es el trozo de la sesión entre estos segundos: la barra
        // flotante debe medir eso, no la duración del ensayo completo.
        recorte: { ini: segIni, fin: segFinRaw },
      }, u);
      window.CancionActiva.fijarVistaAbierta(true);
      // Si la sesión ya estaba cargada (otra marca), saltar ya al punto.
      if (yaEsEstaSesion && pendienteSalto != null) {
        window.CancionActiva.irA(pendienteSalto);
        pendienteSalto = null;
      }
    });

    vistaSub = window.CancionActiva.suscribir(function (s) {
      // .hidden como propiedad no existe en <svg>: hay que tocar el atributo.
      icPlay.toggleAttribute('hidden', s.reproduciendo);
      icPause.toggleAttribute('hidden', !s.reproduciendo);
      btnPlay.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
      btnPlay.classList.toggle('is-sonando', s.reproduciendo);
      tiempoActual = s.actual || 0;
      if (s.total && s.total !== duracionAudio) { duracionAudio = s.total; pintarMarcas(); }
      // Colocar el audio al principio de la canción en cuanto haya duración.
      if (s.total && pendienteSalto != null) {
        var destino = Math.min(pendienteSalto, Math.max(0, s.total - 1));
        pendienteSalto = null;
        window.CancionActiva.irA(destino);
      }
      // Al llegar al final de la canción: si el bucle está activo, volver al
      // principio y seguir; si no, parar ahí (no seguir con el resto del ensayo).
      var finReal = (segFinRaw != null) ? segFinRaw : (s.total || 0);
      if (finReal && s.reproduciendo && s.actual >= finReal - 0.15) {
        if (bucleClip) {
          window.CancionActiva.irA(segIni);
        } else if (segFinRaw != null) {
          window.CancionActiva.alternar();
          window.CancionActiva.irA(segFinRaw);
        }
      }
      // Carril relativo a la canción: 0:00 → duración de la canción.
      var relAct = rel(s.actual), relTot = segTotal();
      tAct.textContent = fmtTiempo(relAct);
      tTot.textContent = fmtTiempo(relTot);
      if (relTot && !barra.matches(':active')) {
        barra.value = String(Math.round((relAct / relTot) * 1000));
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
        btnBucleA.textContent = 'A ' + fmtTiempo(rel(bc.a));
        btnBucleB.disabled = false;
        btnBucleB.classList.add('is-set');
        btnBucleB.textContent = 'B ' + fmtTiempo(rel(bc.b));
        btnBucleOff.hidden = false;
        bucleInfo.textContent = 'Sonando en bucle ' + fmtTiempo(rel(bc.a)) + ' – ' + fmtTiempo(rel(bc.b)) +
          '. Pulsa B para mover el final o Quitar para salir.';
        if (segTotal()) {
          var izq = Math.max(0, Math.min(100, (rel(bc.a) / segTotal()) * 100));
          var der = Math.max(0, Math.min(100, (rel(bc.b) / segTotal()) * 100));
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
        btnBucleA.textContent = 'A ' + fmtTiempo(rel(bucleA));
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

    btnPlay.addEventListener('click', function () {
      var st = window.CancionActiva.estado();
      // Si al dar al play estamos fuera de la canción (antes del inicio o
      // ya en el final), empezamos de nuevo por su principio.
      if (!st.reproduciendo && duracionAudio) {
        if (st.actual < segIni - 0.2 || st.actual >= segFin() - 0.2) {
          window.CancionActiva.irA(segIni);
        }
      }
      reproductor.alternar();
    });
    q('[data-retro]').addEventListener('click', function () {
      reproductor.retroceder(5);
      if (window.CancionActiva.estado().actual < segIni) window.CancionActiva.irA(segIni);
    });

    var btnReplay = q('[data-replay]');
    function pintarReplay() {
      btnReplay.classList.toggle('is-activo', bucleClip);
      btnReplay.setAttribute('aria-pressed', bucleClip ? 'true' : 'false');
    }
    btnReplay.addEventListener('click', function () {
      bucleClip = !bucleClip;
      pintarReplay();
      if (bucleClip) {
        // Al activar: si estamos al final (o fuera), reiniciar la canción.
        var st = window.CancionActiva.estado();
        if (st.actual >= segFin() - 0.3 || st.actual < segIni) window.CancionActiva.irA(segIni);
        if (!st.reproduciendo) reproductor.alternar();
      }
    });
    pintarReplay();
    velBarra.addEventListener('input', function () {
      var v = reproductor.fijarVelocidad(parseFloat(velBarra.value));
      velValor.textContent = fmtVel(v);
    });
    barra.addEventListener('input', function () {
      if (segTotal()) reproductor.irA(segIni + (barra.value / 1000) * segTotal());
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
      '<button type="button" class="transporte__btn" data-tp-replay aria-label="Repetir la canción sin parar" aria-pressed="false">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>' +
      '</button>' +
      '<span class="transporte__tiempo" data-tp-tiempo aria-hidden="true">0:00</span>';

    document.body.appendChild(transporte);

    transporte.querySelector('[data-tp-play]').addEventListener('click', function () {
      var st = window.CancionActiva.estado();
      if (!st.reproduciendo && duracionAudio &&
          (st.actual < segIni - 0.2 || st.actual >= segFin() - 0.2)) {
        window.CancionActiva.irA(segIni);
      }
      reproductor.alternar();
    });
    transporte.querySelector('[data-tp-retro]').addEventListener('click', function () {
      reproductor.retroceder(5);
      if (window.CancionActiva.estado().actual < segIni) window.CancionActiva.irA(segIni);
    });
    transporte.querySelector('[data-tp-replay]').addEventListener('click', function () {
      bucleClip = !bucleClip;
      var b = q('[data-replay]');
      if (b) { b.classList.toggle('is-activo', bucleClip); b.setAttribute('aria-pressed', bucleClip ? 'true' : 'false'); }
      var t = transporte.querySelector('[data-tp-replay]');
      t.classList.toggle('is-activo', bucleClip);
      t.setAttribute('aria-pressed', bucleClip ? 'true' : 'false');
      if (bucleClip) {
        var st = window.CancionActiva.estado();
        if (st.actual >= segFin() - 0.3 || st.actual < segIni) window.CancionActiva.irA(segIni);
        if (!st.reproduciendo) reproductor.alternar();
      }
    });

    // Mostrarlo solo cuando hay un visor a pantalla completa abierto.
    transObs = new MutationObserver(evaluarTransporte);
    transObs.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'],
    });
    evaluarTransporte();
  }

  // Vigila el reproductor de la página: en cuanto sale por arriba del viewport
  // (Maite ha bajado a leer la letra), pedimos la barra flotante; al volver a
  // verse, la retiramos. IntersectionObserver = sin escuchar el scroll a mano.
  function observarReproductor(seccion) {
    if (playerObs || !seccion || typeof IntersectionObserver !== 'function') return;
    playerObs = new IntersectionObserver(function (entradas) {
      playerFuera = !entradas[0].isIntersecting;
      evaluarBarraFlotante();
    }, { threshold: 0 });
    playerObs.observe(seccion);
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
    evaluarBarraFlotante();
  }

  // La barra flotante de window.CancionActiva aparece dentro del modo estudio
  // cuando Maite ha bajado y el reproductor de la página ya no se ve, para que
  // no se quede sin controles con la letra escrita a mano. Se calla si ya hay
  // un visor a pantalla completa (que trae su propia píldora) o si está grabando.
  function evaluarBarraFlotante() {
    if (!window.CancionActiva) return;
    var hayCancion = typeof window.CancionActiva.hayCancion === 'function'
      ? window.CancionActiva.hayCancion() : true;
    var mostrar = playerFuera && hayCancion && !visorAPantallaCompletaAbierto() && !estaGrabando;
    window.CancionActiva.fijarForzarBarra(mostrar);
    // Hueco al final para que la barra no tape el botón "Grabar" ni las
    // grabaciones cuando Maite llega abajo del todo.
    var raiz = cont && cont.querySelector('[data-modulo="study"]');
    if (raiz) raiz.classList.toggle('estudio--barra-repro', mostrar);
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
    var tRep = transporte.querySelector('[data-tp-replay]');
    if (tRep) {
      tRep.classList.toggle('is-activo', bucleClip);
      tRep.setAttribute('aria-pressed', bucleClip ? 'true' : 'false');
    }
    transporte.querySelector('[data-tp-tiempo]').textContent = fmtTiempo(rel(s.actual));
  }

  function desmontarTransporte() {
    if (transObs) { transObs.disconnect(); transObs = null; }
    if (playerObs) { playerObs.disconnect(); playerObs = null; }
    playerFuera = false;
    if (window.CancionActiva) window.CancionActiva.fijarForzarBarra(false);
    if (transporte && transporte.parentNode) transporte.parentNode.removeChild(transporte);
    transporte = null;
  }

  /* ---------- Dame el tono ---------- */

  function montarTono() {
    var caja = q('[data-tono]');
    if (!caja || !window.Tono) return;
    caja.innerHTML = '';
    var clave = cancion ? ('cancion:' + cancion.id) : ('marca:' + marca.id);
    panelTono = window.Tono.montarEn(caja, { clave: clave });
  }

  /* ---------- Letra ---------- */

  function pintarLetra() {
    var vacio = q('[data-letra-vacio]');
    var pre = q('[data-letra-texto]');
    var doc = q('[data-letra-doc]');
    pre.hidden = true; doc.hidden = true;

    if (!cancion) {
      vacio.hidden = false;
      vacio.innerHTML = 'Esta marca no tiene ficha. Vincúlala a una canción del repertorio desde la sesión (toca ✎ en su marca).';
      return;
    }

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

    if (!cancion) { vacio.hidden = false; return; }
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
      window.UI.aviso('Carga el audio de la sesión para poder marcar el minuto difícil.');
      return;
    }
    window.Sesiones.agregarFragmento(sesion.id, marca.id, tiempoActual, '');
    if (window.Diario) {
      window.Diario.registrar('fragmento', {
        cancionId: cancion ? cancion.id : null,
        sesionId: sesion.id, marcaId: marca.id, titulo: marca.titulo,
      });
    }
    refrescar();
    pintarFragmentos();
    pintarMarcas();
  }

  function fragmentos() { return (marca && marca.fragmentos) || []; }

  /* Selector de "tono de entrada" abierto bajo un fragmento (window.Tono). */
  var fragSelector = null;

  function cerrarSelectoresTono() {
    if (fragSelector) {
      if (fragSelector.sel) fragSelector.sel.destruir();
      if (fragSelector.panel) { fragSelector.panel.hidden = true; fragSelector.panel.innerHTML = ''; }
      if (fragSelector.card) fragSelector.card.classList.remove('is-abierto');
      fragSelector = null;
    }
  }

  function abrirSelectorTono(f, card, panel, btn) {
    cerrarSelectoresTono();
    panel.hidden = false;
    if (card) card.classList.add('is-abierto');
    var sel = window.Tono.selectorNota(panel, {
      valor: f.nota || null,
      onCambio: function (nota) {
        window.Sesiones.fijarNotaFragmento(sesion.id, marca.id, f.id, nota);
        refrescar();
        f.nota = nota;   // reflejo local para el próximo toque
        if (btn) {
          btn.classList.add('is-set');
          btn.querySelector('.frag__tono-txt').textContent = window.Tono.etiqueta(nota);
        }
      },
      onCerrar: cerrarSelectoresTono,
    });
    // Botón para dejar el fragmento sin tono.
    var quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'frag__panel-quitar';
    quitar.textContent = 'Sin tono';
    quitar.addEventListener('click', function () {
      window.Sesiones.fijarNotaFragmento(sesion.id, marca.id, f.id, null);
      refrescar();
      f.nota = null;
      cerrarSelectoresTono();
      pintarFragmentos();
    });
    panel.appendChild(quitar);
    fragSelector = { sel: sel, panel: panel, card: card };
  }

  /* Marcas sobre la barra del reproductor que señalan cada fragmento difícil. */
  function pintarMarcas() {
    var caja = q('[data-marcas]');
    if (!caja) return;
    caja.innerHTML = '';
    if (!segTotal()) return;
    fragmentos().forEach(function (f) {
      if (typeof f.segundo !== 'number' || !isFinite(f.segundo)) return;
      if (f.segundo < segIni - 0.5 || f.segundo > segFin() + 0.5) return;
      var pct = Math.min(100, Math.max(0, (rel(f.segundo) / segTotal()) * 100));
      var m = document.createElement('span');
      m.className = 'player__marca';
      m.style.left = pct + '%';
      m.style.background = colorFrag(f);
      m.title = f.texto ? (fmtTiempo(rel(f.segundo)) + ' · ' + f.texto) : fmtTiempo(rel(f.segundo));
      caja.appendChild(m);
    });
  }

  /* Repetir en bucle desde un fragmento marcado: de su minuto hasta el
     siguiente fragmento cercano, o 15 s si no hay ninguno. */
  function bucleDesdeFragmento(seg) {
    if (!reproductor || !duracionAudio) return;
    var fin = Math.min(segFin(), seg + 15);
    fragmentos().forEach(function (f) {
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
    var frags = fragmentos();
    if (!frags.length) {
      caja.innerHTML = '<p class="visor-vacio">Mientras suena el audio, pulsa “Marcar este minuto” en las partes que se te resisten.</p>';
      return;
    }
    caja.innerHTML = '';
    cerrarSelectoresTono();
    frags.slice().reverse().forEach(function (f) {
      var card = document.createElement('div');
      var tieneTiempo = typeof f.segundo === 'number' && isFinite(f.segundo);
      var hayNota = !!(f.nota && window.Tono);
      var etq = hayNota ? window.Tono.etiqueta(f.nota) : '';
      card.className = 'frag' + (f.texto ? ' frag--ancho' : '');
      card.style.setProperty('--frag-color', colorFrag(f));
      var opcionesColor = Object.keys(COLORES_FRAG).map(function (id) {
        return '<button type="button" class="frag__color-op' + (f.color === id || (!f.color && id === 'rojo') ? ' is-sel' : '') + '" ' +
          'data-color="' + id + '" style="background:' + COLORES_FRAG[id].hex + '" ' +
          'aria-label="Color ' + COLORES_FRAG[id].nombre + '"></button>';
      }).join('');
      card.innerHTML =
        '<div class="frag__cab">' +
          (tieneTiempo
            ? '<button type="button" class="frag__tiempo" aria-label="Ir a este momento del audio">' +
                '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5a1 1 0 0 1 1.53-.85l9 6.5a1 1 0 0 1 0 1.7l-9 6.5A1 1 0 0 1 8 18.5z"/></svg>' +
                fmtTiempo(rel(f.segundo)) + '</button>'
            : '<span></span>') +
          '<button type="button" class="frag__quitar" aria-label="Quitar fragmento">✕</button>' +
        '</div>' +
        '<div class="frag__acciones">' +
          (tieneTiempo
            ? '<button type="button" class="frag__bucle" aria-label="Repetir este fragmento en bucle">⟲</button>'
            : '') +
          (window.Tono
            ? '<button type="button" class="frag__tono' + (hayNota ? ' is-set' : '') + '" ' +
                'aria-label="' + (hayNota ? 'Sonar el tono de entrada' : 'Poner el tono de entrada') + '">' +
                '<span class="frag__tono-ic" aria-hidden="true">♪</span>' +
                '<span class="frag__tono-txt">' + (hayNota ? escapar(etq) : 'Tono') + '</span>' +
              '</button>'
            : '') +
          '<button type="button" class="frag__color" aria-label="Color del marcador">' +
            '<span class="frag__color-punto" aria-hidden="true"></span>' +
          '</button>' +
        '</div>' +
        '<div class="frag__colores" data-colores hidden>' + opcionesColor + '</div>' +
        (f.texto ? '<p class="frag__texto">' + escapar(f.texto) + '</p>' : '') +
        '<div class="frag__panel" data-tono-panel hidden></div>';

      if (tieneTiempo) {
        card.querySelector('.frag__tiempo').addEventListener('click', function () {
          if (reproductor) reproductor.irA(f.segundo);
        });
        card.querySelector('.frag__bucle').addEventListener('click', function () {
          bucleDesdeFragmento(f.segundo);
        });
      }

      var btnTono = card.querySelector('.frag__tono');
      var panel = card.querySelector('[data-tono-panel]');
      if (btnTono) {
        btnTono.addEventListener('click', function () {
          if (f.nota && panel.hidden) {
            // Con tono ya puesto: un toque lo hace sonar. Para cambiarlo,
            // se abre el selector con un toque más (queda abierto abajo).
            window.Tono.sonar(f.nota);
            abrirSelectorTono(f, card, panel, btnTono);
            return;
          }
          if (panel.hidden) abrirSelectorTono(f, card, panel, btnTono);
          else cerrarSelectoresTono();
        });
      }

      var btnColor = card.querySelector('.frag__color');
      var cajaColores = card.querySelector('[data-colores]');
      btnColor.addEventListener('click', function () {
        cajaColores.hidden = !cajaColores.hidden;
      });
      cajaColores.querySelectorAll('.frag__color-op').forEach(function (op) {
        op.addEventListener('click', function () {
          var id = op.getAttribute('data-color');
          window.Sesiones.fijarColorFragmento(sesion.id, marca.id, f.id, id);
          f.color = id;
          card.style.setProperty('--frag-color', colorFrag(f));
          cajaColores.querySelectorAll('.frag__color-op').forEach(function (o) {
            o.classList.toggle('is-sel', o === op);
          });
          cajaColores.hidden = true;
          refrescar();
          pintarMarcas();
        });
      });

      card.querySelector('.frag__quitar').addEventListener('click', function () {
        window.Sesiones.borrarFragmento(sesion.id, marca.id, f.id);
        refrescar();
        pintarFragmentos();
        pintarMarcas();
      });
      caja.appendChild(card);
    });
  }

  /* ---------- Grabaciones de la canción ----------
     Grabar cantando mientras se estudia. Cada grabación se guarda en
     window.Grabaciones, así que aparece aquí y también en el apartado
     Grabaciones de la app, todas juntas. */

  /* ¿Hay audio de la sesión para acompañar la grabación? */
  function tieneAudio() {
    return !!(reproductor && sesion && sesion.archivo);
  }

  // Clave con la que se agrupan las grabaciones de esta canción/toma.
  function claveGrab() {
    return cancion ? cancion.id : ('sesion:' + sesion.id + ':' + marca.id);
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
          cancionId: claveGrab(),
          titulo: marca.titulo,
          mime: blob.type,
          dur: dur,
          picos: g.picos(),
          audioOffset: notaOffset,
          // Si la toma llevó la canción de fondo, guardar la sesión: el audio
          // que sonaba es "<sesionId>:audio" y así Grabaciones puede compararlos.
          sesionId: notaOffset != null ? sesion.id : null,
          syncLatencia: (notaOffset != null && window.Sincronia) ? window.Sincronia.latencia() : null,
          syncPerfil: (notaOffset != null && window.Sincronia) ? window.Sincronia.perfilActivo() : null,
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
      // El botón flotante global "Detener grabación" para esta toma.
      window.Grabadora.alParar(alternarGrabacion);

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
      if (reproductor && reproductor.reproduciendo && sesion.archivo) {
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
    var grabs = window.Grabaciones.listarDeCancion(claveGrab());
    if (!grabs.length) {
      caja.innerHTML =
        '<p class="grab-est__vacio">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/></svg>' +
          'Aún no hay grabaciones tuyas aquí.' +
        '</p>';
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
