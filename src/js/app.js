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
    inicio:      { archivo: 'home',       titulo: 'Kaixo, Ama <span class="marca-logo" aria-hidden="true"><svg viewBox="0 0 512 512" fill="none"><g class="marca-logo__trazo" stroke="currentColor" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"><path class="marca-logo__p" d="M256 168C232 112 178 92 138 118C92 148 88 214 128 262L256 398L300 354"/><path class="marca-logo__p" d="M256 168C280 112 334 92 374 118C420 148 424 214 384 262L330 316"/><path class="marca-logo__p marca-logo__p--rizo" d="M300 354C344 330 356 388 322 408C292 426 262 402 274 366C282 344 312 340 322 362"/></g><circle class="marca-logo__punto" cx="410" cy="150" r="21" fill="currentColor"/><circle class="marca-logo__punto marca-logo__punto--2" cx="410" cy="206" r="21" fill="currentColor"/></svg></span>', raiz: true },
    sesiones:    { archivo: 'sessions',   titulo: 'Sesiones',    raiz: true },
    practica:    { archivo: 'practice',   titulo: 'Práctica',    raiz: true },
    grabaciones: { archivo: 'recordings', titulo: 'Grabaciones', raiz: true },
    sesion:      { archivo: 'session',    titulo: 'Sesión',       raiz: false },
    conciertos:  { archivo: 'conciertos', titulo: 'Conciertos',   raiz: false },
    canciones:   { archivo: 'songs',      titulo: 'Repertorio',   raiz: false },
    cancion:     { archivo: 'song',       titulo: 'Canción',      raiz: false },
    estudio:     { archivo: 'study',      titulo: 'Modo estudio', raiz: false },
    recibido:    { archivo: 'recibido',   titulo: 'Compartido desde otra app', raiz: false },
  };

  var ORDEN_TABS = ['inicio', 'sesiones', 'practica', 'grabaciones'];

  // Rutas que se pueden re-abrir con datos distintos sin bloquearse.
  var REENTRANTES = ['estudio', 'sesion', 'cancion', 'recibido'];

  var vista = document.getElementById('vista');
  var header = document.getElementById('app-header');
  var titulo = document.getElementById('header-titulo');
  var btnAtras = document.getElementById('btn-atras');
  var btnTema = document.getElementById('btn-tema');
  var btnBackup = document.getElementById('btn-backup');
  if (btnBackup) {
    btnBackup.addEventListener('click', function () {
      if (window.Backup) window.Backup.abrirPanel();
    });
    if (window.Backup && window.Backup.avisoPendiente && window.Backup.avisoPendiente()) {
      btnBackup.classList.add('tiene-aviso');
    }
  }
  var nav = document.getElementById('bottom-nav');
  var indicador = document.getElementById('nav-indicador');
  var itemsNav = Array.prototype.slice.call(nav.querySelectorAll('.nav-item'));

  var reduceMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var historial = [];      // pila de rutas para el botón atrás
  var rutaActual = null;
  var cargando = false;
  var enPopstate = false;  // true mientras servimos un "atrás" del navegador / Android
  var ignorarPops = 0;     // popstates a ignorar (los provoca un salto de varias entradas)
  var profBrowser = 0;     // nº de entradas de detalle nuestras en el historial del navegador


  /* --------------------------------------------------------
     Fondo: congelar cuando no aporta  (RENDIMIENTO)
     --------------------------------------------------------
     El fondo son decenas de capas animadas sin descanso (deriva,
     orbes, pentagrama y, en las fechas señaladas, confeti, guirnalda,
     globos…). En el móvil de Ama eso consume el presupuesto de cada
     fotograma y deja sin sitio a las animaciones de la interfaz.
     Se para en los dos momentos en que además no se está mirando:
     mientras se monta una pantalla nueva y con la app en segundo
     plano, y cuando algo lo TAPA del todo (la letra en directo, el visor
     de PDF, el Wrapped, la bienvenida…): si no se ve, animarlo es tirar
     fotogramas y batería. La clase la leen los contenedores del fondo.

     Las capas que tapan NO tienen que avisar de nada: se detectan aquí
     con un observador, así ninguna puede olvidarse de soltar el freno al
     cerrarse (que es como se quedan estas cosas congeladas para siempre).
  -------------------------------------------------------- */
  // Motivos por nombre, no un contador: repetir el mismo motivo no
  // descuadra nada, y ninguno puede quedarse "a deber" un cierre.
  var motivosQuieto = Object.create(null);
  // La clase se pone en los contenedores del fondo, NO en el <body>: así el
  // motor solo revisa ese subárbol al cambiarla, en vez de la página entera.
  var capasFondo = null;
  function aplicarFondoQuieto() {
    if (!capasFondo) {
      capasFondo = [];
      var a = document.querySelector('.fondo-animado');
      var b = document.querySelector('.fondo-decor');
      if (a) capasFondo.push(a);
      if (b) capasFondo.push(b);
    }
    var quieto = document.hidden || hayTapando;
    for (var k in motivosQuieto) { quieto = true; break; }
    for (var i = 0; i < capasFondo.length; i++) {
      capasFondo[i].classList.toggle('esta-quieto', quieto);
    }
    /* RENDIMIENTO — mientras algo se mueve de verdad (cambio de pantalla,
       cambio de mes en el calendario) la barra de abajo deja de ser
       traslúcida. Su desenfoque obliga al navegador a recapturar y volver a
       desenfocar todo lo que tiene detrás en CADA fotograma, y como es fija
       y está siempre encima, eso se cuela en cualquier animación de la
       página: es el tirón que parece que mueve la propia barra. Son unos
       260 ms de barra sólida a cambio de una transición limpia. */
    document.body.classList.toggle('sin-fondo-vivo', quieto);
  }
  function congelarFondo(si, motivo) {
    motivo = motivo || 'navegacion';
    if (si) motivosQuieto[motivo] = 1;
    else delete motivosQuieto[motivo];
    aplicarFondoQuieto();
  }
  // App en segundo plano: nada que animar, y así tampoco gasta batería.
  // Es un ESTADO, no un motivo con dueño, así que va aparte.
  document.addEventListener('visibilitychange', aplicarFondoQuieto);

  /* Capas que tapan el fondo entero. Todas se montan como hijas directas
     de <body> salvo el lightbox de la partitura, que vive dentro de la
     pantalla y se enseña quitándole el atributo `hidden`. */
  // El lightbox de la partitura NO está aquí: vive dentro de la pantalla y
  // se enseña quitando `hidden`, así que detectarlo pediría vigilar ese
  // atributo en todo el árbol — y `hidden` se toca constantemente en el
  // Modo estudio. Lo avisa study.js a mano, que ya calcula ese estado.
  var QUE_TAPAN = '.letralive, .visor-pdf-full, .wrapped, .bv, .hoja--memoletra';
  var hayTapando = false;
  var revisionPedida = 0;
  function revisarTapando() {
    revisionPedida = 0;
    var ahora = !!document.querySelector(QUE_TAPAN);
    if (ahora === hayTapando) return;
    hayTapando = ahora;
    aplicarFondoQuieto();
  }
  function pedirRevisarTapando() {
    if (revisionPedida) return;
    revisionPedida = requestAnimationFrame(revisarTapando);
  }
  if (typeof MutationObserver === 'function') {
    // `childList` en <body> (sin subtree) para las capas que se montan y
    // desmontan, y el atributo `hidden` para el lightbox, que se queda en
    // el DOM. Se filtra por `hidden` a propósito: vigilar `class` aquí
    // sería un disparo continuo (el karaoke cambia clases sin parar).
    // `childList` en <body> y SIN `subtree`: todas estas capas se montan
    // como hijas directas del body, así que basta con eso y el observador
    // casi nunca se dispara.
    new MutationObserver(pedirRevisarTapando)
      .observe(document.body, { childList: true });
  }

  // Por si algún módulo quiere pedirlo a mano (p. ej. una capa que no
  // encaje en QUE_TAPAN). Con motivo propio para no pisarse con nadie.
  window.FondoQuieto = congelarFondo;


  /* --------------------------------------------------------
     Carga bajo demanda de los módulos de página  (RENDIMIENTO)
     --------------------------------------------------------
     js/pages/*.js son los ficheros más gordos de la app (el de Modo
     estudio pasa de 100 KB) y antes se descargaban, parseaban y
     ejecutaban TODOS en el arranque, aunque Ama solo fuera a abrir
     Inicio. Eso es medio megabyte de JavaScript bloqueando el primer
     pintado en un móvil de gama media.

     Ahora cada uno se carga la primera vez que se entra en su
     pantalla, y el resto se van trayendo en los ratos muertos
     (precargar), así que a partir del primer minuto están todos
     calientes y no se nota ninguna espera.
  -------------------------------------------------------- */
  var modulosPagina = {};   // archivo -> Promise de carga

  function cargarModulo(archivo) {
    // Ya definido (por precarga o por una visita anterior): nada que hacer.
    if (window['Pagina_' + archivo]) return Promise.resolve();
    if (modulosPagina[archivo]) return modulosPagina[archivo];
    modulosPagina[archivo] = new Promise(function (listo) {
      var s = document.createElement('script');
      s.src = 'js/pages/' + archivo + '.js';
      // Sin async: hay que respetar el orden y que el global exista al
      // resolver. Un fallo no debe dejar la app colgada, así que el
      // error también resuelve: ir() se limita a no llamar al módulo.
      s.onload = function () { listo(); };
      s.onerror = function () {
        console.error('No se pudo cargar el módulo de página:', archivo);
        listo();
      };
      document.head.appendChild(s);
    });
    return modulosPagina[archivo];
  }

  // Precarga tranquila del resto, cuando el navegador no tiene nada
  // mejor que hacer y de uno en uno, para no robarle fotogramas a la
  // pantalla que Ama está mirando.
  function precargarModulos() {
    var pendientes = Object.keys(PANTALLAS)
      .map(function (r) { return PANTALLAS[r].archivo; })
      .filter(function (a) { return !window['Pagina_' + a]; });
    var enReposo = window.requestIdleCallback ||
      function (fn) { return setTimeout(fn, 300); };
    (function siguiente() {
      var a = pendientes.shift();
      if (!a) return;
      enReposo(function () { cargarModulo(a).then(siguiente); });
    })();
  }

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
    // Cualquier salto a una pestaña del bottom nav usa fundido (no el
    // deslizamiento lateral), incluido volver desde una canción/sesión/
    // estudio: es un cambio de contexto y el fundido es mucho más barato.
    var esCambioDeTab = pantalla.raiz;

    try {
      // El HTML de la pantalla y su módulo se piden a la vez: son
      // independientes y así se solapan en vez de encadenarse.
      var partes = await Promise.all([
        fetch('pages/' + pantalla.archivo + '.html').then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return r.text();
        }),
        cargarModulo(pantalla.archivo)
      ]);
      var html = partes[0];

      // La pantalla entra invisible (opacity:0 en CSS). La animación NO se
      // dispara aquí: se añade su clase en el frame siguiente, cuando el
      // módulo ya ha montado todo el contenido. Así el trabajo pesado de
      // pintar la página (calendario, logros, listas…) no compite con la
      // animación y la transición deja de trabarse.
      // RENDIMIENTO — mientras se monta la pantalla nueva el hilo principal
      // está ocupado; que el fondo siga animándose solo resta fotogramas y
      // hace más visible el salto. Se congela aquí y se suelta al final.
      congelarFondo(true);

      // La pantalla nueva se añade ENCIMA de la vieja (misma celda de grid,
      // invisible) en vez de reemplazarla: así el módulo puede montar todo
      // su contenido —y medir, que para eso está en el DOM— sin que Ama vea
      // un hueco de fondo pelado. La vieja se retira justo antes de la
      // animación de entrada.
      var claseAnim = (esCambioDeTab || opts.reemplazar) ? 'entra-fundido' : 'entra';
      var anterior = vista.firstElementChild;
      var contenedor = document.createElement('div');
      contenedor.className = 'pantalla pantalla--entrando';
      contenedor.setAttribute('data-pantalla', pantalla.archivo);
      contenedor.innerHTML = html;
      vista.appendChild(contenedor);

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
        // opts.reemplazar: misma pantalla lógica con otros datos (p. ej.
        // cambiar de día en el Modo estudio). Sustituye la cima en vez de
        // apilar, para que "atrás" no recorra cada cambio.
        else if (opts.reemplazar && historial.length) historial[historial.length - 1] = entrada;
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
        if (esPrimeraNav || opts.reemplazar) {
          window.history.replaceState(estado, '');
        } else if (pantalla.raiz) {
          // Volver a una pestaña raíz colapsa la pila: en vez de apilar otra
          // entrada, descartamos de golpe las de detalle acumuladas.
          window.history.replaceState(estado, '');
          if (profBrowser > 0) {
            var nAtras = profBrowser;
            profBrowser = 0;
            ignorarPops += 1;
            window.history.go(-nAtras);
          }
        } else {
          window.history.pushState(estado, '');
          profBrowser++;
        }
      }

      // Módulo opcional de la página: js/pages/<archivo>.js expone window.Pagina_<archivo>
      var modulo = window['Pagina_' + pantalla.archivo];
      if (modulo && typeof modulo.iniciar === 'function') {
        try { modulo.iniciar(contenedor, opts.datos); }
        catch (e) { console.error('Módulo de página falló:', e); }
      }

      // Contenido ya montado: se retira la pantalla vieja y entra la nueva.
      // Sigue siendo la misma tarea y el navegador aún no ha pintado, así
      // que el primer fotograma ya arranca con la nueva invisible y el
      // resto de la transición es solo opacidad (compositor), sin layout.
      if (anterior && anterior.parentNode === vista) vista.removeChild(anterior);
      contenedor.classList.remove('pantalla--entrando');
      // RENDIMIENTO — al entrar arrancaban 42 animaciones en el mismo
      // fotograma (medido en Práctica). Se PROBÓ retrasar las de dentro
      // hasta que acabara el fundido de la pantalla, y se notaba el parón:
      // peor el remedio. La solución está en el CSS, repartiendo los dos
      // montones grandes en el tiempo (los sellos del calendario por
      // columnas y los logros en oleadas), así que aquí todo arranca ya.
      contenedor.classList.add(claseAnim);
      // El fondo vuelve a moverse cuando la transición ya ha terminado.
      setTimeout(function () { congelarFondo(false); }, 260);

      // Aviso estilo Steam si acaba de caer algún logro nuevo (tras la
      // acción que lo dispara, que casi siempre implica cambiar de pantalla).
      if (window.Logros && window.Logros.revisarNuevos) {
        setTimeout(function () {
          try { window.Logros.revisarNuevos(); } catch (e) {}
        }, 500);
      }
    } catch (e) {
      congelarFondo(false);
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

  // ¿La entrada del historial sigue apuntando a algo que existe? Tras
  // eliminar una canción o una sesión, las pantallas de detalle que la
  // mostraban quedan muertas y "atrás" no debe pararse en ellas.
  function entradaViva(e) {
    if (!e || !e.datos) return true;
    var d = e.datos;
    var S = window.Sesiones, C = window.Canciones;
    if (d.id && (e.ruta === 'estudio' || e.ruta === 'cancion') && C && !C.obtener(d.id)) return false;
    if (d.id && e.ruta === 'sesion' && S && !S.obtener(d.id)) return false;
    if (d.sesionId && S) {
      var s = S.obtener(d.sesionId);
      if (!s) return false;
      if (d.marcaId && !(s.marcas || []).some(function (m) { return m.id === d.marcaId; })) return false;
    }
    return true;
  }

  // Sirve un "atrás" real: navega a la pantalla anterior de la pila sin
  // volver a tocar el historial del navegador. Salta de golpe las entradas
  // que hayan quedado muertas (canción/sesión eliminada).
  function retroceder() {
    if (historial.length <= 1) return;
    enPopstate = true;
    historial.pop();                             // quita la pantalla actual
    var saltadas = 0;
    while (historial.length > 1 && !entradaViva(historial[historial.length - 1])) {
      historial.pop();
      saltadas++;
    }
    var destino = historial[historial.length - 1];
    rutaActual = null;
    profBrowser = Math.max(0, profBrowser - 1 - saltadas);
    var p = ir(destino.ruta, { datos: destino.datos });
    (p && p.then ? p : Promise.resolve()).then(function () {
      enPopstate = false;
      // Consumir de una vez las entradas muertas del historial del navegador.
      if (saltadas > 0) {
        ignorarPops += 1;
        window.history.go(-saltadas);
      }
    });
  }

  // ¿Hay una capa a pantalla completa abierta (visor de PDF, lightbox)?
  // Si la hay, "atrás" la cierra en vez de cambiar de pantalla.
  function cerrarCapaSuperior() {
    if (document.querySelector('.visor-pdf-full') ||
        document.querySelector('.letralive') ||
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
    // El botón de tema y el de copia de seguridad solo viven en Inicio
    // (esquina superior derecha).
    if (btnTema) btnTema.hidden = rutaActual !== 'inicio';
    if (btnBackup) btnBackup.hidden = rutaActual !== 'inicio';
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
  // RENDIMIENTO — este listener salta muchas veces por segundo con cada
  // deslizamiento. Tocar una clase en la cabecera invalida el estilo del
  // documento entero (la hoja tiene miles de reglas), así que se escribe
  // SOLO en el momento en que se cruza el umbral, no en cada evento.
  var _conBorde = false;
  function alHacerScroll() {
    var debe = window.scrollY > 4;
    if (debe === _conBorde) return;
    _conBorde = debe;
    header.classList.toggle('con-borde', debe);
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
    if (ignorarPops > 0) { ignorarPops--; return; }
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
    // Su cumpleaños (12/09, cada año): fondo y cabecera se visten de fiesta
    // todo el día. Un detalle discreto, coherente con el resto de celebraciones.
    if (window.Frases && window.Frases.esCumpleMaite && window.Frases.esCumpleMaite()) {
      document.body.classList.add('cumple-maite');
    }
    // Otras fechas señaladas con interfaz propia (Navidad, Reyes,
    // Halloween, Txupinazo, día de la madre…): mismo mecanismo, un tema
    // exclusivo cada vez porque las fechas no se solapan entre sí.
    if (window.Frases && window.Frases.temaDeHoy) {
      var _tema = window.Frases.temaDeHoy();
      if (_tema) {
        document.body.classList.add('tema-' + _tema);
        // Navidad, Año Nuevo, Reyes, Halloween y Txupinazo tienen fondo
        // oscuro sí o sí: ese día toda la app entra en modo oscuro, gane
        // lo que gane el interruptor de Maite — tema.js ya sabe mirar esta
        // clase (temaNocheActivo) y lo fuerza también si lo intenta tocar.
        // Aquí solo hace falta pedirle que vuelva a aplicar ahora que la
        // clase ya existe en el body.
        if (window.Tema && window.Tema.refrescar) window.Tema.refrescar();
      }
    }
    // Cuenta el tiempo real que pasa con la app abierta (para el Wrapped).
    if (window.Tiempo && window.Tiempo.iniciar) window.Tiempo.iniciar();
    // Reorganización a "sesiones": convierte las canciones con audio del
    // modelo antiguo en sesiones antes de pintar nada. Es una sola vez.
    var arranque = (window.Sesiones && window.Sesiones.migrarDesdeCanciones)
      ? window.Sesiones.migrarDesdeCanciones().catch(function () {})
      : Promise.resolve();
    arranque.then(function () {
      ir('inicio').then(function () {
        // Inicio ya está en pantalla: se van trayendo en reposo los
        // módulos de las demás pantallas, para que el primer salto a
        // cada una tampoco espere a nada.
        precargarModulos();
      });
      // Presentación a pantalla completa, SOLO la primera vez que se abre.
      if (window.Bienvenida && window.Bienvenida.iniciarSiPrimeraVez) {
        window.Bienvenida.iniciarSiPrimeraVez();
      }
    });
    // Notificaciones en fechas señaladas (cumpleaños, fiestas…). Solo APK.
    if (window.Avisos && window.Avisos.iniciar) {
      setTimeout(function () { window.Avisos.iniciar(); }, 1500);
    }
    // Registro en FCM para recibir push con la app cerrada. Solo APK.
    if (window.Push && window.Push.iniciar) {
      setTimeout(function () { window.Push.iniciar(); }, 1800);
    }
    // Sube un resumen del progreso a Firebase para el panel del hijo.
    if (window.Progreso && window.Progreso.iniciar) {
      setTimeout(function () { window.Progreso.iniciar(); }, 2200);
    }
    // Actualizaciones por wifi (OTA) del contenido web. Solo APK.
    // Pronto: notifyAppReady() debe llegar antes de que Capgo dé el
    // bundle por roto (~10 s) y revierta.
    if (window.OTA && window.OTA.iniciar) {
      setTimeout(function () { window.OTA.iniciar(); }, 400);
    }
    // Compartir desde WhatsApp/Galería ("Compartir con ChorApp"). Solo APK.
    if (window.Compartido) {
      window.Compartido.comprobarAlArrancar().then(function (item) {
        if (item) ir('recibido', { datos: item });
      });
      window.Compartido.escuchar(function (item) {
        ir('recibido', { datos: item, reemplazar: rutaActual === 'recibido' });
      });
    }
  });
})();
