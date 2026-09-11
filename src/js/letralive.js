/* ============================================================
   letralive.js — window.LetraLive

   Visor de letra a pantalla completa, estilo reproductor
   (Apple Music / Spotify): la línea que suena se agranda y se
   "ilumina" de izquierda a derecha; las cantadas quedan
   pequeñas y tenues arriba; las que vienen, atenuadas.
   Tocar una línea salta ahí. Abajo, controles de reproducción.

   Se apoya en window.CancionActiva para el audio. Quien abre
   (el modo estudio) pasa el mapeo de tiempos y los textos:

     window.LetraLive.abrir({
       titulo, compositor,
       modoInicial: 'orig'|'fon'|'trad',
       vistas:   [{ id, etq }, …],          // versiones en texto
       textoDe:  function (id) -> string,
       sincroDe: function (id) -> [seg…] | null,
       dur:      <segundos de la canción>,
       relDe:    function (segAbs) -> seg relativo a la canción,
       irA:      function (segRel),
       sincronizar:   function (id) -> Promise<[seg…]>,
       guardarTiempos: function (id, tiempos, base),
       alCerrar: function (),
     });
   ============================================================ */

window.LetraLive = (function () {
  'use strict';

  var REDUCE = false;
  try {
    REDUCE = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  var ANCLA = 0.36;          // altura relativa donde se fija la línea activa
  var PAUSA_SCROLL = 3800;   // ms que respetamos el scroll manual antes de re-seguir

  var capa = null;           // nodo raíz del visor
  var o = null;              // opciones de la apertura actual
  var estado = {
    modo: 'orig',
    lineas: [],              // [{ el, txt, t }]
    marcas: [],              // [{ el, iAntes, desde, hasta }] marcas "solo música"
    tiempos: null,           // [seg…] o null
    fiable: false,           // true = sincronía exacta (Whisper / a mano)
    activa: -1,
    editando: false,
    reproduciendo: false,
    baseSeg: 0,              // último "actual" absoluto conocido
    baseAt: 0,               // performance.now() de ese momento
    velocidad: 1,
    grabando: false,
    grabT0: 0,
    rafId: 0,
    scrollRaf: 0,            // rAF del desplazamiento propio
    off: null,               // baja de CancionActiva
    scrollUsuario: 0,        // perf() del último scroll de Maite
    autoHasta: 0,            // perf() hasta el que un 'scroll' es nuestro
    menu: null,
    wakeLock: null,          // WakeLockSentinel mientras el visor está abierto
  };

  /* ---------- Pantalla siempre encendida mientras se lee la letra ---------- */

  function pedirDespierta() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (wl) {
      estado.wakeLock = wl;
      wl.addEventListener('release', function () {
        if (estado.wakeLock === wl) estado.wakeLock = null;
      });
    }).catch(function () {});
  }

  function soltarDespierta() {
    if (estado.wakeLock) {
      try { estado.wakeLock.release(); } catch (e) {}
      estado.wakeLock = null;
    }
  }

  // El wake lock se libera solo al pasar la app a segundo plano (cambiar de
  // pestaña, bloquear el móvil…); al volver, si el visor sigue abierto, se
  // vuelve a pedir.
  function alVisibilidad() {
    if (capa && document.visibilityState === 'visible' && !estado.wakeLock) pedirDespierta();
  }
  document.addEventListener('visibilitychange', alVisibilidad);

  function abrir(opts) {
    cerrar(true);
    o = opts || {};
    estado.modo = o.modoInicial || (o.vistas && o.vistas[0] && o.vistas[0].id) || 'orig';
    estado.editando = false;
    estado.activa = -1;

    capa = document.createElement('div');
    capa.className = 'letralive';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', 'Letra de ' + (o.titulo || 'la canción'));
    capa.innerHTML = plantilla();
    document.body.appendChild(capa);
    document.body.classList.add('letralive-abierta');

    capa.querySelector('[data-ll-cerrar]').addEventListener('click', function () { cerrar(); });
    capa.querySelector('[data-ll-titulo]').textContent = o.titulo || 'Letra';
    var sub = capa.querySelector('[data-ll-sub]');
    if (o.compositor) { sub.textContent = o.compositor; sub.hidden = false; }
    capa.querySelector('[data-ll-menu-btn]').addEventListener('click', function (ev) {
      ev.stopPropagation();
      estado.menu ? cerrarMenu() : abrirMenu();
    });

    montarVistas();
    montarControles();
    montarArrastreCierre();

    estado.off = (window.CancionActiva && window.CancionActiva.suscribir)
      ? window.CancionActiva.suscribir(alEstado)
      : null;

    document.addEventListener('keydown', alTecla);
    var vp = capa.querySelector('[data-ll-scroll]');
    // El "scroll manual" se detecta por el GESTO real (rueda / arrastre con el
    // dedo), no por el evento 'scroll' (que también lo dispara nuestro propio
    // desplazamiento y hacía que "Volver a la letra" saliera sin querer).
    var gestoScroll = function () {
      estado.scrollUsuario = perf();
      if (estado.scrollRaf) { cancelAnimationFrame(estado.scrollRaf); estado.scrollRaf = 0; }
    };
    vp.addEventListener('wheel', gestoScroll, { passive: true });
    vp.addEventListener('touchmove', gestoScroll, { passive: true });

    capa.querySelector('[data-ll-volver]').addEventListener('click', function () {
      estado.scrollUsuario = 0;            // se reanuda el seguimiento
      if (estado.activa >= 0) desplazarA(estado.activa, true);
      else { var s = capa.querySelector('[data-ll-scroll]'); if (s) { estado.autoHasta = perf() + 900; s.scrollTop = 0; } }
      seguir(true);
    });

    render(false);

    pedirDespierta();
    requestAnimationFrame(function () { if (capa) capa.classList.add('is-abierta'); });
    bucle();
  }

  function cerrar(silencioso) {
    if (estado.rafId) { cancelAnimationFrame(estado.rafId); estado.rafId = 0; }
    if (estado.scrollRaf) { cancelAnimationFrame(estado.scrollRaf); estado.scrollRaf = 0; }
    if (estado.off) { try { estado.off(); } catch (e) {} estado.off = null; }
    soltarDespierta();
    cerrarMenu();
    document.removeEventListener('keydown', alTecla);
    document.body.classList.remove('letralive-abierta');
    var c = capa;
    capa = null;
    estado.lineas = [];
    estado.marcas = [];
    estado.tiempos = null;
    estado.activa = -1;
    estado.grabando = false;
    estado.grabT0 = 0;
    if (c) {
      c.classList.remove('is-abierta');
      var quita = function () { if (c.parentNode) c.parentNode.removeChild(c); };
      c.addEventListener('transitionend', quita, { once: true });
      setTimeout(quita, 220);
    }
    if (!silencioso && o && typeof o.alCerrar === 'function') {
      try { o.alCerrar(); } catch (e) {}
    }
    if (!silencioso) o = null;
  }

  function alTecla(e) { if (e.key === 'Escape') cerrar(); }

  /* ---------- Plantilla ---------- */

  function plantilla() {
    return '' +
      '<div class="letralive__fondo" aria-hidden="true">' +
        '<span class="letralive__blob letralive__blob--1"></span>' +
        '<span class="letralive__blob letralive__blob--2"></span>' +
        '<span class="letralive__blob letralive__blob--3"></span>' +
        '<span class="letralive__grano"></span>' +
      '</div>' +
      '<div class="letralive__top" data-ll-top>' +
        '<span class="letralive__asa" aria-hidden="true"></span>' +
        '<div class="letralive__top-fila">' +
          '<button type="button" class="letralive__icono" data-ll-cerrar aria-label="Cerrar la letra">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
          '</button>' +
          '<div class="letralive__meta">' +
            '<p class="letralive__titulo" data-ll-titulo></p>' +
            '<p class="letralive__sub" data-ll-sub hidden></p>' +
          '</div>' +
          '<button type="button" class="letralive__icono" data-ll-menu-btn aria-label="Más opciones">' +
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="letralive__vistas" data-ll-vistas hidden role="group" aria-label="Versión de la letra"></div>' +
      '</div>' +
      '<div class="letralive__scroll" data-ll-scroll>' +
        '<div class="letralive__lineas" data-ll-lineas></div>' +
      '</div>' +
      '<button type="button" class="letralive__volver" data-ll-volver aria-label="Volver a la letra que suena">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>' +
        '<span>Volver a la letra</span>' +
      '</button>' +
      '<div class="letralive__pie">' +
        '<div class="letralive__aviso" data-ll-aviso hidden></div>' +
        '<div class="letralive__barra">' +
          '<input type="range" min="0" max="1000" value="0" step="1" data-ll-scrub aria-label="Posición de la canción" />' +
          '<div class="letralive__tiempos"><span data-ll-t>0:00</span><span data-ll-r>-0:00</span></div>' +
        '</div>' +
        '<div class="letralive__transport">' +
          '<button type="button" class="letralive__tp" data-ll-retro aria-label="Retroceder 5 segundos">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 4 11l7 7"/><path d="M4 11h10a6 6 0 0 1 0 12h-3"/></svg>' +
          '</button>' +
          '<button type="button" class="letralive__tp letralive__tp--play" data-ll-play aria-label="Reproducir">' +
            '<svg class="ll-ic-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5a1 1 0 0 1 1.53-.85l11 6.5a1 1 0 0 1 0 1.7l-11 6.5A1 1 0 0 1 8 18.5z"/></svg>' +
            '<svg class="ll-ic-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" hidden><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>' +
          '</button>' +
          '<button type="button" class="letralive__tp" data-ll-adel aria-label="Adelantar 5 segundos">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m13 4 7 7-7 7"/><path d="M20 11H10a6 6 0 0 0 0 12h3"/></svg>' +
          '</button>' +
          '<button type="button" class="letralive__tp letralive__tp--rec" data-ll-rec aria-label="Grabar tu voz" hidden>' +
            '<svg class="ll-ic-rec" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/></svg>' +
            '<svg class="ll-ic-stop" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" hidden><rect x="6" y="6" width="12" height="12" rx="3"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="letralive__rec-t" data-ll-rec-t aria-hidden="true"></div>' +
      '</div>';
  }

  /* ---------- Versiones ---------- */

  function montarVistas() {
    var caja = capa.querySelector('[data-ll-vistas]');
    caja.innerHTML = '';
    var vistas = (o.vistas || []).filter(function (v) {
      return v && v.id && (o.textoDe(v.id) || '').trim();
    });
    if (vistas.length < 2) { caja.hidden = true; return; }
    caja.hidden = false;
    vistas.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'letralive__vista';
      b.textContent = v.etq;
      b.setAttribute('data-v', v.id);
      b.addEventListener('click', function () {
        if (estado.modo === v.id || capa.classList.contains('is-cambiando-v')) return;
        estado.modo = v.id;
        estado.editando = false;
        try { window.Almacen.guardar('estudio:letraModo', v.id); } catch (e) {}
        render(true);
      });
      caja.appendChild(b);
    });
  }

  function marcarVistaActiva() {
    if (!capa) return;
    Array.prototype.forEach.call(capa.querySelectorAll('[data-v]'), function (b) {
      var on = b.getAttribute('data-v') === estado.modo;
      b.classList.toggle('is-activa', on);
      if (on) { b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop'); }
    });
  }

  /* ---------- Contenido ---------- */

  // animar = true  -> transición suave (cambio de versión / modo / sincronía)
  function render(animar) {
    if (!capa) return;
    var cajaL = capa.querySelector('[data-ll-lineas]');

    if (animar && !REDUCE && cajaL.childNodes.length) {
      capa.classList.add('is-cambiando-v');
      cajaL.classList.add('is-saliendo');
      setTimeout(function () {
        if (!capa) return;
        construir(cajaL);
        cajaL.classList.remove('is-saliendo');
        cajaL.classList.add('is-entrando');
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (cajaL) cajaL.classList.remove('is-entrando');
          });
        });
        setTimeout(function () { if (capa) capa.classList.remove('is-cambiando-v'); }, 60);
      }, 210);
    } else {
      construir(cajaL, !animar);
    }
  }

  function construir(cajaL, primera) {
    var texto = (o.textoDe(estado.modo) || '').trim();
    var tiempos = o.sincroDe ? o.sincroDe(estado.modo) : null;
    var crudas = texto.split('\n');
    var noVacias = crudas.filter(function (l) { return l.trim(); });
    if (!Array.isArray(tiempos) || tiempos.length !== noVacias.length) tiempos = null;
    estado.tiempos = tiempos;
    estado.fiable = !!(o.sincroFiable && o.sincroFiable());

    cajaL.innerHTML = '';
    cajaL.classList.toggle('is-karaoke', !!tiempos);
    cajaL.classList.toggle('is-ajustando', estado.editando && !!tiempos);
    cajaL.classList.toggle('is-primera', !!primera && !REDUCE);
    estado.lineas = [];
    estado.activa = -1;

    estado.marcas = [];

    var idx = 0;
    crudas.forEach(function (crudo) {
      var t = crudo.trim();
      if (!t) {
        var esp = document.createElement('div');
        esp.className = 'letralive__esp';
        cajaL.appendChild(esp);
        return;
      }
      t = capFrase(t);
      var i = idx++;
      var linea = document.createElement('button');
      linea.type = 'button';
      linea.className = 'letralive__linea';
      linea.setAttribute('data-i', String(i));

      // Cada palabra en su <span> y, dentro, cada letra en el suyo: la voz
      // "barre" la línea letra a letra (estilo Apple Music), encendiéndolas
      // y elevándolas un pelín justo antes de llegar. Los rangos (r0→r1)
      // reparten el tramo de la línea por caracteres.
      var span = document.createElement('span');
      span.className = 'letralive__txt';
      var partes = t.split(' ');
      var total = Math.max(1, t.length);
      var acc = 0;
      var pal = [];   // una entrada por LETRA: { el, r0, r1, on }
      partes.forEach(function (w, wi) {
        var pe = document.createElement('span');
        pe.className = 'letralive__w';
        for (var ci = 0; ci < w.length; ci++) {
          var ce = document.createElement('span');
          ce.className = 'letralive__c';
          ce.textContent = w.charAt(ci);
          pe.appendChild(ce);
          pal.push({ el: ce, r0: acc / total, r1: (acc + 1) / total, on: false });
          acc += 1;
        }
        span.appendChild(pe);
        if (wi < partes.length - 1) {
          span.appendChild(document.createTextNode(' '));
          acc += 1;
        }
      });
      linea.appendChild(span);

      if (tiempos) {
        var badge = document.createElement('span');
        badge.className = 'letralive__t';
        badge.textContent = fmt(tiempos[i]);
        linea.appendChild(badge);
      }
      linea.addEventListener('click', (function (k) {
        return function () { onLinea(k); };
      })(i));
      cajaL.appendChild(linea);
      estado.lineas.push({
        el: linea, txt: span, pal: pal, t: tiempos ? tiempos[i] : null,
      });
    });

    // Marcas de "solo música": intro instrumental o pausas largas entre versos
    // (un "na na na" que no está en la letra, un puente…). Se colocan una sola
    // vez, en su hueco, y se QUEDAN ahí: cuando pasa la parte instrumental el
    // corchete no desaparece, solo deja de latir. Estilo Apple Music.
    if (tiempos && tiempos.length > 2) {
      // Umbral RELATIVO: solo se marca "solo música" un hueco que sea
      // claramente anómalo comparado con la separación normal entre versos de
      // ESTA canción (así un desliz de 3-4 s de la IA no se pinta como un
      // bloque instrumental permanente).
      var seps = [];
      for (var s0 = 0; s0 < tiempos.length - 1; s0++) seps.push(tiempos[s0 + 1] - tiempos[s0]);
      var medSep = mediana(seps) || 4;
      var antesL0 = tiempos[0];
      if (antesL0 >= Math.max(4, medSep * 1.6)) {
        colocarMarca(cajaL, estado.lineas[0] && estado.lineas[0].el, -1, 0, antesL0);
      }
      for (var g = 0; g < tiempos.length - 1; g++) {
        var finG = tiempos[g] + cantoEstimado(estado.lineas[g]);
        var hueco = tiempos[g + 1] - tiempos[g];      // separación bruta entre versos
        var silencio = tiempos[g + 1] - finG;         // tiempo sin cantar tras el verso
        // Marca solo si el hueco es CLARAMENTE anómalo (más del doble de lo
        // normal en esta canción) y de verdad hay 4+ s sin letra.
        if (hueco >= Math.max(6, medSep * 2.2) && silencio >= 4) {
          var refG = estado.lineas[g + 1] && estado.lineas[g + 1].el;
          colocarMarca(cajaL, refG, g, finG, tiempos[g + 1]);
        }
      }

      // Cola instrumental: si la canción termina con música después del último
      // verso, un corchete al final (colgado del último verso, sin ref).
      var ult = tiempos.length - 1;
      var finUlt = tiempos[ult] + cantoEstimado(estado.lineas[ult]);
      if (o.dur && o.dur - finUlt >= Math.max(4, medSep * 1.4)) {
        colocarMarca(cajaL, null, ult, finUlt, o.dur);
      }
    }

    // Al cambiar de versión, la letra vuelve arriba del todo.
    var vp = capa.querySelector('[data-ll-scroll]');
    if (vp) { estado.autoHasta = perf() + 900; vp.scrollTop = 0; }

    marcarVistaActiva();
    pintarAviso();
    seguir(true);
  }

  // Segundos que se tarda en cantar un verso, estimado por su longitud.
  // Sirve para NO estirar el barrido hasta el verso siguiente y para saber
  // dónde empieza un hueco "solo música".
  function cantoEstimado(L) {
    var nch = (L && L.pal && L.pal.length) || 16;
    return Math.max(1.5, nch * 0.16 + 0.6);
  }

  // Inserta una marca de "solo música" ([ ♪ ♫ ♪ ]) antes de `refEl` y la
  // apunta en estado.marcas con su ventana de tiempo [desde, hasta].
  function colocarMarca(cajaL, refEl, iAntes, desde, hasta) {
    var m = document.createElement('div');
    m.className = 'letralive__inst';
    m.setAttribute('aria-label', 'Solo música');
    m.innerHTML =
      '<span class="letralive__inst-b" aria-hidden="true">[</span>' +
      '<span class="letralive__inst-n">♪</span>' +
      '<span class="letralive__inst-n">♫</span>' +
      '<span class="letralive__inst-n">♪</span>' +
      '<span class="letralive__inst-b" aria-hidden="true">]</span>';
    if (refEl && refEl.parentNode === cajaL) cajaL.insertBefore(m, refEl);
    else cajaL.appendChild(m);
    estado.marcas.push({ el: m, iAntes: iAntes, desde: desde, hasta: hasta });
  }

  // Aviso / CTA bajo la letra.
  function pintarAviso() {
    var av = capa.querySelector('[data-ll-aviso]');
    av.innerHTML = '';
    av.hidden = true;
    av.style.opacity = '0';
    requestAnimationFrame(function () { if (av) av.style.opacity = ''; });
    if (estado.editando) {
      av.hidden = false;
      av.className = 'letralive__aviso letralive__aviso--ajuste';
      av.innerHTML = '<span>Pon la canción donde entra un verso y tócalo para fijarlo.</span>' +
        '<button type="button" class="letralive__mini" data-ll-fin-ajuste>Listo</button>';
      av.querySelector('[data-ll-fin-ajuste]').addEventListener('click', function () {
        estado.editando = false; render(true);
      });
      return;
    }
    if (!estado.tiempos && o.sincronizar) {
      av.hidden = false;
      av.className = 'letralive__aviso';
      av.innerHTML =
        '<button type="button" class="letralive__cta" data-ll-sinc>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h2l2 6 4-16 3 12 2-6h5"/></svg>' +
          '<span>Sincronizar con el audio</span>' +
        '</button>';
      av.querySelector('[data-ll-sinc]').addEventListener('click', lanzarSincro);
      return;
    }
    // Sincronía aproximada (la IA estaba saturada): invita a repasarla.
    if (estado.tiempos && o.sincroAprox && o.sincroAprox()) {
      av.hidden = false;
      av.className = 'letralive__aviso letralive__aviso--ajuste';
      av.innerHTML = '<span>Sincronía aproximada. Repásala tocando cada verso donde entra.</span>' +
        '<button type="button" class="letralive__mini" data-ll-ajustar>Ajustar</button>';
      av.querySelector('[data-ll-ajustar]').addEventListener('click', function () {
        estado.editando = true; render(true);
      });
    }
  }

  function lanzarSincro() {
    var av = capa && capa.querySelector('[data-ll-aviso]');
    if (!av || av.querySelector('[data-ll-prog]')) return;   // ya en marcha
    var modo = estado.modo;

    // El progreso REAL de Gemini no se conoce (escucha el audio y responde de
    // golpe). Mostramos una barra que avanza sola hacia ~92% a un ritmo acorde
    // con lo que suele tardar (más versos = más rato) y se frena ahí; al
    // resolverse salta al 100%. Así la espera deja de ser a ciegas.
    var nLin = Math.max(2, estado.lineas.length || 8);
    var estimeMs = Math.min(75000, 14000 + nLin * 900);

    av.hidden = false;
    av.className = 'letralive__aviso letralive__aviso--sinc';
    av.innerHTML =
      '<div class="letralive__sincbox" data-ll-prog>' +
        '<div class="letralive__sinc-fila">' +
          '<svg class="letralive__sinc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h2l2 6 4-16 3 12 2-6h5"/></svg>' +
          '<span data-ll-prog-txt>Escuchando la canción…</span>' +
          '<span class="letralive__sinc-pct" data-ll-prog-pct>0%</span>' +
        '</div>' +
        '<div class="letralive__sinc-riel"><span class="letralive__sinc-fill" data-ll-prog-fill></span></div>' +
        '<p class="letralive__sinc-nota">La IA está escuchando el audio y colocando cada verso. Puede tardar hasta un minuto.</p>' +
      '</div>';

    var box = av.querySelector('[data-ll-prog]');
    var fill = av.querySelector('[data-ll-prog-fill]');
    var pct = av.querySelector('[data-ll-prog-pct]');
    var txt = av.querySelector('[data-ll-prog-txt]');
    var t0 = perf();
    var val = 0, raf = 0, terminado = false;

    function aplica(v) {
      if (fill) fill.style.transform = 'scaleX(' + v.toFixed(3) + ')';
      if (pct) pct.textContent = Math.round(v * 100) + '%';
    }
    function tick() {
      if (terminado || !capa) return;
      var k = (perf() - t0) / estimeMs;
      var objetivo = 0.92 * (1 - Math.exp(-k * 1.7));   // se acerca a 0.92 y frena
      if (objetivo > val) val = objetivo;
      aplica(val);
      if (k > 1.15 && txt) txt.textContent = 'Casi está, un momento más…';
      raf = requestAnimationFrame(tick);
    }
    function fin(ok) {
      terminado = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (ok) {
        aplica(1);
        if (box) box.classList.add('is-ok');
        if (txt) txt.textContent = '¡Listo!';
      }
    }
    tick();

    Promise.resolve(o.sincronizar(modo)).then(function () {
      fin(true);
      setTimeout(function () {
        if (!capa) return;
        if (estado.modo === modo) render(true); else pintarAviso();
        if (window.Vibra && window.Vibra.logro) window.Vibra.logro();
      }, 460);
    }).catch(function (e) {
      if (window.console) console.error('LetraLive sincronizar:', e);
      fin(false);
      if (!capa) return;
      pintarAviso();
      if (window.UI) window.UI.aviso('No se ha podido sincronizar ahora mismo. Prueba dentro de un rato.', { tipo: 'error' });
    });
  }

  function onLinea(i) {
    var L = estado.lineas[i];
    if (!L) return;
    if (estado.editando && estado.tiempos) {
      var p = Math.max(0, Math.round(posActual() * 10) / 10);
      estado.tiempos[i] = p;
      for (var k = i + 1; k < estado.tiempos.length; k++) {
        if (estado.tiempos[k] < p) estado.tiempos[k] = p; else break;
      }
      for (var j = i - 1; j >= 0; j--) {
        if (estado.tiempos[j] > p) estado.tiempos[j] = p; else break;
      }
      L.t = p;
      var badge = L.el.querySelector('.letralive__t');
      if (badge) badge.textContent = fmt(p);
      destello(L.el);
      if (o.guardarTiempos) o.guardarTiempos(estado.modo, estado.tiempos.slice(), 'mano');
      return;
    }
    if (L.t != null && o.irA) { o.irA(L.t); destello(L.el); }
  }

  function destello(el) {
    el.classList.remove('is-toque');
    void el.offsetWidth;
    el.classList.add('is-toque');
  }

  /* ---------- Menú ⋯ ---------- */

  function abrirMenu() {
    cerrarMenu();
    var m = document.createElement('div');
    m.className = 'letralive__menu';
    var items = [];
    if (estado.tiempos && !estado.editando) items.push({ k: 'ajustar', etq: 'Ajustar los tiempos' });
    if (estado.tiempos && o.guardarTiempos) items.push({ k: 'quitar', etq: 'Quitar la sincronía' });
    if (!estado.tiempos && o.sincronizar) items.push({ k: 'sinc', etq: 'Sincronizar con el audio' });
    items.push({ k: 'cerrar', etq: 'Cerrar la letra' });

    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'letralive__menu-op' + (it.k === 'quitar' ? ' is-peligro' : '');
      b.textContent = it.etq;
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        cerrarMenu();
        if (it.k === 'ajustar') { estado.editando = true; render(true); }
        else if (it.k === 'sinc') { lanzarSincro(); }
        else if (it.k === 'quitar') { quitarSincro(); }
        else if (it.k === 'cerrar') { cerrar(); }
      });
      m.appendChild(b);
    });
    capa.appendChild(m);
    estado.menu = m;
    setTimeout(function () { document.addEventListener('click', cerrarMenu); }, 0);
  }

  function cerrarMenu() {
    if (!estado.menu) return;
    var m = estado.menu;
    estado.menu = null;
    document.removeEventListener('click', cerrarMenu);
    if (m.parentNode) m.parentNode.removeChild(m);
  }

  function quitarSincro() {
    var hacer = function () {
      if (o.guardarTiempos) o.guardarTiempos(estado.modo, null, 'mano');
      estado.editando = false;
      render(true);
    };
    if (window.UI && window.UI.confirmar) {
      window.UI.confirmar('¿Quitar la sincronía de esta versión?', { ok: 'Quitar', peligro: true })
        .then(function (ok) { if (ok) hacer(); });
    } else { hacer(); }
  }

  /* ---------- Controles ---------- */

  function montarControles() {
    capa.querySelector('[data-ll-play]').addEventListener('click', function () {
      if (window.CancionActiva && window.CancionActiva.alternar) window.CancionActiva.alternar();
    });
    capa.querySelector('[data-ll-retro]').addEventListener('click', function () {
      if (o.irA) o.irA(Math.max(0, posActual() - 5));
    });
    capa.querySelector('[data-ll-adel]').addEventListener('click', function () {
      if (o.irA) o.irA(Math.min(o.dur || 1e9, posActual() + 5));
    });
    var scrub = capa.querySelector('[data-ll-scrub]');
    scrub.addEventListener('input', function () {
      if (o.irA && o.dur) o.irA((scrub.value / 1000) * o.dur);
    });

    // Botón de grabación: solo si quien abre sabe grabar (modo estudio).
    // Reutiliza toda la lógica de la toma (window.Grabadora) vía o.grabar;
    // aquí solo reflejamos el estado.
    var rec = capa.querySelector('[data-ll-rec]');
    if (rec && typeof o.grabar === 'function') {
      rec.hidden = false;
      rec.addEventListener('click', function () {
        try { o.grabar(); } catch (e) {}
        pintarRec();
      });
    }
  }

  // Refleja en el botón el estado real de la grabación (frame a frame).
  function pintarRec() {
    if (!capa || typeof o.grabando !== 'function') return;
    var btn = capa.querySelector('[data-ll-rec]');
    if (!btn) return;
    var g = !!o.grabando();
    if (g !== estado.grabando) {
      estado.grabando = g;
      estado.grabT0 = g ? perf() : 0;
      btn.classList.toggle('is-grabando', g);
      capa.classList.toggle('is-grabando', g);
      var ir = btn.querySelector('.ll-ic-rec');
      var is = btn.querySelector('.ll-ic-stop');
      if (ir) ir.toggleAttribute('hidden', g);
      if (is) is.toggleAttribute('hidden', !g);
      btn.setAttribute('aria-label', g ? 'Detener la grabación' : 'Grabar tu voz');
    }
    var tl = capa.querySelector('[data-ll-rec-t]');
    if (tl) tl.textContent = g ? 'Grabando · ' + fmt((perf() - estado.grabT0) / 1000) : '';
  }

  function alEstado(s) {
    estado.reproduciendo = !!s.reproduciendo;
    estado.velocidad = s.velocidad || 1;
    estado.baseSeg = s.actual || 0;
    estado.baseAt = perf();
    if (!capa) return;
    var ip = capa.querySelector('.ll-ic-play');
    var iq = capa.querySelector('.ll-ic-pause');
    if (ip) ip.toggleAttribute('hidden', estado.reproduciendo);
    if (iq) iq.toggleAttribute('hidden', !estado.reproduciendo);
    var pb = capa.querySelector('[data-ll-play]');
    if (pb) {
      pb.setAttribute('aria-label', estado.reproduciendo ? 'Pausar' : 'Reproducir');
      pb.classList.toggle('is-sonando', estado.reproduciendo);
    }
    capa.classList.toggle('is-sonando', estado.reproduciendo);
  }

  // Segundo actual RELATIVO a la canción, interpolado entre avisos del
  // audio para que la "iluminación" vaya suave a 60fps.
  function posActual() {
    var abs = estado.baseSeg;
    if (estado.reproduciendo) abs += ((perf() - estado.baseAt) / 1000) * estado.velocidad;
    var rel = o.relDe ? o.relDe(abs) : abs;
    var dur = o.dur || 0;
    if (dur) rel = Math.max(0, Math.min(dur, rel));
    return rel;
  }

  function bucle() {
    estado.rafId = requestAnimationFrame(bucle);
    seguir(false);
    pintarRec();
  }

  function seguir(forzar) {
    if (!capa) return;
    var pos = posActual();
    var dur = o.dur || 0;

    var scrub = capa.querySelector('[data-ll-scrub]');
    if (scrub && !scrub.matches(':active') && dur) {
      scrub.value = String(Math.round((pos / dur) * 1000));
    }
    var tt = capa.querySelector('[data-ll-t]');
    var tr = capa.querySelector('[data-ll-r]');
    if (tt) tt.textContent = fmt(pos);
    if (tr) tr.textContent = dur ? '-' + fmt(Math.max(0, dur - pos)) : '';

    var tiempos = estado.tiempos;
    if (!tiempos || !estado.lineas.length) return;

    // Con sincronía fiable esperamos un pelín PASADO el segundo del verso antes
    // de cambiar (la queja siempre es "se mete antes", nunca "tarde"; y el
    // audio del WebView va con algo de latencia). Con la aproximada, al revés:
    // un poco de adelanto para que no se quede atrás.
    var margen = estado.fiable ? -0.18 : 0.05;
    var idx = -1;
    for (var i = 0; i < tiempos.length; i++) {
      if (pos + margen >= tiempos[i]) idx = i; else break;
    }

    // Avance anticipado: si ya se terminó de cantar el verso activo y el
    // siguiente entra pronto (hueco corto y sin marca de "solo música" de por
    // medio), se salta a él sin esperar a su segundo exacto — la IA (Gemini)
    // a veces lo pone tarde y la letra se quedaba "parada" mientras ya se
    // cantaba. Con sincronía FIABLE (Whisper / a mano) los segundos son
    // exactos: NO nos adelantamos, el verso cambia justo en su tiempo.
    var idxCrudo = idx;
    if (!estado.fiable) {
      while (idx >= 0 && idx + 1 < tiempos.length) {
        var finEst = tiempos[idx] + cantoEstimado(estado.lineas[idx]);
        var hayMarca = false;
        for (var hm = 0; hm < estado.marcas.length; hm++) {
          if (estado.marcas[hm].iAntes === idx) { hayMarca = true; break; }
        }
        if (!hayMarca && pos > finEst + 0.35 && tiempos[idx + 1] - pos < 3.5) {
          idx += 1;
        } else break;
      }
    }

    // Progreso dentro de la línea activa (0→1).
    // El barrido NO se estira hasta el verso siguiente: dura lo que se tarda
    // en cantar el verso (estimado por su longitud). Así, si después hay un
    // hueco largo (parte instrumental, un "na na na" que no está en la letra),
    // el verso se ilumina a ritmo de canto, se queda encendido, y el hueco se
    // muestra como "solo música" hasta que entra el verso siguiente.
    var p = 1;
    if (idx >= 0) {
      // Si se ha avanzado antes de tiempo, el barrido arranca AHORA (no en el
      // segundo teórico, que aún no ha llegado) para que la letra no se quede
      // quieta mientras el coro ya canta ese verso.
      var ini = (idx > idxCrudo) ? Math.min(tiempos[idx], pos) : tiempos[idx];
      var sig = (idx + 1 < tiempos.length) ? tiempos[idx + 1] : tiempos[idx] + 4;
      var Lc = estado.lineas[idx];
      var nch = (Lc && Lc.pal && Lc.pal.length) || 16;
      var estimado = nch * 0.16 + 0.6;
      var hueco = sig - ini;
      var durCanto;
      if (estado.fiable) {
        // Sincronía exacta: el barrido dura hasta que entra el verso siguiente
        // (así no se termina y se queda esperando). Solo se recorta si el hueco
        // es tan grande que de verdad hay parte instrumental por medio.
        durCanto = (hueco > 5.5) ? Math.max(1.5, estimado) : Math.max(1.2, hueco - 0.15);
      } else {
        durCanto = Math.max(1.5, Math.min(Math.max(1.5, hueco), estimado));
      }
      p = durCanto > 0 ? (pos - ini) / durCanto : 1;
      p = Math.max(0, Math.min(1, p));
      if (REDUCE) p = 1;
    }

    if (idx !== estado.activa || forzar) {
      var anterior = estado.activa;
      estado.activa = idx;
      estado.lineas.forEach(function (L, i2) {
        var esAct = i2 === idx;
        L.el.classList.toggle('is-activa', esAct);
        L.el.classList.toggle('is-pasada', idx >= 0 && i2 < idx);
        L.el.classList.toggle('is-proxima', idx < 0 || i2 > idx);
        L.el.classList.toggle('is-siguiente', i2 === idx + 1);
        L.el.classList.toggle('is-anterior', i2 === idx - 1);
        // Profundidad: las que vienen lejos, más tenues (la de al lado, nítida).
        // Se usa SOLO opacidad (va por GPU); nada de filter:blur por línea, que
        // en el WebView de Android obliga a rerasterizar y hace "parpadear" la
        // pantalla entera.
        if (!esAct && idx >= 0 && i2 - idx >= 2) {
          L.el.style.opacity = String(Math.max(0.34, 1 - (i2 - idx - 1) * 0.16));
        } else {
          L.el.style.opacity = '';
        }
        // Letras: la línea activa se recalcula frame a frame más abajo; las
        // demás quedan encendidas (ya cantadas) o apagadas (por venir).
        var encendidas = idx >= 0 && i2 < idx;
        for (var w = 0; w < L.pal.length; w++) {
          var seg0 = L.pal[w];
          if (seg0.on !== encendidas || esAct) {
            seg0.on = esAct ? false : encendidas;
            seg0.el.classList.toggle('is-on', seg0.on);
          }
        }
      });
      // Brillo al terminar el verso: la que acaba de dejar de sonar.
      if (anterior >= 0 && idx > anterior && estado.lineas[anterior]) {
        flashFin(estado.lineas[anterior].el);
      }
      if (forzar || perf() - estado.scrollUsuario > PAUSA_SCROLL) {
        desplazarA(idx, !forzar);
      }
    }

    // Barrido letra a letra de la línea activa: cada letra solo CAMBIA DE COLOR
    // al pasar su punto medio (clase is-on). Nada de transform/text-shadow
    // variable por <span> y por frame: en el WebView de Android eso hace que
    // el texto "vibre" (el glifo se recoloca en la rejilla de píxeles). El CSS
    // ya no lee --lift, así que aquí tampoco se escribe.
    if (idx >= 0) {
      var LA = estado.lineas[idx];
      if (LA) {
        for (var k = 0; k < LA.pal.length; k++) {
          var seg = LA.pal[k];
          var on = p >= (seg.r0 + seg.r1) / 2;
          if (on !== seg.on) {
            seg.on = on;
            seg.el.classList.toggle('is-on', on);
          }
        }
      }
    }

    // Marcas de "solo música": siempre visibles (ya colocadas en construir).
    // La que corresponde al momento actual "late"; las demás quedan quietas.
    if (estado.marcas && estado.marcas.length) {
      var activaM = -1;
      for (var mi = 0; mi < estado.marcas.length; mi++) {
        var M = estado.marcas[mi];
        if (pos >= M.desde - 0.15 && pos < M.hasta - 0.05) { activaM = mi; break; }
      }
      for (var mj = 0; mj < estado.marcas.length; mj++) {
        estado.marcas[mj].el.classList.toggle(
          'is-sonando', mj === activaM && estado.reproduciendo);
      }
    }

    // Botón "volver a la letra": aparece si Maite ha desplazado a mano y la
    // vista ya no sigue al verso que suena.
    var volver = capa.querySelector('[data-ll-volver]');
    if (volver) {
      var desviada = false;
      if (estado.activa >= 0 && perf() - estado.scrollUsuario < PAUSA_SCROLL) {
        // Solo si el verso que suena NO está a la vista (si sí lo está, aunque
        // Maite haya tocado el scroll, no hace falta el botón).
        var L = estado.lineas[estado.activa];
        var sc = capa.querySelector('[data-ll-scroll]');
        if (L && sc) {
          var r = L.el.getBoundingClientRect();
          var rv = sc.getBoundingClientRect();
          desviada = r.bottom < rv.top + 48 || r.top > rv.bottom - 48;
        }
      }
      volver.classList.toggle('is-visible', desviada);
    }
  }

  function flashFin(el) {
    if (!el || REDUCE) return;
    el.classList.remove('is-fin');
    void el.offsetWidth;
    el.classList.add('is-fin');
    setTimeout(function () { if (el) el.classList.remove('is-fin'); }, 700);
  }

  // Lleva la línea activa a ~ANCLA de la altura con un desplazamiento
  // propio (ease-out suave), no el scroll "smooth" del navegador, que va
  // a saltos. El navegador limita al contenido real: sin huecos vacíos.
  function desplazarA(idx, suave) {
    var vp = capa.querySelector('[data-ll-scroll]');
    if (!vp) return;
    var ref = (idx < 0) ? null : (estado.lineas[idx] && estado.lineas[idx].el);
    var destino;
    if (idx < 0) {
      destino = 0;
    } else if (ref) {
      destino = ref.offsetTop + ref.offsetHeight / 2 - vp.clientHeight * ANCLA;
    } else { return; }
    var max = Math.max(0, vp.scrollHeight - vp.clientHeight);
    destino = Math.max(0, Math.min(destino, max));

    if (estado.scrollRaf) { cancelAnimationFrame(estado.scrollRaf); estado.scrollRaf = 0; }
    var desde = vp.scrollTop;
    var delta = destino - desde;
    if (Math.abs(delta) < 1) { estado.autoHasta = perf() + 200; return; }
    if (!suave || REDUCE) { estado.autoHasta = perf() + 200; vp.scrollTop = destino; return; }

    var t0 = perf();
    var DUR = Math.min(1200, 560 + Math.abs(delta) * 0.55);
    (function paso() {
      var k = Math.min(1, (perf() - t0) / DUR);
      // easeInOutQuint: entra y sale muy suave, sin tirón (sensación "líquida")
      var e = k < 0.5 ? 16 * k * k * k * k * k
                      : 1 - Math.pow(-2 * k + 2, 5) / 2;
      vp.scrollTop = desde + delta * e;
      estado.autoHasta = perf() + 180;
      estado.scrollRaf = (k < 1) ? requestAnimationFrame(paso) : 0;
    })();
  }

  /* ---------- Arrastrar la cabecera para cerrar ---------- */

  function montarArrastreCierre() {
    var asa = capa.querySelector('[data-ll-top]');
    var y0 = 0, dy = 0, activo = false;
    asa.addEventListener('touchstart', function (e) {
      y0 = e.touches[0].clientY; dy = 0; activo = true;
      capa.style.transition = 'none';
    }, { passive: true });
    asa.addEventListener('touchmove', function (e) {
      if (!activo) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) capa.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    asa.addEventListener('touchend', function () {
      if (!activo) return;
      activo = false;
      capa.style.transition = '';
      capa.style.transform = '';
      if (dy > 90) cerrar();
    });
  }

  /* ---------- Utilidades ---------- */

  // Primera letra de la frase en mayúscula (respeta signos de apertura como
  // «, ¿, ¡, comillas). Solo toca el primer carácter alfabético.
  function capFrase(s) {
    try {
      return s.replace(/^([^\p{L}]*)(\p{L})/u, function (m, pre, ch) {
        return pre + ch.toLocaleUpperCase('es');
      });
    } catch (e) {
      return s.replace(/^([^A-Za-zÀ-ÿ]*)([a-zà-ÿ])/, function (m, pre, ch) {
        return pre + ch.toUpperCase();
      });
    }
  }

  function mediana(arr) {
    var a = arr.filter(function (n) { return isFinite(n); }).sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function perf() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }
  function fmt(seg) {
    seg = Math.max(0, Math.round(seg || 0));
    var m = Math.floor(seg / 60), s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  return {
    abrir: abrir,
    cerrar: function () { cerrar(); },
    abierta: function () { return !!capa; },
  };
})();
