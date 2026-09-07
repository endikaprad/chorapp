/* ============================================================
   sincronia.js — Latencia del micrófono para la grabadora.

   Cuando Maite se graba cantando CON la canción sonando, su voz
   llega al sistema con un pequeño retardo (el sonido tiene que
   salir por el altavoz/auriculares, entrar por el micro y
   codificarse). Al reproducir la toma junto a la pista original,
   ese retardo hace que la canción suene "por delante".

   Aquí se guarda cuántos segundos hay que atrasar la pista
   original para que encaje. Como el retardo NO es el mismo con el
   altavoz que con auriculares Bluetooth (el Bluetooth añade
   bastante), se guardan dos perfiles independientes y Maite elige
   cuál está usando. Cada uno se puede recalibrar cuando quiera.

   window.Sincronia
     .perfilActivo()            'altavoz' | 'bluetooth'
     .usarPerfil(id)            cambia el perfil activo
     .latencia()                segundos a atrasar (perfil activo)
     .latenciaDe(id)            ídem de un perfil concreto
     .perfil(id)                { latencia, calibrado, muestras }
     .guardarCalibracion(id, s) fija la latencia medida de un perfil
   ============================================================ */

window.Sincronia = (function () {
  'use strict';

  var CLAVE = 'sincronia';

  // Valor de partida razonable para el altavoz de un móvil de gama media
  // mientras no se haya calibrado. El Bihotsak arranca algo más alto
  // porque, si Maite elige "auriculares", casi seguro son Bluetooth.
  var POR_DEFECTO = { altavoz: 0.22, bluetooth: 0.20 };

  // Límites de seguridad: nunca aplicamos una latencia absurda aunque
  // la calibración salga rara.
  var MIN = 0, MAX = 0.9;

  function _base() {
    return {
      perfilActivo: 'altavoz',
      perfiles: {
        altavoz: { latencia: POR_DEFECTO.altavoz, calibrado: null, manual: false, muestras: [] },
        bluetooth: { latencia: POR_DEFECTO.bluetooth, calibrado: null, manual: false, muestras: [] },
      },
    };
  }

  function _leer() {
    var d = window.Almacen.leer(CLAVE, null);
    if (!d || !d.perfiles) return _base();
    var base = _base();
    // Fusión defensiva por si el formato guardado es de una versión previa.
    base.perfilActivo = (d.perfilActivo === 'bluetooth') ? 'bluetooth' : 'altavoz';
    ['altavoz', 'bluetooth'].forEach(function (id) {
      var p = d.perfiles[id];
      if (p && typeof p.latencia === 'number' && isFinite(p.latencia)) {
        base.perfiles[id].latencia = _acotar(p.latencia);
        base.perfiles[id].calibrado = p.calibrado || null;
        base.perfiles[id].manual = !!p.manual;
        base.perfiles[id].muestras = Array.isArray(p.muestras) ? p.muestras : [];
      }
    });
    return base;
  }

  function _guardar(d) { window.Almacen.guardar(CLAVE, d); }

  function _acotar(s) { return Math.max(MIN, Math.min(MAX, s)); }

  function perfilActivo() { return _leer().perfilActivo; }

  function usarPerfil(id) {
    if (id !== 'altavoz' && id !== 'bluetooth') return;
    var d = _leer();
    d.perfilActivo = id;
    _guardar(d);
  }

  function perfil(id) {
    var d = _leer();
    return d.perfiles[id === 'bluetooth' ? 'bluetooth' : 'altavoz'];
  }

  function latenciaDe(id) { return perfil(id).latencia; }

  function latencia() { return latenciaDe(perfilActivo()); }

  // s: latencia medida en segundos (media de las muestras válidas).
  // muestras: array opcional con cada medición individual, para mostrarlas.
  function guardarCalibracion(id, s, muestras) {
    if (id !== 'altavoz' && id !== 'bluetooth') return;
    if (typeof s !== 'number' || !isFinite(s)) return;
    var d = _leer();
    d.perfiles[id].latencia = _acotar(s);
    d.perfiles[id].calibrado = Date.now();
    d.perfiles[id].manual = false;
    d.perfiles[id].muestras = Array.isArray(muestras)
      ? muestras.map(function (m) { return Math.round(m * 1000) / 1000; })
      : [];
    _guardar(d);
  }

  // Fija la latencia de un perfil a partir de un ajuste hecho a oído
  // (Maite cuadró una grabación con los botones − / + y la guarda como base).
  function guardarBase(id, s) {
    if (id !== 'altavoz' && id !== 'bluetooth') return;
    if (typeof s !== 'number' || !isFinite(s)) return;
    var d = _leer();
    d.perfiles[id].latencia = _acotar(s);
    d.perfiles[id].calibrado = Date.now();
    d.perfiles[id].manual = true;
    d.perfiles[id].muestras = [];
    _guardar(d);
  }

  function nombrePerfil(id) {
    return id === 'bluetooth' ? 'Auriculares' : 'Altavoz';
  }

  /* ------------------------------------------------------------
     Selector "Escuchando con: Altavoz / Auriculares".

     Es el único control de sincronía visible en el día a día:
     dice con qué está escuchando Maite ahora mismo para que las
     grabaciones encajen con la canción al reproducirlas. Se pinta
     en Grabaciones y en el modo estudio de cada canción.

     montarSelector(contenedor, { onCambio })  -> { refrescar }
     ------------------------------------------------------------ */
  var ICO = {
    altavoz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    bluetooth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M3 16a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M16 16a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2z"/></svg>',
  };

  function montarSelector(cont, opts) {
    opts = opts || {};
    if (!cont) return { refrescar: function () {} };
    cont.classList.add('escucha');
    cont.innerHTML =
      '<span class="escucha__et">Escuchando con</span>' +
      '<div class="escucha__ops" role="group" aria-label="Con qué escuchas ahora">' +
        '<button type="button" class="escucha__op" data-perfil="altavoz">' +
          ICO.altavoz + '<span>Altavoz</span></button>' +
        '<button type="button" class="escucha__op" data-perfil="bluetooth">' +
          ICO.bluetooth + '<span>Auriculares</span></button>' +
      '</div>';

    var botones = Array.prototype.slice.call(cont.querySelectorAll('[data-perfil]'));

    function refrescar() {
      var activo = perfilActivo();
      botones.forEach(function (b) {
        var on = b.getAttribute('data-perfil') === activo;
        b.classList.toggle('is-activo', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    botones.forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-perfil');
        if (id === perfilActivo()) return;
        usarPerfil(id);
        refrescar();
        if (typeof opts.onCambio === 'function') opts.onCambio(id);
      });
    });

    refrescar();
    return { refrescar: refrescar };
  }

  return {
    perfilActivo: perfilActivo,
    usarPerfil: usarPerfil,
    perfil: perfil,
    latencia: latencia,
    latenciaDe: latenciaDe,
    guardarCalibracion: guardarCalibracion,
    guardarBase: guardarBase,
    montarSelector: montarSelector,
    // Etiqueta legible para la interfaz.
    nombrePerfil: nombrePerfil,
  };
})();
