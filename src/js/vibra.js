/* ============================================================
   vibra.js — Vibración háptica del móvil (window.Vibra).

   Se usa SOLO en momentos especiales, no en cada toque: el
   objetivo es que cuando el móvil vibra, Maite sepa que ha
   pasado algo que merece la pena (un logro, acertar el juego
   del resumen, un aviso del hijo…).

   Usa @capacitor/haptics dentro del APK; en el navegador cae a
   navigator.vibrate (y si tampoco hay, no hace nada). Los
   patrones largos se silencian con prefers-reduced-motion;
   los toques sueltos de confirmación siempre suenan.

     window.Vibra.toque()     -> golpe corto y suave
     window.Vibra.acierto()   -> "bien hecho" (éxito)
     window.Vibra.fallo()     -> "casi" (error, doble seco)
     window.Vibra.logro()     -> pequeña celebración
     window.Vibra.aviso()     -> llamada de atención (dos pulsos)
     window.Vibra.bloqueo()   -> zumbido áspero y largo

   Se carga como script clásico y expone window.Vibra.
   ============================================================ */

(function () {
  'use strict';

  function reducido() {
    try {
      return window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function plugin() {
    try {
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.Haptics) || null;
    } catch (e) { return null; }
  }

  // Golpe de intensidad 'LIGHT' | 'MEDIUM' | 'HEAVY'.
  function impacto(estilo) {
    var H = plugin();
    if (H && H.impact) { try { H.impact({ style: estilo }); return true; } catch (e) {} }
    return false;
  }

  // Notificación semántica 'SUCCESS' | 'WARNING' | 'ERROR'.
  function notificar(tipo) {
    var H = plugin();
    if (H && H.notification) { try { H.notification({ type: tipo }); return true; } catch (e) {} }
    return false;
  }

  // Patrón crudo: [pausa, vibra, pausa, vibra, …] en ms (formato navigator.vibrate).
  function patron(ms) {
    try {
      if (navigator.vibrate) { navigator.vibrate(ms); return true; }
    } catch (e) {}
    var H = plugin();
    if (H && H.vibrate) {
      // El plugin solo sabe de una duración: suma los tramos de vibración.
      var total = 0;
      for (var i = 1; i < ms.length; i += 2) total += ms[i];
      try { H.vibrate({ duration: Math.min(total || 60, 400) }); return true; } catch (e) {}
    }
    return false;
  }

  /* ---------- API pública ---------- */

  // Confirmación breve. Siempre suena (es feedback, no decoración).
  function toque() {
    if (impacto('LIGHT')) return;
    patron([0, 12]);
  }

  // Acierto / algo que sale bien.
  function acierto() {
    if (notificar('SUCCESS')) return;
    patron(reducido() ? [0, 16] : [0, 14, 40, 26]);
  }

  // Fallo / “casi”: dos golpes secos y cortos.
  function fallo() {
    if (notificar('ERROR')) return;
    patron(reducido() ? [0, 22] : [0, 22, 60, 22]);
  }

  // Pequeña celebración (logro, canción aprendida, hito de racha).
  function logro() {
    if (!reducido() && patron([0, 14, 45, 18, 45, 34])) return;
    if (notificar('SUCCESS')) return;
    patron([0, 20]);
  }

  // Llamada de atención suave (aviso del hijo desde el panel).
  function aviso() {
    if (!reducido() && patron([0, 26, 90, 26])) return;
    if (notificar('WARNING')) return;
    impacto('MEDIUM');
  }

  // Zumbido áspero y largo: la app se ha bloqueado.
  function bloqueo() {
    if (patron([0, 90, 70, 90, 70, 160])) return;
    notificar('ERROR');
  }

  window.Vibra = {
    toque: toque,
    acierto: acierto,
    fallo: fallo,
    logro: logro,
    aviso: aviso,
    bloqueo: bloqueo,
    patron: patron
  };
})();
