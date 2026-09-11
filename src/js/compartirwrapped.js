/* ============================================================
   compartirwrapped.js — La "foto resumen" del Wrapped.

   Al terminar el Wrapped (de mes o de año) se genera un póster
   vertical con el diseño de ChorApp: los números grandes, el top de
   canciones y la frase de cierre. Para guardarlo o mandarlo por
   WhatsApp a las del coro.

   window.CompartirWrapped.generar(datos) -> Promise<{ imagen: Blob(PNG), ancho, alto }>
     `datos` es el mismo objeto de ResumenMes.datosDe / .datosAnuales.

   Todo con <canvas>, cero dependencias. El envío/descarga lo hace
   window.Compartir.
   ============================================================ */

window.CompartirWrapped = (function () {
  'use strict';

  var W = 1080, H = 1920;
  var PAD = 96;
  var COL = W - PAD * 2;
  var FUENTE = "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, sans-serif";

  // Genérica de reserva (por si algún mes no tuviera tema, o datos sin mes).
  var TEMA_MES = {
    g0: '#5A5CF0', g1: '#2A24C8', g2: '#0B0870',
    tinte: '#B9BAFF', texto: '#FFFFFF', apagado: 'rgba(255,255,255,0.72)',
    barra: '#FFFFFF', barraFondo: 'rgba(255,255,255,0.16)',
    tarjeta: 'rgba(255,255,255,0.10)',
  };
  // Negro y dorado — el anual es Nochevieja, no "violeta con purpurina"
  // (mismos tonos que el fondo del Wrapped en pantalla, ver .wrapped--anual).
  var TEMA_ANUAL = {
    g0: '#221a08', g1: '#100c05', g2: '#000000',
    tinte: '#FFE9B0', texto: '#FFFFFF', apagado: 'rgba(255,233,176,0.72)',
    barra: '#F3B33F', barraFondo: 'rgba(255,233,176,0.18)',
    tarjeta: 'rgba(255,224,148,0.09)',
  };

  // Convierte "#RRGGBB" a "rgba(r,g,b,a)".
  function _rgba(hex, a) {
    var n = parseInt(hex.replace('#', ''), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // Construye la paleta de un mes a partir de su gradiente (3 tonos, iguales
  // que .wrapped--<mes> en styles.css) y su color de acento (--w-acento).
  function _tema(g0, g1, g2, acento) {
    return {
      g0: g0, g1: g1, g2: g2,
      tinte: acento, texto: '#FFFFFF', apagado: _rgba(acento, 0.72),
      barra: acento, barraFondo: _rgba(acento, 0.2),
      tarjeta: 'rgba(255,255,255,0.10)',
    };
  }
  // Paletas por mes — el póster para compartir usa el MISMO fondo que el
  // Wrapped a pantalla completa de ese mes, no un azul genérico. Diciembre
  // no tiene entrada: ese mes solo existe el póster ANUAL (TEMA_ANUAL).
  var TEMA_POR_MES = {
    enero:      _tema('#3A5FA8', '#142A5E', '#060B1E', '#9AC4FF'),
    febrero:    _tema('#7A3AA8', '#B8215F', '#3A0F2E', '#FF8CBE'),
    marzo:      _tema('#8FD450', '#4FAE7A', '#14324A', '#9BE07E'),
    abril:      _tema('#6F7FD6', '#4A8F8A', '#17303A', '#9FB0FF'),
    mayo:       _tema('#FF9FC2', '#FFD6A5', '#2F8F63', '#FF9FC2'),
    junio:      _tema('#E0A53E', '#B06A8A', '#2A2050', '#FFD98A'),
    julio:      _tema('#FF8F4D', '#FF7A90', '#159C9C', '#FFB089'),
    agosto:     _tema('#FF6B3D', '#E8451F', '#4A180C', '#FFA25C'),
    septiembre: _tema('#C99A2E', '#7A8A3C', '#22280F', '#E8C563'),
    octubre:    _tema('#D97A2C', '#A5501C', '#34200E', '#F0A860'),
    noviembre:  _tema('#5B6B8A', '#433A5C', '#0F0C17', '#B9C4E0'),
  };

  function f(px, peso) { return (peso || 400) + ' ' + px + 'px ' + FUENTE; }

  function _roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function envolver(ctx, texto, maxW) {
    var out = [], palabras = String(texto || '').split(/\s+/), linea = '';
    palabras.forEach(function (p) {
      var prueba = linea ? linea + ' ' + p : p;
      if (ctx.measureText(prueba).width > maxW && linea) { out.push(linea); linea = p; }
      else linea = prueba;
    });
    if (linea) out.push(linea);
    return out;
  }

  function recorta(ctx, texto, maxW) {
    if (ctx.measureText(texto).width <= maxW) return texto;
    var t = texto;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  function fmtMin(seg) {
    var m = Math.round((seg || 0) / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r : '');
  }
  function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

  function pintar(ctx, datos) {
    var esAnual = !!datos.esAnual;
    var tema = !esAnual && window.ResumenMes && window.ResumenMes.temaMes
      ? window.ResumenMes.temaMes(datos.mes) : '';
    var T = esAnual ? TEMA_ANUAL : (TEMA_POR_MES[tema] || TEMA_MES);

    // --- Fondo: degradado + dos halos suaves ---
    var g = ctx.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, T.g0); g.addColorStop(0.55, T.g1); g.addColorStop(1, T.g2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    function halo(cx, cy, rad, col) {
      var rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    }
    halo(W * 0.15, H * 0.12, 620, esAnual ? 'rgba(255,233,176,0.16)' : 'rgba(255,255,255,0.16)');
    halo(W * 0.95, H * 0.9, 720, esAnual ? 'rgba(243,179,63,0.22)' : _rgba(T.tinte, 0.24));

    ctx.textBaseline = 'alphabetic';
    var y = PAD + 28;

    // --- Cabecera ---
    ctx.font = f(30, 800);
    ctx.fillStyle = T.tinte;
    ctx.fillText('CHORAPP', PAD, y);
    var wCA = ctx.measureText('CHORAPP').width;
    ctx.font = f(30, 500);
    ctx.fillStyle = T.apagado;
    ctx.fillText('  ·  CORO BIHOTSAK', PAD + wCA, y);
    y += 74;

    // --- Título ---
    ctx.font = f(112, 800);
    ctx.fillStyle = T.texto;
    var titulo = esAnual ? String(datos.anio) : cap(datos.nombreMes);
    ctx.fillText(titulo, PAD, y + 92);
    y += 118;
    ctx.font = f(38, 600);
    ctx.fillStyle = T.tinte;
    ctx.fillText(esAnual ? 'Tu año en Bihotsak' : 'Tu mes en ChorApp', PAD, y + 40);
    y += 92;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    y += 48;

    // --- Tarjetas de números ---
    var tiles = [];
    var totalDias = esAnual ? datos.diasDelAnio : datos.diasDelMes;
    tiles.push({ n: String(datos.dias), l: 'de ' + totalDias + ' días' });
    var racha = esAnual ? datos.rachaMaxAno : datos.rachaMaxMes;
    if (racha >= 2) tiles.push({ n: String(racha), l: 'días de racha' });
    if (datos.canciones) tiles.push({ n: String(datos.canciones), l: (datos.canciones === 1 ? 'canción' : 'canciones') });
    if (datos.grabaciones && datos.grabaciones.n) tiles.push({ n: fmtMin(datos.grabaciones.seg), l: 'grabándote' });
    else if (datos.escuchas) tiles.push({ n: String(datos.escuchas), l: 'veces al play' });
    tiles = tiles.slice(0, 4);

    var cols = tiles.length >= 3 ? 2 : tiles.length;
    var gap = 24;
    var tw = (COL - gap * (cols - 1)) / cols;
    var th = 200;
    tiles.forEach(function (t, i) {
      var cx = PAD + (i % cols) * (tw + gap);
      var cy = y + Math.floor(i / cols) * (th + gap);
      ctx.fillStyle = T.tarjeta;
      _roundRect(ctx, cx, cy, tw, th, 30); ctx.fill();
      ctx.textAlign = 'left';
      ctx.font = f(84, 800);
      ctx.fillStyle = T.tinte;
      ctx.fillText(recorta(ctx, t.n, tw - 44), cx + 32, cy + 104);
      ctx.font = f(27, 600);
      ctx.fillStyle = T.apagado;
      ctx.fillText(recorta(ctx, t.l, tw - 44), cx + 32, cy + 150);
    });
    y += Math.ceil(tiles.length / cols) * (th + gap) + 44;

    // --- Top de canciones ---
    var lista = (datos.topEscuchadas && datos.topEscuchadas.length)
      ? { titulo: 'LO QUE MÁS SONÓ', items: datos.topEscuchadas }
      : (datos.topEstudiadas && datos.topEstudiadas.length)
        ? { titulo: 'LAS MÁS TRABAJADAS', items: datos.topEstudiadas }
        : (datos.cancionTop
          ? { titulo: 'LA CANCIÓN DEL ' + (esAnual ? 'AÑO' : 'MES'),
              items: [{ titulo: datos.cancionTop.titulo, veces: datos.cancionTop.veces || datos.cancionTop.dias || 1 }] }
          : null);

    if (lista) {
      var items = lista.items.slice(0, esAnual ? 5 : 3);
      ctx.font = f(28, 800);
      ctx.fillStyle = T.tinte;
      ctx.fillText(lista.titulo, PAD, y);
      y += 52;
      var maxV = items.reduce(function (a, it) { return Math.max(a, it.veces || 0); }, 1);
      items.forEach(function (it, i) {
        var fila = y + i * 96;
        ctx.font = f(30, 800);
        ctx.fillStyle = T.apagado;
        ctx.fillText(String(i + 1), PAD, fila + 30);
        ctx.font = f(34, 700);
        ctx.fillStyle = T.texto;
        ctx.fillText(recorta(ctx, it.titulo, COL - 210), PAD + 52, fila + 30);
        if (it.veces) {
          ctx.font = f(28, 700);
          ctx.fillStyle = T.apagado;
          ctx.textAlign = 'right';
          ctx.fillText(String(it.veces), W - PAD, fila + 30);
          ctx.textAlign = 'left';
        }
        var bw = Math.max(60, (COL - 52) * ((it.veces || 0) / maxV));
        ctx.fillStyle = T.barraFondo;
        _roundRect(ctx, PAD + 52, fila + 48, COL - 52, 12, 6); ctx.fill();
        ctx.fillStyle = T.barra;
        _roundRect(ctx, PAD + 52, fila + 48, bw, 12, 6); ctx.fill();
      });
      y += items.length * 96 + 20;
    }

    // --- Aprendidas (si hay hueco y las hay) ---
    if (datos.aprendidas && datos.aprendidas.length && y < H - 560) {
      ctx.font = f(28, 800);
      ctx.fillStyle = T.tinte;
      ctx.fillText((datos.aprendidas.length === 1 ? 'CANCIÓN APRENDIDA' : datos.aprendidas.length + ' APRENDIDAS'), PAD, y);
      y += 46;
      ctx.font = f(30, 600);
      ctx.fillStyle = T.texto;
      var apr = recorta(ctx, datos.aprendidas.slice(0, 4).join('  ·  ') +
        (datos.aprendidas.length > 4 ? '  ·  …' : ''), COL);
      ctx.fillText(apr, PAD, y);
      y += 58;
    }

    // --- Frase de cierre (justo debajo, sin dejar un hueco enorme) ---
    if (datos.frase) {
      ctx.font = f(36, 600);
      var lns = envolver(ctx, datos.frase, COL - 68);
      var bh = lns.length * 50 + 64;
      var fy = Math.min(y + 34, H - 200 - bh);
      ctx.fillStyle = T.tarjeta;
      _roundRect(ctx, PAD, fy, COL, bh, 26); ctx.fill();
      ctx.fillStyle = T.texto;
      lns.forEach(function (l, i) { ctx.fillText(l, PAD + 34, fy + 54 + i * 50); });
    }

    // --- Pie: marca + copyright ---
    ctx.textAlign = 'center';
    ctx.font = f(26, 700);
    ctx.fillStyle = T.apagado;
    ctx.fillText('Generado en ChorApp', W / 2, H - 108);
    ctx.font = f(23, 500);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('© ' + (new Date().getFullYear()) + ' Endika Prado', W / 2, H - 70);
    ctx.textAlign = 'left';
  }

  function generar(datos) {
    return new Promise(function (res, rej) {
      try {
        var cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d');
        pintar(ctx, datos || {});
        cv.toBlob(function (png) {
          if (png) res({ imagen: png, ancho: W, alto: H });
          else rej(new Error('toBlob'));
        }, 'image/png');
      } catch (e) { rej(e); }
    });
  }

  return { generar: generar };
})();
