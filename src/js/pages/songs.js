/* ============================================================
   Pagina_songs — Biblioteca de canciones (Fases 3 y 4)
   Lista + búsqueda + alta / edición / borrado.
   La hoja de edición incluye letra (texto) e importación de
   archivos (audio, letra, partitura) a través de window.Archivos.
   Al tocar una canción se abre el Modo estudio (Fase 5).
   ============================================================ */

window.Pagina_songs = (function () {
  'use strict';

  var TIPOS_ARCHIVO = ['audio', 'letra', 'partitura'];

  var raiz, contenido, buscador, inputBuscar, hoja, form, formTitulo, btnBorrar;
  var idEditando = null;   // null => alta; id => edición
  var filtro = '';
  var primeraCarga = true;
  var pendienteEditar = null;   // id a editar tras navegar desde otra pantalla

  // Cambios de archivo pendientes de guardar: { audio: File|null|'quitar', ... }
  var archivosPendientes = {};

  function iniciar(contenedor) {
    limpiarRestos();

    raiz = contenedor.querySelector('[data-modulo="songs"]');
    contenido = raiz.querySelector('[data-contenido]');
    buscador = raiz.querySelector('[data-buscador]');
    inputBuscar = raiz.querySelector('[data-input-buscar]');
    hoja = raiz.querySelector('[data-hoja]');
    form = raiz.querySelector('[data-form]');
    formTitulo = raiz.querySelector('[data-form-titulo]');
    btnBorrar = raiz.querySelector('[data-borrar]');

    var fab = raiz.querySelector('[data-nueva]');
    // .pantalla se anima con transform y crea un bloque contenedor que
    // rompe `position: fixed`. Movemos FAB y hoja al <body>.
    fab.setAttribute('data-fab-songs', '');
    document.body.appendChild(fab);
    document.body.appendChild(hoja);

    fab.addEventListener('click', function () { abrirHoja(null); });
    btnBorrar.addEventListener('click', onBorrar);
    form.addEventListener('submit', onGuardar);

    // hoja ya se ha movido al <body>: hay que consultarla directamente,
    // no a través de `raiz` (que ya no la contiene).
    Array.prototype.forEach.call(hoja.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarHoja);
    });

    // Inputs de archivo de la hoja
    Array.prototype.forEach.call(form.querySelectorAll('[data-input]'), function (inp) {
      inp.addEventListener('change', function () {
        var tipo = inp.getAttribute('data-input');
        var f = inp.files && inp.files[0];
        if (f) { archivosPendientes[tipo] = f; pintarFilaArchivo(tipo, f.name); }
        inp.value = '';
      });
    });
    Array.prototype.forEach.call(form.querySelectorAll('[data-quitar]'), function (btn) {
      btn.addEventListener('click', function () {
        var tipo = btn.getAttribute('data-quitar');
        archivosPendientes[tipo] = 'quitar';
        pintarFilaArchivo(tipo, null);
      });
    });

    inputBuscar.addEventListener('input', function () {
      filtro = inputBuscar.value;
      pintarLista();
    });

    // Al salir de la sección, retiramos FAB y hoja del <body>.
    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) { limpiarRestos(); obs.disconnect(); }
    });
    obs.observe(vista, { childList: true, subtree: true });

    primeraCarga = true;
    pintarLista();

    if (pendienteEditar) {
      var id = pendienteEditar;
      pendienteEditar = null;
      abrirHoja(id);
    }
  }

  function limpiarRestos() {
    Array.prototype.forEach.call(
      document.querySelectorAll('body > [data-hoja], body > [data-fab-songs], body > .menu-estado'),
      function (el) { el.remove(); }
    );
  }

  /* ---------- API externa ---------- */

  // Llamado desde el Modo estudio para editar la canción abierta.
  function editar(id) {
    pendienteEditar = id;
    window.App.ir('canciones');
  }

  /* ---------- Render de la lista ---------- */

  function pintarLista() {
    var todas = window.Canciones.listar();
    var visibles = filtro ? window.Canciones.buscar(filtro) : todas;

    buscador.hidden = todas.length === 0;

    if (todas.length === 0) {
      contenido.innerHTML = vacioInicial();
      primeraCarga = false;
      return;
    }

    if (visibles.length === 0) {
      contenido.innerHTML = '<p class="vacio vacio--mini">Ninguna canción coincide con «' +
        escapar(filtro) + '».</p>';
      return;
    }

    var lista = document.createElement('div');
    lista.className = 'lista' + (primeraCarga ? ' stagger' : '');
    visibles.forEach(function (c) { lista.appendChild(tarjetaCancion(c)); });
    contenido.innerHTML = '';
    contenido.appendChild(lista);
    primeraCarga = false;
  }

  function tarjetaCancion(c) {
    var est = window.Canciones.ESTADOS[c.estado] || window.Canciones.ESTADOS.pendiente;
    var tieneAudio = !!(c.archivos && c.archivos.audio);

    var fila = document.createElement('div');
    fila.className = 'cancion';
    fila.setAttribute('data-id', c.id);

    var abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'cancion__abrir';
    abrir.innerHTML =
      '<span class="cancion__cuerpo">' +
        '<span class="cancion__titulo">' + escapar(c.titulo) + '</span>' +
        (c.compositor ? '<span class="cancion__meta">' + escapar(c.compositor) + '</span>' : '') +
      '</span>' +
      (tieneAudio ? '<span class="cancion__audio" aria-label="Tiene audio">' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5a1 1 0 0 1 1.53-.85l12 7.5a1 1 0 0 1 0 1.7l-12 7.5A1 1 0 0 1 7 19.5z"/></svg></span>' : '') +
      '</span>';
    abrir.addEventListener('click', function () {
      window.App.ir('estudio', { datos: { id: c.id } });
    });

    // Chip de estado: ahora es un botón que abre el selector rápido.
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip chip--boton chip--' + est.token;
    chip.setAttribute('aria-label', 'Estado: ' + est.etiqueta + '. Toca para cambiarlo');
    chip.innerHTML = '<span>' + est.etiqueta + '</span>' +
      '<svg class="chip__flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    chip.addEventListener('click', function (ev) {
      ev.stopPropagation();
      abrirSelectorEstado(c, chip);
    });

    fila.appendChild(abrir);
    fila.appendChild(chip);
    return fila;
  }

  /* ---------- Selector rápido de estado (sin abrir la hoja) ---------- */

  var menuEstado = null;

  function cerrarSelectorEstado() {
    if (!menuEstado) return;
    var m = menuEstado;
    menuEstado = null;
    m.classList.remove('is-abierto');
    document.removeEventListener('click', cerrarSelectorEstado);
    window.removeEventListener('resize', cerrarSelectorEstado);
    var vista = document.getElementById('vista');
    if (vista) vista.removeEventListener('scroll', cerrarSelectorEstado, true);
    setTimeout(function () { m.remove(); }, 160);
  }

  function abrirSelectorEstado(c, chip) {
    if (menuEstado) { cerrarSelectorEstado(); return; }
    var actual = window.Canciones.obtener(c.id);
    var estadoActual = actual ? actual.estado : c.estado;

    menuEstado = document.createElement('div');
    menuEstado.className = 'menu-estado';
    ['pendiente', 'progreso', 'aprendida'].forEach(function (k) {
      var e = window.Canciones.ESTADOS[k];
      var op = document.createElement('button');
      op.type = 'button';
      op.className = 'menu-estado__op menu-estado__op--' + e.token +
        (k === estadoActual ? ' is-actual' : '');
      op.innerHTML = '<span class="menu-estado__punto"></span>' + e.etiqueta;
      op.addEventListener('click', function (ev) {
        ev.stopPropagation();
        cerrarSelectorEstado();
        if (k === estadoActual) return;
        window.Canciones.fijarEstado(c.id, k);
        primeraCarga = false;
        pintarLista();
        if (k === 'aprendida') celebrar();
      });
      menuEstado.appendChild(op);
    });

    document.body.appendChild(menuEstado);

    var r = chip.getBoundingClientRect();
    var ancho = menuEstado.offsetWidth;
    var izq = Math.min(r.right - ancho, window.innerWidth - ancho - 10);
    menuEstado.style.left = Math.max(10, izq) + 'px';
    var alto = menuEstado.offsetHeight;
    if (r.bottom + alto + 8 > window.innerHeight) {
      menuEstado.style.top = (r.top - alto - 6) + 'px';
    } else {
      menuEstado.style.top = (r.bottom + 6) + 'px';
    }

    void menuEstado.offsetHeight;
    menuEstado.classList.add('is-abierto');

    setTimeout(function () {
      document.addEventListener('click', cerrarSelectorEstado);
      window.addEventListener('resize', cerrarSelectorEstado);
      var vista = document.getElementById('vista');
      if (vista) vista.addEventListener('scroll', cerrarSelectorEstado, true);
    }, 0);
  }

  function vacioInicial() {
    return '' +
      '<div class="vacio">' +
      '  <span class="vacio__icono" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>' +
      '  <p>Añade tu primera canción para empezar.<br>Toca el botón <strong>+</strong>.</p>' +
      '</div>';
  }

  /* ---------- Hoja de alta / edición ---------- */

  function abrirHoja(id) {
    idEditando = id || null;
    archivosPendientes = {};
    var c = id ? window.Canciones.obtener(id) : null;

    form.titulo.value = c ? c.titulo : '';
    form.compositor.value = c ? c.compositor : '';
    form.notas.value = c ? c.notas : '';
    form.letraTexto.value = c ? (c.letraTexto || '') : '';
    var estado = c ? c.estado : 'pendiente';
    Array.prototype.forEach.call(form.estado, function (r) { r.checked = r.value === estado; });

    TIPOS_ARCHIVO.forEach(function (tipo) {
      var meta = c && c.archivos ? c.archivos[tipo] : null;
      pintarFilaArchivo(tipo, meta ? meta.nombre : null);
    });

    formTitulo.textContent = c ? 'Editar canción' : 'Nueva canción';
    btnBorrar.hidden = !c;

    hoja.hidden = false;
    void hoja.offsetHeight;            // fuerza reflow: la transición arranca cerrada
    hoja.classList.add('is-abierta');
    setTimeout(function () { form.titulo.focus(); }, 60);
  }

  var ETIQUETA_BASE = {
    audio: 'Audio (MP3)',
    letra: 'Letra (PDF, imagen o texto)',
    partitura: 'Partitura (imagen o PDF)',
  };

  function pintarFilaArchivo(tipo, nombre) {
    var fila = form.querySelector('[data-fila="' + tipo + '"]');
    if (!fila) return;
    var txt = fila.querySelector('[data-nombre="' + tipo + '"]');
    var quitar = fila.querySelector('[data-quitar="' + tipo + '"]');
    var accion = fila.querySelector('.archivo-fila__accion');
    if (nombre) {
      txt.textContent = nombre;
      fila.classList.add('archivo-fila--con-archivo');
      quitar.hidden = false;
      accion.firstChild.textContent = 'Cambiar';
    } else {
      txt.textContent = ETIQUETA_BASE[tipo];
      fila.classList.remove('archivo-fila--con-archivo');
      quitar.hidden = true;
      accion.firstChild.textContent = 'Añadir';
    }
  }

  function cerrarHoja() {
    hoja.classList.remove('is-abierta');
    var cerrar = function () { hoja.hidden = true; hoja.removeEventListener('transitionend', cerrar); };
    hoja.addEventListener('transitionend', cerrar);
    setTimeout(cerrar, 260);   // salvaguarda si no hay transición (reduce-motion)
  }

  function onGuardar(ev) {
    ev.preventDefault();
    var datos = {
      titulo: form.titulo.value,
      compositor: form.compositor.value,
      estado: (form.querySelector('input[name="estado"]:checked') || {}).value || 'pendiente',
      notas: form.notas.value,
      letraTexto: form.letraTexto.value,
    };
    if (!datos.titulo.trim()) {
      form.titulo.focus();
      form.titulo.classList.add('campo--error');
      return;
    }
    form.titulo.classList.remove('campo--error');

    var estadoPrevio = idEditando
      ? (window.Canciones.obtener(idEditando) || {}).estado
      : null;

    var cancion = idEditando
      ? window.Canciones.actualizar(idEditando, datos)
      : window.Canciones.crear(datos);

    aplicarArchivos(cancion.id).then(function () {
      cerrarHoja();
      primeraCarga = false;
      pintarLista();
      if (datos.estado === 'aprendida' && estadoPrevio !== 'aprendida') celebrar();
    });
  }

  // Guarda / quita en window.Archivos los cambios pendientes y
  // actualiza los metadatos de la canción.
  function aplicarArchivos(cancionId) {
    var tareas = TIPOS_ARCHIVO.map(function (tipo) {
      var cambio = archivosPendientes[tipo];
      if (!cambio) return Promise.resolve();
      var clave = cancionId + ':' + tipo;
      if (cambio === 'quitar') {
        return window.Archivos.borrar(clave).then(function () {
          window.Canciones.fijarArchivo(cancionId, tipo, null);
        });
      }
      return window.Archivos.guardar(clave, cambio).then(function (meta) {
        window.Canciones.fijarArchivo(cancionId, tipo, meta);
      });
    });
    return Promise.all(tareas).catch(function (e) {
      console.error('No se pudo guardar un archivo:', e);
      window.UI.aviso('No se pudo guardar uno de los archivos.', { tipo: 'error' });
    });
  }

  function onBorrar() {
    if (!idEditando) return;
    var c = window.Canciones.obtener(idEditando);
    var nombre = c ? c.titulo : 'esta canción';
    var id = idEditando;
    window.UI.confirmar('¿Eliminar «' + nombre + '»? No se puede deshacer.', {
      ok: 'Eliminar', peligro: true,
    }).then(function (ok) {
      if (!ok) return;
      window.Canciones.borrar(id);
      cerrarHoja();
      pintarLista();
    });
  }

  /* ---------- Utilidades ---------- */

  // Pequeña celebración al marcar una canción como "Aprendida".
  function celebrar() {
    var el = document.createElement('div');
    el.className = 'celebra';
    el.innerHTML =
      '<div class="celebra__circulo">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="m5 13 4 4L19 7"/>' +
        '</svg>' +
      '</div>';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1000);
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar, editar: editar };
})();
