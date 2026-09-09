/* ============================================================
   logros.js — Medallas / logros de Maite.

   No guarda progreso: cada logro se calcula al vuelo a partir de
   los datos que ya hay (práctica, repertorio, grabaciones,
   sesiones). Así nunca se desincroniza y no hay estado que migrar.

   Lo único que sí se guarda (Almacen 'logros:vistos') es la lista
   de logros que Maite YA ha visto conseguir, para poder enseñarle
   un aviso estilo Steam la primera vez que cae uno nuevo.

   window.Logros.listar()        -> [{ id, grupo, icono, titulo, desc,
                                       objetivo, valor, hecho, progreso }]
   window.Logros.resumen()       -> { hechos, total, siguiente }
   window.Logros.detalle(logro)  -> string: cómo / cuándo se consiguió
   window.Logros.revisarNuevos() -> muestra el aviso de los recién caídos
   window.Logros.icono(clave)    -> SVG
   ============================================================ */

window.Logros = (function () {
  'use strict';

  // Logros conseguidos PARA SIEMPRE. Una vez cae uno, es tuyo aunque
  // luego borres grabaciones, canciones, etc. (clave anterior: 'logros:vistos').
  var CLAVE_HECHOS = 'logros:hechos';
  var CLAVE_VISTOS = 'logros:vistos';
  var CLAVE_FECHAS = 'logros:fechas';   // { id: timestamp } cuándo cayó cada uno

  function _fechas() {
    var f = window.Almacen ? window.Almacen.leer(CLAVE_FECHAS, {}) : {};
    return (f && typeof f === 'object') ? f : {};
  }
  // Timestamp en que se consiguió un logro (0 si es anterior al registro).
  function fechaDe(id) { return _fechas()[id] || 0; }

  // Lee el conjunto de logros ya conseguidos (o null si nunca se ha guardado).
  // Migra en silencio desde la clave antigua si hace falta.
  function _hechosGuardados() {
    if (!window.Almacen) return null;
    var v = window.Almacen.leer(CLAVE_HECHOS, null);
    if (Array.isArray(v)) return v;
    var viejo = window.Almacen.leer(CLAVE_VISTOS, null);
    return Array.isArray(viejo) ? viejo : null;
  }

  /* Iconos de línea, mismo estilo que la barra de navegación. */
  var ICONOS = {
    llama: '<path d="M12 2c.6 3.2-1.4 4.9-2.9 6.6C7.5 10.5 6 12.3 6 15a6 6 0 0 0 12 0c0-2.2-1-3.9-2.1-5.4-.3 1-1 1.8-2 2.1.7-2.2.2-4.6-1.9-6.4C11.4 4.6 11.9 3.2 12 2Z"/>',
    calendario: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    nota: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    estrella: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z"/>',
    micro: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    trofeo: '<path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 15h6M8 21h8M12 15v6"/>',
  };

  function icono(clave) {
    var p = ICONOS[clave] || ICONOS.estrella;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* --- Fechas en cristiano ----------------------------------- */
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function _d(iso) { return new Date((iso || '') + 'T00:00:00'); }
  function _isoDeTs(ts) {
    var d = new Date(ts || 0);
    if (isNaN(d)) return '';
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var x = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + x;
  }
  function fecha(iso) {
    var d = _d(iso);
    if (isNaN(d)) return iso || '';
    var t = d.getDate() + ' de ' + MESES[d.getMonth()];
    if (d.getFullYear() !== new Date().getFullYear()) t += ' de ' + d.getFullYear();
    return t;
  }
  // "el 3 de septiembre" / "del 3 al 12 de septiembre" / "del 30 de agosto al 4 de septiembre"
  function rango(ini, fin) {
    if (!ini) return '';
    if (!fin || fin === ini) return 'el ' + fecha(ini);
    var a = _d(ini), b = _d(fin);
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
      return 'del ' + a.getDate() + ' al ' + fecha(fin);
    }
    return 'del ' + fecha(ini) + ' al ' + fecha(fin);
  }
  function lista(arr) {
    arr = arr.filter(Boolean);
    if (!arr.length) return '';
    if (arr.length === 1) return arr[0];
    return arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
  }

  /* --- Datos crudos de los que sale todo -------------------- */
  function datos() {
    var P = window.Practica;
    var reg = P ? P.leer() : {};
    var diasOrden = Object.keys(reg).sort();

    // Canciones distintas, en el orden en que aparecieron por primera vez.
    var vistas = {}, cancionesOrden = [];
    diasOrden.forEach(function (dia) {
      (reg[dia] || []).forEach(function (id) {
        if (id && !vistas[id]) {
          vistas[id] = true;
          var c = window.Canciones && window.Canciones.obtener(id);
          cancionesOrden.push({ id: id, titulo: (c && c.titulo) || 'una canción' });
        }
      });
    });

    var aprendidas = [];
    if (window.Canciones) {
      aprendidas = window.Canciones.listar()
        .filter(function (c) { return c.estado === 'aprendida'; })
        .map(function (c) { return c.titulo; });
    }

    var grabaciones = [];
    if (window.Grabaciones) {
      grabaciones = window.Grabaciones.listar().map(function (g) {
        var c = g.cancionId && window.Canciones && window.Canciones.obtener(g.cancionId);
        return {
          titulo: g.titulo || (c && c.titulo) || 'Grabación',
          creado: g.creado || 0,
        };
      });
    }

    var trozos = [];
    if (window.Sesiones) {
      window.Sesiones.listar().forEach(function (s) {
        (s.marcas || []).forEach(function (m) {
          (m.fragmentos || []).forEach(function (f) {
            trozos.push({ titulo: m.titulo || 'una canción', ts: f.creado || 0 });
          });
        });
      });
      trozos.sort(function (a, b) { return a.ts - b.ts; });
    }

    return {
      reg: reg,
      diasOrden: diasOrden,
      rango: P && P.mejorRachaRango ? P.mejorRachaRango() : null,
      canciones: cancionesOrden,
      aprendidas: aprendidas,
      grabaciones: grabaciones,
      trozos: trozos,
    };
  }

  /* --- Métricas (los números que disparan cada logro) -------- */
  function metricas(dt) {
    var P = window.Practica;
    var rachaAct = P ? P.racha() : 0;
    var mejor = P ? P.mejorRacha() : 0;
    return {
      racha: Math.max(rachaAct, mejor),
      dias: dt.diasOrden.length,
      canciones: dt.canciones.length,
      aprendidas: dt.aprendidas.length,
      grabaciones: dt.grabaciones.length,
      trozos: dt.trozos.length,
    };
  }

  /* --- Catálogo --------------------------------------------- */
  var CATALOGO = [
    { id: 'racha-3',   grupo: 'Racha',      icono: 'llama',      m: 'racha', objetivo: 3,
      titulo: 'Primer impulso',  desc: '3 días seguidos estudiando.' },
    { id: 'racha-7',   grupo: 'Racha',      icono: 'llama',      m: 'racha', objetivo: 7,
      titulo: 'Una semana',      desc: '7 días de racha sin fallar.' },
    { id: 'racha-14',  grupo: 'Racha',      icono: 'llama',      m: 'racha', objetivo: 14,
      titulo: 'Dos semanas',     desc: '14 días de racha. Ya es costumbre.' },
    { id: 'racha-30',  grupo: 'Racha',      icono: 'llama',      m: 'racha', objetivo: 30,
      titulo: 'Un mes entero',   desc: '30 días seguidos. Impresionante.' },
    { id: 'racha-100', grupo: 'Racha',      icono: 'trofeo',     m: 'racha', objetivo: 100,
      titulo: 'Cien días',       desc: '100 días de racha. Palabras mayores.' },

    { id: 'dias-10',   grupo: 'Constancia', icono: 'calendario', m: 'dias', objetivo: 10,
      titulo: 'Cogiendo el ritmo', desc: '10 días de estudio en total.' },
    { id: 'dias-50',   grupo: 'Constancia', icono: 'calendario', m: 'dias', objetivo: 50,
      titulo: 'Medio centenar',    desc: '50 días de estudio acumulados.' },
    { id: 'dias-150',  grupo: 'Constancia', icono: 'calendario', m: 'dias', objetivo: 150,
      titulo: 'Incansable',        desc: '150 días de estudio. Toda una vida de coro.' },

    { id: 'canc-1',    grupo: 'Repertorio', icono: 'nota', m: 'canciones', objetivo: 1,
      titulo: 'Empieza el repertorio', desc: 'Has estudiado tu primera canción.' },
    { id: 'canc-5',    grupo: 'Repertorio', icono: 'nota', m: 'canciones', objetivo: 5,
      titulo: 'Cinco canciones',       desc: 'Cinco canciones distintas trabajadas.' },
    { id: 'canc-15',   grupo: 'Repertorio', icono: 'nota', m: 'canciones', objetivo: 15,
      titulo: 'Repertorio de concierto', desc: '15 canciones distintas. Ya es un programa.' },

    { id: 'apr-1',     grupo: 'Aprendidas', icono: 'estrella', m: 'aprendidas', objetivo: 1,
      titulo: 'La primera aprendida', desc: 'Marcaste tu primera canción como aprendida.' },
    { id: 'apr-5',     grupo: 'Aprendidas', icono: 'estrella', m: 'aprendidas', objetivo: 5,
      titulo: 'Cinco en el bolsillo',  desc: '5 canciones aprendidas del todo.' },
    { id: 'apr-12',    grupo: 'Aprendidas', icono: 'estrella', m: 'aprendidas', objetivo: 12,
      titulo: 'Te las sabes todas',    desc: '12 canciones aprendidas.' },

    { id: 'grab-1',    grupo: 'Tu voz', icono: 'micro', m: 'grabaciones', objetivo: 1,
      titulo: 'Primer ensayo grabado', desc: 'Te grabaste cantando por primera vez.' },
    { id: 'grab-10',   grupo: 'Tu voz', icono: 'micro', m: 'grabaciones', objetivo: 10,
      titulo: 'Diez tomas',            desc: '10 grabaciones tuyas guardadas.' },
    { id: 'grab-30',   grupo: 'Tu voz', icono: 'micro', m: 'grabaciones', objetivo: 30,
      titulo: 'Tu propio archivo',     desc: '30 grabaciones. Escúchate crecer.' },

    { id: 'troz-5',    grupo: 'Detalle', icono: 'estrella', m: 'trozos', objetivo: 5,
      titulo: 'Al detalle',   desc: 'Marcaste 5 trozos difíciles para repasarlos.' },
    { id: 'troz-20',   grupo: 'Detalle', icono: 'estrella', m: 'trozos', objetivo: 20,
      titulo: 'Nada se te escapa', desc: '20 trozos difíciles marcados.' },
  ];

  function _construye(l, m) {
    var valor = m[l.m] || 0;
    return {
      id: l.id, grupo: l.grupo, icono: l.icono, titulo: l.titulo, desc: l.desc,
      objetivo: l.objetivo, m: l.m, valor: valor,
      hecho: valor >= l.objetivo,
      progreso: Math.max(0, Math.min(1, valor / l.objetivo)),
    };
  }

  function listar() {
    var dt = datos();
    var m = metricas(dt);
    var guardados = _hechosGuardados() || [];
    return CATALOGO.map(function (l) {
      var o = _construye(l, m);
      // Una vez conseguido, se queda conseguido aunque el número baje
      // (p. ej. si borra grabaciones). Nunca se "pierde" un logro.
      if (guardados.indexOf(l.id) !== -1) {
        o.hecho = true;
        o.progreso = 1;
        o.persistido = o.valor < o.objetivo; // lo tiene, aunque ahora no cuadre el número
      }
      return o;
    });
  }

  function resumen() {
    var l = listar();
    var hechos = l.filter(function (x) { return x.hecho; }).length;
    var pendientes = l.filter(function (x) { return !x.hecho; })
      .sort(function (a, b) { return b.progreso - a.progreso; });
    return { hechos: hechos, total: l.length, siguiente: pendientes[0] || null };
  }

  /* --- El "cómo lo conseguiste" ----------------------------- */
  function detalle(l) {
    var dt = datos();
    var v = l.valor, obj = l.objetivo, hecho = l.hecho;

    // Lo consiguió en su día y ahora los números ya no cuadran (borró
    // grabaciones, canciones…). El logro es suyo igualmente.
    if (l.persistido) {
      return 'Lo conseguiste en su momento y es tuyo para siempre. ' +
             'Ahora mismo vas por ' + v + ' de ' + obj + '.';
    }

    if (l.m === 'racha') {
      var r = dt.rango;
      if (!r || !r.dias) return 'Todavía no has encadenado varios días de estudio.';
      if (hecho) return 'Tu racha más larga fue ' + rango(r.ini, r.fin) + ' — ' + r.dias + ' días sin fallar uno.';
      return 'Tu mejor racha hasta ahora fue ' + rango(r.ini, r.fin) + ' (' + r.dias + ' días). Te faltan ' + (obj - v) + '.';
    }

    if (l.m === 'dias') {
      var d = dt.diasOrden;
      if (!d.length) return 'Aún no hay ningún día de estudio registrado.';
      if (hecho) {
        return 'Llegaste a los ' + obj + ' días el ' + fecha(d[obj - 1]) +
               '. Empezaste el ' + fecha(d[0]) + '.';
      }
      return 'Llevas ' + v + (v === 1 ? ' día' : ' días') + ' de estudio desde el ' + fecha(d[0]) +
             '. Te faltan ' + (obj - v) + '.';
    }

    if (l.m === 'canciones') {
      var nombres = dt.canciones.map(function (c) { return c.titulo; });
      if (!nombres.length) return 'Aún no has estudiado ninguna canción.';
      var muestra = nombres.slice(0, 6);
      var cola = nombres.length > muestra.length ? '…' : '.';
      return (hecho ? 'Con ' : 'Por ahora llevas ' + v + ': ') + lista(muestra) + cola;
    }

    if (l.m === 'aprendidas') {
      if (!dt.aprendidas.length) return 'Aún no has marcado ninguna canción como aprendida.';
      var muestraA = dt.aprendidas.slice(0, 6);
      var colaA = dt.aprendidas.length > muestraA.length ? '…' : '.';
      return (hecho ? 'Ya te sabes: ' : 'Llevas ' + v + ': ') + lista(muestraA) + colaA;
    }

    if (l.m === 'grabaciones') {
      var g = dt.grabaciones;
      if (!g.length) return 'Aún no te has grabado cantando.';
      var ult = g[0], pri = g[g.length - 1];
      if (hecho) {
        return v + ' grabaciones. La primera, «' + pri.titulo + '» el ' + fecha(_isoDeTs(pri.creado)) +
               '; la última, «' + ult.titulo + '» el ' + fecha(_isoDeTs(ult.creado)) + '.';
      }
      return 'Llevas ' + v + (v === 1 ? ' grabación' : ' grabaciones') +
             '. La última: «' + ult.titulo + '».';
    }

    if (l.m === 'trozos') {
      var t = dt.trozos;
      if (!t.length) return 'Aún no has marcado ningún trozo difícil.';
      var songs = [];
      t.forEach(function (x) { if (songs.indexOf(x.titulo) === -1) songs.push(x.titulo); });
      var muestraT = songs.slice(0, 5);
      var colaT = songs.length > muestraT.length ? '…' : '.';
      return (hecho ? 'Marcaste ' : 'Llevas ') + v + ' trozos en ' + lista(muestraT) + colaT;
    }

    return l.desc;
  }

  /* --- Aviso estilo Steam al conseguir uno nuevo ------------ */
  function revisarNuevos() {
    if (!window.Almacen) return;

    // Logros que se cumplen AHORA por los datos actuales.
    var m = metricas(datos());
    var ganados = CATALOGO
      .filter(function (l) { return (m[l.m] || 0) >= l.objetivo; })
      .map(function (l) { return l.id; });

    var guardados = _hechosGuardados();
    if (guardados === null) {               // primera vez: sembrar en silencio
      window.Almacen.guardar(CLAVE_HECHOS, ganados);
      return;
    }

    var nuevos = ganados.filter(function (id) { return guardados.indexOf(id) === -1; });
    if (!nuevos.length) {
      // Nada nuevo, pero asegura que la clave nueva existe (migración).
      window.Almacen.guardar(CLAVE_HECHOS, guardados);
      return;
    }
    // Se AÑADEN; nunca se quita ninguno.
    window.Almacen.guardar(CLAVE_HECHOS, guardados.concat(nuevos));

    // Fecha en que caen (para el resumen mensual).
    var fechas = _fechas();
    var ahora = Date.now();
    nuevos.forEach(function (id) { if (!fechas[id]) fechas[id] = ahora; });
    window.Almacen.guardar(CLAVE_FECHAS, fechas);

    var lista = listar();
    nuevos.forEach(function (id, i) {
      var l = lista.filter(function (x) { return x.id === id; })[0];
      if (l) setTimeout(function () { _toast(l, i); }, i * 1100);
    });
  }

  /* --- Sonidito de celebración (Web Audio, sin archivos) -----
     Arpegio ascendente cálido tipo carillón, a juego con tono.js.
     El primero de una tanda suena entero; los siguientes, un tin. */
  var _ac = null;
  function _audio() {
    try {
      if (!_ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        _ac = new AC();
      }
      if (_ac.state === 'suspended') { _ac.resume(); }
      return _ac;
    } catch (e) { return null; }
  }

  function _campanada(ac, hz, cuando, dur, vol) {
    var t0 = ac.currentTime + cuando;
    var g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    g.gain.setTargetAtTime(0.0001, t0 + 0.05, dur * 0.4);
    g.connect(ac.destination);
    [
      { tipo: 'triangle', mul: 1, vol: 0.9 },
      { tipo: 'sine', mul: 2.01, vol: 0.22 },
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

  function _sonido(indice) {
    var ac = _audio();
    if (!ac) return;
    if (indice > 0) {
      _campanada(ac, 1046.5, 0, 0.5, 0.13);   // Do6, un toque discreto
      return;
    }
    // Do5 · Mi5 · Sol5 · Do6 — arpegio de mayor, alegre y breve.
    [523.25, 659.25, 783.99, 1046.5].forEach(function (hz, i) {
      _campanada(ac, hz, i * 0.085, i === 3 ? 0.9 : 0.4, i === 3 ? 0.17 : 0.13);
    });
  }

  var _pila = null;
  function _contenedor() {
    if (!_pila || !document.body.contains(_pila)) {
      _pila = document.createElement('div');
      _pila.className = 'logro-toasts';
      _pila.setAttribute('role', 'status');
      _pila.setAttribute('aria-live', 'polite');
      document.body.appendChild(_pila);
    }
    return _pila;
  }

  var TROFEO_MINI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M7 4h10v4a5 5 0 0 1-10 0zM5 6H4a3 3 0 0 0 3 3M19 6h1a3 3 0 0 1-3 3M9 20h6M12 15v5"/></svg>';

  function _toast(l, indice) {
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'logro-toast';
    el.innerHTML =
      '<span class="logro-toast__glow" aria-hidden="true"></span>' +
      '<span class="logro-toast__medalla">' + icono(l.icono) + '</span>' +
      '<span class="logro-toast__txt">' +
        '<span class="logro-toast__eyebrow">' + TROFEO_MINI + 'Logro conseguido</span>' +
        '<span class="logro-toast__titulo"></span>' +
      '</span>' +
      '<span class="logro-toast__sweep" aria-hidden="true"></span>' +
      '<span class="logro-toast__tiempo" aria-hidden="true"></span>';
    el.querySelector('.logro-toast__titulo').textContent = l.titulo;
    _contenedor().appendChild(el);

    void el.offsetWidth;
    el.classList.add('is-visible');
    try { _sonido(indice || 0); } catch (e) {}
    // El primero de la tanda vibra como celebración; los siguientes, un toque.
    try {
      if (window.Vibra) (indice ? window.Vibra.toque : window.Vibra.logro)();
    } catch (e) {}

    var cerrado = false;
    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      clearTimeout(t);
      el.style.pointerEvents = 'none';
      var quita = function () { if (el.parentNode) el.parentNode.removeChild(el); };
      if (reduce) {
        el.style.transition = 'opacity 140ms linear';
        el.style.opacity = '0';
        setTimeout(quita, 170);
        return;
      }
      el.classList.remove('is-visible');
      el.classList.add('is-saliendo');
      // Colapsa el hueco (altura + separación) para que la pila se cierre
      // con suavidad mientras la tarjeta se desliza fuera.
      el.style.height = el.offsetHeight + 'px';
      el.style.overflow = 'hidden';
      void el.offsetWidth;
      el.style.transition =
        'height 320ms var(--curva) 160ms, margin 320ms var(--curva) 160ms, padding 320ms var(--curva) 160ms';
      el.style.height = '0px';
      el.style.paddingTop = '0px';
      el.style.paddingBottom = '0px';
      el.style.marginTop = '-10px';
      el.addEventListener('animationend', quita, { once: true });
      setTimeout(quita, 700);
    }

    var t = setTimeout(cerrar, 5200);
    el.addEventListener('click', function () {
      cerrar();
      // Llevar a ESE logro dentro de la pestaña Práctica.
      var yaEnPractica = !!document.querySelector('[data-modulo="practice"]');
      if (window.App && window.App.ir) {
        window.App.ir('practica', { datos: { logroId: l.id } });
      }
      // Si ya estábamos en Práctica, ir() no recarga: enfocamos a mano.
      if (yaEnPractica && window.Pagina_practice && window.Pagina_practice.enfocarLogro) {
        window.Pagina_practice.enfocarLogro(l.id);
      }
    });
  }

  return {
    listar: listar,
    resumen: resumen,
    detalle: detalle,
    revisarNuevos: revisarNuevos,
    fechaDe: fechaDe,
    icono: icono,
  };
})();
