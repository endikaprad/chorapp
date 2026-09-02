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
       fragmentos: [ { id, texto, nota } ],   // fragmentos difíciles (Fase 5)
       archivos:   { audio: null, letra: null, partitura: null }, // (Fase 4)
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
      fragmentos: [],
      archivos: { audio: null, letra: null, partitura: null },
      creada: ahora,
      actualizada: ahora,
    };
    var lista = window.Almacen.leer(CLAVE, []);
    if (!Array.isArray(lista)) lista = [];
    lista.push(cancion);
    _guardarTodo(lista);
    return cancion;
  }

  function actualizar(id, cambios) {
    var lista = window.Almacen.leer(CLAVE, []);
    if (!Array.isArray(lista)) lista = [];
    var actualizada = null;
    lista = lista.map(function (c) {
      if (c.id !== id) return c;
      actualizada = Object.assign({}, c, {
        titulo: cambios.titulo != null ? String(cambios.titulo).trim() : c.titulo,
        compositor: cambios.compositor != null ? String(cambios.compositor).trim() : c.compositor,
        estado: ESTADOS[cambios.estado] ? cambios.estado : c.estado,
        notas: cambios.notas != null ? String(cambios.notas).trim() : c.notas,
        actualizada: Date.now(),
      });
      return actualizada;
    });
    _guardarTodo(lista);
    return actualizada;
  }

  function borrar(id) {
    var lista = window.Almacen.leer(CLAVE, []);
    if (!Array.isArray(lista)) lista = [];
    _guardarTodo(lista.filter(function (c) { return c.id !== id; }));
  }

  return {
    ESTADOS: ESTADOS,
    listar: listar,
    buscar: buscar,
    obtener: obtener,
    crear: crear,
    actualizar: actualizar,
    borrar: borrar,
  };
})();
