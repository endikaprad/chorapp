/* ============================================================
   Pagina_recordings — Grabadora personal (Fase 7)
   Grabar cantando, guardar por canción y fecha, escuchar y borrar.
   ============================================================ */

window.Pagina_recordings = (function () {
  'use strict';

  var raiz, selCancion, btnRec, btnRecTxt, aviso, lista, vacio;
  var grabadora = null, crono = null, urls = [];
  var obs = null, vacioP = null, vacioTxt = '';

  // La voz grabada llega con un pequeño retardo (latencia del micro), así que
  // al comparar la pista original suena "por delante". La atrasamos otro tanto
  // para que encajen. Ajustable si hiciera falta afinar.
  var LATENCIA_MIC = 0.5; // segundos

  function iniciar(contenedor) {
    limpiar();

    raiz = contenedor.querySelector('[data-modulo="recordings"]');
    selCancion = raiz.querySelector('[data-cancion]');
    btnRec = raiz.querySelector('[data-rec]');
    btnRecTxt = raiz.querySelector('[data-rec-txt]');
    aviso = raiz.querySelector('[data-aviso]');
    lista = raiz.querySelector('[data-lista]');
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

    btnRec.addEventListener('click', alternar);
    document.addEventListener('chorapp:bloqueo', pararPorBloqueo);
    selCancion.addEventListener('change', pintarLista);
    pintarLista();

    var vista = document.getElementById('vista');
    obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) destruir();
    });
    obs.observe(vista, { childList: true, subtree: true });
  }

  function destruir() {
    if (obs) { obs.disconnect(); obs = null; }
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
    grabadora = window.Grabadora.crear();
    grabadora.iniciar().then(function () {
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

      var id = selCancion.value;
      var c = id && window.Canciones ? window.Canciones.obtener(id) : null;
      return window.Grabaciones.crear({
        cancionId: c ? c.id : null,
        titulo: c ? c.titulo : 'Sin canción concreta',
        mime: blob.type,
        dur: Math.round(dur),
        picos: g.picos(),
      }, blob).then(pintarLista);
    });
  }

  /* ---------- Lista ---------- */

  function pintarLista() {
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];

    var filtroId = selCancion && selCancion.value ? selCancion.value : null;
    var grabs = window.Grabaciones
      ? (filtroId ? window.Grabaciones.listarDeCancion(filtroId) : window.Grabaciones.listar())
      : [];
    vacio.hidden = grabs.length > 0;
    if (vacioP && filtroId) {
      vacioP.textContent = 'Todavía no hay grabaciones de esta canción. Pulsa Empezar a grabar y canta.';
    } else if (vacioP) {
      vacioP.innerHTML = vacioTxt;
    }
    lista.innerHTML = '';
    if (!grabs.length) return;

    var cont = document.createElement('div');
    cont.className = 'lista';
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
      var audio = fila.querySelector('audio');
      window.MiniPlayer.montar(fila.querySelector('[data-mp]'), g.dur || 0, g.picos);
      window.Grabaciones.url(g.id).then(function (u) {
        if (u) { urls.push(u); audio.src = u; }
      });

      // Comparación: debajo de tu grabación, la pista original de la canción.
      var cancion = g.cancionId && window.Canciones ? window.Canciones.obtener(g.cancionId) : null;
      if (cancion && cancion.archivos && cancion.archivos.audio) {
        var sincro = typeof g.audioOffset === 'number' && isFinite(g.audioOffset);

        if (sincro) {
          // La toma se grabó con la canción de fondo: la pista original suena
          // a la vez y SOLO el trozo que Maite grabó (de audioOffset a
          // audioOffset + duración de la toma). La gobierna su reproductor.
          var offset = Math.max(0, g.audioOffset);
          var trozo = Math.max(1, g.dur || 0);
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
            '<audio preload="metadata" data-orig></audio>';
          var audioRef = ref.querySelector('[data-orig]');
          fila.appendChild(ref);
          window.Archivos.url(cancion.id + ':audio').then(function (u) {
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
            if (!mix) audioRef.pause();
          }
          ref.querySelectorAll('[data-modo]').forEach(function (b) {
            b.addEventListener('click', function () {
              modo = b.getAttribute('data-modo');
              aplicarModo();
              if (modo === 'mix' && !audio.paused) {
                audioRef.currentTime = offset + Math.max(0, audio.currentTime - LATENCIA_MIC);
                var p = audioRef.play(); if (p && p.catch) p.catch(function () {});
              }
            });
          });
          inVol.addEventListener('input', function () {
            audioRef.volume = parseFloat(inVol.value);
          });
          aplicarModo();

          sincronizar(audio, audioRef, offset, trozo,
            ref.querySelector('[data-relleno]'), ref.querySelector('[data-t]'),
            function () { return modo === 'mix'; });
        } else {
          // La toma se grabó sin canción de fondo: pista original completa,
          // como reproductor aparte para comparar.
          var refC = document.createElement('div');
          refC.className = 'grabacion__ref';
          refC.innerHTML =
            '<span class="grabacion__ref-etiqueta">Pista original</span>' +
            '<div class="grabacion__fila">' + window.MiniPlayer.plantilla() + '</div>';
          var audioC = refC.querySelector('audio');
          window.MiniPlayer.montar(refC.querySelector('[data-mp]'), 0);
          window.Archivos.url(cancion.id + ':audio').then(function (u) {
            if (u) { urls.push(u); audioC.src = u; }
          });
          fila.appendChild(refC);
        }
      }
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        window.UI.confirmar('¿Eliminar esta grabación? No se puede deshacer.', {
          ok: 'Eliminar', peligro: true,
        }).then(function (ok) {
          if (ok) window.Grabaciones.borrar(g.id).then(pintarLista);
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
  function sincronizar(voz, orig, offset, trozo, relleno, etT, activo) {
    activo = activo || function () { return true; };
    // Dónde debería estar la pista original para una posición dada de la voz,
    // compensando la latencia del micro (nunca antes del inicio del trozo).
    function objetivo() {
      return offset + Math.max(0, Math.min(voz.currentTime, trozo) - LATENCIA_MIC);
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
  }

  /* ---------- Utilidades ---------- */

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
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
