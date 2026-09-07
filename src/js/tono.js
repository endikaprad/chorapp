/* ============================================================
   tono.js — "Dame el tono" (Fase 5, ayuda de estudio)

   Antes de cantar un trozo suelto, Maite necesita su nota de
   entrada. Este módulo da esa nota con un sonido limpio, sin
   depender del audio del ensayo:

     - Botones de notas en solfeo (Do, Re, Mi…) que suenan al tocarlas.
     - Selector de octava (Maite es soprano → por defecto la 5.ª).
     - "Bordón": mantiene la última nota sonando para afinar encima.
     - "La 440": diapasón de referencia.

   Todo con la Web Audio API: cero peso, cero archivos, seguro en el
   WebView de Android.

   Uso:
     window.Tono.montarEn(contenedor, { clave: 'cancion:<id>' });
     window.Tono.montarEn devuelve un objeto con .destruir()

   La última nota/octava elegida se recuerda por `clave`.
   ============================================================ */

window.Tono = (function () {
  'use strict';

  // Solfeo → semitono dentro de la octava (Do = 0). El ♯ se marca aparte.
  var NOTAS = [
    { nombre: 'Do',  semi: 0 },
    { nombre: 'Do♯', semi: 1,  alterada: true },
    { nombre: 'Re',  semi: 2 },
    { nombre: 'Re♯', semi: 3,  alterada: true },
    { nombre: 'Mi',  semi: 4 },
    { nombre: 'Fa',  semi: 5 },
    { nombre: 'Fa♯', semi: 6,  alterada: true },
    { nombre: 'Sol', semi: 7 },
    { nombre: 'Sol♯', semi: 8, alterada: true },
    { nombre: 'La',  semi: 9 },
    { nombre: 'La♯', semi: 10, alterada: true },
    { nombre: 'Si',  semi: 11 },
  ];

  var OCT_MIN = 3, OCT_MAX = 6, OCT_DEF = 5;

  var ctx = null;
  var droneNodos = null;   // { oscs:[], ganancia, semitono } mientras suena el bordón
  var instancias = [];     // paneles vivos, para apagar el bordón al desmontar

  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // Frecuencia de un semitono absoluto (La central = octava 4, semi 9 → 440 Hz).
  function frecuencia(octava, semi) {
    var n = (octava - 4) * 12 + (semi - 9);   // semitonos respecto al La 440
    return 440 * Math.pow(2, n / 12);
  }

  /* ---------- Sonar una nota corta ---------- */

  function sonarFrecuencia(hz, dur) {
    var ac = audio();
    if (!ac) return;
    dur = dur || 1.7;
    var t0 = ac.currentTime;

    var g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.28, t0 + 0.03);      // ataque suave
    g.gain.setTargetAtTime(0.16, t0 + 0.06, 0.35);        // pequeño decaimiento
    g.gain.setTargetAtTime(0.0001, t0 + dur - 0.35, 0.18); // caída final
    g.connect(ac.destination);

    // Dos ondas: una fundamental de triángulo y una senoidal a la octava
    // muy floja → timbre cálido, como un carillón, nada electrónico.
    [
      { tipo: 'triangle', mul: 1,   vol: 0.9 },
      { tipo: 'sine',     mul: 2,   vol: 0.18 },
    ].forEach(function (v) {
      var o = ac.createOscillator();
      o.type = v.tipo;
      o.frequency.value = hz * v.mul;
      var gv = ac.createGain();
      gv.gain.value = v.vol;
      o.connect(gv).connect(g);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    });
  }

  function sonarNota(octava, semi, dur) {
    sonarFrecuencia(frecuencia(octava, semi), dur);
  }

  function diapason() {
    sonarFrecuencia(440, 2.4);
  }

  /* ---------- Ayudas para usar una nota guardada (p. ej. en un fragmento) ---------- */

  function normalizar(nota) {
    if (!nota || typeof nota !== 'object') return null;
    var semi = Number(nota.semi);
    var oct = Number(nota.octava);
    if (!isFinite(semi) || semi < 0 || semi > 11) return null;
    if (!isFinite(oct)) oct = OCT_DEF;
    return { octava: clamp(Math.round(oct), OCT_MIN, OCT_MAX), semi: Math.round(semi) };
  }

  function nombreDe(semi) {
    var n = NOTAS.filter(function (x) { return x.semi === semi; })[0];
    return n ? n.nombre : '';
  }

  // "La · 5"
  function etiqueta(nota) {
    var n = normalizar(nota);
    return n ? (nombreDe(n.semi) + ' · ' + n.octava) : '';
  }

  function sonar(nota, dur) {
    var n = normalizar(nota);
    if (n) sonarNota(n.octava, n.semi, dur);
  }

  /* ---------- Bordón (nota sostenida para afinar) ---------- */

  function pararDrone() {
    if (!droneNodos) return;
    var ac = ctx;
    var d = droneNodos;
    droneNodos = null;
    if (ac) {
      var t = ac.currentTime;
      try {
        d.ganancia.gain.cancelScheduledValues(t);
        d.ganancia.gain.setTargetAtTime(0.0001, t, 0.12);
      } catch (e) {}
      d.oscs.forEach(function (o) { try { o.stop(t + 0.4); } catch (e) {} });
    }
  }

  function arrancarDrone(octava, semi) {
    var ac = audio();
    if (!ac) return;
    pararDrone();
    var hz = frecuencia(octava, semi);
    var t0 = ac.currentTime;

    var g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.13, t0 + 0.25);

    // Filtro paso-bajo → sonido redondo, no molesta al mantenerse.
    var lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(3200, hz * 6);
    g.connect(lp).connect(ac.destination);

    // Vibrato lento y leve para que "respire".
    var lfo = ac.createOscillator();
    lfo.frequency.value = 5;
    var lfoG = ac.createGain();
    lfoG.gain.value = hz * 0.004;
    lfo.connect(lfoG);
    lfo.start(t0);

    var oscs = [lfo];
    [
      { tipo: 'sawtooth', det: -4, vol: 0.5 },
      { tipo: 'triangle', det: 4,  vol: 0.5 },
    ].forEach(function (v) {
      var o = ac.createOscillator();
      o.type = v.tipo;
      o.frequency.value = hz;
      o.detune.value = v.det;
      lfoG.connect(o.detune);
      var gv = ac.createGain();
      gv.gain.value = v.vol;
      o.connect(gv).connect(g);
      o.start(t0);
      oscs.push(o);
    });

    droneNodos = { oscs: oscs, ganancia: g, octava: octava, semi: semi };
  }

  function droneActivoEn(octava, semi) {
    return !!droneNodos && droneNodos.octava === octava && droneNodos.semi === semi;
  }

  /* ---------- Selector de nota compacto ----------
     Para elegir la nota de entrada de un fragmento difícil: octava + 12
     teclas de solfeo. Cada toque suena y avisa por `onCambio({octava,semi})`.
     Devuelve { destruir }. */

  function selectorNota(contenedor, opciones) {
    opciones = opciones || {};
    var actual = normalizar(opciones.valor);
    var octava = actual ? actual.octava : OCT_DEF;

    var caja = document.createElement('div');
    caja.className = 'tono tono--mini';
    caja.innerHTML =
      '<div class="tono__barra">' +
        '<div class="tono__oct" role="group" aria-label="Octava">' +
          '<button type="button" class="tono__oct-btn" data-oct-menos aria-label="Octava más grave">–</button>' +
          '<span class="tono__oct-val" data-oct-val></span>' +
          '<button type="button" class="tono__oct-btn" data-oct-mas aria-label="Octava más aguda">+</button>' +
        '</div>' +
        (opciones.onCerrar ? '<button type="button" class="tono__diapason" data-cerrar>Listo</button>' : '') +
      '</div>' +
      '<div class="tono__teclas" data-teclas></div>';
    contenedor.appendChild(caja);

    var elTeclas = caja.querySelector('[data-teclas]');
    var elOctVal = caja.querySelector('[data-oct-val]');

    NOTAS.forEach(function (nota) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tono__tecla' + (nota.alterada ? ' tono__tecla--alt' : '');
      b.textContent = nota.nombre;
      b.dataset.semi = String(nota.semi);
      b.addEventListener('click', function () {
        actual = { octava: octava, semi: nota.semi };
        sonarNota(octava, nota.semi);
        pintar();
        if (opciones.onCambio) opciones.onCambio({ octava: octava, semi: nota.semi });
      });
      elTeclas.appendChild(b);
    });

    caja.querySelector('[data-oct-menos]').addEventListener('click', function () { mover(-1); });
    caja.querySelector('[data-oct-mas]').addEventListener('click', function () { mover(1); });
    var btnCerrar = caja.querySelector('[data-cerrar]');
    if (btnCerrar) btnCerrar.addEventListener('click', function () { opciones.onCerrar(); });

    function mover(paso) {
      octava = clamp(octava + paso, OCT_MIN, OCT_MAX);
      if (actual) {
        actual.octava = octava;
        sonarNota(octava, actual.semi);
        if (opciones.onCambio) opciones.onCambio({ octava: octava, semi: actual.semi });
      }
      pintar();
    }

    function pintar() {
      elOctVal.textContent = octava;
      var teclas = elTeclas.querySelectorAll('.tono__tecla');
      for (var i = 0; i < teclas.length; i++) {
        teclas[i].classList.toggle('is-sel',
          !!actual && Number(teclas[i].dataset.semi) === actual.semi);
      }
    }
    pintar();

    return {
      destruir: function () { if (caja.parentNode) caja.parentNode.removeChild(caja); },
    };
  }

  /* ---------- Panel de UI ---------- */

  function montarEn(contenedor, opciones) {
    opciones = opciones || {};
    var clave = opciones.clave ? 'tono:' + opciones.clave : null;

    var guardado = clave ? (window.Almacen.leer(clave) || {}) : {};
    var octava = clamp(guardado.octava || OCT_DEF, OCT_MIN, OCT_MAX);
    var semiSel = (typeof guardado.semi === 'number') ? guardado.semi : null;

    var panel = document.createElement('div');
    panel.className = 'tono';
    panel.innerHTML =
      '<div class="tono__barra">' +
        '<div class="tono__oct" role="group" aria-label="Octava">' +
          '<button type="button" class="tono__oct-btn" data-oct-menos aria-label="Octava más grave">–</button>' +
          '<span class="tono__oct-val" data-oct-val></span>' +
          '<button type="button" class="tono__oct-btn" data-oct-mas aria-label="Octava más aguda">+</button>' +
        '</div>' +
        '<button type="button" class="tono__diapason" data-diapason>La 440</button>' +
      '</div>' +
      '<div class="tono__teclas" data-teclas></div>' +
      '<button type="button" class="tono__drone" data-drone hidden>' +
        '<span class="tono__drone-punto" aria-hidden="true"></span>' +
        '<span data-drone-txt>Bordón</span>' +
      '</button>' +
      '<p class="tono__pista">Toca tu nota de entrada. El <strong>bordón</strong> la mantiene para afinar encima.</p>';

    contenedor.appendChild(panel);

    var elTeclas = panel.querySelector('[data-teclas]');
    var elOctVal = panel.querySelector('[data-oct-val]');
    var btnDrone = panel.querySelector('[data-drone]');
    var txtDrone = panel.querySelector('[data-drone-txt]');

    NOTAS.forEach(function (nota) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tono__tecla' + (nota.alterada ? ' tono__tecla--alt' : '');
      b.textContent = nota.nombre;
      b.dataset.semi = String(nota.semi);
      b.addEventListener('click', function () { elegir(nota.semi); });
      elTeclas.appendChild(b);
    });

    panel.querySelector('[data-oct-menos]').addEventListener('click', function () { cambiarOct(-1); });
    panel.querySelector('[data-oct-mas]').addEventListener('click', function () { cambiarOct(1); });
    panel.querySelector('[data-diapason]').addEventListener('click', diapason);
    btnDrone.addEventListener('click', alternarDrone);

    function elegir(semi) {
      semiSel = semi;
      sonarNota(octava, semi);
      if (droneNodos) arrancarDrone(octava, semi);   // si el bordón sonaba, se muda a la nueva nota
      persistir();
      pintar();
    }

    function cambiarOct(paso) {
      octava = clamp(octava + paso, OCT_MIN, OCT_MAX);
      if (semiSel != null) sonarNota(octava, semiSel);
      if (droneNodos && semiSel != null) arrancarDrone(octava, semiSel);
      persistir();
      pintar();
    }

    function alternarDrone() {
      if (semiSel == null) return;
      if (droneActivoEn(octava, semiSel)) pararDrone();
      else arrancarDrone(octava, semiSel);
      pintar();
    }

    function persistir() {
      if (!clave) return;
      window.Almacen.guardar(clave, { octava: octava, semi: semiSel });
    }

    function pintar() {
      elOctVal.textContent = octava;
      var teclas = elTeclas.querySelectorAll('.tono__tecla');
      for (var i = 0; i < teclas.length; i++) {
        teclas[i].classList.toggle('is-sel', Number(teclas[i].dataset.semi) === semiSel);
      }
      var hayNota = semiSel != null;
      btnDrone.hidden = !hayNota;
      var son = droneNodos && droneActivoEn(octava, semiSel);
      btnDrone.classList.toggle('is-activo', !!son);
      txtDrone.textContent = son ? 'Parar bordón' : 'Bordón';
    }

    pintar();

    var api = {
      destruir: function () {
        pararDrone();
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        var i = instancias.indexOf(api);
        if (i >= 0) instancias.splice(i, 1);
      },
    };
    instancias.push(api);
    return api;
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  return {
    montarEn: montarEn,
    selectorNota: selectorNota,
    sonarNota: sonarNota,
    sonar: sonar,
    etiqueta: etiqueta,
    diapason: diapason,
    pararDrone: pararDrone,
  };
})();
