/* ============================================================
   Pagina_home — Inicio (resumen del repertorio)
   ============================================================ */

window.Pagina_home = (function () {
  'use strict';

  function iniciar(contenedor) {
    var raiz = contenedor.querySelector('[data-modulo="home"]');
    if (!raiz) return;

    cargarCoro(raiz);
    pintarFecha(raiz);

    var canciones = window.Canciones ? window.Canciones.listar() : [];
    var total = canciones.length;

    raiz.querySelector('[data-num-canciones]').textContent = String(total);

    // Racha de días de estudio (practica.js).
    var racha = window.Practica ? window.Practica.racha() : 0;
    var elRacha = raiz.querySelector('[data-num-racha]');
    if (elRacha) elRacha.textContent = String(racha);
    var elRachaLabel = raiz.querySelector('[data-racha-label]');
    if (elRachaLabel) elRachaLabel.textContent = racha === 1 ? 'día seguido' : 'días seguidos';

    pintarHoy(raiz, total);
    pintarSemana(raiz);
    pintarRepasar(raiz, canciones);

    var card = raiz.querySelector('[data-continuar]');
    var eyebrow = raiz.querySelector('[data-continuar-eyebrow]');
    var titulo = raiz.querySelector('[data-continuar-titulo]');
    var vacio = raiz.querySelector('[data-vacio]');

    if (total === 0) {
      card.disabled = true;
      return;
    }

    // Última canción tocada por la usuaria (por ahora: la más reciente).
    var ultima = canciones.slice().sort(function (a, b) {
      return (b.actualizada || 0) - (a.actualizada || 0);
    })[0];

    card.disabled = false;
    eyebrow.textContent = total === 1 ? 'Tu canción' : 'Seguir estudiando';
    titulo.textContent = ultima.titulo;
    if (vacio) vacio.hidden = true;

    card.addEventListener('click', function () {
      window.App.ir('estudio', { datos: { id: ultima.id } });
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
     Estado de hoy — ¿ya ha estudiado? Recordatorio cálido.
     ---------------------------------------------------------- */
  function pintarHoy(raiz, totalCanciones) {
    var caja = raiz.querySelector('[data-hoy]');
    var texto = raiz.querySelector('[data-hoy-texto]');
    if (!caja || !texto || !window.Practica) return;
    if (totalCanciones === 0) return; // sin repertorio no hay nada que estudiar

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
  function pintarRepasar(raiz, canciones) {
    var seccion = raiz.querySelector('[data-repasar]');
    var lista = raiz.querySelector('[data-repasar-lista]');
    if (!seccion || !lista) return;

    var conFragmentos = canciones.filter(function (c) {
      return Array.isArray(c.fragmentos) && c.fragmentos.length > 0;
    }).sort(function (a, b) {
      return (b.actualizada || 0) - (a.actualizada || 0);
    }).slice(0, 3);

    if (conFragmentos.length === 0) return;

    lista.innerHTML = '';
    conFragmentos.forEach(function (c) {
      var n = c.fragmentos.length;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tarjeta';
      btn.innerHTML =
        '<span class="tarjeta__cuerpo">' +
          '<span class="tarjeta__titulo">' + escapar(c.titulo) + '</span>' +
          '<span class="repasar__nota">' +
            n + (n === 1 ? ' fragmento difícil' : ' fragmentos difíciles') +
          '</span>' +
        '</span>' +
        '<span class="chip chip--progreso">Repasar</span>';
      btn.addEventListener('click', function () {
        window.App.ir('estudio', { datos: { id: c.id } });
      });
      lista.appendChild(btn);
    });
    seccion.hidden = false;
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

        return pedirInstagram(handle)
          .then(function (json) {
            var pub = extraerDeInstagram(json, cfg);
            if (!pub) throw new Error('sin publicaciones');
            guardarCache(pub);
            pintarCoro(seccion, pub);
          })
          .catch(function () {
            // Instagram no respondió (CORS en dev, sin red, bloqueo,
            // o cambió el endpoint): nos quedamos con la cache o el enlace.
            if (!cacheado) pintarSoloEnlace(seccion, cfg);
          });
      })
      .catch(function () { /* sin config: la sección no aparece */ });
  }

  // Pide el feed público del usuario de Instagram. Devuelve { items: [...] }.
  //  - En el APK: petición directa; CapacitorHttp la hace nativa y evita CORS.
  //  - En el navegador (npm run dev): pasa por el proxy de scripts/dev.js.
  //    En la PWA publicada ese proxy no existe (404) y se cae al enlace.
  function pedirInstagram(handle) {
    var esNativo = !!(window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform());

    var url = esNativo
      ? 'https://www.instagram.com/api/v1/feed/user/' +
          encodeURIComponent(handle) + '/username/?count=3'
      : 'api/coro?handle=' + encodeURIComponent(handle);

    var opciones = esNativo ? {
      headers: {
        'x-ig-app-id': IG_APP_ID,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 ' +
                      '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
      }
    } : {};

    return fetch(url, opciones).then(function (r) {
      if (!r || !r.ok) throw new Error('instagram ' + (r && r.status));
      return r.json();
    });
  }

  // Saca la publicación más reciente del feed y la deja como
  // { imagen, texto, fecha, enlace, usuario }.
  function extraerDeInstagram(json, cfg) {
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
