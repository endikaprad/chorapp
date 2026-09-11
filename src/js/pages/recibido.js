/* ============================================================
   Pagina_recibido — lo que Maite comparte desde WhatsApp/Galería
   con "Compartir con ChorApp" (ver src/js/compartido.js).

   datos = { nombre, mime, ruta, tipo: 'audio'|'imagen'|'pdf'|'otro' }

   Audio  -> canción nueva (con ese audio) o ensayo de una existente.
   PDF/imagen -> elegir canción existente + tipo (partitura/letra/fonética).
   Una canción nueva SIEMPRE necesita audio (modelo "canción suelta"), así
   que un PDF/imagen no puede crear una canción por sí solo.
   ============================================================ */

window.Pagina_recibido = (function () {
  'use strict';

  var cont, datos, archivoProm;
  var cancionElegidaId = null;

  function iniciar(contenedor, d) {
    cont = contenedor;
    datos = d || null;

    if (!datos || !datos.ruta) {
      cont.querySelector('[data-modulo="recibido"]').innerHTML =
        '<p class="vacio">No se ha recibido ningún archivo.</p>';
      return;
    }

    archivoProm = window.Compartido.comoArchivo(datos).catch(function (e) {
      window.UI.aviso('No se ha podido leer el archivo recibido.', { tipo: 'error' });
      throw e;
    });

    pintarOrigen();

    if (datos.tipo === 'audio') {
      mostrarPaso('paso-audio-tipo');
      q('[data-opt-nueva]').addEventListener('click', irAPasoTitulo);
      q('[data-opt-existente]').addEventListener('click', function () {
        prepararSelectorCancion('¿A qué canción pertenece este audio?', function (c) {
          crearEnsayoEnExistente(c);
        });
      });
      q('[data-paso-titulo]').addEventListener('submit', function (ev) {
        ev.preventDefault();
        crearCancionNueva(ev.target.titulo.value.trim());
      });
    } else if (datos.tipo === 'imagen' || datos.tipo === 'pdf') {
      prepararSelectorCancion('¿A qué canción pertenece?', function (c) {
        cancionElegidaId = c.id;
        q('[data-cancion-elegida]').textContent = c.titulo;
        mostrarPaso('paso-tipo-adjunto');
      });
      q('[data-btn-guardar-adjunto]').addEventListener('click', guardarAdjunto);
    } else {
      cont.querySelector('[data-modulo="recibido"]').insertAdjacentHTML('beforeend',
        '<p class="vacio">Este tipo de archivo no se puede añadir a ChorApp todavía.</p>');
    }
  }

  function pintarOrigen() {
    var iconos = {
      audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      imagen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
      pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/></svg>',
      otro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/></svg>',
    };
    q('[data-ic]').innerHTML = iconos[datos.tipo] || iconos.otro;
    q('[data-nombre]').textContent = datos.nombre;
    q('[data-sub]').textContent = {
      audio: 'Audio recibido', imagen: 'Imagen recibida', pdf: 'PDF recibido', otro: 'Archivo recibido',
    }[datos.tipo] || 'Recibido';
  }

  function mostrarPaso(cual) {
    ['paso-audio-tipo', 'paso-titulo', 'paso-cancion', 'paso-tipo-adjunto'].forEach(function (p) {
      var el = q('[data-' + p + ']');
      if (el) el.hidden = (p !== cual);
    });
  }

  function irAPasoTitulo() {
    mostrarPaso('paso-titulo');
    var input = q('[data-paso-titulo] input[name="titulo"]');
    input.value = (datos.nombre || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
    setTimeout(function () { input.focus(); input.select(); }, 50);
  }

  function prepararSelectorCancion(etiqueta, alElegir) {
    var canciones = window.Canciones.listar();
    if (!canciones.length) {
      mostrarPaso('__ninguno');
      q('[data-sin-canciones]').hidden = false;
      return;
    }
    q('[data-lbl-buscar]').textContent = etiqueta;
    mostrarPaso('paso-cancion');
    var input = q('[data-sel-input]');
    function pintar() {
      var texto = input.value.trim();
      var res = texto ? window.Canciones.buscar(texto) : canciones;
      var caja = q('[data-sel-lista]');
      caja.innerHTML = '';
      if (!res.length) {
        caja.innerHTML = '<p class="selcancion__vacio">No hay ninguna canción con ese nombre.</p>';
        return;
      }
      res.slice(0, 12).forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'selcancion__op';
        b.innerHTML = '<span class="selcancion__op-tit">' + escapar(c.titulo) + '</span>' +
          (c.compositor ? '<span class="selcancion__op-sub">' + escapar(c.compositor) + '</span>' : '');
        b.addEventListener('click', function () { alElegir(c); });
        caja.appendChild(b);
      });
    }
    input.addEventListener('input', pintar);
    pintar();
  }

  function crearCancionNueva(titulo) {
    if (!titulo) {
      var input = q('[data-paso-titulo] input[name="titulo"]');
      input.classList.add('campo--error');
      input.focus();
      return;
    }
    var btn = q('[data-btn-crear]');
    btn.disabled = true;
    archivoProm.then(function (file) {
      return window.Sesiones.crearSuelta({ titulo: titulo }, file, {});
    }).then(function (res) {
      window.UI.aviso('«' + titulo + '» añadida al repertorio.', { tipo: 'ok' });
      window.App.ir('estudio', { datos: { sesionId: res.sesion.id, marcaId: res.marca.id }, reemplazar: true });
    }).catch(function (e) {
      console.error(e);
      window.UI.aviso('No se ha podido crear la canción.', { tipo: 'error' });
      btn.disabled = false;
    });
  }

  function crearEnsayoEnExistente(cancion) {
    archivoProm.then(function (file) {
      var sesion = window.Sesiones.crear({});
      return window.Archivos.guardar(sesion.id + ':audio', file).then(function (meta) {
        window.Sesiones.fijarAudio(sesion.id, meta);
        window.Sesiones.agregarMarca(sesion.id, { cancionId: cancion.id, titulo: cancion.titulo, segundo: 0 });
        return sesion;
      });
    }).then(function (sesion) {
      window.UI.aviso('Añadido como ensayo de «' + cancion.titulo + '».', { tipo: 'ok' });
      window.App.ir('sesion', { datos: { id: sesion.id }, reemplazar: true });
    }).catch(function (e) {
      console.error(e);
      window.UI.aviso('No se ha podido guardar el audio.', { tipo: 'error' });
    });
  }

  function guardarAdjunto() {
    if (!cancionElegidaId) return;
    var tipo = (cont.querySelector('input[name="tipoAdjunto"]:checked') || {}).value || 'partitura';
    var btn = q('[data-btn-guardar-adjunto]');
    btn.disabled = true;
    var cancion = window.Canciones.obtener(cancionElegidaId);
    archivoProm.then(function (file) {
      return window.Adjuntos.aplicar(
        cancionElegidaId, tipo, { anadir: [file], quitar: [] },
        window.Adjuntos.lista(cancion, tipo));
    }).then(function () {
      window.UI.aviso('Añadido a «' + cancion.titulo + '».', { tipo: 'ok' });
      window.App.ir('cancion', { datos: { id: cancionElegidaId }, reemplazar: true });
    }).catch(function (e) {
      console.error(e);
      window.UI.aviso('No se ha podido guardar el archivo.', { tipo: 'error' });
      btn.disabled = false;
    });
  }

  function q(sel) { return cont.querySelector(sel); }
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
