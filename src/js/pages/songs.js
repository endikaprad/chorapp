/* ============================================================
   Pagina_songs — Biblioteca de canciones (Fase 3)
   Lista + búsqueda + alta / edición / borrado.
   app.js llama a iniciar(contenedor) al cargar pages/songs.html.
   ============================================================ */

window.Pagina_songs = (function () {
  'use strict';

  var raiz, contenido, buscador, inputBuscar, hoja, form, formTitulo, btnBorrar;
  var idEditando = null;   // null => alta; id => edición
  var filtro = '';
  var primeraCarga = true;

  function iniciar(contenedor) {
    // Limpia restos de montajes anteriores (hoja / fab van al <body>,
    // ver más abajo, y no se destruyen al cambiar de pantalla).
    Array.prototype.forEach.call(
      document.querySelectorAll('body > [data-hoja], body > [data-fab-songs]'),
      function (el) { el.remove(); }
    );

    raiz = contenedor.querySelector('[data-modulo="songs"]');
    contenido = raiz.querySelector('[data-contenido]');
    buscador = raiz.querySelector('[data-buscador]');
    inputBuscar = raiz.querySelector('[data-input-buscar]');
    hoja = raiz.querySelector('[data-hoja]');
    form = raiz.querySelector('[data-form]');
    formTitulo = raiz.querySelector('[data-form-titulo]');
    btnBorrar = raiz.querySelector('[data-borrar]');

    var fab = raiz.querySelector('[data-nueva]');
    // .pantalla tiene una animación con transform: eso crea un bloque
    // contenedor y rompe `position: fixed`. Movemos el FAB y la hoja
    // al <body> para que se posicionen respecto al viewport.
    fab.setAttribute('data-fab-songs', '');
    document.body.appendChild(fab);
    document.body.appendChild(hoja);

    fab.addEventListener('click', function () { abrirHoja(null); });
    btnBorrar.addEventListener('click', onBorrar);
    form.addEventListener('submit', onGuardar);

    Array.prototype.forEach.call(raiz.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarHoja);
    });

    inputBuscar.addEventListener('input', function () {
      filtro = inputBuscar.value;
      pintarLista();
    });

    // Cuando #vista deja de contener esta pantalla (cambio de sección),
    // retiramos el FAB y la hoja que habíamos movido al <body>.
    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) {
        Array.prototype.forEach.call(
          document.querySelectorAll('body > [data-hoja], body > [data-fab-songs]'),
          function (el) { el.remove(); }
        );
        obs.disconnect();
      }
    });
    obs.observe(vista, { childList: true, subtree: true });

    primeraCarga = true;
    pintarLista();
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
    visibles.forEach(function (c) {
      lista.appendChild(tarjetaCancion(c));
    });
    contenido.innerHTML = '';
    contenido.appendChild(lista);
    primeraCarga = false;
  }

  function tarjetaCancion(c) {
    var est = window.Canciones.ESTADOS[c.estado] || window.Canciones.ESTADOS.pendiente;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cancion';
    btn.setAttribute('data-id', c.id);
    btn.innerHTML =
      '<span class="cancion__cuerpo">' +
        '<span class="cancion__titulo">' + escapar(c.titulo) + '</span>' +
        (c.compositor
          ? '<span class="cancion__meta">' + escapar(c.compositor) + '</span>'
          : '') +
      '</span>' +
      '<span class="chip chip--' + est.token + '">' + est.etiqueta + '</span>';

    // Fase 3: al tocar la tarjeta se abre la edición.
    // (En la Fase 5 pasará a abrir el Modo estudio.)
    btn.addEventListener('click', function () { abrirHoja(c.id); });
    return btn;
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
    var c = id ? window.Canciones.obtener(id) : null;

    form.titulo.value = c ? c.titulo : '';
    form.compositor.value = c ? c.compositor : '';
    form.notas.value = c ? c.notas : '';
    var estado = c ? c.estado : 'pendiente';
    Array.prototype.forEach.call(form.estado, function (r) { r.checked = r.value === estado; });

    formTitulo.textContent = c ? 'Editar canción' : 'Nueva canción';
    btnBorrar.hidden = !c;

    hoja.hidden = false;
    void hoja.offsetHeight;            // fuerza reflow: la transición arranca desde el estado cerrado
    hoja.classList.add('is-abierta');
    setTimeout(function () { form.titulo.focus(); }, 60);
  }

  function cerrarHoja() {
    hoja.classList.remove('is-abierta');
    var cerrar = function () { hoja.hidden = true; hoja.removeEventListener('transitionend', cerrar); };
    hoja.addEventListener('transitionend', cerrar);
    // Salvaguarda si no hay transición (reduce-motion).
    setTimeout(cerrar, 260);
  }

  function onGuardar(ev) {
    ev.preventDefault();
    var datos = {
      titulo: form.titulo.value,
      compositor: form.compositor.value,
      estado: (form.querySelector('input[name="estado"]:checked') || {}).value || 'pendiente',
      notas: form.notas.value,
    };
    if (!datos.titulo.trim()) {
      form.titulo.focus();
      form.titulo.classList.add('campo--error');
      return;
    }
    form.titulo.classList.remove('campo--error');

    if (idEditando) window.Canciones.actualizar(idEditando, datos);
    else window.Canciones.crear(datos);

    cerrarHoja();
    primeraCarga = false;
    pintarLista();
  }

  function onBorrar() {
    if (!idEditando) return;
    var c = window.Canciones.obtener(idEditando);
    var nombre = c ? c.titulo : 'esta canción';
    if (!window.confirm('¿Eliminar «' + nombre + '»? No se puede deshacer.')) return;
    window.Canciones.borrar(idEditando);
    cerrarHoja();
    pintarLista();
  }

  /* ---------- Utilidades ---------- */

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
