/* ============================================================
   app.js — Arranque y navegación de ChorApp.
   Router mínimo: carga pages/<archivo>.html dentro de #vista.
   Sin framework. Los <script> se cargan como clásicos.
   ============================================================ */

(function () {
  'use strict';

  var NOMBRE_USUARIA = 'Maite';

  // Definición de cada pantalla.
  //   archivo : nombre en pages/
  //   titulo  : texto de la cabecera
  //   raiz    : true si es una pestaña del bottom nav (sin botón atrás)
  var PANTALLAS = {
    inicio:      { archivo: 'home',       titulo: 'Hola, ' + NOMBRE_USUARIA + ' <span class="emoji" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>', raiz: true },
    canciones:   { archivo: 'songs',      titulo: 'Canciones',   raiz: true },
    practica:    { archivo: 'practice',   titulo: 'Práctica',    raiz: true },
    grabaciones: { archivo: 'recordings', titulo: 'Grabaciones', raiz: true },
    estudio:     { archivo: 'study',      titulo: 'Modo estudio', raiz: false },
  };

  var ORDEN_TABS = ['inicio', 'canciones', 'practica', 'grabaciones'];

  var vista = document.getElementById('vista');
  var header = document.getElementById('app-header');
  var titulo = document.getElementById('header-titulo');
  var btnAtras = document.getElementById('btn-atras');
  var nav = document.getElementById('bottom-nav');
  var indicador = document.getElementById('nav-indicador');
  var itemsNav = Array.prototype.slice.call(nav.querySelectorAll('.nav-item'));

  var reduceMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var historial = [];      // pila de rutas para el botón atrás
  var rutaActual = null;
  var cargando = false;

  /* --------------------------------------------------------
     Navegación
     -------------------------------------------------------- */

  // ruta: clave de PANTALLAS.  opts.datos: se pasa al módulo de la página.
  async function ir(ruta, opts) {
    opts = opts || {};
    var pantalla = PANTALLAS[ruta];
    if (!pantalla || cargando) return;
    // Se puede volver a entrar en el modo estudio con otra canción;
    // el resto de rutas no se recargan si ya son la actual.
    if (ruta === rutaActual && ruta !== 'estudio') return;
    cargando = true;

    var esCambioDeTab = pantalla.raiz && (rutaActual === null || PANTALLAS[rutaActual].raiz);

    try {
      var html = await fetch('pages/' + pantalla.archivo + '.html').then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      });

      var claseAnim = esCambioDeTab ? 'fundido' : '';
      vista.innerHTML =
        '<div class="pantalla ' + claseAnim + '" data-pantalla="' + pantalla.archivo + '">' + html + '</div>';
      var contenedor = vista.firstElementChild;

      // Historial: las pestañas raíz reinician la pila; el resto apila.
      if (pantalla.raiz) historial = [ruta];
      else if (rutaActual) historial.push(ruta);

      rutaActual = ruta;
      actualizarCabecera(pantalla);
      actualizarNav(ruta);
      window.scrollTo(0, 0);

      // Módulo opcional de la página: js/pages/<archivo>.js expone window.Pagina_<archivo>
      var modulo = window['Pagina_' + pantalla.archivo];
      if (modulo && typeof modulo.iniciar === 'function') {
        modulo.iniciar(contenedor, opts.datos);
      }
    } catch (e) {
      vista.innerHTML = '<div class="pantalla vacio">No se pudo cargar esta sección.</div>';
      console.error('Navegación fallida:', e);
    } finally {
      cargando = false;
    }
  }

  function atras() {
    if (historial.length <= 1) return;
    historial.pop();
    var destino = historial[historial.length - 1];
    historial.pop(); // ir() volverá a apilarlo
    rutaActual = null;
    ir(destino);
  }

  /* --------------------------------------------------------
     Cabecera y bottom nav
     -------------------------------------------------------- */

  function actualizarCabecera(pantalla) {
    titulo.innerHTML = pantalla.titulo;
    btnAtras.hidden = pantalla.raiz;
  }

  function actualizarNav(ruta) {
    var indice = ORDEN_TABS.indexOf(ruta);
    itemsNav.forEach(function (item, i) {
      var activa = i === indice;
      item.classList.toggle('is-activa', activa);
      if (activa) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (indice >= 0) {
      indicador.hidden = false;
      indicador.style.transform = 'translateX(' + indice * 100 + '%)';
    } else {
      indicador.hidden = true; // pantallas fuera del nav (modo estudio)
    }
  }

  // Borde de la cabecera solo al hacer scroll.
  function alHacerScroll() {
    header.classList.toggle('con-borde', window.scrollY > 4);
  }

  /* --------------------------------------------------------
     Eventos
     -------------------------------------------------------- */

  nav.addEventListener('click', function (ev) {
    var item = ev.target.closest('.nav-item');
    if (item) ir(item.getAttribute('data-ruta'));
  });

  btnAtras.addEventListener('click', atras);
  window.addEventListener('scroll', alHacerScroll, { passive: true });

  // API mínima para que las páginas naveguen (p. ej. abrir una canción).
  window.App = { ir: ir, atras: atras };

  /* --------------------------------------------------------
     Arranque
     -------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    ir('inicio');
  });
})();
