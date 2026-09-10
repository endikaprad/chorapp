/* ============================================================
   ota.js — Actualizaciones por wifi (OTA) del contenido web.

   window.OTA.iniciar() (lo llama app.js en cada arranque):
     1. avisa a Capgo de que la app arrancó bien (notifyAppReady):
        si no, a los ~10 s Capgo revierte al bundle anterior.
     2. consulta /updates/latest en la misma base de datos que
        usan control-remoto.js y push.js (data/control.json).
     3. si hay un "bundle" (número entero) mayor que el instalado:
          - normal: muestra una tarjeta ("Hay una versión nueva de ChorApp").
          - obligatoria: entra directo a la pantalla de actualización.
     4. al pulsar "Actualizar" (o si es obligatoria) se abre una capa a
        pantalla completa con el fondo difuminado y un anillo de progreso;
        al terminar, Capgo cambia la carpeta que sirve el WebView y recarga.

   Qué se actualiza así: TODO lo de www/ (HTML, CSS, JS, audios,
   PDF.js…). Lo que NO: plugins nativos, capacitor.config, permisos
   de Android — eso sigue necesitando un APK nuevo (lo avisa
   scripts/ota.js al lanzar la release).

   El número de bundle "de fábrica" del APK vive en data/version.json;
   scripts/ota.js lo sube en cada release y lo commitea, así un APK
   recién compilado nunca se cree más viejo que la última OTA.

   Solo actúa en el APK y solo si está el plugin @capgo/capacitor-updater
   (Fase 11). En el navegador (npm run dev) no hace nada; para probar:
   window.OTA.simularBanner()  /  window.OTA.simularActu().
   ============================================================ */

window.OTA = (function () {
  'use strict';

  var K_APLICADO = 'ota:aplicado';   // nº de bundle que ya se aplicó por OTA
  var K_POSPUESTO = 'ota:pospuesto';  // nº de bundle para el que Maite pulsó "Ahora no"

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var bannerEnPantalla = false;
  var comprobando = false;
  var aplicando = false;

  function plugin() {
    var Cap = window.Capacitor;
    return (Cap && Cap.Plugins && Cap.Plugins.CapacitorUpdater) || null;
  }
  function esNativo() {
    var Cap = window.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }
  function num(v) { var n = parseInt(v, 10); return isFinite(n) ? n : 0; }
  function leer(k) { return window.Almacen ? window.Almacen.leer(k, null) : null; }
  function guardar(k, v) { if (window.Almacen) window.Almacen.guardar(k, v); }
  function borrar(k) { if (window.Almacen) window.Almacen.borrar(k); }

  /* --------------------------------------------------------
     Arranque
     -------------------------------------------------------- */

  function iniciar() {
    var CU = plugin();
    if (!esNativo() || !CU) return;

    // Imprescindible: confirma que este bundle arranca bien. Sin esto,
    // Capgo lo da por roto y vuelve al anterior a los pocos segundos.
    try { CU.notifyAppReady(); } catch (e) {}

    // Mantener K_APLICADO a la par de lo que Capgo tiene cargado de verdad.
    if (CU.current) {
      CU.current().then(function (r) {
        var v = r && r.bundle && num(r.bundle.version);
        if (v && v > num(leer(K_APLICADO))) guardar(K_APLICADO, v);
      }).catch(function () {});
    }

    comprobar();

    var App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && App.addListener) {
      App.addListener('resume', function () { comprobar(); });
    }
  }

  /* --------------------------------------------------------
     Consulta
     -------------------------------------------------------- */

  function comprobar() {
    if (comprobando || bannerEnPantalla || aplicando) return;
    comprobando = true;

    Promise.all([
      fetch('data/version.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
      fetch('data/control.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var base = res[0] || {};
      var cfg = res[1];
      var dbUrl = cfg && cfg.dbUrl ? String(cfg.dbUrl).replace(/\/+$/, '') : null;
      if (!dbUrl) { comprobando = false; return; }

      fetch(dbUrl + '/updates/latest.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (info) {
          comprobando = false;
          if (!info || typeof info !== 'object') return;

          var remoto = num(info.bundle);
          var instalado = Math.max(num(base.bundle), num(leer(K_APLICADO)));
          if (!remoto || remoto <= instalado) return;
          if (!/^https:\/\/.+\.zip($|\?)/i.test(String(info.url || ''))) return;

          if (info.obligatoria) return iniciarActualizacion(info, true);
          if (num(leer(K_POSPUESTO)) === remoto) return; // ya dijo "ahora no"
          mostrarBanner(info);
        })
        .catch(function () { comprobando = false; });
    }).catch(function () { comprobando = false; });
  }

  /* --------------------------------------------------------
     Descarga + aplicación (lógica)
     -------------------------------------------------------- */

  // onProgreso(pct): 0-100 mientras descarga · 'aplicando' · 'error'
  function descargarYAplicar(info, onProgreso) {
    var CU = plugin();
    if (!CU || aplicando) return;
    aplicando = true;

    var quitarLis = null;
    if (CU.addListener) {
      var p = CU.addListener('download', function (st) {
        if (st && typeof st.percent === 'number') onProgreso(Math.max(0, Math.min(100, Math.round(st.percent))));
      });
      if (p && p.then) p.then(function (h) { quitarLis = function () { try { h.remove(); } catch (e) {} }; });
      else quitarLis = function () { try { p.remove(); } catch (e) {} };
    }

    var opts = { url: info.url, version: String(num(info.bundle)) };
    if (/^[0-9a-f]{64}$/i.test(String(info.sha256 || ''))) opts.checksum = info.sha256;

    CU.download(opts)
      .then(function (b) {
        if (quitarLis) quitarLis();
        if (!b || !b.id) throw new Error('descarga sin id');
        onProgreso('aplicando');
        guardar(K_APLICADO, num(info.bundle));
        borrar(K_POSPUESTO);
        return CU.set({ id: b.id }); // recarga el WebView con lo nuevo
      })
      .catch(function (e) {
        if (quitarLis) quitarLis();
        aplicando = false;
        borrar(K_APLICADO);
        if (window.console) console.warn('OTA: fallo al actualizar', e);
        onProgreso('error');
      });
  }

  /* --------------------------------------------------------
     Tarjeta de aviso (abajo, discreta)
     -------------------------------------------------------- */

  function mostrarBanner(info) {
    if (bannerEnPantalla) return;
    bannerEnPantalla = true;

    try { if (window.Vibra && window.Vibra.aviso) window.Vibra.aviso(); } catch (e) {}

    var nota = (info.nota || '').toString().slice(0, 240);
    var capa = document.createElement('div');
    capa.className = 'ota-banner';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-label', 'Actualización disponible');
    capa.innerHTML =
      '<div class="ota-banner__caja">' +
        '<span class="ota-banner__ic" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>' +
        '</span>' +
        '<div class="ota-banner__txt">' +
          '<p class="ota-banner__titulo">Hay una versión nueva de ChorApp</p>' +
          '<p class="ota-banner__nota"></p>' +
        '</div>' +
        '<div class="ota-banner__acciones">' +
          '<button type="button" class="btn btn--primario" data-ota-ok>Actualizar</button>' +
          '<button type="button" class="ota-banner__luego" data-ota-luego>Ahora no</button>' +
        '</div>' +
      '</div>';

    capa.querySelector('.ota-banner__nota').textContent =
      nota || 'Toca para ponerte al día. Tarda unos segundos.';

    function cerrar() {
      capa.classList.remove('is-visible');
      bannerEnPantalla = false;
      var quita = function () { if (capa.parentNode) capa.parentNode.removeChild(capa); };
      if (reduce) quita();
      else {
        capa.addEventListener('transitionend', quita, { once: true });
        setTimeout(quita, 400);
      }
    }

    capa.querySelector('[data-ota-ok]').addEventListener('click', function () {
      cerrar();
      iniciarActualizacion(info, false);
    });
    capa.querySelector('[data-ota-luego]').addEventListener('click', function () {
      guardar(K_POSPUESTO, num(info.bundle));
      cerrar();
    });

    document.body.appendChild(capa);
    void capa.offsetWidth;
    capa.classList.add('is-visible');
  }

  /* --------------------------------------------------------
     Capa de actualización — pantalla completa, fondo difuminado,
     anillo de progreso.
     -------------------------------------------------------- */

  var CIRC = 213.6; // 2·π·34 (r del anillo en el SVG de abajo)

  function iniciarActualizacion(info, obligatoria) {
    if (document.querySelector('.ota-actu')) return;

    var capa = document.createElement('div');
    capa.className = 'ota-actu';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.setAttribute('aria-label', 'Actualizando ChorApp');
    capa.innerHTML =
      '<div class="ota-actu__fondo"></div>' +
      '<div class="ota-actu__caja">' +
        '<div class="ota-actu__anillo" data-anillo>' +
          '<svg viewBox="0 0 80 80" aria-hidden="true">' +
            '<circle class="ota-actu__pista" cx="40" cy="40" r="34"/>' +
            '<circle class="ota-actu__arco" cx="40" cy="40" r="34" data-arco ' +
              'stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + CIRC + '"/>' +
          '</svg>' +
          '<span class="ota-actu__pct" data-pct></span>' +
        '</div>' +
        '<p class="ota-actu__titulo" data-titulo>Actualizando ChorApp</p>' +
        '<p class="ota-actu__sub" data-sub>Descargando la versión nueva…</p>' +
        '<div class="ota-actu__acciones" data-acciones hidden>' +
          '<button type="button" class="btn btn--primario" data-reintentar>Reintentar</button>' +
          '<button type="button" class="ota-actu__cerrar" data-cerrar>Ahora no</button>' +
        '</div>' +
      '</div>';

    var anillo = capa.querySelector('[data-anillo]');
    var arco = capa.querySelector('[data-arco]');
    var elPct = capa.querySelector('[data-pct]');
    var elTitulo = capa.querySelector('[data-titulo]');
    var elSub = capa.querySelector('[data-sub]');
    var acciones = capa.querySelector('[data-acciones]');

    function pintar(estado) {
      if (estado === 'error') {
        anillo.classList.remove('is-indet');
        anillo.classList.add('is-error');
        arco.setAttribute('stroke-dashoffset', 0);
        elPct.textContent = '!';
        elTitulo.textContent = 'No se pudo actualizar';
        elSub.textContent = 'Revisa la conexión wifi e inténtalo otra vez.';
        acciones.hidden = false;
        return;
      }
      if (estado === 'aplicando') {
        anillo.classList.add('is-indet');
        elPct.textContent = '';
        elTitulo.textContent = 'Casi está';
        elSub.textContent = 'Aplicando la actualización…';
        return;
      }
      // número 0-100
      anillo.classList.remove('is-indet');
      var pct = estado || 0;
      arco.setAttribute('stroke-dashoffset', CIRC * (1 - pct / 100));
      elPct.textContent = pct + '%';
      elSub.textContent = 'Descargando la versión nueva…';
    }

    capa.querySelector('[data-reintentar]').addEventListener('click', function () {
      acciones.hidden = true;
      anillo.classList.remove('is-error');
      pintar(0);
      descargarYAplicar(info, pintar);
    });
    capa.querySelector('[data-cerrar]').addEventListener('click', function () {
      if (!obligatoria) {
        guardar(K_POSPUESTO, num(info.bundle));
        cerrarActu(capa);
      }
    });
    // Si es obligatoria, no se puede cerrar: ocultamos "Ahora no".
    if (obligatoria) capa.querySelector('[data-cerrar]').hidden = true;

    document.body.appendChild(capa);
    document.body.classList.add('con-ota-actu');
    void capa.offsetWidth;
    capa.classList.add('is-visible');

    pintar(0);
    descargarYAplicar(info, pintar);
  }

  function cerrarActu(capa) {
    aplicando = false;
    document.body.classList.remove('con-ota-actu');
    capa.classList.remove('is-visible');
    var quita = function () { if (capa.parentNode) capa.parentNode.removeChild(capa); };
    if (reduce) quita();
    else {
      capa.addEventListener('transitionend', quita, { once: true });
      setTimeout(quita, 400);
    }
  }

  /* ---------- Ayudas para probar (consola del WebView o navegador) ---------- */
  function simularBanner() {
    bannerEnPantalla = false;
    mostrarBanner({ bundle: 9999, nombre: 'prueba', url: 'https://x/y.zip',
      nota: 'Ejemplo de aviso de actualización.' });
  }
  // Anima la capa de actualización sin descargar nada (solo para ver el diseño).
  function simularActu() {
    if (document.querySelector('.ota-actu')) return;
    var real = plugin();
    // Monkey-patch temporal: fingimos una descarga con progreso.
    var falso = {
      addListener: function (_e, cb) {
        var pct = 0;
        var t = setInterval(function () {
          pct += 7; cb({ percent: pct });
          if (pct >= 100) { clearInterval(t); }
        }, 220);
        return Promise.resolve({ remove: function () { clearInterval(t); } });
      },
      download: function () {
        return new Promise(function (res) { setTimeout(function () { res({ id: 'x' }); }, 3600); });
      },
      set: function () { return new Promise(function () {}); } // no recarga en la demo
    };
    window.Capacitor = window.Capacitor || {};
    window.Capacitor.Plugins = window.Capacitor.Plugins || {};
    window.Capacitor.Plugins.CapacitorUpdater = falso;
    aplicando = false;
    iniciarActualizacion({ bundle: 9999, url: 'https://x/y.zip' }, false);
    setTimeout(function () {
      if (real) window.Capacitor.Plugins.CapacitorUpdater = real;
      else delete window.Capacitor.Plugins.CapacitorUpdater;
    }, 8000);
  }
  function estado() {
    return {
      nativo: esNativo(),
      plugin: !!plugin(),
      aplicado: leer(K_APLICADO),
      pospuesto: leer(K_POSPUESTO)
    };
  }

  return {
    iniciar: iniciar, comprobar: comprobar,
    simularBanner: simularBanner, simularActu: simularActu, estado: estado
  };
})();
