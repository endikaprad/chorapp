/* ============================================================
   sesiones.js — Modelo y persistencia de las SESIONES del coro.

   El coro no manda canciones sueltas: manda la grabación entera
   del ensayo (1–2 h). Maite la escucha y va marcando dónde está
   cada canción. De ahí nace este modelo:

     Sesión  = una grabación de ensayo (fecha + audio largo)
     Marca   = un punto de esa sesión donde suena una canción
     Canción = ficha del repertorio (letra, partitura, estado);
               vive en canciones.js y una marca la referencia

   window.Sesiones expone el CRUD sobre Almacen ('sesiones').
   El audio (blob) va en window.Archivos con clave "<sesionId>:audio".

   Modelo de sesión:
     {
       id:      string,
       fecha:   'YYYY-MM-DD',          // día del ensayo
       lugar:   string,                // opcional
       notas:   string,                // opcional
       archivo: null | { nombre, mime, tamano, guardado },  // audio; blob en Archivos
       marcas: [
         {
           id:         string,
           cancionId:  string | null,  // ficha del repertorio, o null si aún sin vincular
           titulo:     string,         // nombre visible (copia del de la canción, o suelto)
           segundo:    number,         // dónde empieza en el audio de la sesión
           finSegundo: number | null,  // dónde acaba (opcional)
           nota:       string,         // apunte de Maite sobre esta toma
           fragmentos: [ { id, segundo, texto, creado, nota } ]  // trozos difíciles de ESTA toma
                                          // nota: { octava, semi } | null — tono de entrada del trozo
         }
       ],
       creada:      number,
       actualizada: number
     }
   ============================================================ */

window.Sesiones = (function () {
  'use strict';

  var CLAVE = 'sesiones';
  var CLAVE_MIGRADO = 'sesiones:migradoDeCanciones';

  function nuevoId() {
    return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }
  function nuevoIdMarca() {
    return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function hoyISO(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function _leer() {
    var l = window.Almacen.leer(CLAVE, []);
    return Array.isArray(l) ? l : [];
  }
  function _guardarTodo(l) { window.Almacen.guardar(CLAVE, l); }

  // Nota de entrada de un fragmento: { octava:3-6, semi:0-11 } o null.
  function _saneaNota(n) {
    if (!n || typeof n !== 'object') return null;
    var semi = Math.round(Number(n.semi));
    var oct = Math.round(Number(n.octava));
    if (!isFinite(semi) || semi < 0 || semi > 11) return null;
    if (!isFinite(oct) || oct < 3 || oct > 6) return null;
    return { octava: oct, semi: semi };
  }

  // Normaliza una sesión que venga de disco (rellena campos que falten).
  function _sanear(s) {
    if (!s || typeof s !== 'object') return null;
    if (!s.archivo && s.archivos && s.archivos.audio) s.archivo = s.archivos.audio;
    s.lugar = s.lugar || '';
    s.notas = s.notas || '';
    s.archivo = s.archivo || null;
    if (!Array.isArray(s.marcas)) s.marcas = [];
    s.marcas.forEach(function (m) {
      m.cancionId = m.cancionId || null;
      m.titulo = m.titulo || 'Canción';
      m.segundo = typeof m.segundo === 'number' && isFinite(m.segundo) ? Math.max(0, m.segundo) : 0;
      m.finSegundo = (typeof m.finSegundo === 'number' && isFinite(m.finSegundo)) ? m.finSegundo : null;
      m.nota = m.nota || '';
      if (!Array.isArray(m.fragmentos)) m.fragmentos = [];
      m.fragmentos.forEach(function (f) {
        f.nota = _saneaNota(f.nota);
        f.color = (f.color && ['cobalto', 'verde', 'ambar', 'rojo', 'morado', 'gris'].indexOf(f.color) >= 0) ? f.color : null;
      });
    });
    return s;
  }

  // Todas las sesiones, más recientes primero (por fecha y, a igualdad, por creación).
  function listar() {
    return _leer().map(_sanear).filter(Boolean).sort(function (a, b) {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
      return (b.creada || 0) - (a.creada || 0);
    });
  }

  function obtener(id) {
    return _sanear(_leer().filter(function (s) { return s.id === id; })[0]) || null;
  }

  // Aplica `fn(sesion)` a la sesión `id`, marca `actualizada` y persiste.
  // Devuelve la versión resultante (o null).
  function _mutar(id, fn) {
    var lista = _leer();
    var res = null;
    lista = lista.map(function (s) {
      if (s.id !== id) return s;
      var copia = _sanear(JSON.parse(JSON.stringify(s)));
      fn(copia);
      copia.actualizada = Date.now();
      res = copia;
      return copia;
    });
    _guardarTodo(lista);
    return res;
  }

  /* ---------- Sesiones ---------- */

  // datos: { fecha?, lugar?, notas? }
  function crear(datos) {
    datos = datos || {};
    var ahora = Date.now();
    var sesion = {
      id: nuevoId(),
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) ? datos.fecha : hoyISO(),
      lugar: (datos.lugar || '').trim(),
      notas: (datos.notas || '').trim(),
      archivo: null,
      marcas: [],
      creada: ahora,
      actualizada: ahora,
    };
    var lista = _leer();
    lista.push(sesion);
    _guardarTodo(lista);
    return sesion;
  }

  function actualizar(id, cambios) {
    return _mutar(id, function (s) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(cambios.fecha)) s.fecha = cambios.fecha;
      if (cambios.lugar != null) s.lugar = String(cambios.lugar).trim();
      if (cambios.notas != null) s.notas = String(cambios.notas).trim();
    });
  }

  // meta = objeto de Archivos.guardar() para el audio, o null para quitarlo.
  function fijarAudio(id, meta) {
    return _mutar(id, function (s) { s.archivo = meta || null; });
  }

  function borrar(id) {
    _guardarTodo(_leer().filter(function (s) { return s.id !== id; }));
    if (window.Archivos) window.Archivos.borrarPrefijo(id + ':');
    // Las grabaciones ligadas a marcas de esta sesión quedan "sin canción".
    if (window.Grabaciones && window.Grabaciones.desvincular) {
      window.Grabaciones.desvincular('sesion:' + id);
    }
  }

  /* ---------- Marcas ---------- */

  // datos: { cancionId?, titulo, segundo, finSegundo?, nota? }
  function agregarMarca(sesionId, datos) {
    datos = datos || {};
    var ini = Math.max(0, Math.round(datos.segundo || 0));
    var fin = (typeof datos.finSegundo === 'number' && isFinite(datos.finSegundo) && datos.finSegundo > ini)
      ? Math.round(datos.finSegundo) : null;
    var marca = {
      id: nuevoIdMarca(),
      cancionId: datos.cancionId || null,
      titulo: (datos.titulo || 'Canción').trim(),
      segundo: ini,
      finSegundo: fin,
      nota: (datos.nota || '').trim(),
      fragmentos: [],
    };
    _mutar(sesionId, function (s) {
      s.marcas.push(marca);
      s.marcas.sort(function (a, b) { return a.segundo - b.segundo; });
    });
    return marca;
  }

  function actualizarMarca(sesionId, marcaId, cambios) {
    return _mutar(sesionId, function (s) {
      s.marcas.forEach(function (m) {
        if (m.id !== marcaId) return;
        if (cambios.titulo != null) m.titulo = String(cambios.titulo).trim() || m.titulo;
        if ('cancionId' in cambios) m.cancionId = cambios.cancionId || null;
        if (cambios.nota != null) m.nota = String(cambios.nota).trim();
        if (typeof cambios.segundo === 'number' && isFinite(cambios.segundo)) {
          m.segundo = Math.max(0, Math.round(cambios.segundo));
        }
        if ('finSegundo' in cambios) {
          m.finSegundo = (typeof cambios.finSegundo === 'number' && isFinite(cambios.finSegundo))
            ? Math.max(0, Math.round(cambios.finSegundo)) : null;
        }
      });
      s.marcas.sort(function (a, b) { return a.segundo - b.segundo; });
    });
  }

  function borrarMarca(sesionId, marcaId) {
    return _mutar(sesionId, function (s) {
      s.marcas = s.marcas.filter(function (m) { return m.id !== marcaId; });
    });
  }

  function obtenerMarca(sesionId, marcaId) {
    var s = obtener(sesionId);
    if (!s) return null;
    return s.marcas.filter(function (m) { return m.id === marcaId; })[0] || null;
  }

  /* ---------- Fragmentos difíciles (dentro de una marca) ---------- */

  function agregarFragmento(sesionId, marcaId, segundo, texto) {
    var frag = {
      id: 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      segundo: Math.max(0, Math.round(segundo || 0)),
      texto: String(texto || '').trim(),
      nota: null,
      color: null,   // id de color del marcador; null = cobalto por defecto
      creado: Date.now(),
    };
    _mutar(sesionId, function (s) {
      s.marcas.forEach(function (m) {
        if (m.id === marcaId) m.fragmentos.push(frag);
      });
    });
    return frag;
  }

  // Fija (o quita, con null) la nota de entrada de un fragmento.
  function fijarNotaFragmento(sesionId, marcaId, fragId, nota) {
    var limpia = _saneaNota(nota);
    return _mutar(sesionId, function (s) {
      s.marcas.forEach(function (m) {
        if (m.id !== marcaId) return;
        m.fragmentos.forEach(function (f) {
          if (f.id === fragId) f.nota = limpia;
        });
      });
    });
  }

  // Colores disponibles para el marcador de un fragmento.
  var COLORES_FRAGMENTO = ['cobalto', 'verde', 'ambar', 'rojo', 'morado', 'gris'];

  // Fija (o quita, con null) el color del marcador de un fragmento.
  function fijarColorFragmento(sesionId, marcaId, fragId, color) {
    var limpio = COLORES_FRAGMENTO.indexOf(color) >= 0 ? color : null;
    return _mutar(sesionId, function (s) {
      s.marcas.forEach(function (m) {
        if (m.id !== marcaId) return;
        m.fragmentos.forEach(function (f) {
          if (f.id === fragId) f.color = limpio;
        });
      });
    });
  }

  function borrarFragmento(sesionId, marcaId, fragId) {
    return _mutar(sesionId, function (s) {
      s.marcas.forEach(function (m) {
        if (m.id === marcaId) {
          m.fragmentos = m.fragmentos.filter(function (f) { return f.id !== fragId; });
        }
      });
    });
  }

  /* ---------- Consultas por canción del repertorio ---------- */

  // [{ sesion, marca }] de todas las veces que se marcó `cancionId`,
  // más recientes primero.
  function marcasDeCancion(cancionId) {
    var res = [];
    listar().forEach(function (s) {
      s.marcas.forEach(function (m) {
        if (m.cancionId === cancionId) res.push({ sesion: s, marca: m });
      });
    });
    return res;
  }

  function ultimaMarcaDeCancion(cancionId) {
    return marcasDeCancion(cancionId)[0] || null;
  }

  // Todas las marcas con algún fragmento difícil, agrupadas por canción.
  // [{ cancionId, titulo, trozos, ref: {sesion, marca} }]
  function repasoPendiente() {
    var porCancion = {};
    listar().forEach(function (s) {
      s.marcas.forEach(function (m) {
        if (!m.fragmentos.length) return;
        var clave = m.cancionId || ('marca:' + m.id);
        if (!porCancion[clave]) {
          porCancion[clave] = {
            cancionId: m.cancionId, titulo: m.titulo, trozos: 0, ref: { sesion: s, marca: m },
          };
        }
        porCancion[clave].trozos += m.fragmentos.length;
      });
    });
    return Object.keys(porCancion).map(function (k) { return porCancion[k]; });
  }

  /* ---------- Migración desde el modelo antiguo (canciones con audio) ----------
     Cada canción que tenga audio se convierte en una sesión "importada"
     con una única marca en 0:00 que la referencia. Sus fragmentos
     difíciles pasan a esa marca. La letra, partitura, estado y notas se
     quedan en la ficha de la canción. Se ejecuta una sola vez. */
  function migrarDesdeCanciones() {
    if (!window.Canciones || !window.Almacen) return Promise.resolve();
    if (window.Almacen.leer(CLAVE_MIGRADO, false)) return Promise.resolve();

    var canciones = window.Canciones.listar();
    var tareas = canciones.map(function (c) {
      var tieneAudio = c.archivos && c.archivos.audio;
      if (!tieneAudio) return Promise.resolve();

      var sesion = crear({
        fecha: hoyISO(new Date(c.creada || Date.now())),
        lugar: '',
        notas: 'Sesión importada al reorganizar la app.',
      });

      var marca = agregarMarca(sesion.id, {
        cancionId: c.id,
        titulo: c.titulo,
        segundo: 0,
      });

      // Copiar fragmentos difíciles antiguos a la marca.
      (c.fragmentos || []).forEach(function (f) {
        if (typeof f.segundo === 'number' && isFinite(f.segundo)) {
          agregarFragmento(sesion.id, marca.id, f.segundo, f.texto || '');
        }
      });

      // Mover el blob del audio: "<cancionId>:audio" -> "<sesionId>:audio".
      return window.Archivos.mover(c.id + ':audio', sesion.id + ':audio').then(function () {
        fijarAudio(sesion.id, c.archivos.audio);
        // Limpiar la ficha de la canción: ya no lleva audio ni fragmentos.
        if (window.Canciones.fijarArchivo) window.Canciones.fijarArchivo(c.id, 'audio', null);
        if (window.Canciones.vaciarFragmentos) window.Canciones.vaciarFragmentos(c.id);
      });
    });

    return Promise.all(tareas).then(function () {
      window.Almacen.guardar(CLAVE_MIGRADO, true);
    }).catch(function (e) {
      console.error('Sesiones: migración incompleta', e);
    });
  }

  return {
    hoyISO: hoyISO,
    listar: listar,
    obtener: obtener,
    crear: crear,
    actualizar: actualizar,
    fijarAudio: fijarAudio,
    borrar: borrar,
    agregarMarca: agregarMarca,
    actualizarMarca: actualizarMarca,
    borrarMarca: borrarMarca,
    obtenerMarca: obtenerMarca,
    agregarFragmento: agregarFragmento,
    fijarNotaFragmento: fijarNotaFragmento,
    fijarColorFragmento: fijarColorFragmento,
    COLORES_FRAGMENTO: COLORES_FRAGMENTO,
    borrarFragmento: borrarFragmento,
    marcasDeCancion: marcasDeCancion,
    ultimaMarcaDeCancion: ultimaMarcaDeCancion,
    repasoPendiente: repasoPendiente,
    migrarDesdeCanciones: migrarDesdeCanciones,
  };
})();
