/* ============================================================
   fonetica.js — Ayuda de IA para las letras.
   window.IA.fonetica(texto, { idioma })  -> Promise<string>   (cómo suena)
   window.IA.traducir(texto, { idioma })  -> Promise<string>   (traducción)
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

  // tarea: 'fonetica' | 'traduccion' | 'comentario'
  function pedir(tarea, texto, idioma) {
    texto = String(texto == null ? '' : texto).replace(/\r\n?/g, '\n').trim();
    if (!texto) return Promise.reject(new Error('vacío'));

    var cuerpo = JSON.stringify({ tarea: tarea, texto: texto, idioma: idioma || '' });

    return base().then(function (cfg) {
      var urls = [];
      if (cfg.url) urls.push(cfg.url + '/ia');   // Worker (APK y navegador: CORS abierto)
      urls.push('api/ia');                       // respaldo: proxy de scripts/dev.js

      var cabeceras = { 'Content-Type': 'application/json' };
      if (cfg.token) cabeceras['X-IA-Token'] = cfg.token;

      function intentar(i) {
        return fetch(urls[i], {
          method: 'POST',
          headers: cabeceras,
          body: cuerpo,
        }).then(function (r) {
          if (r && r.ok) return r.json();
          if (i + 1 < urls.length) return intentar(i + 1);
          throw new Error('ia ' + (r && r.status));
        }, function (e) {
          if (i + 1 < urls.length) return intentar(i + 1);
          throw e;
        });
      }
      return intentar(0);
    }).then(function (j) {
      var t = String((j && j.texto) || '').replace(/\n{3,}/g, '\n\n').trim();
      if (!t) throw new Error('sin resultado');
      return t;
    });
  }

  return {
    fonetica: function (texto, opts) { return pedir('fonetica', texto, (opts || {}).idioma); },
    traducir: function (texto, opts) { return pedir('traduccion', texto, (opts || {}).idioma); },
    comentario: function (texto) { return pedir('comentario', texto, ''); },
  };
})();
