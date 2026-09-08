/* ============================================================
   Pagina_song — Ficha de una canción del repertorio.

   Reúne lo que no depende de la sesión: estado, compositor,
   notas, y si tiene letra / partitura. Debajo, todas las veces
   que se ha marcado en un ensayo; desde cada una se entra al
   Modo estudio.
   ============================================================ */

window.Pagina_song = (function () {
  'use strict';

  var cont, cancion, obs, menu = null;

  function iniciar(contenedor, datos) {
    cerrarMenu();
    cont = contenedor;
    var id = datos && datos.id;
    cancion = id ? window.Canciones.obtener(id) : null;

    if (!cancion) {
      cont.querySelector('[data-modulo="song"]').innerHTML =
        '<p class="vacio">No se encontró esta canción.</p>';
      return;
    }

    pintar();

    q('[data-editar]').addEventListener('click', function () {
      window.Pagina_songs.editar(cancion.id);
    });
    q('[data-chip]').addEventListener('click', function (ev) {
      ev.stopPropagation();
      abrirMenuEstado();
    });

    var vista = document.getElementById('vista');
    obs = new MutationObserver(function () {
      if (!document.body.contains(cont)) { cerrarMenu(); obs.disconnect(); }
    });
    obs.observe(vista, { childList: true, subtree: true });
  }

  function refrescar() { cancion = window.Canciones.obtener(cancion.id) || cancion; }

  function pintar() {
    q('[data-titulo]').textContent = cancion.titulo;
    var meta = q('[data-meta]');
    var partes = [cancion.compositor, window.Canciones.nombreIdioma(cancion.idioma)].filter(Boolean);
    if (partes.length) { meta.textContent = partes.join(' · '); meta.hidden = false; }
    else meta.hidden = true;

    var est = window.Canciones.ESTADOS[cancion.estado] || window.Canciones.ESTADOS.pendiente;
    var chip = q('[data-chip]');
    q('[data-chip-txt]').textContent = est.etiqueta;
    chip.className = 'chip chip--boton chip--' + est.token;

    var notas = q('[data-notas]');
    if (cancion.notas) { notas.textContent = cancion.notas; notas.hidden = false; }
    else notas.hidden = true;

    var tiene = [];
    if ((cancion.letraTexto && cancion.letraTexto.trim()) ||
        (cancion.archivos && cancion.archivos.letra)) tiene.push('letra');
    if (cancion.archivos && cancion.archivos.partitura) tiene.push('partitura');
    var tEl = q('[data-tiene]');
    if (tiene.length) { tEl.hidden = true; }
    else { tEl.textContent = 'Aún no tiene letra ni partitura. Añádelas con ✎.'; tEl.hidden = false; }

    pintarEnsayos();
  }

  function pintarEnsayos() {
    var caja = q('[data-ensayos]');
    var refs = window.Sesiones ? window.Sesiones.marcasDeCancion(cancion.id) : [];
    if (!refs.length) {
      caja.innerHTML = '<p class="visor-vacio">Todavía no has marcado esta pieza en ningún ensayo. ' +
        'Abre una sesión del coro y márcala mientras suena.</p>';
      return;
    }
    var n = refs.length;
    caja.innerHTML =
      '<button type="button" class="btn-bloque btn-bloque--primario" data-estudiar>' +
        '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5a1 1 0 0 1 1.53-.85l12 7.5a1 1 0 0 1 0 1.7l-12 7.5A1 1 0 0 1 7 19.5z"/></svg>' +
        'Escuchar el ensayo' +
      '</button>' +
      '<p class="song-ensayos__pie">' +
        (n === 1 ? 'Un ensayo · ' : n + ' ensayos · ') + 'último: ' + escapar(fechaCorta(refs[0].sesion.fecha)) +
        (n > 1 ? '. Dentro del estudio puedes cambiar de día.' : '') +
      '</p>';
    caja.querySelector('[data-estudiar]').addEventListener('click', function () {
      window.App.ir('estudio', { datos: { id: cancion.id } });
    });
  }

  /* ---------- Menú de estado ---------- */

  function cerrarMenu() {
    if (!menu) return;
    var m = menu; menu = null;
    m.classList.remove('is-abierto');
    document.removeEventListener('click', cerrarMenu);
    setTimeout(function () { if (m.parentNode) m.remove(); }, 160);
  }

  function abrirMenuEstado() {
    if (menu) { cerrarMenu(); return; }
    menu = document.createElement('div');
    menu.className = 'menu-estado';
    ['pendiente', 'progreso', 'aprendida'].forEach(function (k) {
      var e = window.Canciones.ESTADOS[k];
      var op = document.createElement('button');
      op.type = 'button';
      op.className = 'menu-estado__op menu-estado__op--' + e.token + (k === cancion.estado ? ' is-actual' : '');
      op.innerHTML = '<span class="menu-estado__punto"></span>' + e.etiqueta;
      op.addEventListener('click', function (ev) {
        ev.stopPropagation();
        cerrarMenu();
        if (k === cancion.estado) return;
        window.Canciones.fijarEstado(cancion.id, k);
        refrescar();
        pintar();
        if (k === 'aprendida' && window.Frases) {
          window.UI.aviso(window.Frases.enhorabuena ? window.Frases.enhorabuena() : '¡Aprendida! 🎉', { tipo: 'ok', duracion: 4000 });
        }
      });
      menu.appendChild(op);
    });
    document.body.appendChild(menu);

    var r = q('[data-chip]').getBoundingClientRect();
    menu.style.left = Math.max(10, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 10)) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    void menu.offsetHeight;
    menu.classList.add('is-abierto');
    setTimeout(function () { document.addEventListener('click', cerrarMenu); }, 0);
  }

  /* ---------- Utilidades ---------- */

  function q(sel) { return cont.querySelector(sel); }

  function fechaCorta(iso) {
    var d = new Date((iso || '') + 'T00:00:00');
    if (isNaN(d)) return iso;
    try {
      var t = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) { return iso; }
  }
  function fmtTiempo(seg) {
    seg = Math.max(0, Math.floor(seg || 0));
    var h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
    if (h) return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  return { iniciar: iniciar };
})();
