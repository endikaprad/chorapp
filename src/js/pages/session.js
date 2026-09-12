/* ============================================================
   Pagina_session — Vista de una sesión del coro.

   Maite escucha el audio del ensayo entero y va marcando dónde
   suena cada canción. Cada marca guarda el minuto de inicio y
   (opcional) el de fin, y crea una ficha en el repertorio con su
   título, compositor, letra y partitura. Desde una marca se entra
   al Modo estudio (study.js), que suena el audio de la sesión
   colocado en ese punto.
   ============================================================ */

window.Pagina_session = (function () {
  'use strict';

  var TIPOS_ARCHIVO = ['letra', 'fonetica', 'partitura'];

  var cont, sesion, obs, vistaSub;
  var tiempoActual = 0, duracionAudio = 0;
  var sono = false;   // el audio del ensayo ha sonado en esta visita
  var hoja, form, marcaEditando = null;
  var inicioSel = 0, finSel = null;         // tiempos elegidos en la hoja
  var ctrlArchivos = {};                    // { letra: ctrlAdjuntos, fonetica, partitura }
  var selCancionId = null;                  // ficha del repertorio elegida, o null
  var selModoNueva = false;                 // true => se está creando una ficha nueva

  function iniciar(contenedor, datos) {
    destruir();
    cont = contenedor;
    var id = datos && datos.id;
    sesion = id ? window.Sesiones.obtener(id) : null;

    if (!sesion) {
      cont.querySelector('[data-modulo="session"]').innerHTML =
        '<p class="vacio">No se encontró esta sesión.</p>';
      return;
    }

    hoja = q('[data-hoja]');
    form = q('[data-form-marca]');
    hoja.setAttribute('data-hoja-sesion', '');
    document.body.appendChild(hoja);

    if (window.Diario) {
      window.Diario.registrar('sesion', {
        sesionId: sesion.id,
        titulo: tituloFecha(sesion.fecha),
        extra: { fecha: sesion.fecha },
      });
    }

    if (window.Selector) window.Selector.mejorarTodos(hoja);

    pintarCabecera();
    montarAudio();
    pintarMarcas();
    montarSensacion();

    q('[data-editar]').addEventListener('click', function () {
      window.Pagina_sessions.editar(sesion.id);
    });
    q('[data-marcar-aqui]').addEventListener('click', function () { abrirHojaMarca(null); });
    form.addEventListener('submit', onGuardarMarca);
    hq('[data-borrar-marca]').addEventListener('click', onBorrarMarca);

    // Ajuste fino de inicio / fin con −5 −1 +1 +5.
    Array.prototype.forEach.call(hoja.querySelectorAll('[data-nudge]'), function (b) {
      b.addEventListener('click', function () {
        var cual = b.getAttribute('data-nudge');
        var d = parseInt(b.getAttribute('data-d'), 10) || 0;
        if (cual === 'inicio') {
          inicioSel = Math.max(0, inicioSel + d);
          if (finSel != null && finSel <= inicioSel) finSel = inicioSel + 1;
        } else {
          finSel = Math.max(inicioSel + 1, (finSel == null ? inicioSel : finSel) + d);
        }
        pintarTiemposHoja();
      });
    });
    // "Poner donde suena ahora".
    hq('[data-ahora="inicio"]').addEventListener('click', function () {
      inicioSel = Math.max(0, Math.round(tiempoActual));
      if (finSel != null && finSel <= inicioSel) finSel = null;
      pintarTiemposHoja();
    });
    hq('[data-ahora="fin"]').addEventListener('click', function () {
      var t = Math.max(0, Math.round(tiempoActual));
      if (t <= inicioSel) { window.UI.aviso('El final tiene que ir después del inicio (' + fmtTiempo(inicioSel) + ').'); return; }
      finSel = t;
      pintarTiemposHoja();
    });
    hq('[data-quitar-fin]').addEventListener('click', function () {
      finSel = null;
      pintarTiemposHoja();
    });

    // Campos de archivo de la hoja: cada uno admite varias páginas
    // (window.Adjuntos).
    TIPOS_ARCHIVO.forEach(function (tipo) {
      var fila = hoja.querySelector('[data-fila="' + tipo + '"]');
      if (fila) ctrlArchivos[tipo] = window.Adjuntos.montar(fila);
    });

    Array.prototype.forEach.call(hoja.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarHoja);
    });

    conectarBuscarLetra();

    // Selector de canción del repertorio
    hq('[data-sel-input]').addEventListener('input', pintarListaSel);
    hq('[data-sel-cambiar]').addEventListener('click', function () { volverABuscar(true); });
    hq('[data-sel-volver]').addEventListener('click', function () { volverABuscar(true); });

    var vista = document.getElementById('vista');
    obs = new MutationObserver(function () {
      if (!document.body.contains(cont)) destruir();
    });
    // RENDIMIENTO — basta con `childList` en #vista, SIN `subtree`: las
    // pantallas son hijas directas de #vista, así que su retirada ya es un
    // cambio en esa lista. Con `subtree` el observador se disparaba en CADA
    // inserción del DOM de la pantalla (el Modo estudio cambia mucho: letra,
    // marcas, listas) y en cada una hacía un `document.body.contains()`.
    obs.observe(vista, { childList: true });
  }

  function destruir() {
    // Al salir del ensayo, si ha sonado algo, un toque de emoji para el diario
    // de sensaciones (solo si hoy no se ha tocado ni preguntado ya).
    if (sono && window.Sensaciones) {
      try { window.Sensaciones.preguntarTrasSesion(); } catch (e) {}
    }
    sono = false;
    if (obs) { obs.disconnect(); obs = null; }
    if (vistaSub) { vistaSub(); vistaSub = null; }
    if (window.CancionActiva) window.CancionActiva.fijarVistaAbierta(false);
    if (hoja && hoja.parentNode === document.body) hoja.remove();
    hoja = form = marcaEditando = null;
    tiempoActual = 0; duracionAudio = 0;
    ctrlArchivos = {};
    selCancionId = null; selModoNueva = false;
  }

  function refrescar() { sesion = window.Sesiones.obtener(sesion.id) || sesion; }

  /* ---------- Cabecera ---------- */

  function pintarCabecera() {
    q('[data-titulo]').textContent = tituloFecha(sesion.fecha);
    var meta = q('[data-meta]');
    if (sesion.lugar) { meta.textContent = sesion.lugar; meta.hidden = false; }
    var notas = q('[data-notas]');
    if (sesion.notas) { notas.textContent = sesion.notas; notas.hidden = false; }
  }

  /* ---------- Audio (window.CancionActiva) ---------- */

  function montarAudio() {
    var seccion = q('[data-player]');
    if (!sesion.archivo) {
      seccion.hidden = true;
      q('[data-sin-audio]').hidden = false;
      q('[data-marcar-aqui]').hidden = true;
      return;
    }
    q('[data-sin-audio]').hidden = true;
    q('[data-marcar-aqui]').hidden = false;

    var barra = q('[data-barra]');
    var tAct = q('[data-t-actual]');
    var tTot = q('[data-t-total]');
    var btnPlay = q('[data-play]');
    var icPlay = btnPlay.querySelector('.ic-play');
    var icPause = btnPlay.querySelector('.ic-pause');
    var velBarra = q('[data-vel-barra]');
    var velValor = q('[data-vel-valor]');

    var repro = window.CancionActiva;
    window.CancionActiva.fijarVistaAbierta(true);

    window.Archivos.url(sesion.id + ':audio').then(function (u) {
      if (!u) { seccion.hidden = true; q('[data-sin-audio]').hidden = false; return; }
      seccion.hidden = false;
      window.CancionActiva.cargar({
        id: sesion.id,
        titulo: tituloFecha(sesion.fecha),
        compositor: sesion.lugar || 'Ensayo del coro',
        abrir: { ruta: 'sesion', datos: { id: sesion.id } },
      }, u);
      window.CancionActiva.fijarVistaAbierta(true);
    });

    // Mini reproductor dentro de la hoja de edición
    var hrPlay = hq('[data-hr-play]');
    var hrIcPlay = hrPlay.querySelector('.ic-play');
    var hrIcPause = hrPlay.querySelector('.ic-pause');
    var hrBarra = hq('[data-hr-barra]');
    var hrT = hq('[data-hr-t]');
    hq('[data-hoja-repro]').hidden = false;
    hrPlay.addEventListener('click', function () { repro.alternar(); });
    Array.prototype.forEach.call(hoja.querySelectorAll('[data-hr-salto]'), function (b) {
      b.addEventListener('click', function () {
        var d = parseInt(b.getAttribute('data-hr-salto'), 10) || 0;
        if (d < 0) repro.retroceder(-d); else repro.adelantar(d);
      });
    });
    hrBarra.addEventListener('input', function () {
      if (duracionAudio) repro.irA((hrBarra.value / 1000) * duracionAudio);
    });

    vistaSub = window.CancionActiva.suscribir(function (s) {
      icPlay.toggleAttribute('hidden', s.reproduciendo);
      icPause.toggleAttribute('hidden', !s.reproduciendo);
      btnPlay.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
      btnPlay.classList.toggle('is-sonando', s.reproduciendo);
      hrIcPlay.toggleAttribute('hidden', s.reproduciendo);
      hrIcPause.toggleAttribute('hidden', !s.reproduciendo);
      hrPlay.setAttribute('aria-label', s.reproduciendo ? 'Pausar' : 'Reproducir');
      tiempoActual = s.actual || 0;
      if (s.reproduciendo) sono = true;
      if (hoja && !hoja.hidden) {
        Array.prototype.forEach.call(hoja.querySelectorAll('[data-pos-live]'), function (el) {
          el.textContent = fmtTiempo(tiempoActual);
        });
        hrT.textContent = fmtTiempo(s.actual) + ' / ' + fmtTiempo(s.total);
        if (s.total && !hrBarra.matches(':active')) {
          hrBarra.value = String(Math.round((s.actual / s.total) * 1000));
        }
      }
      if (s.total && s.total !== duracionAudio) { duracionAudio = s.total; pintarTicks(); }
      tAct.textContent = fmtTiempo(s.actual);
      tTot.textContent = fmtTiempo(s.total);
      if (s.total && !barra.matches(':active')) {
        barra.value = String(Math.round((s.actual / s.total) * 1000));
      }
      velValor.textContent = fmtVel(s.velocidad);
      if (!velBarra.matches(':active')) velBarra.value = String(s.velocidad);
    });

    btnPlay.addEventListener('click', function () { repro.alternar(); });
    q('[data-retro]').addEventListener('click', function () { repro.retroceder(5); });
    q('[data-adelante]').addEventListener('click', function () { repro.adelantar(5); });
    velBarra.addEventListener('input', function () {
      velValor.textContent = fmtVel(repro.fijarVelocidad(parseFloat(velBarra.value)));
    });
    barra.addEventListener('input', function () {
      if (duracionAudio) repro.irA((barra.value / 1000) * duracionAudio);
    });
  }

  function pintarTicks() {
    var caja = q('[data-marcas]');
    if (!caja) return;
    caja.innerHTML = '';
    if (!duracionAudio) return;
    (sesion.marcas || []).forEach(function (m) {
      var pct = Math.min(100, Math.max(0, (m.segundo / duracionAudio) * 100));
      var el = document.createElement('span');
      el.className = 'player__marca player__marca--cancion';
      el.style.left = pct + '%';
      el.title = fmtTiempo(m.segundo) + ' · ' + m.titulo;
      caja.appendChild(el);
    });
  }

  // Insignias de archivos disponibles (letra / partitura) de la ficha vinculada.
  function insigniasArchivos(cancionId) {
    if (!cancionId || !window.Canciones) return '';
    var c = window.Canciones.obtener(cancionId);
    if (!c) return '';
    var arch = c.archivos || {};
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

  /* ---------- Lista de marcas ---------- */

  function pintarMarcas() {
    var caja = q('[data-marcas-lista]');
    var marcas = (sesion.marcas || []).slice().sort(function (a, b) { return a.segundo - b.segundo; });
    if (!marcas.length) {
      caja.innerHTML = '<p class="visor-vacio">Mientras suena el ensayo, pulsa ' +
        '<strong>“Marcar ensayo aquí”</strong> cada vez que empiece una pieza.</p>';
      pintarTicks();
      return;
    }
    caja.innerHTML = '';
    marcas.forEach(function (m) {
      var fila = document.createElement('div');
      fila.className = 'marca';
      fila.setAttribute('role', 'button');
      fila.setAttribute('tabindex', '0');
      fila.setAttribute('aria-label', 'Estudiar «' + m.titulo + '»');

      var rango = m.finSegundo != null
        ? fmtTiempo(m.segundo) + ' – ' + fmtTiempo(m.finSegundo)
        : fmtTiempo(m.segundo) + ' →';
      var dur = m.finSegundo != null
        ? 'dura ' + fmtTiempo(m.finSegundo - m.segundo)
        : 'sin final marcado';

      fila.innerHTML =
        '<div class="marca__cuerpo">' +
          '<span class="marca__tit">' + escapar(m.titulo) + insigniasArchivos(m.cancionId) + '</span>' +
          '<span class="marca__sub">' +
            '<span class="marca__t">' + rango + '</span>' +
            '<span class="marca__meta">' + (m.nota ? escapar(m.nota) + ' · ' : '') + dur + '</span>' +
          '</span>' +
        '</div>' +
        '<button type="button" class="marca__accion" data-editar-marca>Ajustar / editar</button>';

      function irAEstudio() {
        window.App.ir('estudio', { datos: { sesionId: sesion.id, marcaId: m.id } });
      }
      fila.addEventListener('click', irAEstudio);
      fila.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); irAEstudio(); }
      });
      fila.querySelector('[data-editar-marca]').addEventListener('click', function (ev) {
        ev.stopPropagation();
        abrirHojaMarca(m);
      });
      caja.appendChild(fila);
    });
    pintarTicks();
  }

  /* ---------- Hoja de marca (= alta / edición de canción) ---------- */

  function abrirHojaMarca(m) {
    if (!hoja) return;
    if (hoja.parentNode !== document.body) document.body.appendChild(hoja);

    marcaEditando = m || null;

    inicioSel = m ? (m.segundo || 0) : Math.max(0, Math.round(tiempoActual));
    finSel = m ? (m.finSegundo != null ? m.finSegundo : null) : null;

    var cancion = (m && m.cancionId) ? window.Canciones.obtener(m.cancionId) : null;

    hq('[data-marca-titulo]').textContent = m ? 'Editar ensayo' : 'Marcar ensayo';
    form.titulo.value = cancion ? cancion.titulo : (m ? m.titulo : '');
    form.compositor.value = cancion ? (cancion.compositor || '') : '';
    form.nota.value = m ? (m.nota || '') : '';
    form.idioma.value = cancion ? (cancion.idioma || '') : '';
    form.letraTexto.value = cancion ? (cancion.letraTexto || '') : '';
    form.letraFonetica.value = cancion ? (cancion.letraFonetica || '') : '';
    actualizarSubFonetica(cancion);

    TIPOS_ARCHIVO.forEach(function (tipo) {
      if (ctrlArchivos[tipo]) ctrlArchivos[tipo].fijar(window.Adjuntos.lista(cancion, tipo));
    });

    // Estado del selector de canción
    selModoNueva = false;
    hq('[data-sel-input]').value = '';
    if (cancion) {
      selCancionId = cancion.id;
      sincronizarSel('elegida');
    } else {
      selCancionId = null;
      sincronizarSel('buscar');
      pintarListaSel();
    }

    hq('[data-borrar-marca]').hidden = !m;
    pintarTiemposHoja();

    var btnBL = hoja.querySelector('[data-buscar-letra]');
    if (btnBL) {
      btnBL.disabled = false;
      btnBL.classList.remove('is-cargando');
      var blTxt = btnBL.querySelector('[data-buscar-letra-txt]');
      if (blTxt) blTxt.textContent = 'Buscar la letra con IA';
    }
    actualizarBotonBuscarLetra();

    // Mientras la hoja está en pantalla, esconde el mini reproductor flotante.
    if (window.CancionActiva) window.CancionActiva.fijarOculta(true);

    hoja.hidden = false;
    void hoja.offsetHeight;
    hoja.classList.add('is-abierta');
    setTimeout(function () {
      var inp = hq('[data-sel-input]');
      if (inp && !inp.closest('[data-sel-buscar]').hidden) inp.focus();
    }, 60);
  }

  /* ---------- Selector de canción del repertorio ---------- */

  // modo: 'elegida' | 'buscar' | 'nueva'
  function sincronizarSel(modo) {
    var elegida = hq('[data-sel-elegida]');
    var buscar = hq('[data-sel-buscar]');
    var campos = hq('[data-campos-ficha]');
    var volver = hq('[data-sel-volver]');

    elegida.hidden = modo !== 'elegida';
    buscar.hidden = modo === 'elegida';
    campos.hidden = modo !== 'nueva';
    volver.hidden = modo !== 'nueva';

    if (modo === 'elegida') {
      var c = selCancionId && window.Canciones.obtener(selCancionId);
      hq('[data-sel-nom]').textContent = c
        ? (c.titulo + (c.compositor ? ' · ' + c.compositor : ''))
        : 'Canción';
    }
  }

  function pintarListaSel() {
    var caja = hq('[data-sel-lista]');
    var q = hq('[data-sel-input]').value.trim();
    var res = q ? window.Canciones.buscar(q) : window.Canciones.listar();
    caja.innerHTML = '';

    res.slice(0, 8).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'selcancion__op';
      b.innerHTML = '<span class="selcancion__op-tit">' + escapar(c.titulo) + '</span>' +
        (c.compositor ? '<span class="selcancion__op-sub">' + escapar(c.compositor) + '</span>' : '');
      b.addEventListener('click', function () { elegirCancionSel(c.id); });
      caja.appendChild(b);
    });

    if (q) {
      var nueva = document.createElement('button');
      nueva.type = 'button';
      nueva.className = 'selcancion__op selcancion__op--nueva';
      nueva.innerHTML = '<span class="selcancion__op-tit">' +
          '<svg class="selcancion__op-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M12 5v14M5 12h14"/></svg>' +
          'Crear «' + escapar(q) + '»</span>' +
        '<span class="selcancion__op-sub">como canción nueva del repertorio</span>';
      nueva.addEventListener('click', function () { entrarModoNueva(q); });
      caja.appendChild(nueva);
    } else if (!res.length) {
      caja.innerHTML = '<p class="selcancion__vacio">Aún no hay canciones en el repertorio. ' +
        'Escribe un nombre para crear la primera.</p>';
    }
  }

  function elegirCancionSel(id) {
    selCancionId = id;
    selModoNueva = false;
    var c = window.Canciones.obtener(id);
    if (c) {
      form.titulo.value = c.titulo;
      form.compositor.value = c.compositor || '';
      form.idioma.value = c.idioma || '';
      form.letraTexto.value = c.letraTexto || '';
      form.letraFonetica.value = c.letraFonetica || '';
    }
    actualizarSubFonetica(c);
    actualizarBotonBuscarLetra();
    sincronizarSel('elegida');
  }

  function entrarModoNueva(nombre) {
    selCancionId = null;
    selModoNueva = true;
    form.titulo.value = nombre || hq('[data-sel-input]').value.trim();
    form.compositor.value = '';
    form.idioma.value = '';
    form.letraTexto.value = '';
    form.letraFonetica.value = '';
    actualizarSubFonetica(null);
    TIPOS_ARCHIVO.forEach(function (tipo) {
      if (ctrlArchivos[tipo]) ctrlArchivos[tipo].fijar([]);
    });
    actualizarBotonBuscarLetra();
    sincronizarSel('nueva');
    setTimeout(function () { form.titulo.focus(); }, 40);
  }

  function volverABuscar(foco) {
    selCancionId = null;
    selModoNueva = false;
    sincronizarSel('buscar');
    pintarListaSel();
    if (foco) setTimeout(function () { hq('[data-sel-input]').focus(); }, 40);
  }

  function pintarTiemposHoja() {
    hq('[data-inicio-val]').textContent = fmtTiempo(inicioSel);
    hq('[data-fin-val]').textContent = finSel != null
      ? fmtTiempo(finSel) + '  ·  dura ' + fmtTiempo(finSel - inicioSel)
      : '—';
    hq('[data-fin-nudge]').hidden = finSel == null;
    hq('[data-quitar-fin]').hidden = finSel == null;
    Array.prototype.forEach.call(hoja.querySelectorAll('[data-pos-live]'), function (el) {
      el.textContent = fmtTiempo(tiempoActual);
    });
  }

  // Los campos de archivo (letra / fonetica / partitura) los gestiona
  // window.Adjuntos a través de ctrlArchivos[tipo].

  /* ---------- Buscar la letra con IA ---------- */

  // Solo tiene sentido si aún no hay letra escrita y hay un título.
  function actualizarBotonBuscarLetra() {
    var btn = hoja && hoja.querySelector('[data-buscar-letra]');
    if (!btn || !form) return;
    var hayIA = !!(window.IA && window.IA.buscarLetra);
    var hayTexto = !!(form.letraTexto && form.letraTexto.value.trim());
    btn.hidden = !hayIA || hayTexto;
  }

  // "Cómo se pronuncia" se genera desde el Modo estudio (IA). En esta hoja
  // solo se ve al editar una canción del repertorio que ya lo tiene.
  function actualizarSubFonetica(cancion) {
    var caja = hoja && hoja.querySelector('[data-sub-fonetica]');
    if (!caja) return;
    var tiene = !!(cancion && (
      (cancion.letraFonetica && cancion.letraFonetica.trim()) ||
      (cancion.archivos && cancion.archivos.fonetica)
    ));
    caja.hidden = !tiene;
  }

  function conectarBuscarLetra() {
    var btn = hoja.querySelector('[data-buscar-letra]');
    if (!btn) return;
    var txtEl = btn.querySelector('[data-buscar-letra-txt]');

    form.letraTexto.addEventListener('input', actualizarBotonBuscarLetra);

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      var titulo = form.titulo.value.trim();
      if (!titulo) {
        form.titulo.classList.add('campo--error');
        form.titulo.focus();
        window.UI.aviso('Escribe primero el título de la canción.');
        return;
      }
      var idiomaSel = form.idioma;
      var idioma = (form.idioma.value && idiomaSel.options[idiomaSel.selectedIndex])
        ? idiomaSel.options[idiomaSel.selectedIndex].text : '';

      btn.disabled = true;
      btn.classList.add('is-cargando');
      txtEl.textContent = 'Buscando la letra…';

      window.IA.buscarLetra(titulo, {
        compositor: form.compositor.value.trim(),
        idioma: idioma,
      }).then(function (letra) {
        form.letraTexto.value = letra;
        actualizarBotonBuscarLetra();
        window.UI.aviso('Letra encontrada. Revísala por si acaso antes de guardar.', { tipo: 'ok' });
      }).catch(function (e) {
        var msg = (e && e.message === 'no encontrada')
          ? 'No he encontrado la letra de esa canción. Prueba a afinar el título o el compositor, o pégala a mano.'
          : 'No se ha podido buscar la letra ahora mismo. Prueba dentro de un rato.';
        window.UI.aviso(msg, { tipo: 'error' });
      }).then(function () {
        btn.disabled = false;
        btn.classList.remove('is-cargando');
        txtEl.textContent = 'Buscar la letra con IA';
      });
    });
  }

  function onGuardarMarca(ev) {
    ev.preventDefault();

    var selInput = hq('[data-sel-input]');
    // No ha elegido ni está creando: si escribió un nombre, se crea nueva.
    if (!selCancionId && !selModoNueva) {
      var escrito = selInput.value.trim();
      if (!escrito) { selInput.classList.add('campo--error'); selInput.focus(); return; }
      entrarModoNueva(escrito);
    }
    selInput.classList.remove('campo--error');

    var cancion, titulo;
    if (selCancionId) {
      cancion = window.Canciones.obtener(selCancionId);
      if (!cancion) { window.UI.aviso('Esa canción ya no existe.'); return; }
      titulo = cancion.titulo;
    } else {
      titulo = form.titulo.value.trim();
      if (!titulo) {
        form.titulo.focus();
        form.titulo.classList.add('campo--error');
        return;
      }
      form.titulo.classList.remove('campo--error');
      cancion = window.Canciones.crear({
        titulo: titulo,
        compositor: form.compositor.value,
        idioma: form.idioma.value,
        letraTexto: form.letraTexto.value,
        letraFonetica: form.letraFonetica.value,
      });
    }
    var cancionId = cancion.id;

    var listo = selCancionId ? Promise.resolve() : aplicarArchivos(cancionId);
    listo.then(function () {
      var cambios = {
        cancionId: cancionId,
        titulo: titulo,
        segundo: inicioSel,
        finSegundo: finSel,
        nota: form.nota.value,
      };
      if (marcaEditando) {
        window.Sesiones.actualizarMarca(sesion.id, marcaEditando.id, cambios);
      } else {
        window.Sesiones.agregarMarca(sesion.id, cambios);
      }
      cerrarHoja();
      refrescar();
      pintarMarcas();
    });
  }

  function aplicarArchivos(cancionId) {
    var cancion = window.Canciones.obtener(cancionId);
    var tareas = TIPOS_ARCHIVO.map(function (tipo) {
      if (!ctrlArchivos[tipo]) return Promise.resolve();
      return window.Adjuntos.aplicar(
        cancionId, tipo, ctrlArchivos[tipo].pendiente(),
        window.Adjuntos.lista(cancion, tipo));
    });
    return Promise.all(tareas).catch(function (e) {
      console.error('No se pudo guardar un archivo:', e);
      window.UI.aviso('No se pudo guardar uno de los archivos.', { tipo: 'error' });
    });
  }

  function onBorrarMarca() {
    if (!marcaEditando) return;
    var m = marcaEditando;
    window.UI.confirmar('¿Quitar «' + m.titulo + '» de esta sesión?', { ok: 'Quitar', peligro: true })
      .then(function (ok) {
        if (!ok) return;
        window.Sesiones.borrarMarca(sesion.id, m.id);
        // La ficha del repertorio se queda: puede tener letra/partitura útiles.
        cerrarHoja();
        refrescar();
        pintarMarcas();
      });
  }

  function cerrarHoja() {
    if (window.CancionActiva) window.CancionActiva.fijarOculta(false);
    hoja.classList.remove('is-abierta');
    var cerrar = function () { hoja.hidden = true; hoja.removeEventListener('transitionend', cerrar); };
    hoja.addEventListener('transitionend', cerrar);
    setTimeout(cerrar, 260);
  }

  /* ---------- Diario de sensaciones ----------
     Un botón al pie para dejar cómo te has sentido en el ensayo. Si ya
     hay una de hoy, la enseña y deja cambiarla. */

  function montarSensacion() {
    var btn = q('[data-sensa]');
    if (!btn || !window.Sensaciones) return;

    function pintar() {
      var ya = window.Sensaciones.deHoy();
      var emoji = btn.querySelector('[data-sensa-emoji]');
      var tit = btn.querySelector('[data-sensa-tit]');
      var sub = btn.querySelector('[data-sensa-sub]');
      if (ya) {
        var o = window.Sensaciones.opcion(ya.emo);
        emoji.textContent = o ? o.emoji : '🎭';
        tit.textContent = 'Hoy: ' + (o ? o.etq.toLowerCase() : '—');
        sub.textContent = 'Toca para cambiarlo';
        btn.classList.add('is-hecha');
      } else {
        emoji.textContent = '🎭';
        tit.textContent = '¿Qué tal el ensayo?';
        sub.textContent = 'Un toque y se guarda en tu resumen';
        btn.classList.remove('is-hecha');
      }
    }

    btn.addEventListener('click', function () {
      window.Sensaciones.abrirHoja({ motivo: 'manual', onListo: pintar });
    });
    pintar();
    btn.hidden = false;
  }

  /* ---------- Utilidades ---------- */

  function q(sel) { return cont.querySelector(sel); }
  // La hoja se mueve al <body> (position:fixed): sus nodos se consultan aparte.
  function hq(sel) { return hoja.querySelector(sel); }

  function _d(iso) { return new Date((iso || '') + 'T00:00:00'); }
  function tituloFecha(iso) {
    var d = _d(iso); if (isNaN(d)) return 'Sesión';
    try {
      var t = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) { return iso; }
  }

  function fmtTiempo(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var h = Math.floor(seg / 3600);
    var m = Math.floor((seg % 3600) / 60);
    var s = seg % 60;
    if (h) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtVel(v) {
    v = Math.round((v || 1) * 100) / 100;
    return (v % 1 === 0 ? v : v.toFixed(2).replace(/0$/, '')) + '×';
  }
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
