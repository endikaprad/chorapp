/* ============================================================
   archivos.js — Almacén de archivos (audio, letra, partitura,
   notas de voz) de ChorApp.

   window.Archivos guarda los BLOBS en IndexedDB con una clave
   de texto. Funciona igual en el navegador y en el WebView de
   Android, así que hay un único camino de código.
   (Los METADATOS — nombre, tipo, tamaño — viven en la canción,
   dentro de Almacen; ver canciones.js.)

   Claves usadas:
     "<cancionId>:audio"      "<cancionId>:letra"
     "<cancionId>:partitura"  "<cancionId>:voz:<notaId>"
   ============================================================ */

window.Archivos = (function () {
  'use strict';

  var NOMBRE_BD = 'chorapp-archivos';
  var ALMACEN = 'blobs';
  var _bd = null;

  function abrir() {
    if (_bd) return Promise.resolve(_bd);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(NOMBRE_BD, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(ALMACEN);
      };
      req.onsuccess = function () { _bd = req.result; resolve(_bd); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(modo, fn) {
    return abrir().then(function (bd) {
      return new Promise(function (resolve, reject) {
        var t = bd.transaction(ALMACEN, modo);
        var store = t.objectStore(ALMACEN);
        var resultado;
        var pet = fn(store);
        if (pet) pet.onsuccess = function () { resultado = pet.result; };
        t.oncomplete = function () { resolve(resultado); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  // Guarda un File/Blob y devuelve sus metadatos.
  function guardar(clave, archivo) {
    return tx('readwrite', function (s) {
      return s.put(archivo, clave);
    }).then(function () {
      return {
        nombre: archivo.name || clave.split(':').pop(),
        mime: archivo.type || '',
        tamano: archivo.size || 0,
        guardado: Date.now(),
      };
    });
  }

  function obtener(clave) {
    return tx('readonly', function (s) { return s.get(clave); })
      .then(function (v) { return v || null; });
  }

  // Devuelve un object URL (el que llama debe revocarlo con liberar()).
  function url(clave) {
    return obtener(clave).then(function (blob) {
      return blob ? URL.createObjectURL(blob) : null;
    });
  }

  function liberar(objUrl) {
    if (objUrl) { try { URL.revokeObjectURL(objUrl); } catch (e) {} }
  }

  function borrar(clave) {
    return tx('readwrite', function (s) { return s.delete(clave); });
  }

  // Borra todas las claves que empiezan por `prefijo`.
  function borrarPrefijo(prefijo) {
    return tx('readwrite', function (s) {
      var cur = s.openCursor();
      cur.onsuccess = function () {
        var c = cur.result;
        if (!c) return;
        if (String(c.key).indexOf(prefijo) === 0) c.delete();
        c.continue();
      };
      return null;
    });
  }

  // Borra todos los archivos de una canción (letra, partitura, …).
  function borrarCancion(cancionId) {
    return borrarPrefijo(cancionId + ':');
  }

  // Mueve un blob de una clave a otra (para migraciones). No falla si no existe.
  function mover(claveVieja, claveNueva) {
    return obtener(claveVieja).then(function (blob) {
      if (!blob) return null;
      return tx('readwrite', function (s) {
        s.put(blob, claveNueva);
        return s.delete(claveVieja);
      });
    });
  }

  return {
    guardar: guardar,
    obtener: obtener,
    url: url,
    liberar: liberar,
    borrar: borrar,
    borrarPrefijo: borrarPrefijo,
    borrarCancion: borrarCancion,
    mover: mover,
  };
})();
