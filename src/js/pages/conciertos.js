/* ============================================================
   Pagina_conciertos — Recopilatorio de todos los conciertos del
   coro Bihotsak. Se llega desde Práctica (botón bajo el
   calendario) y desde la cuenta atrás de Inicio.

   Cada concierto se pinta como una tarjeta con la fecha, el
   lugar/hora, cuántas canciones tiene el programa y, si es
   pasado, la miniatura del recuerdo. Al tocarla se abre su
   detalle en el calendario de Práctica.
   ============================================================ */

window.Pagina_conciertos = (function () {
  'use strict';

  var DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  var urls = [];   // object URLs de miniaturas a revocar al salir
  var _render = 0; // token: descarta URLs de una pintar() ya obsoleta

  function hoyISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }
  function _d(iso) { return new Date((iso || '') + 'T00:00:00'); }

  var _raiz = null, _cont = null, _vacio = null;

  function iniciar(contenedor) {
    var raiz = contenedor.querySelector('[data-modulo="conciertos"]');
    if (!raiz || !window.Conciertos) return;
    _raiz = raiz;
    _cont = raiz.querySelector('[data-lista]');
    _vacio = raiz.querySelector('[data-vacio]');

    pintar();

    raiz.querySelector('[data-nuevo]').addEventListener('click', function () {
      if (window.Pagina_practice && window.Pagina_practice.abrirNuevoConcierto) {
        window.Pagina_practice.abrirNuevoConcierto();
      } else {
        window.App.ir('practica', { datos: { nuevoConcierto: true } });
      }
    });

    _cont.addEventListener('click', function (ev) {
      var card = ev.target.closest('[data-fecha-ir]');
      if (!card) return;
      var iso = card.getAttribute('data-fecha-ir');
      if (window.Pagina_practice && window.Pagina_practice.abrirConciertoDia) {
        window.Pagina_practice.abrirConciertoDia(iso);
      } else {
        window.App.ir('practica', { datos: { conciertoDia: iso } });
      }
    });

    // Cuando cambia un concierto (desde cualquier hoja) repintamos la lista.
    document.addEventListener('chorapp:concierto-cambio', pintar);

    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) {
        document.removeEventListener('chorapp:concierto-cambio', pintar);
        if (window.Pagina_practice && window.Pagina_practice.cerrarHojasConcierto) {
          window.Pagina_practice.cerrarHojasConcierto();
        }
        urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
        urls = [];
        obs.disconnect();
      }
    });
    obs.observe(vista, { childList: true });
  }

  function pintar() {
    var raiz = _raiz, cont = _cont, vacio = _vacio;
    if (!raiz || !document.body.contains(raiz)) return;

    var todos = window.Conciertos.listar();
    vacio.hidden = todos.length > 0;

    var hoy = hoyISO();
    var proximos = todos.filter(function (c) { return c.fecha >= hoy; });
    var pasados = todos.filter(function (c) { return c.fecha < hoy; })
      .sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });   // más reciente primero

    var html = '';
    if (proximos.length) {
      html += '<h2 class="seccion-titulo">Próximos</h2>';
      html += '<div class="conc-lista stagger">' +
        proximos.map(function (c, i) { return tarjeta(c, true); }).join('') + '</div>';
    }
    if (pasados.length) {
      html += '<h2 class="seccion-titulo">Ya cantados</h2>';
      html += '<div class="conc-lista">' +
        pasados.map(function (c) { return tarjeta(c, false); }).join('') + '</div>';
    }
    cont.innerHTML = html;

    // Cargar miniaturas de recuerdo. Token de render: si llega otra pintar()
    // antes de que resuelva alguna promesa de esta, sus URLs se descartan en
    // vez de asignarse a un <img> ya destruido (evita blobs huérfanos que se
    // revocan mientras el navegador aún los está cargando).
    urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    urls = [];
    var miRender = ++_render;
    Array.prototype.forEach.call(cont.querySelectorAll('[data-thumb]'), function (img) {
      if (!window.Archivos) return;
      window.Archivos.url(img.getAttribute('data-thumb')).then(function (u) {
        if (miRender !== _render) { if (u) URL.revokeObjectURL(u); return; }
        if (u) { img.src = u; urls.push(u); }
        else { var p = img.closest('.conc-card__foto'); if (p) p.remove(); }
      }).catch(function () {});
    });
  }

  function tarjeta(c, futuro) {
    var d = _d(c.fecha);
    var dia = isNaN(d) ? '' : d.getDate();
    var mes = isNaN(d) ? '' : MESES[d.getMonth()];
    var anio = isNaN(d) ? '' : d.getFullYear();
    var semana = isNaN(d) ? '' : DIAS[d.getDay()];

    var prog = window.Conciertos.programaDe ? window.Conciertos.programaDe(c.id) : [];
    var rec = window.Conciertos.recuerdoDe ? window.Conciertos.recuerdoDe(c.id) : { nota: '', foto: null };

    var cuenta = '';
    if (futuro) {
      var difDias = Math.round((_d(c.fecha) - _d(hoyISO())) / 86400000);
      cuenta = difDias <= 0 ? '¡Hoy!' : (difDias === 1 ? 'Mañana' : 'Faltan ' + difDias + ' días');
    }

    var meta = [];
    if (c.hora) meta.push(esc(c.hora));
    if (c.lugar) meta.push(esc(c.lugar));

    var chips = '';
    if (prog.length) {
      chips += '<span class="conc-card__chip">' + prog.length +
        (prog.length === 1 ? ' canción' : ' canciones') + '</span>';
    }
    if (!futuro && (rec.nota || rec.foto)) {
      chips += '<span class="conc-card__chip conc-card__chip--rec">Con recuerdo</span>';
    }

    var foto = (!futuro && rec.foto && window.Conciertos.claveFoto)
      ? '<span class="conc-card__foto"><img data-thumb="' + esc(window.Conciertos.claveFoto(c.id)) + '" alt=""></span>'
      : '';

    return '<button type="button" class="conc-card' + (futuro ? ' conc-card--prox' : '') + '" ' +
      'data-fecha-ir="' + esc(c.fecha) + '">' +
      '<span class="conc-card__fecha">' +
        '<span class="conc-card__dia">' + dia + '</span>' +
        '<span class="conc-card__mes">' + mes + '</span>' +
      '</span>' +
      '<span class="conc-card__cuerpo">' +
        (cuenta ? '<span class="conc-card__cuenta">' + cuenta + '</span>' : '') +
        '<span class="conc-card__sem">' + semana + ', ' + dia + ' de ' + nombreMes(d) + ' de ' + anio + '</span>' +
        (meta.length ? '<span class="conc-card__meta">' + meta.join(' · ') + '</span>' : '') +
        (chips ? '<span class="conc-card__chips">' + chips + '</span>' : '') +
      '</span>' +
      foto +
      '<svg class="conc-card__flecha" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
    '</button>';
  }

  var MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function nombreMes(d) { return isNaN(d) ? '' : MESES_LARGOS[d.getMonth()]; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
