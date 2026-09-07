/* ============================================================
   canciones.js — Modelo y persistencia de la biblioteca.
   window.Canciones expone el CRUD sobre Almacen (localStorage;
   en Capacitor se cambiará el cuerpo por @capacitor/preferences).

   Modelo de canción:
     {
       id:         string,
       titulo:     string,
       compositor: string,
       estado:     'pendiente' | 'progreso' | 'aprendida',
       notas:      string,
       letraTexto: string,                    // letra escrita a mano (Fase 5)
       fragmentos: [ { id, texto, creado, segundo? } ],  // fragmentos difíciles (Fase 5); segundo = momento del audio
       archivos:   {                           // metadatos; el blob va en Archivos (Fase 4)
                     audio:     null | { nombre, mime, tamano, guardado },
                     letra:     null | { … },
                     partitura: null | { … }
                   },
       notasVoz:   [ { id, creado } ],         // OBSOLETO: solo para migrar notas antiguas a window.Grabaciones
       creada:     number (timestamp),
       actualizada:number (timestamp)
     }
   ============================================================ */

window.Canciones = (function () {
  'use strict';

  var CLAVE = 'canciones';

  var ESTADOS = {
    pendiente: { etiqueta: 'Pendiente',   token: 'pendiente' },
    progreso:  { etiqueta: 'En progreso', token: 'progreso' },
    aprendida: { etiqueta: 'Aprendida',   token: 'aprendida' },
  };

  function nuevoId() {
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // Minúsculas + sin acentos, para comparar en búsquedas.
  function normalizar(txt) {
    var s = (txt == null ? '' : String(txt)).toLowerCase().trim();
    if (s.normalize) {
      s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    return s;
  }

  // Devuelve el array completo, ordenado por título.
  function listar() {
    var lista = window.Almacen.leer(CLAVE, []);
    if (!Array.isArray(lista)) lista = [];
    return lista.slice().sort(function (a, b) {
      return normalizar(a.titulo).localeCompare(normalizar(b.titulo));
    });
  }

  function buscar(texto) {
    var q = normalizar(texto);
    if (!q) return listar();
    return listar().filter(function (c) {
      return normalizar(c.titulo).indexOf(q) !== -1 ||
             normalizar(c.compositor).indexOf(q) !== -1;
    });
  }

  function obtener(id) {
    return listar().filter(function (c) { return c.id === id; })[0] || null;
  }

  function _guardarTodo(lista) {
    window.Almacen.guardar(CLAVE, lista);
  }

  // datos: { titulo, compositor, estado, notas }
  function crear(datos) {
    var ahora = Date.now();
    var cancion = {
      id: nuevoId(),
      titulo: (datos.titulo || '').trim(),
      compositor: (datos.compositor || '').trim(),
      estado: ESTADOS[datos.estado] ? datos.estado : 'pendiente',
      notas: (datos.notas || '').trim(),
      letraTexto: (datos.letraTexto || '').trim(),
      fragmentos: [],
      archivos: { audio: null, letra: null, partitura: null },
      notasVoz: [],
      creada: ahora,
      actualizada: ahora,
    };
    var lista = window.Almacen.leer(CLAVE, []);
    if (!Array.isArray(lista)) lista = [];
    lista.push(cancion);
    _guardarTodo(lista);
    return cancion;
  }

  // Aplica `fn(cancion)` a la canción `id` y persiste. Devuelve la
  // versión resultante (o null si no existe). No toca `actualizada`
  // salvo que `fn` lo haga: útil para cambios "de fondo".
  function _mutar(id, fn, marcarActualizada) {
    var lista = window.Almacen.leer(CLAVE, []);
    if (!Array.isArray(lista)) lista = [];
    var res = null;
    lista = lista.map(function (c) {
      if (c.id !== id) return c;
      var copia = JSON.parse(JSON.stringify(c));
      if (!copia.archivos) copia.archivos = { audio: null, letra: null, partitura: null };
      if (!Array.isArray(copia.fragmentos)) copia.fragmentos = [];
      if (!Array.isArray(copia.notasVoz)) copia.notasVoz = [];
      fn(copia);
      if (marcarActualizada !== false) copia.actualizada = Date.now();
      res = copia;
      return copia;
    });
    _guardarTodo(lista);
    return res;
  }

  // Apunta en la bitácora un cambio de estado (silencioso).
  function _anotarEstado(cancion, de, a) {
    if (!cancion || de === a || !window.Diario) return;
    window.Diario.registrar('estado', {
      cancionId: cancion.id,
      titulo: cancion.titulo,
      extra: { de: de, a: a },
    });
  }

  // Cambia solo el estado. Útil para el selector rápido de la lista.
  function fijarEstado(id, estado) {
    if (!ESTADOS[estado]) return null;
    var previo = (obtener(id) || {}).estado;
    var res = _mutar(id, function (c) { c.estado = estado; });
    _anotarEstado(res, previo, estado);
    return res;
  }

  function actualizar(id, cambios) {
    var previo = (obtener(id) || {}).estado;
    var res = _mutar(id, function (c) {
      if (cambios.titulo != null) c.titulo = String(cambios.titulo).trim();
      if (cambios.compositor != null) c.compositor = String(cambios.compositor).trim();
      if (ESTADOS[cambios.estado]) c.estado = cambios.estado;
      if (cambios.notas != null) c.notas = String(cambios.notas).trim();
      if (cambios.letraTexto != null) c.letraTexto = String(cambios.letraTexto);
    });
    if (res && ESTADOS[cambios.estado]) _anotarEstado(res, previo, res.estado);
    return res;
  }

  // --- Archivos (metadatos). tipo: 'audio' | 'letra' | 'partitura'.
  //     meta = objeto de Archivos.guardar(), o null para quitarlo.
  function fijarArchivo(id, tipo, meta) {
    return _mutar(id, function (c) { c.archivos[tipo] = meta || null; });
  }

  // --- Fragmentos difíciles
  function agregarFragmento(id, texto, segundo) {
    var frag = { id: 'f-' + Date.now().toString(36), texto: String(texto || '').trim(), creado: Date.now() };
    if (typeof segundo === 'number' && isFinite(segundo) && segundo >= 0) {
      frag.segundo = Math.round(segundo);   // momento del audio donde aparece el fragmento
    }
    _mutar(id, function (c) { c.fragmentos.push(frag); });
    return frag;
  }
  function borrarFragmento(id, fragId) {
    return _mutar(id, function (c) {
      c.fragmentos = c.fragmentos.filter(function (f) { return f.id !== fragId; });
    });
  }
  // Los fragmentos difíciles viven ahora en las marcas de cada sesión
  // (ver sesiones.js). Esto solo se usa al migrar el modelo antiguo.
  function vaciarFragmentos(id) {
    return _mutar(id, function (c) { c.fragmentos = []; });
  }

  // --- Notas de voz: función retirada. Las grabaciones del modo estudio
  //     viven ahora en window.Grabaciones. Se conserva el borrado para
  //     migrar las notas antiguas (ver study.js › migrarNotasVozAntiguas).
  function borrarNotaVoz(id, notaId) {
    return _mutar(id, function (c) {
      c.notasVoz = c.notasVoz.filter(function (v) { return v.id !== notaId; });
    });
  }

  function borrar(id) {
    var lista = window.Almacen.leer(CLAVE, []);
    if (!Array.isArray(lista)) lista = [];
    _guardarTodo(lista.filter(function (c) { return c.id !== id; }));
    if (window.Archivos) window.Archivos.borrarCancion(id);
    if (window.Grabaciones) window.Grabaciones.desvincular(id);
  }

  return {
    ESTADOS: ESTADOS,
    listar: listar,
    buscar: buscar,
    obtener: obtener,
    crear: crear,
    actualizar: actualizar,
    fijarEstado: fijarEstado,
    fijarArchivo: fijarArchivo,
    agregarFragmento: agregarFragmento,
    borrarFragmento: borrarFragmento,
    vaciarFragmentos: vaciarFragmentos,
    borrarNotaVoz: borrarNotaVoz,
    borrar: borrar,
  };
})();
