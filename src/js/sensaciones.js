/* ============================================================
   sensaciones.js — Diario de sensaciones (window.Sensaciones).

   Tras un ensayo, un toque rápido: ¿cómo te has sentido?
   Cuatro emojis grandes — Me salió / A gusto / Cansada / Frustrada —
   y a otra cosa. Se guarda uno por día (el último toque manda) y
   luego aparece en el recap del día (Práctica) y en el Wrapped.

   Almacén ('sensaciones'):
     { "YYYY-MM-DD": { emo, ts, veces }, ... }
   Y ('sensaciones:preguntada') = último día en que se preguntó sola.

   API:
     window.Sensaciones.EMOCIONES            -> [{ id, emoji, etq, token }]
     window.Sensaciones.opcion(id)           -> una de EMOCIONES
     window.Sensaciones.registrar(id)        -> guarda la de hoy
     window.Sensaciones.deHoy() / delDia(iso)-> { emo, ts, veces } | null
     window.Sensaciones.dias()               -> ["YYYY-MM-DD", ...]
     window.Sensaciones.entre(ini, fin)      -> { "iso": {...} } en [ini, fin]
     window.Sensaciones.resumen(mapa|isos)   -> { n, conteo:{id:n}, top:{id,..}, orden:[] }
     window.Sensaciones.abrirHoja(opts)      -> la hoja de emojis (opts.fecha, opts.onListo, opts.motivo)
     window.Sensaciones.preguntarTrasSesion(opts) -> la abre solo si hoy no se ha tocado ni preguntado

   Script clásico. Usa window.Almacen y, si están, window.Vibra / window.Diario.
   ============================================================ */

window.Sensaciones = (function () {
  'use strict';

  var CLAVE = 'sensaciones';
  var CLAVE_PREG = 'sensaciones:preguntada';

  // El orden es el de la rejilla 2×2 de la hoja.
  var EMOCIONES = [
    {
      id: 'salio', emoji: '🎉', etq: 'Me salió', token: 'var(--estado-aprendida)',
      corta: 'Te salió',
      frases: ['¡Bien! Días así valen por diez. 🎶', 'A guardar esa sensación, Maite.',
               'Cuando sale, sale. Disfrútalo.'],
    },
    {
      id: 'agusto', emoji: '😌', etq: 'A gusto', token: 'var(--color-acento)',
      corta: 'A gusto',
      frases: ['A gusto es como hay que salir del coro.', 'Qué bien. Nos vemos mañana.',
               'Un ratito para ti, cantando. Perfecto.'],
    },
    {
      id: 'cansada', emoji: '😮‍💨', etq: 'Cansada', token: 'var(--color-texto-2)',
      corta: 'Cansada',
      frases: ['Descansa, que te lo has ganado.', 'Mañana, con más fuerza.',
               'Cansada pero puesta. Cuenta igual.'],
    },
    {
      id: 'frustrada', emoji: '😣', etq: 'Frustrada', token: 'var(--estado-progreso)',
      corta: 'Frustrada',
      frases: ['Días torcidos los tiene cualquiera. Mañana va mejor.',
               'Respira. La canción no se va a ninguna parte.',
               'Que hoy se resista no quiere decir nada. Sigues.'],
    },
  ];

  function opcion(id) {
    for (var i = 0; i < EMOCIONES.length; i++) if (EMOCIONES[i].id === id) return EMOCIONES[i];
    return null;
  }
  function elegir(a) { return a[Math.floor(Math.random() * a.length)]; }
  function reducido() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function hoyISO(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var x = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + x;
  }

  function _leer() {
    var r = window.Almacen ? window.Almacen.leer(CLAVE, {}) : {};
    return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {};
  }
  function _guardar(reg) { if (window.Almacen) window.Almacen.guardar(CLAVE, reg); }

  function delDia(iso) {
    var e = _leer()[iso];
    return (e && typeof e === 'object' && opcion(e.emo)) ? e : null;
  }
  function deHoy() { return delDia(hoyISO()); }
  function dias() { return Object.keys(_leer()); }

  // Guarda la sensación de un día (por defecto hoy). El último toque manda,
  // pero se recuerda cuántas veces se ha tocado.
  function registrar(id, iso) {
    if (!opcion(id)) return null;
    iso = iso || hoyISO();
    var reg = _leer();
    var prev = reg[iso] && typeof reg[iso] === 'object' ? reg[iso] : null;
    var ev = { emo: id, ts: Date.now(), veces: (prev && +prev.veces || 0) + 1 };
    reg[iso] = ev;
    _guardar(reg);
    // Un rastro en la bitácora del día, por si algún día se quiere en la línea de tiempo.
    try {
      if (window.Diario && window.Diario.registrar) {
        window.Diario.registrar('sensacion', { titulo: opcion(id).etq, extra: { emo: id } });
      }
    } catch (e) {}
    return ev;
  }

  /* ---------- Consulta agregada (para Práctica y Wrapped) ---------- */

  // Todas las entradas cuyo día cae en [iniISO, finISO] (ambos incluidos).
  function entre(iniISO, finISO) {
    var reg = _leer();
    var out = {};
    Object.keys(reg).forEach(function (iso) {
      if (iso >= iniISO && iso <= finISO && delDia(iso)) out[iso] = reg[iso];
    });
    return out;
  }

  // resumen({iso:ev} | [iso,...]) -> conteo por emoción, cuál domina y en qué orden.
  function resumen(fuente) {
    var evs = [];
    if (Array.isArray(fuente)) {
      fuente.forEach(function (iso) { var e = delDia(iso); if (e) evs.push(e); });
    } else if (fuente && typeof fuente === 'object') {
      Object.keys(fuente).forEach(function (k) {
        var e = fuente[k];
        if (e && opcion(e.emo)) evs.push(e);
      });
    }
    var conteo = {};
    EMOCIONES.forEach(function (o) { conteo[o.id] = 0; });
    evs.forEach(function (e) { conteo[e.emo] = (conteo[e.emo] || 0) + 1; });

    var orden = EMOCIONES.map(function (o) { return { id: o.id, n: conteo[o.id] }; })
      .filter(function (x) { return x.n > 0; })
      .sort(function (a, b) { return b.n - a.n; });

    return { n: evs.length, conteo: conteo, top: orden[0] || null, orden: orden };
  }

  /* ---------- La hoja de emojis ---------- */

  var hoja = null;
  var alCerrar = null;

  function preguntada(iso) {
    return window.Almacen && window.Almacen.leer(CLAVE_PREG, '') === (iso || hoyISO());
  }
  function marcarPreguntada(iso) {
    if (window.Almacen) window.Almacen.guardar(CLAVE_PREG, iso || hoyISO());
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // opts: { fecha, motivo ('sesion'|'manual'), onListo(id) }
  function abrirHoja(opts) {
    opts = opts || {};
    var iso = opts.fecha || hoyISO();
    cerrar();
    marcarPreguntada(iso);

    var yaHoy = delDia(iso);
    var titulo = opts.motivo === 'sesion' ? '¿Qué tal el ensayo?' : '¿Cómo te has sentido hoy?';
    var pie = opts.motivo === 'sesion'
      ? 'Un toque y listo. Luego lo verás en tu resumen.'
      : 'Guarda cómo te has sentido cantando.';

    hoja = document.createElement('div');
    hoja.className = 'hoja hoja--sensa' + (reducido() ? ' hoja--sensa-sinmov' : '');
    hoja.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Diario de sensaciones">' +
        '<div class="hoja__asa"></div>' +
        '<h2 class="hoja__titulo sensa__titulo">' + escapar(titulo) + '</h2>' +
        '<p class="sensa__pie">' + escapar(pie) + '</p>' +
        '<div class="sensa__rejilla" role="group" aria-label="Cómo te has sentido">' +
          EMOCIONES.map(function (o, i) {
            return '<button type="button" class="sensa__op' +
              (yaHoy && yaHoy.emo === o.id ? ' is-elegida' : '') + '" ' +
              'data-emo="' + o.id + '" style="--tono:' + o.token + ';--i:' + i + '">' +
              '<span class="sensa__emoji" aria-hidden="true">' + o.emoji + '</span>' +
              '<span class="sensa__etq">' + escapar(o.etq) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<p class="sensa__confirma" data-confirma aria-live="polite" hidden></p>' +
        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--texto" data-cerrar>' +
            (yaHoy ? 'Cerrar' : 'Ahora no') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hoja);

    alCerrar = opts.onListo || null;

    Array.prototype.forEach.call(hoja.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', function () { cerrar(); });
    });
    document.addEventListener('keydown', escCerrar);

    var rejilla = hoja.querySelector('.sensa__rejilla');
    var confirma = hoja.querySelector('[data-confirma]');
    var bloqueado = false;

    rejilla.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-emo]');
      if (!b || bloqueado) return;
      bloqueado = true;
      var id = b.getAttribute('data-emo');
      var o = opcion(id);
      registrar(id, iso);
      try { if (window.Vibra) window.Vibra.toque(); } catch (e) {}

      Array.prototype.forEach.call(rejilla.querySelectorAll('.sensa__op'), function (x) {
        x.classList.toggle('is-elegida', x === b);
        x.classList.toggle('is-atenuada', x !== b);
        x.disabled = true;
      });
      b.classList.remove('is-pop'); void b.offsetWidth; b.classList.add('is-pop');

      confirma.textContent = elegir(o.frases);
      confirma.hidden = false;
      confirma.classList.remove('is-in'); void confirma.offsetWidth; confirma.classList.add('is-in');

      var espera = reducido() ? 550 : 1150;
      setTimeout(function () {
        var cb = alCerrar; var emo = id;
        cerrar();
        if (cb) try { cb(emo); } catch (e) {}
      }, espera);
    });

    void hoja.offsetHeight;
    hoja.classList.add('is-abierta');
  }

  function escCerrar(e) { if (e.key === 'Escape') cerrar(); }

  function cerrar() {
    document.removeEventListener('keydown', escCerrar);
    alCerrar = null;
    var h = hoja;
    hoja = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 360);
  }

  // La abre sola tras un ensayo, salvo que hoy ya se haya tocado o preguntado.
  function preguntarTrasSesion(opts) {
    opts = opts || {};
    var iso = opts.fecha || hoyISO();
    if (delDia(iso) || preguntada(iso) || hoja) return false;
    // Un respiro para que la navegación de vuelta termine antes de que salga.
    setTimeout(function () {
      if (delDia(iso) || hoja) return;
      abrirHoja({ fecha: iso, motivo: 'sesion', onListo: opts.onListo });
    }, opts.retardo != null ? opts.retardo : 620);
    return true;
  }

  return {
    EMOCIONES: EMOCIONES,
    opcion: opcion,
    hoyISO: hoyISO,
    registrar: registrar,
    deHoy: deHoy,
    delDia: delDia,
    dias: dias,
    entre: entre,
    resumen: resumen,
    preguntada: preguntada,
    abrirHoja: abrirHoja,
    preguntarTrasSesion: preguntarTrasSesion,
    cerrar: cerrar,
  };
})();
