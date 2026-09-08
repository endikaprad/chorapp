/* ============================================================
   compartircancion.js — Genera un "resumen de estudio" de una
   canción con el diseño de ChorApp para compartir con una
   compañera del coro que no tiene la app.

   Incluye: título, compositor, idioma, estado, la letra (original,
   cómo suena y traducción), los trozos difíciles y la partitura
   (si es imagen). NO incluye las grabaciones de Maite.

   window.CompartirCancion.generar(cancion, opts) -> Promise<{
       imagen: Blob (PNG),
       pdf:    Blob (application/pdf),
       ancho, alto
   }>
     opts.fragmentos : [{ texto }]   (trozos difíciles de la toma actual)
     opts.notaToma   : string        (apunte del día, opcional)
     opts.partitura  : Blob          (si la canción tiene partitura imagen)

   Todo con <canvas> (cero dependencias, seguro en el WebView).
   El PDF es una sola página con la imagen incrustada (JPEG).
   ============================================================ */

window.CompartirCancion = (function () {
  'use strict';

  var W = 1080;                 // ancho del lienzo (px reales)
  var PAD = 84;
  var COL = W - PAD * 2;

  var C = {
    acento: '#1512D6',
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

  /* Pinta (o solo mide, si m.pintar === false) el resumen entero.
     Devuelve la altura total usada. */
  function componer(ctx, cancion, opts, img, pintar) {
    var y = 0;
    opts = opts || {};

    function avanza(dy) { y += dy; }
    function seccion(txt) {
      avanza(68);
      if (pintar) {
        ctx.font = f(22, 700);
        ctx.fillStyle = C.acento;
        ctx.fillText(txt.toUpperCase(), PAD, y);
      }
      avanza(26);
      if (pintar) {
        ctx.strokeStyle = C.borde;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(PAD, y - 6);
        ctx.lineTo(W - PAD, y - 6);
        ctx.stroke();
      }
      avanza(34);
    }
    function bloqueTexto(txt, tam, color, interlineado) {
      ctx.font = f(tam, 400);
      var lineas = envolver(ctx, txt, COL);
      var lh = interlineado || Math.round(tam * 1.5);
      lineas.forEach(function (l) {
        if (pintar) { ctx.fillStyle = color; ctx.fillText(l, PAD, y); }
        avanza(lh);
      });
      avanza(8);
    }
    function subtit(txt) {
      avanza(30);
      if (pintar) {
        ctx.font = f(19, 700);
        ctx.fillStyle = C.texto2;
        ctx.fillText(txt.toUpperCase(), PAD, y);
      }
      avanza(36);
    }

    // --- Fondo ---
    if (pintar) {
      ctx.fillStyle = C.fondo;
      ctx.fillRect(0, 0, W, ctx.canvas.height);
    }

    // --- Cabecera ---
    avanza(PAD + 10);
    if (pintar) {
      ctx.font = f(20, 700);
      ctx.fillStyle = C.acento;
      ctx.fillText('CHORAPP · CORO BIHOTSAK', PAD, y);
    }
    avanza(52);

    ctx.font = f(52, 800);
    envolver(ctx, cancion.titulo || 'Canción', COL).forEach(function (l) {
      if (pintar) { ctx.fillStyle = C.texto; ctx.fillText(l, PAD, y); }
      avanza(60);
    });
    if (cancion.compositor) {
      avanza(8);
      if (pintar) {
        ctx.font = f(28, 500);
        ctx.fillStyle = C.texto2;
        ctx.fillText(cancion.compositor, PAD, y);
      }
      avanza(46);
    }

    // --- Chips (idioma / estado) ---
    var chips = [];
    var idioma = window.Canciones && window.Canciones.nombreIdioma
      ? window.Canciones.nombreIdioma(cancion.idioma) : '';
    if (idioma) chips.push({ t: idioma, c: C.texto2 });
    var est = window.Canciones && window.Canciones.ESTADOS && window.Canciones.ESTADOS[cancion.estado];
    if (est) chips.push({ t: est.etiqueta, c: C[cancion.estado] || C.texto2 });
    (cancion.etiquetas || []).slice(0, 3).forEach(function (e) { chips.push({ t: e, c: C.texto2 }); });

    if (chips.length) {
      avanza(30);
      var cx = PAD;
      ctx.font = f(21, 700);
      chips.forEach(function (ch) {
        var w = ctx.measureText(ch.t.toUpperCase()).width + 34;
        if (pintar) {
          _roundRect(ctx, cx, y - 22, w, 40, 20);
          ctx.fillStyle = _mezcla(ch.c, C.fondo, 0.14);
          ctx.fill();
          ctx.fillStyle = ch.c;
          ctx.fillText(ch.t.toUpperCase(), cx + 17, y);
        }
        cx += w + 12;
      });
      avanza(44);
    }

    // --- Nota del día (apunte de la toma) ---
    if (opts.notaToma && opts.notaToma.trim()) {
      avanza(28);
      var texto = '« ' + opts.notaToma.trim() + ' »';
      ctx.font = f(26, 500);
      var lns = envolver(ctx, texto, COL - 40);
      var altura = lns.length * 40 + 44;
      if (pintar) {
        _roundRect(ctx, PAD, y - 8, COL, altura, 16);
        ctx.fillStyle = _mezcla(C.acento, C.fondo, 0.1);
        ctx.fill();
      }
      var yy = y + 30;
      lns.forEach(function (l) {
        if (pintar) { ctx.fillStyle = C.texto; ctx.fillText(l, PAD + 20, yy); }
        yy += 40;
      });
      avanza(altura + 18);
    }

    // --- Letra ---
    var hayLetra = (cancion.letraTexto && cancion.letraTexto.trim()) ||
                   (cancion.letraFonetica && cancion.letraFonetica.trim()) ||
                   (cancion.letraTraduccion && cancion.letraTraduccion.trim());
    if (hayLetra) {
      seccion('La letra');
      if (cancion.letraTexto && cancion.letraTexto.trim()) {
        bloqueTexto(cancion.letraTexto, 27, C.texto, 44);
      }
      if (cancion.letraFonetica && cancion.letraFonetica.trim()) {
        subtit('Cómo suena');
        bloqueTexto(cancion.letraFonetica, 27, C.texto2, 44);
      }
      if (cancion.letraTraduccion && cancion.letraTraduccion.trim()) {
        subtit('Qué significa');
        bloqueTexto(cancion.letraTraduccion, 26, C.texto2, 42);
      }
    }

    // --- Trozos difíciles ---
    var frags = (opts.fragmentos || []).filter(function (x) { return x && x.texto && x.texto.trim(); });
    if (frags.length) {
      seccion('Trozos difíciles');
      frags.forEach(function (fr) {
        ctx.font = f(26, 400);
        var lns = envolver(ctx, fr.texto.trim(), COL - 36);
        lns.forEach(function (l, k) {
          if (pintar) {
            if (k === 0) {
              ctx.fillStyle = C.acento;
              ctx.fillText('•', PAD, y);
            }
            ctx.fillStyle = C.texto;
            ctx.fillText(l, PAD + 36, y);
          }
          avanza(42);
        });
        avanza(16);
      });
    }

    // --- Partitura ---
    if (img && img.width) {
      seccion('Partitura');
      var escala = Math.min(COL / img.width, 1);
      var iw = img.width * escala;
      var ih = img.height * escala;
      // límite de altura para que no se desborde demasiado
      if (ih > 1400) { var k = 1400 / ih; iw *= k; ih *= k; }
      if (pintar) {
        ctx.strokeStyle = C.borde;
        ctx.lineWidth = 2;
        ctx.strokeRect(PAD, y, iw, ih);
        ctx.drawImage(img, PAD, y, iw, ih);
      }
      avanza(ih + 24);
    }

    // --- Pie ---
    avanza(56);
    if (pintar) {
      ctx.font = f(20, 500);
      ctx.fillStyle = C.texto2;
      ctx.fillText('Resumen creado con ChorApp', PAD, y);
    }
    avanza(PAD);

    return y;
  }

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

  function cargarImg(blob) {
    return new Promise(function (res) {
      if (!blob || !/^image\//.test(blob.type || '')) { res(null); return; }
      var url = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); res(im); };
      im.onerror = function () { URL.revokeObjectURL(url); res(null); };
      im.src = url;
    });
  }

  function generar(cancion, opts) {
    opts = opts || {};
    return cargarImg(opts.partitura).then(function (img) {
      // Pasada 1: medir.
      var medidor = document.createElement('canvas').getContext('2d');
      var alto = Math.ceil(componer(medidor, cancion, opts, img, false));

      // Pasada 2: pintar.
      var cv = document.createElement('canvas');
      cv.width = W;
      cv.height = alto;
      var ctx = cv.getContext('2d');
      ctx.textBaseline = 'alphabetic';
      componer(ctx, cancion, opts, img, true);

      return new Promise(function (res) {
        cv.toBlob(function (png) {
          cv.toBlob(function (jpeg) {
            var pdf = jpeg ? _pdfConImagen(jpeg, W, alto) : null;
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
