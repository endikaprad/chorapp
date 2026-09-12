/* ============================================================
   bienvenida.js — La presentación de la app, SOLO la primera vez.

   Es la primera impresión: pantalla completa, inmersiva, un sector
   detrás de otro con su propio color, su propia ilustración animada
   y su propia entrada. Como el asistente de un móvil nuevo, pero con
   cariño y con retranca.

   Se muestra UNA vez. Al terminar (o al saltar) se guarda la marca en
   Almacen y no vuelve a aparecer.

   window.Bienvenida.iniciarSiPrimeraVez()  -> la lanza si toca
   window.Bienvenida.forzar()               -> la lanza siempre (pruebas)
   window.Bienvenida.reiniciar()            -> borra la marca (pruebas)
   ============================================================ */

window.Bienvenida = (function () {
  'use strict';

  var CLAVE = 'bienvenida';   // Almacen: { v, fecha } cuando ya se ha visto
  var VERSION = 12;

  /* La instrumental "Inner Light" suena de fondo.
     ACTO 1 (la historia) va sincronizado con la música: cada sector
     arranca en el segundo de BORDES; el último borde (47,5 s) es el
     "drop" (cuando la canción rompe). Ahí termina el ACTO 1.
     ACTO 2 (cómo funciona) empieza en el drop y se pasa solo con su
     propio ritmo (ACTO2_BORDES, segundos DESDE el drop). */
  var AUDIO_SRC = 'audio/instrumental/inner-light.mp3';
  // Segunda pieza: entra cuando 'inner-light' termina, subiendo el volumen
  // MUY poco a poco. Empieza desde el segundo 28 (no antes).
  var AUDIO_SRC2 = 'audio/instrumental/kassandra.mp3';
  var AUDIO2_DESDE = 28;      // segundo de arranque de kassandra
  var AUDIO2_FADE = 14000;    // rampa de volumen larguísima (ms)
  var DROP = 47.5;
  var VOL = 0.85;

  // Lo de "ponte los auriculares" NO es un sector: es una portada a
  // pantalla completa (.bv-gate) que va antes. Al pulsar el botón se
  // funde y empiezan los sectores con música.

  // Los tiempos se calculan de los `dur` de cada sector (ver calcularTiempos).
  // ACTO 1: sectores 0..IDX_ACTO2-1 (la historia). ACTO 2: el resto.
  var IDX_ACTO2 = 5;
  var BORDES = [];        // segundos en los que arranca cada sector del acto 1 (último = DROP)
  var ACTO2_BORDES = [];  // segundos DESDE el drop para el acto 2

  // A partir de los `dur` de los sectores:
  //  - ACTO 1 se normaliza para sumar exactamente DROP (va con la música).
  //  - ACTO 2 usa los `dur` tal cual (da igual lo que dure la canción).
  function calcularTiempos(datos) {
    var d1 = datos.slice(0, IDX_ACTO2).map(function (s) { return s.dur || 8; });
    var suma = d1.reduce(function (a, b) { return a + b; }, 0);
    BORDES = [0];
    d1.forEach(function (x) {
      BORDES.push(Math.round((BORDES[BORDES.length - 1] + x / suma * DROP) * 100) / 100);
    });
    BORDES[BORDES.length - 1] = DROP;

    var d2 = datos.slice(IDX_ACTO2, datos.length - 1).map(function (s) { return (s.dur || 10) + 0.5; }); // medio segundo extra por slide del "cómo funciona"
    ACTO2_BORDES = [0];
    d2.forEach(function (x) { ACTO2_BORDES.push(ACTO2_BORDES[ACTO2_BORDES.length - 1] + x); });
    ACTO2_BORDES.push(ACTO2_BORDES[ACTO2_BORDES.length - 1] + 1); // +1 s para llenar la barra del cierre
  }

  var raiz = null;
  var slides = [];
  var idx = 0;
  var acto = 1;
  var empezado = false;   // false hasta que Ama pulsa "Listo" en el sector 0

  var audio = null;
  var audio2 = null;      // kassandra: entra al acabar inner-light
  var fondos = [];
  var raf = null;
  var iniMs = 0, pausaMs = 0, pausaIni = 0, enPausa = false;
  var rematando = false;
  var holdT = null;

  /* Pantalla siempre despierta mientras dura la bienvenida: son varios
     minutos de slides que se pasan solos y Ama no toca la pantalla, así
     que el móvil la apagaría a media historia. Usa la Wake Lock API del
     WebView; si no está, no pasa nada. Se libera al cerrar y hay que
     volver a pedirla al volver de segundo plano (el sistema la suelta). */
  var _wakeLock = null;
  function pedirWakeLock() {
    try {
      if (!navigator.wakeLock || _wakeLock) return;
      navigator.wakeLock.request('screen').then(function (wl) {
        _wakeLock = wl;
        wl.addEventListener('release', function () { _wakeLock = null; });
      }).catch(function () {});
    } catch (e) {}
  }
  function soltarWakeLock() {
    try { if (_wakeLock) _wakeLock.release(); } catch (e) {}
    _wakeLock = null;
  }


  /* Vibración sutil (móvil). Con @capacitor/haptics si está; si no,
     navigator.vibrate. En web sin soporte, no hace nada. */
  function vibrar(tipo) {
    try {
      var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (H) {
        if (tipo === 'exito' && H.notification) { H.notification({ type: 'SUCCESS' }); return; }
        if (H.impact) { H.impact({ style: tipo === 'fuerte' ? 'MEDIUM' : 'LIGHT' }); return; }
      }
    } catch (e) {}
    try {
      if (navigator.vibrate) {
        navigator.vibrate(tipo === 'fuerte' ? [0, 18, 45, 26]
          : tipo === 'exito' ? [0, 12, 26, 12, 26, 22] : 12);
      }
    } catch (e) {}
  }

  /* El "drop": cuando la línea de luz se cierra y revienta. Golpe doble,
     más fuerte que `vibrar('fuerte')`. */
  function golpeDrop() {
    if (reducido()) return;
    try {
      var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (H && H.impact) {
        H.impact({ style: 'HEAVY' });
        window.setTimeout(function () { try { H.impact({ style: 'HEAVY' }); } catch (e) {} }, 150);
        return;
      }
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([0, 55, 45, 160]); } catch (e) {}
  }

  function _now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }
  // Segundo actual de la bienvenida (reloj de pared, descontando las pausas).
  function ahoraSeg() {
    var fin = enPausa ? pausaIni : _now();
    return Math.max(0, (fin - iniMs - pausaMs) / 1000);
  }

  function reducido() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Cuenta 0 -> fin (~1.1s, easeOut). Instantáneo si prefers-reduced-motion. */
  function contarHasta(el, fin) {
    fin = Number(fin) || 0;
    if (!el) return;
    // Separador de miles opcional (data-sep): 29403 -> "29.403".
    var sep = el.hasAttribute('data-sep');
    function pinta(v) { el.textContent = sep ? v.toLocaleString('es-ES') : String(v); }
    if (reducido() || fin <= 0) { pinta(fin); return; }
    var dur = fin > 9999 ? 1500 : 1100;
    var ini = (window.performance && performance.now) ? performance.now() : Date.now();
    function paso() {
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var k = Math.min(1, (now - ini) / dur);
      pinta(Math.round(fin * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(paso);
      else pinta(fin);
    }
    requestAnimationFrame(paso);
  }

  /* Rampa de volumen (rAF). destino 0-1. */
  function fadeAudio(a, destino, ms, cb) {
    if (!a) { if (cb) cb(); return; }
    var v0 = a.volume, t0 = _now();
    a._fade = (a._fade || 0) + 1;
    var id = a._fade;
    (function paso() {
      if (!a || a._fade !== id) return;
      var k = Math.min(1, (_now() - t0) / Math.max(1, ms));
      try { a.volume = Math.max(0, Math.min(1, v0 + (destino - v0) * k)); } catch (e) {}
      if (k < 1) requestAnimationFrame(paso);
      else if (cb) cb();
    })();
  }

  /* ---------- Piezas ilustradas reutilizables ---------- */

  // Glifos musicales flotando hacia arriba. items: [glifo, left%, delay, dur, tam]
  function flotantes(items) {
    return items.map(function (o) {
      return '<span class="bv-flota" aria-hidden="true" style="left:' + o[1] + '%;' +
        '--d:' + o[2] + 's;--dur:' + o[3] + 's;font-size:' + o[4] + 'px">' + o[0] + '</span>';
    }).join('');
  }

  // Barras de ecualizador (n barras que suben y bajan desfasadas).
  function ecualizador(n, clase) {
    var s = '';
    for (var i = 0; i < n; i++) s += '<i style="--i:' + i + '"></i>';
    return '<div class="bv-eq ' + (clase || '') + '" aria-hidden="true">' + s + '</div>';
  }

  // El logo OFICIAL de la app (images/logo-app.jpg): el corazón de clave
  // de sol + clave de fa, crema sobre cobalto. Se muestra como un icono
  // de app (cuadrado redondeado).
  var LOGO =
    '<span class="bv-logo-chip" aria-hidden="true">' +
      '<img class="bv-logo-img" src="images/logo-app.jpg" alt="" decoding="async" />' +
    '</span>';

  // Auriculares de diadema (portada .bv-gate).
  var AURICULARES =
    '<svg class="bv-cascos" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 13.5V12a8 8 0 0 1 16 0v1.5"/>' +
      '<rect x="2.2" y="13" width="4.2" height="7.5" rx="2.1"/>' +
      '<rect x="17.6" y="13" width="4.2" height="7.5" rx="2.1"/>' +
    '</svg>';

  // Libreta con la "idea" escrita a mano (sector Junio).
  var ARTE_LIBRETA =
    '<svg class="bv-arte bv-arte--libreta" viewBox="0 0 120 108" fill="none" ' +
    'stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="14" y="10" width="92" height="88" rx="9" stroke-width="3"/>' +
      '<path d="M14 30h92" stroke-width="2" opacity="0.5"/>' +
      '<path class="bv-arte__l" d="M30 48h60" stroke-width="3"/>' +
      '<path class="bv-arte__l" d="M30 64h60" stroke-width="3"/>' +
      '<path class="bv-arte__l" d="M30 80h34" stroke-width="3"/>' +
      '<path class="bv-arte__n" d="M72 84V70l12-2.6V80" stroke-width="3"/>' +
      '<circle class="bv-arte__n" cx="69" cy="84" r="3.2" fill="currentColor" stroke="none"/>' +
      '<circle class="bv-arte__n" cx="81" cy="81" r="3.2" fill="currentColor" stroke="none"/>' +
    '</svg>';

  // Corazón grande que se dibuja y late (sector "por qué").
  var ARTE_CORAZON =
    '<svg class="bv-arte bv-arte--corazon" viewBox="0 0 64 60" fill="none" ' +
    'stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path class="bv-arte__h" d="M32 53C32 53 8 38 8 21C8 13 14 7 21 7C26 7 30 10 32 14C34 10 38 7 43 7C50 7 56 13 56 21C56 38 32 53 32 53Z"/>' +
    '</svg>';

  // Lista de "fases" con checks que se dibujan en cascada.
  function fasesLista(items) {
    var li = items.map(function (t) {
      return '<li><span class="bv-fase__c" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
        'stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l6 6 10-13"/></svg>' +
        '</span>' + t + '</li>';
    }).join('');
    return '<ul class="bv-fases" aria-hidden="true">' + li + '</ul>';
  }

  /* ---------- Los sectores ----------
     bg     : fondo del sector (degradado propio, cruza en fundido)
     clase  : clase del <section>
     html   : contenido (.bv-decor para la ilustración, .bv-in para el texto)

     ACTO 1 (0 -> 47,5 s, sincronizado con la música): la historia.
     Cuando la instrumental rompe -> ACTO 2: cómo funciona la app.
  */
  // Sector 6: canciones que entran UNA A UNA, alternando izquierda/derecha,
  // y se juntan en una sesión. En bucle.
  function agrupaCanciones() {
    var t = ['Gaudeamus', 'Ave verum', 'Txoria txori', 'Hallelujah'];
    var li = t.map(function (n, i) {
      var from = (i % 2 === 0 ? -1 : 1) * (window.innerWidth < 400 ? 118 : 150);
      return '<span class="bv-cancion" style="--n:' + i + ';--from:' + from + 'px">' +
        '<i>♪</i>' + n + '</span>';
    }).join('');
    return '<div class="bv-agrupa" aria-hidden="true">' +
      '<span class="bv-agrupa__caja"><b>Ensayo del martes</b></span>' + li + '</div>';
  }

  // Sector Estados: tres canciones del repertorio. Cada una recorre en
  // bucle Pendiente -> En progreso -> Aprendida, desfasadas entre sí, así
  // que siempre se ven los tres estados a la vez y "avanzando". Al llegar
  // a Aprendida: el aro se cierra, el check se dibuja y salta una pequeña
  // celebración (brillo + chispas).
  function estadosCanciones() {
    var t = ['Txoria txori', 'Ave verum', 'Hallelujah'];
    var chispas = '';
    for (var c = 1; c <= 5; c++) chispas += '<i class="bv-est__chispa" style="--a:' + c + '"></i>';
    var cards = t.map(function (n, i) {
      return '<div class="bv-est__card" style="--n:' + i + '">' +
        '<span class="bv-est__ico">' +
          '<svg class="bv-est__ring" viewBox="0 0 40 40">' +
            '<circle class="bv-est__ring-bg" cx="20" cy="20" r="16"/>' +
            '<circle class="bv-est__ring-fg" cx="20" cy="20" r="16" pathLength="100"/>' +
          '</svg>' +
          '<i class="bv-est__nota">&#9834;</i>' +
          '<svg class="bv-est__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M4 12l6 6 10-13"/></svg>' +
        '</span>' +
        '<div class="bv-est__tx">' +
          '<b>' + n + '</b>' +
          '<span class="bv-est__chip">' +
            '<i class="bv-est__dot"></i>' +
            '<span class="bv-est__labs">' +
              '<span class="bv-est__lab bv-est__lab--pend">Pendiente</span>' +
              '<span class="bv-est__lab bv-est__lab--prog">En progreso</span>' +
              '<span class="bv-est__lab bv-est__lab--aprd">Aprendida</span>' +
            '</span>' +
          '</span>' +
        '</div>' +
        '<span class="bv-est__chispas">' + chispas + '</span>' +
      '</div>';
    }).join('');
    return '<div class="bv-est" aria-hidden="true">' + cards + '</div>';
  }

  // Sector Logros: medallas que van cayendo, una con brillo.
  // Sector "Copia de seguridad": una nube con un check que respira, y
  // tres iconos (canción, nota, grabación) que suben desde abajo y se
  // funden dentro de ella, en bucle — la idea de "sube sola y a salvo".
  function nubeCopia() {
    var iconos = ['🎵', '📝', '🎙️'];
    var subidas = iconos.map(function (ic, i) {
      return '<span class="bv-nube__item" style="--i:' + i + '">' + ic + '</span>';
    }).join('');
    return '<div class="bv-nube" aria-hidden="true">' +
      '<div class="bv-nube__subidas">' + subidas + '</div>' +
      '<svg class="bv-nube__svg" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path fill="#fff" d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>' +
      '</svg>' +
      '<span class="bv-nube__check">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-11"/></svg>' +
      '</span>' +
    '</div>';
  }

  function medallas() {
    var m = [['🔥', '#FF7A3D'], ['⭐', '#F3B33F'], ['🎵', '#5A67E8'],
             ['🏆', '#FFD24A'], ['💪', '#4C7A5A']];
    var s = m.map(function (x, i) {
      return '<span class="bv-medalla" style="--n:' + i + ';--c:' + x[1] + '">' + x[0] + '</span>';
    }).join('');
    return '<div class="bv-medallas" aria-hidden="true">' + s + '</div>';
  }

  // Chincheta / chinche que se clava en el calendario.
  var CHINCHETA =
    '<svg class="bv-chincheta__svg" viewBox="0 0 34 44" aria-hidden="true">' +
      '<ellipse class="bv-chincheta__sombra" cx="16" cy="41" rx="10" ry="2.6"/>' +
      '<path d="M17 22 L15 41" stroke="#9AA0A6" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M17 24 C 9 24 6 16 9 10 L25 10 C 28 16 25 24 17 24 Z" fill="#C6362E"/>' +
      '<ellipse cx="17" cy="10" rx="12" ry="6.5" fill="#FF7A4D"/>' +
      '<ellipse cx="17" cy="8.5" rx="9" ry="4.2" fill="#FF9E77"/>' +
      '<ellipse cx="13" cy="7" rx="3.4" ry="1.8" fill="rgba(255,255,255,0.72)"/>' +
    '</svg>';

  // Sector Conciertos: clavas una chincheta en el día del concierto y
  // luego se "revela" una foto de carrete del recuerdo.
  function conciertoRecuerdo() {
    var cel = '';
    for (var i = 0; i < 14; i++) {
      cel += (i === 3)
        ? '<i class="bv-celda is-concierto"><span class="bv-chincheta">' + CHINCHETA + '</span></i>'
        : '<i class="bv-celda"></i>';
    }
    return '<div class="bv-conci" aria-hidden="true">' +
      '<div class="bv-cal bv-cal--mini">' + cel + '</div>' +
      '<div class="bv-polaroid">' +
        '<div class="bv-polaroid__foto"><img src="images/bihotsak-grupo.jpg" alt="" decoding="async" />' +
          '<i class="bv-polaroid__revela"></i></div>' +
        '<div class="bv-polaroid__pie">San Pedro · lo bordaste</div>' +
      '</div>' +
    '</div>';
  }

  // Sector "Programa de concierto": la hoja del programa con las canciones
  // EN EL ORDEN del pase. Una luz baja por la lista marcando "esta toca
  // ahora"; cada canción que pasa se queda cantada con su check y una
  // chispa. Al final, un barrido de brillo sobre la hoja entera. En bucle.
  function programaConcierto() {
    var orden = ['Gaudeamus hodie', 'Ave verum corpus', 'Txoria txori',
      'Locus iste', 'Hallelujah'];
    var filas = orden.map(function (n, i) {
      var lado = i % 2 === 0 ? -1 : 1;
      return '<li class="bv-pc__fila" style="--n:' + i + ';--lado:' + lado + '">' +
        '<span class="bv-pc__num">' +
          '<b class="bv-pc__digito">' + (i + 1) + '</b>' +
          '<svg class="bv-pc__tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M4 12l6 6 10-13"/></svg>' +
        '</span>' +
        '<span class="bv-pc__tit">' + n + '</span>' +
        '<i class="bv-pc__chispa"></i>' +
      '</li>';
    }).join('');
    // Al acabar el pase, la hoja se echa a un lado y asoman por detrás
    // otros programas (más conciertos, más listas de canciones).
    // Check dibujado a mano (trazo irregular, como marcado con boli).
    var CHECK_MANO =
      '<svg class="bv-pc__ffcheck" viewBox="0 0 20 20" fill="none" ' +
      'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M2.6 10.2c1.5 1 2.9 2.4 4.1 4.4 ' +
      '1.8-5.3 4.7-9 9.6-11.9"/></svg>';
    var otros = [['Santa Cecilia', 4], ['Concierto de Navidad', 5]];
    var fantasmas = otros.map(function (c, k) {
      var mini = '';
      for (var j = 0; j < c[1]; j++) {
        mini += '<i class="bv-pc__ff"><s></s><em>' + CHECK_MANO + '</em></i>';
      }
      return '<div class="bv-pc__fantasma" style="--k:' + (k + 1) + '">' +
        '<span class="bv-pc__fantasma-kick">Programa</span>' +
        '<b class="bv-pc__fantasma-tit">' + c[0] + '</b>' +
        '<div class="bv-pc__fantasma-lista">' + mini + '</div>' +
      '</div>';
    }).join('');
    return '<div class="bv-pc" aria-hidden="true">' +
      '<div class="bv-pc__pila">' +
        fantasmas +
        '<div class="bv-pc__hoja">' +
          '<div class="bv-pc__cab">' +
            '<span class="bv-pc__kicker">Programa</span>' +
            '<b>Concierto de San Pedro</b>' +
          '</div>' +
          '<div class="bv-pc__cuerpo">' +
            '<span class="bv-pc__hilo"><i class="bv-pc__luz"></i></span>' +
            '<ol class="bv-pc__lista">' + filas + '</ol>' +
          '</div>' +
          '<div class="bv-pc__pie"><span>5 canciones</span><span>en orden</span></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // Sector Notificaciones: los avisos van LLEGANDO uno a uno y se apilan,
  // como una bandeja de notificaciones que se va llenando.
  function notisMovil() {
    var n = [
      ['Racha en peligro', 'Son las 8 y no has cantado. Espabila.'],
      ['Hoy hay concierto', 'Suerte ahí arriba. Boca pequeña.'],
      ['Resumen del mes', 'Ya está listo. Ábrelo cuando puedas.']
    ];
    // --out: hacia qué lado se desliza al descartarla (alternado).
    var out = [1, -1, 1];
    var s = n.map(function (t, i) {
      return '<div class="bv-noti" style="--n:' + i + ';--out:' + out[i] + '">' +
        '<span class="bv-noti__ic"><img src="images/logo-app.jpg" alt="" decoding="async"></span>' +
        '<div class="bv-noti__tx"><b>ChorApp · ' + t[0] + '</b><span>' + t[1] + '</span></div>' +
      '</div>';
    }).join('');
    return '<div class="bv-notis" aria-hidden="true">' + s + '</div>';
  }

  // Sector Compartir: un ensayo/grabación que sale volando a WhatsApp.
  function compartirIlustra() {
    return '<div class="bv-compartir" aria-hidden="true">' +
      '<div class="bv-comp__card">' +
        '<span class="bv-comp__ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>' +
        '<div class="bv-comp__tx"><b>Ensayo del martes</b><span>1:12:03</span></div>' +
      '</div>' +
      '<span class="bv-comp__avion"><svg viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M2 12l19-8-6 18-4-7-9-3z"/></svg></span>' +
      '<div class="bv-comp__wa">' +
        '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 0 0-8.6 15l-1.2 4.4 4.5-1.2A10 10 0 1 0 12 2z"/>' +
        '<path d="M9.5 8.4c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.8 4.3 3.8 2.1.8 2.6.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3l-1.6-.8c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1-.3-.1-1.1-.4-2.1-1.3-.8-.7-1.3-1.5-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.3 0-.5l-.8-1.8z" fill="#25D366"/></svg>' +
        '<span class="bv-comp__check">✓✓</span>' +
      '</div>' +
      '<div class="bv-comp__contactos"><span>M</span><span>A</span><span>B</span></div>' +
    '</div>';
  }

  // Sector 7: teclado que va tocando una melodía en bucle.
  function pianoMelodia() {
    // 12 teclas; a las blancas les damos un orden de melodía (--n).
    var blancas = [0, 2, 4, 5, 7, 9, 11];   // posiciones de tecla blanca
    var mel = { 0: 0, 2: 1, 4: 2, 5: 4, 7: 3, 9: 5, 11: 6 };
    var s = '';
    for (var i = 0; i < 12; i++) {
      var negra = [1, 3, 6, 8, 10].indexOf(i) !== -1;
      if (negra) s += '<i class="k"></i>';
      else s += '<i style="--n:' + (mel[i] || 0) + '"></i>';
    }
    return '<div class="bv-piano" aria-hidden="true">' + s + '</div>';
  }

  // Sector Modo estudio: pastillas de velocidad (0.75x / 1x / 1.25x) que
  // se van encendiendo en bucle, como al tocarlas.
  function velIlustra() {
    return '<div class="bv-vel" aria-hidden="true">' +
      '<span style="--n:0">0.75&times;</span>' +
      '<span style="--n:1">1&times;</span>' +
      '<span style="--n:2">1.25&times;</span>' +
    '</div>';
  }

  // Estrella de 4 puntas estilo Gemini, con relleno degradado.
  function estrellaGemini(id) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#6BA9FF"/>' +
        '<stop offset="0.5" stop-color="#A98BFF"/>' +
        '<stop offset="1" stop-color="#F0A6C8"/>' +
      '</linearGradient></defs>' +
      '<path fill="url(#' + id + ')" d="M12 0c.5 5 4.2 9.4 12 12-7.8 2.6-11.5 7-12 12-.5-5-4.2-9.4-12-12 7.8-2.6 11.5-7 12-12Z"/>' +
    '</svg>';
  }

  // Parte un texto en <i> por carácter (respeta entidades &x;, espacios y
  // los puntos medios · de la fonética). Cada letra lleva su índice --k.
  // Antes se partía LETRA a letra (~45 <i> animándose en bucle con
  // text-shadow → mucho repintado). Ahora PALABRA a palabra (~6): el efecto
  // "salen de la estrella y escriben" se mantiene, el coste baja 7x.
  function partirLetras(txt) {
    var w = String(txt).trim().split(/\s+/);
    return {
      n: w.length,
      html: w.map(function (p, k) {
        return '<i style="--k:' + k + '">' + p + '</i>';
      }).join(' ')
    };
  }

  // Sector fusionado "La letra, en vivo y en tu idioma": UNA sola escena que
  // encadena las dos ideas que antes iban en sectores separados. Arriba, el
  // verso en euskera se canta EN DIRECTO (las palabras se encienden al
  // pasar, como el karaoke) sobre la onda real de la canción. Un haz sube
  // desde la onda hasta la estrella de Gemini, que "escucha" y responde
  // abajo materializando primero CÓMO SE PRONUNCIA y después LA TRADUCCIÓN.
  // Una sola animación, un solo flujo: canta -> la IA escucha -> te lo
  // traduce. Reutiliza los bloques de bv-ll (karaoke + onda) y bv-ia
  // (estrella + materialización) ya existentes; solo añade el haz que los
  // conecta (bv-iac__rayo). Solo transform / opacity.
  function iaLetraIlustra() {
    var palabras = ['Bihotzeko', 'taupadak']
      .map(function (p, j) {
        return '<b class="bv-ll__w" style="--w:' + j + '">' + p + '</b>';
      }).join(' ');
    var li = '<p class="bv-ll__linea">' + palabras + '</p>';

    var N = 18, bars = '';
    for (var b = 0; b < N; b++) {
      var h = 12 + Math.round(36 * Math.abs(Math.sin(b * 1.7) * Math.cos(b * 0.55) + 0.15 * Math.sin(b)));
      bars += '<i style="--h:' + Math.min(48, h) + '"></i>';
    }

    var fon = partirLetras('bi·ó·tse·ko  ta·u·pá·dak');
    var es = partirLetras('Los latidos del corazón');

    return '<div class="bv-iac" aria-hidden="true">' +
      '<div class="bv-ll__chip">' +
        '<span class="bv-ll__gem">' + estrellaGemini('bv-gem-iac1') + '</span>' +
        '<span>Ave verum &middot; sonando</span>' +
      '</div>' +
      '<div class="bv-ll__marco">' + li + '</div>' +
      '<div class="bv-ll__wave">' +
        '<div class="bv-ll__bars bv-ll__bars--bg">' + bars + '</div>' +
        '<div class="bv-ll__fill"><div class="bv-ll__bars bv-ll__bars--on">' + bars + '</div></div>' +
        '<i class="bv-ll__playhead"></i>' +
      '</div>' +
      '<span class="bv-iac__rayo"></span>' +
      '<span class="bv-ia__estrella bv-iac__nucleo">' +
        '<span class="bv-ia__pulso"></span>' +
        '<span class="bv-ia__pulso bv-ia__pulso--2"></span>' +
        estrellaGemini('bv-gem-iac2') +
      '</span>' +
      '<div class="bv-ia__salida bv-iac__salida">' +
        '<p class="bv-ia__linea bv-ia__linea--fon" style="--n:' + fon.n + '">' + fon.html + '</p>' +
        '<p class="bv-ia__linea bv-ia__linea--es" style="--n:' + es.n + '">' + es.html + '</p>' +
      '</div>' +
      '<div class="bv-ia__etqs bv-iac__etqs">' +
        '<span class="bv-ia__etq-slot">' +
          '<span class="bv-ia__etq bv-ia__etq--fon">c&oacute;mo suena</span>' +
          '<span class="bv-ia__etq bv-ia__etq--tra">traducci&oacute;n</span>' +
        '</span>' +
      '</div>' +
    '</div>';
  }

  // Sector "De memoria": una hoja de letra con tres versos; en algunas
  // palabras hay un hueco y, uno a uno, la palabra correcta CAE en su
  // sitio (sube desde abajo, se desenfoca a nítido, suelta una chispa y
  // la línea del hueco se enciende). Al final aparece la nota "9 / 10".
  // Todo en bucle. Solo transform / opacity / blur.
  function memoIlustra() {
    // [texto antes, palabra oculta, texto después] por verso.
    var versos = [
      ['Ave ', 'verum', ' corpus natum'],
      ['ex ', 'Maria', ' Virgine'],
      ['vere passum ', 'immolatum', '']
    ];
    var g = 0;
    var filas = versos.map(function (v) {
      var hueco =
        '<span class="bv-memo__hueco" style="--g:' + (g++) + '">' +
          '<i>' + v[1] + '</i></span>';
      return '<span class="bv-memo__verso">' + v[0] + hueco + v[2] + '</span>';
    }).join('');
    return '<div class="bv-memo" aria-hidden="true">' +
      '<div class="bv-memo__hoja">' + filas + '</div>' +
      '<span class="bv-memo__nota">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l6 6 10-13"/></svg>' +
        '<span><b>9</b>&thinsp;/&thinsp;10 versos de memoria</span>' +
      '</span>' +
    '</div>';
  }

  // Sector Pantalla de bloqueo: la notificación del reproductor con sus
  // cinco botones (velocidad, −5 s, play/pausa, +5 s, repetir) reaccionando
  // uno a uno, en bucle. Igual que la ve Ama al bajar las notificaciones.
  function reproductorBloqueo() {
    var rew =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a7 7 0 1 1-6.3 4"/>' +
      '<path d="M5 4v5h5"/><text x="12.5" y="15.5" font-size="7.5" font-weight="700" ' +
      'fill="currentColor" stroke="none" text-anchor="middle">5</text></svg>';
    var fwd =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a7 7 0 1 0 6.3 4"/>' +
      '<path d="M19 4v5h-5"/><text x="11.5" y="15.5" font-size="7.5" font-weight="700" ' +
      'fill="currentColor" stroke="none" text-anchor="middle">5</text></svg>';
    var play = '<svg class="bv-lk__i bv-lk__i--play" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M8 5v14l11-7z"/></svg>';
    var pause = '<svg class="bv-lk__i bv-lk__i--pause" viewBox="0 0 24 24" fill="currentColor">' +
      '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    var loop =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/>' +
      '<path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/>' +
      '<path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
    var lock =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/>' +
      '<path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    var chevron =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    var ctrl =
      '<span class="bv-lk__b bv-lk__b--vel" style="--n:0"><b class="bv-lk__vel">' +
        '<i>1x</i><i>1.25x</i></b></span>' +
      '<span class="bv-lk__b" style="--n:1">' + rew + '</span>' +
      '<span class="bv-lk__b bv-lk__b--play" style="--n:2">' + pause + play + '</span>' +
      '<span class="bv-lk__b" style="--n:3">' + fwd + '</span>' +
      '<span class="bv-lk__b bv-lk__b--loop" style="--n:4">' + loop + '<i class="bv-lk__dot"></i></span>';
    return '<div class="bv-lock" aria-hidden="true">' +
      '<div class="bv-lock__pull"><i></i>' + chevron + '</div>' +
      '<div class="bv-lock__top"><span class="bv-lock__lock">' + lock + '</span>' +
        '<span class="bv-lock__hora">19:29</span></div>' +
      '<div class="bv-lock__card">' +
        '<div class="bv-lock__cab"><span class="bv-lock__ic"><img src="images/logo-app.jpg" alt="" decoding="async"></span>' +
          '<div class="bv-lock__meta"><b>Ave verum</b><span>Ensayo del martes</span></div></div>' +
        '<div class="bv-lock__barra"><i class="bv-lock__fill"></i><i class="bv-lock__thumb"></i></div>' +
        '<div class="bv-lock__times"><span>0:06</span><span>3:03</span></div>' +
        '<div class="bv-lock__ctrl">' + ctrl + '</div>' +
      '</div>' +
    '</div>';
  }

  function sectores() {
    return [
      /* ============  ACTO 1 — LA HISTORIA  (0 -> 47,5 s)  ============
         `dur` = segundos que se quiere que dure; calcularTiempos() lo
         normaliza para que sumen exactamente 47,5. */

      // 0 — Portada / bienvenida
      {
        dur: 5.5,
        bg: 'radial-gradient(120% 80% at 20% 0%, #3B39E8 0%, #1512D6 42%, #0E0B9E 100%)',
        clase: 'bv-s--portada',
        html:
          '<div class="bv-decor bv-decor--fondo">' + flotantes([
            ['♪', 12, 0, 10, 22], ['♫', 82, 2, 12, 30], ['♬', 60, 5, 13, 24]
          ]) + '</div>' +
          '<div class="bv-in bv-in--centro">' +
            '<span class="bv-logo-wrap" aria-hidden="true">' + LOGO + '</span>' +
            '<p class="bv-eyebrow">Para ti, Ama</p>' +
            '<h2 class="bv-h1">Esto tiene<br>una historia</h2>' +
            '<p class="bv-sub">Deja que te la cuente antes de entrar.</p>' +
          '</div>'
      },

      // 1 — Junio: la idea, en secreto
      {
        dur: 9,
        bg: 'radial-gradient(120% 85% at 80% 5%, #2A2CC0 0%, #1512D6 45%, #0E0B9E 100%)',
        clase: 'bv-s--rel',
        html:
          '<div class="bv-decor">' + ARTE_LIBRETA + '</div>' +
          '<div class="bv-decor--fondo">' + flotantes([
            ['🤫', 78, -5, 15, 24], ['✦', 40, 6, 12, 12], ['✦', 88, 9, 13, 10]
          ]) + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Junio</p>' +
            '<h3 class="bv-h3">Empezó en una libreta</h3>' +
            '<p class="bv-sub">Una idea: hacerte una app solo para ti. Y me lo he callado ' +
              'todo este tiempo — el verano entero guardándome el secreto.</p>' +
          '</div>'
      },

      // 2 — El verano, de noche, pieza a pieza
      {
        dur: 10,
        bg: 'radial-gradient(120% 85% at 20% 8%, #145C8A 0%, #1E2E9E 50%, #160B5B 100%)',
        clase: 'bv-s--rel bv-s--fases',
        html:
          '<div class="bv-decor">' +
            fasesLista(['El armazón', 'Las canciones', 'El reproductor',
              'El calendario', 'La grabadora']) +
          '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Julio y agosto</p>' +
            '<h3 class="bv-h3">De noche, pieza a pieza</h3>' +
            '<p class="bv-sub">Cuando ya roncabas. Semana a semana, un trozo más. ' +
              'Y tú, con el mismo estribillo sin que te saliera.</p>' +
          '</div>'
      },

      // 3 — Los números (162)
      {
        dur: 7,
        bg: 'radial-gradient(120% 90% at 82% 10%, #4A1D8F 0%, #2E1466 45%, #160B3B 100%)',
        clase: 'bv-s--rel bv-s--curro',
        html:
          '<div class="bv-decor bv-decor--fondo">' +
            '<svg class="bv-luna" viewBox="0 0 100 100" aria-hidden="true">' +
              '<path d="M62 8a42 42 0 1 0 30 74A34 34 0 0 1 62 8z"/></svg>' +
            flotantes([
              ['✦', 14, 0, 13, 13], ['✦', 82, 3, 15, 14], ['✧', 50, 6, 14, 12]
            ]) +
          '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Lo que llevó</p>' +
            '<div class="bv-num"><span data-cuenta="162">0</span></div>' +
            '<p class="bv-h2">versiones</p>' +
            '<p class="bv-sub">Que si los PDF, que si el audio, que si se cerraba sola… ' +
              'Todo, de madrugada.</p>' +
            '<div class="bv-codigo">' +
              '<span class="bv-codigo__num"><span data-cuenta="44697" data-sep>0</span></span>' +
              '<span class="bv-codigo__pie">líneas de código, escritas una a una</span>' +
            '</div>' +
          '</div>'
      },

      // 4 — Septiembre + por qué (lleva al drop)
      {
        dur: 10,
        bg: 'radial-gradient(120% 90% at 30% 0%, #3B39E8 0%, #1512D6 45%, #6E2CC9 100%)',
        clase: 'bv-s--rel bv-s--portada',
        html:
          '<div class="bv-decor">' + ARTE_CORAZON + '</div>' +
          '<div class="bv-decor--fondo bv-decor--cierre">' +
            '<span class="bv-cae" style="left:18%;--d:0s;--dur:7s">♥</span>' +
            '<span class="bv-cae" style="left:78%;--d:2.4s;--dur:7.6s">♥</span>' +
          '</div>' +
          '<div class="bv-in bv-in--centro">' +
            '<p class="bv-eyebrow">Septiembre</p>' +
            '<h2 class="bv-h1">Y aquí está</h2>' +
            '<p class="bv-sub">Tres meses a escondidas, para tu cumpleaños. Ya no tienes ' +
              'excusa para no estudiar. Para desafinar tampoco, pero eso ya lo sabíamos.</p>' +
          '</div>'
      },

      /* ============  ACTO 2 — CÓMO FUNCIONA  (tras el drop)  ============
         `dur` = segundos reales; aquí la duración de la canción ya da igual. */

      // 5 — Sesiones
      {
        dur: 10,
        bg: 'radial-gradient(120% 85% at 15% 5%, #12796B 0%, #16408A 55%, #1512D6 100%)',
        clase: 'bv-s--sesiones',
        html:
          '<div class="bv-decor">' + agrupaCanciones() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Sesiones</p>' +
            '<h3 class="bv-h3">Los ensayos, guardados</h3>' +
            '<p class="bv-sub">Metes el ensayo entero o una canción suelta y a estudiar. ' +
              'Se acabó buscar el audio bueno entre mil notas de voz.</p>' +
          '</div>'
      },

      // 5b — Estados de cada canción (Pendiente / En progreso / Aprendida)
      {
        dur: 11,
        bg: 'radial-gradient(120% 85% at 18% 6%, #2E7D5B 0%, #285AA6 50%, #1512D6 100%)',
        clase: 'bv-s--estados',
        html:
          '<div class="bv-decor bv-decor--estados">' + estadosCanciones() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Tu repertorio</p>' +
            '<h3 class="bv-h3">De pendiente<br>a aprendida</h3>' +
            '<p class="bv-sub">Marca cada canción como <b>Pendiente</b>, <b>En progreso</b> o ' +
              '<b>Aprendida</b>. De un vistazo sabes qué te falta y cómo vas ganando terreno.</p>' +
          '</div>'
      },

      // 6 — Modo estudio
      {
        dur: 11,
        bg: 'radial-gradient(120% 85% at 85% 8%, #B4600E 0%, #7A1D6B 55%, #2E1466 100%)',
        clase: 'bv-s--estudio',
        html:
          '<div class="bv-decor bv-decor--estudio">' +
            velIlustra() +
            pianoMelodia() +
          '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Modo estudio</p>' +
            '<h3 class="bv-h3">Cada canción, por dentro</h3>' +
            '<p class="bv-sub">La letra a la vista, el audio a cámara lenta para pillar los ' +
              'pasajes rápidos y un piano que te da el tono de entrada.</p>' +
          '</div>'
      },

      // 6b — Fusión: letra en directo (karaoke) + IA que pronuncia y traduce
      {
        dur: 14,
        bg: 'radial-gradient(120% 85% at 78% 6%, #2A2CC0 0%, #4A1D8F 52%, #16086B 100%)',
        clase: 'bv-s--ia bv-s--letralive',
        html:
          '<div class="bv-decor bv-decor--ia bv-decor--letralive">' + iaLetraIlustra() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow bv-eyebrow--gem">' +
              '<span class="bv-gem-ic">' + estrellaGemini('bv-gem-a') + '</span>' +
              '<span class="bv-gem-tx">Con Gemini 3.8 Flash</span>' +
            '</p>' +
            '<h3 class="bv-h3">La letra, en directo<br>y en tu idioma</h3>' +
            '<p class="bv-sub">Le das al play y la app va encendiendo el verso exacto que suena. ' +
              'A la vez, la IA de Google te escribe cómo se pronuncia y te traduce la letra ' +
              'entera, aunque la canción esté en euskera, latín o alemán.</p>' +
          '</div>'
      },

      // 6c — De memoria: el juego que le hace aprenderse la letra
      {
        dur: 11,
        bg: 'radial-gradient(120% 85% at 22% 6%, #1E7A4E 0%, #2A2CC0 52%, #16086B 100%)',
        clase: 'bv-s--memo',
        html:
          '<div class="bv-decor bv-decor--memo">' + memoIlustra() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">De memoria</p>' +
            '<h3 class="bv-h3">Sin mirar la letra</h3>' +
            '<p class="bv-sub">Un juego tapa versos al azar y tú los completas. Te pone nota, ' +
              'guarda tu mejor marca y, canción a canción, te la acabas sabiendo entera.</p>' +
          '</div>'
      },

      // 7 — Control desde la pantalla de bloqueo / notificaciones
      {
        dur: 11,
        bg: 'radial-gradient(120% 85% at 25% 4%, #3B39E8 0%, #1512D6 52%, #0E0B9E 100%)',
        clase: 'bv-s--lock',
        html:
          '<div class="bv-decor">' + reproductorBloqueo() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Sin abrir la app</p>' +
            '<h3 class="bv-h3">Manéjalo desde fuera</h3>' +
            '<p class="bv-sub">Play, atrás, velocidad y repetir salen en la pantalla de bloqueo ' +
              'y bajando las notificaciones. En el coche o fregando, sin desbloquear nada.</p>' +
          '</div>'
      },

      // 8 — Práctica (calendario + racha)
      {
        dur: 10,
        bg: 'radial-gradient(120% 85% at 20% 5%, #C6362E 0%, #7A1D6B 55%, #2E1466 100%)',
        clase: 'bv-s--practica',
        html:
          '<div class="bv-decor bv-decor--practica">' +
            '<div class="bv-cal" aria-hidden="true">' + celdasCal() + '</div>' +
          '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Práctica</p>' +
            '<h3 class="bv-h3">Tu constancia,<br>a la vista&nbsp;🔥</h3>' +
            '<p class="bv-sub">Apunta sola cada día que ensayas y te lleva la racha. ' +
              'Como el Duolingo, pero cantando peor.</p>' +
          '</div>'
      },

      // 9 — Logros y medallas
      {
        dur: 10,
        bg: 'radial-gradient(120% 85% at 78% 6%, #B4600E 0%, #C6362E 50%, #6E2CC9 100%)',
        clase: 'bv-s--logros',
        html:
          '<div class="bv-decor">' + medallas() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Logros</p>' +
            '<h3 class="bv-h3">Medallas por currártelo</h3>' +
            '<p class="bv-sub">Por cada racha y cada meta, una medalla. Colecciónalas: ' +
              'es lo más cerca que vas a estar de un premio cantando ;)</p>' +
          '</div>'
      },

      // 10 — Conciertos + recuerdos
      {
        dur: 12,
        bg: 'radial-gradient(120% 85% at 20% 8%, #17805C 0%, #1E2E9E 55%, #2E1466 100%)',
        clase: 'bv-s--conci',
        html:
          '<div class="bv-decor">' + conciertoRecuerdo() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Conciertos</p>' +
            '<h3 class="bv-h3">El día grande, guardado</h3>' +
            '<p class="bv-sub">Marca el concierto en el calendario. Y cuando pase, guarda ' +
              'el recuerdo: una foto y cuatro palabras. Para acordarte dentro de años.</p>' +
          '</div>'
      },

      // 11 — Programa de concierto (las canciones en orden, para ensayar el pase)
      {
        dur: 14,
        bg: 'radial-gradient(120% 85% at 80% 6%, #17805C 0%, #16408A 52%, #1512D6 100%)',
        clase: 'bv-s--programa',
        html:
          '<div class="bv-decor">' + programaConcierto() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Programa de concierto</p>' +
            '<h3 class="bv-h3">Ensaya el pase entero</h3>' +
            '<p class="bv-sub">Montas el programa del concierto: eliges las canciones, las ' +
              'pones en el orden real y las cantas seguidas, como en el escenario. Así llegas ' +
              'al día grande con el pase por la mano.</p>' +
          '</div>'
      },

      // 12 — Grabaciones
      {
        dur: 9,
        bg: 'radial-gradient(120% 85% at 80% 10%, #A11133 0%, #4A1D8F 55%, #160B3B 100%)',
        clase: 'bv-s--grab',
        html:
          '<div class="bv-decor bv-decor--grab">' +
            '<div class="bv-mic" aria-hidden="true">' +
              '<span class="bv-ring" style="--i:0"></span>' +
              '<span class="bv-ring" style="--i:1"></span>' +
              '<span class="bv-ring" style="--i:2"></span>' +
              '<span class="bv-mic__btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
                '<rect x="9" y="2.5" width="6" height="12" rx="3"/>' +
                '<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg></span>' +
            '</div>' +
          '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Grabaciones</p>' +
            '<h3 class="bv-h3">Escúchate</h3>' +
            '<p class="bv-sub">Te grabas cantando, te escuchas y sufres un poco. Es sano. ' +
              'Nosotros llevamos años.</p>' +
          '</div>'
      },

      // 12 — Compartir (ensayos y grabaciones por WhatsApp)
      {
        dur: 11,
        bg: 'radial-gradient(120% 85% at 20% 8%, #1E7A4E 0%, #16408A 55%, #1512D6 100%)',
        clase: 'bv-s--compartir',
        html:
          '<div class="bv-decor">' + compartirIlustra() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Compartir</p>' +
            '<h3 class="bv-h3">Pásaselo a quien quieras</h3>' +
            '<p class="bv-sub">Un ensayo entero, un trozo suelto o una grabación tuya: ' +
              'se lo mandas por WhatsApp a una compañera y a seguir. Dos toques.</p>' +
          '</div>'
      },

          // 12c — Copia de seguridad (tranquilidad: nada se pierde)
      {
        dur: 10,
        bg: 'radial-gradient(120% 85% at 22% 6%, #12796B 0%, #1E2E9E 52%, #1512D6 100%)',
        clase: 'bv-s--nube',
        html:
          '<div class="bv-decor bv-decor--nube">' + nubeCopia() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Tranquila</p>' +
            '<h3 class="bv-h3">Nunca se pierde nada</h3>' +
            '<p class="bv-sub">Cada semana, sola y sin que te enteres, la app guarda una copia ' +
              'de todo: canciones, notas, racha, marcas. Si algún día cambias de móvil, ' +
              'no empiezas de cero.</p>' +
          '</div>'
      },

      // 13 — Notificaciones
      {
        dur: 11,
        bg: 'radial-gradient(120% 85% at 50% 0%, #3B39E8 0%, #6E2CC9 55%, #2E1466 100%)',
        clase: 'bv-s--notis',
        html:
          '<div class="bv-decor">' + notisMovil() + '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Avisos</p>' +
            '<h3 class="bv-h3">El móvil te dará la lata</h3>' +
            '<p class="bv-sub">Con cariño: si tienes racha y no has ensayado, el día de un ' +
              'concierto, cuando salga el resumen del mes, en fechas señaladas… Sin agobiar.</p>' +
          '</div>'
      },

      // 14 — Resumen del mes
      {
        dur: 10,
        bg: 'radial-gradient(120% 90% at 50% 0%, #6E2CC9 0%, #C6362E 55%, #B4600E 100%)',
        clase: 'bv-s--resumen',
        html:
          '<div class="bv-decor bv-decor--resumen">' +
            '<div class="bv-barras" aria-hidden="true">' +
              barra(58, '#FFD9A0', 0) + barra(82, '#FFB4A8', 1) + barra(40, '#E7C7FF', 2) +
              barra(96, '#FFE07A', 3) + barra(66, '#B9F0DE', 4) + barra(48, '#FFC0D6', 5) +
              barra(74, '#C6C4FF', 6) +
            '</div>' +
          '</div>' +
          '<div class="bv-in">' +
            '<p class="bv-eyebrow">Cada mes</p>' +
            '<h3 class="bv-h3">Un resumen tuyo</h3>' +
            '<p class="bv-sub">A fin de mes, todo lo que hiciste, pantalla a pantalla. ' +
              'Como el resumen de Spotify, pero desafinando. Y uno especial de fin de año.</p>' +
          '</div>'
      },

      // 15 — Cierre
      {
        bg: 'radial-gradient(120% 85% at 25% 0%, #3B39E8 0%, #1512D6 40%, #6E2CC9 100%)',
        clase: 'bv-s--cierre',
        html:
          '<div class="bv-decor bv-decor--fondo bv-decor--cierre">' +
            '<span class="bv-cae" style="left:14%;--d:0s;--dur:6s">♥</span>' +
            '<span class="bv-cae" style="left:38%;--d:1.4s;--dur:7s">♪</span>' +
            '<span class="bv-cae" style="left:62%;--d:2.6s;--dur:6.5s">♥</span>' +
            '<span class="bv-cae" style="left:82%;--d:0.8s;--dur:7.5s">♫</span>' +
          '</div>' +
          '<div class="bv-in bv-in--centro">' +
            '<span class="bv-check" aria-hidden="true">' +
              '<svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="24"/>' +
              '<path d="M17 29l7 7 15-16"/></svg>' +
            '</span>' +
            '<h2 class="bv-h1">Feliz cumpleaños,<br>Ama</h2>' +
            '<p class="bv-sub">Ábrela cada día y acuérdate de que ' +
              'alguien se comió el verano montándola para que tú cantes un poco menos mal.</p>' +
            '<button type="button" class="bv-cta" data-entrar>Entrar' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
              'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg>' +
            '</button>' +
            '<p class="bv-firma"><span class="bv-firma__tx">— Endika</span>' +
              '<i class="bv-firma__pluma" aria-hidden="true"></i></p>' +
          '</div>'
      }
    ];
  }


  function celdasCal() {
    // 14 celdas (dos semanas). Marcadas = practicó; la penúltima "late" (hoy).
    var on = { 0: 1, 1: 1, 3: 1, 4: 1, 5: 1, 8: 1, 9: 1, 11: 1, 12: 1 };
    var s = '';
    for (var i = 0; i < 14; i++) {
      var cls = 'bv-celda';
      if (on[i]) cls += ' is-on';
      if (i === 12) cls += ' is-hoy';
      s += '<i class="' + cls + '" style="--i:' + i + '"></i>';
    }
    return s;
  }

  function barra(h, color, i) {
    return '<i style="--h:' + h + '%;--c:' + color + ';--i:' + i + '"></i>';
  }

  /* ---------- Montaje ---------- */
  /* RENDIMIENTO — los estilos de la bienvenida (96 KB) viven en su propia
     hoja, css/bienvenida.css, y no en styles.css: son para una pantalla que
     se ve UNA vez en la vida de la app, y ahí dentro pesaban en cada
     recálculo de estilo para siempre. Se traen aquí, justo antes de abrir.
     Hay que ESPERAR a que estén aplicados: si no, se vería un fotograma de
     la presentación sin estilos. */
  var _cssPedido = null;
  function cargarEstilos() {
    if (_cssPedido) return _cssPedido;
    _cssPedido = new Promise(function (listo) {
      if (document.querySelector('link[data-bv-css]')) return listo();
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'css/bienvenida.css';
      l.setAttribute('data-bv-css', '');
      // Pase lo que pase se sigue: mejor la bienvenida sin adornos que
      // una pantalla en negro esperando a un fichero que no llega.
      l.onload = l.onerror = function () { listo(); };
      document.head.appendChild(l);
      setTimeout(listo, 3000);
    });
    return _cssPedido;
  }

  function abrir() {
    if (raiz) return;
    // Primera llamada: traer la hoja y volver a entrar cuando esté lista.
    if (!_cssLista) {
      cargarEstilos().then(function () { _cssLista = true; abrir(); });
      return;
    }
    idx = 0;
    var datos = sectores();
    calcularTiempos(datos);

    raiz = document.createElement('div');
    raiz.className = 'bv' + (reducido() ? ' bv--sin-motion' : '');
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-label', 'Bienvenida a ChorApp');

    // Capas de fondo: una por sector, a pantalla COMPLETA de `.bv` (cubren
    // también la barra de arriba y el pie — si no, esas zonas se ven con la
    // base oscura). Fundido cruzado al cambiar de sector.
    var capasFondo = datos.map(function (s, i) {
      return '<i class="bv-fondo" style="background:' + s.bg + ';opacity:' + (i === 0 ? 1 : 0) + '"></i>';
    }).join('');

    // La barra de progreso muestra los sectores del acto en curso.
    var segmentos = construirProgreso(IDX_ACTO2);

    var secciones = datos.map(function (s, i) {
      return '<section class="bv-slide ' + (s.clase || '') + '" data-slide="' + i + '"' +
        (i === 0 ? '' : ' hidden') + '>' + s.html + '</section>';
    }).join('');

    raiz.innerHTML =
      '<div class="bv-fondos" aria-hidden="true">' + capasFondo + '</div>' +
      '<span class="bv-pausa" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' +
      '</span>' +
      '<div class="bv-top">' +
        '<div class="bv-prog">' + segmentos + '</div>' +
        '<button type="button" class="bv-saltar" data-saltar>Saltar</button>' +
      '</div>' +
      '<div class="bv-slides">' + secciones + '</div>' +
      // Fuerza a cargar/rasterizar la fuente Caveat YA (solo se usa en la
      // firma del cierre; si carga justo al llegar allí, parpadea).
      '<span aria-hidden="true" style="position:fixed;left:-9999px;top:0;' +
        'font-family:\'Caveat\',cursive;font-weight:700;font-size:34px;opacity:0">Endika</span>' +
      // Resplandor del marco al llegar al cierre (solo opacidad).
      '<div class="bv-luz" aria-hidden="true"></div>' +
      '<div class="bv-pie">' +
        '<p class="bv-hint is-fuera" data-hint></p>' +
      '</div>' +
      // Portada a pantalla completa: no empieza nada hasta pulsar el botón.
      '<div class="bv-gate" data-gate>' +
        '<div class="bv-gate__fondo" aria-hidden="true"></div>' +
        '<div class="bv-gate__in">' +
          AURICULARES +
          '<h2 class="bv-gate__h">Ponte los<br>auriculares</h2>' +
          '<p class="bv-gate__p">Esta bienvenida va con música y con retranca. ' +
            'Con los cascos puestos se disfruta de verdad.</p>' +
          '<button type="button" class="bv-cta" data-listo>Ya los llevo puestos' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M12 5l7 7-7 7"/></svg>' +
          '</button>' +
          '<button type="button" class="bv-gate__saltar" data-saltar>Saltar la bienvenida</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(raiz);
    document.body.classList.add('bv-abierta');
    slides = Array.prototype.slice.call(raiz.querySelectorAll('.bv-slide'));
    fondos = Array.prototype.slice.call(raiz.querySelectorAll('.bv-fondo'));

    raiz.addEventListener('click', onClick);
    // Los botones no deben robar el foco al tocarlos: si alguno queda a
    // ras del borde inferior (pantallas bajas), el WebView haría
    // scroll-into-view y el contenido "saltaría" justo antes de animar.
    raiz.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('button')) {
        e.preventDefault();
      }
    }, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibilidad);
    // Mantener pulsado en cualquier parte = pausa (como en las historias).
    raiz.addEventListener('pointerdown', onHoldStart);
    raiz.addEventListener('pointerup', onHoldEnd);
    raiz.addEventListener('pointercancel', onHoldEnd);
    raiz.addEventListener('pointerleave', onHoldEnd);

    void raiz.offsetHeight;
    raiz.classList.add('is-abierta');
    empezado = false; acto = 1; rematando = false;
    // Nada arranca hasta que Ama pulsa "Ya los llevo puestos" en la portada.
  }

  /* Ama ha confirmado los auriculares: se funde la portada y empiezan
     los sectores con música. */
  function empezar() {
    if (empezado || rematando) return;
    empezado = true;
    vibrar('suave');

    var gate = raiz.querySelector('[data-gate]');
    if (gate) {
      gate.classList.add('is-ido');
      window.setTimeout(function () { if (gate) gate.hidden = true; }, 650);
    }

    var h = raiz.querySelector('[data-hint]');
    if (h) {
      h.textContent = 'Se pasa solo · mantén pulsado para parar';
      h.classList.remove('is-fuera');
      window.setTimeout(function () { if (h) h.classList.add('is-fuera'); }, 4600);
    }

    mostrar(0, 1);
    pedirWakeLock();
    arrancarAudio();
    iniMs = _now();
    pausaMs = 0; enPausa = false;
    raf = requestAnimationFrame(tick);
  }

  function construirProgreso(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '<i class="bv-seg"><b></b></i>';
    return s;
  }

  /* ---------- Audio de fondo ---------- */
  function arrancarAudio() {
    try {
      audio = new Audio(AUDIO_SRC);
      audio.preload = 'auto';
      audio.loop = false;
      audio.volume = 0;
      // Al terminar inner-light entra kassandra subiendo muy despacio.
      audio.addEventListener('ended', arrancarAudio2, { once: true });
      var p = audio.play();
      if (p && p.catch) p.catch(function () { armarGesto(); });
      fadeAudio(audio, VOL, 1600);
    } catch (e) { audio = null; }
  }

  /* Segunda pieza (kassandra): arranca desde AUDIO2_DESDE y sube el volumen
     durante AUDIO2_FADE ms. Se llama al acabar inner-light (evento 'ended')
     o, de red, desde tick() si el evento no llega. */
  function arrancarAudio2() {
    if (audio2 || !raiz || rematando) return;
    try {
      audio2 = new Audio(AUDIO_SRC2);
      audio2.preload = 'auto';
      audio2.loop = false;
      audio2.volume = 0;
      var alSitio = function () {
        try { if (audio2.currentTime < AUDIO2_DESDE) audio2.currentTime = AUDIO2_DESDE; } catch (e) {}
      };
      audio2.addEventListener('loadedmetadata', alSitio, { once: true });
      var p = audio2.play();
      if (p && p.catch) p.catch(function () {});
      alSitio();
      fadeAudio(audio2, VOL, AUDIO2_FADE);
      // Si la bienvenida estaba en pausa justo al hacer el relevo, congela
      // también la nueva pieza (reanudar() la vuelve a poner en marcha).
      if (enPausa) { try { audio2.pause(); } catch (e) {} }
    } catch (e) { audio2 = null; }
  }

  // Si el navegador bloquea el autoplay (en el APK no pasa), arrancar al
  // primer toque/tecla.
  function armarGesto() {
    function go() {
      quitar();
      if (!audio) return;
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
      fadeAudio(audio, VOL, 1200);
    }
    function quitar() {
      document.removeEventListener('pointerdown', go, true);
      document.removeEventListener('keydown', go, true);
      document.removeEventListener('touchstart', go, true);
    }
    document.addEventListener('pointerdown', go, true);
    document.addEventListener('keydown', go, true);
    document.addEventListener('touchstart', go, true);
  }

  /* ---------- Línea de tiempo (sincronizada con la música) ---------- */
  function tick() {
    if (!raiz || rematando) return;
    var t = ahoraSeg();

    if (acto === 1) {
      // Sector que toca según el segundo.
      var n = 0;
      for (var i = 0; i < IDX_ACTO2; i++) if (t >= BORDES[i]) n = i;
      if (n !== idx) mostrar(n, n > idx ? 1 : -1);

      var frac = (t - BORDES[idx]) / Math.max(0.001, BORDES[idx + 1] - BORDES[idx]);
      pintarProgreso(0, idx, frac);

      // Fin del ACTO 1: cuando la instrumental rompe. Si el audio suena,
      // clavado a él; si no llegó a sonar, por reloj (con un pelín de margen).
      var porAudio = audio && !audio.paused && audio.currentTime >= DROP;
      if (porAudio || t >= DROP + 0.35) { pasarActo2(); }
    } else {
      var t2 = t - DROP;
      var m = 0;
      for (var j = 0; j < ACTO2_BORDES.length - 1; j++) if (t2 >= ACTO2_BORDES[j]) m = j;
      var destino = IDX_ACTO2 + m;
      if (destino !== idx && destino < slides.length) mostrar(destino, 1);

      var ultima = idx === slides.length - 1;
      var k = idx - IDX_ACTO2;
      var f2 = ultima ? 1
        : (t2 - ACTO2_BORDES[k]) / Math.max(0.001, ACTO2_BORDES[k + 1] - ACTO2_BORDES[k]);
      pintarProgreso(IDX_ACTO2, idx, f2);

      // Relevo a kassandra si el evento 'ended' de inner-light no llegó
      // (algunos WebView no lo disparan si la pestaña estuvo en 2º plano).
      if (!audio2 && audio && !enPausa && audio.duration &&
          (audio.ended || audio.currentTime >= audio.duration - 0.4)) {
        arrancarAudio2();
      }
      // El cierre NO entra solo: espera a que Ama pulse "Entrar".
    }

    raf = requestAnimationFrame(tick);
  }

  // Pinta la barra: segStart = sector del primer segmento; cur = sector
  // actual; frac = avance (0-1) dentro del sector actual. La barra NO necesita
  // 120 fps: se refresca ~1 de cada 5 frames y los `.bv-seg b` se cachean
  // (antes se hacía un `querySelectorAll` por frame).
  var _progT = 0;
  function pintarProgreso(segStart, cur, frac) {
    if ((_progT++ % 5) !== 0) return;
    var segs = raiz._segs;
    if (!segs) segs = raiz._segs = Array.prototype.map.call(
      raiz.querySelectorAll('.bv-seg'), function (s) { return s.firstElementChild; });
    for (var i = 0; i < segs.length; i++) {
      var b = segs[i];
      if (!b) continue;
      var sec = segStart + i;
      var p = sec < cur ? 1 : sec > cur ? 0 : frac;
      b.style.transform = 'scaleX(' + Math.max(0, Math.min(1, p)) + ')';
    }
  }

  /* La instrumental ha roto: empieza el ACTO 2 (cómo funciona). */
  function pasarActo2() {
    if (acto === 2) return;
    acto = 2;
    vibrar('fuerte');   // se nota el "drop" también en la mano

    // Golpe corto (no cierra: seguimos).
    raiz.classList.add('bv--pulso');
    window.setTimeout(function () {
      if (raiz) raiz.classList.remove('bv--pulso');
    }, 460);

    // La barra pasa a mostrar los sectores del ACTO 2 (sin contar el cierre).
    var prog = raiz.querySelector('.bv-prog');
    if (prog) prog.innerHTML = construirProgreso(slides.length - 1 - IDX_ACTO2);
    raiz._segs = null;   // se recachea (la barra se ha reconstruido)

    // Recuérdale que se sigue pasando solo.
    var h = raiz.querySelector('[data-hint]');
    if (h) {
      h.textContent = 'Cómo funciona · se sigue pasando solo';
      h.classList.remove('is-fuera');
      window.setTimeout(function () { if (h) h.classList.add('is-fuera'); }, 3800);
    }

    mostrar(IDX_ACTO2, 1);
  }

  /* ---------- Pausa (mantener pulsado) ---------- */
  function onHoldStart(e) {
    if (rematando || !empezado) return;
    if (e.target && e.target.closest &&
        e.target.closest('[data-saltar],[data-entrar],.bv-confirm')) return;
    if (raiz && raiz.querySelector('.bv-confirm')) return;
    window.clearTimeout(holdT);
    holdT = window.setTimeout(pausar, 240);
  }
  function onHoldEnd() {
    window.clearTimeout(holdT);
    if (enPausa && !document.hidden) reanudar();
  }

  // Si Ama sale de la app a media bienvenida (una llamada, p. ej.), se
  // congela todo; al volver, sigue donde estaba en vez de dar un salto.
  function onVisibilidad() {
    if (!empezado || rematando) return;
    if (document.hidden) pausar();
    else { reanudar(); if (empezado && !rematando) pedirWakeLock(); }
  }
  function pausar() {
    if (enPausa || rematando) return;
    enPausa = true;
    pausaIni = _now();
    if (audio) { try { audio.pause(); } catch (e) {} }
    if (audio2) { try { audio2.pause(); } catch (e) {} }
    raiz.classList.add('is-pausa');
  }
  function reanudar() {
    if (!enPausa) return;
    pausaMs += _now() - pausaIni;
    enPausa = false;
    if (audio) { var p = audio.play(); if (p && p.catch) p.catch(function () {}); }
    if (audio2) { var p2 = audio2.play(); if (p2 && p2.catch) p2.catch(function () {}); }
    raiz.classList.remove('is-pausa');
  }

  /* RENDIMIENTO — el "mini parpadeo" al cambiar de sector.

     Antes todo esto pasaba en la MISMA tarea: se descubría el sector nuevo
     (`hidden = false`, o sea display:none → flex, que obliga a maquetar de
     cero una ilustración a pantalla completa), se forzaba ese maquetado con
     `void offsetWidth`, y acto seguido se arrancaban las dos transiciones y
     el fundido de los 16 fondos. El WebView tenía que maquetar, rasterizar
     una pantalla entera y empezar a animar todo en el mismo fotograma: se
     lo saltaba, y ese fotograma perdido es el parpadeo.

     Ahora va en dos tiempos:
       Fotograma A — se congela la decoración, se descubre el sector en su
                     posición de entrada y se fuerza su maquetado. Nada se
                     mueve todavía, así que el WebView puede rasterizar
                     tranquilo aunque tarde.
       Fotograma B — ya está todo pintado: se sueltan las transiciones, que
                     a partir de ahí son solo opacidad y desplazamiento. */
  function mostrar(n, dir) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    dir = dir || 1;
    var prev = idx;
    idx = n;
    var cambia = prev !== n;

    slides.forEach(function (el, i) {
      if (i === n || i === prev) return;
      el.hidden = true;
      el.className = el.className.replace(/\s*is-(activo|ent-izq|ent-der|sal-izq|sal-der)/g, '');
    });

    var entra = slides[n];

    /* ---- Fotograma A: preparar, sin mover nada ---- */
    // La decoración se congela ANTES de descubrir el sector, no después:
    // así no hay decenas de animaciones arrancando justo mientras el
    // WebView rasteriza la ilustración nueva.
    if (cambia) {
      raiz.classList.add('bv--transicion');
      window.clearTimeout(raiz._trT);
      raiz._trT = window.setTimeout(function () {
        if (raiz) raiz.classList.remove('bv--transicion');
      }, 510);
    }
    entra.hidden = false;
    entra.classList.remove('is-sal-izq', 'is-sal-der', 'is-activo');
    if (cambia) entra.classList.add(dir < 0 ? 'is-ent-izq' : 'is-ent-der');
    void entra.offsetWidth;   // maquetar AHORA, mientras no hay nada animando

    /* ---- Fotograma B: arrancar las transiciones ---- */
    function arrancar() {
      if (slides[idx] !== entra) return;   // ya se ha pasado a otro sector

      entra.classList.remove('is-ent-izq', 'is-ent-der');
      entra.classList.add('is-activo');

      if (cambia && slides[prev]) {
        var sale = slides[prev];
        sale.classList.remove('is-activo', 'is-ent-izq', 'is-ent-der');
        sale.classList.add(dir < 0 ? 'is-sal-der' : 'is-sal-izq');
        window.clearTimeout(sale._t);
        sale._t = window.setTimeout(function () {
          if (!sale.classList.contains('is-activo')) sale.hidden = true;
        }, 500);
      }

      // Fondo en fundido cruzado.
      fondos.forEach(function (f, i) { f.style.opacity = i === n ? 1 : 0; });

      // El cierre, TODO ESCALONADO para que nada compita con nada:
      //   0 ms    : entra el sector (deslizamiento + fondo + texto + check)
      //   ~480 ms : `bv--precierre` — ya asentada la transición, promovemos la
      //             capa de luz (opacidad casi nula, se rasteriza tranquila)
      //   ~2900 ms: `bv--cierre` — cuando YA HA TERMINADO de escribirse la
      //             firma "— Endika" (entra a los 1100 ms, dura 1700 ms), los
      //             bordes se encienden y se quedan brillando más y menos.
      var esCierre = entra.classList.contains('bv-s--cierre');
      window.clearTimeout(raiz._cierreT);
      window.clearTimeout(raiz._cierreT2);
      if (esCierre) {
        raiz._cierreT = window.setTimeout(function () {
          if (raiz && slides[idx] === entra) raiz.classList.add('bv--precierre');
        }, 480);
        raiz._cierreT2 = window.setTimeout(function () {
          if (raiz && slides[idx] === entra) raiz.classList.add('bv--cierre');
        }, 2900);
      } else {
        raiz.classList.remove('bv--cierre', 'bv--precierre');
      }

      lanzarExtras(entra, prev, n);
    }

    // Dos fotogramas: el primero acaba de maquetar, el segundo ya pinta.
    // Sin cambio de sector (la primera vez) no hay nada que esperar.
    if (!cambia) arrancar();
    else requestAnimationFrame(function () { requestAnimationFrame(arrancar); });
  }

  /* Cosas que se disparan al mostrar un sector (contadores, toque háptico). */
  function lanzarExtras(entra, prev, n) {

    // Contador de las cifras grandes (una sola vez, escalonadas).
    var cuentas = entra.querySelectorAll('[data-cuenta]');
    Array.prototype.forEach.call(cuentas, function (cuenta, i) {
      if (cuenta._hecho) return;
      cuenta._hecho = true;
      window.setTimeout(function () {
        contarHasta(cuenta, cuenta.getAttribute('data-cuenta'));
      }, 260 + i * 520);
    });

    // Un toque cuando la chincheta se clava en el calendario.
    if (prev !== n && entra.classList.contains('bv-s--conci')) {
      window.clearTimeout(entra._vib);
      entra._vib = window.setTimeout(function () {
        if (raiz && slides[idx] === entra) vibrar('suave');
      }, 1200);
    }
  }

  /* ---------- Interacción ---------- */
  function onClick(e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('[data-listo]')) { empezar(); return; }
    if (e.target.closest('[data-entrar]')) { terminar(false); return; }
    if (e.target.closest('[data-confirm-si]')) { cerrarConfirm(); terminar(true); return; }
    if (e.target.closest('[data-confirm-no]')) { cerrarConfirm(); return; }
    if (e.target.closest('[data-saltar]')) { pedirConfirmSalir(); }
  }
  function onKey(e) {
    if (!raiz) return;
    if (e.key === 'Escape') {
      if (raiz.querySelector('.bv-confirm')) cerrarConfirm();
      else pedirConfirmSalir();
    }
  }

  /* Antes de saltar, un aviso: solo se ve una vez. */
  function pedirConfirmSalir() {
    if (!raiz || rematando || raiz.querySelector('.bv-confirm')) return;
    if (empezado && !enPausa) pausar();
    var d = document.createElement('div');
    d.className = 'bv-confirm';
    d.innerHTML =
      '<div class="bv-confirm__caja">' +
        '<p class="bv-confirm__tx">¿Seguro? Esto solo se ve una vez.</p>' +
        '<div class="bv-confirm__bts">' +
          '<button type="button" class="bv-confirm__seguir" data-confirm-no>Seguir viendo</button>' +
          '<button type="button" class="bv-confirm__salir" data-confirm-si>Salir igual</button>' +
        '</div>' +
      '</div>';
    raiz.appendChild(d);
    void d.offsetHeight;
    d.classList.add('is-visible');
  }
  function cerrarConfirm() {
    var d = raiz && raiz.querySelector('.bv-confirm');
    if (!d) return;
    d.classList.remove('is-visible');
    window.setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 260);
    if (empezado && enPausa && !document.hidden && !rematando) reanudar();
  }

  function marcarVista() {
    try {
      if (window.Almacen) window.Almacen.guardar(CLAVE, { v: VERSION, fecha: Date.now() });
    } catch (e) {}
  }

  /* Fin: rapido=true -> "Saltar"/Esc (corta rápido y sin fanfarria).
     rapido=false -> "Entrar": zoom hacia dentro de la app y la música
     se apaga poco a poco. */
  function terminar(rapido) {
    if (rematando) return;
    rematando = true;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    marcarVista();
    cerrar(rapido);
  }

  function cerrar(rapido) {
    var r = raiz;
    raiz = null; slides = []; fondos = [];
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibilidad);
    window.clearTimeout(holdT);
    soltarWakeLock();
    // `bv-abierta` bloquea el scroll del body. Quitarlo puede reajustar el
    // layout unos px (barra de scroll en navegador) — la barra de nav
    // "se metía para adentro" a media animación. Lo quitamos YA, mientras
    // el overlay aún está opaco y lo tapa todo; cuando empieza el fundido
    // el layout de debajo ya está asentado.
    document.body.classList.remove('bv-abierta');

    [audio, audio2].forEach(function (a) {
      if (!a) return;
      fadeAudio(a, 0, rapido ? 450 : 5200, function () {
        try { a.pause(); a.src = ''; } catch (e) {}
      });
    });
    audio = null; audio2 = null;

    if (!r) return;
    var quita = function () {
      document.body.classList.remove('bv-abierta');
      if (r.parentNode) r.parentNode.removeChild(r);
    };
    if (rapido) {
      r.classList.remove('is-abierta');
      r.addEventListener('transitionend', quita, { once: true });
      setTimeout(quita, 550);
    } else {
      // "Entrar": fundido/fusión con la app (ver `.bv--entrando-app`).
      // No dependemos de transitionend (puede llegar tarde/nunca): lo
      // quitamos por tiempo, cuando el fundido ya ha acabado.
      try {
        // Deshacer cualquier desplazamiento (foco de un botón, sector que
        // desborda) para que el fundido arranque quieto, sin salto.
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        r.scrollTop = 0;
        var _ss = r.querySelector('.bv-slides'); if (_ss) _ss.scrollTop = 0;
        var _sa = r.querySelector('.bv-slide.is-activo'); if (_sa) _sa.scrollTop = 0;
      } catch (e) {}
      // `will-change` un frame ANTES: así el WebView tiene `.bv` ya en su
      // propia capa cuando arranca el fundido → una sola textura, suave.
      r.style.willChange = 'opacity';
      if (!reducido()) document.body.classList.add('bv-aterriza');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (r.parentNode) r.classList.add('bv--entrando-app');
        });
      });
      if (!reducido()) {
        window.setTimeout(function () {
          document.body.classList.remove('bv-aterriza');
        }, 1550);
      }
      setTimeout(quita, reducido() ? 300 : 1420);
    }
  }

  /* ---------- API ---------- */
  function yaVista() {
    try {
      var v = window.Almacen ? window.Almacen.leer(CLAVE) : null;
      return !!(v && v.v);
    } catch (e) { return false; }
  }

  var _cssLista = false;

  function iniciarSiPrimeraVez() {
    if (yaVista() || raiz) return false;
    abrir();
    return true;
  }

  return {
    iniciarSiPrimeraVez: iniciarSiPrimeraVez,
    forzar: abrir,
    reiniciar: function () { try { window.Almacen.borrar(CLAVE); } catch (e) {} }
  };
})();
