/* ============================================================
   Pagina_sessions — Lista de sesiones del coro.

   El coro manda la grabación entera del ensayo. Aquí Maite las
   guarda (fecha + audio) y entra en cada una para escucharla y
   marcar dónde suena cada canción (ver session.js).
   ============================================================ */

window.Pagina_sessions = (function () {
  'use strict';

  var raiz, contenido, hoja, form, formTitulo, btnBorrar;
  var filtroRango, panelRango, resumenRango, btnQuitarRango, cuenta;
  var calGrid, calMesEl;
  var idEditando = null;
  var primeraCarga = true;

  // Filtro por rango de fechas (de esta fecha a esta fecha).
  var rangoDesde = null;         // 'YYYY-MM-DD' | null
  var rangoHasta = null;         // 'YYYY-MM-DD' | null
  var rangoAbierto = false;      // panel desplegado
  var rangoTab = 'desde';        // extremo que se está eligiendo
  var calAnio, calMes;           // mes que muestra el calendario del filtro

  var archivoPendiente = null;   // File | 'quitar' | null
  var fpk = null;                // instancia de window.FechaPicker
  var fechaSel = null;           // 'YYYY-MM-DD' elegida en la hoja
  var pendienteEditar = null;    // id a editar tras navegar desde la vista de sesión

  // Llamado desde la vista de sesión (session.js) para editar la sesión abierta.
  function editar(id) {
    pendienteEditar = id;
    window.App.ir('sesiones');
  }

  function iniciar(contenedor) {
    limpiarRestos();

    raiz = contenedor.querySelector('[data-modulo="sessions"]');
    contenido = raiz.querySelector('[data-contenido]');
    filtroRango = raiz.querySelector('[data-filtro]');
    panelRango = filtroRango.querySelector('[data-panel]');
    resumenRango = filtroRango.querySelector('[data-resumen]');
    btnQuitarRango = filtroRango.querySelector('[data-quitar]');
    cuenta = filtroRango.querySelector('[data-cuenta]');
    calGrid = filtroRango.querySelector('[data-grid]');
    calMesEl = filtroRango.querySelector('[data-mes]');
    hoja = raiz.querySelector('[data-hoja]');
    form = raiz.querySelector('[data-form]');
    formTitulo = raiz.querySelector('[data-form-titulo]');
    btnBorrar = raiz.querySelector('[data-borrar]');

    var fab = raiz.querySelector('[data-nueva]');
    fab.setAttribute('data-fab-sessions', '');
    // Marca propia: otras páginas también mueven una [data-hoja] al <body>
    // (songs.js, session.js). Sin esto, su limpieza se llevaría la nuestra.
    hoja.setAttribute('data-hoja-sessions', '');
    document.body.appendChild(fab);
    document.body.appendChild(hoja);

    fab.addEventListener('click', function () { abrirHoja(null); });
    btnBorrar.addEventListener('click', onBorrar);
    form.addEventListener('submit', onGuardar);

    Array.prototype.forEach.call(hoja.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarHoja);
    });

    var inp = form.querySelector('[data-input="audio"]');
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (f) { archivoPendiente = f; pintarFilaArchivo(f.name); }
      inp.value = '';
    });
    form.querySelector('[data-quitar="audio"]').addEventListener('click', function () {
      archivoPendiente = 'quitar';
      pintarFilaArchivo(null);
    });

    raiz.querySelector('[data-ir-repertorio]').addEventListener('click', function () {
      window.App.ir('canciones');
    });

    iniciarFiltroRango();

    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) { limpiarRestos(); obs.disconnect(); }
    });
    obs.observe(vista, { childList: true, subtree: true });

    primeraCarga = true;
    rangoDesde = rangoHasta = null;
    rangoAbierto = false;
    rangoTab = 'desde';
    cerrarPanelRango(true);
    pintarLista();

    if (pendienteEditar) {
      var pe = pendienteEditar;
      pendienteEditar = null;
      abrirHoja(pe);
    }
  }

  function limpiarRestos() {
    Array.prototype.forEach.call(
      document.querySelectorAll('body > [data-hoja-sessions], body > [data-fab-sessions]'),
      function (el) { el.remove(); }
    );
  }

  /* ---------- Lista ---------- */

  function pintarLista() {
    var sesiones = window.Sesiones ? window.Sesiones.listar() : [];
    var repertorio = raiz.querySelector('[data-ir-repertorio]');

    if (!sesiones.length) {
      filtroRango.hidden = true;
      contenido.innerHTML = vacioInicial();
      repertorio.hidden = (window.Canciones && window.Canciones.listar().length > 0) ? false : true;
      primeraCarga = false;
      return;
    }
    repertorio.hidden = false;

    // El filtro aparece a partir de 5 sesiones (antes no hace falta).
    filtroRango.hidden = sesiones.length < 5;
    if (filtroRango.hidden) { rangoDesde = rangoHasta = null; }

    // Filtrado por rango: la fecha ISO ('YYYY-MM-DD') se compara como texto.
    var visibles = sesiones.filter(function (s) {
      var f = s.fecha || '';
      if (rangoDesde && f < rangoDesde) return false;
      if (rangoHasta && f > rangoHasta) return false;
      return true;
    });

    var filtrando = !!(rangoDesde || rangoHasta);
    cuenta.hidden = !filtrando;
    if (filtrando) {
      cuenta.textContent = visibles.length +
        (visibles.length === 1 ? ' sesión' : ' sesiones') + ' de ' + sesiones.length;
    }

    contenido.innerHTML = '';

    if (!visibles.length) {
      contenido.innerHTML =
        '<div class="vacio vacio--filtro">' +
        '  <span class="vacio__icono" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg></span>' +
        '  <p>No hay ninguna sesión entre esas fechas.</p>' +
        '</div>';
      primeraCarga = false;
      return;
    }

    var lista = document.createElement('div');
    lista.className = 'lista' + (primeraCarga ? ' stagger' : ' lista--refresca');
    visibles.forEach(function (s) { lista.appendChild(tarjeta(s)); });
    contenido.appendChild(lista);
    primeraCarga = false;
  }

  /* ---------- Filtro por rango de fechas ---------- */

  function iniciarFiltroRango() {
    var hoy = new Date();
    calAnio = hoy.getFullYear();
    calMes = hoy.getMonth();

    filtroRango.querySelector('[data-abrir]').addEventListener('click', function () {
      rangoAbierto ? cerrarPanelRango() : abrirPanelRango();
    });

    btnQuitarRango.addEventListener('click', function (ev) {
      ev.stopPropagation();
      rangoDesde = rangoHasta = null;
      rangoTab = 'desde';
      pintarRango();
      pintarLista();
    });

    filtroRango.querySelector('[data-prev]').addEventListener('click', function () {
      calMes--; if (calMes < 0) { calMes = 11; calAnio--; }
      pintarCalendario();
    });
    filtroRango.querySelector('[data-next]').addEventListener('click', function () {
      calMes++; if (calMes > 11) { calMes = 0; calAnio++; }
      pintarCalendario();
    });

    Array.prototype.forEach.call(filtroRango.querySelectorAll('[data-tab]'), function (t) {
      t.addEventListener('click', function () {
        rangoTab = t.getAttribute('data-tab');
        var ref = rangoTab === 'desde' ? rangoDesde : rangoHasta;
        if (ref) { var d = _d(ref); calAnio = d.getFullYear(); calMes = d.getMonth(); }
        pintarRango();
      });
    });

    Array.prototype.forEach.call(filtroRango.querySelectorAll('[data-preset]'), function (p) {
      p.addEventListener('click', function () { aplicarPreset(p.getAttribute('data-preset')); });
    });
  }

  function abrirPanelRango() {
    rangoAbierto = true;
    filtroRango.querySelector('[data-abrir]').setAttribute('aria-expanded', 'true');
    filtroRango.classList.add('is-abierto');
    // Arranca el calendario en el mes del extremo ya elegido, si lo hay.
    var ref = rangoDesde || rangoHasta;
    if (ref) { var d = _d(ref); calAnio = d.getFullYear(); calMes = d.getMonth(); }
    pintarRango();
  }

  function cerrarPanelRango(silencioso) {
    rangoAbierto = false;
    if (!filtroRango) return;
    filtroRango.classList.remove('is-abierto');
    var b = filtroRango.querySelector('[data-abrir]');
    if (b) b.setAttribute('aria-expanded', 'false');
    if (!silencioso) pintarRango();
  }

  function aplicarPreset(clave) {
    var hoy = new Date();
    if (clave === 'todo') {
      rangoDesde = rangoHasta = null;
    } else if (clave === 'mes') {
      rangoDesde = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
      rangoHasta = iso(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0));
    } else if (clave === 'anio') {
      rangoDesde = hoy.getFullYear() + '-01-01';
      rangoHasta = hoy.getFullYear() + '-12-31';
    }
    rangoTab = 'desde';
    if (rangoDesde) { var d = _d(rangoDesde); calAnio = d.getFullYear(); calMes = d.getMonth(); }
    pintarRango();
    pintarLista();
  }

  // Elegir un día para el extremo activo (desde / hasta), ordenando solo.
  function elegirDia(diaISO) {
    if (rangoTab === 'desde') {
      rangoDesde = diaISO;
      if (rangoHasta && rangoHasta < diaISO) rangoHasta = diaISO;
      rangoTab = 'hasta';   // siguiente toque elige el final
    } else {
      rangoHasta = diaISO;
      if (rangoDesde && rangoDesde > diaISO) rangoDesde = diaISO;
    }
    pintarRango();
    pintarLista();
  }

  function pintarRango() {
    // Resumen en la barra
    if (rangoDesde && rangoHasta) {
      resumenRango.textContent = rangoDesde === rangoHasta
        ? 'El ' + fmtCorto(rangoDesde)
        : fmtCorto(rangoDesde) + ' – ' + fmtCorto(rangoHasta);
    } else if (rangoDesde) {
      resumenRango.textContent = 'Desde el ' + fmtCorto(rangoDesde);
    } else if (rangoHasta) {
      resumenRango.textContent = 'Hasta el ' + fmtCorto(rangoHasta);
    } else {
      resumenRango.textContent = 'Filtrar por fecha';
    }
    var activo = !!(rangoDesde || rangoHasta);
    btnQuitarRango.hidden = !activo;
    filtroRango.classList.toggle('is-activo', activo);

    // Pestañas Desde / Hasta
    Array.prototype.forEach.call(filtroRango.querySelectorAll('[data-tab]'), function (t) {
      var k = t.getAttribute('data-tab');
      t.classList.toggle('is-activa', k === rangoTab);
      var val = k === 'desde' ? rangoDesde : rangoHasta;
      t.querySelector('b').textContent = val ? fmtCorto(val) : 'cualquiera';
    });

    if (rangoAbierto) pintarCalendario();
  }

  function pintarCalendario() {
    calMesEl.textContent =
      cap(new Date(calAnio, calMes, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }));

    var primero = (new Date(calAnio, calMes, 1).getDay() + 6) % 7;  // lunes = 0
    var total = new Date(calAnio, calMes + 1, 0).getDate();
    var hoyISO = iso(new Date());

    calGrid.innerHTML = '';
    for (var i = 0; i < primero; i++) {
      var v = document.createElement('span');
      v.className = 'cal__dia cal__dia--vacio';
      calGrid.appendChild(v);
    }
    for (var dia = 1; dia <= total; dia++) {
      var diaISO = calAnio + '-' + p2(calMes + 1) + '-' + p2(dia);
      var cel = document.createElement('button');
      cel.type = 'button';
      cel.className = 'cal__dia cal__dia--elegible';
      cel.textContent = String(dia);
      if (diaISO === hoyISO) cel.classList.add('cal__dia--hoy');
      if (rangoDesde && rangoHasta && diaISO > rangoDesde && diaISO < rangoHasta) {
        cel.classList.add('cal__dia--rango');
      }
      if (diaISO === rangoDesde) cel.classList.add('cal__dia--extremo', 'cal__dia--extremo-ini');
      if (diaISO === rangoHasta) cel.classList.add('cal__dia--extremo', 'cal__dia--extremo-fin');
      (function (d) {
        cel.addEventListener('click', function () { elegirDia(d); });
      })(diaISO);
      calGrid.appendChild(cel);
    }
  }

  /* ---------- Fechas del filtro ---------- */

  function iso(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtCorto(isoStr) {
    var d = _d(isoStr); if (isNaN(d)) return isoStr;
    try { return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', ''); }
    catch (e) { return isoStr; }
  }

  function tarjeta(s) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sesion';
    btn.setAttribute('data-id', s.id);

    var nMarcas = (s.marcas || []).length;
    var sub = nMarcas === 0
      ? 'Sin canciones marcadas todavía'
      : nMarcas + (nMarcas === 1 ? ' canción marcada' : ' canciones marcadas');
    if (s.lugar) sub = s.lugar + ' · ' + sub;

    btn.innerHTML =
      '<span class="sesion__fecha">' +
        '<span class="sesion__dia">' + diaMes(s.fecha) + '</span>' +
        '<span class="sesion__anio">' + anio(s.fecha) + '</span>' +
      '</span>' +
      '<span class="sesion__cuerpo">' +
        '<span class="sesion__titulo">' + tituloFecha(s.fecha) + '</span>' +
        '<span class="sesion__sub">' + escapar(sub) + '</span>' +
      '</span>' +
      (s.archivo
        ? '<span class="sesion__audio" aria-label="Con audio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h2l2-6 3 15 3-19 2.5 13 1.5-3H20"/></svg></span>'
        : '<span class="sesion__audio sesion__audio--falta" aria-label="Sin audio">!</span>');

    btn.addEventListener('click', function () {
      window.App.ir('sesion', { datos: { id: s.id } });
    });
    return btn;
  }

  function vacioInicial() {
    return '' +
      '<div class="vacio">' +
      '  <span class="vacio__icono" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h2l2-6 3 15 3-19 2.5 13 1.5-3H20"/></svg></span>' +
      '  <p>Añade la primera sesión del coro para empezar.<br>Toca el botón <strong>+</strong> y sube el audio del ensayo.</p>' +
      '</div>';
  }

  /* ---------- Hoja de alta / edición ---------- */

  function abrirHoja(id) {
    idEditando = id || null;
    archivoPendiente = null;
    var s = id ? window.Sesiones.obtener(id) : null;

    fechaSel = s ? s.fecha : window.Sesiones.hoyISO();
    if (fpk) fpk.destruir();
    fpk = window.FechaPicker.montar(form.querySelector('[data-fecha-picker]'), {
      valor: fechaSel,
      maxHoy: true,
      onCambio: function (iso) { fechaSel = iso; },
    });
    form.lugar.value = s ? s.lugar : '';
    form.notas.value = s ? s.notas : '';
    pintarFilaArchivo(s && s.archivo ? s.archivo.nombre : null);

    formTitulo.textContent = s ? 'Editar sesión' : 'Nueva sesión';
    btnBorrar.hidden = !s;

    hoja.hidden = false;
    void hoja.offsetHeight;
    hoja.classList.add('is-abierta');
  }

  function pintarFilaArchivo(nombre) {
    var fila = form.querySelector('[data-fila="audio"]');
    var txt = fila.querySelector('[data-nombre="audio"]');
    var quitar = fila.querySelector('[data-quitar="audio"]');
    var accion = fila.querySelector('.archivo-fila__accion');
    if (nombre) {
      txt.textContent = nombre;
      fila.classList.add('archivo-fila--con-archivo');
      quitar.hidden = false;
      accion.firstChild.textContent = 'Cambiar';
    } else {
      txt.textContent = 'Audio (MP3, M4A…)';
      fila.classList.remove('archivo-fila--con-archivo');
      quitar.hidden = true;
      accion.firstChild.textContent = 'Añadir';
    }
  }

  function cerrarHoja() {
    hoja.classList.remove('is-abierta');
    var cerrar = function () { hoja.hidden = true; hoja.removeEventListener('transitionend', cerrar); };
    hoja.addEventListener('transitionend', cerrar);
    setTimeout(cerrar, 260);
  }

  function onGuardar(ev) {
    ev.preventDefault();
    var datos = {
      fecha: (fpk && fpk.valor()) || fechaSel || window.Sesiones.hoyISO(),
      lugar: form.lugar.value,
      notas: form.notas.value,
    };

    var sesion = idEditando
      ? window.Sesiones.actualizar(idEditando, datos)
      : window.Sesiones.crear(datos);

    aplicarAudio(sesion.id).then(function () {
      cerrarHoja();
      primeraCarga = false;
      pintarLista();
      if (!idEditando) window.App.ir('sesion', { datos: { id: sesion.id } });
    });
  }

  function aplicarAudio(sesionId) {
    if (!archivoPendiente) return Promise.resolve();
    var clave = sesionId + ':audio';
    if (archivoPendiente === 'quitar') {
      return window.Archivos.borrar(clave).then(function () {
        window.Sesiones.fijarAudio(sesionId, null);
      });
    }
    var f = archivoPendiente;
    return window.Archivos.guardar(clave, f).then(function (meta) {
      window.Sesiones.fijarAudio(sesionId, meta);
    }).catch(function (e) {
      console.error('No se pudo guardar el audio:', e);
      window.UI.aviso('No se pudo guardar el audio.', { tipo: 'error' });
    });
  }

  function onBorrar() {
    if (!idEditando) return;
    var s = window.Sesiones.obtener(idEditando);
    var id = idEditando;
    window.UI.confirmar('¿Eliminar la sesión del ' + tituloFecha(s ? s.fecha : '') +
      '? Se borrará su audio y sus marcas. No se puede deshacer.', {
      ok: 'Eliminar', peligro: true,
    }).then(function (ok) {
      if (!ok) return;
      window.Sesiones.borrar(id);
      cerrarHoja();
      pintarLista();
    });
  }

  /* ---------- Fechas ---------- */

  function _d(iso) { return new Date((iso || '') + 'T00:00:00'); }
  function diaMes(iso) {
    var d = _d(iso); if (isNaN(d)) return '—';
    try { return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
    catch (e) { return iso; }
  }
  function anio(iso) { var d = _d(iso); return isNaN(d) ? '' : String(d.getFullYear()); }
  function tituloFecha(iso) {
    var d = _d(iso); if (isNaN(d)) return 'Sesión';
    try {
      var t = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) { return iso; }
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar, editar: editar };
})();
