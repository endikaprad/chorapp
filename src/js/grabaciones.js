/* ============================================================
   grabaciones.js — Grabadora personal (Fase 7).

   window.Grabaciones gestiona las grabaciones en las que Maite
   se graba cantando. Los METADATOS van en Almacen ('grabaciones');
   el audio (blob) va en window.Archivos con clave "grab:<id>".

   Modelo:
     { id, cancionId | null, titulo, creado, mime, dur }
   ============================================================ */

window.Grabaciones = (function () {
  'use strict';

  var CLAVE = 'grabaciones';

  function nuevoId() {
    return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function _leer() {
    var l = window.Almacen.leer(CLAVE, []);
    return Array.isArray(l) ? l : [];
  }
  function _guardar(l) { window.Almacen.guardar(CLAVE, l); }

  // Más recientes primero.
  function listar() {
    return _leer().slice().sort(function (a, b) { return (b.creado || 0) - (a.creado || 0); });
  }

  // meta: { cancionId, titulo, mime, dur }   blob: Blob
  function crear(meta, blob) {
    var g = {
      id: nuevoId(),
      cancionId: meta.cancionId || null,
      titulo: meta.titulo || 'Sin canción',
      creado: Date.now(),
      mime: meta.mime || (blob && blob.type) || '',
      dur: meta.dur || 0,
    };
    return window.Archivos.guardar('grab:' + g.id, blob).then(function () {
      var l = _leer();
      l.push(g);
      _guardar(l);
      return g;
    });
  }

  function borrar(id) {
    _guardar(_leer().filter(function (g) { return g.id !== id; }));
    return window.Archivos.borrar('grab:' + id);
  }

  function url(id) { return window.Archivos.url('grab:' + id); }

  // Si se borra una canción, sus grabaciones quedan como "Sin canción".
  function desvincular(cancionId) {
    var l = _leer().map(function (g) {
      if (g.cancionId === cancionId) { g.cancionId = null; }
      return g;
    });
    _guardar(l);
  }

  return {
    listar: listar,
    crear: crear,
    borrar: borrar,
    url: url,
    desvincular: desvincular,
  };
})();
