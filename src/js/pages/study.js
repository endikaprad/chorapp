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
  var tomas = [];             // todos los ensayos de esta pieza [{sesion, marca}]
  var menuDia = null;         // menú desplegable para cambiar de día
  var grabsStagger = true;    // aparición escalonada de grabaciones (solo 1ª vez)

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
  var tourCapa = null;        // overlay del mini-tutorial (solo la 1ª vez)
  var tourReubicar = null;    // listener que recoloca el foco si cambia la maqueta

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
    construirTomas();
    segIni = marca.segundo || 0;
    segFinRaw = (typeof marca.finSegundo === 'number' && marca.finSegundo > segIni) ? marca.finSegundo : null;

    // Si venimos de la barra flotante (misma sesión + misma marca ya sonando),
    // NO reposicionamos el audio: se reanuda donde estaba. Solo forzamos el
    // salto al principio de la canción cuando es una entrada nueva.
    var ant = window.Almacen.leer('estudio:ultimo', null);
    var reanudando = ant && ant.sesionId === sesion.id && ant.marcaId === marca.id &&
      window.CancionActiva && window.CancionActiva.cancionId() === sesion.id &&
      window.CancionActiva.hayCancion();
    pendienteSalto = reanudando ? null : segIni;

    // Recordar dónde estaba estudiando, para el botón "Continuar" de Inicio.
    window.Almacen.guardar('estudio:ultimo', {
      sesionId: sesion.id, marcaId: marca.id, titulo: marca.titulo, cuando: Date.now(),
    });

    // Registrar sesión de práctica (silencioso).
    if (window.Practica) {
      var eraHoy = window.Practica.rachaInfo && window.Practica.rachaInfo().hoyHecho;
      window.Practica.registrar(cancion ? cancion.id : 'marca:' + marca.id);
      // Si es la primera sesión de hoy: reprograma avisos (cancela el
      // recordatorio de racha de esta tarde) y refresca el resumen del
      // panel del hijo (para que "ha estudiado hoy" salga al momento).
      if (!eraHoy) {
        if (window.Avisos && window.Avisos.iniciar) {
          try { window.Avisos.iniciar(); } catch (e) {}
        }
        if (window.Progreso && window.Progreso.iniciar) {
          try { window.Progreso.iniciar(true); } catch (e) {}
        }
      }
    }
    if (window.Diario) {
      window.Diario.registrar('estudio', {
        cancionId: cancion ? cancion.id : null,
        sesionId: sesion.id,
        marcaId: marca.id,
        titulo: marca.titulo,
      });
    }

    pintarCabecera();
    montarSelectorDia();
    montarAnadirOriginal();
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
    montarCompartirCancion();
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

    // Mini-tutorial: solo la primera vez que se abre el Modo estudio.
    var visto = false;
    try { visto = !!localStorage.getItem(TOUR_CLAVE); } catch (e) {}
    if (!visto) setTimeout(tourEstudio, 700);
  }

  function destruir() {
    if (obs) { obs.disconnect(); obs = null; }
    cerrarMenuDia();
    tomas = [];
    grabsStagger = true;
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
    cerrarTour();
    cerrarCompartirCancion();
  }

  /* ----------------------------------------------------------
     Mini-tutorial de Modo estudio — solo la primera vez. Marca
     con un foco los controles que NO se adivinan solos y explica
     cada uno en una frase. Se puede saltar en cualquier momento.
     ---------------------------------------------------------- */
  var TOUR_CLAVE = 'chorapp:estudio:tour-visto';

  var PASOS_TOUR = [
    { sel: '[data-dia-sel]', titulo: 'Elige la versión',
      texto: 'Aquí cambias entre la grabación original y cada ensayo del coro. Cada versión guarda sus propias notas y trozos difíciles.' },
    { sel: '[data-bucle]', titulo: 'Bucle A–B',
      texto: 'Para un trozo que se resiste: pulsa A donde empieza y B donde acaba, y se repetirá solo hasta que lo saques.' },
    { sel: '[data-vel-barra]', titulo: 'Más despacio',
      texto: 'Baja la velocidad para pillar bien una parte rápida. No cambia el tono, solo va más lento.' },
    { sel: '[data-letra-modos]', titulo: 'Cómo ver la letra',
      texto: 'Cambia entre la letra original, cómo suena para cantarla y su traducción. O todo junto, línea a línea.' },
    { sel: '[data-tono]', titulo: 'Dame el tono',
      texto: 'Tu nota de entrada antes de cantar un trozo suelto. Toca una nota y suena, sin depender del audio del ensayo.' },
    { sel: '[data-marcar]', titulo: 'Marca lo difícil',
      texto: 'Cuando llegues a una parte que te cuesta, para el audio y toca aquí. Se guarda ese momento para repasarlo luego desde Práctica.' },
  ];

  function tourEstudio() {
    if (!cont || !document.body.contains(cont) || tourCapa) return;

    var pasos = PASOS_TOUR.filter(function (p) {
      var el = cont.querySelector(p.sel);
      return el && !el.hidden && el.offsetParent !== null;
    });
    if (pasos.length < 2) return;   // si apenas hay nada que enseñar, no molestamos

    var i = 0;
    tourCapa = document.createElement('div');
    tourCapa.className = 'tour';
    tourCapa.innerHTML =
      '<div class="tour__foco" data-foco></div>' +
      '<div class="tour__globo" data-globo>' +
        '<span class="tour__paso" data-paso-n></span>' +
        '<h4 class="tour__titulo" data-t></h4>' +
        '<p class="tour__texto" data-x></p>' +
        '<div class="tour__acc">' +
          '<button type="button" class="tour__saltar" data-saltar>Saltar</button>' +
          '<button type="button" class="btn btn--primario tour__sig" data-sig>Siguiente</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(tourCapa);

    var foco = tourCapa.querySelector('[data-foco]');
    var globo = tourCapa.querySelector('[data-globo]');
    var elActual = null;   // elemento resaltado en el paso que se ve ahora

    // Coloca foco + globo sobre un elemento que YA está en su sitio en pantalla.
    // Se llama tras asentar el scroll y cada vez que la maqueta se mueve.
    function colocar(el) {
      if (!tourCapa || !el) return;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;   // aún sin maquetar: se reintenta al reubicar
      var pad = 8;
      foco.style.left = (r.left - pad) + 'px';
      foco.style.top = (r.top - pad) + 'px';
      foco.style.width = (r.width + pad * 2) + 'px';
      foco.style.height = (r.height + pad * 2) + 'px';

      // El globo se amolda al ancho del elemento resaltado (con los mismos
      // 8px de padding del foco), sin salirse de la pantalla.
      var margen = 12;
      var ancho = Math.min(window.innerWidth - margen * 2, Math.max(240, r.width + pad * 2));
      var izq = Math.min(
        Math.max(margen, r.left - pad),
        window.innerWidth - margen - ancho
      );
      globo.style.left = izq + 'px';
      globo.style.right = 'auto';
      globo.style.width = ancho + 'px';
      globo.style.maxWidth = 'none';
      globo.style.margin = '0';

      var abajo = window.innerHeight - r.bottom;
      var arriba = abajo < globo.offsetHeight + 30;
      globo.classList.toggle('tour__globo--arriba', arriba);
      globo.style.top = (arriba ? Math.max(12, r.top - globo.offsetHeight - 14)
                                : r.bottom + 14) + 'px';
    }

    function pinta() {
      var p = pasos[i];
      var el = cont.querySelector(p.sel);
      if (!el) { cerrarTour(true); return; }
      elActual = el;

      tourCapa.querySelector('[data-paso-n]').textContent = (i + 1) + ' / ' + pasos.length;
      tourCapa.querySelector('[data-t]').textContent = p.titulo;
      tourCapa.querySelector('[data-x]').textContent = p.texto;
      tourCapa.querySelector('[data-sig]').textContent =
        (i === pasos.length - 1) ? 'Entendido' : 'Siguiente';

      // Scroll SIN animación: así la posición final del elemento es inmediata y
      // el foco nunca se dibuja a medio camino (era el origen del desajuste en
      // "Dame el tono" y "Marca lo difícil", los pasos más abajo del todo).
      try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
      // Dos frames: uno deja aplicar el scroll, el otro mide ya asentado.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (tourCapa && elActual === el) colocar(el);
        });
      });
    }

    // Si la maqueta se mueve mientras el tour está abierto (imágenes que cargan,
    // la barra flotante del reproductor, girar el móvil, un scroll de rebote…)
    // recolocamos el foco sobre el paso actual.
    tourReubicar = function () { if (elActual) colocar(elActual); };
    window.addEventListener('resize', tourReubicar);
    window.addEventListener('scroll', tourReubicar, true);

    tourCapa.querySelector('[data-saltar]').addEventListener('click', function () { cerrarTour(true); });
    tourCapa.querySelector('[data-sig]').addEventListener('click', function () {
      if (i >= pasos.length - 1) { cerrarTour(true); return; }
      i++; pinta();
    });
    tourCapa.addEventListener('click', function (ev) {
      if (ev.target === tourCapa || ev.target === foco) {
        if (i >= pasos.length - 1) cerrarTour(true);
        else { i++; pinta(); }
      }
    });
    document.addEventListener('keydown', tourEsc);

    void tourCapa.offsetHeight;
    tourCapa.classList.add('is-visible');
    pinta();
  }

  /* ----------------------------------------------------------
     Compartir la canción — resumen con letra, partitura y trozos
     difíciles (NO las grabaciones). Como imagen o como PDF.
     ---------------------------------------------------------- */
  var hojaComp = null;
  var compGen = null;       // Promise del resumen (imagen + pdf), se genera una vez
  var compUrl = null;       // objectURL de la vista previa, para liberar al cerrar

  function contenidoCompartible() {
    if (!cancion || !window.CompartirCancion) return null;
    var frags = (marca && Array.isArray(marca.fragmentos))
      ? marca.fragmentos.filter(function (f) { return f.texto && f.texto.trim(); }) : [];
    var partIm = cancion.archivos && cancion.archivos.partitura &&
                 /^image\//.test(cancion.archivos.partitura.mime || '');
    // Con que haya una canción del repertorio ya se puede compartir (aunque
    // sea solo el título y el compositor). El resumen crece con lo que tenga.
    return { frags: frags, partIm: partIm };
  }

  function montarCompartirCancion() {
    var sec = cont.querySelector('[data-compartir-seccion]');
    var btn = cont.querySelector('[data-compartir-cancion]');
    var btnCab = cont.querySelector('[data-compartir-cab]');
    var puede = !!contenidoCompartible();
    if (sec) sec.hidden = !puede;
    if (btnCab) btnCab.hidden = !puede;
    if (btn) btn.addEventListener('click', abrirCompartirCancion);
    if (btnCab) btnCab.addEventListener('click', abrirCompartirCancion);
  }

  function abrirCompartirCancion() {
    var cont2 = contenidoCompartible();
    if (!cont2) return;
    cerrarCompartirCancion();

    hojaComp = document.createElement('div');
    hojaComp.className = 'hoja hoja--compartir';
    hojaComp.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Compartir la canción">' +
        '<div class="hoja__asa"></div>' +
        '<h2 class="hoja__titulo">Compartir «' + escapar(cancion.titulo) + '»</h2>' +
        '<p class="comp-cc__nota">Un resumen con la letra, la partitura y los trozos difíciles, con el diseño de ChorApp. Tus grabaciones nunca se comparten.</p>' +

        '<div class="comp-cc__previa" data-comp-previa aria-hidden="true">' +
          '<div class="comp-cc__previa-carga"><span></span><span></span><span></span></div>' +
        '</div>' +

        '<div class="comp-cc__formato" role="group" aria-label="Formato">' +
          '<button type="button" class="comp-cc__seg is-activo" data-comp-fmt="imagen">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 19 5-5 4 4 3-3 2 2"/></svg>' +
            'Imagen<small>Para WhatsApp</small>' +
          '</button>' +
          '<button type="button" class="comp-cc__seg" data-comp-fmt="pdf">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3v5h5"/><path d="M6 3h9l5 5v13H6z"/><path d="M9 13h6M9 17h4"/></svg>' +
            'PDF<small>Para imprimir</small>' +
          '</button>' +
        '</div>' +

        '<div class="comp-cc__acciones">' +
          '<button type="button" class="comp-cc__accion comp-cc__accion--pri" data-comp-accion="enviar">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>' +
            'Compartir' +
          '</button>' +
          '<button type="button" class="comp-cc__accion comp-cc__accion--sec" data-comp-accion="descargar">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>' +
            'Descargar' +
          '</button>' +
        '</div>' +

        '<p class="comp-cc__estado" data-comp-estado hidden></p>' +
        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--texto" data-cerrar>Cerrar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaComp);

    Array.prototype.forEach.call(hojaComp.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarCompartirCancion);
    });
    document.addEventListener('keydown', cerrarCompartirEsc);

    var estado = hojaComp.querySelector('[data-comp-estado]');
    var previa = hojaComp.querySelector('[data-comp-previa]');
    var fmt = 'imagen';

    function accionesActivas(on) {
      Array.prototype.forEach.call(hojaComp.querySelectorAll('.comp-cc__accion'), function (x) { x.disabled = !on; });
    }
    accionesActivas(false);

    // Genera el resumen una sola vez y lo cachea en compGen.
    var partPromesa = cont2.partIm && window.Archivos
      ? window.Archivos.obtener(cancion.id + ':partitura').catch(function () { return null; })
      : Promise.resolve(null);
    compGen = partPromesa.then(function (partBlob) {
      return window.CompartirCancion.generar(cancion, {
        fragmentos: cont2.frags,
        notaToma: marca ? marca.nota : '',
        partitura: partBlob,
      });
    });

    compGen.then(function (res) {
      if (!hojaComp || !res || !res.imagen) return;
      compUrl = URL.createObjectURL(res.imagen);
      var im = new Image();
      im.alt = 'Vista previa del resumen';
      im.onload = function () {
        if (!previa) return;
        previa.innerHTML = '';
        previa.appendChild(im);
        previa.classList.add('is-lista');
      };
      im.src = compUrl;
      accionesActivas(true);
    }).catch(function (e) {
      if (window.console) console.error('Compartir canción (previa):', e);
      if (previa) previa.innerHTML = '<p class="comp-cc__previa-fallo">No se pudo preparar la vista previa</p>';
    });

    // Selector de formato.
    Array.prototype.forEach.call(hojaComp.querySelectorAll('[data-comp-fmt]'), function (b) {
      b.addEventListener('click', function () {
        fmt = b.getAttribute('data-comp-fmt');
        Array.prototype.forEach.call(hojaComp.querySelectorAll('[data-comp-fmt]'), function (x) {
          x.classList.toggle('is-activo', x === b);
        });
      });
    });

    // Compartir / Descargar.
    Array.prototype.forEach.call(hojaComp.querySelectorAll('[data-comp-accion]'), function (b) {
      b.addEventListener('click', function () {
        var accion = b.getAttribute('data-comp-accion');
        estado.hidden = false;
        estado.textContent = 'Preparando…';
        accionesActivas(false);

        compGen.then(function (res) {
          var blob = fmt === 'pdf' ? res.pdf : res.imagen;
          if (!blob) throw new Error('sin archivo');
          var base = (cancion.titulo || 'cancion').replace(/[^\w áéíóúñÁÉÍÓÚÑ-]/g, '').trim() || 'cancion';
          var nombre = base + (fmt === 'pdf' ? '.pdf' : '.png');

          if (accion === 'descargar') {
            estado.textContent = 'Guardando…';
            return window.Compartir.descargar({ blob: blob, nombre: nombre }).then(function (r) {
              estado.textContent = (r && r.via === 'documentos')
                ? 'Guardado en tu carpeta de Documentos ✓'
                : 'Descargado ✓';
              accionesActivas(true);
            });
          }

          estado.textContent = 'Abriendo para compartir…';
          return window.Compartir.enviar({
            blob: blob, nombre: nombre,
            titulo: cancion.titulo,
            texto: cancion.titulo + (cancion.compositor ? ' — ' + cancion.compositor : '') + ' · Coro Bihotsak',
            dialogTitle: 'Compartir la canción',
          }).then(function () { cerrarCompartirCancion(); });
        }).catch(function (e) {
          if (window.console) console.error('Compartir canción:', e);
          estado.textContent = 'No se pudo preparar el archivo.';
          accionesActivas(true);
        });
      });
    });

    void hojaComp.offsetHeight;
    hojaComp.classList.add('is-abierta');
  }

  function cerrarCompartirEsc(e) { if (e.key === 'Escape') cerrarCompartirCancion(); }
  function cerrarCompartirCancion() {
    document.removeEventListener('keydown', cerrarCompartirEsc);
    var h = hojaComp;
    hojaComp = null;
    compGen = null;
    if (compUrl) { try { URL.revokeObjectURL(compUrl); } catch (e) {} compUrl = null; }
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  function tourEsc(e) { if (e.key === 'Escape') cerrarTour(true); }

  function cerrarTour(marcarVisto) {
    if (marcarVisto) { try { localStorage.setItem(TOUR_CLAVE, '1'); } catch (e) {} }
    document.removeEventListener('keydown', tourEsc);
    if (tourReubicar) {
      window.removeEventListener('resize', tourReubicar);
      window.removeEventListener('scroll', tourReubicar, true);
      tourReubicar = null;
    }
    var c = tourCapa;
    tourCapa = null;
    if (!c) return;
    c.classList.remove('is-visible');
    setTimeout(function () { if (c.parentNode) c.remove(); }, 220);
  }

  function refrescar() {
    sesion = window.Sesiones.obtener(sesion.id) || sesion;
    marca = (sesion.marcas || []).filter(function (m) { return m.id === marca.id; })[0] || marca;
    cancion = marca.cancionId ? (window.Canciones.obtener(marca.cancionId) || cancion) : null;
  }

  // Estado vacío de Letra / Partitura con un botón para añadir el archivo
  // sin salir a buscar el lápiz de "Editar": abre la ficha en esa misma fila.
  function vacioConAnadir(el, clave, msg) {
    el.hidden = false;
    el.innerHTML = escapar(msg) +
      ' <button type="button" class="visor-vacio__anadir" data-anadir>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
      'Añadir</button>';
    el.querySelector('[data-anadir]').addEventListener('click', function () {
      if (cancion) window.Pagina_songs.editar(cancion.id, clave);
      else vincularMarca();
    });
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

  /* ---------- Selector de día del ensayo ----------
     Una pieza puede haberse ensayado varios días. En vez de una
     pantalla aparte para elegir el día, se entra al estudio con el
     ensayo más reciente y aquí se puede cambiar de día. */

  function construirTomas() {
    var lista = [];
    if (cancion && window.Sesiones) {
      lista = window.Sesiones.marcasDeCancion(cancion.id) || [];
      // La grabación "Original" (canción suelta), si la hay, va la primera:
      // así siempre se puede volver a ella desde cualquier ensayo.
      var su = window.Sesiones.sueltaDeCancion(cancion.id);
      if (su && su.marcas && su.marcas[0]) {
        lista = [{ sesion: su, marca: su.marcas[0] }].concat(lista);
      }
    }
    var dentro = lista.some(function (t) {
      return t.sesion.id === sesion.id && t.marca.id === marca.id;
    });
    tomas = dentro ? lista : [{ sesion: sesion, marca: marca }].concat(lista);
  }

  function tomaActualIdx() {
    for (var i = 0; i < tomas.length; i++) {
      if (tomas[i].sesion.id === sesion.id && tomas[i].marca.id === marca.id) return i;
    }
    return 0;
  }

  // Etiqueta de una toma: "Original" para la grabación limpia de una
  // "canción suelta" (sesión oculta), o "Ensayo · <fecha>" para un ensayo.
  function etiquetaToma(t, conPrefijo) {
    if (t.sesion.suelta) return 'Original';
    var f = fmtFechaDia(t.sesion.fecha);
    return conPrefijo ? 'Ensayo · ' + f : f;
  }

  var IC_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>';
  var IC_NOTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';

  function montarSelectorDia() {
    var btn = q('[data-dia-sel]');
    if (!btn) return;
    var actual = tomas[tomaActualIdx()];

    // Con una sola toma no hay nada que elegir, pero se muestra igualmente
    // como etiqueta fija (sin desplegable) para dejar claro qué se está
    // escuchando: "Ensayo · <fecha>" o "La canción original". Así los dos
    // caminos (crear desde la sesión / desde el repertorio) se ven igual.
    if (tomas.length <= 1) {
      btn.hidden = false;
      btn.classList.add('estudio__dia--fijo');
      btn.removeAttribute('aria-haspopup');
      btn.removeAttribute('aria-expanded');
      btn.disabled = true;
      var esOrig = actual.sesion.suelta;
      q('[data-dia-sel-txt]').textContent = esOrig ? 'La canción original' : etiquetaToma(actual, true);
      var icF = q('[data-dia-ic]');
      if (icF) icF.innerHTML = esOrig ? IC_NOTA : IC_CAL;
      return;
    }

    btn.hidden = false;
    q('[data-dia-sel-txt]').textContent = etiquetaToma(actual, true);
    var ic = q('[data-dia-ic]');
    if (ic) ic.innerHTML = actual.sesion.suelta ? IC_NOTA : IC_CAL;
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (menuDia) cerrarMenuDia();
      else abrirMenuDia(btn);
    });
  }

  function abrirMenuDia(btn) {
    menuDia = document.createElement('div');
    menuDia.className = 'menu-estado menu-dia';
    var idx = tomaActualIdx();
    tomas.forEach(function (t, i) {
      var op = document.createElement('button');
      op.type = 'button';
      op.className = 'menu-estado__op' + (i === idx ? ' is-actual' : '');
      var m = t.marca;
      var rango = t.sesion.suelta
        ? 'la canción entera'
        : ((typeof m.finSegundo === 'number' && m.finSegundo > m.segundo)
            ? fmtHMS(m.segundo) + '–' + fmtHMS(m.finSegundo)
            : fmtHMS(m.segundo));
      op.innerHTML =
        '<span class="menu-dia__f">' + escapar(etiquetaToma(t, false)) + '</span>' +
        '<span class="menu-dia__r">' + rango + '</span>';
      op.addEventListener('click', function (e) {
        e.stopPropagation();
        cerrarMenuDia();
        if (i === idx) return;
        window.App.ir('estudio', {
          datos: { sesionId: t.sesion.id, marcaId: t.marca.id },
          reemplazar: true,
        });
      });
      menuDia.appendChild(op);
    });
    document.body.appendChild(menuDia);

    var r = btn.getBoundingClientRect();
    var ancho = menuDia.offsetWidth;
    menuDia.style.left = Math.max(10, Math.min(r.left, window.innerWidth - ancho - 10)) + 'px';
    menuDia.style.top = (r.bottom + 6) + 'px';
    void menuDia.offsetHeight;
    menuDia.classList.add('is-abierto');
    btn.classList.add('is-abierto');
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(function () { document.addEventListener('click', cerrarMenuDia); }, 0);
  }

  function cerrarMenuDia() {
    if (!menuDia) return;
    var m = menuDia; menuDia = null;
    m.classList.remove('is-abierto');
    document.removeEventListener('click', cerrarMenuDia);
    var btn = cont && cont.querySelector('[data-dia-sel]');
    if (btn) { btn.classList.remove('is-abierto'); btn.setAttribute('aria-expanded', 'false'); }
    setTimeout(function () { if (m.parentNode) m.remove(); }, 160);
  }

  function fmtFechaDia(iso) {
    var d = new Date((iso || '') + 'T00:00:00');
    if (isNaN(d)) return iso || '';
    try {
      var t = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
        .replace(/\./g, '');
      return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) { return iso || ''; }
  }

  function fmtHMS(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
    if (h) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------- Añadir la canción original ----------
     Si esta canción del repertorio solo se ha marcado en ensayos (no tiene
     su grabación "Original" / canción suelta), enseñamos un botón claro
     para subir su MP3 de referencia. Al subirlo se crea la sesión oculta
     suelta con esa pieza y se entra directamente a estudiarla. */

  function montarAnadirOriginal() {
    var btn = q('[data-anadir-original]');
    var inp = q('[data-input-original]');
    if (!btn || !inp) return;

    var tieneOriginal = tomas.some(function (t) { return t.sesion && t.sesion.suelta; });
    if (!cancion || tieneOriginal) { btn.hidden = true; return; }

    btn.hidden = false;
    btn.addEventListener('click', function () { if (!btn.disabled) inp.click(); });
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      inp.value = '';
      if (f) crearOriginalConAudio(f, btn);
    });
  }

  function crearOriginalConAudio(archivo, btn) {
    btn.disabled = true;
    btn.classList.add('is-cargando');
    var nueva = window.Sesiones.crear({ suelta: true, notas: 'Canción suelta del repertorio.' });
    window.Archivos.guardar(nueva.id + ':audio', archivo).then(function (meta) {
      window.Sesiones.fijarAudio(nueva.id, meta);
      var nuevaMarca = window.Sesiones.agregarMarca(nueva.id, {
        cancionId: cancion.id, titulo: cancion.titulo, segundo: 0,
      });
      if (window.UI) window.UI.aviso('Canción original añadida.', { tipo: 'ok' });
      window.App.ir('estudio', {
        datos: { sesionId: nueva.id, marcaId: nuevaMarca.id },
        reemplazar: true,
      });
    }).catch(function (e) {
      console.error('No se pudo guardar el audio de la canción original:', e);
      window.Sesiones.borrar(nueva.id);
      btn.disabled = false;
      btn.classList.remove('is-cargando');
      if (window.UI) window.UI.aviso('No se pudo guardar el audio.', { tipo: 'error' });
    });
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

  var ETIQ_LETRA = { orig: 'Original', fon: 'Cómo suena', trad: 'Traducción' };

  function pintarLetra() {
    var vacio = q('[data-letra-vacio]');
    var pre = q('[data-letra-texto]');
    var doc = q('[data-letra-doc]');
    var ambasCaja = q('[data-letra-ambas]');
    var modos = q('[data-letra-modos]');
    var accion = q('[data-letra-accion]');
    pre.hidden = true; doc.hidden = true; doc.innerHTML = '';
    ambasCaja.hidden = true; modos.hidden = true;
    if (accion) { accion.hidden = true; accion.innerHTML = ''; }

    if (!cancion) {
      vacio.hidden = false;
      vacio.innerHTML = 'Esta marca no tiene ficha. Vincúlala a una canción del repertorio desde la sesión (toca ✎ en su marca).';
      return;
    }

    var arch = cancion.archivos || {};
    // Cada "vista" de la letra puede venir de texto o de un archivo (PDF/imagen).
    var vistas = {
      orig: { texto: (cancion.letraTexto || '').trim(),      archivo: arch.letra || null,    clave: 'letra',    etq: 'Letra' },
      fon:  { texto: (cancion.letraFonetica || '').trim(),   archivo: arch.fonetica || null, clave: 'fonetica', etq: 'Pronunciación' },
      trad: { texto: (cancion.letraTraduccion || '').trim(), archivo: null,                  clave: null,       etq: 'Traducción' },
    };
    var disponibles = ['orig', 'fon', 'trad'].filter(function (k) {
      return vistas[k].texto || vistas[k].archivo;
    });

    // "Traducir sola": solo si hay letra original en texto y aún no hay traducción.
    var puedeTraducir = !!(window.Traductor && vistas.orig.texto && !vistas.trad.texto);

    if (!disponibles.length) {
      vacioConAnadir(vacio, 'letra', 'Aún no hay letra.');
      return;
    }

    vacio.hidden = true;
    montarVistasLetra(vistas, disponibles, { modos: modos, pre: pre, doc: doc, ambasCaja: ambasCaja });
    if (puedeTraducir && accion) montarBotonTraducir(accion);
  }

  // Conmutador de la letra: un botón por vista disponible (Original / Cómo
  // suena / Traducción) y, si hay 2+ en texto, "Todo junto" alineado línea a
  // línea. Cada vista muestra su texto o su PDF/imagen. Recuerda la elegida.
  function montarVistasLetra(vistas, disponibles, els) {
    var modos = els.modos, pre = els.pre, doc = els.doc, ambasCaja = els.ambasCaja;
    modos.innerHTML = '';

    var conTexto = disponibles.filter(function (k) { return vistas[k].texto; });
    var opciones = disponibles.slice();
    if (conTexto.length >= 2) opciones.push('todo');
    modos.hidden = opciones.length < 2;

    var guardado = window.Almacen.leer('estudio:letraModo', disponibles[0]);
    var modo = opciones.indexOf(guardado) !== -1 ? guardado : disponibles[0];

    opciones.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-modo', k);
      b.textContent = (k === 'todo') ? 'Todo junto' : ETIQ_LETRA[k];
      b.addEventListener('click', function () {
        modo = k;
        window.Almacen.guardar('estudio:letraModo', modo);
        render();
      });
      modos.appendChild(b);
    });

    function render() {
      Array.prototype.forEach.call(modos.children, function (b) {
        b.classList.toggle('is-activo', b.getAttribute('data-modo') === modo);
      });
      pre.hidden = true; ambasCaja.hidden = true; doc.hidden = true; doc.innerHTML = '';

      if (modo === 'todo') {
        var cols = conTexto.map(function (k) { return { k: k, lineas: vistas[k].texto.split('\n') }; });
        var n = cols.reduce(function (mx, c) { return Math.max(mx, c.lineas.length); }, 0);
        var html = '';
        for (var i = 0; i < n; i++) {
          var vacia = cols.every(function (c) { return !(c.lineas[i] || '').trim(); });
          if (vacia) { html += '<div class="visor-letra__par visor-letra__par--vacio"></div>'; continue; }
          html += '<div class="visor-letra__par">';
          cols.forEach(function (c) {
            html += '<span class="visor-letra__linea visor-letra__linea--' + c.k + '">' +
              escapar((c.lineas[i] || '').trim()) + '</span>';
          });
          html += '</div>';
        }
        ambasCaja.innerHTML = html;
        ambasCaja.hidden = false;
        return;
      }

      var v = vistas[modo];
      if (v.texto) { pre.textContent = v.texto; pre.hidden = false; }
      else if (v.archivo) { renderArchivoLetra(v.archivo, v.clave, v.etq, doc, pre); }
    }
    render();
  }

  // Renderiza un archivo (PDF / imagen / texto) de la letra en `doc`.
  function renderArchivoLetra(meta, claveArchivo, etiqueta, doc, pre) {
    var esPdf = /pdf/i.test(meta.mime) || /\.pdf$/i.test(meta.nombre || '');
    var esImagen = /^image\//i.test(meta.mime) || /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(meta.nombre || '');
    window.Archivos.obtener(cancion.id + ':' + claveArchivo).then(function (blob) {
      if (!blob) return;
      if (esPdf) {
        doc.innerHTML = '<div class="visor-pdf" data-pdf-caja></div>' +
          '<button type="button" class="visor-doc__abrir" data-pdf-abrir>Abrir a pantalla completa</button>';
        var caja = doc.querySelector('[data-pdf-caja]');
        window.VisorPDF.render(caja, blob, { paginas: 3 }).catch(function () {});
        caja.addEventListener('click', function () { window.VisorPDF.abrir(blob, etiqueta); });
        doc.querySelector('[data-pdf-abrir]').addEventListener('click', function () { window.VisorPDF.abrir(blob, etiqueta); });
        doc.hidden = false;
      } else if (esImagen) {
        var ui = URL.createObjectURL(blob); urls.push(ui);
        doc.innerHTML = '<img class="visor-doc__img" alt="' + escapar(etiqueta) + '" />';
        var im = doc.querySelector('img');
        im.src = ui;
        im.addEventListener('click', function () { abrirLightbox(ui); });
        doc.hidden = false;
      } else {
        blob.text().then(function (t) { pre.textContent = t; pre.hidden = false; });
      }
    });
  }

  // Botón "Traducir la letra al español" (bajo el visor). Traduce con
  // window.Traductor, guarda la traducción en la canción y repinta.
  function montarBotonTraducir(accion) {
    accion.hidden = false;
    accion.innerHTML =
      '<button type="button" class="visor-letra__traducir" data-btn-traducir>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20"/></svg>' +
        '<span>Traducir la letra al español</span>' +
      '</button>';
    var btn = accion.querySelector('[data-btn-traducir]');
    var etq = btn.querySelector('span');
    btn.addEventListener('click', function () {
      var texto = (cancion.letraTexto || '').trim();
      if (!texto) return;
      var de = window.Traductor.codigoGoogle(cancion.idioma || '');
      btn.disabled = true;
      btn.classList.add('is-cargando');
      etq.textContent = 'Traduciendo…';
      window.Traductor.traducir(texto, { de: de, a: 'es' }).then(function (res) {
        window.Canciones.actualizar(cancion.id, { letraTraduccion: res });
        window.Almacen.guardar('estudio:letraModo', 'trad');
        refrescar();
        pintarLetra();
        if (window.UI) window.UI.aviso('Traducción lista. Puedes retocarla a mano en ✎ Editar.', { tipo: 'ok' });
      }).catch(function (err) {
        btn.disabled = false;
        btn.classList.remove('is-cargando');
        etq.textContent = 'Traducir la letra al español';
        var msg;
        if (de === 'auto') {
          // Sin idioma no hay traductor de repuesto: Google es la única vía.
          msg = 'Google está ocupado ahora mismo. Pon el idioma de la canción en ✎ Editar y vuelve a probar: así puede usar el traductor de repuesto.';
        } else {
          msg = 'Los traductores están ocupados ahora mismo. Prueba dentro de un rato.';
        }
        if (window.UI) window.UI.aviso(msg, { tipo: 'error' });
      });
    });
  }

  /* ---------- Partitura ---------- */

  function pintarPartitura() {
    var vacio = q('[data-partitura-vacio]');
    var cajaImg = q('[data-partitura-img]');
    var img = q('[data-partitura-src]');
    var doc = q('[data-partitura-doc]');
    cajaImg.hidden = true; doc.hidden = true;

    if (!cancion) {
      vacio.hidden = false;
      vacio.innerHTML = 'Esta marca no tiene ficha. Vincúlala a una canción del repertorio desde la sesión (toca ✎ en su marca).';
      return;
    }
    var meta = cancion.archivos && cancion.archivos.partitura;
    if (!meta) { vacioConAnadir(vacio, 'partitura', 'Aún no hay partitura.'); return; }
    vacio.hidden = true;

    var esPdf = /pdf/i.test(meta.mime) || /\.pdf$/i.test(meta.nombre || '');
    if (esPdf) {
      window.Archivos.obtener(cancion.id + ':partitura').then(function (blob) {
        if (!blob) { vacioConAnadir(vacio, 'partitura', 'Aún no hay partitura.'); return; }
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
      if (!u) { vacioConAnadir(vacio, 'partitura', 'Aún no hay partitura.'); return; }
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
          // Toma concreta: así esta versión (original / ensayo del día)
          // enseña solo sus grabaciones, no todas las de la canción.
          marcaId: marca.id,
          titulo: marca.titulo,
          mime: blob.type,
          dur: dur,
          picos: g.picos(),
          audioOffset: notaOffset,
          // Sesión de esta toma. Se guarda SIEMPRE (aunque la toma sea a
          // capela) para que Grabaciones sepa de qué versión es —original
          // o ensayo—. La comparación voz+pista se activa solo si además
          // hay `audioOffset` (llevó la canción de fondo).
          sesionId: sesion.id,
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
    var grabs = window.Grabaciones.listarDeToma(sesion.id, marca.id, claveGrab());
    if (!grabs.length) {
      caja.classList.remove('stagger', 'lista--refresca');
      caja.innerHTML =
        '<p class="grab-est__vacio">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/></svg>' +
          'Aún no hay grabaciones tuyas aquí.' +
        '</p>';
      return;
    }
    caja.classList.toggle('stagger', grabsStagger);
    caja.classList.toggle('lista--refresca', !grabsStagger);
    grabsStagger = false;
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
          if (!ok) return;
          colapsarYQuitar(fila, 0, function () {
            window.Grabaciones.borrar(g.id).then(pintarGrabaciones);
          });
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

  // Anima la salida de una fila (colapso de altura + fade) y luego llama a
  // `hecho`. `gap` = separación del contenedor (flex gap) a comerse, si la hay.
  function colapsarYQuitar(el, gap, hecho) {
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce) { hecho(); return; }
    el.style.maxHeight = el.scrollHeight + 'px';
    if (gap) el.style.setProperty('--colapsa-gap', gap + 'px');
    void el.offsetHeight;
    el.classList.add('item-colapsa');
    el.style.maxHeight = '0px';
    var listo = false;
    function fin() { if (listo) return; listo = true; hecho(); }
    el.addEventListener('transitionend', function (ev) {
      if (ev.propertyName === 'max-height' || ev.propertyName === 'opacity') fin();
    });
    setTimeout(fin, 340);
  }

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

  return {
    iniciar: iniciar,
    // Para volver a ver el tutorial (p. ej. desde un botón de ayuda).
    tour: function () { try { localStorage.removeItem(TOUR_CLAVE); } catch (e) {} tourEstudio(); },
  };
})();
