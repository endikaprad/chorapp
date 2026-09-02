/* ============================================================
   Pagina_study — Modo estudio de una canción (Fase 5)

   - Reproductor de audio (player.js)
   - Visor de letra (texto o PDF) y de partitura (imagen o PDF)
   - Marcar fragmentos difíciles con nota
   - Nota de voz rápida (recorder.js)
   - Al entrar se registra la sesión de práctica (practica.js)

   app.js llama iniciar(contenedor, { id }).
   ============================================================ */

window.Pagina_study = (function () {
  'use strict';

  var cont, cancion, reproductor, grabadora, obs;
  var urls = [];              // object URLs a revocar al salir
  var cronoNota = null;       // intervalo del contador de grabación

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
    pintarNotasVoz();
    montarLightbox();

    cont.querySelector('[data-editar]').addEventListener('click', function () {
      window.Pagina_songs.editar(cancion.id);
    });
    cont.querySelector('[data-marcar]').addEventListener('click', marcarFragmento);
    cont.querySelector('[data-grabar-nota]').addEventListener('click', alternarGrabacionNota);

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
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];
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
    var btnVel = q('[data-vel]');

    window.Archivos.url(cancion.id + ':audio').then(function (u) {
      if (!u) { seccion.hidden = true; return; }
      urls.push(u);
      audio.src = u;
      seccion.hidden = false;
    });

    reproductor = window.Reproductor.crear(audio, {
      onEstado: function (s) {
        icPlay.hidden = s.reproduciendo;
        icPause.hidden = !s.reproduciendo;
        btnPlay.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
        btnPlay.classList.toggle('is-sonando', s.reproduciendo);
        tAct.textContent = fmtTiempo(s.actual);
        tTot.textContent = fmtTiempo(s.total);
        if (s.total && !barra.matches(':active')) {
          barra.value = String(Math.round((s.actual / s.total) * 1000));
        }
        btnVel.textContent = (s.velocidad % 1 === 0 ? s.velocidad : s.velocidad) + '×';
      },
    });

    btnPlay.addEventListener('click', function () { reproductor.alternar(); });
    q('[data-retro]').addEventListener('click', function () { reproductor.retroceder(5); });
    btnVel.addEventListener('click', function () { reproductor.ciclarVelocidad(); });
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
    window.Archivos.obtener(cancion.id + ':letra').then(function (blob) {
      if (!blob) { vacio.hidden = false; return; }
      if (esPdf) {
        var u = URL.createObjectURL(blob); urls.push(u);
        doc.innerHTML = '<object data="' + u + '" type="application/pdf"></object>' +
          '<a class="visor-doc__abrir" href="' + u + '" target="_blank" rel="noopener">Abrir la letra</a>';
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
    window.Canciones.agregarFragmento(cancion.id, texto);
    refrescar();
    pintarFragmentos();
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
      fila.innerHTML =
        '<p class="ficha__texto">' + escapar(f.texto) + '</p>' +
        '<button type="button" class="ficha__quitar" aria-label="Quitar fragmento">✕</button>';
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        window.Canciones.borrarFragmento(cancion.id, f.id);
        refrescar();
        pintarFragmentos();
      });
      caja.appendChild(fila);
    });
  }

  /* ---------- Notas de voz ---------- */

  function alternarGrabacionNota() {
    var btn = q('[data-grabar-nota]');
    var txt = q('[data-grabar-nota-txt]');

    if (grabadora && grabadora.grabando) {
      var g = grabadora; grabadora = null;
      if (cronoNota) { clearInterval(cronoNota); cronoNota = null; }
      btn.disabled = true;
      g.parar().then(function (blob) {
        btn.disabled = false;
        btn.classList.remove('is-grabando');
        txt.textContent = 'Grabar nota de voz';
        if (!blob || !blob.size) return;
        var nota = window.Canciones.agregarNotaVoz(cancion.id);
        return window.Archivos.guardar(cancion.id + ':voz:' + nota.id, blob).then(function () {
          refrescar();
          pintarNotasVoz();
        });
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
      var t0 = Date.now();
      txt.textContent = 'Detener (0:00)';
      cronoNota = setInterval(function () {
        txt.textContent = 'Detener (' + fmtTiempo((Date.now() - t0) / 1000) + ')';
      }, 500);
    }).catch(function () {
      grabadora = null;
      window.alert('No se pudo acceder al micrófono.');
    });
  }

  function pintarNotasVoz() {
    var caja = q('[data-notas-voz]');
    var notas = cancion.notasVoz || [];
    if (!notas.length) {
      caja.innerHTML = '<p class="visor-vacio">Graba un recordatorio rápido mientras estudias.</p>';
      return;
    }
    caja.innerHTML = '';
    notas.slice().reverse().forEach(function (n) {
      var fila = document.createElement('div');
      fila.className = 'nota-voz';
      fila.innerHTML =
        '<span class="nota-voz__fecha">' + fmtFecha(n.creado) + '</span>' +
        '<audio controls preload="none"></audio>' +
        '<button type="button" class="ficha__quitar" aria-label="Eliminar nota">✕</button>';
      var audio = fila.querySelector('audio');
      window.Archivos.url(cancion.id + ':voz:' + n.id).then(function (u) {
        if (u) { urls.push(u); audio.src = u; }
      });
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        if (!window.confirm('¿Eliminar esta nota de voz?')) return;
        window.Archivos.borrar(cancion.id + ':voz:' + n.id);
        window.Canciones.borrarNotaVoz(cancion.id, n.id);
        refrescar();
        pintarNotasVoz();
      });
      caja.appendChild(fila);
    });
  }

  /* ---------- Lightbox ---------- */

  function montarLightbox() {
    q('[data-lightbox-cerrar]').addEventListener('click', cerrarLightbox);
    q('[data-lightbox]').addEventListener('click', function (e) {
      if (e.target === q('[data-lightbox]')) cerrarLightbox();
    });
  }
  function abrirLightbox(u) {
    q('[data-lightbox-src]').src = u;
    q('[data-lightbox]').hidden = false;
  }
  function cerrarLightbox() {
    q('[data-lightbox]').hidden = true;
    q('[data-lightbox-src]').removeAttribute('src');
  }

  /* ---------- Utilidades ---------- */

  function q(sel) { return cont.querySelector(sel); }

  function fmtTiempo(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var m = Math.floor(seg / 60);
    var s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
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
