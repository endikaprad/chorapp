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
    inicio:      { archivo: 'home',       titulo: 'Kaixo, Ama <span class="emoji" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>', raiz: true },
    sesiones:    { archivo: 'sessions',   titulo: 'Sesiones',    raiz: true },
    practica:    { archivo: 'practice',   titulo: 'Práctica',    raiz: true },
    grabaciones: { archivo: 'recordings', titulo: 'Grabaciones', raiz: true },
    sesion:      { archivo: 'session',    titulo: 'Sesión',       raiz: false },
    canciones:   { archivo: 'songs',      titulo: 'Repertorio',   raiz: false },
    cancion:     { archivo: 'song',       titulo: 'Canción',      raiz: false },
    estudio:     { archivo: 'study',      titulo: 'Modo estudio', raiz: false },
  };

  var ORDEN_TABS = ['inicio', 'sesiones', 'practica', 'grabaciones'];

  // Rutas que se pueden re-abrir con datos distintos sin bloquearse.
  var REENTRANTES = ['estudio', 'sesion', 'cancion'];

  var vista = document.getElementById('vista');
  var header = document.getElementById('app-header');
  var titulo = document.getElementById('header-titulo');
  var btnAtras = document.getElementById('btn-atras');
  var btnTema = document.getElementById('btn-tema');
  var nav = document.getElementById('bottom-nav');
  var indicador = document.getElementById('nav-indicador');
  var itemsNav = Array.prototype.slice.call(nav.querySelectorAll('.nav-item'));

  var reduceMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var historial = [];      // pila de rutas para el botón atrás
  var rutaActual = null;
  var cargando = false;
  var enPopstate = false;  // true mientras servimos un "atrás" del navegador / Android

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
    if (ruta === rutaActual && REENTRANTES.indexOf(ruta) === -1) return;
    cargando = true;

    var esPrimeraNav = rutaActual === null;
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
      // Cada entrada guarda su ruta Y sus datos, para poder volver a una
      // pantalla de detalle (sesión, canción, estudio) sin perder el id.
      // Durante un "atrás" (enPopstate) la pila la gestiona retroceder().
      if (!enPopstate) {
        var entrada = { ruta: ruta, datos: opts.datos || null };
        var cima = historial[historial.length - 1];
        var repetida = cima && cima.ruta === ruta &&
          JSON.stringify(cima.datos) === JSON.stringify(entrada.datos);
        if (pantalla.raiz) historial = [entrada];
        else if (rutaActual && !repetida) historial.push(entrada);
      }

      rutaActual = ruta;
      actualizarCabecera(pantalla);
      actualizarNav(ruta);
      window.scrollTo(0, 0);

      // Espejar la profundidad de `historial` en el historial del navegador,
      // para que el gesto "atrás" de Android (y el del navegador) vuelva
      // dentro de la app en vez de cerrarla.
      if (!enPopstate) {
        var estado = { ruta: ruta };
        if (esPrimeraNav) window.history.replaceState(estado, '');
        else window.history.pushState(estado, '');
      }

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

  // El botón "atrás" de la cabecera delega en el historial del navegador,
  // igual que el gesto de Android: todo pasa por el listener de `popstate`.
  function atras() {
    if (historial.length <= 1) return;
    window.history.back();
  }

  // Sirve un "atrás" real: navega a la pantalla anterior de la pila sin
  // volver a tocar el historial del navegador.
  function retroceder() {
    if (historial.length <= 1) return;
    enPopstate = true;
    historial.pop();                             // quita la pantalla actual
    var destino = historial[historial.length - 1]; // la anterior se queda en la pila
    rutaActual = null;
    var p = ir(destino.ruta, { datos: destino.datos });
    (p && p.then ? p : Promise.resolve()).then(function () { enPopstate = false; });
  }

  // ¿Hay una capa a pantalla completa abierta (visor de PDF, lightbox)?
  // Si la hay, "atrás" la cierra en vez de cambiar de pantalla.
  function cerrarCapaSuperior() {
    if (document.querySelector('.visor-pdf-full') ||
        document.querySelector('.lightbox:not([hidden])')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return true;
    }
    return false;
  }

  function esNativo() {
    var Cap = window.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  /* --------------------------------------------------------
     Cabecera y bottom nav
     -------------------------------------------------------- */

  function actualizarCabecera(pantalla) {
    titulo.innerHTML = pantalla.titulo;
    btnAtras.hidden = pantalla.raiz;
    // El botón de tema solo vive en Inicio (esquina superior derecha).
    if (btnTema) btnTema.hidden = rutaActual !== 'inicio';
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

  // "Atrás" del navegador (y del WebView de Android en la web).
  window.addEventListener('popstate', function () {
    if (cerrarCapaSuperior()) {
      // Reponemos la entrada que el navegador acaba de consumir.
      window.history.pushState({ ruta: rutaActual }, '');
      return;
    }
    if (historial.length <= 1) return; // en la raíz: dejamos salir
    retroceder();
  });

  // "Atrás" nativo de Android: con @capacitor/app hay que gestionarlo a mano,
  // si no la app se cierra de golpe (era el caso en el modo estudio).
  (function conectarBotonAtrasNativo() {
    if (!esNativo()) return;
    var App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!App || !App.addListener) return;
    App.addListener('backButton', function () {
      if (cerrarCapaSuperior()) return;
      if (historial.length > 1) window.history.back(); // -> dispara popstate -> retroceder()
      else App.exitApp();
    });
  })();

  // API mínima para que las páginas naveguen (p. ej. abrir una canción).
  window.App = { ir: ir, atras: atras };

  /* --------------------------------------------------------
     Arranque
     -------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    // Reorganización a "sesiones": convierte las canciones con audio del
    // modelo antiguo en sesiones antes de pintar nada. Es una sola vez.
    var arranque = (window.Sesiones && window.Sesiones.migrarDesdeCanciones)
      ? window.Sesiones.migrarDesdeCanciones().catch(function () {})
      : Promise.resolve();
    arranque.then(function () { ir('inicio'); });
    // Notificaciones en fechas señaladas (cumpleaños, fiestas…). Solo APK.
    if (window.Avisos && window.Avisos.iniciar) {
      setTimeout(function () { window.Avisos.iniciar(); }, 1500);
    }
    // Registro en FCM para recibir push con la app cerrada. Solo APK.
    if (window.Push && window.Push.iniciar) {
      setTimeout(function () { window.Push.iniciar(); }, 1800);
    }
  });
})();
