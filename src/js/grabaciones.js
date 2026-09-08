/* ============================================================
   grabaciones.js — Grabadora personal (Fase 7).

   window.Grabaciones gestiona las grabaciones en las que Maite
   se graba cantando. Los METADATOS van en Almacen ('grabaciones');
   el audio (blob) va en window.Archivos con clave "grab:<id>".

   Modelo:
     { id, cancionId | null, titulo, creado, mime, dur,
       audioOffset | null, sesionId | null, marcaId | null }

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

  // Las de una TOMA concreta (una versión: la grabación original o un
  // ensayo de un día). El modo estudio enseña solo estas, no todas las de
  // la canción. `claveLegado` = clave con la que el modo estudio agrupaba
  // antes (id de canción, o "sesion:<s>:<m>"), para no perder las viejas.
  // Momento de creación codificado en un id "x-<base36>-<rnd>" (lo generan
  // nuevoId / nuevoIdMarca con Date.now().toString(36)). null si no cuadra.
  function _tsDeId(id) {
    var m = /^[a-z]+-([0-9a-z]+)-/.exec(String(id || ''));
    if (!m) return null;
    var t = parseInt(m[1], 36);
    return isFinite(t) && t > 1e12 ? t : null;
  }

  function listarDeToma(sesionId, marcaId, claveLegado) {
    // Una grabación vieja con `sesionId` pero sin `marcaId` no sabe de qué
    // toma es. Se le atribuye a las marcas de esa sesión que YA EXISTÍAN
    // cuando se grabó (por el timestamp del id de la marca), nunca a una
    // canción que se añade a la sesión más tarde.
    var tsMarca = _tsDeId(marcaId);
    return listar().filter(function (g) {
      if (g.marcaId) return g.marcaId === marcaId;              // nuevas: exactas
      if (g.sesionId) {                                         // viejas sin toma
        if (g.sesionId !== sesionId) return false;
        return tsMarca == null || !g.creado || tsMarca <= g.creado;
      }
      return !!claveLegado && g.cancionId === claveLegado;      // viejas a capela
    });
  }

  /* ---------- Clasificación por la versión sobre la que se grabó ----------
     Separa las tomas que Maite hizo sobre un ENSAYO del coro de las que
     hizo sobre la grabación ORIGINAL (limpia) de la canción, más las de
     "solo mi voz". Ver [[ensayos-vs-canciones]] y [[cancion-suelta]]. */

  var CATEGORIAS = [
    { id: 'cancion-ensayo', etiqueta: 'Ensayos' },
    { id: 'limpia',         etiqueta: 'Canciones limpias' },
    { id: 'acapela',        etiqueta: 'Solo mi voz' },
  ];

  // Sesión + marca (toma) sobre la que se grabó, o null.
  //   1. `g.sesionId` (+ `g.marcaId`) — lo guardan las tomas del modo estudio
  //      y las de este apartado.
  //   2. `g.cancionId` con forma "sesion:<sesionId>:<marcaId>" — tomas viejas
  //      del modo estudio cuya marca aún no estaba vinculada a una canción.
  function _refSesion(g) {
    if (g.sesionId) return { sesionId: g.sesionId, marcaId: g.marcaId || null };
    var m = /^sesion:([^:]+):([^:]+)$/.exec(g.cancionId || '');
    return m ? { sesionId: m[1], marcaId: m[2] } : null;
  }

  function categoria(g) {
    var ref = _refSesion(g);
    var ses = ref && window.Sesiones ? window.Sesiones.obtener(ref.sesionId) : null;

    // Sin toma identificable y sin pista de fondo: solo su voz.
    if (!ses) return (typeof g.audioOffset === 'number') ? 'cancion-ensayo' : 'acapela';

    // La toma es de la grabación original (limpia) de la canción (sesión "suelta").
    if (ses.suelta) return 'limpia';

    // Cualquier otra toma es sobre un ensayo del coro.
    return 'cancion-ensayo';
  }

  // Cuántas grabaciones hay de cada categoría (para pintar solo los
  // filtros que tienen algo). `base` = lista ya filtrada por canción, etc.
  function conteoPorCategoria(base) {
    var lista = base || listar();
    var out = {};
    CATEGORIAS.forEach(function (c) { out[c.id] = 0; });
    lista.forEach(function (g) { out[categoria(g)]++; });
    return out;
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
      // Marca (toma / versión) sobre la que se grabó, si viene del modo
      // estudio: así cada versión enseña solo sus grabaciones.
      marcaId: meta.marcaId || null,
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
    listarDeToma: listarDeToma,
    CATEGORIAS: CATEGORIAS,
    categoria: categoria,
    conteoPorCategoria: conteoPorCategoria,
    crear: crear,
    borrar: borrar,
    url: url,
    blob: blob,
    desvincular: desvincular,
  };
})();
