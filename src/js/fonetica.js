/* ============================================================
   fonetica.js — Ayuda de IA para las letras.
   window.IA.fonetica(texto, { idioma })  -> Promise<string>   (cómo suena)
   window.IA.traducir(texto, { idioma })  -> Promise<string>   (traducción)
   window.IA.buscarLetra(titulo, { compositor, idioma }) -> Promise<string>  (letra)
   window.IA.comentario(texto)            -> Promise<string>   (comentario de "la profe" tras el test de memoria)

   Se usa desde el modo estudio (botón "Generar cómo se pronuncia" y
   el test de memoria de la letra).

   Todo el trabajo lo hace el Cloudflare Worker (ruta POST /ia): la clave
   de Gemini vive allí, nunca en el APK. La app solo manda
   { tarea, texto, idioma } y recibe { texto }. El Worker cachea por
   contenido, así que volver a pulsar el botón no gasta cuota.

   La URL del Worker se lee de src/data/coro.json ("worker"), la misma
   que usa la tarjeta "Del coro". Si no está configurada, o el Worker no
   responde, quien llama muestra un aviso y no se rompe nada.
   ============================================================ */

window.IA = (function () {
  'use strict';

  var cfgIA;   // undefined = sin resolver todavía; luego { url, token }

  // Lee una sola vez la URL del Worker y el token de data/coro.json.
  function base() {
    if (cfgIA !== undefined) return Promise.resolve(cfgIA);
    return fetch('data/coro.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        cfgIA = {
          url: (cfg && cfg.worker) ? String(cfg.worker).replace(/\/+$/, '') : '',
          token: (cfg && cfg.iaToken) ? String(cfg.iaToken) : '',
        };
        return cfgIA;
      })
      .catch(function () { cfgIA = { url: '', token: '' }; return cfgIA; });
  }

  // Manda un cuerpo cualquiera a la ruta /ia del Worker (con respaldo al
  // proxy de dev) y devuelve el JSON de respuesta ya parseado.
  //   timeoutMs: corta la petición si el Worker/Gemini se cuelga (0 = sin tope).
  function enviar(cuerpoObj, timeoutMs) {
    var cuerpo = JSON.stringify(cuerpoObj);
    return base().then(function (cfg) {
      var urls = [];
      if (cfg.url) urls.push(cfg.url + '/ia');   // Worker (APK y navegador: CORS abierto)
      urls.push('api/ia');                       // respaldo: proxy de scripts/dev.js

      var cabeceras = { 'Content-Type': 'application/json' };
      if (cfg.token) cabeceras['X-IA-Token'] = cfg.token;

      function intentar(i) {
        // Timeout por intento con AbortController (si el navegador lo soporta).
        var ctrl = (timeoutMs && typeof AbortController === 'function')
          ? new AbortController() : null;
        var reloj = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
        return fetch(urls[i], {
          method: 'POST',
          headers: cabeceras,
          body: cuerpo,
          signal: ctrl ? ctrl.signal : undefined,
        }).then(function (r) {
          if (reloj) { clearTimeout(reloj); reloj = null; }
          return r;
        }, function (e) {
          if (reloj) { clearTimeout(reloj); reloj = null; }
          throw e;
        }).then(function (r) {
          // Leemos como texto y parseamos a mano (si el Worker cae, Cloudflare
          // manda una página HTML y `r.json()` lanza un SyntaxError feo).
          return r.text().then(function (txt) {
            var j = null;
            try { j = JSON.parse(txt); } catch (e) { j = null; }
            if (j) {
              // El servidor SÍ respondió con JSON: es la respuesta buena o un
              // error concreto suyo. No tiene sentido probar más URLs.
              if (r.ok && !j.error) return j;
              throw new Error('ia: ' + (j.detalle || j.error || ('HTTP ' + r.status)));
            }
            // Cuerpo no-JSON: endpoint equivocado o servicio caído -> siguiente.
            if (i + 1 < urls.length) return intentar(i + 1);
            throw new Error('ia: HTTP ' + r.status + ' (respuesta no válida)');
          });
        }, function (e) {
          if (i + 1 < urls.length) return intentar(i + 1);
          throw e;
        });
      }
      return intentar(0);
    });
  }

  // tarea: 'fonetica' | 'traduccion' | 'comentario'
  function pedir(tarea, texto, idioma) {
    texto = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').trim();
    if (!texto) return Promise.reject(new Error('vacío'));
    // Fonética/traducción/comentario: si Gemini se cuelga (letras repetitivas o
    // sin sentido le hacen "pensar" sin fin), cortamos a los 40 s para no dejar
    // el botón girando. Si el corte salta por timeout/red (no un error real del
    // servidor), reintentamos UNA vez: el Worker ya habrá cacheado el modelo
    // rápido y la 2ª suele volver enseguida. Quien llama tiene su propio
    // respaldo (Google).
    var cuerpo = { tarea: tarea, texto: texto, idioma: idioma || '' };
    function corre(reintentos) {
      return enviar(cuerpo, 40000).then(function (j) {
        var t = String((j && j.texto) || '').replace(/\n{3,}/g, '\n\n').trim();
        if (!t) throw new Error('sin resultado');
        return t;
      }, function (e) {
        var red = e && (e.name === 'AbortError' ||
          /abort|network|failed to fetch|load failed/i.test(String(e.message || '')));
        if (red && reintentos > 0) return corre(reintentos - 1);
        throw e;
      });
    }
    return corre(1);
  }

  // Sincronía de la letra con el audio.
  //   lineas: array de strings (una por verso, sin líneas en blanco)
  //   opts:   { audioBase64, mime, dur, idioma }
  // Devuelve { tiempos: [seg…], aprox: bool, via: 'whisper'|'gemini'|'aprox' }.
  // `aprox` = la IA no estaba disponible y el Worker devolvió un reparto
  // aproximado para ajustar a mano. `via` = qué motor colocó los versos
  // ('whisper' alinea palabras reales y es el fiable).
  function sincronizar(lineas, opts) {
    opts = opts || {};
    lineas = (lineas || []).map(function (l) { return String(l == null ? '' : l); })
      .filter(function (l) { return l.trim(); });
    if (lineas.length < 2) return Promise.reject(new Error('pocas líneas'));
    if (!opts.audioBase64) return Promise.reject(new Error('sin audio'));
    var cuerpo = {
      tarea: 'sincronia',
      lineas: lineas,
      audio: opts.audioBase64,
      mime: opts.mime || 'audio/mpeg',
      dur: opts.dur || 0,
      idioma: opts.idioma || '',
    };
    // Plantilla aprendida de ajustes a mano anteriores de ESTA canción (en qué
    // fracción de la pieza entra cada verso): mismo nº de fracciones que
    // versos, o no se manda.
    if (Array.isArray(opts.plantilla) && opts.plantilla.length === lineas.length) {
      cuerpo.plantilla = opts.plantilla;
    }
    return enviar(cuerpo).then(function (j) {
      var t = j && j.tiempos;
      if (!Array.isArray(t) || !t.length) throw new Error('sin resultado');
      return {
        tiempos: t.map(Number).filter(function (n) { return isFinite(n) && n >= 0; }),
        aprox: !!(j && j.aprox),
        via: (j && j.via) || (j && j.aprox ? 'aprox' : 'gemini'),
      };
    });
  }

  // Busca la letra de una canción a partir del título (y compositor opcional).
  //   opts: { compositor, idioma }
  // Devuelve la letra como texto. Si la IA no la conoce, rechaza con
  // Error('no encontrada').
  function buscarLetra(titulo, opts) {
    opts = opts || {};
    titulo = String(titulo == null ? '' : titulo).trim();
    if (!titulo) return Promise.reject(new Error('sin título'));
    return enviar({
      tarea: 'letra',
      texto: titulo,
      compositor: opts.compositor || '',
      idioma: opts.idioma || '',
    }).then(function (j) {
      var t = String((j && j.texto) || '').replace(/\n{3,}/g, '\n\n').trim();
      if (!t) throw new Error('sin resultado');
      if (/^NO_ENCONTRADA/i.test(t)) throw new Error('no encontrada');
      return t;
    });
  }

  // Lanza `tareas` (funciones -> Promise) con como mucho `n` en vuelo a la vez,
  // conservando el orden del resultado. Sirve para trocear una letra larga y
  // pedir los trozos casi en paralelo (más rápido) sin disparar la cuota.
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

  // fonetica / traduccion troceadas por bloques de versos, EN PARALELO.
  // Una letra larga en 1 sola petición a Gemini tarda 15-30 s; partida en
  // bloques de ~8 versos (2 peticiones a la vez) baja a la mitad o menos, y
  // además deja informar del progreso real (`opts.onProgreso(0..1)`).
  // Recompone verso a verso para encajar 1:1 con la letra original.
  function porBloques(tarea, texto, opts) {
    opts = opts || {};
    texto = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').trim();
    if (!texto) return Promise.reject(new Error('vacío'));
    var idioma = opts.idioma || '';
    var onProg = typeof opts.onProgreso === 'function' ? opts.onProgreso : function () {};

    var lineas = texto.split('\n');
    var idxVersos = [];               // posiciones (en `lineas`) de los versos no vacíos
    lineas.forEach(function (l, i) { if (l.trim()) idxVersos.push(i); });
    var total = idxVersos.length;

    // Letra corta: no merece la pena trocear.
    if (total < 12) {
      return pedir(tarea, texto, idioma).then(function (r) { onProg(1); return r; });
    }

    var POR_BLOQUE = 8;
    var bloques = [];
    for (var b = 0; b < total; b += POR_BLOQUE) bloques.push(idxVersos.slice(b, b + POR_BLOQUE));

    var salida = lineas.slice();     // se sobrescriben solo las posiciones de verso
    var hechos = 0;

    function resolverBloque(posiciones) {
      var versos = posiciones.map(function (i) { return lineas[i].trim(); });
      function unoAUno() {
        return posiciones.reduce(function (c, i) {
          return c.then(function () {
            return pedir(tarea, lineas[i].trim(), idioma).then(function (t) {
              salida[i] = String(t || '').split('\n').map(function (x) { return x.trim(); })
                .filter(Boolean).join(' ') || lineas[i].trim();
            });
          });
        }, Promise.resolve());
      }
      return pedir(tarea, versos.join('\n'), idioma).then(function (r) {
        var partes = String(r || '').split('\n')
          .map(function (l) { return l.trim(); }).filter(Boolean);
        if (partes.length === posiciones.length) {
          posiciones.forEach(function (i, k) { salida[i] = partes[k]; });
          return;
        }
        return unoAUno();
      }, function () { return unoAUno(); });
    }

    var tareas = bloques.map(function (pos) {
      return function () {
        return resolverBloque(pos).then(function () {
          hechos++;
          try { onProg(hechos / bloques.length); } catch (e) {}
        });
      };
    });

    return enPool(tareas, 2).then(function () {
      var res = salida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!res) throw new Error('sin resultado');
      return res;
    });
  }

  return {
    fonetica: function (texto, opts) { return pedir('fonetica', texto, (opts || {}).idioma); },
    foneticaPorBloques: function (texto, opts) { return porBloques('fonetica', texto, opts); },
    traduccionPorBloques: function (texto, opts) { return porBloques('traduccion', texto, opts); },
    buscarLetra: buscarLetra,
    traducir: function (texto, opts) { return pedir('traduccion', texto, (opts || {}).idioma); },
    comentario: function (texto) { return pedir('comentario', texto, ''); },
    sincronizar: sincronizar,
  };
})();
