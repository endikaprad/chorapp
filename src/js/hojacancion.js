/* ============================================================
   HojaCancion — hoja única de alta / edición de canción.

   Es EL MISMO formulario en todas partes: se abre desde el
   Repertorio (FAB de Canciones), desde el (+) de Sesiones
   ("Canción") y desde el Modo estudio ("Editar canción").
   El marcado vive aquí, en un solo sitio: si hay que cambiar
   un campo, se cambia una vez.

   Uso:
     window.HojaCancion.abrir({
       id: null,            // null => alta (canción suelta con su MP3)
                            // 'id' => edición de una canción existente
       foco: null,          // 'letra' | 'fonetica' | 'partitura' (opcional):
                            //   desplaza la hoja hasta esa fila al abrir
       alGuardar: fn,       // opcional. En edición recibe { cancion }.
                            //   En alta el módulo abre solo el Modo estudio.
       alBorrar: fn,        // opcional. Recibe el id borrado.
     });

   Depende de: window.Canciones, window.Sesiones, window.Archivos,
   window.Selector, window.UI, window.App, window.Frases.
   ============================================================ */

window.HojaCancion = (function () {
  'use strict';

  var TIPOS_ARCHIVO = ['letra', 'fonetica', 'partitura'];

  var ETIQUETA_BASE = {
    letra: 'Letra (PDF, imagen o texto)',
    fonetica: 'Cómo se pronuncia (PDF o imagen)',
    partitura: 'Partitura (imagen o PDF)',
  };

  var hoja, form, formTitulo, btnBorrar, btnGuardar, subtitulo;
  var construida = false;

  var idEditando = null;
  var etiquetasActuales = [];
  var ctrlArchivos = {};         // { letra: ctrlAdjuntos, fonetica: …, partitura: … }
  var audioPendiente = null;     // File del MP3 obligatorio (solo al crear)
  var cbGuardar = null;
  var cbBorrar = null;

  /* ---------- Marcado (única fuente de la verdad) ---------- */

  function plantilla() {
    return '' +
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<form class="hoja__panel" data-form novalidate>' +
        '<div class="hoja__asa" aria-hidden="true"></div>' +
        '<h2 class="hoja__titulo" data-form-titulo>Nueva canción</h2>' +
        '<p class="campo__ayuda" data-subtitulo hidden></p>' +

        '<label class="campo">' +
          '<span class="campo__label">Título</span>' +
          '<input name="titulo" type="text" required maxlength="120" autocomplete="off" />' +
        '</label>' +

        '<label class="campo">' +
          '<span class="campo__label">Compositor <span class="campo__opcional">(opcional)</span></span>' +
          '<input name="compositor" type="text" maxlength="120" autocomplete="off" />' +
        '</label>' +

        '<label class="campo">' +
          '<span class="campo__label">Idioma <span class="campo__opcional">(opcional)</span></span>' +
          '<select name="idioma" class="campo__select">' +
            '<option value="">Sin especificar</option>' +
            '<option value="es">Español</option>' +
            '<option value="eu">Euskera</option>' +
            '<option value="la">Latín</option>' +
            '<option value="de">Alemán</option>' +
            '<option value="en">Inglés</option>' +
            '<option value="fr">Francés</option>' +
            '<option value="it">Italiano</option>' +
            '<option value="pt">Portugués</option>' +
            '<option value="ca">Catalán</option>' +
            '<option value="otro">Otro</option>' +
          '</select>' +
        '</label>' +

        '<div class="campo">' +
          '<span class="campo__label">Etiquetas <span class="campo__opcional">(opcional)</span></span>' +
          '<p class="campo__ayuda">Para agrupar canciones: «Navidad», «Misa», «Certamen»…</p>' +
          '<div class="etiq-editor" data-etiq-editor>' +
            '<span class="etiq-editor__chips" data-etiq-chips></span>' +
            '<input type="text" class="etiq-editor__input" data-etiq-input maxlength="24" ' +
                   'autocomplete="off" autocapitalize="words" placeholder="Escribe y pulsa Intro" />' +
          '</div>' +
          '<div class="etiq-editor__sug" data-etiq-sug hidden></div>' +
        '</div>' +

        // Audio: obligatorio al crear (canción suelta). Oculto al editar.
        '<div class="campo" data-bloque-audio hidden>' +
          '<span class="campo__label">Audio (MP3)</span>' +
          '<div class="archivo-fila" data-fila-audio>' +
            '<svg class="archivo-fila__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
            '<span class="archivo-fila__txt" data-nombre-audio>Obligatorio (MP3, M4A…)</span>' +
            '<label class="archivo-fila__accion">Añadir' +
              '<input type="file" accept="audio/*,.mp3,.mpeg,.mpga,.m4a,.aac,.opus,.ogg,.wav" data-input-audio hidden />' +
            '</label>' +
            '<button type="button" class="archivo-fila__quitar" data-quitar-audio hidden>Quitar</button>' +
          '</div>' +
        '</div>' +

        '<fieldset class="campo">' +
          '<legend class="campo__label">Estado</legend>' +
          '<div class="segmentado" role="radiogroup">' +
            '<label><input type="radio" name="estado" value="pendiente" checked /><span>Pendiente</span></label>' +
            '<label><input type="radio" name="estado" value="progreso" /><span>En progreso</span></label>' +
            '<label><input type="radio" name="estado" value="aprendida" /><span>Aprendida</span></label>' +
          '</div>' +
        '</fieldset>' +

        '<label class="campo">' +
          '<span class="campo__label">Notas <span class="campo__opcional">(opcional)</span></span>' +
          '<textarea name="notas" rows="3" maxlength="2000" placeholder="Lo que quieras recordar de esta canción"></textarea>' +
        '</label>' +

        '<div class="campo campo--grupo">' +
          '<span class="campo__label">La letra <span class="campo__opcional">(opcional)</span></span>' +
          '<p class="campo__ayuda">Rellena solo lo que quieras: texto, o un PDF/imagen. Aparecerá en el modo estudio, donde también se puede traducir sola.</p>' +

          '<label class="campo__sub">' +
            '<span class="campo__sub-lbl">Letra original</span>' +
            '<textarea name="letraTexto" rows="4" maxlength="8000" placeholder="Pega o escribe aquí la letra tal cual se canta"></textarea>' +
          '</label>' +
          '<button type="button" class="hoja__buscar-letra" data-buscar-letra hidden>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>' +
            '<span data-buscar-letra-txt>Buscar la letra con IA</span>' +
          '</button>' +
          filaArchivo('letra', 'application/pdf,.pdf,image/*,text/plain,.txt', docIcono()) +

          // "Cómo se pronuncia" no se escribe a mano al crear la canción: se
          // genera desde el Modo estudio (botón "Generar cómo se pronuncia",
          // IA). Igual que la traducción, aquí solo aparece al editar una
          // canción que ya la tiene, para poder retocarla.
          '<div data-sub-fonetica hidden>' +
            '<label class="campo__sub">' +
              '<span class="campo__sub-lbl">Cómo se pronuncia</span>' +
              '<textarea name="letraFonetica" rows="4" maxlength="8000" placeholder="Cómo suena, línea a línea igual que la letra original"></textarea>' +
            '</label>' +
            filaArchivo('fonetica', 'application/pdf,.pdf,image/*,text/plain,.txt', docIcono()) +
          '</div>' +

          '<label class="campo__sub" data-sub-traduccion hidden>' +
            '<span class="campo__sub-lbl">Qué significa <span class="campo__opcional">(traducción)</span></span>' +
            '<textarea name="letraTraduccion" rows="4" maxlength="8000" placeholder="La traducción al español"></textarea>' +
          '</label>' +
        '</div>' +

        '<div class="campo">' +
          '<span class="campo__label">Partitura <span class="campo__opcional">(opcional)</span></span>' +
          filaArchivo('partitura', 'image/*,application/pdf,.pdf',
            '<svg class="archivo-fila__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="9" r="1.5"/></svg>') +
        '</div>' +

        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--fantasma" data-borrar hidden>Eliminar</button>' +
          '<button type="button" class="btn btn--texto" data-cerrar>Cancelar</button>' +
          '<button type="submit" class="btn btn--primario" data-guardar>Guardar</button>' +
        '</div>' +
      '</form>';
  }

  function docIcono() {
    return '<svg class="archivo-fila__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3v5h5"/><path d="M6 3h9l5 5v13H6z"/><path d="M9 13h6M9 17h6"/></svg>';
  }

  function filaArchivo(tipo, accept, icono) {
    return '' +
      '<div class="archivo-fila" data-fila="' + tipo + '">' +
        icono +
        '<span class="archivo-fila__txt" data-nombre="' + tipo + '">' + ETIQUETA_BASE[tipo] + '</span>' +
        '<label class="archivo-fila__accion">Añadir' +
          '<input type="file" accept="' + accept + '" data-input="' + tipo + '" hidden />' +
        '</label>' +
        '<button type="button" class="archivo-fila__quitar" data-quitar="' + tipo + '" hidden>Quitar</button>' +
      '</div>';
  }

  /* ---------- Construcción (una sola vez) ---------- */

  function construir() {
    if (construida) return;
    construida = true;

    hoja = document.createElement('div');
    hoja.className = 'hoja';
    hoja.hidden = true;
    hoja.setAttribute('data-hoja-cancion', '');
    hoja.innerHTML = plantilla();
    document.body.appendChild(hoja);

    form = hoja.querySelector('[data-form]');
    formTitulo = hoja.querySelector('[data-form-titulo]');
    subtitulo = hoja.querySelector('[data-subtitulo]');
    btnBorrar = hoja.querySelector('[data-borrar]');
    btnGuardar = hoja.querySelector('[data-guardar]');

    if (window.Selector) window.Selector.mejorarTodos(hoja);

    form.addEventListener('submit', onGuardar);
    btnBorrar.addEventListener('click', onBorrar);
    Array.prototype.forEach.call(hoja.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrar);
    });

    // Campos de archivo (letra / fonetica / partitura): admiten varias
    // páginas cada uno. Toda la gestión vive en window.Adjuntos.
    TIPOS_ARCHIVO.forEach(function (tipo) {
      var fila = form.querySelector('[data-fila="' + tipo + '"]');
      if (fila) ctrlArchivos[tipo] = window.Adjuntos.montar(fila);
    });

    // Audio obligatorio (solo visible al crear)
    var inpAudio = form.querySelector('[data-input-audio]');
    inpAudio.addEventListener('change', function () {
      var f = inpAudio.files && inpAudio.files[0];
      if (f) { audioPendiente = f; pintarFilaAudio(f.name); }
      inpAudio.value = '';
    });
    form.querySelector('[data-quitar-audio]').addEventListener('click', function () {
      audioPendiente = null;
      pintarFilaAudio(null);
    });

    conectarEditorEtiquetas();
    conectarBuscarLetra();
  }

  /* ---------- Buscar la letra con IA ---------- */

  // El botón solo tiene sentido si no hay letra escrita todavía. Se
  // muestra/oculta según el textarea y necesita al menos un título.
  function actualizarBotonBuscarLetra() {
    var btn = form.querySelector('[data-buscar-letra]');
    if (!btn) return;
    var hayIA = !!(window.IA && window.IA.buscarLetra);
    var hayTexto = !!form.letraTexto.value.trim();
    btn.hidden = !hayIA || hayTexto;
  }

  function conectarBuscarLetra() {
    var btn = form.querySelector('[data-buscar-letra]');
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
      var idioma = idiomaSel.options[idiomaSel.selectedIndex]
        ? idiomaSel.options[idiomaSel.selectedIndex].text : '';
      if (!form.idioma.value) idioma = '';

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

  /* ---------- Editor de etiquetas ---------- */

  function conectarEditorEtiquetas() {
    var inp = form.querySelector('[data-etiq-input]');
    if (!inp) return;

    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ',') {
        ev.preventDefault();
        añadirEtiqueta(inp.value);
        inp.value = '';
        renderSugerenciasEtiq();
      } else if (ev.key === 'Backspace' && !inp.value && etiquetasActuales.length) {
        etiquetasActuales.pop();
        renderChipsEtiq();
        renderSugerenciasEtiq();
      }
    });
    inp.addEventListener('blur', function () {
      if (inp.value.trim()) { añadirEtiqueta(inp.value); inp.value = ''; renderSugerenciasEtiq(); }
    });
    inp.addEventListener('input', renderSugerenciasEtiq);

    form.querySelector('[data-etiq-chips]').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-quitar-etiq]');
      if (!b) return;
      var t = b.getAttribute('data-quitar-etiq');
      etiquetasActuales = etiquetasActuales.filter(function (e) { return e !== t; });
      renderChipsEtiq();
      renderSugerenciasEtiq();
    });

    form.querySelector('[data-etiq-sug]').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-add-etiq]');
      if (!b) return;
      añadirEtiqueta(b.getAttribute('data-add-etiq'));
      renderSugerenciasEtiq();
    });
  }

  function normaliza(t) {
    t = String(t == null ? '' : t).toLowerCase().trim();
    return t.normalize ? t.normalize('NFD').replace(/[̀-ͯ]/g, '') : t;
  }

  function añadirEtiqueta(txt) {
    var t = String(txt || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!t) return;
    var k = normaliza(t);
    if (etiquetasActuales.some(function (e) { return normaliza(e) === k; })) return;
    if (etiquetasActuales.length >= 12) return;
    etiquetasActuales.push(t);
    renderChipsEtiq();
  }

  function renderChipsEtiq() {
    var cont = form.querySelector('[data-etiq-chips]');
    if (!cont) return;
    cont.innerHTML = etiquetasActuales.map(function (t) {
      return '<span class="etiq-chip">' + escapar(t) +
        '<button type="button" data-quitar-etiq="' + escapar(t) + '" aria-label="Quitar ' + escapar(t) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button></span>';
    }).join('');
  }

  function renderSugerenciasEtiq() {
    var cont = form.querySelector('[data-etiq-sug]');
    if (!cont || !window.Canciones || !window.Canciones.etiquetasTodas) return;
    var q = normaliza((form.querySelector('[data-etiq-input]') || {}).value || '');
    var usadas = {};
    etiquetasActuales.forEach(function (e) { usadas[normaliza(e)] = true; });
    var libres = window.Canciones.etiquetasTodas().filter(function (e) {
      var k = normaliza(e);
      return !usadas[k] && (!q || k.indexOf(q) !== -1);
    }).slice(0, 8);
    if (!libres.length) { cont.hidden = true; cont.innerHTML = ''; return; }
    cont.innerHTML = libres.map(function (e) {
      return '<button type="button" class="etiq-sug" data-add-etiq="' + escapar(e) + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
        escapar(e) + '</button>';
    }).join('');
    cont.hidden = false;
  }

  /* ---------- Filas de archivo ---------- */

  function pintarFilaAudio(nombre) {
    var fila = form.querySelector('[data-fila-audio]');
    if (!fila) return;
    var txt = fila.querySelector('[data-nombre-audio]');
    var quitar = fila.querySelector('[data-quitar-audio]');
    var accion = fila.querySelector('.archivo-fila__accion');
    if (nombre) {
      txt.textContent = nombre;
      fila.classList.add('archivo-fila--con-archivo');
      fila.classList.remove('campo--error');
      quitar.hidden = false;
      accion.firstChild.textContent = 'Cambiar';
    } else {
      txt.textContent = 'Obligatorio (MP3, M4A…)';
      fila.classList.remove('archivo-fila--con-archivo');
      quitar.hidden = true;
      accion.firstChild.textContent = 'Añadir';
    }
  }

  // Los campos de archivo (letra / fonetica / partitura) los pinta
  // window.Adjuntos a través de su controlador (ctrlArchivos[tipo]).

  /* ---------- Abrir / cerrar ---------- */

  function abrir(opts) {
    opts = opts || {};
    construir();

    idEditando = opts.id || null;
    cbGuardar = typeof opts.alGuardar === 'function' ? opts.alGuardar : null;
    cbBorrar = typeof opts.alBorrar === 'function' ? opts.alBorrar : null;
    audioPendiente = null;

    var c = idEditando ? window.Canciones.obtener(idEditando) : null;

    // El audio (canción suelta) solo se pide al crear una canción nueva.
    var bloqueAudio = form.querySelector('[data-bloque-audio]');
    bloqueAudio.hidden = !!c;
    bloqueAudio.querySelector('[data-fila-audio]').classList.remove('campo--error');
    pintarFilaAudio(null);

    form.titulo.value = c ? c.titulo : '';
    form.titulo.classList.remove('campo--error');
    form.compositor.value = c ? (c.compositor || '') : '';
    form.notas.value = c ? (c.notas || '') : '';
    form.idioma.value = c ? (c.idioma || '') : '';
    form.letraTexto.value = c ? (c.letraTexto || '') : '';
    form.letraFonetica.value = c ? (c.letraFonetica || '') : '';
    form.letraTraduccion.value = c ? (c.letraTraduccion || '') : '';

    etiquetasActuales = (c && Array.isArray(c.etiquetas)) ? c.etiquetas.slice() : [];
    var etiqInp = form.querySelector('[data-etiq-input]');
    if (etiqInp) etiqInp.value = '';
    renderChipsEtiq();
    renderSugerenciasEtiq();

    // La traducción solo se rellena desde el modo estudio; aquí solo se ve
    // (para retocarla a mano) si la canción ya tiene una.
    var subTrad = form.querySelector('[data-sub-traduccion]');
    if (subTrad) subTrad.hidden = !(c && c.letraTraduccion && c.letraTraduccion.trim());

    // Igual que la traducción: "cómo se pronuncia" solo se ve al editar una
    // canción que ya la tiene (texto o archivo), o si se abre enfocando esa
    // fila. Nunca al crear.
    var subFon = form.querySelector('[data-sub-fonetica]');
    if (subFon) {
      var tieneFon = !!(c && (
        (c.letraFonetica && c.letraFonetica.trim()) ||
        (c.archivos && c.archivos.fonetica)
      ));
      subFon.hidden = !(tieneFon || opts.foco === 'fonetica');
    }

    var btnBL = form.querySelector('[data-buscar-letra]');
    if (btnBL) {
      btnBL.disabled = false;
      btnBL.classList.remove('is-cargando');
      var blTxt = btnBL.querySelector('[data-buscar-letra-txt]');
      if (blTxt) blTxt.textContent = 'Buscar la letra con IA';
    }
    actualizarBotonBuscarLetra();

    var estado = c ? c.estado : 'pendiente';
    Array.prototype.forEach.call(form.estado, function (r) { r.checked = r.value === estado; });

    TIPOS_ARCHIVO.forEach(function (tipo) {
      if (ctrlArchivos[tipo]) ctrlArchivos[tipo].fijar(window.Adjuntos.lista(c, tipo));
    });

    formTitulo.textContent = c ? 'Editar canción' : 'Nueva canción';
    if (c) {
      subtitulo.hidden = true;
      subtitulo.textContent = '';
      btnGuardar.textContent = 'Guardar';
    } else {
      subtitulo.hidden = false;
      subtitulo.textContent = 'Al guardarla se abre en el modo estudio.';
      btnGuardar.textContent = 'Guardar y estudiar';
    }
    btnBorrar.hidden = !c;

    if (window.Selector) window.Selector.mejorarTodos(hoja);

    // Mientras la hoja está en pantalla, esconde el mini reproductor flotante.
    if (window.CancionActiva) window.CancionActiva.fijarOculta(true);

    hoja.hidden = false;
    void hoja.offsetHeight;
    hoja.classList.add('is-abierta');

    var foco = opts.foco;
    var filaFoco = foco ? form.querySelector('[data-fila="' + foco + '"]') : null;
    if (filaFoco) {
      setTimeout(function () {
        filaFoco.scrollIntoView({ block: 'center', behavior: 'smooth' });
        filaFoco.classList.add('archivo-fila--foco');
        setTimeout(function () { filaFoco.classList.remove('archivo-fila--foco'); }, 1800);
      }, 260);
    } else {
      setTimeout(function () { form.titulo.focus(); }, 60);
    }
  }

  function cerrar() {
    if (!hoja) return;
    if (window.CancionActiva) window.CancionActiva.fijarOculta(false);
    hoja.classList.remove('is-abierta');
    var fin = function () { hoja.hidden = true; hoja.removeEventListener('transitionend', fin); };
    hoja.addEventListener('transitionend', fin);
    setTimeout(fin, 260);
  }

  /* ---------- Guardar ---------- */

  function onGuardar(ev) {
    ev.preventDefault();

    var etiqInp = form.querySelector('[data-etiq-input]');
    if (etiqInp && etiqInp.value.trim()) { añadirEtiqueta(etiqInp.value); etiqInp.value = ''; }

    var datos = {
      titulo: form.titulo.value,
      compositor: form.compositor.value,
      estado: (form.querySelector('input[name="estado"]:checked') || {}).value || 'pendiente',
      notas: form.notas.value,
      idioma: form.idioma.value,
      etiquetas: etiquetasActuales.slice(),
      letraTexto: form.letraTexto.value,
      letraFonetica: form.letraFonetica.value,
      letraTraduccion: form.letraTraduccion.value,
    };

    if (!datos.titulo.trim()) {
      form.titulo.focus();
      form.titulo.classList.add('campo--error');
      return;
    }
    form.titulo.classList.remove('campo--error');

    // Alta: una canción nueva es una "canción suelta" y necesita su MP3.
    if (!idEditando) {
      if (!audioPendiente) {
        var filaAudio = form.querySelector('[data-fila-audio]');
        if (filaAudio) filaAudio.classList.add('campo--error');
        window.UI.aviso('Añade el MP3 de la canción para poder estudiarla.');
        return;
      }
      var extra = {};
      TIPOS_ARCHIVO.forEach(function (t) {
        var pend = ctrlArchivos[t] ? ctrlArchivos[t].pendiente() : null;
        if (pend && pend.anadir.length) extra[t] = pend.anadir;
      });
      window.Sesiones.crearSuelta(datos, audioPendiente, extra).then(function (res) {
        cerrar();
        if (datos.estado === 'aprendida') celebrar();
        if (cbGuardar) { try { cbGuardar(res); } catch (e) {} }
        window.App.ir('estudio', { datos: { sesionId: res.sesion.id, marcaId: res.marca.id } });
      }).catch(function (e) {
        console.error('No se pudo crear la canción:', e);
        window.UI.aviso('No se pudo guardar el audio.', { tipo: 'error' });
      });
      return;
    }

    var estadoPrevio = (window.Canciones.obtener(idEditando) || {}).estado;
    var cancion = window.Canciones.actualizar(idEditando, datos);

    aplicarArchivos(cancion.id).then(function () {
      cerrar();
      if (datos.estado === 'aprendida' && estadoPrevio !== 'aprendida') celebrar();
      if (cbGuardar) { try { cbGuardar({ cancion: cancion }); } catch (e) {} }
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

  /* ---------- Borrar ---------- */

  function onBorrar() {
    if (!idEditando) return;
    var c = window.Canciones.obtener(idEditando);
    var nombre = c ? c.titulo : 'esta canción';
    var id = idEditando;
    var nEnsayos = (window.Sesiones && window.Sesiones.contarMarcasDeCancion)
      ? window.Sesiones.contarMarcasDeCancion(id) : 0;
    var msg = '¿Eliminar «' + nombre + '»? No se puede deshacer.';
    if (nEnsayos > 0) {
      msg += nEnsayos === 1
        ? ' También se quitará su marca en 1 ensayo (con sus notas y trozos).'
        : ' También se quitarán sus marcas en ' + nEnsayos + ' ensayos (con sus notas y trozos).';
    }
    window.UI.confirmar(msg, { ok: 'Eliminar', peligro: true }).then(function (ok) {
      if (!ok) return;
      if (window.Sesiones && window.Sesiones.borrarSueltaDeCancion) {
        window.Sesiones.borrarSueltaDeCancion(id);
      }
      window.Canciones.borrar(id);
      cerrar();
      if (cbBorrar) { try { cbBorrar(id); return; } catch (e) {} }
      // La canción borrada puede haberse abierto desde el Modo estudio o
      // desde su ficha: esas pantallas quedan muertas. Volvemos a Sesiones.
      if (window.App && window.App.ir) window.App.ir('sesiones');
    });
  }

  /* ---------- Utilidades ---------- */

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
    try { if (window.Vibra) window.Vibra.logro(); } catch (e) {}
    var quita = function () { if (el.parentNode) el.remove(); };

    if (!frase) { setTimeout(quita, 1000); return; }

    var t = setTimeout(quita, 4200);
    var cerrado = false;
    el.addEventListener('click', function () {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(t);
      el.classList.add('celebra--saliendo');
      el.addEventListener('animationend', quita, { once: true });
      setTimeout(quita, 400);
    });
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { abrir: abrir, cerrar: cerrar };
})();
