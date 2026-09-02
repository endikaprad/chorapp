/* ============================================================
   ui.js — Avisos y confirmaciones propias de ChorApp.
   Sustituye a alert() / confirm() del navegador, que rompen
   la estética cálida de la app.

     window.UI.aviso('Guardado')                      -> toast breve
     window.UI.aviso('No se pudo guardar', { tipo: 'error' })
     window.UI.confirmar('¿Eliminar «Ave María»?')     -> Promise<boolean>
       .then(function (ok) { if (ok) ... });

   Se carga como script clásico y expone window.UI.
   ============================================================ */

(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------
     Toast: mensaje efímero sobre la barra de navegación
     -------------------------------------------------------- */

  var pilaToasts = null;

  function contenedorToasts() {
    if (!pilaToasts) {
      pilaToasts = document.createElement('div');
      pilaToasts.className = 'ui-toasts';
      pilaToasts.setAttribute('role', 'status');
      pilaToasts.setAttribute('aria-live', 'polite');
      document.body.appendChild(pilaToasts);
    }
    return pilaToasts;
  }

  // tipo: 'info' (por defecto) | 'ok' | 'error'
  function aviso(mensaje, opts) {
    opts = opts || {};
    var tipo = opts.tipo || 'info';
    var duracion = opts.duracion || (tipo === 'error' ? 4200 : 2800);

    var el = document.createElement('div');
    el.className = 'ui-toast ui-toast--' + tipo;
    el.innerHTML =
      '<span class="ui-toast__ic" aria-hidden="true">' + icono(tipo) + '</span>' +
      '<span class="ui-toast__txt"></span>';
    el.querySelector('.ui-toast__txt').textContent = mensaje;
    contenedorToasts().appendChild(el);

    // Fuerza reflow para que la transición de entrada se dispare.
    void el.offsetWidth;
    el.classList.add('is-visible');

    var cerrado = false;
    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      el.classList.remove('is-visible');
      var quita = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      if (reduce) quita();
      else {
        el.addEventListener('transitionend', quita, { once: true });
        setTimeout(quita, 400);
      }
    }

    var t = setTimeout(cerrar, duracion);
    el.addEventListener('click', function () { clearTimeout(t); cerrar(); });
    return cerrar;
  }

  /* --------------------------------------------------------
     Confirmación: diálogo modal centrado
     -------------------------------------------------------- */

  // opts: { titulo, ok, cancelar, peligro (bool) }
  function confirmar(mensaje, opts) {
    opts = opts || {};
    var textoOk = opts.ok || 'Aceptar';
    var textoCancelar = opts.cancelar || 'Cancelar';
    var peligro = !!opts.peligro;

    return new Promise(function (resolve) {
      var capa = document.createElement('div');
      capa.className = 'ui-modal';
      capa.innerHTML =
        '<div class="ui-modal__fondo"></div>' +
        '<div class="ui-modal__panel" role="dialog" aria-modal="true">' +
          (opts.titulo ? '<h2 class="ui-modal__titulo"></h2>' : '') +
          '<p class="ui-modal__texto"></p>' +
          '<div class="ui-modal__acciones">' +
            '<button type="button" class="btn btn--texto" data-no></button>' +
            '<button type="button" class="btn ' +
              (peligro ? 'btn--peligro' : 'btn--primario') + '" data-si></button>' +
          '</div>' +
        '</div>';

      if (opts.titulo) capa.querySelector('.ui-modal__titulo').textContent = opts.titulo;
      capa.querySelector('.ui-modal__texto').textContent = mensaje;
      var btnSi = capa.querySelector('[data-si]');
      var btnNo = capa.querySelector('[data-no]');
      btnSi.textContent = textoOk;
      btnNo.textContent = textoCancelar;

      var panel = capa.querySelector('.ui-modal__panel');
      var dialogoAbiertoAntes = document.activeElement;
      document.body.appendChild(capa);
      void capa.offsetWidth;
      capa.classList.add('is-abierta');
      btnSi.focus();

      function terminar(valor) {
        capa.classList.remove('is-abierta');
        document.removeEventListener('keydown', onTecla, true);
        var quita = function () {
          if (capa.parentNode) capa.parentNode.removeChild(capa);
          if (dialogoAbiertoAntes && dialogoAbiertoAntes.focus) dialogoAbiertoAntes.focus();
        };
        if (reduce) quita();
        else {
          panel.addEventListener('transitionend', quita, { once: true });
          setTimeout(quita, 400);
        }
        resolve(valor);
      }

      function onTecla(ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); terminar(false); }
        else if (ev.key === 'Enter') { ev.preventDefault(); terminar(true); }
        else if (ev.key === 'Tab') {
          // Ciclo de foco entre los dos botones.
          ev.preventDefault();
          (document.activeElement === btnSi ? btnNo : btnSi).focus();
        }
      }

      btnSi.addEventListener('click', function () { terminar(true); });
      btnNo.addEventListener('click', function () { terminar(false); });
      capa.querySelector('.ui-modal__fondo').addEventListener('click', function () { terminar(false); });
      document.addEventListener('keydown', onTecla, true);
    });
  }

  /* --------------------------------------------------------
     Iconos (trazo, a juego con el resto de la app)
     -------------------------------------------------------- */

  function icono(tipo) {
    var svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    if (tipo === 'ok') return svg + '<path d="M20 6 9 17l-5-5"/></svg>';
    if (tipo === 'error') return svg + '<path d="M12 8v5"/><path d="M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>';
    return svg + '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.5"/></svg>';
  }

  window.UI = { aviso: aviso, confirmar: confirmar };
})();
