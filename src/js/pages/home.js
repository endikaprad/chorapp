/* ============================================================
   Pagina_home — Inicio (resumen del repertorio)
   ============================================================ */

window.Pagina_home = (function () {
  'use strict';

  function iniciar(contenedor) {
    var raiz = contenedor.querySelector('[data-modulo="home"]');
    if (!raiz) return;

    var elAnio = raiz.querySelector('[data-anio]');
    if (elAnio) elAnio.textContent = new Date().getFullYear();

    cargarCoro(raiz);
    pintarFecha(raiz);
    pintarFrase(raiz);
    pintarConcierto(raiz);

    var canciones = window.Canciones ? window.Canciones.listar() : [];
    var sesiones = window.Sesiones ? window.Sesiones.listarVisibles() : [];
    var total = canciones.length;
    var hayContenido = sesiones.length > 0 || total > 0;

    contarHasta(raiz.querySelector('[data-num-canciones]'), total);
    var elCancionesLabel = raiz.querySelector('[data-canciones-label]');
    if (elCancionesLabel) {
      elCancionesLabel.textContent = total === 1
        ? 'canción en tu repertorio'
        : 'canciones en tu repertorio';
    }

    // Racha de días de estudio (practica.js).
    if (window.Practica && window.Practica.revisar) {
      try { window.Practica.revisar(); } catch (e) {}
    }
    var racha = window.Practica ? window.Practica.racha() : 0;
    var elRacha = raiz.querySelector('[data-num-racha]');
    if (elRacha) contarHasta(elRacha, racha);
    var elRachaLabel = raiz.querySelector('[data-racha-label]');
    if (elRachaLabel) elRachaLabel.textContent = racha === 1 ? 'día seguido' : 'días seguidos';

    celebrarHito(racha);

    pintarHoy(raiz, hayContenido);
    pintarSemana(raiz);
    pintarRepasar(raiz);
    mostrarResumenMes();

    var card = raiz.querySelector('[data-continuar]');
    var eyebrow = raiz.querySelector('[data-continuar-eyebrow]');
    var titulo = raiz.querySelector('[data-continuar-titulo]');
    var vacio = raiz.querySelector('[data-vacio]');

    if (!hayContenido) {
      card.disabled = true;
      return;
    }
    if (vacio) vacio.hidden = true;

    // ¿Dónde se quedó estudiando? (lo guarda study.js)
    var ultimo = window.Almacen ? window.Almacen.leer('estudio:ultimo', null) : null;
    var destino = null;
    if (ultimo && ultimo.sesionId && ultimo.marcaId && window.Sesiones) {
      var m = window.Sesiones.obtenerMarca(ultimo.sesionId, ultimo.marcaId);
      if (m) destino = { ruta: 'estudio', datos: { sesionId: ultimo.sesionId, marcaId: ultimo.marcaId }, titulo: m.titulo };
    }
    if (!destino && sesiones.length) {
      var s0 = sesiones[0];
      destino = { ruta: 'sesion', datos: { id: s0.id }, titulo: 'Última sesión del coro' };
    }
    if (!destino) { card.disabled = true; return; }

    card.disabled = false;
    eyebrow.textContent = destino.ruta === 'estudio' ? 'Seguir estudiando' : 'Escuchar el ensayo';
    titulo.textContent = destino.titulo;
    card.addEventListener('click', function () {
      window.App.ir(destino.ruta, { datos: destino.datos });
    });
  }

  /* ----------------------------------------------------------
     Fecha de hoy bajo el saludo — da sensación de continuidad.
     ---------------------------------------------------------- */
  function pintarFecha(raiz) {
    var el = raiz.querySelector('[data-fecha]');
    if (!el) return;
    var hoy = new Date();
    var texto;
    try {
      texto = hoy.toLocaleDateString('es-ES', {
        weekday: 'long', day: 'numeric', month: 'long',
      });
      texto = texto.charAt(0).toUpperCase() + texto.slice(1);
    } catch (e) {
      return; // sin Intl: se queda la frase por defecto del HTML
    }
    el.textContent = texto;
  }

  /* ----------------------------------------------------------
     Racha redonda (7, 14, 30… días) — se felicita una sola vez
     por hito con un aviso cálido.
     ---------------------------------------------------------- */
  function celebrarHito(racha) {
    if (!window.Frases || !window.Frases.hito || !window.UI) return;
    var msg = window.Frases.hito(racha);
    if (!msg) return;
    var CLAVE = 'chorapp:hito-racha';
    var ultimo = 0;
    try { ultimo = parseInt(localStorage.getItem(CLAVE), 10) || 0; } catch (e) {}
    if (racha <= ultimo) return;
    try { localStorage.setItem(CLAVE, String(racha)); } catch (e) {}
    setTimeout(function () {
      window.UI.aviso(msg, { tipo: 'ok', duracion: 5000 });
      try { if (window.Vibra) window.Vibra.logro(); } catch (e) {}
    }, 600);
  }

  /* ----------------------------------------------------------
     Frase del día — un mensaje cálido bajo el saludo. En fechas
     marcadas (cumpleaños, concierto…) aparece resaltada.
     ---------------------------------------------------------- */
  function pintarFrase(raiz) {
    var el = raiz.querySelector('[data-frase]');
    if (!el || !window.Frases) return;
    var f = window.Frases.delDia();
    if (!f || !f.texto) return;
    el.textContent = f.texto;
    el.classList.toggle('frase-dia--especial', !!f.especial);
    el.hidden = false;

    // Fecha marcada (cumpleaños, concierto…): un saludo háptico, una vez al día.
    if (f.especial) {
      var hoy = new Date().toDateString();
      var CLAVE = 'chorapp:vibra-especial';
      var visto = null;
      try { visto = localStorage.getItem(CLAVE); } catch (e) {}
      if (visto !== hoy) {
        try { localStorage.setItem(CLAVE, hoy); } catch (e) {}
        setTimeout(function () {
          try { if (window.Vibra) window.Vibra.acierto(); } catch (e) {}
        }, 500);
      }
    }
  }

  /* ----------------------------------------------------------
     Cuenta atrás para el siguiente concierto del coro. Solo
     aparece si hay uno marcado (hoy o más adelante). Al tocarla
     lleva al calendario de Práctica.
     ---------------------------------------------------------- */
  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  var _timerConcierto = null;

  // Momento exacto del concierto a partir de 'YYYY-MM-DD' + hora ('20:00').
  // Si no hay hora, se asume las 20:00 (habitual en Bihotsak).
  function _momentoConcierto(c) {
    var f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.fecha || '');
    if (!f) return null;
    var h = /(\d{1,2})[:.hH](\d{2})/.exec(c.hora || '');
    var hh = h ? parseInt(h[1], 10) : 20;
    var mm = h ? parseInt(h[2], 10) : 0;
    return new Date(+f[1], +f[2] - 1, +f[3], hh, mm, 0, 0);
  }

  function pintarConcierto(raiz) {
    var btn = raiz.querySelector('[data-concierto]');
    if (!btn || !window.Conciertos || !window.Conciertos.siguiente) return;

    if (_timerConcierto) { clearInterval(_timerConcierto); _timerConcierto = null; }

    var c = window.Conciertos.siguiente();
    if (!c) return;

    var elDias = raiz.querySelector('[data-concierto-dias]');
    var elDet = raiz.querySelector('[data-concierto-detalle]');

    var momento = _momentoConcierto(c);

    // A menos de 24 h (y antes de que termine): cuenta atrás viva de
    // horas, minutos y segundos, refrescada cada segundo.
    function tic() {
      var restante = momento - Date.now();
      if (!document.body.contains(elDias)) {
        clearInterval(_timerConcierto); _timerConcierto = null; return;
      }
      if (restante <= 0) { elDias.textContent = '¡El concierto es ahora!'; return; }
      var s = Math.floor(restante / 1000);
      var hh = Math.floor(s / 3600);
      var mm = Math.floor((s % 3600) / 60);
      var ss = s % 60;
      var partes = [];
      if (hh) partes.push(hh + ' h');
      if (hh || mm) partes.push(mm + ' min');
      partes.push(ss + ' s');
      elDias.textContent = 'Faltan ' + partes.join(' ') + ' para el concierto';
    }

    if (momento && momento - Date.now() > 0 && momento - Date.now() < 86400000) {
      tic();
      _timerConcierto = setInterval(tic, 1000);
    } else if (c.dias === 0) elDias.textContent = '¡Hoy hay concierto!';
    else if (c.dias === 1) elDias.textContent = 'Mañana hay concierto';
    else elDias.textContent = 'Faltan ' + c.dias + ' días para el concierto';

    var partes = [];
    var f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.fecha);
    if (f) {
      var dia = parseInt(f[3], 10);
      var mes = MESES_LARGOS[parseInt(f[2], 10) - 1];
      partes.push(dia + ' de ' + mes);
    }
    if (c.hora) partes.push(c.hora);
    if (c.lugar) partes.push(c.lugar);
    elDet.textContent = partes.join(' · ');

    btn.classList.toggle('cuenta-concierto--hoy', c.dias === 0);

    // A menos de un día para el concierto: los bordes de la tarjeta laten.
    var inminente = c.dias === 0 ||
      (momento && momento - Date.now() > 0 && momento - Date.now() < 86400000);
    btn.classList.toggle('cuenta-concierto--inminente', !!inminente);
    btn.addEventListener('click', function () {
      window.App.ir('conciertos');
    });
    btn.hidden = false;
  }

  /* ----------------------------------------------------------
     Estado de hoy — ¿ya ha estudiado? Recordatorio cálido.
     ---------------------------------------------------------- */
  function pintarHoy(raiz, hayContenido) {
    var caja = raiz.querySelector('[data-hoy]');
    var texto = raiz.querySelector('[data-hoy-texto]');
    if (!caja || !texto || !window.Practica) return;
    if (!hayContenido) return; // sin sesiones ni repertorio no hay nada que estudiar

    var reg = window.Practica.leer();
    var hoyISO = window.Practica.hoyISO();
    var hechaHoy = Array.isArray(reg[hoyISO]) && reg[hoyISO].length > 0;

    caja.classList.toggle('hoy--hecho', hechaHoy);
    caja.classList.toggle('hoy--pendiente', !hechaHoy);
    texto.textContent = hechaHoy
      ? 'Ya has estudiado hoy. Bien hecho 🎶'
      : 'Aún no has estudiado hoy — ¿empezamos?';
    caja.hidden = false;
  }

  /* ----------------------------------------------------------
     Tira de la semana — lunes a domingo, días practicados
     rellenos, hoy resaltado.
     ---------------------------------------------------------- */
  function pintarSemana(raiz) {
    var cont = raiz.querySelector('[data-semana]');
    if (!cont || !window.Practica) return;

    var NOMBRES = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    var reg = window.Practica.leer();
    var hoy = new Date();
    var hoyISO = window.Practica.hoyISO(hoy);

    // Lunes de esta semana.
    var lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));

    var check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="m5 13 4 4L19 7"/></svg>';

    var html = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      var iso = window.Practica.hoyISO(d);
      var hecho = Array.isArray(reg[iso]) && reg[iso].length > 0;
      var clases = 'semana__dia';
      if (hecho) clases += ' semana__dia--hecho';
      if (iso === hoyISO) clases += ' semana__dia--hoy';
      else if (iso > hoyISO) clases += ' semana__dia--futuro';
      html += '<span class="' + clases + '">' +
        '<span class="semana__nombre">' + NOMBRES[i] + '</span>' +
        '<span class="semana__punto">' + (hecho ? check : '') + '</span>' +
      '</span>';
    }
    cont.innerHTML = html;
  }

  /* ----------------------------------------------------------
     Repasar lo difícil — canciones con fragmentos marcados.
     ---------------------------------------------------------- */
  function pintarRepasar(raiz) {
    var seccion = raiz.querySelector('[data-repasar]');
    var lista = raiz.querySelector('[data-repasar-lista]');
    if (!seccion || !lista || !window.Sesiones) return;

    var pend = window.Sesiones.repasoPendiente().filter(function (p) {
      // Si la canción ya está aprendida, sus difíciles dejan de pesar.
      if (!p.cancionId) return true;
      var c = window.Canciones.obtener(p.cancionId);
      return !c || c.estado !== 'aprendida';
    }).sort(function (a, b) { return b.trozos - a.trozos; }).slice(0, 3);

    if (pend.length === 0) return;

    lista.innerHTML = '';
    pend.forEach(function (p) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tarjeta';
      btn.innerHTML =
        '<span class="tarjeta__cuerpo">' +
          '<span class="tarjeta__titulo">' + escapar(p.titulo) + '</span>' +
          '<span class="repasar__nota">' +
            p.trozos + (p.trozos === 1 ? ' fragmento difícil' : ' fragmentos difíciles') +
          '</span>' +
        '</span>' +
        '<span class="chip chip--progreso">Repasar</span>';
      btn.addEventListener('click', function () {
        window.App.ir('estudio', { datos: { sesionId: p.ref.sesion.id, marcaId: p.ref.marca.id } });
      });
      lista.appendChild(btn);
    });
    seccion.hidden = false;
  }

  /* ----------------------------------------------------------
     Resumen del mes — Wrapped a pantalla completa que sale solo:
     el día 1–12 con el balance del mes anterior (tono cabrón), y el
     31 de diciembre el Wrapped ANUAL con todo el año (tono cálido).
     Se renderiza en wrapped.js; también se reabre desde Práctica.
     ---------------------------------------------------------- */
  function mostrarResumenMes() {
    if (!window.ResumenMes) return;
    var d = null;
    try {
      d = (window.ResumenMes.anualPendiente && window.ResumenMes.anualPendiente()) ||
          (window.ResumenMes.pendiente && window.ResumenMes.pendiente());
    } catch (e) { d = null; }
    if (!d) return;
    window.ResumenMes.abrirHoja(d);
    if (d.esAnual) window.ResumenMes.marcarAnualVisto(d.anio);
    else window.ResumenMes.marcarVisto(d.anio, d.mes);
  }

  /* ----------------------------------------------------------
     Conteo animado de 0 al valor final. Respeta
     prefers-reduced-motion (pinta el número directamente).
     ---------------------------------------------------------- */
  function contarHasta(el, destino) {
    if (!el) return;
    destino = Math.max(0, Math.round(destino || 0));

    var reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}
    if (reduce || destino === 0 || !window.requestAnimationFrame) {
      el.textContent = String(destino);
      return;
    }

    var DURACION = Math.min(1100, 400 + destino * 90); // números pequeños, animación corta
    var inicio = null;

    function paso(t) {
      if (inicio === null) inicio = t;
      var p = Math.min(1, (t - inicio) / DURACION);
      // ease-out cúbico
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(e * destino));
      if (p < 1) requestAnimationFrame(paso);
      else el.textContent = String(destino);
    }
    el.textContent = '0';
    requestAnimationFrame(paso);
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ----------------------------------------------------------
     "Del coro" — última publicación de Instagram de Bihotsak.

     Instagram no tiene forma oficial de leer un perfil ajeno sin
     ser su dueño (su API pública se cerró en dic. 2024). Aquí la
     app consulta directamente el endpoint interno del feed del
     perfil público. En el APK, el plugin CapacitorHttp
     (activado en capacitor.config.json) hace la petición de forma
     nativa y se salta el bloqueo CORS del navegador. En "npm run
     dev" la petición pasa por un proxy local (scripts/dev.js) para
     poder probar la tarjeta también en el navegador.

     Es un endpoint no documentado: Instagram puede cambiarlo o
     empezar a pedir login. Por eso la última publicación buena se
     guarda en localStorage y se sigue mostrando aunque un día
     falle la petición.
     ---------------------------------------------------------- */
  var CACHE_CORO = 'chorapp:coro:ultima';
  var IG_APP_ID = '936619743392459'; // id público que usa la web de Instagram

  function cargarCoro(raiz) {
    var seccion = raiz.querySelector('[data-coro]');
    if (!seccion) return;

    // 1) Pinta ya lo último que se vio (si hay), para que no parpadee.
    var cacheado = leerCache();
    if (cacheado) pintarCoro(seccion, cacheado);

    // 2) Config (usuario / perfil / handle) y, con ella, Instagram.
    fetch('data/coro.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (!cfg) return;

        var usuarioEl = seccion.querySelector('[data-coro-usuario]');
        if (cfg.usuario && usuarioEl) usuarioEl.textContent = cfg.usuario;

        var handle = cfg.instagram;
        if (!handle) {
          if (!cacheado) pintarSoloEnlace(seccion, cfg);
          return;
        }

        return obtenerPublicacion(cfg, handle)
          .then(function (pub) {
            if (!pub) throw new Error('sin publicaciones');
            guardarCache(pub);
            pintarCoro(seccion, pub);
          })
          .catch(function () {
            // Nadie respondió (sin red, Instagram pide login, Worker sin
            // configurar…): nos quedamos con la cache o con el enlace.
            if (!cacheado) pintarSoloEnlace(seccion, cfg);
          });
      })
      .catch(function () { /* sin config: la sección no aparece */ });
  }

  // Devuelve la última publicación ya normalizada
  // ({ imagen, texto, fecha, enlace, usuario }) probando por orden:
  //   1) el Cloudflare Worker (cfg.worker) — recomendado: Instagram
  //      responde al Worker aunque bloquee al móvil ("login_required");
  //   2) el proxy local de scripts/dev.js (solo en "npm run dev");
  //   3) Instagram directo desde el APK (CapacitorHttp) — puede fallar.
  function obtenerPublicacion(cfg, handle) {
    var esNativo = !!(window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform());

    var intentos = [];

    var worker = cfg.worker
      ? String(cfg.worker).replace(/\/+$/, '') : '';
    if (worker) {
      intentos.push(function () {
        return fetch(worker + '/coro?handle=' + encodeURIComponent(handle))
          .then(function (r) {
            if (!r || !r.ok) throw new Error('worker ' + (r && r.status));
            return r.json();          // el Worker ya devuelve el objeto pub
          })
          .then(function (pub) {
            if (!pub || !pub.enlace) throw new Error('worker sin datos');
            if (!pub.usuario) pub.usuario = cfg.usuario || ('@' + handle);
            return pub;
          });
      });
    }

    if (!esNativo) {
      intentos.push(function () {
        return fetch('api/coro?handle=' + encodeURIComponent(handle))
          .then(function (r) {
            if (!r || !r.ok) throw new Error('proxy ' + (r && r.status));
            return r.json();
          })
          .then(function (json) { return exigir(extraerDeInstagram(json, cfg)); });
      });
    }

    if (esNativo) {
      // Instagram directo. Sin User-Agent de navegador (con ella aplica su
      // "SecFetch policy" y exige sesión). Se prueban los dos endpoints.
      var opciones = { headers: {
        'x-ig-app-id': IG_APP_ID,
        'x-asbd-id': '129477',
        'x-ig-www-claim': '0'
      } };
      var urls = [
        'https://www.instagram.com/api/v1/feed/user/' +
          encodeURIComponent(handle) + '/username/?count=3',
        'https://www.instagram.com/api/v1/users/web_profile_info/?username=' +
          encodeURIComponent(handle)
      ];
      urls.forEach(function (u) {
        intentos.push(function () {
          return fetch(u, opciones)
            .then(function (r) {
              if (!r || !r.ok) throw new Error('instagram ' + (r && r.status));
              return r.json();
            })
            .then(function (json) { return exigir(extraerDeInstagram(json, cfg)); });
        });
      });
    }

    // Ejecuta los intentos en cadena; el primero que dé una publicación gana.
    return intentos.reduce(function (cadena, intento) {
      return cadena.catch(function () { return intento(); });
    }, Promise.reject(new Error('sin intentos')));
  }

  function exigir(pub) {
    if (!pub) throw new Error('sin publicaciones');
    return pub;
  }

  // Saca la publicación más reciente del feed y la deja como
  // { imagen, texto, fecha, enlace, usuario }.
  function extraerDeInstagram(json, cfg) {
    // Shape de web_profile_info: data.user.edge_owner_to_timeline_media.edges
    var edges = json && json.data && json.data.user &&
      json.data.user.edge_owner_to_timeline_media &&
      json.data.user.edge_owner_to_timeline_media.edges;
    if (edges && edges.length) return extraerDeWebProfile(edges, json, cfg);

    var items = (json && json.items) || [];
    if (!items.length) return null;

    // La más nueva por fecha (así un post fijado antiguo no gana).
    var it = items.slice().sort(function (a, b) {
      return (b.taken_at || 0) - (a.taken_at || 0);
    })[0];

    // Imagen (o miniatura si es vídeo; primera foto si es carrusel).
    var iv = it.image_versions2 ||
             (it.carousel_media && it.carousel_media[0] &&
              it.carousel_media[0].image_versions2);
    var candidatos = (iv && iv.candidates) || [];
    var imagen = candidatos.length ? candidatos[0].url : '';

    var texto = (it.caption && it.caption.text) || 'Nueva publicación del coro';
    // Quita el bloque de hashtags del final, que no aporta nada en la tarjeta.
    texto = texto.replace(/(\s*#[\wÀ-ÿ]+)+\s*$/u, '').trim();

    return {
      imagen: imagen,
      texto: texto || 'Nueva publicación del coro',
      fecha: it.taken_at ? new Date(it.taken_at * 1000).toISOString() : '',
      enlace: it.code
        ? 'https://www.instagram.com/p/' + it.code + '/'
        : (cfg.perfil || '#'),
      usuario: cfg.usuario ||
               (it.user && it.user.username ? '@' + it.user.username : '')
    };
  }

  // Publicación más reciente a partir del shape de web_profile_info.
  function extraerDeWebProfile(edges, json, cfg) {
    var nodos = edges.map(function (e) { return e.node; }).filter(Boolean);
    var n = nodos.slice().sort(function (a, b) {
      return (b.taken_at_timestamp || 0) - (a.taken_at_timestamp || 0);
    })[0];
    if (!n) return null;

    // Carrusel: primera foto hija; si no, la imagen del propio nodo.
    var hijo = n.edge_sidecar_to_children &&
      n.edge_sidecar_to_children.edges &&
      n.edge_sidecar_to_children.edges[0] &&
      n.edge_sidecar_to_children.edges[0].node;
    var imagen = (hijo && hijo.display_url) || n.display_url ||
      n.thumbnail_src || '';

    var texto = (n.edge_media_to_caption &&
      n.edge_media_to_caption.edges &&
      n.edge_media_to_caption.edges[0] &&
      n.edge_media_to_caption.edges[0].node &&
      n.edge_media_to_caption.edges[0].node.text) || 'Nueva publicación del coro';
    texto = texto.replace(/(\s*#[\wÀ-ÿ]+)+\s*$/u, '').trim();

    var usuarioIG = json.data && json.data.user && json.data.user.username;

    return {
      imagen: imagen,
      texto: texto || 'Nueva publicación del coro',
      fecha: n.taken_at_timestamp
        ? new Date(n.taken_at_timestamp * 1000).toISOString() : '',
      enlace: n.shortcode
        ? 'https://www.instagram.com/p/' + n.shortcode + '/'
        : (cfg.perfil || '#'),
      usuario: cfg.usuario || (usuarioIG ? '@' + usuarioIG : '')
    };
  }

  function pintarCoro(seccion, pub) {
    var enlace = seccion.querySelector('[data-coro-enlace]');
    var media = seccion.querySelector('[data-coro-media]');
    var img = seccion.querySelector('[data-coro-img]');
    var texto = seccion.querySelector('[data-coro-texto]');
    var fecha = seccion.querySelector('[data-coro-fecha]');
    var usuario = seccion.querySelector('[data-coro-usuario]');

    enlace.href = pub.enlace || '#';
    texto.textContent = pub.texto || '';
    fecha.textContent = formatearFecha(pub.fecha);
    if (pub.usuario && usuario) usuario.textContent = pub.usuario;

    if (pub.imagen) {
      media.hidden = false;
      img.src = pub.imagen;
      img.alt = 'Última publicación de ' + (pub.usuario || 'el coro');
      img.onerror = function () { media.hidden = true; };
    } else {
      media.hidden = true;
    }

    seccion.hidden = false;
  }

  function pintarSoloEnlace(seccion, cfg) {
    seccion.querySelector('[data-coro-enlace]').href = cfg.perfil || '#';
    seccion.querySelector('[data-coro-media]').hidden = true;
    seccion.querySelector('[data-coro-texto]').textContent =
      'Sigue al coro en Instagram para no perderte nada.';
    seccion.querySelector('[data-coro-fecha]').textContent = '';
    seccion.hidden = false;
  }

  function leerCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_CORO)) || null; }
    catch (e) { return null; }
  }
  function guardarCache(pub) {
    try { localStorage.setItem(CACHE_CORO, JSON.stringify(pub)); } catch (e) {}
  }

  function formatearFecha(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    try {
      return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  return { iniciar: iniciar };
})();
