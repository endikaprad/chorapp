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

    var ganMes = ganadoraDe(d.topJuego, d.cancionTop);
    if (ganMes) {
      var conJuego = hayQuiz(d.topJuego, d.cancionTop);
      var vecesMes = d.cancionTop ? d.cancionTop.veces : buscaVeces(d.topJuego, ganMes);
      if (conJuego) {
        out.push(slideTeaser({
          eyebrow: 'Un juego', clase: 'w-slide--pregunta',
          texto: '¿Cuál crees que estudiaste más este mes?',
          sub: 'Piénsalo. En el siguiente slide lo eliges.',
        }));
        out.push(slideQuiz('est-mes', 'Adivina', '¿Cuál estudiaste más este mes?',
          quizOpciones(d.topJuego, ganMes)));
      }
      out.push({
        clase: 'w-slide--dato w-slide--cancion', cancion: ganMes,
        revela: conJuego ? 'est-mes' : null,
        html:
          (conJuego ? '<p class="w-reaccion" data-reaccion></p>' : '') +
          '<p class="w-eyebrow">La que no te dejaba en paz</p>' +
          '<h3 class="w-cancion">' + esc(ganMes) + '</h3>' +
          equalizer() +
          '<p class="w-frase">La abriste <strong>' + vecesMes +
          ' días</strong> distintos. Más que ninguna otra.</p>' +
          '<p class="w-nota">O te encanta, o te tenía frita. Tú sabrás.</p>'
      });
    }

    var ordenMes = slideOrden('orden-mes', d.topEscuchadas,
      '¿En qué orden crees que sonaron?', 'Ponlas de más a menos veces al play.');
    if (ordenMes) { out.push(ordenMes.teaser); out.push(ordenMes.slide); }

    if (d.topEscuchadas && d.topEscuchadas.length >= 2) {
      out.push(slideTops('Las que más sonaron', d.topEscuchadas, 'veces al play',
        ordenMes ? 'El orden real. A ver qué tal el ojo.' :
        'Tus favoritas del mes, por número de veces que le diste al play.',
        ordenMes ? 'orden-mes' : null));
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

    var sensaMes = slideSensaciones(d.sensaciones, false);
    if (sensaMes) out.push(sensaMes);

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
    return { clase: 'w-slide--teaser ' + (o.clase || ''), html:
      (o.eyebrow ? '<p class="w-eyebrow">' + esc(o.eyebrow) + '</p>' : '') +
      '<p class="w-teaser">' + esc(o.texto) + '</p>' +
      (o.sub ? '<p class="w-nota">' + esc(o.sub) + '</p>' : '')
    };
  }

  // Barras de ecualizador (puro CSS) para los slides de canción.
  function equalizer() {
    var b = '';
    for (var i = 0; i < 7; i++) b += '<span></span>';
    return '<div class="w-eq" aria-hidden="true">' + b + '</div>';
  }

  // Veces/días de un título dentro de una lista [{titulo, veces}].
  function buscaVeces(lista, titulo) {
    for (var i = 0; i < (lista || []).length; i++) {
      if (lista[i].titulo === titulo) return lista[i].veces;
    }
    return 0;
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
        '<button type="button" class="w-cerrar-link" data-cerrar>Cerrar</button>'
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

    var ganAno = ganadoraDe(d.topJuego, d.cancionTop);
    var juegoAnual = hayQuiz(d.topJuego, d.cancionTop);
    if (juegoAnual) {
      out.push(slideTeaser({
        eyebrow: 'Antes de nada', clase: 'w-slide--pregunta',
        texto: 'De todo el año, ¿cuál dirías que fue tu canción?',
        sub: 'La que abriste más días. Piénsalo y pasa de slide.',
      }));
      out.push(slideQuiz('est-ano', 'Adivina', '¿Cuál fue la canción de tu año?',
        quizOpciones(d.topJuego, ganAno)));
    }

    if (ganAno) {
      var diasAno = d.cancionTop ? d.cancionTop.dias : buscaVeces(d.topJuego, ganAno);
      out.push({
        clase: 'w-slide--dato w-slide--cancion', cancion: ganAno,
        revela: juegoAnual ? 'est-ano' : null,
        html:
          (juegoAnual ? '<p class="w-reaccion" data-reaccion></p>' : '') +
          '<p class="w-eyebrow">La canción de tu año</p>' +
          '<h3 class="w-cancion">' + esc(ganAno) + '</h3>' +
          equalizer() +
          '<p class="w-frase"><strong>' + diasAno + ' días</strong> con ella. Ninguna otra se le acercó.</p>' +
          '<p class="w-nota">La escucharás dentro de años y te acordarás de este año.</p>'
      });
    }

    if (d.topEstudiadas && d.topEstudiadas.length >= 3) {
      out.push(slideTops('Tu top del año', d.topEstudiadas.slice(0, 5), 'días abiertas',
        'Las que más volviste a abrir, un día tras otro.'));
    }

    var ordenAno = slideOrden('orden-ano', d.topEscuchadas,
      '¿En qué orden sonaron tus tres favoritas?', 'De más a menos veces al play, en todo el año.');
    if (ordenAno) { out.push(ordenAno.teaser); out.push(ordenAno.slide); }

    if (d.topEscuchadas && d.topEscuchadas.length >= 2) {
      out.push(slideTops('Las que más sonaron', d.topEscuchadas.slice(0, 5), 'veces al play',
        ordenAno ? 'El orden de verdad. ¿Le diste?' : 'Las que no te cansabas de escuchar.',
        ordenAno ? 'orden-ano' : null));
    }

    var vfAno = slideVerdad('vf-ano', d);
    if (vfAno) out.push(vfAno);

    var sensaAno = slideSensaciones(d.sensaciones, true);
    if (sensaAno) out.push(sensaAno);

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
  function slideTops(eyebrow, items, unidad, nota, revela) {
    var filas = items.map(function (it, i) {
      return '<li><span class="w-tops__pos">' + (i + 1) + '</span>' +
        '<span class="w-tops__tit">' + esc(it.titulo) + '</span>' +
        '<span class="w-tops__n">' + it.veces + '</span></li>';
    }).join('');
    return {
      clase: 'w-slide--dato w-slide--tops',
      cancion: items[0] && items[0].titulo,
      revela: revela || null,
      html:
        (revela ? '<p class="w-reaccion" data-reaccion></p>' : '') +
        '<p class="w-eyebrow">' + esc(eyebrow) + '</p>' +
        '<ol class="w-tops">' + filas + '</ol>' +
        (unidad ? '<p class="w-tops__pie">' + esc(unidad) + '</p>' : '') +
        (nota ? '<p class="w-nota">' + esc(nota) + '</p>' : '')
    };
  }

  /* ---------- Mini-juego: ¿verdad o mentira? (solo en el anual) ----------
     Solo con datos que NO tienen su propio slide en el anual (escuchas al
     play y trozos difíciles): no tiene gracia preguntar por algo que la
     app ya le ha enseñado. Cada frase es "más de X": la mitad de las veces
     X está por debajo del valor real (verdad), la otra mitad por encima. */
  function afirmaciones(d) {
    var lista = [];

    function adivina(valor, plantilla, remate) {
      valor = Math.round(valor || 0);
      if (valor < 6) return;
      var verdad = Math.random() < 0.5;
      var x = verdad
        ? Math.max(2, Math.round(valor * (0.45 + Math.random() * 0.2)))
        : Math.round(valor * (1.35 + Math.random() * 0.45)) + 1;
      var real = remate.replace('{v}', valor);
      lista.push({
        txt: plantilla.replace('{x}', x),
        verdad: verdad,
        ok: (verdad ? '¡Sí! ' : 'Pues no. ') + real,
        mal: (verdad ? 'Era verdad. ' : 'Era mentira. ') + real,
      });
    }

    adivina(d.escuchas, 'Le diste al play más de {x} veces este año.', 'Fueron {v}.');
    adivina(d.trozos, 'Marcaste más de {x} trozos difíciles este año.', 'Marcaste {v}.');

    // Provocación: si aprendió algo, negarlo (la revelación lo celebra).
    if (d.aprendidas && d.aprendidas.length >= 2) {
      lista.push({
        txt: 'No te aprendiste ni una canción entera este año.',
        verdad: false,
        ok: 'Mentira, y bien clara: ' + d.aprendidas.length + ' aprendidas.',
        mal: 'Era mentira: ' + d.aprendidas.length + ' aprendidas.',
      });
    }
    return lista;
  }

  function slideVerdad(id, d) {
    var lista = afirmaciones(d);
    if (!lista.length) return null;
    var a = elegir(lista);
    return {
      clase: 'w-slide--quiz w-slide--vf',
      inter: { id: id, correcta: a.verdad ? 'v' : 'm', ok: a.ok, mal: a.mal },
      html:
        '<p class="w-eyebrow">¿Verdad o mentira?</p>' +
        '<h3 class="w-quiz__preg">' + esc(a.txt) + '</h3>' +
        '<div class="w-quiz__ops w-vf__ops">' +
          '<button type="button" class="w-quiz__op w-vf__op" data-vf="v">Verdad</button>' +
          '<button type="button" class="w-quiz__op w-vf__op" data-vf="m">Mentira</button>' +
        '</div>' +
        '<p class="w-quiz__pista" data-quiz-pista>Toca tu respuesta</p>'
    };
  }

  /* ---------- Mini-juego: ordena tu top ----------
     3 canciones desordenadas; Maite las toca en el orden que cree. */
  function slideOrden(id, items, pregunta, sub) {
    if (!items || items.length < 3) return null;
    var real = items.slice(0, 3).map(function (x) { return x.titulo; });
    var mezcla = barajar(real.slice());
    if (mezcla.join('|') === real.join('|')) mezcla.push(mezcla.shift());
    var botones = mezcla.map(function (t) {
      return '<button type="button" class="w-orden__op" data-orden="' + esc(t) + '">' +
        '<span class="w-orden__pos" aria-hidden="true"></span>' +
        '<span class="w-orden__tit">' + esc(t) + '</span></button>';
    }).join('');
    return {
      teaser: slideTeaser({ eyebrow: 'Otro juego', clase: 'w-slide--pregunta',
        texto: pregunta, sub: 'En el siguiente slide las ordenas tú.' }),
      slide: {
        clase: 'w-slide--quiz w-slide--orden',
        inter: { id: id, orden: real },
        html:
          '<p class="w-eyebrow">Ordena tu top</p>' +
          '<h3 class="w-quiz__preg">' + esc(pregunta) + '</h3>' +
          '<div class="w-orden__ops">' + botones + '</div>' +
          '<p class="w-quiz__pista" data-quiz-pista>' + esc(sub) + '</p>'
      }
    };
  }

  /* ---------- Mini-juego: adivina la canción ---------- */
  function barajar(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Coge 3 títulos (incluida siempre la correcta), los baraja y devuelve el
  // índice de la correcta.
  function quizOpciones(top, correctaTitulo) {
    var otras = top.map(function (x) { return x.titulo; })
      .filter(function (t) { return t !== correctaTitulo; });
    var ops = barajar([correctaTitulo].concat(otras.slice(0, 2)));
    if (ops.length < 3) ops = barajar(top.slice(0, 3).map(function (x) { return x.titulo; }));
    return { opciones: ops, correcta: ops.indexOf(correctaTitulo) };
  }

  // Título de la canción "ganadora" (la más estudiada) a partir de un top y,
  // si existe, el cancionTop de los datos. Devuelve null si no hay una clara.
  function ganadoraDe(top, cancionTop) {
    if (cancionTop && cancionTop.titulo) return cancionTop.titulo;
    if (top && top.length >= 2 && top[0].veces > top[1].veces) return top[0].titulo;
    return null;
  }
  // ¿Hay material para el juego de adivinar? (3+ canciones y una ganadora clara)
  function hayQuiz(top, cancionTop) {
    if (!top || top.length < 3) return false;
    return !!ganadoraDe(top, cancionTop);
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
  // El "bloque interactivo" de un slide (quiz de adivinar, o inter de vf/orden).
  function interDe(mt) { return (mt && (mt.quiz || mt.inter)) || null; }
  function esperando(mt) { var q = interDe(mt); return !!(q && !respuestas[q.id]); }

  function reaccionDe(id) {
    var r = respuestas[id];
    if (!r) return null;
    if (r.skip) return { txt: 'Te lo saltaste, ¿eh?', ok: false };
    if (r.reaccion) return r.reaccion;
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

  /* ---------- Diario de sensaciones (emoji tras el ensayo) ---------- */
  var NOTA_SENSA = {
    salio:     'Cuando sale, se nota hasta en el resumen. Bien, Ama.',
    agusto:    'Salir a gusto un día tras otro. Eso es lo que engancha.',
    cansada:   'Cansada casi siempre, y aun así ahí seguías. Con dos.',
    frustrada: 'Meses así los tiene cualquiera. Lo que cuenta es que no lo dejaste.',
  };
  function slideSensaciones(s, anual) {
    if (!s || !s.top || s.n < 3 || !window.Sensaciones) return null;
    var O = window.Sensaciones.opcion;
    var top = O(s.top.id);
    if (!top) return null;
    var fila = s.orden.map(function (x) {
      var o = O(x.id);
      if (!o) return '';
      return '<span class="w-sensa__it' + (x.id === s.top.id ? ' is-top' : '') + '">' +
        '<span class="w-sensa__emoji">' + o.emoji + '</span>' +
        '<span class="w-sensa__n">' + x.n + '</span></span>';
    }).join('');
    return {
      clase: 'w-slide--dato w-slide--sensa',
      html:
        '<p class="w-eyebrow">Cómo te sentiste al salir</p>' +
        '<div class="w-sensa__grande" aria-hidden="true">' + top.emoji + '</div>' +
        '<p class="w-frase">La mayoría de ' + (anual ? 'los días del año' : 'los días') +
        ' saliste <strong>' + esc(top.etq.toLowerCase()) + '</strong>.</p>' +
        '<div class="w-sensa">' + fila + '</div>' +
        '<p class="w-nota">' + esc(NOTA_SENSA[s.top.id] || 'Lo apuntaste tú, toque a toque.') + '</p>'
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
        inter: s.inter || null,
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
        '<div class="w-notas">' +
          '<span>♪</span><span>♫</span><span>♩</span>' +
          '<span>♬</span><span>♪</span><span>♩</span>' +
        '</div>' +
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
    // Variantes de entrada (animación + acento tipográfico) para que no
    // todos los slides "de dato" se sientan iguales. Portada y cierre
    // llevan su propia coreografía y se quedan fuera del reparto.
    var VARIANTES = ['w-var-0', 'w-var-1', 'w-var-2', 'w-var-3'];
    var nVar = 0;
    slides = datos.map(function (s) {
      var el = document.createElement('section');
      var esFijo = /w-slide--(portada|cierre)/.test(s.clase || '');
      var variante = esFijo ? '' : ' ' + VARIANTES[(nVar++) % VARIANTES.length];
      el.className = 'w-slide ' + (s.clase || '') + variante;
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
    var enQuiz = esperando(mt);
    raiz.classList.toggle('w-quiz-activo', enQuiz);
    raiz.classList.toggle('w-cierre-activo', !!mt.cierre);

    // Cuenta ascendente de la cifra grande (una sola vez por slide).
    var num = slides[n].querySelector('.w-cifra__n[data-num]');
    if (num && !num._contado) {
      num._contado = true;
      contarHasta(num, num.getAttribute('data-num'));
    }

    // Slide de recuerdo: revela la foto justo al llegar (no antes).
    if (mt.foto) {
      var elFoto = slides[n].querySelector('[data-foto]');
      if (elFoto) revelarFoto(elFoto);
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

  // Precarga (async) las URLs de las fotos de recuerdo, pero SIN pintarlas
  // ni animarlas: eso lo hace revelarFoto() cuando el slide se muestra de
  // verdad. Si se pintaba aquí, para cuando Maite llegaba al slide la foto
  // ya llevaba rato cargada y la transición de entrada nunca se veía.
  var fotosListas = {}; // clave -> url

  function cargarFotos() {
    if (!raiz || !window.Archivos) return;
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-foto]'), function (el) {
      var clave = el.getAttribute('data-foto');
      window.Archivos.url(clave).then(function (u) {
        if (!u || !raiz) { if (u) window.Archivos.liberar(u); return; }
        fotosUrls.push(u);
        fotosListas[clave] = u;
        // Si para cuando termina de cargar ya está el slide en pantalla
        // (fotos pequeñas, red rápida…), revélala ahora mismo.
        var slideDe = el.closest('.w-slide');
        if (raiz.contains(el) && slideDe && !slideDe.hidden) revelarFoto(el);
      }).catch(function () {});
    });
  }

  // Pinta y anima la foto de un slide de recuerdo la primera vez que se ve.
  function revelarFoto(el) {
    if (!el || el.classList.contains('is-cargada')) return;
    var clave = el.getAttribute('data-foto');
    var u = fotosListas[clave];
    if (!u) return;
    el.style.backgroundImage = 'url("' + u + '")';
    void el.offsetHeight;
    el.classList.add('is-cargada');
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
    var quizPendiente = esperando(meta[idx]);
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
    var mq = interDe(meta[idx]);
    if (mq && !respuestas[mq.id]) respuestas[mq.id] = { elegida: -1, acierto: false, skip: true };
    if (idx >= slides.length - 1) { cerrar(); return; }
    mostrar(idx + 1);
  }

  // Remate común de cualquier mini-juego: vibra, suelta la barra y salta a la
  // revelación pasado un momento.
  function finInteractivo(acierto, textoPista, q) {
    var pista = slides[idx].querySelector('[data-quiz-pista]');
    if (pista) pista.textContent = textoPista;
    try { if (window.Vibra) (acierto ? window.Vibra.acierto : window.Vibra.fallo)(); } catch (e) {}
    raiz.classList.remove('w-quiz-activo');
    var b = raiz.querySelector('[data-barra="' + idx + '"]');
    if (b && !reducido()) {
      b.style.transition = 'transform 1600ms linear';
      b.style.transform = 'scaleX(1)';
    }
    setTimeout(function () {
      if (interDe(meta[idx]) === q) siguiente();
    }, 1700);
  }

  function responderQuiz(boton) {
    var q = meta[idx] && meta[idx].quiz;
    if (!q || boton.getAttribute('data-op') == null) return;
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
    finInteractivo(acierto, acierto ? '¡Bien!' : 'Casi…', q);
  }

  function responderVerdad(boton) {
    var q = meta[idx] && meta[idx].inter;
    if (!q || !q.correcta) return;
    var prev = respuestas[q.id];
    if (prev && !prev.skip) return;
    var elegida = boton.getAttribute('data-vf');
    var acierto = elegida === q.correcta;
    var reaccion = { txt: acierto ? q.ok : q.mal, ok: acierto };
    respuestas[q.id] = { elegida: elegida, acierto: acierto, reaccion: reaccion };

    Array.prototype.forEach.call(slides[idx].querySelectorAll('.w-vf__op'), function (b) {
      b.disabled = true;
      var v = b.getAttribute('data-vf');
      if (v === q.correcta) b.classList.add('is-bien');
      else if (v === elegida) b.classList.add('is-mal');
    });
    var frase = slides[idx].querySelector('.w-quiz__preg');
    if (frase) frase.insertAdjacentHTML('afterend',
      '<p class="w-vf__ver">' + esc(reaccion.txt) + '</p>');
    finInteractivo(acierto, acierto ? '¡Ojo clínico!' : 'Uy…', q);
  }

  function responderOrden(boton) {
    var q = meta[idx] && meta[idx].inter;
    if (!q || !q.orden) return;
    if (respuestas[q.id]) return;
    if (boton.classList.contains('is-puesta')) return;

    var cont = slides[idx].querySelector('.w-orden__ops');
    var puestas = cont.querySelectorAll('.w-orden__op.is-puesta').length;
    boton.classList.add('is-puesta');
    boton.querySelector('.w-orden__pos').textContent = puestas + 1;
    boton.setAttribute('data-elegido', puestas + 1);
    try { if (window.Vibra) window.Vibra.toque(); } catch (e) {}

    if (puestas + 1 < q.orden.length) return;   // aún faltan

    // Ya están las 3: comparar con el orden real.
    var elegido = [];
    Array.prototype.forEach.call(cont.querySelectorAll('.w-orden__op'), function (b) {
      elegido[+b.getAttribute('data-elegido') - 1] = b.getAttribute('data-orden');
    });
    var aciertos = 0;
    Array.prototype.forEach.call(cont.querySelectorAll('.w-orden__op'), function (b) {
      b.disabled = true;
      var t = b.getAttribute('data-orden');
      var real = q.orden.indexOf(t) + 1;
      var mio = +b.getAttribute('data-elegido');
      if (real === mio) { b.classList.add('is-bien'); aciertos++; }
      else b.classList.add('is-mal');
      b.querySelector('.w-orden__pos').textContent = real;
    });
    var todo = aciertos === q.orden.length;
    var reaccion = { ok: todo,
      txt: todo ? '¡Las tres clavadas! 🎯'
        : aciertos === 0 ? 'Del revés entero, Ama.'
        : aciertos + ' de ' + q.orden.length + '. Casi.' };
    respuestas[q.id] = { acierto: todo, aciertos: aciertos, reaccion: reaccion };
    finInteractivo(todo, todo ? '¡Perfecto!' : aciertos + '/' + q.orden.length, q);
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
    var vf = e.target.closest('[data-vf]');
    if (vf) { responderVerdad(vf); return; }
    var ord = e.target.closest('[data-orden]');
    if (ord) { responderOrden(ord); return; }
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
        e.target.closest('.w-orden__op') ||
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
    fotosListas = {};
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
