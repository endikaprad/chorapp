/* ============================================================
   resumenmes.js — Resumen del mes (con tono cabrón).

   El día 1 de cada mes, Inicio enseña una hoja con el balance del
   mes que acaba de terminar: días de estudio, canciones, aprendidas,
   trozos difíciles, grabaciones y logros. Y una frase de despedida
   burlona, como todo en esta app.

   Se calcula al vuelo desde Practica + Diario + Grabaciones + Logros.
   Lo único que se guarda es qué mes se ha visto ya
   (Almacen 'resumenmes:visto' = "YYYY-MM").

   window.ResumenMes.datosDe(anio, mes)  -> objeto para pintar (mes 0-11)
   window.ResumenMes.pendiente()         -> datos del mes anterior si toca
                                            enseñarlo (o null)
   window.ResumenMes.ultimoMes()         -> { anio, mes } del mes anterior
   window.ResumenMes.marcarVisto(a, m)
   ============================================================ */

window.ResumenMes = (function () {
  'use strict';

  var CLAVE_VISTO = 'resumenmes:visto';
  var DIA_TOPE_AUTO = 12;   // pasado el día 12 ya no salta solo (sí desde Práctica)

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function _iso(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var x = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + x;
  }
  function claveMes(a, m) { return a + '-' + String(m + 1).padStart(2, '0'); }
  function nombreMes(m) { return MESES[m] || ''; }
  function capitaliza(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function mesAnterior(hoy) {
    hoy = hoy || new Date();
    var m = hoy.getMonth() - 1, a = hoy.getFullYear();
    if (m < 0) { m = 11; a--; }
    return { anio: a, mes: m };
  }

  // Racha más larga de días consecutivos DENTRO de un conjunto de ISOs.
  function _rachaMax(setISO) {
    var dias = Object.keys(setISO).sort();
    if (!dias.length) return 0;
    var mejor = 1, act = 1;
    for (var i = 1; i < dias.length; i++) {
      var prev = new Date(dias[i - 1] + 'T00:00:00');
      prev.setDate(prev.getDate() + 1);
      if (_iso(prev) === dias[i]) { act++; if (act > mejor) mejor = act; }
      else act = 1;
    }
    return mejor;
  }

  function _tituloCancion(id) {
    if (id && id.indexOf('marca:') !== 0 && window.Canciones) {
      var c = window.Canciones.obtener(id);
      if (c) return c.titulo;
    }
    return null;
  }

  function datosDe(anio, mes) {
    var reg = window.Practica && window.Practica.leer ? window.Practica.leer() : {};
    var primeroMes = new Date(anio, mes, 1);
    var diasDelMes = new Date(anio, mes + 1, 0).getDate();

    var diasSet = {};            // ISO -> true (días con estudio)
    var porCancion = {};         // id -> nº de días que aparece
    var titulos = {};            // id -> titulo
    var escuchas = 0;
    var trozos = 0;
    var aprendidas = [];
    var vistasAprend = {};

    // Suma 1 al contador de una canción (una vez por día, con `vistasHoy`).
    function apunta(vistasHoy, id, titulo) {
      if (!id || vistasHoy[id]) return;
      vistasHoy[id] = true;
      porCancion[id] = (porCancion[id] || 0) + 1;
      if (!titulos[id]) titulos[id] = titulo || _tituloCancion(id) || 'una canción';
    }

    for (var d = 1; d <= diasDelMes; d++) {
      var iso = _iso(new Date(anio, mes, d));
      var practica = Array.isArray(reg[iso]) ? reg[iso] : [];
      var evs = window.Diario && window.Diario.delDia ? window.Diario.delDia(iso) : [];

      // Un día "cuenta" si hay práctica registrada o un evento de estudio.
      var estudiadoHoy = practica.length > 0 ||
        evs.some(function (ev) { return ev.t === 'estudio'; });
      if (estudiadoHoy) diasSet[iso] = true;

      // Canciones estudiadas (por día que aparecen). De la práctica y, por si
      // acaso, de los eventos 'estudio' del diario.
      var vistasHoy = {};
      practica.forEach(function (id) { apunta(vistasHoy, id); });
      evs.forEach(function (ev) {
        if (ev.t === 'estudio') {
          apunta(vistasHoy, ev.cancionId || ('marca:' + (ev.marcaId || '')), ev.titulo);
        } else if (ev.t === 'reproduccion') {
          escuchas++;
        } else if (ev.t === 'fragmento') {
          trozos++;
        } else if (ev.t === 'estado' && ev.extra && ev.extra.a === 'aprendida') {
          var tit = ev.titulo || _tituloCancion(ev.cancionId) || 'una canción';
          if (!vistasAprend[tit]) { vistasAprend[tit] = true; aprendidas.push(tit); }
        }
      });
    }

    // Canción más trabajada del mes (solo si destaca sobre las demás).
    var ids = Object.keys(porCancion).sort(function (a, b) { return porCancion[b] - porCancion[a]; });
    var cancionTop = null;
    if (ids.length >= 2 && porCancion[ids[0]] >= 3 && porCancion[ids[0]] > porCancion[ids[1]]) {
      cancionTop = { titulo: titulos[ids[0]] || 'una canción', veces: porCancion[ids[0]] };
    }

    // Grabaciones del mes (por su timestamp de creación).
    var grabN = 0, grabSeg = 0;
    if (window.Grabaciones && window.Grabaciones.listar) {
      window.Grabaciones.listar().forEach(function (g) {
        var t = new Date(g.creado || 0);
        if (t.getFullYear() === anio && t.getMonth() === mes) {
          grabN++;
          grabSeg += Number(g.dur) || 0;
        }
      });
    }

    // Logros conseguidos ese mes.
    var logros = [];
    if (window.Logros && window.Logros.listar && window.Logros.fechaDe) {
      window.Logros.listar().forEach(function (l) {
        if (!l.hecho) return;
        var ts = window.Logros.fechaDe(l.id);
        if (!ts) return;
        var t = new Date(ts);
        if (t.getFullYear() === anio && t.getMonth() === mes) {
          logros.push({ titulo: l.titulo, icono: l.icono });
        }
      });
    }

    var nDias = Object.keys(diasSet).length;
    var nCanciones = Object.keys(porCancion).length;

    var datos = {
      anio: anio,
      mes: mes,
      nombreMes: nombreMes(mes),
      etiqueta: capitaliza(nombreMes(mes)) + (anio !== new Date().getFullYear() ? ' de ' + anio : ''),
      clave: claveMes(anio, mes),
      dias: nDias,
      diasDelMes: diasDelMes,
      rachaMaxMes: _rachaMax(diasSet),
      canciones: nCanciones,
      cancionTop: cancionTop,
      aprendidas: aprendidas,
      trozos: trozos,
      escuchas: escuchas,
      grabaciones: { n: grabN, seg: Math.round(grabSeg) },
      logros: logros,
    };
    datos.hayAlgo = nDias > 0 || grabN > 0 || aprendidas.length > 0 || logros.length > 0;
    datos.frase = frase(datos);
    return datos;
  }

  /* ---------- Frase de cierre (tono cabrón) ---------- */
  function frase(d) {
    var mes = capitaliza(d.nombreMes);
    if (!d.hayAlgo) {
      return elegir([
        mes + ': cero patatero. El coro esperándote y los vecinos dándote las gracias.',
        'Este mes no has tocado la app. Bihotsak sigue, tú ya veremos.',
        mes + ' en blanco. Espero que al menos hayas cantado en la ducha.'
      ]);
    }
    var ratio = d.dias / d.diasDelMes;
    if (ratio >= 0.8) {
      return elegir([
        d.dias + ' días de ' + d.diasDelMes + '. Bestial. A este paso te sale una nota limpia sin querer.',
        'Casi el mes entero cantando. La familia pide una tregua; tú ni caso.',
        d.dias + ' de ' + d.diasDelMes + ' días. Constancia de hierro y oído de… bueno, de hierro también.'
      ]);
    }
    if (ratio >= 0.45) {
      return elegir([
        d.dias + ' días este mes. Bien. Ni de lejos afinada, pero bien.',
        mes + ' decente: ' + d.dias + ' días. El mes que viene, a por más, que hay margen. Mucho.',
        d.dias + ' días de estudio. Se nota el esfuerzo. En el resultado un poquito menos, pero se nota.'
      ]);
    }
    return elegir([
      'Solo ' + d.dias + (d.dias === 1 ? ' día' : ' días') + ' este mes. El coro no se aprende por ósmosis, Ama.',
      mes + ' flojito: ' + d.dias + (d.dias === 1 ? ' día' : ' días') + '. La próxima, un poquito más, aunque sea mal.',
      d.dias + (d.dias === 1 ? ' día' : ' días') + '. Menos que los polvorones que te comes. Espabila.'
    ]);
  }

  function elegir(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ---------- Cuándo enseñarlo ---------- */
  function marcarVisto(a, m) {
    if (window.Almacen) window.Almacen.guardar(CLAVE_VISTO, claveMes(a, m));
  }

  function ultimoMes() { return mesAnterior(); }

  // Datos del mes anterior si procede enseñarlo solo (o null).
  function pendiente() {
    if (!window.Almacen) return null;
    var hoy = new Date();
    var ant = mesAnterior(hoy);
    var clave = claveMes(ant.anio, ant.mes);
    if (window.Almacen.leer(CLAVE_VISTO, '') === clave) return null;
    if (hoy.getDate() > DIA_TOPE_AUTO) return null; // ya muy metidos en el mes: no saltar solo

    var d = datosDe(ant.anio, ant.mes);
    if (!d.hayAlgo) { marcarVisto(ant.anio, ant.mes); return null; }
    return d;
  }

  /* ---------- Hoja / bottom sheet ---------- */
  var hoja = null;

  var ICO = {
    racha: '<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.7.8-3.2 1.7-4.3C9 9 12 8 12 3Z"/>',
    nota: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    estrella: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z"/>',
    constancia: '<path d="M4 13h3l2-6 3 15 3-19 2.5 13 1.5-3H20"/>',
    micro: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    play: '<path d="M8 5.5a1 1 0 0 1 1.53-.85l9 6.5a1 1 0 0 1 0 1.7l-9 6.5A1 1 0 0 1 8 18.5z"/>'
  };
  function ico(k) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[k] || ICO.nota) + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMin(seg) {
    var m = Math.round((seg || 0) / 60);
    return m <= 0 ? 'menos de 1 min' : m + ' min';
  }
  function fila(k, t) { return '<li>' + ico(k) + '<span>' + esc(t) + '</span></li>'; }

  function abrirHoja(d) {
    cerrarHoja();

    var filas = [];
    if (d.canciones) {
      filas.push(fila('nota', d.canciones + (d.canciones === 1 ? ' canción distinta' : ' canciones distintas')));
    }
    if (d.rachaMaxMes >= 2) {
      filas.push(fila('racha', 'Racha más larga del mes: ' + d.rachaMaxMes + ' días'));
    }
    if (d.cancionTop) {
      filas.push(fila('estrella', '«' + d.cancionTop.titulo + '», la más trabajada (' + d.cancionTop.veces + ' veces)'));
    }
    if (d.aprendidas.length) {
      filas.push(fila('estrella',
        (d.aprendidas.length === 1 ? 'Aprendida: ' : d.aprendidas.length + ' aprendidas: ') +
        d.aprendidas.slice(0, 4).join(', ') + (d.aprendidas.length > 4 ? '…' : '')));
    }
    if (d.trozos) {
      filas.push(fila('constancia', d.trozos + (d.trozos === 1 ? ' trozo difícil marcado' : ' trozos difíciles marcados')));
    }
    if (d.escuchas) {
      filas.push(fila('play', 'Le diste al play ' + d.escuchas + (d.escuchas === 1 ? ' vez' : ' veces')));
    }
    if (d.grabaciones.n) {
      filas.push(fila('micro', d.grabaciones.n + (d.grabaciones.n === 1 ? ' grabación' : ' grabaciones') +
        ' (' + fmtMin(d.grabaciones.seg) + ')'));
    }

    var logrosHtml = '';
    if (d.logros.length && window.Logros && window.Logros.icono) {
      logrosHtml = '<div class="mes__logros">' +
        '<span class="mes__logros-tit">' +
          (d.logros.length === 1 ? 'Logro del mes' : d.logros.length + ' logros este mes') + '</span>' +
        '<div class="mes__logros-fila">' +
          d.logros.map(function (l) {
            return '<span class="mes__medalla" title="' + esc(l.titulo) + '">' + window.Logros.icono(l.icono) + '</span>';
          }).join('') +
        '</div></div>';
    }

    hoja = document.createElement('div');
    hoja.className = 'hoja hoja--mes';
    hoja.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Resumen del mes">' +
        '<div class="hoja__asa"></div>' +
        '<p class="mes__eyebrow">Tu ' + esc(d.nombreMes) + ' en ChorApp</p>' +
        '<div class="mes__grande">' +
          '<span class="mes__num">' + d.dias + '</span>' +
          '<span class="mes__num-label">' +
            (d.dias === 1 ? 'día de estudio' : 'días de estudio') + ' de ' + d.diasDelMes + '</span>' +
        '</div>' +
        (filas.length ? '<ul class="mes__lista">' + filas.join('') + '</ul>' : '') +
        logrosHtml +
        '<p class="mes__frase">' + esc(d.frase) + '</p>' +
        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--primario" data-cerrar>Cerrar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hoja);

    Array.prototype.forEach.call(hoja.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarHoja);
    });
    document.addEventListener('keydown', _esc);

    // Cerrar si se navega a otra pantalla (el router recrea #vista).
    var vista = document.getElementById('vista');
    if (vista && window.MutationObserver) {
      var obs = new MutationObserver(function () { cerrarHoja(); obs.disconnect(); });
      obs.observe(vista, { childList: true });
    }

    void hoja.offsetHeight;
    hoja.classList.add('is-abierta');
  }

  function _esc(e) { if (e.key === 'Escape') cerrarHoja(); }
  function cerrarHoja() {
    document.removeEventListener('keydown', _esc);
    var h = hoja;
    hoja = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  return {
    datosDe: datosDe,
    pendiente: pendiente,
    ultimoMes: ultimoMes,
    marcarVisto: marcarVisto,
    nombreMes: nombreMes,
    abrirHoja: abrirHoja,
    cerrarHoja: cerrarHoja,
  };
})();
