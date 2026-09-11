/* ============================================================
   adjuntos.js — window.Adjuntos

   Convierte una fila de archivo (.archivo-fila con [data-fila],
   [data-input], [data-quitar]) en un campo que admite VARIOS
   archivos (partitura de varias páginas, letra fotografiada…).

   El modelo en la canción (cancion.archivos[tipo]) pasa a ser:
       null | metaLegacy(objeto) | Array<meta>
   Cada `meta` lleva su `clave` real en IndexedDB (window.Archivos).
   Las canciones antiguas (un objeto suelto, clave "<id>:<tipo>")
   se leen sin migrar nada en disco.

   Uso en un formulario:
       var ctrl = Adjuntos.montar(filaEl);
       ctrl.fijar(Adjuntos.lista(cancion, 'partitura'));   // al abrir
       ...
       Adjuntos.aplicar(cancionId, 'partitura', ctrl.pendiente(),
                        Adjuntos.lista(cancion, 'partitura'));

   Depende de: window.Archivos, window.Canciones.
   ============================================================ */

window.Adjuntos = (function () {
  'use strict';

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function nuevoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Devuelve SIEMPRE un array de metadatos normalizados (con `clave`).
  function lista(cancion, tipo) {
    if (!cancion || !cancion.archivos) return [];
    var v = cancion.archivos[tipo];
    if (!v) return [];
    var arr = Array.isArray(v) ? v : [v];
    return arr.filter(Boolean).map(function (m) {
      return {
        id: m.id || null,
        nombre: m.nombre || tipo,
        mime: m.mime || '',
        tamano: m.tamano || 0,
        guardado: m.guardado || 0,
        // Legacy: un único archivo guardado en "<id>:<tipo>".
        clave: m.clave || (cancion.id + ':' + tipo),
      };
    });
  }

  /* ---------- Campo de formulario con varios archivos ---------- */

  function montar(fila) {
    if (!fila || fila._adjCtrl) return fila && fila._adjCtrl;

    var tipo = fila.getAttribute('data-fila');
    var input = fila.querySelector('[data-input]');
    var spanTxt = fila.querySelector('[data-nombre]');
    var btnQuitarViejo = fila.querySelector('[data-quitar]');
    var baseTxt = spanTxt ? spanTxt.textContent : 'Añadir archivo';

    if (input) input.multiple = true;
    if (btnQuitarViejo) btnQuitarViejo.hidden = true;
    fila.classList.add('archivo-fila--multi');

    // Envuelve la fila original (icono + texto + botón "Añadir") para poder
    // apilar encima la lista de páginas.
    var anadirEl = document.createElement('div');
    anadirEl.className = 'adj-anadir';
    while (fila.firstChild) anadirEl.appendChild(fila.firstChild);
    fila.appendChild(anadirEl);

    // Contenedor para los chips de archivos, antes de la fila "Añadir".
    var listaEl = document.createElement('div');
    listaEl.className = 'adj-lista';
    listaEl.setAttribute('data-adj-lista', '');
    fila.insertBefore(listaEl, anadirEl);

    var metas = [];          // archivos ya guardados
    var quitar = [];          // claves marcadas para borrar
    var anadir = [];          // File[] pendientes de guardar

    function visibles() {
      return metas.filter(function (m) { return quitar.indexOf(m.clave) === -1; });
    }

    function render() {
      var html = '';
      visibles().forEach(function (m) {
        html += '<div class="adj-chip">' +
          '<span class="adj-chip__nom">' + escapar(m.nombre) + '</span>' +
          '<button type="button" class="adj-chip__x" data-adj-quitar="' + escapar(m.clave) + '" ' +
            'aria-label="Quitar ' + escapar(m.nombre) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button></div>';
      });
      anadir.forEach(function (f, i) {
        html += '<div class="adj-chip adj-chip--nuevo">' +
          '<span class="adj-chip__nom">' + escapar(f.name) + '</span>' +
          '<button type="button" class="adj-chip__x" data-adj-quitar-pend="' + i + '" ' +
            'aria-label="Quitar ' + escapar(f.name) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button></div>';
      });
      listaEl.innerHTML = html;
      listaEl.hidden = !html;

      var total = visibles().length + anadir.length;
      if (spanTxt) {
        spanTxt.textContent = total
          ? 'Añadir otra página' + (total > 1 ? ' (' + total + ')' : '')
          : baseTxt;
      }
      var accion = fila.querySelector('.archivo-fila__accion');
      if (accion && accion.firstChild) accion.firstChild.textContent = total ? 'Añadir más' : 'Añadir';
      fila.classList.toggle('archivo-fila--con-archivo', total > 0);
    }

    listaEl.addEventListener('click', function (ev) {
      var q = ev.target.closest('[data-adj-quitar]');
      if (q) {
        var clave = q.getAttribute('data-adj-quitar');
        if (quitar.indexOf(clave) === -1) quitar.push(clave);
        render();
        return;
      }
      var p = ev.target.closest('[data-adj-quitar-pend]');
      if (p) {
        anadir.splice(parseInt(p.getAttribute('data-adj-quitar-pend'), 10), 1);
        render();
      }
    });

    if (input) {
      input.addEventListener('change', function () {
        Array.prototype.forEach.call(input.files || [], function (f) { anadir.push(f); });
        input.value = '';
        render();
      });
    }

    var ctrl = {
      tipo: tipo,
      fijar: function (metasNuevas) {
        metas = (metasNuevas || []).slice();
        quitar = [];
        anadir = [];
        render();
      },
      pendiente: function () {
        return { anadir: anadir.slice(), quitar: quitar.slice() };
      },
      // ¿hay cambios sin guardar? (por si acaso hiciera falta)
      hayCambios: function () { return anadir.length > 0 || quitar.length > 0; },
    };
    fila._adjCtrl = ctrl;
    render();
    return ctrl;
  }

  /* ---------- Persistencia ---------- */

  // pendiente = { anadir: File[], quitar: string[] (claves) }
  // metasActuales = Adjuntos.lista(cancion, tipo) tomado ANTES de tocar nada.
  function aplicar(cancionId, tipo, pendiente, metasActuales) {
    pendiente = pendiente || { anadir: [], quitar: [] };
    var quitar = pendiente.quitar || [];
    var anadir = pendiente.anadir || [];
    if (!quitar.length && !anadir.length) return Promise.resolve(null);

    var finales = (metasActuales || []).filter(function (m) {
      return quitar.indexOf(m.clave) === -1;
    });

    var tareas = [];

    quitar.forEach(function (clave) {
      tareas.push(window.Archivos.borrar(clave).catch(function () {}));
    });

    anadir.forEach(function (f) {
      var clave = cancionId + ':' + tipo + ':' + nuevoId();
      tareas.push(window.Archivos.guardar(clave, f).then(function (meta) {
        meta.clave = clave;
        meta.id = clave.split(':').pop();
        finales.push(meta);
      }));
    });

    return Promise.all(tareas).then(function () {
      window.Canciones.fijarArchivo(cancionId, tipo, finales.length ? finales : null);
      return finales;
    }).catch(function (e) {
      console.error('No se pudieron guardar los adjuntos (' + tipo + '):', e);
      if (window.UI) window.UI.aviso('No se pudo guardar uno de los archivos.', { tipo: 'error' });
    });
  }

  return {
    lista: lista,
    montar: montar,
    aplicar: aplicar,
  };
})();
