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

  // texto: letra original. opts.de: idioma origen ('auto' si no se sabe).
  // opts.a: idioma destino (por defecto español).
  function traducir(texto, opts) {
    opts = opts || {};
    texto = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').trim();
    if (!texto) return Promise.reject(new Error('vacío'));

    var de = opts.de || 'auto';
    var a = opts.a || 'es';

    return viaGoogle(texto, de, a)
      .catch(function (errGoogle) {
        return viaMyMemory(texto, de, a).catch(function () { throw errGoogle; });
      })
      .then(function (res) {
        res = String(res || '').replace(/\n{3,}/g, '\n\n').trim();
        if (!res) throw new Error('sin resultado');
        return res;
      });
  }

  return {
    traducir: traducir,
    codigoGoogle: codigoGoogle,
  };
})();
