/* ============================================================
   compartir.js — Enviar / descargar un archivo desde la app.

   window.Compartir.enviar({ blob, nombre, texto })
     - En el APK: guarda el blob en caché y abre el menú de
       compartir de Android (@capacitor/share). Desde ahí, Ama
       elige WhatsApp, Bluetooth, correo…
     - En navegador: usa la Web Share API con archivo si el
       dispositivo la soporta (móvil); si no, descarga el archivo.

   window.Compartir.descargar({ blob, nombre })
     - En el APK: guarda el archivo en la carpeta Documentos.
     - En navegador: descarga normal.

   Requiere, para el modo nativo, los plugins @capacitor/share y
   @capacitor/filesystem (ver capacitor.config.json / Fase 2). Si
   no están, cae con elegancia al comportamiento web.
   ============================================================ */

window.Compartir = (function () {
  'use strict';

  function esNativo() {
    return !!(window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform());
  }
  function plugins() {
    return (window.Capacitor && window.Capacitor.Plugins) || {};
  }

  function blobABase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || '');
        res(s.slice(s.indexOf(',') + 1));
      };
      r.onerror = function () { rej(r.error || new Error('lectura')); };
      r.readAsDataURL(blob);
    });
  }

  // Escribe el blob en la carpeta indicada y devuelve su URI nativa.
  function escribir(blob, nombre, directory) {
    var Filesystem = plugins().Filesystem;
    if (!Filesystem) return Promise.reject(new Error('sin Filesystem'));
    return blobABase64(blob).then(function (b64) {
      return Filesystem.writeFile({ path: nombre, data: b64, directory: directory });
    }).then(function () {
      return Filesystem.getUri({ path: nombre, directory: directory });
    }).then(function (r) { return r.uri; });
  }

  function descargaWeb(blob, nombre) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); res(); }, 1500);
    });
  }

  // Devuelve una promesa que resuelve { via: 'nativo'|'web'|'descarga' }.
  function enviar(opts) {
    opts = opts || {};
    var blob = opts.blob;
    var nombre = opts.nombre || 'grabacion';
    var texto = opts.texto || '';
    if (!blob) return Promise.reject(new Error('sin archivo'));

    if (esNativo() && plugins().Share && plugins().Filesystem) {
      return escribir(blob, nombre, 'CACHE').then(function (uri) {
        return plugins().Share.share({
          title: nombre,
          text: texto,
          url: uri,
          dialogTitle: 'Enviar grabación',
        });
      }).then(function () { return { via: 'nativo' }; });
    }

    // Web Share API con archivo (móviles modernos).
    try {
      var file = new File([blob], nombre, { type: blob.type || 'audio/webm' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], text: texto })
          .then(function () { return { via: 'web' }; });
      }
    } catch (e) { /* sigue al fallback */ }

    return descargaWeb(blob, nombre).then(function () { return { via: 'descarga' }; });
  }

  function descargar(opts) {
    opts = opts || {};
    var blob = opts.blob;
    var nombre = opts.nombre || 'grabacion';
    if (!blob) return Promise.reject(new Error('sin archivo'));

    if (esNativo() && plugins().Filesystem) {
      return escribir(blob, nombre, 'DOCUMENTS').then(function () {
        return { via: 'documentos' };
      });
    }
    return descargaWeb(blob, nombre).then(function () { return { via: 'descarga' }; });
  }

  return { enviar: enviar, descargar: descargar };
})();
