/* ============================================================
   visorpdf.js — Visor de PDF propio de ChorApp.

   El WebView de Android no sabe mostrar PDF: ni <object>/<iframe>
   los pinta, ni abre enlaces blob: en una app externa. Así que
   renderizamos el PDF nosotros con PDF.js (empaquetado en
   src/vendor/pdfjs/, sin CDN) sobre <canvas>.

   window.VisorPDF
     .render(contenedor, blob, { paginas })  -> Promise
         Pinta las páginas del PDF como <canvas> dentro de
         `contenedor` (preview en línea). `paginas` limita cuántas
         (por defecto, todas).
     .abrir(blob, titulo)                     -> Promise
         Abre el PDF a pantalla completa dentro de la app. Se
         desplaza en vertical por las páginas; se amplía con doble
         toque, pellizco o rueda (igual que el visor de imágenes).
         No depende de apps externas ni de plugins nativos.
   ============================================================ */

window.VisorPDF = (function () {
  'use strict';

  var RUTA_WORKER = 'vendor/pdfjs/pdf.worker.min.js';
  var libLista = null;   // Promise que resuelve a pdfjsLib

  /* Carga PDF.js una sola vez (perezoso: solo si hay un PDF que ver). */
  function cargarLib() {
    if (libLista) return libLista;
    libLista = new Promise(function (resolve, reject) {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      var s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) return reject(new Error('pdf.js no expuso pdfjsLib'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = RUTA_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('No se pudo cargar pdf.js')); };
      document.head.appendChild(s);
    });
    return libLista;
  }

  /* Abre el documento a partir de un Blob. Con tope de tiempo: si el
     motor de PDF.js se queda colgado (worker que no arranca, PDF roto),
     preferimos fallar y enseñar un aviso a dejar un "Cargando…" eterno. */
  function abrirDoc(pdfjsLib, blob) {
    return blob.arrayBuffer().then(function (buf) {
      var tarea = pdfjsLib.getDocument({ data: buf });
      var limite = new Promise(function (_, rej) {
        setTimeout(function () {
          try { tarea.destroy(); } catch (e) {}
          rej(new Error('El PDF tardó demasiado en abrirse'));
        }, 12000);
      });
      return Promise.race([tarea.promise, limite]);
    });
  }

  /* Renderiza una página en un <canvas> nuevo y lo devuelve. */
  function pintarPagina(pagina, anchoCaja, factor) {
    var base = pagina.getViewport({ scale: 1 });
    var escala = (anchoCaja / base.width) * (factor || 1);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var vp = pagina.getViewport({ scale: escala * dpr });

    var canvas = document.createElement('canvas');
    canvas.className = 'visor-pdf__pagina';
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';

    return pagina.render({
      canvasContext: canvas.getContext('2d'),
      viewport: vp,
    }).promise.then(function () { return canvas; });
  }

  /* ---------- Preview en línea ---------- */

  function render(contenedor, blob, opciones) {
    opciones = opciones || {};
    contenedor.innerHTML = '<p class="visor-pdf__cargando">Cargando PDF…</p>';

    return cargarLib()
      .then(function (pdfjsLib) { return abrirDoc(pdfjsLib, blob); })
      .then(function (pdf) {
        var total = opciones.paginas ? Math.min(opciones.paginas, pdf.numPages) : pdf.numPages;
        var ancho = contenedor.clientWidth || 320;
        contenedor.innerHTML = '';

        var cadena = Promise.resolve();
        for (var i = 1; i <= total; i++) {
          (function (num) {
            cadena = cadena
              .then(function () { return pdf.getPage(num); })
              .then(function (p) { return pintarPagina(p, ancho, 1); })
              .then(function (canvas) { contenedor.appendChild(canvas); });
          })(i);
        }
        return cadena.then(function () {
          if (pdf.numPages > total) {
            var mas = document.createElement('p');
            mas.className = 'visor-pdf__resto';
            mas.textContent = 'y ' + (pdf.numPages - total) + ' página(s) más — pulsa para verlas todas';
            contenedor.appendChild(mas);
          }
        });
      })
      .catch(function (e) {
        contenedor.innerHTML = '<p class="visor-pdf__error">No se pudo mostrar el PDF.</p>';
        throw e;
      });
  }

  /* ---------- Visor a pantalla completa ---------- */

  var overlay = null;
  var zoomFull = null;

  function abrir(blob, titulo) {
    cerrar();
    overlay = document.createElement('div');
    overlay.className = 'visor-pdf-full';
    overlay.innerHTML =
      '<div class="visor-pdf-full__barra">' +
        '<span class="visor-pdf-full__titulo"></span>' +
        '<button type="button" class="visor-pdf-full__cerrar" data-cerrar aria-label="Cerrar">✕</button>' +
      '</div>' +
      '<div class="visor-pdf-full__paginas">' +
        '<div class="visor-pdf-full__lienzo"><p class="visor-pdf__cargando">Cargando PDF…</p></div>' +
      '</div>';
    overlay.querySelector('.visor-pdf-full__titulo').textContent = titulo || 'Documento';
    document.body.appendChild(overlay);
    document.body.classList.add('sin-scroll');

    var scroll = overlay.querySelector('.visor-pdf-full__paginas');
    var lienzo = overlay.querySelector('.visor-pdf-full__lienzo');

    overlay.querySelector('[data-cerrar]').addEventListener('click', cerrar);
    document.addEventListener('keydown', cerrarConEsc);

    return cargarLib()
      .then(function (pdfjsLib) { return abrirDoc(pdfjsLib, blob); })
      .then(function (pdf) {
        // Renderizamos cada página una sola vez, a buena resolución.
        // El zoom es solo `transform` sobre el lienzo: no se vuelve a
        // pintar nada, así que no salta el scroll ni "se desordena".
        var ancho = scroll.clientWidth || 320;
        lienzo.innerHTML = '';
        var cadena = Promise.resolve();
        for (var i = 1; i <= pdf.numPages; i++) {
          (function (num) {
            cadena = cadena
              .then(function () { return pdf.getPage(num); })
              .then(function (p) { return pintarPagina(p, ancho, 1); })
              .then(function (canvas) { lienzo.appendChild(canvas); });
          })(i);
        }
        return cadena.then(function () {
          zoomFull = crearZoom(scroll, lienzo);
        });
      })
      .catch(function (e) {
        lienzo.innerHTML = '<p class="visor-pdf__error">No se pudo mostrar el PDF.</p>';
        throw e;
      });
  }

  function cerrarConEsc(e) {
    if (e.key === 'Escape') cerrar();
  }

  function cerrar() {
    document.removeEventListener('keydown', cerrarConEsc);
    if (zoomFull) { zoomFull.destruir(); zoomFull = null; }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.classList.remove('sin-scroll');
    overlay = null;
  }

  /* Zoom del visor a pantalla completa.
     - Escala 1: el contenedor hace scroll vertical normal por las páginas.
     - Doble toque / pellizco / rueda: amplía (solo `transform`, sin
       repintar). Con la vista ampliada, se arrastra con un dedo para
       moverse y el scroll nativo queda desactivado hasta volver a 1×. */
  function crearZoom(scroll, lienzo) {
    var MIN = 1, MAX = 4;
    var esc = 1, x = 0, y = 0;
    var puntos = new Map();
    var pinchIni = 0, escIni = 1, arrastreIni = null;

    function aplicar() {
      lienzo.style.transformOrigin = '50% 0';
      lienzo.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + esc + ')';
      scroll.style.overflowY = esc > MIN ? 'hidden' : 'auto';
      scroll.style.touchAction = esc > MIN ? 'none' : 'pan-y';
    }
    function limitar() {
      if (esc <= MIN) { esc = MIN; x = 0; y = 0; return; }
      var margenX = (lienzo.clientWidth * esc - scroll.clientWidth) / 2;
      margenX = Math.max(0, margenX);
      x = Math.min(margenX, Math.max(-margenX, x));
      var margenY = lienzo.clientHeight * esc - scroll.clientHeight;
      margenY = Math.max(0, margenY);
      y = Math.min(0, Math.max(-margenY, y));
    }
    function suave(on) { lienzo.style.transition = on ? 'transform 160ms var(--curva)' : 'none'; }

    function onWheel(e) {
      // Rueda normal = desplazarse por las páginas. Solo hacemos zoom
      // con Ctrl+rueda (gesto de pellizco del trackpad) o si ya está
      // ampliado (entonces no hay scroll nativo que hacer).
      if (!e.ctrlKey && esc <= MIN) return;
      e.preventDefault();
      suave(false);
      esc = Math.min(MAX, Math.max(MIN, esc * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      limitar(); aplicar();
    }
    function onDblclick() {
      suave(true);
      if (esc > MIN) { esc = MIN; x = 0; y = 0; } else { esc = 2.4; }
      limitar(); aplicar();
    }
    function onDown(e) {
      puntos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (puntos.size === 2) {
        var p = Array.from(puntos.values());
        pinchIni = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        escIni = esc;
      } else if (esc > MIN) {
        lienzo.setPointerCapture(e.pointerId);
        suave(false);
        arrastreIni = { x: e.clientX - x, y: e.clientY - y };
      }
    }
    function onMove(e) {
      if (!puntos.has(e.pointerId)) return;
      puntos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var p = Array.from(puntos.values());
      if (puntos.size === 2 && pinchIni) {
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        esc = Math.min(MAX, Math.max(MIN, escIni * (d / pinchIni)));
        limitar(); aplicar();
      } else if (puntos.size === 1 && arrastreIni) {
        x = e.clientX - arrastreIni.x;
        y = e.clientY - arrastreIni.y;
        limitar(); aplicar();
      }
    }
    function onUp(e) {
      puntos.delete(e.pointerId);
      if (puntos.size < 2) pinchIni = 0;
      if (puntos.size === 0) {
        arrastreIni = null;
        if (esc <= MIN + 0.02) { suave(true); esc = MIN; x = 0; y = 0; aplicar(); }
      }
    }

    scroll.addEventListener('wheel', onWheel, { passive: false });
    lienzo.addEventListener('dblclick', onDblclick);
    lienzo.addEventListener('pointerdown', onDown);
    lienzo.addEventListener('pointermove', onMove);
    lienzo.addEventListener('pointerup', onUp);
    lienzo.addEventListener('pointercancel', onUp);
    aplicar();

    return {
      destruir: function () {
        scroll.removeEventListener('wheel', onWheel);
        lienzo.removeEventListener('dblclick', onDblclick);
        lienzo.removeEventListener('pointerdown', onDown);
        lienzo.removeEventListener('pointermove', onMove);
        lienzo.removeEventListener('pointerup', onUp);
        lienzo.removeEventListener('pointercancel', onUp);
      },
    };
  }

  return { render: render, abrir: abrir, cerrar: cerrar };
})();
