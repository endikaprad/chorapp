/* ============================================================
   Compartido — recibir un audio/PDF/imagen que Maite comparte
   desde otra app (WhatsApp, Galería…) con "Compartir con ChorApp".

   Se apoya en un plugin nativo propio (CompartidoPlugin.java,
   ver native/android/) registrado como window.Capacitor.Plugins.Compartido:
     - obtenerPendiente(): Promise<{nombre,mime,ruta}|{}>  (arranque en frío)
     - addListener('recibido', cb)                         (app ya abierta)

   El archivo llega copiado a una ruta absoluta de caché de Android.
   comoArchivo() lo lee con @capacitor/filesystem y lo convierte en un
   File normal, listo para Sesiones.crearSuelta / Adjuntos.aplicar.
   ============================================================ */

window.Compartido = (function () {
  'use strict';

  function plugin() {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Compartido;
  }

  function normalizar(datos) {
    if (!datos || !datos.ruta) return null;
    var mime = datos.mime || '';
    var tipo = 'otro';
    if (mime.indexOf('audio/') === 0) tipo = 'audio';
    else if (mime.indexOf('image/') === 0) tipo = 'imagen';
    else if (mime === 'application/pdf') tipo = 'pdf';
    return { nombre: datos.nombre || 'compartido', mime: mime, ruta: datos.ruta, tipo: tipo };
  }

  // Se llama una vez al arrancar: ¿la app se abrió porque compartieron algo?
  function comprobarAlArrancar() {
    var p = plugin();
    if (!p) return Promise.resolve(null);
    return p.obtenerPendiente().then(normalizar).catch(function () { return null; });
  }

  // Se llama con la app ya abierta: llega un nuevo "compartir" mientras se usa.
  function escuchar(cb) {
    var p = plugin();
    if (!p) return;
    p.addListener('recibido', function (datos) {
      var n = normalizar(datos);
      if (n) cb(n);
    });
  }

  // Lee el archivo de la ruta nativa y lo convierte en File (para
  // Archivos.guardar / Sesiones.crearSuelta / Adjuntos.aplicar).
  function comoArchivo(item) {
    var Filesystem = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (!Filesystem) return Promise.reject(new Error('Filesystem no disponible'));
    return Filesystem.readFile({ path: item.ruta }).then(function (r) {
      var bin = atob(r.data);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], item.nombre, { type: item.mime || 'application/octet-stream' });
    });
  }

  return { comprobarAlArrancar: comprobarAlArrancar, escuchar: escuchar, comoArchivo: comoArchivo };
})();
