/* ============================================================
   barraprogreso.js — Barra de carga fina y cálida.
   window.BarraProgreso.crear(contenedor, { etiqueta })
     -> { fijar(frac), avanzar(frac), estimar(ms), completar(), fallar(cb), quitar() }

   Pensada para tareas que tardan (traducir / generar cómo se pronuncia).
   Si la tarea sabe por dónde va, usa `fijar(0..1)` con el progreso real.
   Si no lo sabe, `estimar(ms)` la hace avanzar sola hasta ~92 % en ese
   tiempo y `completar()` la cierra de golpe. Solo anima width vía transform
   (escala del relleno) para ir fina en el WebView.
   ============================================================ */

window.BarraProgreso = (function () {
  'use strict';

  var reduce = false;
  try {
    reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { reduce = false; }

  function crear(contenedor, opts) {
    opts = opts || {};
    var caja = document.createElement('div');
    caja.className = 'barra-prog';
    caja.innerHTML =
      '<div class="barra-prog__pista">' +
        '<span class="barra-prog__relleno"></span>' +
        '<span class="barra-prog__brillo"></span>' +
      '</div>' +
      '<span class="barra-prog__etq">' + (opts.etiqueta || 'Trabajando…') + '</span>';
    contenedor.appendChild(caja);

    var etq = caja.querySelector('.barra-prog__etq');
    var frac = 0;
    var timer = null;
    var muerta = false;

    function pinta() {
      var f = Math.max(0.02, Math.min(1, frac));
      caja.style.setProperty('--frac', String(f));
    }
    // Arranca un pelín para que se vea "viva" desde el primer momento.
    frac = 0.06; pinta();

    function paraTimer() { if (timer) { clearInterval(timer); timer = null; } }

    function fijar(f) {
      if (muerta) return;
      paraTimer();
      if (f > frac) frac = f;
      pinta();
    }
    function avanzar(delta) { fijar(frac + delta); }

    function estimar(ms) {
      if (muerta || reduce) return;
      paraTimer();
      var t0 = Date.now();
      timer = setInterval(function () {
        var p = (Date.now() - t0) / ms;                 // 0..∞
        // curva que frena: llega a ~0.92 cuando p≈1 y sigue reptando despacio
        var obj = 0.93 * (1 - Math.exp(-1.7 * p));
        if (obj > frac) { frac = obj; pinta(); }
        if (frac >= 0.985) paraTimer();
      }, 160);
    }

    function texto(t) { if (t != null) etq.textContent = t; }

    function completar(t) {
      if (muerta) return;
      paraTimer();
      frac = 1; pinta();
      if (t != null) etq.textContent = t;
      caja.classList.add('barra-prog--ok');
    }

    function fallar(cb) {
      if (muerta) return;
      paraTimer();
      caja.classList.add('barra-prog--mal');
      etq.textContent = 'No ha podido ahora mismo';
      setTimeout(function () { quitar(); if (typeof cb === 'function') cb(); }, 900);
    }

    function quitar() {
      if (muerta) return;
      muerta = true;
      paraTimer();
      caja.classList.add('barra-prog--fuera');
      setTimeout(function () { if (caja.parentNode) caja.parentNode.removeChild(caja); }, 260);
    }

    return {
      nodo: caja,
      fijar: fijar,
      avanzar: avanzar,
      estimar: estimar,
      texto: texto,
      completar: completar,
      fallar: fallar,
      quitar: quitar,
    };
  }

  return { crear: crear };
})();
