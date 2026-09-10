/* ============================================================
   memoletra.js — Test de memoria de la letra (window.MemoLetra).

   Un juego tranquilo para saber si Maite ya se sabe una canción de
   memoria: se ocultan al azar unos cuantos versos de la letra y ella
   va destapándolos uno a uno diciendo si se los sabía o no.

   El texto que se practica lo decide quien llama (`texto`): es la vista
   de la letra que Maite tenga abierta en el Modo estudio — la original,
   "cómo suena" o la traducción. `fuente` ('orig' | 'fon' | 'trad') solo
   ajusta los textos de ayuda y la clave del récord.

   Cuatro dificultades (cuántos versos se tapan):
     Fácil ~20 %   ·   Medio ~40 %   ·   Difícil ~70 %   ·   Todos 100 %
   La elegida se recuerda en Almacen ('memoletra:dif').

   Al final da una nota amable ("te sabías 7 de 10 versos"), guarda el
   mejor resultado (por canción y dificultad), lo registra en la bitácora
   del día y, si hay conexión, pide a la IA un comentario de "la profe"
   con lo que ha ido bien y en qué centrarse.

   Uso desde el Modo estudio:
     window.MemoLetra.abrir({
       titulo, texto, cancionId, sesionId, marcaId, fuente
     });
   `fuente` es solo para el texto de ayuda: 'fon' | 'orig'.

   Script clásico: expone window.MemoLetra. Depende de window.Almacen
   y, si están, de window.Diario / window.Vibra / window.UI / window.IA.
   ============================================================ */

window.MemoLetra = (function () {
  'use strict';

  var hoja = null;              // overlay abierto (o null)
  var ctx = null;               // { titulo, texto, cancionId, ... }
  var versos = [];              // [{ idx, texto, oculto, resuelto, acierto }]  (solo líneas con contenido)
  var lineas = [];              // todas las líneas del texto (incluye vacías) para pintar con su forma
  var total = 0;                // nº de versos ocultos en esta ronda
  var resueltos = 0;

  // Dificultad = qué proporción de versos se tapan. `min` es un suelo para
  // letras cortas; `sinSeguidos` intenta no tapar dos versos de fila (así
  // siempre queda una pista al lado); en Difícil/Todos ya no tiene sentido.
  var DIFS = {
    facil: { etq: 'Fácil', prop: 0.20, min: 2, sinSeguidos: true },
    medio: { etq: 'Medio', prop: 0.40, min: 3, sinSeguidos: true },
    dificil: { etq: 'Difícil', prop: 0.70, min: 4, sinSeguidos: false },
    extremo: { etq: 'Todos', prop: 1, min: 1, sinSeguidos: false },
  };
  var ORDEN_DIF = ['facil', 'medio', 'dificil', 'extremo'];
  var dif = 'medio';

  function reducido() {
    try {
      return window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ---------- Elegir qué versos ocultar ----------
     Según la dificultad: una proporción de los versos, con un suelo para
     letras cortas y (en Fácil/Medio) evitando dos versos seguidos. */
  function elegirOcultos(n) {
    var cfg = DIFS[dif] || DIFS.medio;

    // "Todos": se tapa la letra entera.
    if (cfg.prop >= 1) {
      var todos = [];
      for (var x = 0; x < n; x++) todos.push(x);
      return todos;
    }

    var cuantos = Math.max(cfg.min, Math.round(n * cfg.prop));
    cuantos = Math.min(cuantos, n - 1);   // deja siempre ≥1 verso de pista
    if (cuantos < 1) cuantos = 1;

    var orden = [];
    for (var i = 0; i < n; i++) orden.push(i);
    // Barajado Fisher–Yates.
    for (var j = n - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var t = orden[j]; orden[j] = orden[k]; orden[k] = t;
    }

    var elegidos = [];
    // Primera pasada: sin dos seguidos (solo si la dificultad lo pide).
    if (cfg.sinSeguidos) {
      for (var p = 0; p < orden.length && elegidos.length < cuantos; p++) {
        var c = orden[p];
        if (elegidos.indexOf(c - 1) === -1 && elegidos.indexOf(c + 1) === -1) {
          elegidos.push(c);
        }
      }
    }
    // Segunda pasada: rellena hasta el número buscado con cualquiera.
    for (var q = 0; q < orden.length && elegidos.length < cuantos; q++) {
      if (elegidos.indexOf(orden[q]) === -1) elegidos.push(orden[q]);
    }
    return elegidos;
  }

  function prepararRonda() {
    var ocultos = elegirOcultos(versos.length);
    versos.forEach(function (v, i) {
      v.oculto = ocultos.indexOf(i) !== -1;
      v.resuelto = false;
      v.acierto = false;
    });
    total = ocultos.length;
    resueltos = 0;
  }

  /* ---------- Mejor resultado guardado (por canción, vista y dificultad) ---------- */
  function claveBest() {
    return 'memoletra:best:' + (ctx.cancionId || ctx.marcaId || ctx.titulo || 'x') +
      ':' + ctx.fuente + ':' + dif;
  }
  function leerBest() {
    var b = window.Almacen.leer(claveBest(), null);
    return (b && typeof b === 'object') ? b : null;
  }
  function guardarBest(aciertos) {
    var ratio = total ? aciertos / total : 0;
    var b = leerBest();
    if (!b || ratio > (b.ratio || 0)) {
      window.Almacen.guardar(claveBest(), {
        aciertos: aciertos, total: total, ratio: ratio, fecha: Date.now(),
      });
      return true;   // récord nuevo
    }
    return false;
  }

  /* ---------- Abrir ---------- */
  function abrir(datos) {
    datos = datos || {};
    var texto = String(datos.texto || '').replace(/\r\n?/g, '\n');
    lineas = texto.split('\n');
    versos = [];
    lineas.forEach(function (ln, idx) {
      if (ln.trim()) versos.push({ idx: idx, texto: ln.trim(), oculto: false, resuelto: false, acierto: false });
    });
    if (versos.length < 4) {
      if (window.UI) window.UI.aviso('Para este juego hace falta una letra un poco más larga.');
      return;
    }

    ctx = {
      titulo: datos.titulo || 'esta canción',
      cancionId: datos.cancionId || null,
      sesionId: datos.sesionId || null,
      marcaId: datos.marcaId || null,
      fuente: datos.fuente || 'orig',
    };
    dif = window.Almacen.leer('memoletra:dif', 'medio');
    if (!DIFS[dif]) dif = 'medio';
    prepararRonda();
    cerrar();   // por si acaso
    pintar();
  }

  function pintar() {
    hoja = document.createElement('div');
    hoja.className = 'hoja hoja--memoletra';
    var deQue = ctx.fuente === 'fon' ? ' de <em>cómo suena</em>'
      : ctx.fuente === 'trad' ? ' de <em>la traducción</em>' : '';
    var ayuda = 'Se han tapado algunos versos' + deQue +
      '. Míralos, intenta recordar cómo van y tócalos para comprobarlo.';

    hoja.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Memoria de la letra">' +
      '<div class="memoletra__cabe">' +
      '<div class="hoja__asa"></div>' +
      '<h2 class="hoja__titulo">Memoria de la letra</h2>' +
      '<p class="memoletra__sub">«' + escapar(ctx.titulo) + '»</p>' +
      '<div class="memoletra__difs" role="group" aria-label="Dificultad" data-mm-difs></div>' +
      '<div class="memoletra__barra" aria-hidden="true"><span data-mm-relleno></span></div>' +
      '<p class="memoletra__prog" data-mm-prog></p>' +
      '</div>' +
      '<p class="memoletra__ayuda" data-mm-ayuda>' + ayuda + '</p>' +
      '<div class="memoletra__letra" data-mm-letra></div>' +
      '<div class="memoletra__fin" data-mm-fin hidden></div>' +
      '<div class="hoja__acciones">' +
      '<button type="button" class="btn btn--texto" data-cerrar>Cerrar</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(hoja);

    Array.prototype.forEach.call(hoja.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrar);
    });
    document.addEventListener('keydown', escCerrar);

    montarDifs();
    pintarLetra();
    actualizarProgreso();

    void hoja.offsetHeight;
    hoja.classList.add('is-abierta');
  }

  // Selector de dificultad. Al cambiar, se recuenta y se baraja de nuevo.
  function montarDifs() {
    var cja = hoja.querySelector('[data-mm-difs]');
    cja.innerHTML = '';
    ORDEN_DIF.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-dif', k);
      b.textContent = DIFS[k].etq;
      if (k === dif) b.className = 'is-activo';
      b.addEventListener('click', function () {
        if (k === dif) return;
        dif = k;
        window.Almacen.guardar('memoletra:dif', dif);
        Array.prototype.forEach.call(cja.children, function (x) {
          x.classList.toggle('is-activo', x.getAttribute('data-dif') === dif);
        });
        otraRonda();
      });
      cja.appendChild(b);
    });
  }

  function pintarLetra() {
    var caja = hoja.querySelector('[data-mm-letra]');
    caja.innerHTML = '';
    var vi = 0;   // índice dentro de `versos`

    lineas.forEach(function (ln) {
      if (!ln.trim()) {
        var sep = document.createElement('div');
        sep.className = 'memoletra__sep';
        caja.appendChild(sep);
        return;
      }
      var v = versos[vi++];
      if (!v.oculto) {
        var p = document.createElement('div');
        p.className = 'memoletra__verso memoletra__verso--pista';
        p.textContent = v.texto;
        caja.appendChild(p);
        return;
      }
      caja.appendChild(construirHueco(v));
    });
  }

  function construirHueco(v) {
    var fila = document.createElement('div');
    fila.className = 'memoletra__verso memoletra__verso--hueco';

    if (v.resuelto) {
      fila.classList.add(v.acierto ? 'is-bien' : 'is-mal');
      fila.innerHTML =
        '<span class="memoletra__revelado">' + escapar(v.texto) + '</span>' +
        '<span class="memoletra__sello">' + (v.acierto ? '✓' : '·') + '</span>';
      return fila;
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'memoletra__tapa';
    // Rayita del ancho aproximado del verso, sin desvelar la letra.
    var n = Math.max(6, Math.min(34, v.texto.replace(/\s+/g, ' ').length));
    btn.textContent = new Array(n + 1).join('▁');
    btn.setAttribute('aria-label', 'Verso tapado. Tócalo para verlo.');
    btn.addEventListener('click', function () { revelar(v, fila); });
    fila.appendChild(btn);
    return fila;
  }

  function revelar(v, fila) {
    if (v.resuelto) return;
    fila.classList.add('is-revelando');
    fila.innerHTML =
      '<span class="memoletra__revelado' + (reducido() ? '' : ' is-entrando') + '">' +
      escapar(v.texto) + '</span>' +
      '<div class="memoletra__juicio">' +
      '<button type="button" class="memoletra__jbtn memoletra__jbtn--si" data-si>Me lo sabía</button>' +
      '<button type="button" class="memoletra__jbtn memoletra__jbtn--no" data-no>No me salía</button>' +
      '</div>';
    fila.querySelector('[data-si]').addEventListener('click', function () { juzgar(v, fila, true); });
    fila.querySelector('[data-no]').addEventListener('click', function () { juzgar(v, fila, false); });
  }

  function juzgar(v, fila, acierto) {
    if (v.resuelto) return;
    v.resuelto = true;
    v.acierto = acierto;
    resueltos++;
    if (window.Vibra) { acierto ? window.Vibra.toque() : window.Vibra.fallo(); }

    var nueva = construirHueco(v);
    fila.parentNode.replaceChild(nueva, fila);

    actualizarProgreso();
    if (resueltos >= total) setTimeout(terminar, 350);
  }

  function actualizarProgreso() {
    if (!hoja) return;
    var pct = total ? Math.round((resueltos / total) * 100) : 0;
    var rel = hoja.querySelector('[data-mm-relleno]');
    if (rel) rel.style.width = pct + '%';
    var prog = hoja.querySelector('[data-mm-prog]');
    if (prog) prog.textContent = resueltos + ' de ' + total + ' versos';
  }

  function mensajeNota(ratio) {
    if (ratio >= 1) return '¡Perfecta! Te la sabes entera de memoria 🎶';
    if (ratio >= 0.8) return 'Casi entera. Un par de repasos y es tuya.';
    if (ratio >= 0.5) return 'Buen camino. Los versos que fallaste, a repasarlos.';
    if (ratio > 0) return 'Todavía se resiste. Escúchala otra vez y vuelve a probar.';
    return 'Hoy no salía. Sin prisa: mañana un poco más.';
  }

  function terminar() {
    if (!hoja) return;
    var aciertos = versos.reduce(function (n, v) { return n + (v.oculto && v.acierto ? 1 : 0); }, 0);
    var ratio = total ? aciertos / total : 0;

    var record = guardarBest(aciertos);
    var best = leerBest();

    // Bitácora del día.
    if (window.Diario) {
      window.Diario.registrar('memoria', {
        cancionId: ctx.cancionId, sesionId: ctx.sesionId, marcaId: ctx.marcaId,
        titulo: ctx.titulo,
        extra: { aciertos: aciertos, total: total, dificultad: dif, fuente: ctx.fuente },
      });
    }
    if (ratio >= 0.8 && window.Vibra) window.Vibra.logro();

    var fin = hoja.querySelector('[data-mm-fin]');
    // El récord es de esta canción, esta vista de la letra y esta dificultad
    // (ver claveBest). Lo dejamos claro en la frase para que no se confunda
    // el "cómo suena" con la letra original.
    var etqDif = (DIFS[dif] || DIFS.medio).etq;
    var etqFuente = ctx.fuente === 'fon' ? ' de cómo suena'
      : ctx.fuente === 'trad' ? ' de la traducción' : '';
    var linBest = '';
    if (best && !record) {
      linBest = '<p class="memoletra__best">Tu mejor' + etqFuente + ' en ' + etqDif + ': ' +
        best.aciertos + ' de ' + best.total + ' versos.</p>';
    } else if (record) {
      linBest = '<p class="memoletra__best memoletra__best--record">¡Nuevo récord tuyo' +
        etqFuente + ' en ' + etqDif + '! 🌟</p>';
    }

    fin.innerHTML =
      '<div class="memoletra__nota">' +
      '<span class="memoletra__cifra">' + aciertos + ' / ' + total + '</span>' +
      '<span class="memoletra__cifra-txt">versos de memoria</span>' +
      '</div>' +
      '<p class="memoletra__frase">' + escapar(mensajeNota(ratio)) + '</p>' +
      linBest +
      '<div class="memoletra__fin-acc">' +
      '<button type="button" class="btn btn--primario" data-otra>Otra vez</button>' +
      '</div>';
    fin.hidden = false;

    hoja.querySelector('[data-mm-ayuda]').hidden = true;
    hoja.querySelector('[data-mm-letra]').classList.add('is-hecho');
    fin.querySelector('[data-otra]').addEventListener('click', otraRonda);

    pedirComentarioProfe(fin, aciertos);

    try { fin.scrollIntoView({ block: 'center', behavior: reducido() ? 'auto' : 'smooth' }); } catch (e) { }
  }

  /* ---------- Comentario de "la profe" (IA) ----------
     Una llamada al Worker con qué versos supo y cuáles no. Es un extra:
     si no hay IA, tarda demasiado, falla o devuelve algo que no tiene
     pinta de comentario (p. ej. el Worker aún sin la tarea 'comentario'),
     la cajita desaparece sin ruido. */
  var PROFE_TIMEOUT_MS = 12000;

  // ¿La respuesta parece de verdad un comentario y no un eco de lo que
  // hemos mandado? (El Worker viejo trata 'comentario' como fonética y
  // nos devuelve nuestro propio bloque troceado en sílabas.)
  function pareceComentario(txt) {
    if (!txt || txt.trim().length < 12) return false;
    var t = txt.toLowerCase();
    var pistasEco = ['se sabía estos', 'se le resistieron', 'se-sa-bí', 'ver-sos', 'canción:', 'kan-sión', 'a-cer-ta'];
    for (var i = 0; i < pistasEco.length; i++) {
      if (t.indexOf(pistasEco[i]) !== -1) return false;
    }
    return true;
  }

  function pedirComentarioProfe(fin, aciertos) {
    if (!window.IA || !window.IA.comentario || !total) return;

    var acc = fin.querySelector('.memoletra__fin-acc');
    var caja = document.createElement('p');
    caja.className = 'memoletra__profe is-cargando';
    caja.textContent = 'La profe está mirando cómo te ha ido…';
    fin.insertBefore(caja, acc);

    var sabidos = versos.filter(function (v) { return v.oculto && v.acierto; })
      .map(function (v) { return '- ' + v.texto; });
    var fallados = versos.filter(function (v) { return v.oculto && !v.acierto; })
      .map(function (v) { return '- ' + v.texto; });

    var bloque =
      'Canción: ' + ctx.titulo + '\n' +
      (ctx.fuente === 'fon' ? 'Memoriza la letra escrita tal como suena (no es una falta de ortografía).\n' :
        ctx.fuente === 'trad' ? 'Memoriza la traducción al español.\n' : '') +
      'Acertados: ' + aciertos + ' de ' + total + '\n\n' +
      'Se sabía estos versos:\n' + (sabidos.length ? sabidos.join('\n') : '(ninguno)') + '\n\n' +
      'Se le resistieron estos:\n' + (fallados.length ? fallados.join('\n') : '(ninguno)');

    var quita = function () { if (caja.parentNode) caja.parentNode.removeChild(caja); };
    var caducado = false;
    var reloj = setTimeout(function () { caducado = true; quita(); }, PROFE_TIMEOUT_MS);

    window.IA.comentario(bloque).then(function (txt) {
      clearTimeout(reloj);
      if (caducado || !caja.parentNode) return;
      if (!pareceComentario(txt)) { quita(); return; }
      caja.classList.remove('is-cargando');
      caja.textContent = txt.trim();
    }).catch(function () {
      clearTimeout(reloj);
      quita();
    });
  }

  function otraRonda() {
    prepararRonda();
    var fin = hoja.querySelector('[data-mm-fin]');
    fin.hidden = true; fin.innerHTML = '';
    hoja.querySelector('[data-mm-ayuda]').hidden = false;
    var letra = hoja.querySelector('[data-mm-letra]');
    letra.classList.remove('is-hecho');
    pintarLetra();
    actualizarProgreso();
    try { hoja.querySelector('.hoja__panel').scrollTo({ top: 0, behavior: reducido() ? 'auto' : 'smooth' }); } catch (e) { }
  }

  function escCerrar(e) { if (e.key === 'Escape') cerrar(); }

  function cerrar() {
    document.removeEventListener('keydown', escCerrar);
    var h = hoja;
    hoja = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 360);
  }

  return { abrir: abrir };
})();
