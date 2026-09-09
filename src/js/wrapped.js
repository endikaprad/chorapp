/* ============================================================
   wrapped.js — El resumen del mes, estilo "Spotify Wrapped".

   Es LA forma de ver el resumen del mes: pantalla completa, barras de
   progreso arriba (como las historias), se avanza tocando o deslizando
   y cada slide suelta un dato — muchos, cosas que Maite no sabía que la
   app estaba contando.

   Mientras pasa suena música de fondo propia del Wrapped, generada al
   vuelo y distinta para cada mes (ver wrapped-music.js / wrapped-audio.js).
   Cuando un slide habla de una canción suya, esa canción suena unos
   segundos por encima; al cambiar de slide vuelve la música de fondo.

   El 31 de diciembre hay un Wrapped ANUAL con el recap de todo el año
   (datos.esAnual = true): más slides, tono cálido y fondo especial.

   Datos: window.ResumenMes.datosDe(anio, mes) / .datosAnuales(anio).

   window.Wrapped.abrir(datos)   -> lanza la experiencia
   window.Wrapped.cerrar()       -> la cierra (la llama el router al navegar)
   window.Wrapped.activo()       -> true si está en pantalla
   ============================================================ */

window.Wrapped = (function () {
  'use strict';

  var DUR_SLIDE = 7000;        // ms por slide antes de saltar sola
  var DUR_SLIDE_ANUAL = 8500;
  var EXTRA_CANCION = 3500;    // los slides con canción de Maite duran un poco más

  var raiz = null;
  var slides = [];      // <section> del DOM
  var meta = [];        // { cancion?, dur, quiz?, revela? } paralelo a slides
  var respuestas = {};  // idQuiz -> { elegida, acierto, skip? }
  var fotosUrls = [];   // object URLs de fotos de recuerdo, a revocar al cerrar
  var datosActuales = null;  // el objeto datos del Wrapped en curso
  var posterBlob = null;     // PNG de la foto resumen (se genera al llegar al cierre)
  var posterUrl = null;
  var idx = 0;
  var timer = null;
  var t0 = 0;
  var restante = DUR_SLIDE;
  var pausado = false;
  var esAnual = false;

  function reducido() {
    return window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function capitaliza(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, uno, varios) { return n === 1 ? uno : varios; }
  function elegir(a) { return a[Math.floor(Math.random() * a.length)]; }

  function fmtMin(seg) {
    var m = Math.round((seg || 0) / 60);
    if (m <= 0) return 'menos de un minuto';
    if (m < 60) return m + ' ' + plural(m, 'minuto', 'minutos');
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }

  var MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function fmtFecha(iso) {
    var p = String(iso || '').split('-');
    if (p.length < 3) return '';
    return (+p[2]) + ' de ' + (MESES_NOMBRE[+p[1] - 1] || '');
  }

  // Bloque de cifra grande con cuenta ascendente (la anima mostrar()).
  function cifra(n, label) {
    return '<p class="w-cifra"><span class="w-cifra__n" data-num="' + n + '">0</span>' +
      (label ? '<span class="w-cifra__de">' + esc(label) + '</span>' : '') + '</p>';
  }

  // Cuenta 0 -> fin en ~900ms (easeOut). Sin animación si prefers-reduced-motion.
  function contarHasta(el, fin) {
    fin = Number(fin) || 0;
    if (reducido() || fin <= 0) { el.textContent = String(fin); return; }
    var dur = fin > 60 ? 1100 : 850;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    function paso(now) {
      var ahora = (window.performance && performance.now) ? performance.now() : Date.now();
      var k = Math.min(1, (ahora - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(fin * e));
      if (k < 1) requestAnimationFrame(paso);
      else el.textContent = String(fin);
    }
    requestAnimationFrame(paso);
  }

  /* ============================================================
     Slides del resumen MENSUAL
     ============================================================ */
  function slidesMes(d) {
    var out = [];
    var mes = capitaliza(d.nombreMes);

    out.push({ clase: 'w-slide--portada', html:
      '<p class="w-eyebrow">Tu resumen de</p>' +
      '<h2 class="w-titular w-titular--mes">' + esc(mes) + '</h2>' +
      '<p class="w-pie">Toca para ir viéndolo →</p>'
    });

    out.push(slideTeaser({
      eyebrow: 'A ver qué tal',
      texto: 'Todo lo que hiciste en ' + mes + ', slide a slide.',
      sub: 'Sin trampa ni cartón. La app lo apuntó todo.',
    }));

    var pct = Math.round((d.dias / d.diasDelMes) * 100);
    out.push({ clase: 'w-slide--dato', html:
      '<p class="w-eyebrow">Días de estudio</p>' +
      cifra(d.dias, 'de ' + d.diasDelMes) +
      '<p class="w-frase">Estudiaste el <strong>' + pct + '%</strong> de ' + esc(mes) + '.</p>' +
      '<p class="w-nota">' + (pct >= 80
        ? 'Casi el mes entero. En el coro no van a saber qué hacer contigo.'
        : pct >= 45
          ? 'Más de la mitad del mes con la app abierta. Nada mal, Ama.'
          : 'Hay margen de sobra para el mes que viene. Mucho.') + '</p>'
    });

    if (d.rachaMaxMes >= 2) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Sin faltar un día</p>' +
        cifra(d.rachaMaxMes, 'días seguidos') +
        '<p class="w-frase">Tu mejor racha del mes.</p>' +
        '<p class="w-nota">' + (d.rachaMaxMes >= 7
          ? 'Una semana entera. Eso ya es vicio del bueno.'
          : 'A ver si el mes que viene la superas.') + '</p>'
      });
    }

    if (d.canciones >= 1) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Repertorio</p>' +
        cifra(d.canciones, plural(d.canciones, 'canción', 'canciones')) +
        '<p class="w-frase">Pasaste por <strong>' + d.canciones + ' ' +
        plural(d.canciones, 'canción distinta', 'canciones distintas') + '</strong>.</p>' +
        '<p class="w-nota">' + (d.canciones >= 5
          ? 'Un mes movidito. El coro entero cabe en tu móvil.'
          : 'Poquitas, pero bien trabajadas. Eso espero.') + '</p>'
      });
    }

    if (d.diaSemana) out.push(slideDia(d.diaSemana, false));

    if (d.cancionTop) {
      var conJuego = hayQuiz(d.topEstudiadas, d.cancionTop);
      if (conJuego) {
        out.push(slideQuiz('est-mes', 'Un juego', '¿Cuál crees que estudiaste más este mes?',
          quizOpciones(d.topEstudiadas, d.cancionTop.titulo)));
      }
      out.push({
        clase: 'w-slide--dato w-slide--cancion', cancion: d.cancionTop.titulo,
        revela: conJuego ? 'est-mes' : null,
        html:
          (conJuego ? '<p class="w-reaccion" data-reaccion></p>' : '') +
          '<p class="w-eyebrow">La que no te dejaba en paz</p>' +
          '<h3 class="w-cancion">' + esc(d.cancionTop.titulo) + '</h3>' +
          '<p class="w-frase">La abriste <strong>' + d.cancionTop.veces +
          ' días</strong> distintos. Más que ninguna otra.</p>' +
          '<p class="w-nota">O te encanta, o te tenía frita. Tú sabrás.</p>'
      });
    }

    if (d.topEscuchadas && d.topEscuchadas.length >= 2) {
      out.push(slideTops('Las que más sonaron', d.topEscuchadas, 'veces al play',
        'Tus favoritas del mes, por número de veces que le diste al play.'));
    }

    if (d.escuchas >= 3) {
      var alDia = Math.max(1, Math.round(d.escuchas / Math.max(1, d.dias)));
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Al play</p>' +
        cifra(d.escuchas, plural(d.escuchas, 'vez', 'veces')) +
        '<p class="w-frase">Unas <strong>' + alDia + '</strong> cada día que estudiaste.</p>' +
        '<p class="w-nota">Sí, la app las cuenta todas. Hasta las de las 11 de la noche.</p>'
      });
    }

    if (d.grabaciones && d.grabaciones.n) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Te grabaste cantando</p>' +
        cifra(d.grabaciones.n, plural(d.grabaciones.n, 'grabación', 'grabaciones')) +
        '<p class="w-frase">Son <strong>' + fmtMin(d.grabaciones.seg) +
        '</strong> de ti misma, guardados.</p>' +
        '<p class="w-nota">Escucharte cuesta, ya lo sé. Por eso mejoras.</p>'
      });
    }

    if (d.trozos) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Trozos marcados como difíciles</p>' +
        cifra(d.trozos) +
        '<p class="w-frase">' + d.trozos + ' ' + plural(d.trozos, 'trozo', 'trozos') +
        ' para machacar aparte.</p>' +
        '<p class="w-nota">Reconocer el problema es medio arreglo. La otra media es repetirlo.</p>'
      });
    }

    if (d.aprendidas && d.aprendidas.length) {
      out.push(slideAprendidas(d.aprendidas, 'Canción aprendida', 'Canciones aprendidas',
        'De pendiente a que te la sabes. Eso no lo borra nadie.'));
    }

    if (d.logros && d.logros.length) {
      out.push(slideTeaser({
        eyebrow: 'Casi lo dejamos',
        texto: d.logros.length === 1 ? '¿Y la medalla que te llevas este mes?' : '¿Cuántas medallas te has ganado este mes?',
        sub: 'Piensa un número. Ahora pasa de slide.',
      }));
      out.push(slideLogros(d.logros, 'Logro del mes', 'Logros del mes',
        'Medallas que te has ganado tú solita, sin que nadie mire.'));
    }

    out.push(slideCierre(d, {
      eyebrow: esc(mes) + ', en una frase',
      pie: 'Nos vemos el mes que viene, Ama 🎶',
    }));

    return out;
  }

  /* ---------- slide de presentación (sin números, para dar aire) ---------- */
  function slideTeaser(o) {
    return { clase: 'w-slide--teaser', html:
      (o.eyebrow ? '<p class="w-eyebrow">' + esc(o.eyebrow) + '</p>' : '') +
      '<p class="w-teaser">' + esc(o.texto) + '</p>' +
      (o.sub ? '<p class="w-nota">' + esc(o.sub) + '</p>' : '')
    };
  }

  /* ---------- slide de cierre + foto resumen para compartir ---------- */
  function slideCierre(d, o) {
    return {
      clase: 'w-slide--cierre' + (d.esAnual ? ' w-slide--cierre-anual' : ''),
      cierre: true,
      html:
        '<p class="w-eyebrow">' + esc(o.eyebrow) + '</p>' +
        '<p class="w-cierre">' + esc(d.frase) + '</p>' +
        '<div class="w-poster" data-poster>' +
          '<div class="w-poster__cargando">Preparando tu foto resumen…</div>' +
        '</div>' +
        '<div class="w-cierre__botones">' +
          '<button type="button" class="w-btn w-btn--ghost" data-descargar>Guardar</button>' +
          '<button type="button" class="w-btn" data-compartir>Compartir</button>' +
        '</div>' +
        '<button type="button" class="w-cerrar-link" data-cerrar>Cerrar</button>' +
        '<p class="w-creditos">Música: Scott Buckley · scottbuckley.com.au · CC-BY 4.0</p>'
    };
  }

  /* ============================================================
     Slides del resumen ANUAL (31 de diciembre) — tono cálido
     ============================================================ */
  function slidesAnual(d) {
    var out = [];

    out.push({ clase: 'w-slide--portada w-slide--portada-anual', html:
      '<p class="w-eyebrow">Un año entero cantando</p>' +
      '<h2 class="w-titular w-titular--mes">' + d.anio + '</h2>' +
      '<p class="w-sub">Tu año en Bihotsak</p>' +
      '<p class="w-pie">Ponte cómoda. Toca para empezar →</p>'
    });

    out.push(slideTeaser({
      eyebrow: 'Doce meses',
      texto: 'Todo un año de coro, guardado aquí dentro.',
      sub: 'Respira. Esto va con calma.',
    }));

    var pct = Math.round((d.dias / d.diasDelAnio) * 100);
    out.push({ clase: 'w-slide--dato', html:
      '<p class="w-eyebrow">Días con música</p>' +
      cifra(d.dias, 'días este año') +
      '<p class="w-frase">Cantaste <strong>' + pct + '%</strong> de los días del año.</p>' +
      '<p class="w-nota">Un año no se llena de música solo. Lo llenaste tú.</p>'
    });

    if (d.mesTop) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Tu mejor mes</p>' +
        '<h3 class="w-cancion">' + esc(capitaliza(d.mesTop.nombre)) + '</h3>' +
        '<p class="w-frase"><strong>' + d.mesTop.dias + ' días</strong> de estudio. El más constante de los doce.</p>' +
        '<p class="w-nota">Cada año tiene un mes así. Este fue el tuyo.</p>'
      });
    }

    if (d.rachaMaxAno >= 3) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Sin faltar un solo día</p>' +
        cifra(d.rachaMaxAno, 'días seguidos') +
        '<p class="w-frase">Tu racha más larga del año.</p>' +
        '<p class="w-nota">Constancia de las que no se ven pero se notan.</p>'
      });
    }

    if (d.canciones >= 1) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Repertorio del año</p>' +
        cifra(d.canciones, plural(d.canciones, 'canción', 'canciones')) +
        '<p class="w-frase">Todas las que pasaron por tus manos en doce meses.</p>'
      });
    }

    if (d.diaSemana) out.push(slideDia(d.diaSemana, true));

    var juegoAnual = hayQuiz(d.topEstudiadas, d.cancionTop);
    if (juegoAnual) {
      out.push(slideTeaser({
        eyebrow: 'Antes de nada',
        texto: 'De todo el año, ¿cuál dirías que fue tu canción?',
        sub: 'La que abriste más días. Piénsalo y pasa de slide.',
      }));
      out.push(slideQuiz('est-ano', 'Un juego', '¿Cuál fue la canción de tu año?',
        quizOpciones(d.topEstudiadas, d.cancionTop.titulo)));
    }

    if (d.cancionTop) {
      out.push({
        clase: 'w-slide--dato w-slide--cancion', cancion: d.cancionTop.titulo,
        revela: juegoAnual ? 'est-ano' : null,
        html:
          (juegoAnual ? '<p class="w-reaccion" data-reaccion></p>' : '') +
          '<p class="w-eyebrow">La canción de tu año</p>' +
          '<h3 class="w-cancion">' + esc(d.cancionTop.titulo) + '</h3>' +
          '<p class="w-frase"><strong>' + d.cancionTop.dias + ' días</strong> con ella. Ninguna otra se le acercó.</p>' +
          '<p class="w-nota">La escucharás dentro de años y te acordarás de este año.</p>'
      });
    }

    if (d.topEstudiadas && d.topEstudiadas.length >= 3) {
      out.push(slideTops('Tu top del año', d.topEstudiadas.slice(0, 5), 'días abiertas',
        'Las que más volviste a abrir, un día tras otro.'));
    }

    if (d.topEscuchadas && d.topEscuchadas.length >= 2) {
      out.push(slideTops('Las que más sonaron', d.topEscuchadas.slice(0, 5), 'veces al play',
        'Las que no te cansabas de escuchar.'));
    }

    if (d.aprendidas && d.aprendidas.length) {
      out.push(slideAprendidas(d.aprendidas, 'Canción aprendida este año', 'Canciones aprendidas este año',
        'Empezaron el año en pendiente. Míralas ahora.'));
    }

    if (d.conciertos) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Encima del escenario</p>' +
        cifra(d.conciertos, plural(d.conciertos, 'concierto', 'conciertos')) +
        '<p class="w-frase">Veces que te subiste a cantar de verdad, delante de gente.</p>' +
        '<p class="w-nota">Los nervios de antes y el gusto de después. Todo el año.</p>'
      });
    }

    if (d.recuerdos && d.recuerdos.length) {
      out.push({ clase: 'w-slide--celebra', html:
        '<p class="w-eyebrow">Los que no se olvidan</p>' +
        cifra(d.recuerdos.length, plural(d.recuerdos.length, 'recuerdo', 'recuerdos')) +
        '<p class="w-frase">Conciertos con foto y nota, guardados este año.</p>' +
        '<p class="w-nota">Van pasando…</p>'
      });
      d.recuerdos.slice(0, 4).forEach(function (r) { out.push(slideRecuerdo(r)); });
    }

    if (d.grabaciones && d.grabaciones.n) {
      out.push({ clase: 'w-slide--dato', html:
        '<p class="w-eyebrow">Un año de tu voz</p>' +
        cifra(d.grabaciones.n, plural(d.grabaciones.n, 'grabación', 'grabaciones')) +
        '<p class="w-frase"><strong>' + fmtMin(d.grabaciones.seg) + '</strong> cantando, guardados para siempre.</p>'
      });
    }

    if (d.logros && d.logros.length) {
      out.push(slideLogros(d.logros, 'Logro del año', 'Logros del año',
        'Todo lo que fuiste consiguiendo, mes a mes.'));
    }

    out.push(slideCierre(d, {
      eyebrow: d.anio + ', en una frase',
      pie: 'Feliz año, Ama. Nos vemos en el siguiente 🎶',
    }));

    return out;
  }

  /* ---------- slides compartidos ---------- */
  function slideAprendidas(aprendidas, tit1, titN, nota) {
    var top = aprendidas.slice(0, 4);
    var resto = aprendidas.length - top.length;
    var lista = top.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    if (resto > 0) lista += '<li class="w-aprend__mas">y ' + resto + ' más</li>';
    return {
      clase: 'w-slide--celebra',
      cancion: aprendidas[0],
      html:
        '<div class="w-check" aria-hidden="true">' +
          '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 15-16"/></svg>' +
        '</div>' +
        '<p class="w-eyebrow">' + esc(plural(aprendidas.length, tit1, titN)) + '</p>' +
        cifra(aprendidas.length) +
        '<ul class="w-aprend">' + lista + '</ul>' +
        '<p class="w-nota">' + esc(nota) + '</p>'
    };
  }

  // Slide de recuerdo de concierto (foto grande + fecha + nota). r viene de
  // datosAnuales().recuerdos. La foto la carga mostrar()/abrir() de forma async.
  function slideRecuerdo(r) {
    return {
      clase: 'w-slide--recuerdo',
      foto: r.tieneFoto ? r.fotoClave : null,
      html:
        '<div class="w-recuerdo">' +
          (r.tieneFoto
            ? '<div class="w-recuerdo__foto" data-foto="' + esc(r.fotoClave) + '"></div>'
            : '<div class="w-recuerdo__foto w-recuerdo__foto--vacia"></div>') +
          '<div class="w-recuerdo__txt">' +
            '<p class="w-eyebrow">Un recuerdo · ' + esc(fmtFecha(r.fecha)) + '</p>' +
            '<h3 class="w-recuerdo__lugar">' + esc(r.titulo) + '</h3>' +
            (r.nota ? '<p class="w-recuerdo__nota">' + esc(r.nota) + '</p>' : '') +
          '</div>' +
        '</div>'
    };
  }

  // Slide de "top" (ranking de canciones). items = [{titulo, veces}].
  function slideTops(eyebrow, items, unidad, nota) {
    var filas = items.map(function (it, i) {
      return '<li><span class="w-tops__pos">' + (i + 1) + '</span>' +
        '<span class="w-tops__tit">' + esc(it.titulo) + '</span>' +
        '<span class="w-tops__n">' + it.veces + '</span></li>';
    }).join('');
    return {
      clase: 'w-slide--dato w-slide--tops',
      cancion: items[0] && items[0].titulo,
      html:
        '<p class="w-eyebrow">' + esc(eyebrow) + '</p>' +
        '<ol class="w-tops">' + filas + '</ol>' +
        (unidad ? '<p class="w-tops__pie">' + esc(unidad) + '</p>' : '') +
        (nota ? '<p class="w-nota">' + esc(nota) + '</p>' : '')
    };
  }

  /* ---------- Mini-juego: adivina ---------- */
  // Baraja las 3 primeras de `top` y localiza la que coincide con `correctaTitulo`.
  function quizOpciones(top, correctaTitulo) {
    var ops = top.slice(0, 3).map(function (x) { return x.titulo; });
    for (var i = ops.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = ops[i]; ops[i] = ops[j]; ops[j] = t;
    }
    return { opciones: ops, correcta: ops.indexOf(correctaTitulo) };
  }
  // ¿Hay material para un quiz? (top-3 real + una ganadora clara)
  function hayQuiz(top, ganadora) {
    return !!(ganadora && top && top.length >= 3 && top[0].titulo === ganadora.titulo);
  }

  function slideQuiz(id, eyebrow, pregunta, q) {
    var botones = q.opciones.map(function (t, i) {
      return '<button type="button" class="w-quiz__op" data-op="' + i + '">' + esc(t) + '</button>';
    }).join('');
    return {
      clase: 'w-slide--quiz',
      quiz: { id: id, correcta: q.correcta },
      html:
        '<p class="w-eyebrow">' + esc(eyebrow) + '</p>' +
        '<h3 class="w-quiz__preg">' + esc(pregunta) + '</h3>' +
        '<div class="w-quiz__ops">' + botones + '</div>' +
        '<p class="w-quiz__pista" data-quiz-pista>Toca tu respuesta</p>'
    };
  }

  // Frase de reacción según lo que respondió Maite en el quiz `id`.
  function reaccionDe(id) {
    var r = respuestas[id];
    if (!r) return null;
    if (r.skip) return { txt: 'Te lo saltaste, ¿eh?', ok: false };
    if (r.acierto) {
      return { txt: elegir(['¡Lo sabías! 🎯', '¡Clavado! La conocías.', 'Acertaste sin pestañear.']), ok: true };
    }
    return { txt: elegir(['Oh, vaya… no era esa.', 'Frío, frío. No era esa.', 'Ni de lejos, Ama.']), ok: false };
  }

  // Slide del día de la semana favorito. dia = { nombre:'los martes', veces }.
  function slideDia(dia, anual) {
    var corto = capitaliza(String(dia.nombre).replace(/^los\s+/, ''));
    return { clase: 'w-slide--dato', html:
      '<p class="w-eyebrow">Tu día de cantar</p>' +
      '<h3 class="w-cancion">' + esc(corto) + '</h3>' +
      '<p class="w-frase">Es cuando más te pones: <strong>' + dia.veces + ' ' +
      (anual ? 'días este año' : plural(dia.veces, 'día', 'días')) + '</strong>.</p>' +
      '<p class="w-nota">' + (anual
        ? 'Cada semana tenía su ritual. El tuyo empezaba ' + esc(dia.nombre) + '.'
        : 'La rutina te funciona. No la sueltes.') + '</p>'
    };
  }

  function slideLogros(logros, tit1, titN, nota) {
    var medallas = '', nombres = '';
    if (window.Logros && window.Logros.icono) {
      medallas = logros.map(function (l) {
        return '<span class="w-medalla" title="' + esc(l.titulo) + '">' + window.Logros.icono(l.icono) + '</span>';
      }).join('');
    }
    nombres = logros.map(function (l) { return l.titulo; }).slice(0, 3).join(' · ');
    return {
      clase: 'w-slide--celebra',
      html:
        '<p class="w-eyebrow">' + esc(plural(logros.length, tit1, titN)) + '</p>' +
        (medallas ? '<div class="w-medallas">' + medallas + '</div>' : '') +
        '<p class="w-frase">' + esc(nombres) + '</p>' +
        '<p class="w-nota">' + esc(nota) + '</p>'
    };
  }

  /* ============================================================
     Pintado y navegación
     ============================================================ */
  function abrir(d) {
    if (!d || !d.hayAlgo) return;
    cerrar();

    esAnual = !!d.esAnual;
    datosActuales = d;
    var datos = esAnual ? slidesAnual(d) : slidesMes(d);
    idx = 0;
    respuestas = {};

    var durBase = esAnual ? DUR_SLIDE_ANUAL : DUR_SLIDE;
    meta = datos.map(function (s) {
      return {
        cancion: s.cancion || null,
        quiz: s.quiz || null,
        revela: s.revela || null,
        foto: s.foto || null,
        cierre: !!s.cierre,
        dur: durBase + (s.cancion ? EXTRA_CANCION : 0) + (s.foto ? EXTRA_CANCION : 0),
      };
    });

    raiz = document.createElement('div');
    raiz.className = 'wrapped' + (esAnual ? ' wrapped--anual' : '') +
      (reducido() ? ' wrapped--sin-motion' : '');
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'true');
    raiz.setAttribute('aria-label', esAnual ? 'Resumen del año' : 'Resumen del mes');

    var barras = datos.map(function (_, i) {
      return '<span class="w-barra"><i data-barra="' + i + '"></i></span>';
    }).join('');

    var mudo = window.WrappedAudio && window.WrappedAudio.silenciado &&
               window.WrappedAudio.silenciado();

    raiz.innerHTML =
      '<div class="w-fondo" aria-hidden="true">' +
        '<span class="w-blob w-blob--1"></span>' +
        '<span class="w-blob w-blob--2"></span>' +
        '<span class="w-blob w-blob--3"></span>' +
      '</div>' +
      '<div class="w-top">' +
        '<button type="button" class="w-mute' + (mudo ? ' is-mute' : '') + '" data-mute aria-label="Sonido">' +
          '<svg class="w-mute__on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM16 9a3 3 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10"/></svg>' +
          '<svg class="w-mute__off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9zM22 9l-6 6M16 9l6 6"/></svg>' +
        '</button>' +
        '<div class="w-progreso">' + barras + '</div>' +
        '<button type="button" class="w-x" data-cerrar aria-label="Cerrar">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="w-slides"></div>' +
      '<button type="button" class="w-zona w-zona--prev" data-nav="prev" aria-label="Anterior"></button>' +
      '<button type="button" class="w-zona w-zona--next" data-nav="next" aria-label="Siguiente"></button>' +
      '<div class="w-pasos">' +
        '<button type="button" class="w-paso" data-nav="prev">‹ Atrás</button>' +
        '<button type="button" class="w-paso w-paso--next" data-nav="next">Siguiente ›</button>' +
      '</div>';

    var cont = raiz.querySelector('.w-slides');
    slides = datos.map(function (s) {
      var el = document.createElement('section');
      el.className = 'w-slide ' + (s.clase || '');
      el.innerHTML = '<div class="w-slide__in">' + s.html + '</div>';
      el.hidden = true;
      cont.appendChild(el);
      return el;
    });

    document.body.appendChild(raiz);
    document.body.classList.add('wrapped-abierto');

    cargarFotos();

    raiz.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    raiz.addEventListener('pointerdown', onHoldStart);
    raiz.addEventListener('pointerup', onHoldEnd);
    raiz.addEventListener('pointercancel', onHoldEnd);
    raiz.addEventListener('touchstart', onTouchStart, { passive: true });
    raiz.addEventListener('touchend', onTouchEnd, { passive: true });

    var vista = document.getElementById('vista');
    if (vista && window.MutationObserver) {
      var obs = new MutationObserver(function () { cerrar(); obs.disconnect(); });
      obs.observe(vista, { childList: true });
    }

    // Música de fondo del Wrapped (generada; ver wrapped-music.js).
    if (window.WrappedAudio) {
      try { window.WrappedAudio.iniciar(esAnual ? 'anual' : d.mes); } catch (e) {}
    }

    void raiz.offsetHeight;
    raiz.classList.add('is-abierta');
    mostrar(0);
  }

  function mostrar(n) {
    if (!slides.length) return;
    n = Math.max(0, Math.min(slides.length - 1, n));

    slides.forEach(function (el, i) {
      var era = !el.hidden;
      el.hidden = i !== n;
      if (i === n && !era) {
        el.classList.remove('w-slide--entra');
        void el.offsetHeight;
        el.classList.add('w-slide--entra');
      }
    });

    Array.prototype.forEach.call(raiz.querySelectorAll('[data-barra]'), function (b, i) {
      b.style.transition = 'none';
      b.style.transform = i < n ? 'scaleX(1)' : 'scaleX(0)';
    });

    idx = n;

    var mt = meta[n] || {};

    // ¿Este slide revela un quiz ya respondido? Rellena la reacción.
    if (mt.revela) {
      var r = reaccionDe(mt.revela);
      var elR = slides[n].querySelector('[data-reaccion]');
      if (elR) {
        elR.textContent = r ? r.txt : '';
        elR.classList.toggle('is-mal', !!r && !r.ok);
        elR.classList.toggle('is-bien', !!r && r.ok);
        elR.hidden = !r;
      }
    }

    // Modo quiz / cierre: el toque no salta de slide (hay que poder tocar
    // los botones de dentro).
    var enQuiz = !!(mt.quiz && !respuestas[mt.quiz.id]);
    raiz.classList.toggle('w-quiz-activo', enQuiz);
    raiz.classList.toggle('w-cierre-activo', !!mt.cierre);

    // Cuenta ascendente de la cifra grande (una sola vez por slide).
    var num = slides[n].querySelector('.w-cifra__n[data-num]');
    if (num && !num._contado) {
      num._contado = true;
      contarHasta(num, num.getAttribute('data-num'));
    }

    // Slide de cierre: prepara la foto resumen para compartir y remata
    // el resumen con una pequeña celebración háptica.
    if (mt.cierre) {
      prepararPoster(slides[n]);
      if (!slides[n]._vibrado) {
        slides[n]._vibrado = true;
        try { if (window.Vibra) window.Vibra.logro(); } catch (e) {}
      }
    }

    sonarSlide(n);
    arrancarTimer();

    var ultima = n === slides.length - 1;
    raiz.querySelector('.w-paso--next').textContent = ultima ? 'Cerrar' : 'Siguiente ›';
  }

  /* ---------- Foto resumen (se genera al llegar al cierre) ---------- */
  function prepararPoster(slideEl) {
    var cont = slideEl && slideEl.querySelector('[data-poster]');
    if (!cont || cont._hecho) return;
    cont._hecho = true;
    if (!window.CompartirWrapped || !datosActuales) { cont.hidden = true; return; }

    window.CompartirWrapped.generar(datosActuales).then(function (r) {
      if (!raiz || !r || !r.imagen) { cont.hidden = true; return; }
      posterBlob = r.imagen;
      posterUrl = URL.createObjectURL(r.imagen);
      cont.innerHTML = '<img class="w-poster__img" alt="Tu resumen en imagen" src="' + posterUrl + '">';
      var bot = raiz.querySelector('.w-cierre__botones');
      if (bot) bot.classList.add('is-listo');
    }).catch(function () { cont.hidden = true; });
  }

  function nombrePoster() {
    if (!datosActuales) return 'chorapp.png';
    return datosActuales.esAnual
      ? 'chorapp-' + datosActuales.anio + '.png'
      : 'chorapp-' + (datosActuales.nombreMes || 'resumen') + '.png';
  }
  function textoPoster() {
    if (!datosActuales) return 'Mi resumen en ChorApp';
    return datosActuales.esAnual
      ? 'Mi ' + datosActuales.anio + ' en el coro, según ChorApp 🎶'
      : 'Mi ' + (datosActuales.nombreMes || 'mes') + ' en ChorApp 🎶';
  }

  function accionPoster(compartir) {
    if (!posterBlob || !window.Compartir) return;
    var fn = compartir ? window.Compartir.enviar : window.Compartir.descargar;
    var bot = raiz && raiz.querySelector('.w-cierre__botones');
    if (bot) bot.classList.add('is-trabajando');
    fn({ blob: posterBlob, nombre: nombrePoster(), texto: textoPoster(),
         titulo: 'Mi resumen en ChorApp', dialogTitle: 'Compartir tu resumen' })
      .catch(function () {})
      .then(function () { if (bot) bot.classList.remove('is-trabajando'); });
  }

  // Carga (async) las fotos de los slides de recuerdo de concierto.
  function cargarFotos() {
    if (!raiz || !window.Archivos) return;
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-foto]'), function (el) {
      var clave = el.getAttribute('data-foto');
      window.Archivos.url(clave).then(function (u) {
        if (!u || !raiz || !raiz.contains(el)) { if (u) window.Archivos.liberar(u); return; }
        fotosUrls.push(u);
        el.style.backgroundImage = 'url("' + u + '")';
        el.classList.add('is-cargada');
      }).catch(function () {});
    });
  }

  // Música del slide: la canción de Maite si la menciona, si no la de fondo.
  function sonarSlide(n) {
    if (!window.WrappedAudio) return;
    var m = meta[n] || {};
    if (m.cancion) {
      window.WrappedAudio.pista(m.cancion);
    } else {
      window.WrappedAudio.estandar();
    }
  }

  function arrancarTimer() {
    pararTimer();
    var b = raiz && raiz.querySelector('[data-barra="' + idx + '"]');
    var dur = (meta[idx] && meta[idx].dur) || DUR_SLIDE;
    var quizPendiente = meta[idx] && meta[idx].quiz && !respuestas[meta[idx].quiz.id];
    var enCierre = meta[idx] && meta[idx].cierre;
    if (reducido() || quizPendiente || enCierre) {
      if (b) b.style.transform = quizPendiente ? 'scaleX(0)' : 'scaleX(1)';
      return;
    }
    restante = dur;
    t0 = Date.now();
    if (b) {
      void b.offsetHeight;
      b.style.transition = 'transform ' + restante + 'ms linear';
      b.style.transform = 'scaleX(1)';
    }
    timer = setTimeout(siguiente, restante);
  }
  function pararTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  function pausar() {
    if (pausado || reducido() || !timer) return;
    pausado = true;
    pararTimer();
    restante -= (Date.now() - t0);
    var b = raiz.querySelector('[data-barra="' + idx + '"]');
    if (b) {
      var w = getComputedStyle(b).transform;
      b.style.transition = 'none';
      b.style.transform = (w === 'none') ? 'scaleX(0)' : w;
    }
  }
  function reanudar() {
    if (!pausado) return;
    pausado = false;
    t0 = Date.now();
    var b = raiz.querySelector('[data-barra="' + idx + '"]');
    if (b) {
      void b.offsetHeight;
      b.style.transition = 'transform ' + Math.max(0, restante) + 'ms linear';
      b.style.transform = 'scaleX(1)';
    }
    timer = setTimeout(siguiente, Math.max(0, restante));
  }

  function siguiente() {
    // Si sale de un quiz sin responder, cuenta como "te lo saltaste".
    var mq = meta[idx] && meta[idx].quiz;
    if (mq && !respuestas[mq.id]) respuestas[mq.id] = { elegida: -1, acierto: false, skip: true };
    if (idx >= slides.length - 1) { cerrar(); return; }
    mostrar(idx + 1);
  }

  function responderQuiz(boton) {
    var q = meta[idx] && meta[idx].quiz;
    if (!q) return;
    var prev = respuestas[q.id];
    if (prev && !prev.skip) return;   // ya contestó de verdad; un "skip" sí se puede rectificar
    var elegida = +boton.getAttribute('data-op');
    var acierto = elegida === q.correcta;
    respuestas[q.id] = { elegida: elegida, acierto: acierto };

    var ops = slides[idx].querySelectorAll('.w-quiz__op');
    Array.prototype.forEach.call(ops, function (b, i) {
      b.disabled = true;
      if (i === q.correcta) b.classList.add('is-bien');
      else if (i === elegida) b.classList.add('is-mal');
    });
    var pista = slides[idx].querySelector('[data-quiz-pista]');
    if (pista) pista.textContent = acierto ? '¡Bien!' : 'Casi…';

    // Un golpe de vibración: distinto si acierta o si falla.
    try { if (window.Vibra) (acierto ? window.Vibra.acierto : window.Vibra.fallo)(); } catch (e) {}

    raiz.classList.remove('w-quiz-activo');
    var b = raiz.querySelector('[data-barra="' + idx + '"]');
    if (b && !reducido()) {
      b.style.transition = 'transform 1400ms linear';
      b.style.transform = 'scaleX(1)';
    }
    setTimeout(function () {
      if (meta[idx] && meta[idx].quiz === q) siguiente();   // seguimos en el quiz: avanza a la revelación
    }, 1500);
  }
  function anterior() {
    if (idx <= 0) { arrancarTimer(); return; }
    mostrar(idx - 1);
  }

  /* ---------- interacción ---------- */
  function onClick(e) {
    if (e.target.closest('[data-cerrar]')) { cerrar(); return; }
    if (e.target.closest('[data-mute]')) {
      var b = e.target.closest('[data-mute]');
      var mudo = window.WrappedAudio ? window.WrappedAudio.alternarSilencio() : true;
      b.classList.toggle('is-mute', mudo);
      return;
    }
    var op = e.target.closest('.w-quiz__op');
    if (op) { responderQuiz(op); return; }
    if (e.target.closest('[data-descargar]')) { accionPoster(false); return; }
    if (e.target.closest('[data-compartir]')) { accionPoster(true); return; }
    var nav = e.target.closest('[data-nav]');
    if (nav) { nav.getAttribute('data-nav') === 'prev' ? anterior() : siguiente(); }
  }
  function onKey(e) {
    if (e.key === 'Escape') cerrar();
    else if (e.key === 'ArrowRight') { if (!raiz.classList.contains('w-quiz-activo')) siguiente(); }
    else if (e.key === 'ArrowLeft') anterior();
  }

  var holdT = null;
  function onHoldStart(e) {
    if (window.WrappedAudio) window.WrappedAudio.desbloquear();
    if (e.target.closest('.w-paso') || e.target.closest('.w-x') ||
        e.target.closest('.w-mute') || e.target.closest('.w-quiz__op') ||
        e.target.closest('.w-cierre__botones') || e.target.closest('.w-cerrar-link') ||
        e.target.closest('.w-poster')) return;
    holdT = setTimeout(pausar, 220);
  }
  function onHoldEnd() {
    if (holdT) { clearTimeout(holdT); holdT = null; }
    reanudar();
  }

  var tx = 0, ty = 0;
  function onTouchStart(e) {
    if (!e.touches[0]) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }
  function onTouchEnd(e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    var dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) { cerrar(); return; }
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      if (dx > 0) { anterior(); return; }
      // hacia delante: bloqueado en el quiz (espera respuesta) y en el cierre
      if (!raiz.classList.contains('w-quiz-activo') &&
          !raiz.classList.contains('w-cierre-activo')) siguiente();
    }
  }

  /* ---------- cierre ---------- */
  function cerrar() {
    pararTimer();
    pausado = false;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('wrapped-abierto');
    if (window.WrappedAudio) { try { window.WrappedAudio.parar(); } catch (e) {} }
    fotosUrls.forEach(function (u) { try { window.Archivos.liberar(u); } catch (e) {} });
    fotosUrls = [];
    if (posterUrl) { try { URL.revokeObjectURL(posterUrl); } catch (e) {} posterUrl = null; }
    posterBlob = null;
    datosActuales = null;
    var r = raiz;
    raiz = null; slides = []; meta = [];
    if (!r) return;
    r.classList.remove('is-abierta');
    var quita = function () { if (r.parentNode) r.parentNode.removeChild(r); };
    r.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  function activo() { return !!raiz; }

  return { abrir: abrir, cerrar: cerrar, activo: activo };
})();
