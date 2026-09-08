/* ============================================================
   wrapped-music.js — La música de fondo del Wrapped, generada.

   No hay archivos de audio: la música se sintetiza al vuelo con la
   Web Audio API. Cada mes tiene su propia paleta (tono, escala,
   progresión, tempo, brillo) así que suena distinta y reconocible.

   Meses: colchón cálido = pad suave + arpegio tipo campana con eco + bajo.
   Anual (31 dic): otra cosa. Más lento (60 bpm), acordes con 7ª, una
   CAJA DE MÚSICA con melodía fija por encima, un BORDÓN grave sostenido,
   un golpe de TIMBAL en cada compás y una sala de eco grande. Debe
   sentirse "el grande", no un mes más.

   Pensado para sonar debajo de los textos. Cuando un slide reproduce
   una canción de Maite, wrapped-audio.js baja el nivel con nivel().

   window.WrappedMusic.iniciar(mes)   mes 0-11 | 'anual'
   window.WrappedMusic.nivel(v)       0..1 (mute / ducking)
   window.WrappedMusic.reanudar()     reintenta tras el primer gesto
   window.WrappedMusic.parar()
   ============================================================ */

window.WrappedMusic = (function () {
  'use strict';

  var BASE = 0.85;                 // volumen máximo del bus general
  var MAYOR      = [0, 2, 4, 5, 7, 9, 11];
  var LIDIO      = [0, 2, 4, 6, 7, 9, 11];
  var MIXOLIDIO  = [0, 2, 4, 5, 7, 9, 10];
  var DORICO     = [0, 2, 3, 5, 7, 9, 10];

  // Config por mes: raiz (nota MIDI), escala, progresión (grados 0-6),
  // bpm y brillo (corte del filtro paso-bajo, Hz).
  var MESES = [
    { raiz: 62, escala: DORICO,    prog: [0, 5, 3, 4], bpm: 68, brillo: 1500 }, // enero — invierno, recogido
    { raiz: 65, escala: LIDIO,     prog: [0, 3, 4, 0], bpm: 72, brillo: 1700 }, // febrero
    { raiz: 67, escala: MAYOR,     prog: [0, 4, 5, 3], bpm: 78, brillo: 2100 }, // marzo — primavera
    { raiz: 69, escala: MIXOLIDIO, prog: [0, 5, 3, 4], bpm: 80, brillo: 2000 }, // abril
    { raiz: 60, escala: LIDIO,     prog: [0, 3, 5, 4], bpm: 82, brillo: 2300 }, // mayo
    { raiz: 64, escala: DORICO,    prog: [0, 3, 4, 5], bpm: 84, brillo: 1900 }, // junio — cálido
    { raiz: 62, escala: MAYOR,     prog: [0, 4, 3, 4], bpm: 86, brillo: 2400 }, // julio — luminoso
    { raiz: 65, escala: MAYOR,     prog: [0, 5, 3, 4], bpm: 80, brillo: 2100 }, // agosto
    { raiz: 69, escala: DORICO,    prog: [0, 5, 3, 4], bpm: 74, brillo: 1600 }, // septiembre — vuelta a la rutina
    { raiz: 67, escala: MIXOLIDIO, prog: [0, 3, 4, 3], bpm: 72, brillo: 1700 }, // octubre — otoño
    { raiz: 60, escala: DORICO,    prog: [0, 5, 4, 5], bpm: 70, brillo: 1500 }, // noviembre
    { raiz: 63, escala: MAYOR,     prog: [0, 3, 4, 0], bpm: 66, brillo: 1600 }  // diciembre — tierno (por si acaso)
  ];
  // El Wrapped anual: más lento y ceremonioso, acordes con 7ª (más emoción),
  // caja de música por encima y un bordón grave por debajo. Tiene que
  // sentirse "el grande", no un mes más.
  var ANUAL = {
    raiz: 60, escala: MAYOR, prog: [0, 3, 5, 4, 0, 3, 1, 4],
    bpm: 60, brillo: 2900, esAnual: true, con7: true
  };
  // Melodía fija de la caja de música (grados de escala, registro agudo).
  var MOTIVO_ANUAL = [7, 9, 11, 9, 7, 4, 2, 4];

  // Patrón del arpegio (índices de nota de acorde: 0-2 = tríada, 3-4 = octava).
  var PATRON = [0, 2, 4, 2, 1, 2, 4, 3];

  var ctx = null;
  var master = null;      // ganancia general (mute / ducking)
  var seco = null;        // bus "seco"
  var envioEco = null;    // envío al eco
  var timer = null;
  var cfg = null;
  var paso = 0;
  var tProx = 0;
  var pasoLead = 0;

  function midiAF(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function nota(cfg, grado) {
    var oct = Math.floor(grado / 7);
    return cfg.raiz + cfg.escala[((grado % 7) + 7) % 7] + 12 * oct;
  }
  function acorde(cfg, grado) {
    var a = [nota(cfg, grado), nota(cfg, grado + 2), nota(cfg, grado + 4)];
    if (cfg.con7) a.push(nota(cfg, grado + 6));   // 7ª: armonía más rica
    return a;
  }
  function notaArp(ac, idx) {
    if (idx <= 2) return ac[idx];
    if (idx === 3) return ac[0] + 12;
    return ac[1] + 12;
  }

  /* ---------- voces ---------- */
  function pluck(freq, t, gan, destino) {
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cfg.brillo * 1.6, t);
    f.frequency.exponentialRampToValueAtTime(cfg.brillo * 0.6, t + 0.9);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gan, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 1.7);
    o.connect(f); f.connect(g);
    g.connect(destino);
    g.connect(envioEco);
    o.start(t);
    o.stop(t + 1.8);
    o.onended = function () { try { o.disconnect(); f.disconnect(); g.disconnect(); } catch (e) {} };
  }

  function pad(ac, t, dur) {
    var freqs = ac.slice(0, 3);
    if (cfg.esAnual) {
      if (ac[3] != null) freqs.push(ac[3]);       // 7ª en el pad
      freqs.push(ac[1] + 12);                      // quinta una octava arriba: más cuerpo
    }
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cfg.brillo * 0.85;
    f.Q.value = 0.4;
    var pico = cfg.esAnual ? 0.055 : 0.042;
    var ataque = cfg.esAnual ? 2.0 : 1.3;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(pico, t + ataque);
    if (cfg.esAnual) {                             // leve oleaje a mitad del compás
      g.gain.linearRampToValueAtTime(pico * 1.22, t + dur * 0.55);
      g.gain.linearRampToValueAtTime(pico, t + dur - 0.4);
    } else {
      g.gain.setValueAtTime(pico, t + dur - 0.4);
    }
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur + 1.4);
    f.connect(g); g.connect(seco); g.connect(envioEco);

    var osc = [];
    freqs.forEach(function (m, i) {
      [-6, 6].forEach(function (cent) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiAF(m);
        o.detune.value = cent + (i === 0 ? 0 : 0);
        o.connect(f); o.start(t); o.stop(t + dur + 1.5);
        osc.push(o);
      });
    });
    // sub una octava por debajo
    var sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiAF(ac[0] - 12);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.05, t + 1.0);
    sg.gain.setValueAtTime(0.05, t + dur - 0.3);
    sg.gain.exponentialRampToValueAtTime(0.0006, t + dur + 0.8);
    sub.connect(sg); sg.connect(seco);
    sub.start(t); sub.stop(t + dur + 0.9);
    osc.push(sub);

    var ultimo = osc[osc.length - 1];
    ultimo.onended = function () {
      try { f.disconnect(); g.disconnect(); sg.disconnect(); osc.forEach(function (o) { o.disconnect(); }); } catch (e) {}
    };
  }

  function bajo(ac, t, dur) {
    var m = ac[0] - 12;
    if (midiAF(m) < 49) m += 12;   // no bajar de ~Sol1
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiAF(m);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.13, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.02, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur + 0.3);
    o.connect(g); g.connect(seco);
    o.start(t); o.stop(t + dur + 0.4);
    o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) {} };
  }

  // Caja de música / glockenspiel (solo anual): sine + armónicos que decaen
  // rápido, con mucho eco. Es la voz que hace que el anual suene "especial".
  function campana(midi, t, gan) {
    var freq = midiAF(midi);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gan, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 2.8);
    g.connect(seco); g.connect(envioEco);
    var parciales = [[1, 1], [2, 0.45], [3, 0.18], [4.2, 0.08]];
    var osc = parciales.map(function (p) {
      var o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * p[0];
      var pg = ctx.createGain();
      pg.gain.setValueAtTime(p[1], t);
      pg.gain.exponentialRampToValueAtTime(0.001, t + 1.2 + Math.random() * 0.8);
      o.connect(pg); pg.connect(g);
      o.start(t); o.stop(t + 3);
      return o;
    });
    osc[0].onended = function () { try { g.disconnect(); osc.forEach(function (o) { o.disconnect(); }); } catch (e) {} };
  }

  // Bordón grave continuo (solo anual): sostiene la tónica bajo todo.
  function bordon(midi, t, dur) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiAF(midi);
    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = midiAF(midi + 12);
    var g2 = ctx.createGain(); g2.gain.value = 0.03;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 1.5);
    g.gain.setValueAtTime(0.11, t + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur + 1);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(seco);
    o.start(t); o2.start(t); o.stop(t + dur + 1.1); o2.stop(t + dur + 1.1);
    o.onended = function () { try { o.disconnect(); o2.disconnect(); g.disconnect(); g2.disconnect(); } catch (e) {} };
  }

  // Golpe grave suave en el primer tiempo del compás (solo anual): gravedad.
  function timbal(midi, t) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(midiAF(midi) * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(midiAF(midi), t + 0.18);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.8);
    o.connect(g); g.connect(seco);
    o.start(t); o.stop(t + 0.9);
    o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) {} };
  }

  /* ---------- planificador ---------- */
  // `i` avanza en corcheas (medio tiempo). 8 corcheas = 1 compás de 4 tiempos.
  function programar(i, t) {
    var compas = Math.floor(i / 8) % cfg.prog.length;
    var enCompas = i % 8;
    var ac = acorde(cfg, cfg.prog[compas]);
    var beat = 60 / cfg.bpm;

    if (enCompas === 0) {
      pad(ac, t, beat * 4);
      bajo(ac, t, beat * 4);
      if (cfg.esAnual) {
        bordon(cfg.raiz - 24 + (midiAF(cfg.raiz - 24) < 41 ? 12 : 0), t, beat * 4);
        timbal(cfg.raiz - 24, t);
      }
    }

    if (cfg.esAnual) {
      // Caja de música: una nota del motivo cada 2 tiempos (blanca).
      if (enCompas % 4 === 0) {
        var paso4 = (Math.floor(i / 4)) % MOTIVO_ANUAL.length;
        var g = MOTIVO_ANUAL[paso4];
        campana(nota(cfg, g) + 12, t, enCompas === 0 ? 0.12 : 0.085);
      }
      // Arpegio más espaciado y suave que en los meses.
      if (enCompas % 2 === 0) {
        var ia = PATRON[i % PATRON.length];
        pluck(midiAF(notaArp(ac, ia)), t, enCompas === 0 ? 0.07 : 0.045, seco);
      }
      return;
    }

    var idx = PATRON[i % PATRON.length];
    var ganArp = (enCompas % 2 === 0) ? 0.12 : 0.08;
    pluck(midiAF(notaArp(ac, idx)), t, ganArp, seco);
  }

  function planificador() {
    if (!ctx || ctx.state !== 'running') return;
    if (tProx < ctx.currentTime) tProx = ctx.currentTime + 0.08;
    var beat = 60 / cfg.bpm;
    while (tProx < ctx.currentTime + 0.3) {
      programar(paso, tProx);
      tProx += beat / 2;   // corcheas
      paso++;
    }
  }

  /* ---------- API ---------- */
  function iniciar(mes) {
    parar();
    cfg = (mes === 'anual') ? ANUAL : (MESES[mes] || MESES[0]);
    paso = 0; pasoLead = 0;

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 65;
    master.connect(comp); comp.connect(hp); hp.connect(ctx.destination);

    seco = ctx.createGain();
    seco.gain.value = 1;
    seco.connect(master);

    // Eco estéreo con realimentación (da aire sin necesitar reverb). El anual
    // usa retardos más largos y más realimentación: suena a sala grande.
    var granda = !!(cfg && cfg.esAnual);
    envioEco = ctx.createGain();
    envioEco.gain.value = granda ? 0.4 : 0.26;
    var retardos = granda ? [[0.5, -0.55], [0.75, 0.55], [1.1, 0.15]] : [[0.34, -0.5], [0.47, 0.5]];
    retardos.forEach(function (par) {
      var d = ctx.createDelay(1.6);
      d.delayTime.value = par[0];
      var fb = ctx.createGain(); fb.gain.value = granda ? 0.42 : 0.31;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = granda ? 2600 : 2200;
      var wet = ctx.createGain(); wet.gain.value = 0.5;
      envioEco.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
      if (ctx.createStereoPanner) {
        var pan = ctx.createStereoPanner(); pan.pan.value = par[1];
        lp.connect(pan); pan.connect(wet);
      } else {
        lp.connect(wet);
      }
      wet.connect(master);
    });

    tProx = 0;
    timer = setInterval(planificador, 25);

    var arranque = function () {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(BASE, ctx.currentTime + (granda ? 2.6 : 1.2));
    };
    if (ctx.state === 'running') arranque();
    else ctx.resume().then(arranque).catch(function () {});
  }

  function reanudar() {
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().then(function () {
        if (!master) return;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(BASE * nivelActual, ctx.currentTime + 0.8);
      }).catch(function () {});
    }
  }

  var nivelActual = 1;
  function nivel(v) {
    nivelActual = Math.max(0, Math.min(1, v));
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(BASE * nivelActual, ctx.currentTime + 0.35);
  }

  function parar() {
    if (timer) { clearInterval(timer); timer = null; }
    var viejo = ctx;
    if (viejo && master) {
      try {
        master.gain.cancelScheduledValues(viejo.currentTime);
        master.gain.setValueAtTime(master.gain.value, viejo.currentTime);
        master.gain.linearRampToValueAtTime(0, viejo.currentTime + 0.3);
      } catch (e) {}
      setTimeout(function () { try { viejo.close(); } catch (e) {} }, 450);
    }
    ctx = null; master = null; seco = null; envioEco = null; cfg = null;
    nivelActual = 1;
  }

  return { iniciar: iniciar, nivel: nivel, reanudar: reanudar, parar: parar };
})();
