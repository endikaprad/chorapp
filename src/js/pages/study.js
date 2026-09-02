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
  var urls = [];              // object URLs a revocar al salir
  var cronoNota = null;       // intervalo del contador de grabación
  var notaT0 = 0;             // inicio de la grabación de nota (ms)
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

    // Limpieza al abandonar la pantalla.
    var vista = document.getElementById('vista');
    obs = new MutationObserver(function () {
      if (!document.body.contains(cont)) destruir();
    });
    obs.observe(vista, { childList: true, subtree: true });
  }

  function destruir() {
    if (obs) { obs.disconnect(); obs = null; }
    if (reproductor) { reproductor.destruir(); reproductor = null; }
    if (grabadora) { grabadora.cancelar(); grabadora = null; }
    if (cronoNota) { clearInterval(cronoNota); cronoNota = null; }
    tiempoActual = 0; duracionAudio = 0;
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];
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

    var audio = q('[data-audio]');
    var barra = q('[data-barra]');
    var tAct = q('[data-t-actual]');
    var tTot = q('[data-t-total]');
    var btnPlay = q('[data-play]');
    var icPlay = btnPlay.querySelector('.ic-play');
    var icPause = btnPlay.querySelector('.ic-pause');
    var velBarra = q('[data-vel-barra]');
    var velValor = q('[data-vel-valor]');

    window.Archivos.url(cancion.id + ':audio').then(function (u) {
      if (!u) { seccion.hidden = true; return; }
      urls.push(u);
      audio.src = u;
      seccion.hidden = false;
    });

    reproductor = window.Reproductor.crear(audio, {
      onEstado: function (s) {
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
      },
    });

    btnPlay.addEventListener('click', function () { reproductor.alternar(); });
    q('[data-retro]').addEventListener('click', function () { reproductor.retroceder(5); });
    q('[data-adelante]').addEventListener('click', function () { reproductor.adelantar(5); });
    velBarra.addEventListener('input', function () {
      var v = reproductor.fijarVelocidad(parseFloat(velBarra.value));
      velValor.textContent = fmtVel(v);
    });
    barra.addEventListener('input', function () {
      if (audio.duration) reproductor.irA((barra.value / 1000) * audio.duration);
    });
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
        var u = URL.createObjectURL(blob); urls.push(u);
        doc.innerHTML = '<object data="' + u + '" type="application/pdf"></object>' +
          '<a class="visor-doc__abrir" href="' + u + '" target="_blank" rel="noopener">Abrir la letra</a>';
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
    window.Archivos.url(cancion.id + ':partitura').then(function (u) {
      if (!u) { vacio.hidden = false; return; }
      urls.push(u);
      if (esPdf) {
        doc.innerHTML = '<object data="' + u + '" type="application/pdf"></object>' +
          '<a class="visor-doc__abrir" href="' + u + '" target="_blank" rel="noopener">Abrir la partitura</a>';
        doc.hidden = false;
      } else {
        img.src = u;
        cajaImg.hidden = false;
        cajaImg.onclick = function () { abrirLightbox(u); };
      }
    });
  }

  /* ---------- Fragmentos difíciles ---------- */

  function marcarFragmento() {
    var texto = window.prompt('Describe el fragmento difícil (compás, frase, qué cuesta…):', '');
    if (texto == null) return;
    texto = texto.trim();
    if (!texto) return;
    // Si hay audio cargado, guardamos también el momento en el que está sonando.
    var seg = (reproductor && duracionAudio) ? tiempoActual : null;
    window.Canciones.agregarFragmento(cancion.id, texto, seg);
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
      m.title = fmtTiempo(f.segundo) + ' · ' + f.texto;
      caja.appendChild(m);
    });
  }

  function pintarFragmentos() {
    var caja = q('[data-fragmentos]');
    var frags = cancion.fragmentos || [];
    if (!frags.length) {
      caja.innerHTML = '<p class="visor-vacio">Marca las partes que se te resisten para tenerlas a mano.</p>';
      return;
    }
    caja.innerHTML = '';
    frags.slice().reverse().forEach(function (f) {
      var fila = document.createElement('div');
      fila.className = 'ficha';
      var tieneTiempo = typeof f.segundo === 'number' && isFinite(f.segundo);
      fila.innerHTML =
        (tieneTiempo
          ? '<button type="button" class="ficha__tiempo" aria-label="Ir a este momento del audio">' +
              fmtTiempo(f.segundo) + '</button>'
          : '') +
        '<p class="ficha__texto">' + escapar(f.texto) + '</p>' +
        '<button type="button" class="ficha__quitar" aria-label="Quitar fragmento">✕</button>';
      if (tieneTiempo) {
        fila.querySelector('.ficha__tiempo').addEventListener('click', function () {
          if (reproductor) reproductor.irA(f.segundo);
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

  function alternarGrabacion() {
    var btn = q('[data-grabar-nota]');
    var txt = q('[data-grabar-nota-txt]');

    if (grabadora && grabadora.grabando) {
      var g = grabadora; grabadora = null;
      if (cronoNota) { clearInterval(cronoNota); cronoNota = null; }
      btn.disabled = true;
      var dur = Math.round((Date.now() - notaT0) / 1000);
      g.parar().then(function (blob) {
        btn.disabled = false;
        btn.classList.remove('is-grabando');
        txt.textContent = 'Grabar';
        if (!blob || !blob.size) return;
        return window.Grabaciones.crear({
          cancionId: cancion.id,
          titulo: cancion.titulo,
          mime: blob.type,
          dur: dur,
        }, blob).then(pintarGrabaciones);
      });
      return;
    }

    if (!window.Grabadora.soportado()) {
      window.alert('Este dispositivo no permite grabar audio desde la app.');
      return;
    }
    grabadora = window.Grabadora.crear();
    grabadora.iniciar().then(function () {
      btn.classList.add('is-grabando');
      notaT0 = Date.now();
      txt.textContent = 'Detener (0:00)';
      cronoNota = setInterval(function () {
        txt.textContent = 'Detener (' + fmtTiempo((Date.now() - notaT0) / 1000) + ')';
      }, 500);
    }).catch(function () {
      grabadora = null;
      window.alert('No se pudo acceder al micrófono.');
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
      window.MiniPlayer.montar(fila.querySelector('[data-mp]'), g.dur || 0);
      window.Grabaciones.url(g.id).then(function (u) {
        if (u) { urls.push(u); audio.src = u; }
      });
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        if (!window.confirm('¿Eliminar esta grabación? No se puede deshacer.')) return;
        window.Grabaciones.borrar(g.id).then(pintarGrabaciones);
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
