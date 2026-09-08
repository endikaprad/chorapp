/* ============================================================
   Selector — desplegable propio para <select>
   El navegador no deja dar estilo a la lista nativa (se ve
   gris/oscura y fuera de la paleta). Este módulo envuelve un
   <select> real con un control a medida: botón + panel de
   opciones con los colores de Bihotsak, botones grandes y
   accesible con teclado. El <select> sigue siendo la fuente de
   la verdad (value, disabled, options), así que el resto del
   código no cambia.
   ============================================================ */

window.Selector = (function () {
  'use strict';

  var abierto = null; // instancia con el panel desplegado

  function mejorar(sel) {
    if (!sel || sel.dataset.selectorListo) return;
    sel.dataset.selectorListo = '1';

    var envoltura = document.createElement('div');
    envoltura.className = 'selector';

    var control = document.createElement('button');
    control.type = 'button';
    control.className = 'selector__control';
    control.setAttribute('aria-haspopup', 'listbox');
    control.setAttribute('aria-expanded', 'false');
    var valorId = 'sel-val-' + Math.random().toString(36).slice(2);
    control.innerHTML =
      '<span class="selector__valor" id="' + valorId + '"></span>' +
      '<svg class="selector__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 9l6 6 6-6"/></svg>';

    var panel = document.createElement('ul');
    panel.className = 'selector__panel';
    panel.setAttribute('role', 'listbox');
    panel.hidden = true;

    // Nombre accesible: reutiliza la etiqueta visible si el <select> la tiene.
    var etiqueta = sel.getAttribute('aria-labelledby');
    if (etiqueta) control.setAttribute('aria-labelledby', etiqueta + ' ' + valorId);
    else if (sel.getAttribute('aria-label')) control.setAttribute('aria-label', sel.getAttribute('aria-label'));

    sel.parentNode.insertBefore(envoltura, sel);
    envoltura.appendChild(control);
    envoltura.appendChild(panel);
    envoltura.appendChild(sel); // el select queda dentro, oculto visualmente

    var inst = { sel: sel, envoltura: envoltura, control: control, panel: panel };

    control.addEventListener('click', function (e) {
      // El <select> puede vivir dentro de un <label>; sin esto, el label
      // reenviaría el clic a su control asociado y lo abriría/cerraría dos veces.
      e.stopPropagation();
      if (sel.disabled) return;
      inst.abierto ? cerrar(inst) : abrir(inst);
    });
    control.addEventListener('keydown', function (e) {
      if (sel.disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!inst.abierto) { abrir(inst); return; }
      }
      if (e.key === 'ArrowDown') mover(inst, 1);
      else if (e.key === 'ArrowUp') mover(inst, -1);
    });

    // Sincroniza si cambian las opciones o el estado disabled.
    var obs = new MutationObserver(function () { sincronizar(inst); });
    obs.observe(sel, { childList: true, attributes: true, attributeFilter: ['disabled'] });
    sel.addEventListener('change', function () { pintarValor(inst); });

    // Rellenar un formulario de edición hace `sel.value = '...'` a mano, y eso
    // NO dispara 'change'. Interceptamos value/selectedIndex para repintar.
    var proto = Object.getPrototypeOf(sel);
    ['value', 'selectedIndex'].forEach(function (prop) {
      var d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set || !d.get) return;
      Object.defineProperty(sel, prop, {
        get: function () { return d.get.call(this); },
        set: function (v) { d.set.call(this, v); pintarValor(inst); },
        configurable: true,
      });
    });

    sincronizar(inst);
  }

  function sincronizar(inst) {
    var sel = inst.sel;
    inst.envoltura.classList.toggle('is-disabled', sel.disabled);
    inst.control.disabled = sel.disabled;

    inst.panel.innerHTML = '';
    Array.prototype.forEach.call(sel.options, function (op, i) {
      var li = document.createElement('li');
      li.className = 'selector__opcion';
      li.setAttribute('role', 'option');
      li.textContent = op.textContent;
      li.dataset.idx = i;
      li.addEventListener('click', function (e) {
        e.stopPropagation();
        // El <select> vive dentro de un <label>: sin esto, el label reenvía
        // el clic a su control (nuestro botón) y el panel se vuelve a abrir.
        e.preventDefault();
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        cerrar(inst);
        inst.control.focus();
      });
      inst.panel.appendChild(li);
    });
    pintarValor(inst);
  }

  function pintarValor(inst) {
    var op = inst.sel.options[inst.sel.selectedIndex];
    inst.envoltura.querySelector('.selector__valor').textContent = op ? op.textContent : '';
    Array.prototype.forEach.call(inst.panel.children, function (li) {
      var on = +li.dataset.idx === inst.sel.selectedIndex;
      li.classList.toggle('is-activa', on);
      li.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function mover(inst, paso) {
    var n = inst.sel.options.length;
    if (!n) return;
    var i = (inst.sel.selectedIndex + paso + n) % n;
    inst.sel.selectedIndex = i;
    inst.sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function abrir(inst) {
    if (abierto && abierto !== inst) cerrar(abierto);
    abierto = inst;
    inst.abierto = true;
    inst.panel.hidden = false;
    inst.envoltura.classList.add('is-abierto');
    inst.control.setAttribute('aria-expanded', 'true');
    var activa = inst.panel.querySelector('.is-activa');
    if (activa) activa.scrollIntoView({ block: 'nearest' });
  }

  function cerrar(inst) {
    inst.abierto = false;
    inst.panel.hidden = true;
    inst.envoltura.classList.remove('is-abierto');
    inst.control.setAttribute('aria-expanded', 'false');
    if (abierto === inst) abierto = null;
  }

  document.addEventListener('click', function (e) {
    if (abierto && !abierto.envoltura.contains(e.target)) cerrar(abierto);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && abierto) { var i = abierto; cerrar(i); i.control.focus(); }
  });

  // Envuelve de golpe todos los <select> de un contenedor (o del documento).
  function mejorarTodos(raiz) {
    var ambito = raiz || document;
    Array.prototype.forEach.call(
      ambito.querySelectorAll('select.campo__select, select[data-selector]'),
      mejorar
    );
  }

  return { mejorar: mejorar, mejorarTodos: mejorarTodos };
})();
