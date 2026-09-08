/* ============================================================
   Pagina_songs — Biblioteca de canciones (Fases 3 y 4)
   Lista + búsqueda + filtros + selector rápido de estado.
   El alta / edición usa la hoja compartida window.HojaCancion
   (el mismo formulario que el (+) de Sesiones y el Modo estudio).
   Al tocar una canción se abre el Modo estudio (Fase 5).
   ============================================================ */

window.Pagina_songs = (function () {
  'use strict';

  var raiz, contenido, buscador, inputBuscar;
  var filtro = '';
  var filtroIdioma = '';   // '' => todos; código de idioma => solo ese
  var filtroEtiqueta = ''; // '' => todas; etiqueta => solo canciones con ella
  var primeraCarga = true;
  var pendienteEditar = null;   // id a editar tras navegar desde otra pantalla

  function iniciar(contenedor) {
    limpiarRestos();

    raiz = contenedor.querySelector('[data-modulo="songs"]');
    contenido = raiz.querySelector('[data-contenido]');
    buscador = raiz.querySelector('[data-buscador]');
    inputBuscar = raiz.querySelector('[data-input-buscar]');

    var fab = raiz.querySelector('[data-nueva]');
    // .pantalla se anima con transform y crea un bloque contenedor que
    // rompe `position: fixed`. Movemos el FAB al <body>.
    fab.setAttribute('data-fab-songs', '');
    document.body.appendChild(fab);

    fab.addEventListener('click', function () { abrirHoja(null); });

    inputBuscar.addEventListener('input', function () {
      filtro = inputBuscar.value;
      pintarLista();
    });

    // Al salir de la sección, retiramos el FAB del <body>.
    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) {
        limpiarRestos();
        obs.disconnect();
      }
    });
    obs.observe(vista, { childList: true, subtree: true });

    primeraCarga = true;
    pintarLista();

    if (pendienteEditar) {
      var pe = pendienteEditar;
      pendienteEditar = null;
      abrirHoja(pe.id, pe.foco);
    }
  }

  function limpiarRestos() {
    Array.prototype.forEach.call(
      document.querySelectorAll('body > [data-fab-songs], body > .menu-estado'),
      function (el) { el.remove(); }
    );
  }

  /* ---------- Hoja compartida de alta / edición ---------- */

  function abrirHoja(id, foco) {
    window.HojaCancion.abrir({
      id: id || null,
      foco: foco || null,
      alGuardar: function () { primeraCarga = false; pintarLista(); },
      alBorrar: function () { primeraCarga = false; pintarLista(); },
    });
  }

  /* ---------- API externa ---------- */

  // Llamado desde el Modo estudio para editar la canción abierta.
  // `foco` (opcional): 'letra' | 'partitura' | ... para abrir la hoja
  // desplazada hasta esa fila de archivo lista para añadirlo.
  function editar(id, foco) {
    pendienteEditar = { id: id, foco: foco || null };
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

    // Idiomas presentes en el repertorio (para la fila de filtros).
    var idiomas = [];
    todas.forEach(function (c) {
      if (c.idioma && idiomas.indexOf(c.idioma) === -1) idiomas.push(c.idioma);
    });
    if (idiomas.indexOf(filtroIdioma) === -1) filtroIdioma = '';
    if (filtroIdioma) {
      visibles = visibles.filter(function (c) { return c.idioma === filtroIdioma; });
    }

    // Etiquetas presentes en el repertorio.
    var etiquetas = window.Canciones.etiquetasTodas ? window.Canciones.etiquetasTodas() : [];
    if (etiquetas.indexOf(filtroEtiqueta) === -1) filtroEtiqueta = '';
    if (filtroEtiqueta) {
      visibles = visibles.filter(function (c) {
        return Array.isArray(c.etiquetas) && c.etiquetas.indexOf(filtroEtiqueta) !== -1;
      });
    }

    contenido.innerHTML = '';
    if (idiomas.length >= 2) contenido.appendChild(filaFiltros('idioma', idiomas));
    if (etiquetas.length) contenido.appendChild(filaFiltros('etiqueta', etiquetas));

    if (visibles.length === 0) {
      var msg = document.createElement('p');
      msg.className = 'vacio vacio--mini';
      msg.textContent = filtro
        ? 'Ninguna canción coincide con «' + filtro + '».'
        : (filtroEtiqueta
            ? 'Ninguna canción con la etiqueta «' + filtroEtiqueta + '»'
              + (filtroIdioma ? ' en ' + window.Canciones.nombreIdioma(filtroIdioma) : '') + '.'
            : 'Ninguna canción en ' + window.Canciones.nombreIdioma(filtroIdioma) + '.');
      contenido.appendChild(msg);
      return;
    }

    var lista = document.createElement('div');
    lista.className = 'lista' + (primeraCarga ? ' stagger' : '');
    visibles.forEach(function (c) { lista.appendChild(tarjetaCancion(c)); });
    contenido.appendChild(lista);
    primeraCarga = false;
  }

  // Fila de filtros (scroll horizontal). tipo: 'idioma' | 'etiqueta'.
  // "Todos" + un chip por valor.
  function filaFiltros(tipo, valores) {
    var esIdioma = tipo === 'idioma';
    var bar = document.createElement('div');
    bar.className = 'idioma-filtros' + (esIdioma ? '' : ' idioma-filtros--etiq');
    [''].concat(valores).forEach(function (v) {
      var activo = esIdioma ? (v === filtroIdioma) : (v === filtroEtiqueta);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'idioma-filtros__chip' + (activo ? ' is-activo' : '');
      b.textContent = v
        ? (esIdioma ? window.Canciones.nombreIdioma(v) : v)
        : (esIdioma ? 'Todos' : 'Todas');
      b.addEventListener('click', function () {
        if (esIdioma) filtroIdioma = (filtroIdioma === v) ? '' : v;
        else filtroEtiqueta = (filtroEtiqueta === v) ? '' : v;
        primeraCarga = false;
        pintarLista();
      });
      bar.appendChild(b);
    });
    return bar;
  }

  function tarjetaCancion(c) {
    var est = window.Canciones.ESTADOS[c.estado] || window.Canciones.ESTADOS.pendiente;

    var fila = document.createElement('div');
    fila.className = 'cancion';
    fila.setAttribute('data-id', c.id);

    var abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'cancion__abrir';
    abrir.innerHTML =
      '<span class="cancion__cuerpo">' +
        '<span class="cancion__texto">' +
          '<span class="cancion__titulo">' + escapar(c.titulo) + '</span>' +
          (c.compositor || c.idioma
            ? '<span class="cancion__meta">' +
                escapar([c.compositor, window.Canciones.nombreIdioma(c.idioma)].filter(Boolean).join(' · ')) +
              '</span>'
            : '') +
          (Array.isArray(c.etiquetas) && c.etiquetas.length
            ? '<span class="cancion__etiquetas">' + c.etiquetas.slice(0, 4).map(function (e) {
                return '<span class="cancion__etq">' + escapar(e) + '</span>';
              }).join('') + '</span>'
            : '') +
        '</span>' +
        insigniasArchivos(c) +
      '</span>';
    abrir.addEventListener('click', function () {
      // Si hay algo que escuchar (grabación original o algún ensayo), va
      // directa al Modo estudio; allí se elige la versión. Si aún no tiene
      // nada, a su ficha para añadir letra/partitura.
      var hay = window.Sesiones && window.Sesiones.ultimaMarcaDeCancion(c.id);
      if (hay) {
        window.App.ir('estudio', { datos: { id: c.id } });
      } else {
        window.App.ir('cancion', { datos: { id: c.id } });
      }
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

  // Insignias de archivos disponibles (letra / partitura). Solo si los tiene.
  function insigniasArchivos(c) {
    var arch = c && c.archivos ? c.archivos : {};
    var items = [];
    if ((c.letraTexto && c.letraTexto.trim()) || arch.letra) {
      items.push('<span class="cancion__insignia" title="Tiene letra" aria-label="Tiene letra">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg></span>');
    }
    if (arch.partitura) {
      items.push('<span class="cancion__insignia" title="Tiene partitura" aria-label="Tiene partitura">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>');
    }
    if (!items.length) return '';
    return '<span class="cancion__insignias">' + items.join('') + '</span>';
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

  /* ---------- Utilidades ---------- */

  // Pequeña celebración al marcar una canción como "Aprendida".
  function celebrar() {
    var frase = (window.Frases && window.Frases.enhorabuena)
      ? window.Frases.enhorabuena() : '';
    var el = document.createElement('div');
    el.className = 'celebra' + (frase ? ' celebra--frase' : '');
    el.innerHTML =
      '<div class="celebra__circulo">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="m5 13 4 4L19 7"/>' +
        '</svg>' +
      '</div>' +
      (frase ? '<p class="celebra__frase"></p>' : '');
    if (frase) el.querySelector('.celebra__frase').textContent = frase;
    document.body.appendChild(el);
    var quita = function () { if (el.parentNode) el.remove(); };

    if (!frase) { setTimeout(quita, 1000); return; }

    // Con frase se queda un buen rato para leerla. Al tocar (dentro o
    // fuera) no se corta de golpe: se va con la misma animación de salida.
    var t = setTimeout(quita, 4200);
    var cerrado = false;
    el.addEventListener('click', function () {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(t);
      el.classList.add('celebra--saliendo');
      el.addEventListener('animationend', quita, { once: true });
      setTimeout(quita, 400); // red de seguridad si no llega animationend
    });
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar, editar: editar };
})();
