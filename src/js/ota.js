/* ============================================================
   ota.js — Actualizaciones por wifi (OTA) del contenido web.

   window.OTA.iniciar() (lo llama app.js en cada arranque):
     1. avisa a Capgo de que la app arrancó bien (notifyAppReady):
        si no, a los ~10 s Capgo revierte al bundle anterior.
     2. consulta /updates/latest en la misma base de datos que
        usan control-remoto.js y push.js (data/control.json).
     3. si hay un "bundle" (número entero) mayor que el instalado:
          - normal: muestra una tarjeta cálida ("Hay novedades 🎶").
            La descarga (con barra) ocurre al pulsar "Actualizar".
          - obligatoria: descarga y aplica sin preguntar.
     4. al aplicar, Capgo cambia la carpeta que sirve el WebView y
        recarga. La próxima apertura ya arranca con lo nuevo.

   Qué se actualiza así: TODO lo de www/ (HTML, CSS, JS, audios,
   PDF.js…). Lo que NO: plugins nativos, capacitor.config, permisos
   de Android — eso sigue necesitando un APK nuevo (lo avisa
   scripts/ota.js al lanzar la release).

   El número de bundle "de fábrica" del APK vive en data/version.json;
   scripts/ota.js lo sube en cada release y lo commitea, así un APK
   recién compilado nunca se cree más viejo que la última OTA.

   Solo actúa en el APK y solo si está el plugin @capgo/capacitor-updater
   (Fase 11). En el navegador (npm run dev) no hace nada; para probar la
   tarjeta desde la consola: window.OTA.simularBanner().
   ============================================================ */

window.OTA = (function () {
  'use strict';

  var K_APLICADO = 'ota:aplicado';   // nº de bundle que ya se aplicó por OTA
  var K_POSPUESTO = 'ota:pospuesto';  // nº de bundle para el que Maite pulsó "Luego"

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

          if (info.obligatoria) return descargarYAplicar(info, null);
          if (num(leer(K_POSPUESTO)) === remoto) return; // ya dijo "ahora no"
          mostrarBanner(info);
        })
        .catch(function () { comprobando = false; });
    }).catch(function () { comprobando = false; });
  }

  /* --------------------------------------------------------
     Descarga + aplicación
     -------------------------------------------------------- */

  // onProgreso(pct|null): pct 0-100 durante la descarga; null al aplicar.
  function descargarYAplicar(info, onProgreso) {
    var CU = plugin();
    if (!CU || aplicando) return;
    aplicando = true;

    var quitarLis = null;
    if (onProgreso && CU.addListener) {
      var p = CU.addListener('download', function (st) {
        if (st && typeof st.percent === 'number') onProgreso(Math.round(st.percent));
      });
      quitarLis = function () { try { (p.remove ? p : p.then(function (h) { return h; })).remove(); } catch (e) {} };
      // addListener puede devolver promesa o handle según versión.
      if (p && p.then) p.then(function (h) { quitarLis = function () { try { h.remove(); } catch (e) {} }; });
    }

    var opts = { url: info.url, version: String(num(info.bundle)) };
    if (/^[0-9a-f]{64}$/i.test(String(info.sha256 || ''))) opts.checksum = info.sha256;

    CU.download(opts)
      .then(function (b) {
        if (quitarLis) quitarLis();
        if (!b || !b.id) throw new Error('descarga sin id');
        if (onProgreso) onProgreso(null); // "aplicando…"
        guardar(K_APLICADO, num(info.bundle));
        borrar(K_POSPUESTO);
        return CU.set({ id: b.id }); // recarga el WebView
      })
      .catch(function (e) {
        if (quitarLis) quitarLis();
        aplicando = false;
        borrar(K_APLICADO);
        if (window.console) console.warn('OTA: fallo al actualizar', e);
        if (onProgreso) onProgreso('error');
      });
  }

  /* --------------------------------------------------------
     Tarjeta de aviso
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
          '<p class="ota-banner__titulo">Hay novedades en ChorApp <span aria-hidden="true">🎶</span></p>' +
          '<p class="ota-banner__nota"></p>' +
        '</div>' +
        '<div class="ota-banner__acciones">' +
          '<button type="button" class="btn btn--primario" data-ota-ok>Actualizar</button>' +
          '<button type="button" class="ota-banner__luego" data-ota-luego>Ahora no</button>' +
        '</div>' +
      '</div>';

    var elNota = capa.querySelector('.ota-banner__nota');
    elNota.textContent = nota || 'Toca para ponerte al día. Tarda unos segundos.';

    var btnOk = capa.querySelector('[data-ota-ok]');
    var btnLuego = capa.querySelector('[data-ota-luego]');

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

    btnOk.addEventListener('click', function () {
      btnLuego.disabled = true;
      btnOk.disabled = true;
      btnOk.textContent = 'Descargando…';
      descargarYAplicar(info, function (pct) {
        if (pct === 'error') {
          btnOk.disabled = false;
          btnLuego.disabled = false;
          btnOk.textContent = 'Reintentar';
          elNota.textContent = 'No se pudo descargar. Comprueba el wifi e inténtalo otra vez.';
        } else if (pct === null) {
          btnOk.textContent = 'Aplicando…';
        } else {
          btnOk.textContent = 'Descargando ' + pct + '%';
        }
      });
    });
    btnLuego.addEventListener('click', function () {
      guardar(K_POSPUESTO, num(info.bundle));
      cerrar();
    });

    document.body.appendChild(capa);
    void capa.offsetWidth;
    capa.classList.add('is-visible');
  }

  /* ---------- Ayudas para probar desde la consola del WebView ---------- */
  function simularBanner() {
    mostrarBanner({ bundle: 9999, nombre: 'prueba', url: 'https://x/y.zip',
      nota: 'Ejemplo de aviso de actualización.' });
  }
  function estado() {
    return {
      nativo: esNativo(),
      plugin: !!plugin(),
      aplicado: leer(K_APLICADO),
      pospuesto: leer(K_POSPUESTO)
    };
  }

  return { iniciar: iniciar, comprobar: comprobar, simularBanner: simularBanner, estado: estado };
})();
