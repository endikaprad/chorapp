/* ============================================================
   Pagina_songs — Biblioteca de canciones (Fases 3 y 4)
   Lista + búsqueda + filtros + selector rápido de estado.
   El alta / edición usa la hoja compartida window.HojaCancion
   (el mismo formulario que el (+) de Sesiones y el Modo estudio).
   Al tocar una canción se abre el Modo estudio (Fase 5).
   ============================================================ */

window.Pagina_songs = (function () {
  'use strict';

  var raiz, contenido, barra, inputBuscar, hojaFiltros, badge;
  var filtro = '';
  var filtroIdioma = '';   // '' => todos; código de idioma => solo ese
  var filtroEtiqueta = ''; // '' => todas; etiqueta => solo canciones con ella
  var filtroEstado = '';   // '' => todas; 'pendiente' | 'progreso' | 'aprendida'
  var orden = 'recientes'; // recientes | antiguas | az
  var primeraCarga = true;
  var animarLista = false;  // anima el re-render de la lista tras un cambio de filtro
  var pendienteEditar = null;   // id a editar tras navegar desde otra pantalla

  var ORDENES = [
    { clave: 'recientes', etiqueta: 'Más recientes' },
    { clave: 'antiguas',  etiqueta: 'Más antiguas' },
    { clave: 'az',        etiqueta: 'Título A–Z' },
  ];

  function iniciar(contenedor) {
    limpiarRestos();

    raiz = contenedor.querySelector('[data-modulo="songs"]');
    contenido = raiz.querySelector('[data-contenido]');
    barra = raiz.querySelector('[data-barra]');
    inputBuscar = raiz.querySelector('[data-input-buscar]');
    hojaFiltros = raiz.querySelector('[data-hoja-filtros]');
    badge = raiz.querySelector('[data-badge]');

    var fab = raiz.querySelector('[data-nueva]');
    // .pantalla se anima con transform y crea un bloque contenedor que
    // rompe `position: fixed`. Movemos el FAB (y la hoja de filtros) al <body>.
    fab.setAttribute('data-fab-songs', '');
    document.body.appendChild(fab);
    hojaFiltros.setAttribute('data-hoja-filtros-songs', '');
    document.body.appendChild(hojaFiltros);

    fab.addEventListener('click', function () { abrirHoja(null); });

    inputBuscar.addEventListener('input', function () {
      filtro = inputBuscar.value;
      pintarLista();
    });

    raiz.querySelector('[data-abrir-filtros]').addEventListener('click', abrirFiltros);
    hojaFiltros.querySelector('[data-cerrar-filtros]').addEventListener('click', cerrarFiltros);
    hojaFiltros.querySelector('[data-aplicar-filtros]').addEventListener('click', cerrarFiltros);
    hojaFiltros.querySelector('[data-limpiar-filtros]').addEventListener('click', function () {
      filtroIdioma = '';
      filtroEtiqueta = '';
      filtroEstado = '';
      orden = 'recientes';
      aplicarCambioFiltro();
    });

    // Al salir de la sección, retiramos el FAB del <body>.
    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) {
        limpiarRestos();
        obs.disconnect();
      }
    });
    // RENDIMIENTO — basta con `childList` en #vista, SIN `subtree`: las
    // pantallas son hijas directas de #vista, así que su retirada ya es un
    // cambio en esa lista. Con `subtree` el observador se disparaba en CADA
    // inserción del DOM de la pantalla (el Modo estudio cambia mucho: letra,
    // marcas, listas) y en cada una hacía un `document.body.contains()`.
    obs.observe(vista, { childList: true });

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
      document.querySelectorAll('body > [data-fab-songs], body > [data-hoja-filtros-songs], body > .menu-estado'),
      function (el) { el.remove(); }
    );
  }

  /* ---------- Hoja "Filtrar y ordenar" ---------- */

  // Botones vivos de la hoja: [{ valor, el }]. Se rellenan al construir y se
  // sincronizan en el sitio (sin rehacer DOM) al tocar cualquier opción, para
  // que el deslizamiento del segmento y el "pop" de los chips se animen.
  var opsOrden = [], opsEstado = [], opsIdioma = [], opsEtiqueta = [], segInd = null;

  function abrirFiltros() {
    construirFiltros();
    hojaFiltros.hidden = false;
    void hojaFiltros.offsetHeight;   // fuerza layout antes de medir el segmento
    sincronizarHoja(true);
    hojaFiltros.classList.add('is-abierta');
    // recoloca el indicador cuando el panel ya ha subido del todo
    setTimeout(function () { moverIndicador(false); }, 60);
  }

  function cerrarFiltros() {
    hojaFiltros.classList.remove('is-abierta');
    setTimeout(function () { hojaFiltros.hidden = true; }, 260);
  }

  // Nº de filtros de contenido activos (el orden no cuenta como "filtro").
  function nFiltros() {
    return (filtroEstado ? 1 : 0) + (filtroIdioma ? 1 : 0) + (filtroEtiqueta ? 1 : 0);
  }

  // Construye el contenido de la hoja según el repertorio (una vez por apertura).
  function construirFiltros() {
    var todas = window.Canciones.listar();

    var idiomas = [];
    todas.forEach(function (c) {
      if (c.idioma && idiomas.indexOf(c.idioma) === -1) idiomas.push(c.idioma);
    });
    if (idiomas.indexOf(filtroIdioma) === -1) filtroIdioma = '';

    var etiquetas = window.Canciones.etiquetasTodas ? window.Canciones.etiquetasTodas() : [];
    if (etiquetas.indexOf(filtroEtiqueta) === -1) filtroEtiqueta = '';

    // Ordenar — control segmentado con indicador deslizante
    opsOrden = pintarSegmento(hojaFiltros.querySelector('[data-orden]'),
      ORDENES.map(function (o) { return { valor: o.clave, texto: o.etiqueta }; }),
      function (v) {
        if (v === orden) return;
        orden = v;
        aplicarCambioFiltro();
      });

    // Estado — ver solo aprendidas / en progreso / pendientes
    var EST = window.Canciones.ESTADOS;
    opsEstado = pintarOpciones(hojaFiltros.querySelector('[data-estado]'),
      [{ valor: '', texto: 'Todas' }].concat(['pendiente', 'progreso', 'aprendida'].map(function (k) {
        return { valor: k, texto: EST[k].etiqueta, estado: EST[k].token };
      })),
      function (v) {
        filtroEstado = (filtroEstado === v) ? '' : v;
        aplicarCambioFiltro();
      });

    // Idioma (solo si hay 2+)
    var secIdioma = hojaFiltros.querySelector('[data-sec="idioma"]');
    secIdioma.hidden = idiomas.length < 2;
    opsIdioma = secIdioma.hidden ? [] : pintarOpciones(hojaFiltros.querySelector('[data-idiomas]'),
      [{ valor: '', texto: 'Todos' }].concat(idiomas.map(function (v) {
        return { valor: v, texto: window.Canciones.nombreIdioma(v) };
      })),
      function (v) {
        filtroIdioma = (filtroIdioma === v) ? '' : v;
        aplicarCambioFiltro();
      });

    // Etiquetas
    var secEtq = hojaFiltros.querySelector('[data-sec="etiqueta"]');
    secEtq.hidden = !etiquetas.length;
    opsEtiqueta = secEtq.hidden ? [] : pintarOpciones(hojaFiltros.querySelector('[data-etiquetas]'),
      [{ valor: '', texto: 'Todas' }].concat(etiquetas.map(function (v) {
        return { valor: v, texto: v, hash: true };
      })),
      function (v) {
        filtroEtiqueta = (filtroEtiqueta === v) ? '' : v;
        aplicarCambioFiltro();
      });
  }

  // Un toque en cualquier opción: refresca la lista y la propia hoja en vivo.
  function aplicarCambioFiltro() {
    primeraCarga = false;
    animarLista = true;
    pintarLista();
    sincronizarHoja(false);
  }

  // Sincroniza clases activas, indicador y textos sin rehacer el DOM.
  function sincronizarHoja(instantaneo) {
    marcarActivos(opsOrden, orden);
    marcarActivos(opsEstado, filtroEstado);
    marcarActivos(opsIdioma, filtroIdioma);
    marcarActivos(opsEtiqueta, filtroEtiqueta);
    moverIndicador(instantaneo);

    hojaFiltros.querySelector('[data-limpiar-filtros]').hidden =
      nFiltros() === 0 && orden === 'recientes';

    var n = window.Canciones.listar().length ? contarVisibles() : 0;
    var ver = hojaFiltros.querySelector('[data-aplicar-filtros]');
    var txt = n === 0 ? 'Sin resultados'
      : 'Ver ' + n + (n === 1 ? ' canción' : ' canciones');
    if (ver.textContent !== txt) {
      ver.textContent = txt;
      ver.classList.remove('is-cambio');
      void ver.offsetWidth;
      ver.classList.add('is-cambio');
    }
  }

  function marcarActivos(ops, valor) {
    ops.forEach(function (o) {
      var activo = o.valor === valor;
      if (activo === o.el.classList.contains('is-activo')) return;
      o.el.classList.toggle('is-activo', activo);
      if (activo && !o.el.classList.contains('segmento__op')) {
        o.el.classList.remove('is-pop');
        void o.el.offsetWidth;
        o.el.classList.add('is-pop');
      }
    });
  }

  // Desliza el indicador blanco del segmento bajo la opción activa.
  function moverIndicador(instantaneo) {
    if (!segInd) return;
    var activo = null;
    opsOrden.forEach(function (o) { if (o.valor === orden) activo = o.el; });
    if (!activo || !activo.offsetParent) return;
    if (instantaneo) segInd.style.transition = 'none';
    segInd.style.width = activo.offsetWidth + 'px';
    segInd.style.transform = 'translateX(' + activo.offsetLeft + 'px)';
    if (instantaneo) { void segInd.offsetWidth; segInd.style.transition = ''; }
  }

  // Cuántas canciones pasan los filtros actuales (sin repintar la lista).
  function contarVisibles() {
    var base = filtro ? window.Canciones.buscar(filtro) : window.Canciones.listar();
    return base.filter(function (c) {
      if (filtroEstado && c.estado !== filtroEstado) return false;
      if (filtroIdioma && c.idioma !== filtroIdioma) return false;
      if (filtroEtiqueta && !(Array.isArray(c.etiquetas) && c.etiquetas.indexOf(filtroEtiqueta) !== -1)) return false;
      return true;
    }).length;
  }

  // Chips redondeados (estado, idioma, etiquetas). Devuelve [{ valor, el }].
  function pintarOpciones(cont, items, onElegir) {
    cont.innerHTML = '';
    return items.map(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'filtro-op' +
        (it.hash ? ' filtro-op--hash' : '') +
        (it.estado ? ' filtro-op--estado filtro-op--' + it.estado : '');
      if (it.estado) {
        b.innerHTML = '<span class="filtro-op__punto"></span>';
        b.appendChild(document.createTextNode(it.texto));
      } else {
        b.textContent = it.texto;
      }
      b.addEventListener('click', function () { onElegir(it.valor); });
      cont.appendChild(b);
      return { valor: it.valor, el: b };
    });
  }

  // Control segmentado (una sola elección, ocupa el ancho). Devuelve [{ valor, el }].
  function pintarSegmento(cont, items, onElegir) {
    cont.innerHTML = '';
    segInd = document.createElement('span');
    segInd.className = 'segmento__ind';
    segInd.setAttribute('aria-hidden', 'true');
    cont.appendChild(segInd);
    return items.map(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'segmento__op';
      b.textContent = it.texto;
      b.addEventListener('click', function () { onElegir(it.valor); });
      cont.appendChild(b);
      return { valor: it.valor, el: b };
    });
  }

  // Marca en el botón de la barra cuántos filtros hay puestos.
  function pintarBadge() {
    var n = nFiltros();
    if (n === 0) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      badge.textContent = String(n);
    }
    raiz.querySelector('[data-abrir-filtros]').classList.toggle('is-activo', n > 0 || orden !== 'recientes');
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

  function ordenar(lista) {
    var arr = lista.slice();
    if (orden === 'antiguas') {
      arr.sort(function (a, b) { return (a.creada || 0) - (b.creada || 0); });
    } else if (orden === 'az') {
      arr.sort(function (a, b) {
        return String(a.titulo || '').localeCompare(String(b.titulo || ''), 'es', { sensitivity: 'base' });
      });
    } else { // 'recientes' (por defecto)
      arr.sort(function (a, b) { return (b.creada || 0) - (a.creada || 0); });
    }
    return arr;
  }

  function pintarLista() {
    var todas = window.Canciones.listar();
    var visibles = filtro ? window.Canciones.buscar(filtro) : todas;

    barra.hidden = todas.length === 0;

    if (todas.length === 0) {
      contenido.innerHTML = vacioInicial();
      primeraCarga = false;
      return;
    }

    // Estado elegido en la hoja (ver solo aprendidas / en progreso / pendientes).
    if (filtroEstado) {
      visibles = visibles.filter(function (c) { return c.estado === filtroEstado; });
    }

    // Idiomas / etiquetas presentes: si el filtro activo ya no existe, se cae.
    var idiomas = [];
    todas.forEach(function (c) {
      if (c.idioma && idiomas.indexOf(c.idioma) === -1) idiomas.push(c.idioma);
    });
    if (idiomas.indexOf(filtroIdioma) === -1) filtroIdioma = '';
    if (filtroIdioma) {
      visibles = visibles.filter(function (c) { return c.idioma === filtroIdioma; });
    }

    var etiquetas = window.Canciones.etiquetasTodas ? window.Canciones.etiquetasTodas() : [];
    if (etiquetas.indexOf(filtroEtiqueta) === -1) filtroEtiqueta = '';
    if (filtroEtiqueta) {
      visibles = visibles.filter(function (c) {
        return Array.isArray(c.etiquetas) && c.etiquetas.indexOf(filtroEtiqueta) !== -1;
      });
    }

    visibles = ordenar(visibles);
    pintarBadge();

    contenido.innerHTML = '';

    // Resumen de filtros activos, con acceso rápido a quitarlos.
    if (filtroEstado || filtroIdioma || filtroEtiqueta) {
      var res = document.createElement('div');
      res.className = 'rep-activos';
      if (filtroEstado) {
        var et = (window.Canciones.ESTADOS[filtroEstado] || {}).etiqueta || filtroEstado;
        res.appendChild(pildoraActiva(et, function () {
          filtroEstado = ''; quitarPildora();
        }, 'filtro-op--' + filtroEstado));
      }
      if (filtroIdioma) res.appendChild(pildoraActiva(window.Canciones.nombreIdioma(filtroIdioma), function () {
        filtroIdioma = ''; quitarPildora();
      }));
      if (filtroEtiqueta) res.appendChild(pildoraActiva('#' + filtroEtiqueta, function () {
        filtroEtiqueta = ''; quitarPildora();
      }));
      contenido.appendChild(res);
    }

    if (visibles.length === 0) {
      var msg = document.createElement('p');
      msg.className = 'vacio vacio--mini';
      msg.textContent = filtro
        ? 'Ninguna canción coincide con «' + filtro + '».'
        : 'Ninguna canción con esos filtros. Prueba a quitar alguno.';
      contenido.appendChild(msg);
      return;
    }

    var lista = document.createElement('div');
    lista.className = 'lista' +
      (primeraCarga ? ' stagger' : (animarLista ? ' lista--refresca' : ''));
    visibles.forEach(function (c) { lista.appendChild(tarjetaCancion(c)); });
    contenido.appendChild(lista);
    primeraCarga = false;
    animarLista = false;
  }

  // Quitar un filtro desde su píldora: anima la lista al recomponerse.
  function quitarPildora() {
    primeraCarga = false;
    animarLista = true;
    pintarLista();
  }

  // Píldora "filtro activo" con la (x) para quitarlo, encima de la lista.
  function pildoraActiva(texto, onQuitar, extraClase) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rep-activos__pill' + (extraClase ? ' ' + extraClase : '');
    b.innerHTML = '<span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    b.querySelector('span').textContent = texto;
    b.addEventListener('click', onQuitar);
    return b;
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
