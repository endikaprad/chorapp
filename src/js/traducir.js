/* ============================================================
   traducir.js — Traducción automática de letras.
   window.Traductor.traducir(texto, { de, a }) -> Promise<string>
   Se usa desde el modo estudio (botón "Traducir la letra").

   Dos servicios gratuitos, sin clave ni backend propio:
     1) Google Translate (endpoint interno, el de translate.google.com).
        - APK: petición directa (CapacitorHttp evita CORS).
        - `npm run dev`: pasa por el proxy /api/traducir de scripts/dev.js.
        - PWA publicada: sin proxy, no disponible por aquí.
     2) MyMemory (api.mymemory.translated.net) como respaldo si Google
        falla o limita el ritmo (error 429). Permite CORS, así que va
        directo en cualquier entorno. Límite anónimo ~5000 palabras/día
        por IP: de sobra para un uso personal.

   Endpoints no oficiales / con cuota: el texto se trocea por líneas y
   las peticiones van de una en una. Cualquier fallo se propaga para que
   quien llama muestre un aviso, sin romper nada.
   ============================================================ */

window.Traductor = (function () {
  'use strict';

  // Código de idioma de la app -> código ISO para los traductores.
  var CODIGOS = {
    es: 'es', eu: 'eu', la: 'la', de: 'de', en: 'en',
    fr: 'fr', it: 'it', pt: 'pt', ca: 'ca',
  };
  function codigoGoogle(idioma) { return CODIGOS[idioma] || 'auto'; }

  function esNativo() {
    return !!(window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform());
  }

  // Divide el texto en trozos por líneas, sin pasar de `max` caracteres.
  function trocear(texto, max) {
    var lineas = texto.split('\n');
    var trozos = [];
    var actual = '';
    lineas.forEach(function (l) {
      var cand = actual ? actual + '\n' + l : l;
      if (cand.length > max && actual) { trozos.push(actual); actual = l; }
      else { actual = cand; }
    });
    if (actual !== '') trozos.push(actual);
    return trozos.length ? trozos : [texto];
  }

  // Encadena la traducción de cada trozo (secuencial) y los une con \n.
  function porTrozos(texto, max, fn) {
    return trocear(texto, max).reduce(function (cadena, trozo) {
      return cadena.then(function (acc) {
        return fn(trozo).then(function (t) { acc.push(t != null ? t : ''); return acc; });
      });
    }, Promise.resolve([])).then(function (partes) { return partes.join('\n'); });
  }

  /* ---------- 1) Google Translate ---------- */

  var HOSTS = ['translate.googleapis.com', 'translate.google.com', 'clients5.google.com'];

  function urlGoogle(host, trozo, de, a) {
    return 'https://' + host + '/translate_a/single?client=gtx&dt=t' +
      '&sl=' + encodeURIComponent(de) + '&tl=' + encodeURIComponent(a) +
      '&q=' + encodeURIComponent(trozo);
  }
  function urlProxy(trozo, de, a) {
    return 'api/traducir?sl=' + encodeURIComponent(de) +
      '&tl=' + encodeURIComponent(a) + '&q=' + encodeURIComponent(trozo);
  }
  // json[0] = [ [traducido, original, …], … ]
  function parsearGoogle(json) {
    try {
      return (json[0] || []).map(function (s) { return s[0]; }).join('');
    } catch (e) { return ''; }
  }

  function trozoGoogle(trozo, de, a) {
    var urls = esNativo()
      ? HOSTS.map(function (h) { return urlGoogle(h, trozo, de, a); })
      : [urlProxy(trozo, de, a)];
    function intentar(i) {
      return fetch(urls[i]).then(function (r) {
        if (r && r.ok) return r.json().then(parsearGoogle);
        // Ante 429 / 5xx probamos el siguiente host (si lo hay) y, si no,
        // fallamos rápido para pasar al respaldo (no insistir: empeora el 429).
        if (r && (r.status === 429 || r.status >= 500) && i + 1 < urls.length) return intentar(i + 1);
        throw new Error('traducir ' + (r && r.status));
      });
    }
    return intentar(0);
  }

  function viaGoogle(texto, de, a) {
    return porTrozos(texto, 1500, function (t) { return trozoGoogle(t, de, a); });
  }

  /* ---------- 2) MyMemory (respaldo) ---------- */

  // MyMemory devuelve el texto con entidades HTML (&#10; por salto de línea,
  // &#39; por apóstrofo…). Las deshacemos.
  function decodificarEntidades(s) {
    if (!s || s.indexOf('&') === -1) return s;
    try {
      var ta = document.createElement('textarea');
      ta.innerHTML = s;
      return ta.value;
    } catch (e) { return s; }
  }

  function trozoMyMemory(trozo, de, a) {
    var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(trozo) +
      '&langpair=' + encodeURIComponent(de + '|' + a);
    return fetch(url).then(function (r) {
      if (!r || !r.ok) throw new Error('mymemory ' + (r && r.status));
      return r.json();
    }).then(function (j) {
      var aviso = j && j.responseDetails;
      if (!j || j.responseStatus !== 200 || /MYMEMORY WARNING|QUOTA/i.test(aviso || '')) {
        throw new Error('mymemory ' + (j && j.responseStatus));
      }
      var t = (j.responseData && j.responseData.translatedText) || '';
      return decodificarEntidades(t)
        .split('\n').map(function (l) { return l.trim(); }).join('\n');
    });
  }

  function viaMyMemory(texto, de, a) {
    // MyMemory necesita idioma de origen concreto (no tiene autodetección).
    if (!de || de === 'auto') return Promise.reject(new Error('mymemory sin idioma'));
    return porTrozos(texto, 450, function (t) { return trozoMyMemory(t, de, a); });
  }

  /* ---------- API ---------- */

  // Traduce un texto de una sola línea (o pocas). Google primero, MyMemory
  // de respaldo. Devuelve la traducción "aplanada" a una línea.
  function unaLinea(linea, de, a) {
    return trozoGoogle(linea, de, a)
      .catch(function (err) {
        if (!de || de === 'auto') throw err;
        return trozoMyMemory(linea, de, a);
      })
      .then(function (t) {
        return String(t || '').replace(/\s*\n\s*/g, ' ').trim();
      });
  }

  // Lanza `tareas` (funciones que devuelven Promise) con como mucho `n` en
  // vuelo a la vez. Mantiene el orden del resultado. Sirve para pedir varios
  // bloques a Google en paralelo sin disparar el 429.
  function enPool(tareas, n) {
    var res = new Array(tareas.length);
    var sig = 0;
    function siguiente() {
      if (sig >= tareas.length) return Promise.resolve();
      var idx = sig++;
      return tareas[idx]().then(function (v) { res[idx] = v; return siguiente(); });
    }
    var arranques = [];
    for (var k = 0; k < Math.min(n, tareas.length); k++) arranques.push(siguiente());
    return Promise.all(arranques).then(function () { return res; });
  }

  // Traduce conservando EXACTAMENTE la estructura de líneas del original
  // (una línea de salida por cada línea de entrada; las líneas en blanco se
  // quedan en blanco). Necesario para que la sincronía de la letra —anclada
  // verso a verso— encaje también en la traducción.
  //
  // Antes se pedían los bloques de uno en uno (una letra larga = 6-10
  // peticiones EN SERIE, de ahí la espera). Ahora se arma la lista de bloques
  // de golpe y se piden EN PARALELO (hasta 4 a la vez): la letra entera tarda
  // más o menos lo que un solo bloque.
  function traducirPorVersos(texto, de, a, onProgreso) {
    var lineas = texto.split('\n');
    var salida = new Array(lineas.length);
    var bloques = [];   // [{ items: [{ i, txt }] }]
    var pend = [];
    function cerrar() {
      if (pend.length) { bloques.push({ items: pend }); pend = []; }
    }
    lineas.forEach(function (linea, i) {
      if (!linea.trim()) { salida[i] = ''; cerrar(); return; }
      pend.push({ i: i, txt: linea.trim() });
      var largo = pend.reduce(function (n, p) { return n + p.txt.length + 1; }, 0);
      var fin = (i + 1 >= lineas.length) || !lineas[i + 1].trim();
      if (fin || largo >= 1500) cerrar();
    });
    cerrar();

    function resolverBloque(bloque) {
      var items = bloque.items;
      var junto = items.map(function (p) { return p.txt; }).join('\n');
      // Reparto verso a verso (con respaldo), para descuadres o fallo total.
      function versoAVerso() {
        return items.reduce(function (c2, p) {
          return c2.then(function () {
            return unaLinea(p.txt, de, a).then(function (t) { salida[p.i] = t; });
          });
        }, Promise.resolve());
      }
      return trozoGoogle(junto, de, a).then(function (tr) {
        var partes = String(tr || '').split('\n')
          .map(function (l) { return l.trim(); }).filter(Boolean);
        if (partes.length === items.length) {
          items.forEach(function (p, k) { salida[p.i] = partes[k]; });
          return;
        }
        return versoAVerso();
      }, function (err) {
        return versoAVerso().catch(function () { throw err; });
      });
    }

    var hechos = 0;
    var tareas = bloques.map(function (b) {
      return function () {
        return resolverBloque(b).then(function (v) {
          hechos++;
          if (typeof onProgreso === 'function') {
            try { onProgreso(hechos / (bloques.length || 1)); } catch (e) {}
          }
          return v;
        });
      };
    });
    return enPool(tareas, 4).then(function () {
      return salida.map(function (l) { return l == null ? '' : l; }).join('\n');
    });
  }

  // texto: letra original. opts.de: idioma origen ('auto' si no se sabe).
  // opts.a: idioma destino (por defecto español).
  function traducir(texto, opts) {
    opts = opts || {};
    texto = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').trim();
    if (!texto) return Promise.reject(new Error('vacío'));

    var de = opts.de || 'auto';
    var a = opts.a || 'es';
    var onProgreso = typeof opts.onProgreso === 'function' ? opts.onProgreso : null;
    var nOrig = texto.split('\n').filter(function (l) { return l.trim(); }).length;

    return traducirPorVersos(texto, de, a, onProgreso)
      .catch(function (errVersos) {
        // Último recurso: traducción "en bloque" (puede descuadrar líneas).
        return viaGoogle(texto, de, a)
          .catch(function () { return viaMyMemory(texto, de, a).catch(function () { throw errVersos; }); });
      })
      .then(function (res) {
        res = String(res || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (!res) throw new Error('sin resultado');
        // Si aún así el nº de versos no cuadra, se avisa a quien llama para
        // que sepa que la sincronía quizá no encaje fino (no rompe nada).
        var nRes = res.split('\n').filter(function (l) { return l.trim(); }).length;
        if (nOrig >= 2 && nRes !== nOrig && window.console) {
          console.warn('Traductor: ' + nOrig + ' versos -> ' + nRes + ' traducidos');
        }
        return res;
      });
  }

  return {
    traducir: traducir,
    codigoGoogle: codigoGoogle,
  };
})();
