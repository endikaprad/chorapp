/* ============================================================
   Pagina_practice — Registro de práctica (Fase 6)
   Estadísticas (racha, canciones de la semana) + calendario.
   ============================================================ */

window.Pagina_practice = (function () {
  'use strict';

  function iniciar(contenedor) {
    var raiz = contenedor.querySelector('[data-modulo="practice"]');
    if (!raiz) return;

    var dias = window.Practica ? window.Practica.diasPracticados() : [];
    var racha = window.Practica ? window.Practica.racha() : 0;
    var semana = window.Practica ? window.Practica.cancionesSemana() : 0;

    var elRacha = raiz.querySelector('[data-racha]');
    var elRachaLabel = raiz.querySelector('[data-racha-label]');
    var elSemana = raiz.querySelector('[data-semana]');
    var elSemanaLabel = raiz.querySelector('[data-semana-label]');

    contarHasta(elRacha, racha);
    elRachaLabel.textContent = racha === 1 ? 'día seguido' : 'días seguidos';
    contarHasta(elSemana, semana);
    elSemanaLabel.textContent = semana === 1 ? 'canción esta semana' : 'canciones esta semana';

    raiz.querySelector('[data-vacio]').hidden = dias.length > 0;

    pintarRepasar(raiz);

    // Días con algo que enseñar aunque no cuenten como práctica.
    var conActividad = window.Diario ? window.Diario.dias() : [];

    // Calendario del mes. Al tocar un día se abre su resumen.
    window.Calendario.crear(raiz.querySelector('[data-calendario]'), {
      practicados: dias,
      conActividad: conActividad,
      onDia: abrirResumenDia,
    });

    pintarDatos(raiz);

    // Al abandonar la pantalla, cerrar el resumen si quedó abierto.
    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) { cerrarResumen(); obs.disconnect(); }
    });
    obs.observe(vista, { childList: true, subtree: true });
  }

  /* ----------------------------------------------------------
     Resumen del día — hoja inferior con todo lo que Maite hizo
     ese día: qué estudió, cuántas veces lo escuchó, qué marcó
     como aprendido, trozos difíciles, grabaciones y sesiones.
     ---------------------------------------------------------- */

  var hojaResumen = null;

  function abrirResumenDia(iso) {
    if (!window.Diario) return;
    var r = window.Diario.resumenDia(iso);
    cerrarResumen();

    hojaResumen = document.createElement('div');
    hojaResumen.className = 'hoja hoja--resumen';
    hojaResumen.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Resumen del día">' +
        '<div class="hoja__asa"></div>' +
        '<p class="resumen__fecha">' + escapar(fechaLarga(iso)) + '</p>' +
        (r.primera && r.ultima && r.ultima - r.primera > 60000
          ? '<p class="resumen__horas">De ' + hora(r.primera) + ' a ' + hora(r.ultima) + '</p>'
          : '') +
        '<div class="resumen__cuerpo" data-cuerpo></div>' +
        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--primario" data-cerrar>Cerrar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaResumen);

    var cuerpo = hojaResumen.querySelector('[data-cuerpo]');
    cuerpo.innerHTML = r.hayAlgo ? cuerpoResumen(r) :
      '<p class="resumen__vacio">Ese día no quedó registrada ninguna actividad en la app.</p>';

    Array.prototype.forEach.call(hojaResumen.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarResumen);
    });
    document.addEventListener('keydown', cerrarResumenEsc);

    // Ir a la canción / sesión desde el resumen.
    Array.prototype.forEach.call(hojaResumen.querySelectorAll('[data-ir]'), function (b) {
      b.addEventListener('click', function () {
        var ruta = b.getAttribute('data-ir');
        var datos = {};
        try { datos = JSON.parse(b.getAttribute('data-datos') || '{}'); } catch (e) {}
        cerrarResumen();
        window.App.ir(ruta, { datos: datos });
      });
    });

    void hojaResumen.offsetHeight;
    hojaResumen.classList.add('is-abierta');
  }

  function cuerpoResumen(r) {
    var bloques = [];

    if (r.estudiado.length) {
      bloques.push(bloque('nota', 'Lo que estudiaste', r.estudiado.map(function (e) {
        var extra = e.veces > 1 ? ' · ' + e.veces + ' veces' : '';
        var datos = e.sesionId && e.marcaId
          ? { sesionId: e.sesionId, marcaId: e.marcaId }
          : (e.cancionId ? { id: e.cancionId } : null);
        var ruta = (e.sesionId && e.marcaId) ? 'estudio' : (e.cancionId ? 'cancion' : null);
        return item(e.titulo + extra, ruta, datos);
      })));
    }

    if (r.reproducciones.length) {
      bloques.push(bloque('play', 'Lo que escuchaste', r.reproducciones.map(function (p) {
        return item(p.titulo + ' · ' + p.veces + (p.veces === 1 ? ' vez' : ' veces'));
      })));
    }

    if (r.aprendidas.length) {
      bloques.push(bloque('estrella', r.aprendidas.length === 1 ? 'Marcaste como aprendida' : 'Marcaste como aprendidas',
        r.aprendidas.map(function (a) { return item('«' + a.titulo + '»'); })));
    }

    if (r.cambiosEstado.length) {
      bloques.push(bloque('mes', 'Cambios de estado', r.cambiosEstado.map(function (c) {
        return item('«' + c.titulo + '»: ' + (c.de || '—') + ' → ' + (c.a || '—'));
      })));
    }

    if (r.fragmentos) {
      var det = r.fragmentosLista.map(function (f) {
        return f.titulo + (f.n > 1 ? ' (' + f.n + ')' : '');
      }).join(', ');
      bloques.push(bloque('constancia',
        r.fragmentos === 1 ? 'Marcaste 1 trozo difícil' : 'Marcaste ' + r.fragmentos + ' trozos difíciles',
        det ? [item(det)] : []));
    }

    if (r.grabaciones.length) {
      bloques.push(bloque('micro',
        r.grabaciones.length === 1 ? 'Te grabaste cantando' : 'Te grabaste cantando ' + r.grabaciones.length + ' veces',
        r.grabaciones.map(function (g) {
          return item(g.titulo + (g.dur ? ' · ' + fmtDur(g.dur) : ''));
        })));
    }

    if (r.sesionesAbiertas.length) {
      bloques.push(bloque('calendario', 'Sesiones que abriste', r.sesionesAbiertas.map(function (s) {
        var extra = s.veces > 1 ? ' · ' + s.veces + ' veces' : '';
        return item(s.titulo + extra);
      })));
    }

    return bloques.join('');
  }

  function bloque(ico, titulo, items) {
    return '<section class="resumen__bloque">' +
      '<h3 class="resumen__tit">' + iconoDato(ico) + '<span>' + escapar(titulo) + '</span></h3>' +
      (items && items.length ? '<ul class="resumen__lista">' + items.join('') + '</ul>' : '') +
    '</section>';
  }

  function item(texto, ruta, datos) {
    if (ruta && datos) {
      return '<li><button type="button" class="resumen__ir" data-ir="' + ruta + '" ' +
        'data-datos="' + escapar(JSON.stringify(datos)) + '">' + escapar(texto) +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
        '</button></li>';
    }
    return '<li>' + escapar(texto) + '</li>';
  }

  function cerrarResumenEsc(e) { if (e.key === 'Escape') cerrarResumen(); }

  function cerrarResumen() {
    document.removeEventListener('keydown', cerrarResumenEsc);
    var h = hojaResumen;
    hojaResumen = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  function fechaLarga(iso) {
    var d = new Date((iso || '') + 'T00:00:00');
    if (isNaN(d)) return iso;
    try {
      var t = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) { return iso; }
  }
  function hora(ts) {
    try {
      return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function fmtDur(seg) {
    seg = Math.max(0, Math.round(seg || 0));
    var m = Math.floor(seg / 60), s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ----------------------------------------------------------
     Curiosidades bajo el calendario — datitos que está bien
     saber, sin pretensión de panel de estadísticas.
     ---------------------------------------------------------- */
  function pintarDatos(raiz) {
    var ul = raiz.querySelector('[data-datos]');
    if (!ul || !window.Practica) return;

    var datos = window.Practica.curiosidades();
    if (!datos.length) return;

    ul.innerHTML = datos.map(function (d, i) {
      return '<li style="animation-delay:' + (i * 40) + 'ms">' +
             iconoDato(d.ico) +
             '<span>' + escapar(d.texto) + '</span></li>';
    }).join('');
    ul.hidden = false;
  }

  /* Iconos de línea al estilo de la barra de navegación (trazo, sin relleno). */
  var ICONOS_DATO = {
    calendario: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 2.5v4M16 2.5v4"/>',
    racha: '<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.7.8-3.2 1.7-4.3C9 9 12 8 12 3Z"/>',
    nota: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    mes: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M7 13.5h4M7 17h7"/>',
    estrella: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z"/>',
    constancia: '<path d="M4 13h3l2-6 3 15 3-19 2.5 13 1.5-3H20"/>',
    play: '<path d="M8 5.5a1 1 0 0 1 1.53-.85l9 6.5a1 1 0 0 1 0 1.7l-9 6.5A1 1 0 0 1 8 18.5z"/>',
    micro: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/>',
  };
  function iconoDato(clave) {
    var p = ICONOS_DATO[clave] || ICONOS_DATO.nota;
    return '<svg class="dato__icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           p + '</svg>';
  }

  /* ----------------------------------------------------------
     Fragmentos difíciles pendientes — invita a repasarlos.
     Solo cuentan las canciones que aún no están aprendidas.
     ---------------------------------------------------------- */
  function pintarRepasar(raiz) {
    var btn = raiz.querySelector('[data-repasar]');
    if (!btn || !window.Sesiones) return;

    var pend = window.Sesiones.repasoPendiente().filter(function (p) {
      if (!p.cancionId) return true;
      var c = window.Canciones.obtener(p.cancionId);
      return !c || c.estado !== 'aprendida';
    }).sort(function (a, b) { return b.trozos - a.trozos; });
    if (pend.length === 0) return;

    var trozos = pend.reduce(function (n, p) { return n + p.trozos; }, 0);
    var destino = pend[0];

    raiz.querySelector('[data-repasar-titulo]').textContent =
      trozos === 1 ? '1 trozo marcado como difícil' : trozos + ' trozos marcados como difíciles';
    raiz.querySelector('[data-repasar-nota]').textContent =
      pend.length === 1
        ? 'En «' + destino.titulo + '», esperándote'
        : 'En ' + pend.length + ' canciones, esperándote';

    btn.addEventListener('click', function () {
      window.App.ir('estudio', { datos: { sesionId: destino.ref.sesion.id, marcaId: destino.ref.marca.id } });
    });
    btn.hidden = false;
  }

  /* ----------------------------------------------------------
     Conteo animado de 0 al valor final. Respeta
     prefers-reduced-motion (pinta el número directamente).
     ---------------------------------------------------------- */
  function contarHasta(el, destino) {
    if (!el) return;
    destino = Math.max(0, Math.round(destino || 0));

    var reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}
    if (reduce || destino === 0 || !window.requestAnimationFrame) {
      el.textContent = String(destino);
      return;
    }

    var DURACION = Math.min(1100, 400 + destino * 90);
    var inicio = null;

    function paso(t) {
      if (inicio === null) inicio = t;
      var p = Math.min(1, (t - inicio) / DURACION);
      var e = 1 - Math.pow(1 - p, 3); // ease-out cúbico
      el.textContent = String(Math.round(e * destino));
      if (p < 1) requestAnimationFrame(paso);
      else el.textContent = String(destino);
    }
    el.textContent = '0';
    requestAnimationFrame(paso);
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
