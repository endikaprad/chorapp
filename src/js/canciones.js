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
       idioma:     string,                    // código de IDIOMAS ('' = sin especificar)
       etiquetas:  [string],                  // etiquetas libres para agrupar ("Navidad", "Misa"…)
       letraTexto: string,                    // letra escrita a mano (Fase 5)
       letraFonetica: string,                 // cómo suena la letra (transcripción para cantar)
       letraTraduccion: string,               // qué significa la letra (en español)
       fragmentos: [ { id, texto, creado, segundo? } ],  // fragmentos difíciles (Fase 5); segundo = momento del audio
       archivos:   {                           // metadatos; el blob va en Archivos (Fase 4)
                     audio:     null | { nombre, mime, tamano, guardado },
                     letra:     null | { … },
                     fonetica:  null | { … },   // "cómo se pronuncia" como PDF/imagen
                     partitura: null | { … }
                   },
       notasVoz:   [ { id, creado } ],         // OBSOLETO: solo para migrar notas antiguas a window.Grabaciones
       anotacionesPartitura: {                 // dibujos a mano sobre una página de partitura (Fase 5+)
                     '<clave-adjunto>': [ { id, tipo:'circulo'|'flecha', x, y, x2?, y2?, color, creado } ]
                   },                          // x/y/x2/y2 son fracciones 0..1 del tamaño de la imagen
       creada:     number (timestamp),
       actualizada:number (timestamp)
     }
   ============================================================ */

window.Canciones = (function () {
  'use strict';

  var CLAVE = 'canciones';

  // Idiomas del repertorio coral. Clave = código corto; valor = nombre en
  // español para mostrar. '' significa "sin especificar" y no aparece aquí.
  var IDIOMAS = {
    es:  'Español',
    eu:  'Euskera',
    la:  'Latín',
    de:  'Alemán',
    en:  'Inglés',
    fr:  'Francés',
    it:  'Italiano',
    pt:  'Portugués',
    ca:  'Catalán',
    otro: 'Otro',
  };
  function nombreIdioma(cod) { return IDIOMAS[cod] || ''; }

  var ESTADOS = {
    pendiente: { etiqueta: 'Pendiente',   token: 'pendiente' },
    progreso:  { etiqueta: 'En progreso', token: 'progreso' },
    aprendida: { etiqueta: 'Aprendida',   token: 'aprendida' },
  };

  function nuevoId() {
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // Etiquetas libres para agrupar ("Navidad", "Misa"…). Se guardan tal cual
  // se escriben pero se deduplican sin distinguir mayúsculas/acentos.
  var MAX_ETIQUETAS = 12;
  function _saneaEtiquetas(arr) {
    if (typeof arr === 'string') arr = arr.split(',');
    if (!Array.isArray(arr)) return [];
    var vistas = {}, salida = [];
    arr.forEach(function (e) {
      var t = String(e == null ? '' : e).trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!t) return;
      var k = normalizar(t);
      if (vistas[k]) return;
      vistas[k] = true;
      salida.push(t);
    });
    return salida.slice(0, MAX_ETIQUETAS);
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
             normalizar(c.compositor).indexOf(q) !== -1 ||
             normalizar(nombreIdioma(c.idioma)).indexOf(q) !== -1 ||
             (Array.isArray(c.etiquetas) && c.etiquetas.some(function (e) {
               return normalizar(e).indexOf(q) !== -1;
             }));
    });
  }

  // Todas las etiquetas usadas en el repertorio, ordenadas alfabéticamente.
  function etiquetasTodas() {
    var vistas = {}, salida = [];
    listar().forEach(function (c) {
      (c.etiquetas || []).forEach(function (e) {
        var k = normalizar(e);
        if (!vistas[k]) { vistas[k] = true; salida.push(e); }
      });
    });
    return salida.sort(function (a, b) { return normalizar(a).localeCompare(normalizar(b)); });
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
      idioma: IDIOMAS[datos.idioma] ? datos.idioma : '',
      etiquetas: _saneaEtiquetas(datos.etiquetas),
      letraTexto: (datos.letraTexto || '').trim(),
      letraFonetica: (datos.letraFonetica || '').trim(),
      letraTraduccion: (datos.letraTraduccion || '').trim(),
      fragmentos: [],
      archivos: { audio: null, letra: null, fonetica: null, partitura: null },
      notasVoz: [],
      anotacionesPartitura: {},
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
      if (!copia.archivos) copia.archivos = {};
      ['audio', 'letra', 'fonetica', 'partitura'].forEach(function (k) {
        if (!(k in copia.archivos)) copia.archivos[k] = null;
      });
      if (!Array.isArray(copia.fragmentos)) copia.fragmentos = [];
      if (!Array.isArray(copia.notasVoz)) copia.notasVoz = [];
      if (!Array.isArray(copia.etiquetas)) copia.etiquetas = [];
      if (!copia.anotacionesPartitura || typeof copia.anotacionesPartitura !== 'object') copia.anotacionesPartitura = {};
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
      if (cambios.idioma != null) c.idioma = IDIOMAS[cambios.idioma] ? cambios.idioma : '';
      if (cambios.etiquetas != null) c.etiquetas = _saneaEtiquetas(cambios.etiquetas);
      if (cambios.letraTexto != null) c.letraTexto = String(cambios.letraTexto);
      if (cambios.letraFonetica != null) c.letraFonetica = String(cambios.letraFonetica);
      if (cambios.letraTraduccion != null) c.letraTraduccion = String(cambios.letraTraduccion);
    });
    if (res && ESTADOS[cambios.estado]) _anotarEstado(res, previo, res.estado);
    // El título de la marca de cada sesión es una copia: propágalo.
    if (res && cambios.titulo != null && window.Sesiones && window.Sesiones.renombrarMarcasDeCancion) {
      window.Sesiones.renombrarMarcasDeCancion(res.id, res.titulo);
    }
    return res;
  }

  // --- Archivos (metadatos). tipo: 'audio' | 'letra' | 'fonetica' | 'partitura'.
  //     meta = objeto de Archivos.guardar(), un ARRAY de ellos (varias
  //     páginas: ver adjuntos.js), o null para quitarlo.
  function fijarArchivo(id, tipo, meta) {
    return _mutar(id, function (c) {
      if (Array.isArray(meta)) c.archivos[tipo] = meta.length ? meta : null;
      else c.archivos[tipo] = meta || null;
    });
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

  // --- Anotaciones dibujadas a mano sobre una página de partitura.
  //     clave = la del adjunto (window.Adjuntos), para que cada página
  //     tenga las suyas. x/y/x2/y2 son fracciones 0..1 del tamaño de la
  //     imagen, así valen igual en la miniatura y en el visor a pantalla
  //     completa, con cualquier zoom.
  function nuevoIdAnotacion() {
    return 'an-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function agregarAnotacionPartitura(id, clave, datos) {
    var a = {
      id: nuevoIdAnotacion(),
      tipo: datos.tipo === 'flecha' ? 'flecha' : 'circulo',
      x: Math.max(0, Math.min(1, Number(datos.x) || 0)),
      y: Math.max(0, Math.min(1, Number(datos.y) || 0)),
      color: datos.color || 'cobalto',
      creado: Date.now(),
    };
    if (a.tipo === 'flecha') {
      a.x2 = Math.max(0, Math.min(1, Number(datos.x2) || 0));
      a.y2 = Math.max(0, Math.min(1, Number(datos.y2) || 0));
    }
    _mutar(id, function (c) {
      if (!Array.isArray(c.anotacionesPartitura[clave])) c.anotacionesPartitura[clave] = [];
      c.anotacionesPartitura[clave].push(a);
    }, false);   // cambio de fondo: no reordena la biblioteca
    return a;
  }
  function borrarAnotacionPartitura(id, clave, anotId) {
    return _mutar(id, function (c) {
      if (Array.isArray(c.anotacionesPartitura[clave])) {
        c.anotacionesPartitura[clave] = c.anotacionesPartitura[clave].filter(function (a) { return a.id !== anotId; });
      }
    }, false);
  }
  function anotacionesPartitura(cancion, clave) {
    var arr = cancion && cancion.anotacionesPartitura && cancion.anotacionesPartitura[clave];
    return Array.isArray(arr) ? arr : [];
  }

  // --- Plantilla de sincronía: "así va esta canción".
  //
  // Cuando Maite ajusta a mano los tiempos de un verso en el visor de la
  // letra (LetraLive), esos tiempos son los BUENOS — vienen de que ella los
  // ha fijado con la canción sonando. Se guardan por marca (cada grabación
  // tiene la suya), pero el PATRÓN — en qué fracción de la canción entra cada
  // verso — es prácticamente el mismo de un ensayo a otro (el coro no cambia
  // el orden de la letra). Guardar esa fracción en la CANCIÓN sirve de guía
  // para sincronizar automáticamente futuras grabaciones de la misma pieza:
  // no es "entrenar a la IA" (Whisper/Gemini son modelos ajenos, no se les
  // puede reeducar), pero la app sí aprende cómo va SU repertorio.
  //
  // plantilla = { fracciones: [0..1, …] (1 por verso, relativo a la duración
  //              de la canción de origen), versos, fecha }
  function fijarPlantillaSincro(id, tiempos, dur) {
    if (!Array.isArray(tiempos) || !tiempos.length || !(dur > 0)) return null;
    var fracciones = tiempos.map(function (t) {
      return Math.max(0, Math.min(1, (Number(t) || 0) / dur));
    });
    return _mutar(id, function (c) {
      c.plantillaSincro = { fracciones: fracciones, versos: fracciones.length, fecha: Date.now() };
    }, false);   // cambio de fondo: no toca "actualizada" ni el orden de la biblioteca
  }
  function plantillaSincro(id) {
    var c = obtener(id);
    var p = c && c.plantillaSincro;
    return (p && Array.isArray(p.fracciones) && p.fracciones.length) ? p : null;
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
    // Las marcas de esta canción en los ensayos se van con ella (con sus
    // notas y trozos difíciles). La sesión oculta de una "canción suelta"
    // la borra quien llama, antes de esto (ver songs.js › onBorrar).
    if (window.Sesiones && window.Sesiones.borrarMarcasDeCancion) {
      window.Sesiones.borrarMarcasDeCancion(id);
    }
    // Y de los programas de concierto donde estuviera.
    if (window.Conciertos && window.Conciertos.limpiarCancion) {
      window.Conciertos.limpiarCancion(id);
    }
  }

  return {
    ESTADOS: ESTADOS,
    IDIOMAS: IDIOMAS,
    nombreIdioma: nombreIdioma,
    listar: listar,
    buscar: buscar,
    etiquetasTodas: etiquetasTodas,
    obtener: obtener,
    crear: crear,
    actualizar: actualizar,
    fijarEstado: fijarEstado,
    fijarArchivo: fijarArchivo,
    agregarFragmento: agregarFragmento,
    borrarFragmento: borrarFragmento,
    vaciarFragmentos: vaciarFragmentos,
    fijarPlantillaSincro: fijarPlantillaSincro,
    plantillaSincro: plantillaSincro,
    agregarAnotacionPartitura: agregarAnotacionPartitura,
    borrarAnotacionPartitura: borrarAnotacionPartitura,
    anotacionesPartitura: anotacionesPartitura,
    borrarNotaVoz: borrarNotaVoz,
    borrar: borrar,
  };
})();
