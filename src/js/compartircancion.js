/* ============================================================
   compartircancion.js — Genera un "resumen de estudio" de una
   canción con el diseño de ChorApp para compartir con una
   compañera del coro que no tiene la app.

   Incluye: título, compositor, idioma, estado, una tira de datos
   (nº de grabaciones, nº de trozos difíciles…), la letra (original,
   cómo suena y traducción, ya sea en texto o en PDF/imagen), los
   trozos difíciles CON SU MINUTO y la partitura (imagen o PDF).
   NO incluye las grabaciones de Maite, solo cuántas ha hecho.

   window.CompartirCancion.generar(cancion, opts) -> Promise<{
       imagen: Blob (PNG),
       pdf:    Blob (application/pdf),
       ancho, alto
   }>
     opts.fragmentos    : [{ texto, segundo }]  (trozos difíciles de la toma)
     opts.notaToma      : string                (apunte del día, opcional)
     opts.partitura     : Blob                  (imagen o PDF)
     opts.letra         : Blob                  (imagen o PDF; si no hay letra en texto)
     opts.fonetica      : Blob                  (imagen o PDF; si no hay fonética en texto)
     opts.numGrabaciones: number                (cuántas grabaciones hay de esta toma)

   Todo con <canvas> (cero dependencias propias; para los PDF se usa
   el PDF.js ya empaquetado en vendor/, el mismo que el visor).
   El PDF resultante es una sola página con la imagen incrustada (JPEG).
   ============================================================ */

window.CompartirCancion = (function () {
  'use strict';

  var W = 1080;                 // ancho del lienzo (px reales)
  var PAD = 84;
  var COL = W - PAD * 2;

  var C = {
    acento: '#1512D6',
    acentoOsc: '#0E0B9E',
    texto: '#1A1A1A',
    texto2: '#6B6560',
    fondo: '#FBF8F3',
    superficie: '#FFFFFF',
    borde: '#E4DCCF',
    aprendida: '#4C7A5A',
    progreso: '#C98A2E',
    pendiente: '#9A9490',
  };
  var FUENTE = "'Plus Jakarta Sans', -apple-system, 'Segoe UI', Roboto, sans-serif";

  function f(px, peso) { return (peso || 400) + ' ' + px + "px " + FUENTE; }

  function mmss(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  // Parte `texto` en líneas que caben en `maxW` con la fuente ya fijada en ctx.
  function envolver(ctx, texto, maxW) {
    var out = [];
    String(texto || '').split('\n').forEach(function (parrafo) {
      if (!parrafo.trim()) { out.push(''); return; }
      var palabras = parrafo.split(/\s+/);
      var linea = '';
      palabras.forEach(function (p) {
        var prueba = linea ? linea + ' ' + p : p;
        if (ctx.measureText(prueba).width > maxW && linea) {
          out.push(linea);
          linea = p;
        } else {
          linea = prueba;
        }
      });
      if (linea) out.push(linea);
    });
    return out;
  }

  /* ============================================================
     PASO 1 — construir la lista de "bloques" y medir su altura.
     Cada bloque se pinta luego en el paso 2. Separar medir de
     pintar deja dibujar fondos de tarjeta (sabemos la altura).
     ============================================================ */

  function construir(m, cancion, opts, rec) {
    opts = opts || {};
    var items = [];

    /* ---- Cabecera (banda cobalto) ---- */
    m.font = f(54, 800);
    var titLineas = envolver(m, cancion.titulo || 'Canción', COL - 8);
    var titTop = 150, titLh = 62;
    var bandH = titTop + titLineas.length * titLh + (cancion.compositor ? 46 : 0) + 44;
    if (bandH < 210) bandH = 210;
    items.push({
      tipo: 'cabecera', h: bandH,
      titLineas: titLineas, titTop: titTop, titLh: titLh,
      compositor: cancion.compositor || '',
    });

    var y0 = 52; // aire tras la banda

    /* ---- Chips: idioma / estado / etiquetas ---- */
    var chips = [];
    var idioma = window.Canciones && window.Canciones.nombreIdioma
      ? window.Canciones.nombreIdioma(cancion.idioma) : '';
    if (idioma) chips.push({ t: idioma, c: C.texto2 });
    var est = window.Canciones && window.Canciones.ESTADOS && window.Canciones.ESTADOS[cancion.estado];
    if (est) chips.push({ t: est.etiqueta, c: C[cancion.estado] || C.texto2 });
    (cancion.etiquetas || []).slice(0, 3).forEach(function (e) { chips.push({ t: e, c: C.texto2 }); });
    if (chips.length) {
      m.font = f(21, 700);
      chips.forEach(function (ch) { ch.w = m.measureText(ch.t.toUpperCase()).width + 34; });
      items.push({ tipo: 'chips', h: y0 + 40, chips: chips, top: y0 });
      y0 = 20;
    }

    /* ---- Tira de datos ---- */
    var frags = (opts.fragmentos || []).filter(function (x) {
      return x && ((x.texto && x.texto.trim()) || (typeof x.segundo === 'number' && isFinite(x.segundo)));
    });
    var stats = [];
    var ng = Number(opts.numGrabaciones) || 0;
    stats.push({ t: ng === 0 ? 'Sin grabaciones aún' : (ng + (ng === 1 ? ' grabación' : ' grabaciones')) });
    if (frags.length) stats.push({ t: frags.length + (frags.length === 1 ? ' trozo difícil' : ' trozos difíciles') });
    var hayPart = (rec.partitura && rec.partitura.length);
    if (hayPart) stats.push({ t: 'Con partitura' });
    if (stats.length) {
      m.font = f(20, 700);
      stats.forEach(function (s) { s.w = m.measureText(s.t.toUpperCase()).width + 40; });
      items.push({ tipo: 'stats', h: y0 + 52, stats: stats, top: y0 });
      y0 = 16;
    }

    /* ---- Nota del día ---- */
    if (opts.notaToma && opts.notaToma.trim()) {
      m.font = f(26, 500);
      var lns = envolver(m, '« ' + opts.notaToma.trim() + ' »', COL - 88);
      items.push({ tipo: 'cita', h: 28 + (lns.length * 40 + 46) + 20, lineas: lns, top: 28 });
    }

    /* ---- Sección: helpers ---- */
    function seccion(txt) { items.push({ tipo: 'seccion', h: 122, txt: txt }); }
    function subtit(txt) { items.push({ tipo: 'subtitulo', h: 62, txt: txt }); }
    function parrafo(txt, tam, color, lh) {
      m.font = f(tam, 400);
      var l = envolver(m, txt, COL);
      lh = lh || Math.round(tam * 1.5);
      items.push({ tipo: 'parrafo', h: l.length * lh + 10, lineas: l, tam: tam, color: color, lh: lh });
    }
    function imagenes(lista) {
      lista.forEach(function (el) {
        var w = el.width || el.naturalWidth || 1;
        var hh = el.height || el.naturalHeight || 1;
        var dw = COL, dh = Math.round(COL * hh / w);
        if (dh > 1500) { dw = Math.round(dw * 1500 / dh); dh = 1500; }
        items.push({ tipo: 'imagen', h: dh + 22, el: el, dw: dw, dh: dh });
      });
    }

    /* ---- Letra ---- */
    var letTxt = (cancion.letraTexto || '').trim();
    var fonTxt = (cancion.letraFonetica || '').trim();
    var traTxt = (cancion.letraTraduccion || '').trim();
    var letDoc = (!letTxt && rec.letra && rec.letra.length) ? rec.letra : null;
    var fonDoc = (!fonTxt && rec.fonetica && rec.fonetica.length) ? rec.fonetica : null;

    if (letTxt || letDoc || fonTxt || fonDoc || traTxt) {
      seccion('La letra');
      if (letTxt) parrafo(letTxt, 27, C.texto, 44);
      else if (letDoc) imagenes(letDoc);
      if (fonTxt) { subtit('Cómo suena'); parrafo(fonTxt, 27, C.texto2, 44); }
      else if (fonDoc) { subtit('Cómo suena'); imagenes(fonDoc); }
      if (traTxt) { subtit('Qué significa'); parrafo(traTxt, 26, C.texto2, 42); }
    }

    /* ---- Trozos difíciles (con su minuto) ---- */
    if (frags.length) {
      seccion('Trozos difíciles');
      frags.sort(function (a, b) {
        var sa = typeof a.segundo === 'number' ? a.segundo : 1e9;
        var sb = typeof b.segundo === 'number' ? b.segundo : 1e9;
        return sa - sb;
      });
      frags.forEach(function (fr) {
        var tiene = typeof fr.segundo === 'number' && isFinite(fr.segundo);
        var etq = tiene ? mmss(fr.segundo) : '•';
        m.font = f(tiene ? 21 : 26, 700);
        var pillW = tiene ? m.measureText(etq).width + 34 : 40;
        var txtX = PAD + pillW + 20;
        m.font = f(25, 400);
        var texto = (fr.texto && fr.texto.trim()) || (tiene ? 'Repasar este momento' : '');
        var l = envolver(m, texto, W - PAD - txtX);
        var alto = Math.max(38, l.length * 38) + 20;
        items.push({ tipo: 'frag', h: alto, etq: etq, tiene: tiene, pillW: pillW, txtX: txtX, lineas: l });
      });
    }

    /* ---- Partitura ---- */
    if (hayPart) { seccion('Partitura'); imagenes(rec.partitura); }

    /* ---- Pie ---- */
    items.push({ tipo: 'pie', h: 210 });

    return items;
  }

  /* ============================================================
     PASO 2 — pintar cada bloque. Devuelve la `y` final.
     ============================================================ */

  function pintar(ctx, items) {
    var alto = items.reduce(function (a, it) { return a + it.h; }, 0);
    ctx.canvas.height = alto;
    ctx.textBaseline = 'alphabetic';

    // Fondo
    ctx.fillStyle = C.fondo;
    ctx.fillRect(0, 0, W, alto);

    var y = 0;
    var year = new Date().getFullYear();

    items.forEach(function (it) {
      switch (it.tipo) {

        case 'cabecera':
          ctx.fillStyle = C.acento;
          ctx.fillRect(0, y, W, it.h);
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.font = f(20, 800);
          ctx.fillText(espaciar('CHORAPP · CORO BIHOTSAK'), PAD, y + 78);
          ctx.strokeStyle = 'rgba(255,255,255,0.28)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(PAD, y + 100); ctx.lineTo(PAD + 190, y + 100); ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.font = f(54, 800);
          it.titLineas.forEach(function (l, i) {
            ctx.fillText(l, PAD, y + it.titTop + i * it.titLh);
          });
          if (it.compositor) {
            ctx.fillStyle = 'rgba(255,255,255,0.82)';
            ctx.font = f(27, 500);
            ctx.fillText(it.compositor, PAD, y + it.titTop + it.titLineas.length * it.titLh + 6);
          }
          break;

        case 'chips': {
          var cx = PAD, cy = y + it.top + 22;
          ctx.font = f(21, 700);
          it.chips.forEach(function (ch) {
            _roundRect(ctx, cx, cy - 22, ch.w, 40, 20);
            ctx.fillStyle = _mezcla(ch.c, C.fondo, 0.16);
            ctx.fill();
            ctx.fillStyle = ch.c;
            ctx.fillText(ch.t.toUpperCase(), cx + 17, cy + 6);
            cx += ch.w + 12;
          });
          break;
        }

        case 'stats': {
          var sx = PAD, sy = y + it.top;
          ctx.font = f(20, 700);
          it.stats.forEach(function (s) {
            _roundRect(ctx, sx, sy, s.w, 44, 12);
            ctx.fillStyle = C.acento;
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(s.t.toUpperCase(), sx + 20, sy + 29);
            sx += s.w + 12;
          });
          break;
        }

        case 'cita': {
          var altura = it.lineas.length * 40 + 46;
          _roundRect(ctx, PAD, y + it.top, COL, altura, 18);
          ctx.fillStyle = _mezcla(C.acento, C.fondo, 0.1);
          ctx.fill();
          ctx.fillStyle = C.acento;
          ctx.fillRect(PAD, y + it.top, 6, altura);
          ctx.fillStyle = C.texto;
          ctx.font = f(26, 500);
          var yy = y + it.top + 40;
          it.lineas.forEach(function (l) { ctx.fillText(l, PAD + 34, yy); yy += 40; });
          break;
        }

        case 'seccion':
          ctx.font = f(22, 800);
          ctx.fillStyle = C.acento;
          ctx.fillText(espaciar(it.txt.toUpperCase()), PAD, y + 62);
          ctx.strokeStyle = C.borde;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(PAD, y + 88); ctx.lineTo(W - PAD, y + 88); ctx.stroke();
          break;

        case 'subtitulo':
          ctx.font = f(19, 700);
          ctx.fillStyle = C.texto2;
          ctx.fillText(espaciar(it.txt.toUpperCase()), PAD, y + 44);
          break;

        case 'parrafo': {
          ctx.font = f(it.tam, 400);
          ctx.fillStyle = it.color;
          var py = y + it.lh - 6;
          it.lineas.forEach(function (l) { ctx.fillText(l, PAD, py); py += it.lh; });
          break;
        }

        case 'frag': {
          if (it.tiene) {
            _roundRect(ctx, PAD, y + 2, it.pillW, 36, 10);
            ctx.fillStyle = C.acento;
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = f(21, 700);
            ctx.fillText(it.etq, PAD + 17, y + 26);
          } else {
            ctx.fillStyle = C.acento;
            ctx.font = f(26, 700);
            ctx.fillText('•', PAD, y + 28);
          }
          ctx.fillStyle = C.texto;
          ctx.font = f(25, 400);
          var fy = y + 28;
          it.lineas.forEach(function (l) { ctx.fillText(l, it.txtX, fy); fy += 38; });
          break;
        }

        case 'imagen':
          ctx.fillStyle = C.superficie;
          ctx.fillRect(PAD, y, it.dw, it.dh);
          ctx.drawImage(it.el, PAD, y, it.dw, it.dh);
          ctx.strokeStyle = C.borde;
          ctx.lineWidth = 2;
          ctx.strokeRect(PAD, y, it.dw, it.dh);
          break;

        case 'pie':
          ctx.strokeStyle = C.borde;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(PAD, y + 40); ctx.lineTo(W - PAD, y + 40); ctx.stroke();
          ctx.font = f(19, 800);
          ctx.fillStyle = C.acento;
          ctx.fillText(espaciar('CORO BIHOTSAK'), PAD, y + 84);
          ctx.font = f(20, 500);
          ctx.fillStyle = C.texto;
          ctx.fillText('Resumen creado con ChorApp', PAD, y + 124);
          ctx.font = f(18, 500);
          ctx.fillStyle = C.texto2;
          ctx.fillText('© ' + year + ' ChorApp · Hecho con cariño por Endika Prado', PAD, y + 156);
          break;
      }
      y += it.h;
    });

    return y;
  }

  function espaciar(txt) { return String(txt).split('').join(' '); }

  /* ---------- utilidades de dibujo ---------- */

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
  function _hex(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function _mezcla(a, b, t) {
    var A = _hex(a), B = _hex(b);
    return 'rgb(' + A.map(function (v, i) { return Math.round(v * t + B[i] * (1 - t)); }).join(',') + ')';
  }

  /* ---------- carga de recursos (imágenes y PDF) ---------- */

  function cargarImg(blob) {
    return new Promise(function (res) {
      if (!blob) { res(null); return; }
      var url = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); res(im); };
      im.onerror = function () { URL.revokeObjectURL(url); res(null); };
      im.src = url;
    });
  }

  var _pdfLib = null;
  function cargarPdfLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (_pdfLib) return _pdfLib;
    _pdfLib = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) return reject(new Error('pdfjsLib'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('pdf.js')); };
      document.head.appendChild(s);
    });
    return _pdfLib;
  }

  // Devuelve un array de <canvas>/<img> (con .width/.height) para un blob
  // que puede ser imagen o PDF. `maxPag` limita las páginas de un PDF.
  function documentoAImagenes(blob, maxPag) {
    if (!blob) return Promise.resolve([]);
    var tipo = (blob.type || '') + ' ' + (blob.name || '');
    if (/^image\//.test(blob.type || '') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(blob.name || '')) {
      return cargarImg(blob).then(function (im) { return im ? [im] : []; });
    }
    if (/pdf/i.test(tipo)) {
      return cargarPdfLib()
        .then(function (lib) {
          return blob.arrayBuffer().then(function (buf) {
            return lib.getDocument({ data: buf }).promise;
          });
        })
        .then(function (pdf) {
          var n = Math.min(maxPag || 3, pdf.numPages);
          var out = [];
          var cadena = Promise.resolve();
          for (var i = 1; i <= n; i++) {
            (function (num) {
              cadena = cadena
                .then(function () { return pdf.getPage(num); })
                .then(function (p) {
                  var base = p.getViewport({ scale: 1 });
                  var escala = (COL / base.width) * 2;   // 2x para nitidez
                  var vp = p.getViewport({ scale: escala });
                  var cv = document.createElement('canvas');
                  cv.width = Math.round(vp.width);
                  cv.height = Math.round(vp.height);
                  return p.render({ canvasContext: cv.getContext('2d'), viewport: vp })
                    .promise.then(function () { out.push(cv); });
                });
            })(i);
          }
          return cadena.then(function () { return out; });
        })
        .catch(function () { return []; });
    }
    return Promise.resolve([]);
  }

  /* ---------- API pública ---------- */

  function generar(cancion, opts) {
    opts = opts || {};
    return Promise.all([
      documentoAImagenes(opts.partitura, 3),
      documentoAImagenes(opts.letra, 2),
      documentoAImagenes(opts.fonetica, 2),
    ]).then(function (ds) {
      var rec = { partitura: ds[0], letra: ds[1], fonetica: ds[2] };

      var medidor = document.createElement('canvas').getContext('2d');
      var items = construir(medidor, cancion, opts, rec);

      var cv = document.createElement('canvas');
      cv.width = W;
      cv.height = 10;
      var ctx = cv.getContext('2d');
      var alto = Math.ceil(pintar(ctx, items));

      return new Promise(function (res) {
        cv.toBlob(function (png) {
          cv.toBlob(function (jpeg) {
            var pdf = jpeg ? _pdfConImagen(jpeg, W, cv.height) : null;
            (pdf || Promise.resolve(null)).then(function (pdfBlob) {
              res({ imagen: png, pdf: pdfBlob, ancho: W, alto: alto });
            });
          }, 'image/jpeg', 0.9);
        }, 'image/png');
      });
    });
  }

  /* --- PDF mínimo: una página con la imagen JPEG a tamaño completo --- */
  function _pdfConImagen(jpegBlob, wPx, hPx) {
    return jpegBlob.arrayBuffer().then(function (buf) {
      var jpg = new Uint8Array(buf);
      var pw = 595;                              // ancho de página en puntos (~A4)
      var ph = Math.round(pw * hPx / wPx);
      var contenido = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';

      var cuerpos = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + ']' +
          ' /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /XObject /Subtype /Image /Width ' + wPx + ' /Height ' + hPx +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>',
        '<< /Length ' + contenido.length + ' >>'
      ];
      var streams = [null, null, null, jpg, _ascii(contenido)];

      var partes = [], off = [], pos = 0;
      function push(u8) { partes.push(u8); pos += u8.length; }

      push(_ascii('%PDF-1.4\n'));
      for (var i = 0; i < cuerpos.length; i++) {
        var n = i + 1;
        off[n] = pos;
        push(_ascii(n + ' 0 obj\n' + cuerpos[i] + '\n'));
        if (streams[i]) {
          push(_ascii('stream\n'));
          push(streams[i]);
          push(_ascii('\nendstream\n'));
        }
        push(_ascii('endobj\n'));
      }

      var xref = pos;
      var total = cuerpos.length + 1;
      var s = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
      for (var j = 1; j < total; j++) s += ('0000000000' + off[j]).slice(-10) + ' 00000 n \n';
      s += 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
      push(_ascii(s));

      var largo = partes.reduce(function (a, p) { return a + p.length; }, 0);
      var out = new Uint8Array(largo);
      var o = 0;
      partes.forEach(function (p) { out.set(p, o); o += p.length; });
      return new Blob([out], { type: 'application/pdf' });
    });
  }

  function _ascii(str) {
    var u = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 0xff;
    return u;
  }

  return { generar: generar };
})();
