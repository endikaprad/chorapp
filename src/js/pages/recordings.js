/* ============================================================
   Pagina_recordings — Grabadora personal (Fase 7)
   Grabar cantando, guardar por canción y fecha, escuchar y borrar.
   ============================================================ */

window.Pagina_recordings = (function () {
  'use strict';

  var raiz, selCancion, btnRec, btnRecTxt, aviso, lista, vacio;
  var grabadora = null, crono = null, urls = [];
  var obs = null;

  function iniciar(contenedor) {
    limpiar();

    raiz = contenedor.querySelector('[data-modulo="recordings"]');
    selCancion = raiz.querySelector('[data-cancion]');
    btnRec = raiz.querySelector('[data-rec]');
    btnRecTxt = raiz.querySelector('[data-rec-txt]');
    aviso = raiz.querySelector('[data-aviso]');
    lista = raiz.querySelector('[data-lista]');
    vacio = raiz.querySelector('[data-vacio]');

    // Rellena el desplegable con las canciones.
    (window.Canciones ? window.Canciones.listar() : []).forEach(function (c) {
      var op = document.createElement('option');
      op.value = c.id;
      op.textContent = c.titulo;
      selCancion.appendChild(op);
    });

    if (!window.Grabadora.soportado()) {
      btnRec.disabled = true;
      aviso.textContent = 'Este dispositivo no permite grabar audio desde la app.';
      aviso.hidden = false;
    }

    btnRec.addEventListener('click', alternar);
    pintarLista();

    var vista = document.getElementById('vista');
    obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) destruir();
    });
    obs.observe(vista, { childList: true, subtree: true });
  }

  function destruir() {
    if (obs) { obs.disconnect(); obs = null; }
    if (grabadora) { grabadora.cancelar(); grabadora = null; }
    if (crono) { clearInterval(crono); crono = null; }
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];
  }

  function limpiar() { destruir(); }

  /* ---------- Grabación ---------- */

  function alternar() {
    if (grabadora && grabadora.grabando) return detener();
    empezar();
  }

  function empezar() {
    grabadora = window.Grabadora.crear();
    grabadora.iniciar().then(function () {
      var t0 = Date.now();
      raiz.classList.add('is-grabando');
      btnRec.classList.add('is-grabando');
      selCancion.disabled = true;
      btnRecTxt.textContent = 'Detener (0:00)';
      crono = setInterval(function () {
        btnRecTxt.textContent = 'Detener (' + fmt((Date.now() - t0) / 1000) + ')';
      }, 500);
      btnRec._t0 = t0;
    }).catch(function () {
      grabadora = null;
      aviso.textContent = 'No se pudo acceder al micrófono. Revisa los permisos.';
      aviso.hidden = false;
    });
  }

  function detener() {
    var g = grabadora; grabadora = null;
    var dur = (Date.now() - (btnRec._t0 || Date.now())) / 1000;
    if (crono) { clearInterval(crono); crono = null; }
    btnRec.disabled = true;
    g.parar().then(function (blob) {
      btnRec.disabled = false;
      raiz.classList.remove('is-grabando');
      btnRec.classList.remove('is-grabando');
      selCancion.disabled = false;
      btnRecTxt.textContent = 'Empezar a grabar';
      if (!blob || !blob.size) return;

      var id = selCancion.value;
      var c = id && window.Canciones ? window.Canciones.obtener(id) : null;
      return window.Grabaciones.crear({
        cancionId: c ? c.id : null,
        titulo: c ? c.titulo : 'Sin canción concreta',
        mime: blob.type,
        dur: Math.round(dur),
      }, blob).then(pintarLista);
    });
  }

  /* ---------- Lista ---------- */

  function pintarLista() {
    urls.forEach(function (u) { window.Archivos.liberar(u); });
    urls = [];

    var grabs = window.Grabaciones ? window.Grabaciones.listar() : [];
    vacio.hidden = grabs.length > 0;
    lista.innerHTML = '';
    if (!grabs.length) return;

    var cont = document.createElement('div');
    cont.className = 'lista';
    grabs.forEach(function (g) {
      var fila = document.createElement('div');
      fila.className = 'grabacion';
      fila.innerHTML =
        '<div class="grabacion__cab">' +
          '<span class="grabacion__titulo">' + escapar(g.titulo) + '</span>' +
          '<span class="grabacion__fecha">' + fmtFecha(g.creado) +
            (g.dur ? ' · ' + fmt(g.dur) : '') + '</span>' +
        '</div>' +
        '<div class="grabacion__fila">' +
          '<audio controls preload="none"></audio>' +
          '<button type="button" class="ficha__quitar" aria-label="Eliminar grabación">✕</button>' +
        '</div>';
      var audio = fila.querySelector('audio');
      window.Grabaciones.url(g.id).then(function (u) {
        if (u) { urls.push(u); audio.src = u; }
      });
      fila.querySelector('.ficha__quitar').addEventListener('click', function () {
        if (!window.confirm('¿Eliminar esta grabación? No se puede deshacer.')) return;
        window.Grabaciones.borrar(g.id).then(pintarLista);
      });
      cont.appendChild(fila);
    });
    lista.appendChild(cont);
  }

  /* ---------- Utilidades ---------- */

  function fmt(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var m = Math.floor(seg / 60), s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtFecha(ts) {
    try {
      return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
    } catch (e) { return ''; }
  }
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
