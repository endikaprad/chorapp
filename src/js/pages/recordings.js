/* ============================================================
   Pagina_recordings — Grabadora personal (Fase 7)
   Grabar cantando, guardar por canción y fecha, escuchar y borrar.
   ============================================================ */

window.Pagina_recordings = (function () {
  'use strict';

  var raiz, selCancion, btnRec, btnRecTxt, aviso, lista, vacio, filtro;
  var filtroCat = null;   // categoría activa de la barra de filtros (o null = todas)
  var grabadora = null, crono = null, urls = [];
  // Si al empezar a grabar hay una sesión del coro sonando (el audio del
  // modo estudio, que sigue vivo en window.CancionActiva), guardamos cuál
  // es y en qué segundo iba: así la toma se sincroniza con esa pista igual
  // que en el modo estudio.
  var recSesion = null, recOffset = null;
  var obs = null, vacioP = null, vacioTxt = '';
  var calibrando = false;
  var primeraLista = true;   // 1ª pintada = aparición escalonada; luego, fundido
  var selEscucha = null;   // { refrescar } del selector Altavoz/Auriculares
  var tourCapa = null;       // overlay del mini-tutorial (solo la 1ª vez)
  var tourReubicar = null;   // listener que recoloca el foco si cambia la maqueta
  var tourClaveActiva = null; // clave localStorage del tour que se ve ahora
  var tourCmpLanzado = false; // ya se ha intentado el tour de comparación en esta pintada

  function iniciar(contenedor) {
    limpiar();

    raiz = contenedor.querySelector('[data-modulo="recordings"]');
    selCancion = raiz.querySelector('[data-cancion]');
    btnRec = raiz.querySelector('[data-rec]');
    btnRecTxt = raiz.querySelector('[data-rec-txt]');
    aviso = raiz.querySelector('[data-aviso]');
    lista = raiz.querySelector('[data-lista]');
    filtro = raiz.querySelector('[data-filtro]');
    filtroCat = null;
    vacio = raiz.querySelector('[data-vacio]');
    vacioP = vacio ? vacio.querySelector('p') : null;
    vacioTxt = vacioP ? vacioP.innerHTML : '';

    // Rellena el desplegable con las canciones.
    (window.Canciones ? window.Canciones.listar() : []).forEach(function (c) {
      var op = document.createElement('option');
      op.value = c.id;
      op.textContent = c.titulo;
      selCancion.appendChild(op);
    });
    if (window.Selector) window.Selector.mejorar(selCancion);

    if (!window.Grabadora.soportado()) {
      btnRec.disabled = true;
      aviso.textContent = 'Este dispositivo no permite grabar audio desde la app.';
      aviso.hidden = false;
    }

    montarEscucha();

    primeraLista = true;
    btnRec.addEventListener('click', alternar);
    document.addEventListener('chorapp:bloqueo', pararPorBloqueo);
    selCancion.addEventListener('change', pintarLista);
    pintarLista();

    var vista = document.getElementById('vista');
    obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) destruir();
    });
    obs.observe(vista, { childList: true, subtree: true });

    // Mini-tutorial: solo la primera vez que se llega a Grabaciones.
    var visto = false;
    try { visto = !!localStorage.getItem(TOUR_CLAVE); } catch (e) {}
    if (!visto) setTimeout(tourGrabaciones, 700);
  }

  function destruir() {
    if (obs) { obs.disconnect(); obs = null; }
    cerrarTour(false);
    selEscucha = null;
    var ov = document.querySelector('.calib-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    document.body.style.overflow = '';
    calibrando = false;
    document.removeEventListener('chorapp:bloqueo', pararPorBloqueo);
    if (grabadora) { grabadora.cancelar(); grabadora = null; }
    if (crono) { clearInterval(crono); crono = null; }
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];
  }

  function limpiar() { destruir(); }

  /* ---------- Grabación ---------- */

  function alternar() {
    if (grabadora && grabadora.grabando) return detener();
    empezar();
  }

  // Si el hijo bloquea la app durante una grabación, la cerramos y
  // guardamos lo grabado hasta ese momento.
  function pararPorBloqueo() {
    if (grabadora && grabadora.grabando) detener();
  }

  function empezar() {
    recSesion = null;
    recOffset = null;

    grabadora = window.Grabadora.crear();
    grabadora.iniciar().then(function () {
      // ¿Hay una sesión del coro sonando ahora mismo? (window.CancionActiva
      // carga la sesión del modo estudio con id = sesionId.) Si es así,
      // anotamos la sesión y el segundo por el que va, para sincronizar.
      if (window.CancionActiva && window.CancionActiva.reproduciendo &&
          window.CancionActiva.hayCancion() && window.Sesiones) {
        var sAct = window.Sesiones.obtener(window.CancionActiva.cancionId());
        if (sAct && sAct.archivo) {
          recSesion = sAct;
          recOffset = Math.max(0, (window.CancionActiva.estado().actual) || 0);
        }
      }

      // El botón flotante global "Detener grabación" para esta toma.
      window.Grabadora.alParar(detener);

      var t0 = Date.now();
      raiz.classList.add('is-grabando');
      btnRec.classList.add('is-grabando');
      selCancion.disabled = true;
      btnRecTxt.textContent = 'Detener (0:00)';
      crono = setInterval(function () {
        btnRecTxt.textContent = 'Detener (' + fmt((Date.now() - t0) / 1000) + ')';
      }, 500);
      btnRec._t0 = t0;
    }).catch(function () {
      grabadora = null;
      aviso.textContent = 'No se pudo acceder al micrófono. Revisa los permisos.';
      aviso.hidden = false;
    });
  }

  function detener() {
    var g = grabadora; grabadora = null;
    var dur = (Date.now() - (btnRec._t0 || Date.now())) / 1000;
    if (crono) { clearInterval(crono); crono = null; }
    btnRec.disabled = true;
    g.parar().then(function (blob) {
      btnRec.disabled = false;
      raiz.classList.remove('is-grabando');
      btnRec.classList.remove('is-grabando');
      selCancion.disabled = false;
      btnRecTxt.textContent = 'Empezar a grabar';
      if (!blob || !blob.size) return;

      // La canción elegida en el desplegable etiqueta la toma (agrupa las
      // grabaciones). La sesión que sonaba de fondo es lo que permite la
      // comparación voz + pista original después.
      var c = selCancion.value && window.Canciones
        ? window.Canciones.obtener(selCancion.value) : null;
      var conSesion = !!recSesion;
      return window.Grabaciones.crear({
        cancionId: c ? c.id : null,
        titulo: c ? c.titulo
                  : (conSesion ? 'Sobre una sesión del coro' : 'Sin canción concreta'),
        mime: blob.type,
        dur: Math.round(dur),
        picos: g.picos(),
        sesionId: conSesion ? recSesion.id : null,
        audioOffset: conSesion ? recOffset : null,
        syncLatencia: conSesion && window.Sincronia ? window.Sincronia.latencia() : null,
        syncPerfil: conSesion && window.Sincronia ? window.Sincronia.perfilActivo() : null,
      }, blob).then(pintarLista);
    });
  }

  /* ---------- "Escuchando con" (Altavoz / Auriculares) ---------- */

  function montarEscucha() {
    if (!window.Sincronia) return;
    var cont = raiz.querySelector('[data-escucha]');
    selEscucha = window.Sincronia.montarSelector(cont, {
      // Al cambiar de dispositivo, todo lo de sincronía pasa a mostrar y usar
      // el retardo de ESE dispositivo: re-render de las comparaciones.
      onCambio: function () { pintarEscucha(); pintarLista(); },
    });

    // Panel de calibración rápida, a mano, JUSTO debajo del selector.
    // Solo se muestra con el altavoz (con auriculares no se puede medir
    // sola, se ajusta a oído en cada grabación). Recuerda a cómo estaba
    // "al principio de todo": un botón grande y el estado de si está
    // calibrado o no.
    var panel = document.createElement('div');
    panel.className = 'escucha-cal';
    panel.setAttribute('data-escucha-cal', '');
    panel.innerHTML =
      '<span class="escucha-cal__ico" data-cal-ico aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>' +
      '</span>' +
      '<span class="escucha-cal__txt">' +
        '<b class="escucha-cal__tit" data-cal-tit></b>' +
        '<span class="escucha-cal__sub" data-cal-sub></span>' +
        '<button type="button" class="escucha-cal__b" data-cal-b></button>' +
      '</span>';
    cont.parentNode.insertBefore(panel, cont.nextSibling);
    panel.querySelector('[data-cal-b]').addEventListener('click', calibrarAltavoz);
    pintarEscucha();
  }

  // Refresca el panel de calibración rápida según el perfil activo.
  function pintarEscucha() {
    if (!window.Sincronia) return;
    var panel = raiz && raiz.querySelector('[data-escucha-cal]');
    if (!panel) return;

    // Solo con el altavoz: el micro del móvil no oye un pitido que suena
    // dentro de unos auriculares.
    var soloAltavoz = window.Sincronia.perfilActivo() === 'altavoz';
    var puede = soloAltavoz && !!window.Grabadora.calibrarLatencia;
    panel.hidden = !puede;
    if (!puede) return;

    var p = window.Sincronia.perfil('altavoz');
    var tit = panel.querySelector('[data-cal-tit]');
    var sub = panel.querySelector('[data-cal-sub]');
    var btn = panel.querySelector('[data-cal-b]');

    if (p.calibrado) {
      panel.className = 'escucha-cal is-ok';
      tit.textContent = 'Altavoz calibrado';
      sub.textContent = (p.manual ? 'Ajustado a mano' : 'Medido') +
        ' · retardo ' + Math.round(p.latencia * 1000) + ' ms';
      btn.textContent = 'Volver a calibrar';
    } else {
      panel.className = 'escucha-cal is-pend';
      tit.textContent = 'Sin calibrar';
      sub.textContent = 'Mide el retardo del altavoz para que tus grabaciones encajen con la canción.';
      btn.textContent = 'Calibrar';
    }
    btn.disabled = calibrando;
    if (calibrando) btn.textContent = 'Calibrando…';
  }

  /* ---------- Calibración automática del altavoz ---------- */

  // Para TODO lo que esté sonando o grabando antes de calibrar: la canción
  // del modo estudio, cualquier grabación en curso y cualquier <audio> de
  // la pantalla (comparaciones, mini-reproductores).
  function pausarTodo() {
    try {
      if (window.CancionActiva && window.CancionActiva.reproduciendo) {
        window.CancionActiva.alternar();
      }
    } catch (e) {}
    if (grabadora && grabadora.grabando) { try { detener(); } catch (e) {} }
    var audios = document.querySelectorAll('audio');
    for (var i = 0; i < audios.length; i++) { try { audios[i].pause(); } catch (e) {} }
  }

  // Overlay a pantalla completa mientras suenan los pitidos.
  function overlayCalib() {
    var el = document.createElement('div');
    el.className = 'calib-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="calib-overlay__caja">' +
        '<span class="calib-overlay__icono" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>' +
        '</span>' +
        '<h2 class="calib-overlay__titulo">Calibrando el altavoz</h2>' +
        '<p class="calib-overlay__texto" data-txt>Deja el móvil quieto sobre la mesa y no hables. Vas a oír 4 pitidos.</p>' +
        '<div class="calib-overlay__pips" data-pips aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
        '<button type="button" class="calib-overlay__cerrar" data-cerrar hidden>Cerrar</button>' +
      '</div>';
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    void el.offsetWidth;
    el.classList.add('is-visible');

    var txt = el.querySelector('[data-txt]');
    var pips = el.querySelectorAll('[data-pips] i');
    var btnCerrar = el.querySelector('[data-cerrar]');
    btnCerrar.addEventListener('click', cerrar);

    function cerrar() {
      el.classList.remove('is-visible');
      document.body.style.overflow = '';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }
    return {
      paso: function (h, t) {
        txt.textContent = 'Pitido ' + h + ' de ' + t + '…';
        for (var i = 0; i < pips.length; i++) pips[i].classList.toggle('is-on', i < h);
      },
      ok: function (ms) {
        el.classList.add('is-ok');
        el.querySelector('.calib-overlay__titulo').textContent = '¡Listo!';
        txt.textContent = 'Retardo del altavoz: ' + ms + ' ms.';
        setTimeout(cerrar, 1600);
      },
      error: function (msg) {
        el.classList.add('is-error');
        el.querySelector('.calib-overlay__titulo').textContent = 'No se pudo calibrar';
        txt.textContent = msg;
        btnCerrar.hidden = false;
      },
      cerrar: cerrar,
    };
  }

  function calibrarAltavoz() {
    if (calibrando || !window.Grabadora.calibrarLatencia) return;
    calibrando = true;
    pintarEscucha();
    pausarTodo();
    var ov = overlayCalib();

    window.Grabadora.calibrarLatencia({
      onPaso: function (h, t) { ov.paso(h, t); },
    }).then(function (res) {
      window.Sincronia.guardarCalibracion('altavoz', res.latencia, res.muestras);
      calibrando = false;
      ov.ok(Math.round(res.latencia * 1000));
      if (raiz && document.body.contains(raiz)) { pintarEscucha(); pintarLista(); }
    }).catch(function (err) {
      calibrando = false;
      pintarEscucha();
      var m = err && err.motivo;
      ov.error(
        m === 'permiso' ? 'No se pudo usar el micrófono. Revisa los permisos de la app.' :
        m === 'sinapi' ? 'Este móvil no puede calibrar solo. Ajústalo a mano con − / +.' :
        'No se oyeron bien los pitidos. Busca un sitio en silencio, sube el volumen y prueba otra vez.');
    });
  }

  /* ---------- Barra de filtros por origen ---------- */

  // Pinta un chip "Todas" + un chip por cada categoría con grabaciones.
  // `base` = grabaciones ya filtradas por la canción del desplegable.
  function pintarFiltro(base) {
    if (!filtro || !window.Grabaciones) return;
    var conteo = window.Grabaciones.conteoPorCategoria(base);
    var cats = window.Grabaciones.CATEGORIAS.filter(function (c) { return conteo[c.id] > 0; });

    // Con una sola categoría (o ninguna) no hay nada que separar: sin barra.
    if (cats.length < 2) {
      filtro.hidden = true;
      filtro.innerHTML = '';
      filtroCat = null;
      return;
    }

    // Si la categoría activa se quedó sin grabaciones, volver a "Todas".
    if (filtroCat && !conteo[filtroCat]) filtroCat = null;

    filtro.hidden = false;
    filtro.innerHTML = '';
    var chips = [{ id: null, etiqueta: 'Todas', n: base.length }].concat(
      cats.map(function (c) { return { id: c.id, etiqueta: c.etiqueta, n: conteo[c.id] }; })
    );
    chips.forEach(function (ch) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'grab-filtro__chip' + (filtroCat === ch.id ? ' is-activo' : '');
      b.setAttribute('aria-pressed', String(filtroCat === ch.id));
      b.textContent = ch.etiqueta + ' (' + ch.n + ')';
      b.addEventListener('click', function () {
        filtroCat = ch.id;
        pintarLista();
      });
      filtro.appendChild(b);
    });
  }

  /* ---------- Lista ---------- */

  function pintarLista() {
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];
    tourCmpLanzado = false;   // se reevalúa en cada pintada

    var filtroId = selCancion && selCancion.value ? selCancion.value : null;
    var grabs = window.Grabaciones
      ? (filtroId ? window.Grabaciones.listarDeCancion(filtroId) : window.Grabaciones.listar())
      : [];

    // Barra de filtros por origen (ensayo / canción de ensayo / limpia / voz).
    // Se pinta sobre el conjunto ya filtrado por canción y solo con las
    // categorías que tienen alguna grabación.
    pintarFiltro(grabs);
    if (filtroCat && window.Grabaciones) {
      grabs = grabs.filter(function (g) { return window.Grabaciones.categoria(g) === filtroCat; });
    }

    vacio.hidden = grabs.length > 0;
    if (vacioP && filtroCat) {
      vacioP.textContent = 'No hay grabaciones en este filtro. Toca «Todas» para verlas todas.';
    } else if (vacioP && filtroId) {
      vacioP.textContent = 'Todavía no hay grabaciones de esta canción. Pulsa Empezar a grabar y canta.';
    } else if (vacioP) {
      vacioP.innerHTML = vacioTxt;
    }
    lista.innerHTML = '';
    if (!grabs.length) return;

    var cont = document.createElement('div');
    cont.className = 'lista ' + (primeraLista ? 'stagger' : 'lista--refresca');
    primeraLista = false;
    grabs.forEach(function (g) {
      var fila = document.createElement('div');
      fila.className = 'grabacion';
      fila.innerHTML =
        '<div class="grabacion__cab">' +
          '<span class="grabacion__titulo">' + escapar(g.titulo) + '</span>' +
          '<span class="grabacion__fecha">' + fmtFecha(g.creado) + '</span>' +
        '</div>' +
        '<div class="grabacion__fila">' +
          window.MiniPlayer.plantilla() +
          '<button type="button" class="ficha__quitar" aria-label="Eliminar grabación">✕</button>' +
        '</div>';

      // Si la toma es sobre un ENSAYO del coro, decir DE QUÉ DÍA era ese
      // ensayo (no cuándo se grabó la toma: eso ya está en la cabecera).
      if (window.Grabaciones && window.Grabaciones.categoria(g) === 'cancion-ensayo') {
        var sIdEns = sesionIdDe(g);
        var sEns = sIdEns && window.Sesiones ? window.Sesiones.obtener(sIdEns) : null;
        if (sEns && !sEns.suelta && sEns.fecha) {
          var et = document.createElement('span');
          et.className = 'grabacion__ensayo';
          et.textContent = 'Ensayo del ' + fmtFechaEnsayo(sEns.fecha);
          fila.querySelector('.grabacion__cab').appendChild(et);
        }
      }

      var audio = fila.querySelector('audio');
      window.MiniPlayer.montar(fila.querySelector('[data-mp]'), g.dur || 0, g.picos);
      window.Grabaciones.url(g.id).then(function (u) {
        if (u) { urls.push(u); audio.src = u; }
      });

      // Comparación: debajo de tu grabación, el trozo de la sesión del coro
      // que sonaba mientras Maite cantaba. Solo si la toma se grabó CON la
      // sesión sonando (en modo estudio o aquí mismo): hace falta la sesión
      // (con audio) y el segundo en que empezó la toma.
      var sesionCmpId = sesionIdDe(g);
      var sesionCmp = sesionCmpId && window.Sesiones ? window.Sesiones.obtener(sesionCmpId) : null;
      var sincro = typeof g.audioOffset === 'number' && isFinite(g.audioOffset);
      var conComparacion = !!(sesionCmp && sesionCmp.archivo && sincro);

      // Enviar (WhatsApp, Bluetooth…) y descargar. Si hay comparación, los
      // botones van DENTRO del desplegable "Ajustar", debajo de los ms.
      // Si no, en su propio desplegable "Enviar o descargar".
      if (window.Compartir && !conComparacion) montarAcciones(fila, g);

      if (conComparacion) {
        (function () {
          // La toma se grabó con la canción de fondo: la pista original suena
          // a la vez y SOLO el trozo que Maite grabó (de audioOffset a
          // audioOffset + duración de la toma). La gobierna su reproductor.
          var offset = Math.max(0, g.audioOffset);
          var trozo = Math.max(1, g.dur || 0);

          // Retardo con el que alinear: el del dispositivo seleccionado ARRIBA
          // ("Escuchando con"). `ajuste` es un retoque EN MEMORIA mientras
          // Maite prueba con − / +; NO se guarda hasta que pulsa "Guardar".
          function latAhora() { return window.Sincronia.latencia(); }
          var ajuste = 0;
          function getLat() { return latAhora() + ajuste; }

          var ref = document.createElement('div');
          ref.className = 'grabacion__ref';
          ref.innerHTML =
            '<div class="ref-modo" role="group" aria-label="Qué escuchar">' +
              '<button type="button" class="ref-modo__b" data-modo="voz">Solo mi voz</button>' +
              '<button type="button" class="ref-modo__b is-activo" data-modo="mix">Con la canción</button>' +
            '</div>' +
            '<div class="pista-trozo" data-trozobox>' +
              '<div class="pista-trozo__barra"><i data-relleno></i></div>' +
              '<span class="pista-trozo__t" data-t></span>' +
            '</div>' +
            '<label class="ref-vol" data-volbox>' +
              '<span class="ref-vol__et">Volumen de la canción</span>' +
              '<input type="range" min="0" max="1" step="0.05" value="0.8" data-vol ' +
                'aria-label="Volumen de la pista original">' +
            '</label>' +
            '<details class="ref-ajuste" data-ajustebox>' +
              '<summary class="ref-ajuste__cab">' +
                '<span>Ajustar milisegundos · enviar o descargar</span>' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
              '</summary>' +
              '<div class="ref-ajuste__cuerpo">' +
                '<p class="ref-ajuste__perfil" data-fino-perfil></p>' +
                '<div class="ref-fino__ctrl">' +
                  '<button type="button" class="ref-fino__b" data-fino="-" aria-label="Adelantar la canción 10 milisegundos">−</button>' +
                  '<span class="ref-fino__val" data-fino-val aria-live="polite"></span>' +
                  '<button type="button" class="ref-fino__b" data-fino="+" aria-label="Atrasar la canción 10 milisegundos">+</button>' +
                '</div>' +
                '<p class="ref-fino__ayuda">Pulsa mientras escuchas «Con la canción». Si tu voz suena <b>después</b> de la canción, pulsa +. Si suena <b>antes</b>, pulsa −. Mantén pulsado para ir más rápido.</p>' +
                '<button type="button" class="ref-fino__guardar" data-fino-guardar hidden></button>' +
                '<button type="button" class="ref-fino__cal" data-fino-cal hidden>Calibrar automáticamente</button>' +
              '</div>' +
            '</details>' +
            '<audio preload="metadata" data-orig></audio>';
          var audioRef = ref.querySelector('[data-orig]');
          fila.appendChild(ref);

          // Enviar / descargar: dentro del mismo desplegable "Ajustar",
          // debajo de los controles de milisegundos.
          if (window.Compartir) {
            var cuerpoAjuste = ref.querySelector('.ref-ajuste__cuerpo');
            if (cuerpoAjuste) {
              var sep = document.createElement('p');
              sep.className = 'ref-ajuste__sub';
              sep.textContent = 'Enviar o descargar esta grabación';
              cuerpoAjuste.appendChild(sep);
              cuerpoAjuste.appendChild(crearAcciones(g));
            }
          }

          window.Archivos.url(sesionCmpId + ':audio').then(function (u) {
            if (u) { urls.push(u); audioRef.src = u; }
          });

          // "Solo mi voz" / "Con la canción" + volumen de la pista original.
          var modo = 'mix';
          var inVol = ref.querySelector('[data-vol]');
          audioRef.volume = parseFloat(inVol.value);
          function aplicarModo() {
            var mix = modo === 'mix';
            ref.querySelectorAll('[data-modo]').forEach(function (b) {
              b.classList.toggle('is-activo', b.getAttribute('data-modo') === modo);
            });
            ref.querySelector('[data-trozobox]').hidden = !mix;
            ref.querySelector('[data-volbox]').hidden = !mix;
            ref.querySelector('[data-ajustebox]').hidden = !mix;
            if (!mix) audioRef.pause();
          }
          ref.querySelectorAll('[data-modo]').forEach(function (b) {
            b.addEventListener('click', function () {
              modo = b.getAttribute('data-modo');
              aplicarModo();
              if (modo === 'mix' && !audio.paused) {
                audioRef.currentTime = offset + Math.max(0, audio.currentTime - getLat());
                var p = audioRef.play(); if (p && p.catch) p.catch(function () {});
              }
            });
          });
          inVol.addEventListener('input', function () {
            audioRef.volume = parseFloat(inVol.value);
          });

          // Retoque fino: salta de 10 en 10 ms (mantener pulsado = repetición).
          var finoVal = ref.querySelector('[data-fino-val]');
          var btnGuardar = ref.querySelector('[data-fino-guardar]');
          var finoPerfil = ref.querySelector('[data-fino-perfil]');
          var btnCal = ref.querySelector('[data-fino-cal]');
          var enlace = null;

          function pintaFino() {
            var activo = window.Sincronia.perfilActivo();
            var nombre = window.Sincronia.nombrePerfil(activo).toLowerCase();
            // El número es el retardo del dispositivo SELECCIONADO ARRIBA
            // (+ el retoque de esta toma). Cambiar de dispositivo lo cambia.
            var totalMs = Math.round((latAhora() + ajuste) * 1000);
            finoVal.textContent = totalMs + ' ms';
            finoVal.classList.toggle('is-cero', totalMs === 0);

            var p = window.Sincronia.perfil(activo);
            finoPerfil.textContent = 'Retardo ' +
              (activo === 'bluetooth' ? 'de los auriculares' : 'del altavoz') +
              (p.calibrado ? (p.manual ? ' · puesto a mano' : ' · medido') : ' · sin ajustar');

            // "Guardar" solo si Maite ha retocado a mano.
            btnGuardar.hidden = Math.abs(ajuste) <= 0.0005;
            btnGuardar.textContent = 'Guardar ' + totalMs + ' ms para ' + nombre;

            // La calibración automática solo va con el altavoz (el micro del
            // móvil no oye un pitido que suena dentro de unos auriculares).
            var puedeCal = !!window.Grabadora.calibrarLatencia && activo === 'altavoz';
            btnCal.hidden = !puedeCal;
            btnCal.textContent = p.calibrado ? 'Volver a calibrar automáticamente'
                                             : 'Calibrar automáticamente';
          }

          // Parpadeo del número para que se note que la pulsación cuenta.
          function destelloFino() {
            finoVal.classList.remove('is-cambio');
            void finoVal.offsetWidth;   // reinicia la animación
            finoVal.classList.add('is-cambio');
          }

          function aplicarPaso(signo) {
            // El total salta al múltiplo de 10 ms siguiente en esa dirección:
            // desde 337, − lleva a 330 y + a 340 (no a 327 / 347).
            var totalMs = Math.round((latAhora() + ajuste) * 1000);
            var nuevoMs = signo > 0
              ? (Math.floor(totalMs / 10) + 1) * 10
              : (Math.ceil(totalMs / 10) - 1) * 10;
            // Acotado, pero SIN guardar: solo cambia el valor en memoria.
            nuevoMs = Math.max(-500, Math.min(2400, nuevoMs));
            ajuste = nuevoMs / 1000 - latAhora();
            pintaFino();
            destelloFino();
            if (enlace && modo === 'mix') {
              // Para juzgar el encaje hay que oírlo: si está parado, arráncalo.
              if (audio.paused) {
                var p = audio.play(); if (p && p.catch) p.catch(function () {});
              } else {
                enlace.realinear();
              }
            }
          }

          // El `click` es el disparador fiable en cualquier WebView. Mantener
          // pulsado añade repetición; si repitió, se ignora el `click` final.
          ref.querySelectorAll('[data-fino]').forEach(function (b) {
            var signo = b.getAttribute('data-fino') === '+' ? 1 : -1;
            var repet = null, arranque = null, repitio = false;
            function parar() {
              if (arranque) { clearTimeout(arranque); arranque = null; }
              if (repet) { clearInterval(repet); repet = null; }
            }
            b.addEventListener('click', function () {
              if (repitio) { repitio = false; return; }
              aplicarPaso(signo);
            });
            b.addEventListener('pointerdown', function () {
              parar();
              repitio = false;
              arranque = setTimeout(function () {
                repitio = true;
                aplicarPaso(signo);
                repet = setInterval(function () { aplicarPaso(signo); }, 80);
              }, 420);
            });
            ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (e) {
              b.addEventListener(e, parar);
            });
          });

          btnGuardar.addEventListener('click', function () {
            var activo = window.Sincronia.perfilActivo();
            var total = latAhora() + ajuste;
            // Fija el retardo del dispositivo seleccionado y borra el retoque:
            // lo que se ve pasa a ser lo guardado.
            window.Sincronia.guardarBase(activo, total);
            ajuste = 0;
            if (window.UI && window.UI.aviso) {
              window.UI.aviso('Guardado: ' + Math.round(total * 1000) + ' ms para ' +
                window.Sincronia.nombrePerfil(activo).toLowerCase() + '.', { tipo: 'ok' });
            }
            pintarLista();   // todas las comparaciones usan ya el nuevo retardo
          });

          // Calibración automática del altavoz: overlay a pantalla completa,
          // se para todo lo demás (canción, grabación, reproducciones).
          btnCal.addEventListener('click', calibrarAltavoz);

          pintaFino();
          aplicarModo();

          enlace = sincronizar(audio, audioRef, offset, trozo,
            ref.querySelector('[data-relleno]'), ref.querySelector('[data-t]'),
            function () { return modo === 'mix'; }, getLat);
        })();

        // Mini-tutorial de la comparación: la 1ª vez que se ve una fila así.
        if (!tourCmpLanzado) {
          tourCmpLanzado = true;
          var vistoCmp = false;
          try { vistoCmp = !!localStorage.getItem(TOUR_CMP_CLAVE); } catch (e) {}
          if (!vistoCmp) {
            (function (filaCmp) {
              setTimeout(function () { tourComparar(filaCmp); }, 800);
            })(fila);
          }
        }
      }
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        window.UI.confirmar('¿Eliminar esta grabación? No se puede deshacer.', {
          ok: 'Eliminar', peligro: true,
        }).then(function (ok) {
          if (!ok) return;
          colapsarYQuitar(fila, 12, function () {
            window.Grabaciones.borrar(g.id).then(pintarLista);
          });
        });
      });
      cont.appendChild(fila);
    });
    lista.appendChild(cont);
  }

  /* Enlaza la pista original a la grabación de voz: cuando Maite da al play
     de su toma, la canción suena a la vez, solo el trozo grabado (de `offset`
     a `offset + trozo`). Pausa, avance y rebobinado se reflejan en las dos.
     `relleno` y `etT` son la barra y el tiempo del mini-visor del trozo. */
  function sincronizar(voz, orig, offset, trozo, relleno, etT, activo, getLat) {
    activo = activo || function () { return true; };
    getLat = getLat || function () { return 0.5; };
    // Dónde debería estar la pista original para una posición dada de la voz,
    // compensando la latencia del micro (nunca antes del inicio del trozo).
    function objetivo() {
      return offset + Math.max(0, Math.min(voz.currentTime, trozo) - getLat());
    }
    function pinta() {
      var d = Math.min(trozo, Math.max(0, voz.currentTime));
      if (relleno) relleno.style.transform = 'scaleX(' + (trozo ? d / trozo : 0).toFixed(4) + ')';
      if (etT) etT.textContent = fmt(trozo - d);
    }
    function alinear() {
      var t = objetivo();
      if (Math.abs(orig.currentTime - t) > 0.28) {
        try { orig.currentTime = t; } catch (e) {}
      }
      pinta();
    }
    etT && (etT.textContent = fmt(trozo));
    if (relleno) relleno.style.transform = 'scaleX(0)';

    voz.addEventListener('play', function () {
      pinta();
      if (!activo()) return;
      alinear();
      var p = orig.play();
      if (p && p.catch) p.catch(function () {});
    });
    voz.addEventListener('pause', function () { orig.pause(); });
    voz.addEventListener('seeking', function () { if (activo()) alinear(); else pinta(); });
    voz.addEventListener('ended', function () { orig.pause(); pinta(); });
    voz.addEventListener('timeupdate', function () {
      if (voz.paused) return;
      pinta();
      if (!activo()) return;
      // Cortar la pista original al final del trozo grabado.
      if (voz.currentTime >= trozo) { orig.pause(); return; }
      var t = objetivo();
      if (Math.abs(orig.currentTime - t) > 0.35) {
        try { orig.currentTime = t; } catch (e) {}
      }
    });

    // Para que el retoque fino se note al instante mientras suena.
    return {
      realinear: function () {
        try { orig.currentTime = objetivo(); } catch (e) {}
      },
    };
  }

  /* ---------- Enviar / descargar una grabación ---------- */

  function extDe(mime) {
    mime = (mime || '').toLowerCase();
    if (mime.indexOf('mp4') > -1 || mime.indexOf('m4a') > -1 || mime.indexOf('aac') > -1) return 'm4a';
    if (mime.indexOf('ogg') > -1) return 'ogg';
    if (mime.indexOf('mpeg') > -1 || mime.indexOf('mp3') > -1) return 'mp3';
    if (mime.indexOf('wav') > -1) return 'wav';
    return 'webm';
  }

  function nombreArchivo(g, ext) {
    var base = String(g.titulo || 'grabacion')
      .replace(/[^\wÀ-ÿ .-]/g, '').trim().replace(/\s+/g, '-') || 'grabacion';
    var d = new Date(g.creado);
    var f = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    return base + '_' + f + '.' + (ext || extDe(g.mime));
  }

  // Devuelve { blob, nombre } listos para enviar/descargar. Convierte la
  // toma a MP3 (formato que Ama espera y que abre en cualquier sitio); si
  // la conversión no está disponible o falla, entrega el archivo original.
  function prepararArchivo(g) {
    return window.Grabaciones.blob(g.id).then(function (blob) {
      if (!blob) throw new Error('sin audio');
      var yaMp3 = /mpeg|mp3/i.test(blob.type || g.mime || '');
      if (yaMp3 || !window.AudioMP3 || !window.AudioMP3.disponible()) {
        return { blob: blob, nombre: nombreArchivo(g) };
      }
      return window.AudioMP3.aMp3(blob)
        .then(function (mp3) { return { blob: mp3, nombre: nombreArchivo(g, 'mp3') }; })
        .catch(function () { return { blob: blob, nombre: nombreArchivo(g) }; });
    });
  }

  // Bloque de botones Enviar / Descargar, ya cableados. Se coloca donde
  // haga falta: dentro del desplegable "Ajustar" (tomas sincronizadas) o
  // en su propio desplegable (el resto).
  function crearAcciones(g) {
    var box = document.createElement('div');
    box.className = 'grabacion__acciones';
    box.innerHTML =
      '<button type="button" class="grabacion__accion" data-enviar>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="m7 8 5-5 5 5"/></svg>' +
        '<span>Enviar</span>' +
      '</button>' +
      '<button type="button" class="grabacion__accion" data-descargar>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v13"/><path d="m7 11 5 5 5-5"/></svg>' +
        '<span>Descargar</span>' +
      '</button>';

    var btnEnviar = box.querySelector('[data-enviar]');
    var btnDescargar = box.querySelector('[data-descargar]');

    btnEnviar.addEventListener('click', function () {
      btnEnviar.disabled = true;
      prepararArchivo(g).then(function (a) {
        return window.Compartir.enviar({
          blob: a.blob,
          nombre: a.nombre,
          texto: g.titulo && g.titulo.indexOf('Sin canción') === -1
            ? 'Mi grabación de «' + g.titulo + '»' : 'Mi grabación',
        });
      }).then(function (r) {
        if (r && r.via === 'descarga' && window.UI) {
          window.UI.aviso('Tu móvil no deja compartir directamente: se ha descargado.', { tipo: 'info' });
        }
      }).catch(function (e) {
        // El usuario canceló el menú de compartir: sin ruido.
        if (e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''))) return;
        if (window.UI) window.UI.aviso('No se pudo enviar la grabación.', { tipo: 'error' });
      }).then(function () { btnEnviar.disabled = false; });
    });

    btnDescargar.addEventListener('click', function () {
      btnDescargar.disabled = true;
      prepararArchivo(g).then(function (a) {
        return window.Compartir.descargar({ blob: a.blob, nombre: a.nombre });
      }).then(function (r) {
        if (window.UI) {
          window.UI.aviso(r && r.via === 'documentos'
            ? 'Guardada en Documentos.' : 'Grabación descargada.', { tipo: 'ok' });
        }
      }).catch(function () {
        if (window.UI) window.UI.aviso('No se pudo descargar la grabación.', { tipo: 'error' });
      }).then(function () { btnDescargar.disabled = false; });
    });

    return box;
  }

  // Desplegable propio "Enviar o descargar" para las tomas que NO tienen
  // el bloque de comparación con la canción (donde ya va integrado).
  function montarAcciones(fila, g) {
    var det = document.createElement('details');
    det.className = 'grabacion__mas';
    det.innerHTML =
      '<summary class="grabacion__mas-cab">' +
        '<span>Enviar o descargar</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
      '</summary>';
    det.appendChild(crearAcciones(g));
    fila.appendChild(det);
  }

  /* ------------------------------------------------------------
     Mini-tutoriales de Grabaciones (cada uno una sola vez):
       · Tour 1: al llegar a la sección — lo básico.
       · Tour 2: la 1ª grabación sobre una sesión del coro — la
         comparación (voz encima / canción debajo) y los milisegundos.
     Mismo patrón que el de Modo estudio y con las mismas defensas
     contra el desajuste del foco que arreglamos allí:
       · scroll SIN animación (behavior:'auto') para que la posición
         final del elemento sea inmediata y el foco no se pinte a
         medio camino;
       · doble requestAnimationFrame antes de medir (un frame aplica
         el scroll, el otro mide ya asentado);
       · si la maqueta se mueve con el tour abierto (el selector de
         escucha o el panel de calibración que se montan/ocultan,
         girar el móvil, un scroll de rebote…) se recoloca el foco
         sobre el paso actual (resize + scroll en captura).
     ---------------------------------------------------------- */
  var TOUR_CLAVE = 'chorapp:grabaciones:tour-visto';
  var TOUR_CMP_CLAVE = 'chorapp:grabaciones:tour-comparar-visto';

  // Tour 1: la 1ª vez que se llega a Grabaciones. Presenta lo básico.
  var PASOS_TOUR = [
    { sel: '.grabador__para', titulo: 'Para qué canción',
      texto: 'Elige aquí la canción antes de grabar. La toma se guarda con ella para que luego la encuentres agrupada.' },
    { sel: '[data-rec]', titulo: 'Grábate cantando',
      texto: 'Pulsa para empezar y otra vez para parar. Si tienes una sesión del coro sonando, la toma se sincroniza sola con esa pista.' },
    { sel: '[data-escucha]', titulo: 'Cómo estás escuchando',
      texto: 'Dile si oyes por el altavoz o por auriculares. Así tus grabaciones encajan bien con la canción al compararlas.' },
  ];

  // Tour 2: la 1ª vez que aparece una grabación hecha SOBRE una sesión del
  // coro (la que trae el bloque de comparación). Explica escuchar tu voz por
  // encima con la canción sonando por debajo, y cómo cuadrar los milisegundos
  // si no van juntas. Los selectores se buscan DENTRO de esa fila.
  var PASOS_TOUR_CMP = [
    { sel: '.ref-modo', titulo: 'Tu voz, con la canción debajo',
      texto: 'Escúchate sola, o con la canción del ensayo sonando por debajo a la vez que tu voz por encima. Así oyes si vas afinada y a tiempo.' },
    { sel: '[data-volbox]', titulo: 'Volumen de la canción',
      texto: 'Baja la canción de fondo si te tapa. Solo cambia lo que oyes ahora, no toca tu grabación.' },
    { sel: '.ref-ajuste__cab', titulo: 'Cuadrar los milisegundos',
      texto: 'Si tu voz y la canción no van juntas, abre aquí y muévelo con − y + hasta que encajen. Puedes guardarlo para las próximas grabaciones.' },
  ];

  function tourGrabaciones() {
    lanzarTour(TOUR_CLAVE, PASOS_TOUR, function () { return raiz; });
  }

  // Se llama desde pintarLista cuando se pinta la 1ª fila con comparación.
  function tourComparar(fila) {
    if (!fila) return;
    lanzarTour(TOUR_CMP_CLAVE, PASOS_TOUR_CMP, function () {
      return document.body.contains(fila) ? fila : null;
    });
  }

  // `ambito()` devuelve el elemento dentro del cual se buscan los pasos
  // (la página entera o una fila concreta), o null si ya no está en el DOM.
  function lanzarTour(clave, PASOS, ambito) {
    var base = ambito();
    if (!base || !document.body.contains(base) || tourCapa) return;

    var pasos = PASOS.filter(function (p) {
      var el = base.querySelector(p.sel);
      return el && !el.hidden && el.offsetParent !== null;
    });
    if (pasos.length < 2) return;   // si apenas hay nada que enseñar, no molestamos
    tourClaveActiva = clave;

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
    function colocar(el) {
      if (!tourCapa || !el) return;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;   // aún sin maquetar: se reintenta al reubicar
      var pad = 8;
      foco.style.left = (r.left - pad) + 'px';
      foco.style.top = (r.top - pad) + 'px';
      foco.style.width = (r.width + pad * 2) + 'px';
      foco.style.height = (r.height + pad * 2) + 'px';

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
      var b = ambito();
      var el = b && b.querySelector(p.sel);
      if (!el) { cerrarTour(true); return; }
      elActual = el;

      tourCapa.querySelector('[data-paso-n]').textContent = (i + 1) + ' / ' + pasos.length;
      tourCapa.querySelector('[data-t]').textContent = p.titulo;
      tourCapa.querySelector('[data-x]').textContent = p.texto;
      tourCapa.querySelector('[data-sig]').textContent =
        (i === pasos.length - 1) ? 'Entendido' : 'Siguiente';

      // Scroll SIN animación: la posición final es inmediata y el foco nunca
      // se dibuja a medio camino (era el origen del desajuste en Modo estudio).
      try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (e) {}
      // Se coloca ya (por si los rAF llegan tarde en un WebView que no está
      // pintando) y se reajusta en los dos frames siguientes, cuando el
      // scroll ya se ha asentado. Un último intento por setTimeout como red.
      colocar(el);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (tourCapa && elActual === el) colocar(el);
        });
      });
      setTimeout(function () { if (tourCapa && elActual === el) colocar(el); }, 80);
    }

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

  function tourEsc(e) { if (e.key === 'Escape') cerrarTour(true); }

  function cerrarTour(marcarVisto) {
    if (marcarVisto && tourClaveActiva) {
      try { localStorage.setItem(tourClaveActiva, '1'); } catch (e) {}
    }
    tourClaveActiva = null;
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

  /* ---------- Utilidades ---------- */

  // Anima la salida de una fila (colapso de altura + fade) y luego llama a
  // `hecho`. `gap` = separación del contenedor (flex gap) que hay que comerse.
  function colapsarYQuitar(el, gap, hecho) {
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce) { hecho(); return; }
    el.style.maxHeight = el.scrollHeight + 'px';
    if (gap) el.style.setProperty('--colapsa-gap', gap + 'px');
    void el.offsetHeight;                 // fuerza reflow
    el.classList.add('item-colapsa');
    el.style.maxHeight = '0px';           // dispara la transición
    var listo = false;
    function fin() {
      if (listo) return;
      listo = true;
      hecho();
    }
    el.addEventListener('transitionend', function (ev) {
      if (ev.propertyName === 'max-height' || ev.propertyName === 'opacity') fin();
    });
    setTimeout(fin, 340);                 // red de seguridad
  }

  // Sesión del coro con la que comparar esta grabación, o null.
  //   1. `g.sesionId` — lo guardan las tomas nuevas (estudio y este apartado).
  //   2. `g.cancionId` con forma "sesion:<sesionId>:<marcaId>" — tomas del
  //      modo estudio cuya marca aún no estaba vinculada a una canción.
  function sesionIdDe(g) {
    if (g.sesionId) return g.sesionId;
    var m = /^sesion:([^:]+):/.exec(g.cancionId || '');
    return m ? m[1] : null;
  }

  function fmt(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var m = Math.floor(seg / 60), s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtFecha(ts) {
    try {
      var d = new Date(ts);
      var fecha = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
      var hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      return fecha + ' · ' + hora;
    } catch (e) { return ''; }
  }
  // 'YYYY-MM-DD' -> "8 de septiembre de 2026" (fecha del ensayo).
  function fmtFechaEnsayo(iso) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!p) return iso || '';
    try {
      var d = new Date(+p[1], +p[2] - 1, +p[3]);
      return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return iso; }
  }
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return {
    iniciar: iniciar,
    // Ayuda de pruebas: vuelve a lanzar el mini-tutorial.
    tour: function () {
      try { localStorage.removeItem(TOUR_CLAVE); } catch (e) {}
      tourGrabaciones();
    },
    // Relanza el mini-tutorial de la comparación (voz encima / canción debajo
    // + milisegundos). Necesita que haya una grabación sobre una sesión.
    tourComparar: function () {
      try { localStorage.removeItem(TOUR_CMP_CLAVE); } catch (e) {}
      var fila = raiz && raiz.querySelector('.grabacion__ref');
      tourComparar(fila ? fila.closest('.grabacion') : null);
    },
  };
})();
