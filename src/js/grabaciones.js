/* ============================================================
   grabaciones.js — Grabadora personal (Fase 7).

   window.Grabaciones gestiona las grabaciones en las que Maite
   se graba cantando. Los METADATOS van en Almacen ('grabaciones');
   el audio (blob) va en window.Archivos con clave "grab:<id>".

   Modelo:
     { id, cancionId | null, titulo, creado, mime, dur,
       audioOffset | null, sesionId | null }

   Las grabaciones se crean tanto desde este apartado como desde el
   modo estudio de cada canción; todas viven aquí y se ven juntas.
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

  // Todas las de una canción, más recientes primero.
  function listarDeCancion(cancionId) {
    return listar().filter(function (g) { return g.cancionId === cancionId; });
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
      picos: Array.isArray(meta.picos) ? meta.picos : [],
      // Si la grabación se hizo con la canción sonando de fondo, el segundo
      // de la pista original en que empezó la toma (para reproducirlas juntas).
      audioOffset: (typeof meta.audioOffset === 'number' && isFinite(meta.audioOffset))
        ? Math.max(0, meta.audioOffset) : null,
      // Sesión del coro cuyo audio sonaba durante la toma. Con esto y
      // `audioOffset` se vuelve a montar la comparación voz + pista original
      // en el apartado Grabaciones (el audio vive en Archivos "<sesionId>:audio").
      sesionId: meta.sesionId || null,
      // Retardo del micro (s) y salida de audio (altavoz / bluetooth) que
      // había al hacer la toma. Metadato informativo: la comparación se
      // alinea con el retardo del dispositivo seleccionado en cada momento.
      syncLatencia: (typeof meta.syncLatencia === 'number' && isFinite(meta.syncLatencia))
        ? meta.syncLatencia : null,
      syncPerfil: meta.syncPerfil || null,
    };
    return window.Archivos.guardar('grab:' + g.id, blob).then(function () {
      var l = _leer();
      l.push(g);
      _guardar(l);
      if (window.Diario) {
        window.Diario.registrar('grabacion', {
          cancionId: (meta.cancionId && String(meta.cancionId).indexOf(':') === -1) ? meta.cancionId : null,
          sesionId: meta.sesionId || null,
          titulo: g.titulo,
          extra: { dur: g.dur },
        });
      }
      return g;
    });
  }

  function borrar(id) {
    _guardar(_leer().filter(function (g) { return g.id !== id; }));
    return window.Archivos.borrar('grab:' + id);
  }

  function url(id) { return window.Archivos.url('grab:' + id); }

  // Blob crudo de la grabación (para compartir o descargar).
  function blob(id) { return window.Archivos.obtener('grab:' + id); }

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
    listarDeCancion: listarDeCancion,
    crear: crear,
    borrar: borrar,
    url: url,
    blob: blob,
    desvincular: desvincular,
  };
})();
