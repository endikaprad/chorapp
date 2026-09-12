/* ============================================================
   Pagina_practice — Registro de práctica (Fase 6)
   Estadísticas (racha, canciones de la semana) + calendario.
   ============================================================ */

window.Pagina_practice = (function () {
  'use strict';

  var raizActual = null;

  function iniciar(contenedor, datos) {
    var raiz = contenedor.querySelector('[data-modulo="practice"]');
    if (!raiz) return;
    raizActual = raiz;

    if (window.Practica && window.Practica.revisar) {
      try { window.Practica.revisar(); } catch (e) {}
    }

    var dias = window.Practica ? window.Practica.diasPracticados() : [];

    // Solo lo que se ve nada más entrar se pinta ya, para no retrasar el
    // primer fotograma (y con él la animación de entrada). El resto —
    // logros, calendario, resumen, listas— es trabajo pesado que puede
    // esperar al frame siguiente sin que Maite note la diferencia.
    pintarRachaHero(raiz);
    raiz.querySelector('[data-vacio]').hidden = dias.length > 0;

    // setTimeout, no requestAnimationFrame: un rAF corre justo antes del
    // pintado, así que seguiría contando dentro del mismo "presentation
    // delay" del toque. Con setTimeout el navegador ya ha podido pintar
    // el frame de entrada antes de que arranque este trabajo pesado.
    setTimeout(function () {
      if (!document.body.contains(raiz)) return;

      // Se calculan una sola vez aquí y se reparten: Logros y "repasar"
      // necesitan el mismo listar() de canciones/sesiones (que relee y
      // sanea/ordena todo cada vez que se pide), así que antes se pedía
      // por duplicado en cada sitio.
      var pre = {
        canciones: window.Canciones ? window.Canciones.listar() : [],
        sesiones: window.Sesiones ? window.Sesiones.listar() : [],
      };
      pintarLogros(raiz, pre);
      pintarResumenMes(raiz);
      pintarEnsayoHoy(raiz, pre);
      pintarRepasar(raiz, pre);
      montarCalendario(raiz);
      pintarConfigEnsayo(raiz);

      var btnConc = raiz.querySelector('[data-ir-conciertos]');
      if (btnConc) {
        var nConc = window.Conciertos ? window.Conciertos.listar().length : 0;
        var txt = raiz.querySelector('[data-ir-conciertos-txt]');
        if (txt) txt.textContent = nConc ? 'Conciertos del coro · ' + nConc : 'Conciertos del coro';
        btnConc.addEventListener('click', function () { window.App.ir('conciertos'); });
      }
      // Compatibilidad: si aún existe el botón viejo de "Añadir día de concierto".
      var btnAdd = raiz.querySelector('[data-add-concierto]');
      if (btnAdd) btnAdd.addEventListener('click', function () { abrirFormConcierto(null); });

      pintarDatos(raiz);
    }, 0);

    // Se ha llegado aquí tocando un aviso de logro: llevar a ESE logro.
    if (datos && datos.logroId) {
      setTimeout(function () { enfocarLogro(datos.logroId); }, 140);
    }
    // Desde la pantalla de Conciertos: abrir el detalle de ese día.
    if (datos && datos.conciertoDia) {
      setTimeout(function () { abrirResumenDia(datos.conciertoDia); }, 160);
    }
    // Desde Conciertos: abrir el formulario de nuevo concierto.
    if (datos && datos.nuevoConcierto) {
      setTimeout(function () { abrirFormConcierto(null); }, 160);
    }

    // Al abandonar la pantalla, cerrar el resumen si quedó abierto.
    var vista = document.getElementById('vista');
    var obs = new MutationObserver(function () {
      if (!document.body.contains(raiz)) {
        cerrarResumen(); cerrarFormConcierto(); cerrarLogro(); cerrarPrograma();
        cerrarRecuerdo(); cerrarFotoFull(); cerrarConfigEnsayo();
        if (window.ResumenMes) window.ResumenMes.cerrarHoja();
        obs.disconnect();
      }
    });
    // RENDIMIENTO — basta con `childList` en #vista, SIN `subtree`: las
    // pantallas son hijas directas de #vista, así que su retirada ya es un
    // cambio en esa lista. Con `subtree` el observador se disparaba en CADA
    // inserción del DOM de la pantalla (el Modo estudio cambia mucho: letra,
    // marcas, listas) y en cada una hacía un `document.body.contains()`.
    obs.observe(vista, { childList: true });
  }

  /* ----------------------------------------------------------
     Racha estilo Duolingo — llama con el número de días, tira de
     la semana, mensaje según el estado y escudos de racha.
     ---------------------------------------------------------- */
  function pintarRachaHero(raiz) {
    var hero = raiz.querySelector('[data-racha-hero]');
    if (!hero || !window.Practica || !window.Practica.rachaInfo) return;

    var info = window.Practica.rachaInfo();
    var n = info.dias;

    var elNum = hero.querySelector('[data-racha]');
    var elLabel = hero.querySelector('[data-racha-label]');
    contarHasta(elNum, n);
    elLabel.textContent = n === 1 ? 'día seguido' : 'días seguidos';

    // El número se amolda a las cifras para no salirse de la llama.
    hero.setAttribute('data-cifras', String(Math.max(n, 0)).length);

    hero.classList.toggle('racha-hero--activa', n > 0 && !info.enPeligro);
    hero.classList.toggle('racha-hero--peligro', info.enPeligro);
    hero.classList.toggle('racha-hero--apagada', n === 0);

    // Mensaje cálido según el estado.
    var msg;
    if (info.escudoAyer) {
      msg = 'Ayer no pudiste, pero un escudo salvó tu racha 🛡️';
    } else if (n === 0 && !info.hoyHecho) {
      msg = 'Estudia hoy y empieza tu racha';
    } else if (n === 0 && info.hoyHecho) {
      msg = '¡Racha empezada! Vuelve mañana para seguirla';
    } else if (info.enPeligro) {
      msg = n === 1
        ? 'Estudia hoy para no perder tu racha'
        : 'Estudia hoy para no perder tus ' + n + ' días';
    } else {
      var buenas = ['¡Vas genial, Maite!', 'Un día más sin fallar 🎶',
                    'Tu constancia se nota', '¡Sigue así!'];
      msg = buenas[n % buenas.length];
    }
    hero.querySelector('[data-racha-msg]').textContent = msg;

    // Tira de la semana.
    var check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="m5 13 4 4L19 7"/></svg>';
    var escudo = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 3 5 6v5c0 4.4 3 7.5 7 9 4-1.5 7-4.6 7-9V6z"/></svg>';
    hero.querySelector('[data-semana]').innerHTML = info.semana.map(function (d) {
      var cl = 'semana__dia';
      if (d.hecho || d.escudo) cl += ' semana__dia--hecho';
      if (d.escudo && !d.hecho) cl += ' semana__dia--escudo';
      if (d.hoy) cl += ' semana__dia--hoy';
      else if (d.futuro) cl += ' semana__dia--futuro';
      var ico = d.escudo && !d.hecho ? escudo : (d.hecho ? check : '');
      return '<span class="' + cl + '">' +
        '<span class="semana__nombre">' + d.nombre + '</span>' +
        '<span class="semana__punto">' + ico + '</span></span>';
    }).join('');

    // Pie: canciones de la semana, récord y escudos.
    var semana = window.Practica.cancionesSemana ? window.Practica.cancionesSemana() : 0;
    var elSem = hero.querySelector('[data-semana-stat]');
    elSem.textContent = semana + (semana === 1 ? ' canción esta semana' : ' canciones esta semana');

    var elRecord = hero.querySelector('[data-record]');
    if (info.mejor >= 2 && info.mejor > n) {
      elRecord.textContent = 'Tu récord: ' + info.mejor + ' días';
      elRecord.hidden = false;
    } else {
      elRecord.hidden = true;
    }

    var elEsc = hero.querySelector('[data-escudos]');
    if (info.escudos > 0) {
      elEsc.textContent = '🛡️ ' + info.escudos +
        (info.escudos === 1 ? ' escudo de racha' : ' escudos de racha');
      elEsc.title = 'Cada escudo te cubre un día sin estudiar. Ganas uno por cada 7 días seguidos.';
      elEsc.hidden = false;
    } else {
      elEsc.hidden = true;
    }
  }

  /* ----------------------------------------------------------
     Botón "Ver el resumen del mes" — abre la hoja de resumenmes.js
     con el balance del mes anterior (si hubo algo que contar).
     ---------------------------------------------------------- */
  var TEMAS_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                   'julio', 'agosto', 'septiembre', 'octubre', 'noviembre'];

  function pintarResumenMes(raiz) {
    var btn = raiz.querySelector('[data-resumen-mes]');
    if (!btn || !window.ResumenMes || !window.ResumenMes.disponiblePractica) return;

    var d;
    try { d = window.ResumenMes.disponiblePractica(); } catch (e) { return; }
    if (!d) return;   // fuera de la ventana de 5 días: el botón no se ve

    var elEyebrow = raiz.querySelector('[data-resumen-mes-eyebrow]');
    if (elEyebrow) elEyebrow.textContent = d.esAnual ? 'Tu Wrapped anual' : 'Wrapped del mes';
    raiz.querySelector('[data-resumen-mes-texto]').textContent =
      d.esAnual ? ('¡Feliz ' + (d.anio + 1) + '!') : ('Resumen de ' + d.nombreMes);
    btn.classList.toggle('tarjeta-resumen--anual', !!d.esAnual);
    TEMAS_MES.forEach(function (t) { btn.classList.remove('tarjeta-resumen--' + t); });
    if (!d.esAnual && window.ResumenMes.temaMes) {
      btn.classList.add('tarjeta-resumen--' + window.ResumenMes.temaMes(d.mes));
    }
    btn.addEventListener('click', function () { window.ResumenMes.abrirHoja(d); });
    btn.hidden = false;
  }

  /* ----------------------------------------------------------
     Logros / medallas — se calculan al vuelo (logros.js). Los
     conseguidos van en cobalto con su check; los pendientes en
     gris con el progreso ("3/7"). Tocar uno abre su detalle.
     ---------------------------------------------------------- */
  function pintarLogros(raiz, pre) {
    var sec = raiz.querySelector('[data-logros]');
    if (!sec || !window.Logros) return;

    var lista = window.Logros.listar(pre);
    if (!lista.length) return;

    var res = window.Logros.resumen(lista);
    raiz.querySelector('[data-logros-cuenta]').textContent =
      res.hechos + ' de ' + res.total;

    // Agrupados por dificultad, de menos a más difícil (bronce → plata →
    // oro → platino), con su propia etiqueta encima de cada bloque. Dentro
    // de cada grupo: primero los conseguidos, luego los pendientes por
    // cercanía a caer.
    var ORDEN_DIF = ['bronce', 'plata', 'oro', 'platino'];
    var NOMBRE_DIF = { bronce: 'Bronce', plata: 'Plata', oro: 'Oro', platino: 'Platino' };

    var grid = raiz.querySelector('[data-logros-grid]');
    var contador = 0;
    grid.innerHTML = ORDEN_DIF.map(function (dif) {
      var delGrupo = lista.filter(function (l) { return (l.dificultad || 'bronce') === dif; });
      if (!delGrupo.length) return '';
      var hechos = delGrupo.filter(function (l) { return l.hecho; });
      var pend = delGrupo.filter(function (l) { return !l.hecho; })
        .sort(function (a, b) { return b.progreso - a.progreso; });
      var items = hechos.concat(pend).map(function (l) {
        var prog = l.hecho
          ? ''
          : '<span class="logro__prog">' + Math.min(l.valor, l.objetivo) + '/' + l.objetivo + '</span>';
        var i = contador++;
        return '<button type="button" class="logro logro--' + dif + (l.hecho ? ' logro--hecho' : '') + '" ' +
          'data-logro="' + l.id + '" style="animation-delay:' + (i * 28) + 'ms">' +
          '<span class="logro__medalla">' + window.Logros.icono(l.icono) + '</span>' +
          '<span class="logro__titulo">' + escapar(l.titulo) + '</span>' +
          prog +
        '</button>';
      }).join('');
      return '<div class="logros__grupo">' +
        '<h3 class="logros__grupo-titulo logros__grupo-titulo--' + dif + '">' +
          NOMBRE_DIF[dif] + '<span class="logros__grupo-cuenta">' + hechos.length + '/' + delGrupo.length + '</span>' +
        '</h3>' +
        '<div class="logros__subgrid">' + items + '</div>' +
      '</div>';
    }).join('');

    grid.onclick = function (ev) {
      var b = ev.target.closest('[data-logro]');
      if (!b) return;
      var l = lista.filter(function (x) { return x.id === b.getAttribute('data-logro'); })[0];
      if (l) abrirLogro(l);
    };

    // Barra de progreso global.
    raiz.querySelector('[data-logros-barra]').style.width =
      Math.round((res.hechos / res.total) * 100) + '%';

    sec.hidden = false;
  }

  /* Llevar la vista a un logro concreto (p. ej. al tocar su aviso):
     baja hasta él, lo resalta un momento y abre su detalle. */
  function enfocarLogro(id) {
    var raiz = raizActual;
    if (!raiz || !document.body.contains(raiz) || !window.Logros) return;

    var grid = raiz.querySelector('[data-logros-grid]');
    var btn = grid && grid.querySelector('[data-logro="' + id + '"]');
    var l = window.Logros.listar().filter(function (x) { return x.id === id; })[0];
    if (!l) return;

    if (btn) {
      try { btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (e) { btn.scrollIntoView(); }
      btn.classList.remove('logro--destacado');
      void btn.offsetWidth;
      btn.classList.add('logro--destacado');
      setTimeout(function () { btn.classList.remove('logro--destacado'); }, 2400);
    }
    // Deja que el desplazamiento arranque antes de tapar con la hoja.
    setTimeout(function () { abrirLogro(l); }, 300);
  }

  var hojaLogro = null;

  function abrirLogro(l) {
    cerrarResumen();
    cerrarLogro();

    var pct = Math.round(l.progreso * 100);
    var comoLoHizo = '';
    try { comoLoHizo = window.Logros.detalle(l) || ''; } catch (e) {}

    var dif = l.dificultad || 'bronce';
    var difNombre = l.dificultadNombre || dif;

    hojaLogro = document.createElement('div');
    hojaLogro.className = 'hoja hoja--logro hoja--logro-' + dif;
    hojaLogro.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Logro">' +
        '<div class="hoja__asa"></div>' +
        '<p class="logro-det__dif logro-det__dif--' + dif + '">' + escapar(difNombre) + '</p>' +
        '<div class="logro-det__medalla logro-det__medalla--' + dif + (l.hecho ? '' : ' logro-det__medalla--bloq') + '">' +
          window.Logros.icono(l.icono) + '</div>' +
        (l.hecho
          ? '<p class="logro-det__pill">Conseguido</p>'
          : '<p class="logro-det__pill logro-det__pill--pend">Vas por ' +
            Math.min(l.valor, l.objetivo) + ' de ' + l.objetivo + '</p>') +
        '<p class="logro-det__titulo">' + escapar(l.titulo) + '</p>' +
        '<p class="logro-det__desc">' + escapar(l.desc) + '</p>' +
        (l.hecho ? '' :
          '<div class="logro-det__barra"><i style="width:' + pct + '%"></i></div>') +
        (comoLoHizo ? '<p class="logro-det__como">' + escapar(comoLoHizo) + '</p>' : '') +
        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--primario" data-cerrar>Cerrar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaLogro);

    Array.prototype.forEach.call(hojaLogro.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarLogro);
    });
    document.addEventListener('keydown', cerrarLogroEsc);

    void hojaLogro.offsetHeight;
    hojaLogro.classList.add('is-abierta');
  }

  function cerrarLogroEsc(e) { if (e.key === 'Escape') cerrarLogro(); }

  function cerrarLogro() {
    document.removeEventListener('keydown', cerrarLogroEsc);
    var h = hojaLogro;
    hojaLogro = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  /* ----------------------------------------------------------
     Calendario del mes. Se vuelve a montar entero cuando cambia
     algún concierto, para que se repinte el color del día.
     ---------------------------------------------------------- */
  function montarCalendario(raiz) {
    raiz = raiz || raizActual;
    if (!raiz || !window.Calendario || !document.body.contains(raiz)) return;
    var cont = raiz.querySelector('[data-calendario]');
    if (!cont) return;
    cont.innerHTML = '';
    cont.className = '';

    var dias = window.Practica ? window.Practica.diasPracticados() : [];
    var conActividad = window.Diario ? window.Diario.dias() : [];
    var conciertos = window.Conciertos ? window.Conciertos.mapa() : {};
    var diasEnsayo = window.Ensayos ? window.Ensayos.dias() : [];
    var enPausa = window.Ensayos ? window.Ensayos.enPausa : null;

    window.Calendario.crear(cont, {
      practicados: dias,
      conActividad: conActividad,
      conciertos: conciertos,
      diasEnsayo: diasEnsayo,
      enPausa: enPausa,
      onDia: abrirResumenDia,
    });
  }

  /* ----------------------------------------------------------
     Días de concierto — alta / edición / borrado desde una hoja
     inferior. La fecha puede ser futura (FechaPicker con maxHoy
     desactivado). Al guardar se reprograman las notificaciones.
     ---------------------------------------------------------- */
  var hojaConcierto = null;
  var fpConcierto = null;

  // Aviso de que algún concierto ha cambiado: repinta el calendario (si esta
  // pantalla está montada) y deja que otras pantallas (Conciertos) se enteren.
  function _conciertoCambio() {
    try { montarCalendario(); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('chorapp:concierto-cambio')); } catch (e) {}
  }

  function abrirFormConcierto(concierto, opts) {
    if (!window.Conciertos) return;
    opts = opts || {};
    cerrarResumen();
    cerrarFormConcierto();
    var editando = !!(concierto && concierto.id);

    hojaConcierto = document.createElement('div');
    hojaConcierto.className = 'hoja hoja--concierto';
    hojaConcierto.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Día de concierto">' +
        '<div class="hoja__asa"></div>' +
        '<h2 class="hoja__titulo">' + (editando ? 'Editar concierto' : 'Nuevo concierto') + '</h2>' +
        '<div class="campo">' +
          '<span class="campo__label">Día del concierto</span>' +
          '<div data-fecha></div>' +
        '</div>' +
        '<label class="campo">' +
          '<span class="campo__label">Lugar <span class="campo__opcional">(opcional)</span></span>' +
          '<input type="text" data-lugar placeholder="Iglesia de San Juan, Llodio…" />' +
        '</label>' +
        '<label class="campo">' +
          '<span class="campo__label">Hora <span class="campo__opcional">(opcional)</span></span>' +
          '<input type="text" data-hora placeholder="19:30" />' +
        '</label>' +
        '<label class="campo">' +
          '<span class="campo__label">Notas <span class="campo__opcional">(opcional)</span></span>' +
          '<textarea data-notas placeholder="Qué repertorio, con quién quedas, vestuario…"></textarea>' +
        '</label>' +
        '<div class="hoja__acciones">' +
          (editando ? '<button type="button" class="btn btn--fantasma" data-eliminar>Eliminar</button>' : '') +
          '<button type="button" class="btn btn--texto" data-cerrar>Cancelar</button>' +
          '<button type="button" class="btn btn--primario" data-guardar>Guardar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaConcierto);

    var elLugar = hojaConcierto.querySelector('[data-lugar]');
    var elHora = hojaConcierto.querySelector('[data-hora]');
    var elNotas = hojaConcierto.querySelector('[data-notas]');
    if (editando) {
      elLugar.value = concierto.lugar || '';
      elHora.value = concierto.hora || '';
      elNotas.value = concierto.notas || '';
    }

    // Un concierto se marca de hoy en adelante (nunca en el pasado).
    // (Al editar uno que ya pasó, se respeta su fecha para poder verlo.)
    var hoy = hoyISO();
    var minISO = hoy;
    if (editando && concierto.fecha && concierto.fecha < hoy) minISO = concierto.fecha;

    fpConcierto = window.FechaPicker.montar(hojaConcierto.querySelector('[data-fecha]'), {
      valor: (concierto && concierto.fecha) || hoy,
      maxHoy: false,
      minISO: minISO,
      rapidos: false,
    });

    function finForm() {
      cerrarFormConcierto();
      if (editando) abrirResumenDia(concierto.fecha);   // vuelve al detalle
    }
    Array.prototype.forEach.call(hojaConcierto.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', finForm);
    });
    _finFormActual = finForm;
    document.addEventListener('keydown', cerrarFormConciertoEsc);

    hojaConcierto.querySelector('[data-guardar]').addEventListener('click', function () {
      var fecha = fpConcierto ? fpConcierto.valor() : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
      if (fecha < hoyISO() && !(editando && concierto.fecha === fecha)) {
        if (window.UI) window.UI.aviso('El concierto tiene que ser hoy o un día futuro', { tipo: 'error' });
        return;
      }
      var yaHabia = window.Conciertos.porFecha(fecha);
      window.Conciertos.guardar({
        id: editando ? concierto.id : null,
        fecha: fecha,
        lugar: elLugar.value,
        hora: elHora.value,
        notas: elNotas.value,
      });
      cerrarFormConcierto();
      _conciertoCambio();
      reprogramarAvisos();
      if (window.UI) {
        window.UI.aviso(
          editando ? 'Concierto actualizado'
                   : (yaHabia && !editando ? 'Ese día ya tenías un concierto: lo he sustituido'
                                           : 'Concierto añadido al calendario'),
          { tipo: 'ok' }
        );
      }
      // Volver al detalle del concierto (al editar, o si se pide al crear).
      if (editando || opts.volverAlDia) abrirResumenDia(fecha);
    });

    var elBorrar = hojaConcierto.querySelector('[data-eliminar]');
    if (elBorrar) {
      elBorrar.addEventListener('click', function () {
        if (!window.UI) { hacerBorrado(); return; }
        window.UI.confirmar('¿Quitar este día de concierto del calendario?', {
          ok: 'Quitar', peligro: true,
        }).then(function (ok) { if (ok) hacerBorrado(); });
      });
    }
    function hacerBorrado() {
      window.Conciertos.eliminar(concierto.id);
      cerrarFormConcierto();
      _conciertoCambio();
      reprogramarAvisos();
      if (window.UI) window.UI.aviso('Concierto quitado', { tipo: 'ok' });
    }

    void hojaConcierto.offsetHeight;
    hojaConcierto.classList.add('is-abierta');
  }

  var _finFormActual = null;
  function cerrarFormConciertoEsc(e) {
    if (e.key !== 'Escape') return;
    if (_finFormActual) _finFormActual();
    else cerrarFormConcierto();
  }

  function cerrarFormConcierto() {
    document.removeEventListener('keydown', cerrarFormConciertoEsc);
    _finFormActual = null;
    var h = hojaConcierto;
    hojaConcierto = null;
    if (fpConcierto && fpConcierto.destruir) { try { fpConcierto.destruir(); } catch (e) {} }
    fpConcierto = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  /* ----------------------------------------------------------
     Programa del concierto (setlist) — hoja con la lista de
     canciones en el orden del concierto. Se arrastra el asa ⠿
     para reordenar; se añaden y se quitan canciones; tocar una
     fila lleva a su Modo estudio.
     ---------------------------------------------------------- */
  var hojaPrograma = null;

  var ICO_HANDLE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>' +
    '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>' +
    '<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
  var ICO_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var ETQ_ESTADO_C = { pendiente: 'Pendiente', progreso: 'En progreso', aprendida: 'Aprendida' };

  // Abre una canción del repertorio: al Modo estudio si tiene audio, si no a su ficha.
  function irACancion(id) {
    if (!id || !window.App) return;
    var hay = window.Sesiones && window.Sesiones.ultimaMarcaDeCancion &&
              window.Sesiones.ultimaMarcaDeCancion(id);
    window.App.ir(hay ? 'estudio' : 'cancion', { datos: { id: id } });
  }

  function abrirPrograma(concierto) {
    if (!concierto || !concierto.id || !window.Conciertos || !window.Canciones) return;
    cerrarResumen();
    cerrarFormConcierto();
    cerrarPrograma();
    var cid = concierto.id;

    hojaPrograma = document.createElement('div');
    hojaPrograma.className = 'hoja hoja--programa';
    hojaPrograma.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Programa del concierto">' +
        '<div class="hoja__asa"></div>' +
        '<h2 class="hoja__titulo">Programa del concierto</h2>' +
        '<p class="programa__sub">' + escapar(fechaLarga(concierto.fecha)) + '</p>' +
        '<p class="programa__pista">Coloca las canciones en el orden del concierto. Arrastra el asa para moverlas.</p>' +
        '<ul class="programa__lista" data-lista></ul>' +
        '<button type="button" class="programa__anadir" data-anadir>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
          'Añadir canción</button>' +
        '<div class="programa__picker" data-picker></div>' +
        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--primario" data-cerrar>Listo</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaPrograma);

    var ul = hojaPrograma.querySelector('[data-lista]');
    var picker = hojaPrograma.querySelector('[data-picker]');

    function pintar() {
      var prog = window.Conciertos.programaDe(cid);
      if (!prog.length) {
        ul.innerHTML = '<li class="programa__vacio">Aún no hay canciones. Toca «Añadir canción» y ponlas en orden.</li>';
        return;
      }
      ul.innerHTML = prog.map(function (s, i) {
        var chip = '<span class="programa__chip programa__chip--' + s.estado + '">' +
          (ETQ_ESTADO_C[s.estado] || s.estado) + '</span>';
        return '<li class="programa__it" data-id="' + s.id + '">' +
          '<span class="programa__handle" data-handle aria-label="Reordenar" title="Arrastra para reordenar">' + ICO_HANDLE + '</span>' +
          '<span class="programa__num">' + (i + 1) + '</span>' +
          '<span class="programa__tit">' + escapar(s.titulo) +
            (s.compositor ? '<span class="programa__comp">' + escapar(s.compositor) + '</span>' : '') +
          '</span>' +
          chip +
          '<button type="button" class="programa__quitar" data-quitar aria-label="Quitar del programa">' + ICO_X + '</button>' +
        '</li>';
      }).join('');
    }
    pintar();

    ul.addEventListener('click', function (ev) {
      var q = ev.target.closest('[data-quitar]');
      if (q) {
        var li = q.closest('.programa__it');
        window.Conciertos.quitarDelPrograma(cid, li.getAttribute('data-id'));
        pintar();
        return;
      }
      if (ev.target.closest('[data-handle]')) return;
      var fila = ev.target.closest('.programa__it');
      if (fila) { cerrarPrograma(); irACancion(fila.getAttribute('data-id')); }
    });

    activarDragPrograma(ul, function (desde, hasta) {
      window.Conciertos.moverEnPrograma(cid, desde, hasta);
      pintar();
    });

    var pickerAbierto = false;

    function cerrarPicker() {
      if (!pickerAbierto) return;
      pickerAbierto = false;
      picker.style.maxHeight = picker.scrollHeight + 'px';
      void picker.offsetHeight;
      picker.classList.remove('is-abierto');
      picker.style.maxHeight = '0px';
    }

    function abrirPicker() {
      var enPrograma = (window.Conciertos.obtener(cid) || {}).programa || [];
      var libres = window.Canciones.listar().filter(function (c) {
        return enPrograma.indexOf(c.id) === -1;
      });
      if (!libres.length) {
        if (window.UI) window.UI.aviso('Ya están todas las canciones del repertorio en el programa');
        return;
      }
      picker.innerHTML = libres.map(function (c, i) {
        return '<button type="button" class="programa__opt" style="--i:' + i + '" data-add="' + c.id + '">' +
          escapar(c.titulo) +
          (c.compositor ? '<span>' + escapar(c.compositor) + '</span>' : '') +
        '</button>';
      }).join('');
      pickerAbierto = true;
      picker.classList.add('is-abierto');
      // Altura exacta del contenido (con tope) para que la transición no
      // "salte" al final.
      picker.style.maxHeight = '0px';
      void picker.offsetHeight;
      picker.style.maxHeight = Math.min(288, picker.scrollHeight) + 'px';
    }

    hojaPrograma.querySelector('[data-anadir]').addEventListener('click', function () {
      if (pickerAbierto) cerrarPicker();
      else abrirPicker();
    });
    picker.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-add]');
      if (!b) return;
      window.Conciertos.agregarAlPrograma(cid, b.getAttribute('data-add'));
      cerrarPicker();
      pintar();
    });

    function finPrograma() {
      cerrarPrograma();
      _conciertoCambio();
      abrirResumenDia(concierto.fecha);   // vuelve al detalle del concierto
    }
    Array.prototype.forEach.call(hojaPrograma.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', finPrograma);
    });
    _finProgramaActual = finPrograma;
    document.addEventListener('keydown', cerrarProgramaEsc);

    void hojaPrograma.offsetHeight;
    hojaPrograma.classList.add('is-abierta');
  }

  var _finProgramaActual = null;
  function cerrarProgramaEsc(e) {
    if (e.key !== 'Escape') return;
    if (_finProgramaActual) _finProgramaActual();
    else cerrarPrograma();
  }

  function cerrarPrograma() {
    document.removeEventListener('keydown', cerrarProgramaEsc);
    _finProgramaActual = null;
    var h = hojaPrograma;
    hojaPrograma = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  /* ----------------------------------------------------------
     Recuerdo del concierto — foto + nota de "cómo fue". Hoja con
     una foto (galería o cámara) y un texto libre. Solo para
     conciertos ya pasados. Ver conciertos.js.
     ---------------------------------------------------------- */
  var hojaRecuerdo = null;
  var recUrlPrev = null;   // object URL de la previsualización

  function abrirRecuerdo(concierto) {
    if (!concierto || !concierto.id || !window.Conciertos) return;
    cerrarResumen();
    cerrarRecuerdo();
    var cid = concierto.id;
    var rec = window.Conciertos.recuerdoDe(cid);
    var claveF = window.Conciertos.claveFoto(cid);
    var fotoNueva = null;      // File pendiente de guardar
    var quitarFoto = false;

    hojaRecuerdo = document.createElement('div');
    hojaRecuerdo.className = 'hoja hoja--recuerdo';
    hojaRecuerdo.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Recuerdo del concierto">' +
        '<div class="hoja__asa"></div>' +
        '<h2 class="hoja__titulo">El recuerdo del concierto</h2>' +
        '<p class="recuerdo__sub">' + escapar(fechaLarga(concierto.fecha)) + '</p>' +
        '<div class="recuerdo__foto" data-foto-caja>' +
          '<img data-preview alt="Foto del concierto" hidden>' +
          '<label class="recuerdo__anadir-foto" data-vacia>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="3.5"/></svg>' +
            '<span>Añadir una foto</span>' +
            '<input type="file" accept="image/*" capture="environment" data-input-foto hidden>' +
          '</label>' +
          '<div class="recuerdo__foto-acciones" data-foto-acc hidden>' +
            '<label class="btn btn--texto">Cambiar' +
              '<input type="file" accept="image/*" capture="environment" data-input-foto2 hidden>' +
            '</label>' +
            '<button type="button" class="btn btn--texto" data-quitar-foto>Quitar foto</button>' +
          '</div>' +
        '</div>' +
        '<label class="campo">' +
          '<span class="campo__label">¿Cómo fue? <span class="campo__opcional">(opcional)</span></span>' +
          '<textarea data-nota rows="4" maxlength="2000" placeholder="Qué tal sonasteis, con quién fuiste, cómo respondió el público, alguna anécdota…"></textarea>' +
        '</label>' +
        '<div class="hoja__acciones">' +
          ((rec.nota || rec.foto) ? '<button type="button" class="btn btn--fantasma" data-eliminar>Borrar recuerdo</button>' : '') +
          '<button type="button" class="btn btn--texto" data-cerrar>Cancelar</button>' +
          '<button type="button" class="btn btn--primario" data-guardar>Guardar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaRecuerdo);

    var elImg = hojaRecuerdo.querySelector('[data-preview]');
    var elVacia = hojaRecuerdo.querySelector('[data-vacia]');
    var elAcc = hojaRecuerdo.querySelector('[data-foto-acc]');
    var elNota = hojaRecuerdo.querySelector('[data-nota]');
    elNota.value = rec.nota || '';

    function pintarFoto(url) {
      if (url) {
        elImg.src = url;
        elImg.hidden = false;
        elVacia.hidden = true;
        elAcc.hidden = false;
      } else {
        elImg.hidden = true;
        elImg.removeAttribute('src');
        elVacia.hidden = false;
        elAcc.hidden = true;
      }
    }

    if (rec.foto && window.Archivos) {
      window.Archivos.url(claveF).then(function (u) {
        if (!hojaRecuerdo) { if (u) URL.revokeObjectURL(u); return; }
        recUrlPrev = u;
        pintarFoto(u);
      });
    }

    function onFoto(inp) {
      var f = inp.files && inp.files[0];
      inp.value = '';
      if (!f) return;
      fotoNueva = f;
      quitarFoto = false;
      if (recUrlPrev) { URL.revokeObjectURL(recUrlPrev); }
      recUrlPrev = URL.createObjectURL(f);
      pintarFoto(recUrlPrev);
    }
    hojaRecuerdo.querySelector('[data-input-foto]').addEventListener('change', function () { onFoto(this); });
    hojaRecuerdo.querySelector('[data-input-foto2]').addEventListener('change', function () { onFoto(this); });
    hojaRecuerdo.querySelector('[data-quitar-foto]').addEventListener('click', function () {
      fotoNueva = null;
      quitarFoto = true;
      if (recUrlPrev) { URL.revokeObjectURL(recUrlPrev); recUrlPrev = null; }
      pintarFoto(null);
    });

    function finRecuerdo() { cerrarRecuerdo(); abrirResumenDia(concierto.fecha); }
    Array.prototype.forEach.call(hojaRecuerdo.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', finRecuerdo);
    });
    _finRecuerdoActual = finRecuerdo;
    document.addEventListener('keydown', cerrarRecuerdoEsc);

    var elBorrar = hojaRecuerdo.querySelector('[data-eliminar]');
    if (elBorrar) {
      elBorrar.addEventListener('click', function () {
        var hacer = function () {
          if (window.Archivos) window.Archivos.borrar(claveF);
          window.Conciertos.fijarFotoRecuerdo(cid, null);
          window.Conciertos.fijarNotaRecuerdo(cid, '');
          cerrarRecuerdo();
          _conciertoCambio();
          abrirResumenDia(concierto.fecha);
          if (window.UI) window.UI.aviso('Recuerdo borrado', { tipo: 'ok' });
        };
        if (!window.UI) { hacer(); return; }
        window.UI.confirmar('¿Borrar la foto y la nota de este concierto?', { ok: 'Borrar', peligro: true })
          .then(function (ok) { if (ok) hacer(); });
      });
    }

    hojaRecuerdo.querySelector('[data-guardar]').addEventListener('click', function () {
      var nota = elNota.value;
      var guardarMeta = function () {
        window.Conciertos.fijarNotaRecuerdo(cid, nota);
        cerrarRecuerdo();
        _conciertoCambio();
        abrirResumenDia(concierto.fecha);
        if (window.UI) window.UI.aviso('Recuerdo guardado', { tipo: 'ok' });
      };
      if (fotoNueva && window.Archivos) {
        window.Archivos.guardar(claveF, fotoNueva).then(function (meta) {
          window.Conciertos.fijarFotoRecuerdo(cid, meta);
          guardarMeta();
        }).catch(function () {
          if (window.UI) window.UI.aviso('No se pudo guardar la foto', { tipo: 'error' });
        });
      } else if (quitarFoto) {
        if (window.Archivos) window.Archivos.borrar(claveF);
        window.Conciertos.fijarFotoRecuerdo(cid, null);
        guardarMeta();
      } else {
        guardarMeta();
      }
    });

    void hojaRecuerdo.offsetHeight;
    hojaRecuerdo.classList.add('is-abierta');
  }

  var _finRecuerdoActual = null;
  function cerrarRecuerdoEsc(e) {
    if (e.key !== 'Escape') return;
    if (_finRecuerdoActual) _finRecuerdoActual();
    else cerrarRecuerdo();
  }

  function cerrarRecuerdo() {
    document.removeEventListener('keydown', cerrarRecuerdoEsc);
    _finRecuerdoActual = null;
    if (recUrlPrev) { try { URL.revokeObjectURL(recUrlPrev); } catch (e) {} recUrlPrev = null; }
    var h = hojaRecuerdo;
    hojaRecuerdo = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  /* Foto del recuerdo a pantalla completa. Toca para cerrar. */
  var capaFoto = null;
  var capaFotoUrl = null;

  function abrirFotoFull(clave) {
    if (!window.Archivos) return;
    cerrarFotoFull();
    capaFoto = document.createElement('div');
    capaFoto.className = 'foto-full';
    capaFoto.innerHTML = '<img alt="Foto del concierto">' +
      '<button type="button" class="foto-full__cerrar" aria-label="Cerrar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    document.body.appendChild(capaFoto);
    window.Archivos.url(clave).then(function (u) {
      if (!capaFoto) { if (u) URL.revokeObjectURL(u); return; }
      capaFotoUrl = u;
      capaFoto.querySelector('img').src = u;
    });
    capaFoto.addEventListener('click', cerrarFotoFull);
    document.addEventListener('keydown', cerrarFotoFullEsc);
    void capaFoto.offsetHeight;
    capaFoto.classList.add('is-abierta');
  }
  function cerrarFotoFullEsc(e) { if (e.key === 'Escape') cerrarFotoFull(); }
  function cerrarFotoFull() {
    document.removeEventListener('keydown', cerrarFotoFullEsc);
    if (capaFotoUrl) { try { URL.revokeObjectURL(capaFotoUrl); } catch (e) {} capaFotoUrl = null; }
    var c = capaFoto;
    capaFoto = null;
    if (!c) return;
    c.classList.remove('is-abierta');
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 220);
  }

  // Reordenar arrastrando el asa. Filas de altura uniforme (CSS).
  // Los listeners de move/up van en `document` para que el arrastre no se
  // "pierda" si el dedo se sale de la lista.
  function activarDragPrograma(ul, onReorder) {
    var drag = null;

    function mover(ev) {
      if (!drag) return;
      ev.preventDefault();
      var y = (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY);
      var dy = y - drag.startY;
      drag.li.style.transform = 'translateY(' + dy + 'px)';
      var to = Math.max(0, Math.min(drag.lis.length - 1, drag.from + Math.round(dy / drag.h)));
      if (to === drag.to) return;
      drag.to = to;
      drag.lis.forEach(function (el, i) {
        if (el === drag.li) return;
        var shift = 0;
        if (drag.from < to && i > drag.from && i <= to) shift = -drag.h;
        else if (drag.from > to && i < drag.from && i >= to) shift = drag.h;
        el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
      });
    }

    function fin() {
      if (!drag) return;
      var d = drag;
      drag = null;
      document.removeEventListener('pointermove', mover, true);
      document.removeEventListener('pointerup', fin, true);
      document.removeEventListener('pointercancel', fin, true);
      d.lis.forEach(function (el) { el.style.transform = ''; el.classList.remove('is-drag'); });
      document.body.classList.remove('reordenando');
      if (d.from !== d.to) onReorder(d.from, d.to);
    }

    ul.addEventListener('pointerdown', function (ev) {
      if (ev.button) return;
      var h = ev.target.closest('[data-handle]');
      if (!h) return;
      var li = h.closest('.programa__it');
      var lis = Array.prototype.slice.call(ul.querySelectorAll('.programa__it'));
      var from = lis.indexOf(li);
      if (from < 0) return;
      ev.preventDefault();
      drag = {
        li: li, lis: lis, from: from, to: from,
        h: li.getBoundingClientRect().height,
        startY: (ev.touches && ev.touches[0] ? ev.touches[0].clientY : ev.clientY),
      };
      li.classList.add('is-drag');
      document.body.classList.add('reordenando');
      document.addEventListener('pointermove', mover, true);
      document.addEventListener('pointerup', fin, true);
      document.addEventListener('pointercancel', fin, true);
    });
  }

  function hoyISO() {
    if (window.Conciertos && window.Conciertos.hoyISO) return window.Conciertos.hoyISO();
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  // Reprograma las notificaciones locales (incluye ya los conciertos).
  function reprogramarAvisos() {
    if (window.Avisos && window.Avisos.iniciar) {
      try { window.Avisos.iniciar(); } catch (e) {}
    }
  }

  /* ----------------------------------------------------------
     Resumen del día — hoja inferior con todo lo que Maite hizo
     ese día: qué estudió, cuántas veces lo escuchó, qué marcó
     como aprendido, trozos difíciles, grabaciones y sesiones.
     ---------------------------------------------------------- */

  var hojaResumen = null;
  var urlsResumen = [];   // object URLs de fotos que hay que revocar al cerrar

  function abrirResumenDia(iso) {
    if (!window.Diario) return;
    var r = window.Diario.resumenDia(iso);
    var concierto = window.Conciertos ? window.Conciertos.porFecha(iso) : null;
    cerrarResumen();

    hojaResumen = document.createElement('div');
    hojaResumen.className = 'hoja hoja--resumen';
    hojaResumen.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Resumen del día">' +
        '<div class="hoja__asa"></div>' +
        '<p class="resumen__fecha">' + escapar(fechaLarga(iso)) + '</p>' +
        (r.primera && r.ultima && r.ultima - r.primera > 60000
          ? '<p class="resumen__horas">De ' + hora(r.primera) + ' a ' + hora(r.ultima) + '</p>'
          : '') +
        '<div class="resumen__cuerpo" data-cuerpo></div>' +
        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--primario" data-cerrar>Cerrar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaResumen);

    var cuerpo = hojaResumen.querySelector('[data-cuerpo]');
    var html = concierto ? bloqueConcierto(concierto) : '';
    if (r.hayAlgo) html += cuerpoResumen(r);
    else if (!concierto) {
      html = '<p class="resumen__vacio">Ese día no quedó registrada ninguna actividad en la app.</p>';
    }
    cuerpo.innerHTML = html;

    var elEditarC = cuerpo.querySelector('[data-editar-concierto]');
    if (elEditarC && concierto) {
      elEditarC.addEventListener('click', function () {
        cerrarResumen();
        abrirFormConcierto(concierto);
      });
    }

    // Programa del concierto: editar y estudiar en orden.
    var elEditProg = cuerpo.querySelector('[data-editar-programa]');
    if (elEditProg && concierto) {
      elEditProg.addEventListener('click', function () {
        cerrarResumen();
        abrirPrograma(concierto);
      });
    }
    var elEstudiarProg = cuerpo.querySelector('[data-estudiar-programa]');
    if (elEstudiarProg && concierto) {
      elEstudiarProg.addEventListener('click', function () {
        var prog = window.Conciertos.programaDe(concierto.id);
        if (!prog.length) return;
        var sig = prog.filter(function (s) { return s.estado !== 'aprendida'; })[0] || prog[0];
        cerrarResumen();
        irACancion(sig.id);
      });
    }
    Array.prototype.forEach.call(cuerpo.querySelectorAll('[data-ir-cancion]'), function (el) {
      el.addEventListener('click', function () {
        cerrarResumen();
        irACancion(el.getAttribute('data-ir-cancion'));
      });
    });

    // Recuerdo del concierto: editar y ver la foto.
    var elEditRec = cuerpo.querySelector('[data-editar-recuerdo]');
    if (elEditRec && concierto) {
      elEditRec.addEventListener('click', function () {
        cerrarResumen();
        abrirRecuerdo(concierto);
      });
    }
    Array.prototype.forEach.call(cuerpo.querySelectorAll('[data-ver-foto]'), function (b) {
      b.addEventListener('click', function () { abrirFotoFull(b.getAttribute('data-ver-foto')); });
    });
    // Cargar las miniaturas de foto (blob -> object URL).
    Array.prototype.forEach.call(cuerpo.querySelectorAll('[data-foto-async]'), function (img) {
      if (!window.Archivos) return;
      window.Archivos.url(img.getAttribute('data-foto-async')).then(function (u) {
        if (u) { img.src = u; urlsResumen.push(u); }
      }).catch(function () {});
    });

    Array.prototype.forEach.call(hojaResumen.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarResumen);
    });
    document.addEventListener('keydown', cerrarResumenEsc);

    // Ir a la canción / sesión desde el resumen.
    Array.prototype.forEach.call(hojaResumen.querySelectorAll('[data-ir]'), function (b) {
      b.addEventListener('click', function () {
        var ruta = b.getAttribute('data-ir');
        var datos = {};
        try { datos = JSON.parse(b.getAttribute('data-datos') || '{}'); } catch (e) {}
        cerrarResumen();
        window.App.ir(ruta, { datos: datos });
      });
    });

    void hojaResumen.offsetHeight;
    hojaResumen.classList.add('is-abierta');
  }

  // Bloque destacado con los datos del concierto de ese día + su programa.
  function bloqueConcierto(c) {
    var lineas = [];
    if (c.hora) lineas.push(item('Hora: ' + c.hora));
    if (c.lugar) lineas.push(item('Lugar: ' + c.lugar));
    if (c.notas) lineas.push(item(c.notas));
    if (!lineas.length) lineas.push(item('Sin detalles. Toca «Editar» para añadirlos.'));

    var prog = window.Conciertos && window.Conciertos.programaDe
      ? window.Conciertos.programaDe(c.id) : [];
    var faltan = prog.filter(function (s) { return s.estado !== 'aprendida'; }).length;

    var check = '<svg class="prog-mini__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>';

    var bloqueProg;
    if (prog.length) {
      bloqueProg =
        '<div class="prog-mini">' +
          '<div class="prog-mini__cab">' +
            '<span>Programa · ' + prog.length + (prog.length === 1 ? ' canción' : ' canciones') + '</span>' +
            (faltan > 0
              ? '<span class="prog-mini__faltan">' + faltan + ' por aprender</span>'
              : '<span class="prog-mini__ok">Todas aprendidas</span>') +
          '</div>' +
          '<ol class="prog-mini__lista">' +
            prog.map(function (s) {
              return '<li class="prog-mini__it' + (s.estado === 'aprendida' ? ' is-ok' : '') + '" ' +
                'data-ir-cancion="' + s.id + '">' +
                '<span class="prog-mini__tit">' + escapar(s.titulo) + '</span>' +
                (s.estado === 'aprendida' ? check : '') +
              '</li>';
            }).join('') +
          '</ol>' +
          '<div class="prog-mini__acciones">' +
            '<button type="button" class="btn btn--primario prog-mini__estudiar" data-estudiar-programa>Estudiar el programa</button>' +
            '<button type="button" class="btn btn--texto" data-editar-programa>Editar</button>' +
          '</div>' +
        '</div>';
    } else {
      bloqueProg =
        '<button type="button" class="prog-mini__crear" data-editar-programa>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
          'Crear el programa' +
        '</button>';
    }

    // Recuerdo (foto + nota de "cómo fue"), solo para conciertos ya pasados.
    var bloqueRec = '';
    if (window.Conciertos.recuerdoDe && c.fecha <= window.Conciertos.hoyISO()) {
      var rec = window.Conciertos.recuerdoDe(c.id);
      var claveF = window.Conciertos.claveFoto(c.id);
      if (rec.nota || rec.foto) {
        bloqueRec =
          '<div class="recuerdo-mini">' +
            '<span class="recuerdo-mini__cab">El recuerdo</span>' +
            (rec.foto
              ? '<button type="button" class="recuerdo-mini__foto" data-ver-foto="' + escapar(claveF) + '">' +
                  '<img data-foto-async="' + escapar(claveF) + '" alt="Foto del concierto">' +
                '</button>'
              : '') +
            (rec.nota ? '<p class="recuerdo-mini__nota">' + escapar(rec.nota) + '</p>' : '') +
            '<button type="button" class="btn btn--texto" data-editar-recuerdo>Editar el recuerdo</button>' +
          '</div>';
      } else {
        bloqueRec =
          '<button type="button" class="recuerdo-mini__crear" data-editar-recuerdo>' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="3.5"/></svg>' +
            'Añadir un recuerdo del concierto' +
          '</button>';
      }
    }

    return '<section class="resumen__bloque resumen__bloque--concierto">' +
      '<h3 class="resumen__tit">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' +
        '<span>Concierto de Bihotsak</span>' +
      '</h3>' +
      '<ul class="resumen__lista">' + lineas.join('') + '</ul>' +
      bloqueProg +
      bloqueRec +
      '<button type="button" class="resumen__ir" data-editar-concierto>Editar concierto' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
      '</button>' +
    '</section>';
  }

  function cuerpoResumen(r) {
    var bloques = [];

    if (r.sensacion) {
      bloques.push(
        '<section class="resumen__bloque resumen__sensa">' +
          '<span class="resumen__sensa-emoji" aria-hidden="true">' + r.sensacion.emoji + '</span>' +
          '<span class="resumen__sensa-txt">' +
            '<span class="resumen__sensa-cab">Cómo te sentiste</span>' +
            '<span class="resumen__sensa-etq">' + escapar(r.sensacion.etq) + '</span>' +
          '</span>' +
        '</section>'
      );
    }

    if (r.estudiado.length) {
      bloques.push(bloque('nota', 'Lo que estudiaste', r.estudiado.map(function (e) {
        var extra = e.veces > 1 ? ' · ' + e.veces + ' veces' : '';
        var datos = e.sesionId && e.marcaId
          ? { sesionId: e.sesionId, marcaId: e.marcaId }
          : (e.cancionId ? { id: e.cancionId } : null);
        var ruta = (e.sesionId && e.marcaId) ? 'estudio' : (e.cancionId ? 'cancion' : null);
        return item(e.titulo + extra, ruta, datos);
      })));
    }

    if (r.reproducciones.length) {
      bloques.push(bloque('play', 'Lo que escuchaste', r.reproducciones.map(function (p) {
        return item(p.titulo + ' · ' + p.veces + (p.veces === 1 ? ' vez' : ' veces'));
      })));
    }

    if (r.aprendidas.length) {
      bloques.push(bloque('estrella', r.aprendidas.length === 1 ? 'Marcaste como aprendida' : 'Marcaste como aprendidas',
        r.aprendidas.map(function (a) { return item('«' + a.titulo + '»'); })));
    }

    if (r.cambiosEstado.length) {
      bloques.push(bloque('mes', 'Cambios de estado', r.cambiosEstado.map(function (c) {
        return item('«' + c.titulo + '»: ' + (c.de || '—') + ' → ' + (c.a || '—'));
      })));
    }

    if (r.fragmentos) {
      var det = r.fragmentosLista.map(function (f) {
        return f.titulo + (f.n > 1 ? ' (' + f.n + ')' : '');
      }).join(', ');
      bloques.push(bloque('constancia',
        r.fragmentos === 1 ? 'Marcaste 1 trozo difícil' : 'Marcaste ' + r.fragmentos + ' trozos difíciles',
        det ? [item(det)] : []));
    }

    if (r.grabaciones.length) {
      bloques.push(bloque('micro',
        r.grabaciones.length === 1 ? 'Te grabaste cantando' : 'Te grabaste cantando ' + r.grabaciones.length + ' veces',
        r.grabaciones.map(function (g) {
          return item(g.titulo + (g.dur ? ' · ' + fmtDur(g.dur) : ''));
        })));
    }

    if (r.memoria && r.memoria.length) {
      var ETQ_DIF_MM = { facil: 'fácil', medio: 'medio', dificil: 'difícil', extremo: 'todos' };
      bloques.push(bloque('memoria',
        r.memoria.length === 1 ? 'Probaste la letra de memoria' : 'Probaste la letra de memoria (' + r.memoria.length + ')',
        r.memoria.map(function (m) {
          var d = ETQ_DIF_MM[m.dif] ? ' · ' + ETQ_DIF_MM[m.dif] : '';
          return item('«' + m.titulo + '» · ' + m.aciertos + ' de ' + m.total + ' versos' + d);
        })));
    }

    if (r.sesionesAbiertas.length) {
      bloques.push(bloque('calendario', 'Sesiones que abriste', r.sesionesAbiertas.map(function (s) {
        var extra = s.veces > 1 ? ' · ' + s.veces + ' veces' : '';
        return item(s.titulo + extra);
      })));
    }

    return bloques.join('');
  }

  function bloque(ico, titulo, items) {
    return '<section class="resumen__bloque">' +
      '<h3 class="resumen__tit">' + iconoDato(ico) + '<span>' + escapar(titulo) + '</span></h3>' +
      (items && items.length ? '<ul class="resumen__lista">' + items.join('') + '</ul>' : '') +
    '</section>';
  }

  function item(texto, ruta, datos) {
    if (ruta && datos) {
      return '<li><button type="button" class="resumen__ir" data-ir="' + ruta + '" ' +
        'data-datos="' + escapar(JSON.stringify(datos)) + '">' + escapar(texto) +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
        '</button></li>';
    }
    return '<li>' + escapar(texto) + '</li>';
  }

  function cerrarResumenEsc(e) { if (e.key === 'Escape') cerrarResumen(); }

  function cerrarResumen() {
    document.removeEventListener('keydown', cerrarResumenEsc);
    urlsResumen.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
    urlsResumen = [];
    var h = hojaResumen;
    hojaResumen = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  function fechaLarga(iso) {
    var d = new Date((iso || '') + 'T00:00:00');
    if (isNaN(d)) return iso;
    try {
      var t = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    } catch (e) { return iso; }
  }
  function hora(ts) {
    try {
      return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function fmtDur(seg) {
    seg = Math.max(0, Math.round(seg || 0));
    var m = Math.floor(seg / 60), s = seg % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ----------------------------------------------------------
     Curiosidades bajo el calendario — datitos que está bien
     saber, sin pretensión de panel de estadísticas.
     ---------------------------------------------------------- */
  function pintarDatos(raiz) {
    var ul = raiz.querySelector('[data-datos]');
    if (!ul || !window.Practica) return;

    var datos = window.Practica.curiosidades();
    if (!datos.length) return;

    ul.innerHTML = datos.map(function (d, i) {
      return '<li style="animation-delay:' + (i * 40) + 'ms">' +
             iconoDato(d.ico) +
             '<span>' + escapar(d.texto) + '</span></li>';
    }).join('');
    ul.hidden = false;
  }

  /* Iconos de línea al estilo de la barra de navegación (trazo, sin relleno). */
  var ICONOS_DATO = {
    calendario: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 2.5v4M16 2.5v4"/>',
    racha: '<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.7.8-3.2 1.7-4.3C9 9 12 8 12 3Z"/>',
    nota: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    mes: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M7 13.5h4M7 17h7"/>',
    estrella: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9z"/>',
    constancia: '<path d="M4 13h3l2-6 3 15 3-19 2.5 13 1.5-3H20"/>',
    play: '<path d="M8 5.5a1 1 0 0 1 1.53-.85l9 6.5a1 1 0 0 1 0 1.7l-9 6.5A1 1 0 0 1 8 18.5z"/>',
    micro: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21M8.5 21h7"/>',
    memoria: '<path d="M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3Z"/><path d="M9 22h6"/>',
  };
  function iconoDato(clave) {
    var p = ICONOS_DATO[clave] || ICONOS_DATO.nota;
    return '<svg class="dato__icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           p + '</svg>';
  }

  /* ----------------------------------------------------------
     Repaso rápido antes del ensayo — si hoy toca ensayo (según
     los días configurados en Ensayos), sugiere 2-3 canciones:
     primero las que tienen fragmentos difíciles pendientes, y si
     falta hueco, las menos practicadas esta semana.
     ---------------------------------------------------------- */
  function pintarEnsayoHoy(raiz, pre) {
    var btn = raiz.querySelector('[data-ensayo-hoy]');
    if (!btn) return;
    if (!window.Ensayos || !window.Ensayos.esHoyEnsayo()) { btn.hidden = true; return; }

    var canciones = pre.canciones || (window.Canciones ? window.Canciones.listar() : []);
    var estadoPorId = {};
    canciones.forEach(function (c) { estadoPorId[c.id] = c.estado; });

    var dificiles = window.Sesiones ? window.Sesiones.repasoPendiente(pre.sesiones).filter(function (p) {
      if (!p.cancionId) return true;
      var e = estadoPorId[p.cancionId];
      return e === undefined || e !== 'aprendida';
    }).sort(function (a, b) { return b.trozos - a.trozos; }) : [];

    // Veces que se ha practicado cada canción esta semana (lunes-domingo).
    var reg = window.Practica ? window.Practica.leer() : {};
    var hoyD = new Date();
    var lunes = new Date(hoyD);
    lunes.setDate(hoyD.getDate() - ((hoyD.getDay() + 6) % 7));
    var isoLunes = window.Practica.hoyISO(lunes);
    var vecesSemana = {};
    Object.keys(reg).forEach(function (f) {
      if (f < isoLunes) return;
      (reg[f] || []).forEach(function (id) { vecesSemana[id] = (vecesSemana[id] || 0) + 1; });
    });

    var yaIds = {};
    var elegidas = [];
    dificiles.forEach(function (p) {
      if (elegidas.length >= 3) return;
      var clave = p.cancionId || p.ref.marca.id;
      if (yaIds[clave]) return;
      yaIds[clave] = true;
      elegidas.push({ titulo: p.titulo, ref: p.ref });
    });
    if (elegidas.length < 3) {
      canciones.filter(function (c) {
        return c.estado !== 'aprendida' && !yaIds[c.id];
      }).sort(function (a, b) {
        return (vecesSemana[a.id] || 0) - (vecesSemana[b.id] || 0);
      }).forEach(function (c) {
        if (elegidas.length >= 3) return;
        var ref = window.Sesiones && window.Sesiones.ultimaMarcaDeCancion ?
          window.Sesiones.ultimaMarcaDeCancion(c.id) : null;
        if (!ref) return;   // sin ensayo ni canción suelta: nada que abrir
        elegidas.push({ titulo: c.titulo, ref: ref });
      });
    }

    if (!elegidas.length) { btn.hidden = true; return; }

    var diaTxt = window.Ensayos.NOMBRES[window.Ensayos.diaSemanaHoy()];
    raiz.querySelector('[data-ensayo-hoy-titulo]').textContent = 'Hoy es ' + diaTxt.toLowerCase() + ': tienes ensayo';
    raiz.querySelector('[data-ensayo-hoy-nota]').textContent =
      elegidas.length === 1
        ? 'Repasa «' + elegidas[0].titulo + '» antes de ir'
        : 'Repasa ' + elegidas.map(function (e) { return '«' + e.titulo + '»'; }).join(', ') + ' antes de ir';

    btn.addEventListener('click', function () {
      var primera = elegidas[0];
      window.App.ir('estudio', { datos: { sesionId: primera.ref.sesion.id, marcaId: primera.ref.marca.id } });
    });
    btn.hidden = false;
  }

  /* ----------------------------------------------------------
     Configurar días de ensayo — hoja con chips L M X J V S D
     para marcar los días fijos de ensayo del coro.
     ---------------------------------------------------------- */
  function pintarConfigEnsayo(raiz) {
    var btn = raiz.querySelector('[data-config-ensayo]');
    if (!btn || !window.Ensayos) return;
    var texto = raiz.querySelector('[data-config-ensayo-texto]');
    actualizarTextoConfigEnsayo(texto);
    btn.addEventListener('click', function () { abrirConfigEnsayo(texto); });
  }

  function actualizarTextoConfigEnsayo(texto) {
    if (!texto) return;
    var resumen = window.Ensayos.textoResumen();
    texto.textContent = resumen ? 'Ensayo los ' + resumen : 'Configura tus días de ensayo';
  }

  var hojaEnsayo = null;
  var fpPausaDesde = null;
  var fpPausaHasta = null;

  function abrirConfigEnsayo(texto) {
    cerrarConfigEnsayo();
    var actuales = window.Ensayos.dias();

    hojaEnsayo = document.createElement('div');
    hojaEnsayo.className = 'hoja hoja--ensayo';
    hojaEnsayo.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true" aria-label="Días de ensayo">' +
        '<div class="hoja__asa"></div>' +
        '<h2 class="hoja__titulo">¿Qué días tenéis ensayo?</h2>' +
        '<p class="programa__pista">Esos días marcaré el calendario y te sugeriré repasar antes de ir.</p>' +
        '<div class="dias-semana" data-dias></div>' +

        '<div class="ensayo-pausas">' +
          '<div class="ensayo-pausas__cab">' +
            '<span class="campo__label">Vacaciones o semanas sin coro</span>' +
            '<button type="button" class="ensayo-pausas__add" data-add-pausa>+ Añadir</button>' +
          '</div>' +
          '<p class="ensayo-pausas__pista">Mientras dure, esos días no cuentan como ensayo.</p>' +
          '<ul class="ensayo-pausas__lista" data-lista-pausas></ul>' +
          '<div class="ensayo-pausas__form" data-form-pausa hidden>' +
            '<div class="campo">' +
              '<span class="campo__label">Desde</span>' +
              '<div data-fp-desde></div>' +
            '</div>' +
            '<div class="campo">' +
              '<span class="campo__label">Hasta</span>' +
              '<div data-fp-hasta></div>' +
            '</div>' +
            '<label class="campo">' +
              '<span class="campo__label">Motivo <span class="campo__opcional">(opcional)</span></span>' +
              '<input type="text" data-pausa-nota placeholder="Vacaciones de verano…" />' +
            '</label>' +
            '<div class="ensayo-pausas__form-acciones">' +
              '<button type="button" class="btn btn--texto" data-cancelar-pausa>Cancelar</button>' +
              '<button type="button" class="btn btn--primario" data-guardar-pausa>Añadir pausa</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="hoja__acciones">' +
          '<button type="button" class="btn btn--texto" data-cerrar>Cancelar</button>' +
          '<button type="button" class="btn btn--primario" data-guardar>Guardar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(hojaEnsayo);

    var cont = hojaEnsayo.querySelector('[data-dias]');
    var elegidos = actuales.slice();
    cont.innerHTML = window.Ensayos.NOMBRES.map(function (nombre, i) {
      var sel = elegidos.indexOf(i) !== -1;
      return '<button type="button" class="dias-semana__dia' + (sel ? ' is-sel' : '') + '" data-dia="' + i + '">' +
        window.Ensayos.ABREV[i] + '</button>';
    }).join('');

    cont.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-dia]');
      if (!b) return;
      var n = Number(b.getAttribute('data-dia'));
      var pos = elegidos.indexOf(n);
      if (pos === -1) { elegidos.push(n); b.classList.add('is-sel'); }
      else { elegidos.splice(pos, 1); b.classList.remove('is-sel'); }
    });

    var formPausa = hojaEnsayo.querySelector('[data-form-pausa]');
    var listaPausas = hojaEnsayo.querySelector('[data-lista-pausas]');

    function pintarPausas() {
      var pausas = window.Ensayos.listarPausas();
      if (!pausas.length) {
        listaPausas.innerHTML = '';
        listaPausas.hidden = true;
        return;
      }
      listaPausas.hidden = false;
      listaPausas.innerHTML = pausas.map(function (p) {
        return '<li class="ensayo-pausas__it" data-pausa="' + p.id + '">' +
          '<span class="ensayo-pausas__rango">' +
            escapar(fechaCorta(p.desde)) + ' – ' + escapar(fechaCorta(p.hasta)) +
            (p.nota ? '<span class="ensayo-pausas__nota">' + escapar(p.nota) + '</span>' : '') +
          '</span>' +
          '<button type="button" class="ensayo-pausas__quitar" data-quitar-pausa aria-label="Quitar pausa">' + ICO_X + '</button>' +
        '</li>';
      }).join('');
    }

    listaPausas.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-quitar-pausa]');
      if (!b) return;
      var li = b.closest('.ensayo-pausas__it');
      window.Ensayos.borrarPausa(li.getAttribute('data-pausa'));
      pintarPausas();
    });

    pintarPausas();

    function destruirFpsPausa() {
      if (fpPausaDesde && fpPausaDesde.destruir) { try { fpPausaDesde.destruir(); } catch (e) {} }
      if (fpPausaHasta && fpPausaHasta.destruir) { try { fpPausaHasta.destruir(); } catch (e) {} }
      fpPausaDesde = null;
      fpPausaHasta = null;
    }

    hojaEnsayo.querySelector('[data-add-pausa]').addEventListener('click', function () {
      formPausa.hidden = false;
      hojaEnsayo.querySelector('[data-pausa-nota]').value = '';
      var hoy = window.Ensayos.hoyISO();
      destruirFpsPausa();
      fpPausaDesde = window.FechaPicker.montar(hojaEnsayo.querySelector('[data-fp-desde]'), {
        valor: hoy, maxHoy: false, rapidos: false,
      });
      fpPausaHasta = window.FechaPicker.montar(hojaEnsayo.querySelector('[data-fp-hasta]'), {
        valor: hoy, maxHoy: false, rapidos: false,
      });
    });

    hojaEnsayo.querySelector('[data-cancelar-pausa]').addEventListener('click', function () {
      formPausa.hidden = true;
      destruirFpsPausa();
    });

    hojaEnsayo.querySelector('[data-guardar-pausa]').addEventListener('click', function () {
      var desde = fpPausaDesde ? fpPausaDesde.valor() : '';
      var hasta = fpPausaHasta ? fpPausaHasta.valor() : '';
      if (desde > hasta) {
        if (window.UI) window.UI.aviso('La fecha "hasta" no puede ser anterior a "desde"', { tipo: 'error' });
        return;
      }
      window.Ensayos.guardarPausa({
        desde: desde, hasta: hasta,
        nota: hojaEnsayo.querySelector('[data-pausa-nota]').value,
      });
      formPausa.hidden = true;
      destruirFpsPausa();
      pintarPausas();
    });

    Array.prototype.forEach.call(hojaEnsayo.querySelectorAll('[data-cerrar]'), function (el) {
      el.addEventListener('click', cerrarConfigEnsayo);
    });
    document.addEventListener('keydown', cerrarConfigEnsayoEsc);

    hojaEnsayo.querySelector('[data-guardar]').addEventListener('click', function () {
      window.Ensayos.guardarDias(elegidos);
      cerrarConfigEnsayo();
      actualizarTextoConfigEnsayo(texto);
      montarCalendario();
      pintarEnsayoHoy(raizActual, {
        canciones: window.Canciones ? window.Canciones.listar() : [],
        sesiones: window.Sesiones ? window.Sesiones.listar() : [],
      });
      if (window.UI) window.UI.aviso('Días de ensayo guardados', { tipo: 'ok' });
    });

    void hojaEnsayo.offsetHeight;
    hojaEnsayo.classList.add('is-abierta');
  }

  function cerrarConfigEnsayoEsc(e) { if (e.key === 'Escape') cerrarConfigEnsayo(); }
  function cerrarConfigEnsayo() {
    document.removeEventListener('keydown', cerrarConfigEnsayoEsc);
    if (fpPausaDesde && fpPausaDesde.destruir) { try { fpPausaDesde.destruir(); } catch (e) {} }
    if (fpPausaHasta && fpPausaHasta.destruir) { try { fpPausaHasta.destruir(); } catch (e) {} }
    fpPausaDesde = null;
    fpPausaHasta = null;
    var h = hojaEnsayo;
    hojaEnsayo = null;
    if (!h) return;
    h.classList.remove('is-abierta');
    var quita = function () { if (h.parentNode) h.parentNode.removeChild(h); };
    h.addEventListener('transitionend', quita, { once: true });
    setTimeout(quita, 320);
  }

  // "24 dic" / "6 ene" — para las filas de pausas.
  var MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fechaCorta(iso) {
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!p) return iso || '';
    return Number(p[3]) + ' ' + MES_CORTO[Number(p[2]) - 1];
  }

  /* ----------------------------------------------------------
     Fragmentos difíciles pendientes — invita a repasarlos.
     Solo cuentan las canciones que aún no están aprendidas.
     ---------------------------------------------------------- */
  function pintarRepasar(raiz, pre) {
    var btn = raiz.querySelector('[data-repasar]');
    if (!btn || !window.Sesiones) return;

    // Un solo listar() + mapa, en vez de Canciones.obtener() (que relee y
    // reordena TODO el repertorio con localeCompare) por cada trozo pendiente.
    // `pre`: listar() de canciones/sesiones ya hechos por iniciar(), para no
    // repetirlos (Práctica los necesita también para los logros).
    var estadoPorId = {};
    (pre.canciones || window.Canciones.listar()).forEach(function (c) { estadoPorId[c.id] = c.estado; });
    var pend = window.Sesiones.repasoPendiente(pre.sesiones).filter(function (p) {
      if (!p.cancionId) return true;
      var estado = estadoPorId[p.cancionId];
      return estado === undefined || estado !== 'aprendida';
    }).sort(function (a, b) { return b.trozos - a.trozos; });
    if (pend.length === 0) return;

    var trozos = pend.reduce(function (n, p) { return n + p.trozos; }, 0);
    var destino = pend[0];

    raiz.querySelector('[data-repasar-titulo]').textContent =
      trozos === 1 ? '1 trozo marcado como difícil' : trozos + ' trozos marcados como difíciles';
    raiz.querySelector('[data-repasar-nota]').textContent =
      pend.length === 1
        ? 'En «' + destino.titulo + '», esperándote'
        : 'En ' + pend.length + ' canciones, esperándote';

    btn.addEventListener('click', function () {
      window.App.ir('estudio', { datos: { sesionId: destino.ref.sesion.id, marcaId: destino.ref.marca.id } });
    });
    btn.hidden = false;
  }

  /* ----------------------------------------------------------
     Conteo animado de 0 al valor final. Respeta
     prefers-reduced-motion (pinta el número directamente).
     ---------------------------------------------------------- */
  function contarHasta(el, destino) {
    if (!el) return;
    destino = Math.max(0, Math.round(destino || 0));

    var reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}
    if (reduce || destino === 0 || !window.requestAnimationFrame) {
      el.textContent = String(destino);
      return;
    }

    var DURACION = Math.min(1100, 400 + destino * 90);
    var inicio = null;

    function paso(t) {
      if (inicio === null) inicio = t;
      var p = Math.min(1, (t - inicio) / DURACION);
      var e = 1 - Math.pow(1 - p, 3); // ease-out cúbico
      el.textContent = String(Math.round(e * destino));
      if (p < 1) requestAnimationFrame(paso);
      else el.textContent = String(destino);
    }
    el.textContent = '0';
    requestAnimationFrame(paso);
  }

  function escapar(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Cierra cualquier hoja de concierto abierta (la usa la pantalla
  // Conciertos al salir, ya que sus hojas viven en este módulo).
  function cerrarHojasConcierto() {
    cerrarResumen(); cerrarFormConcierto(); cerrarPrograma();
    cerrarRecuerdo(); cerrarFotoFull(); cerrarConfigEnsayo();
  }

  return {
    iniciar: iniciar,
    enfocarLogro: enfocarLogro,
    // API para la pantalla Conciertos: abre las hojas sin salir de ella.
    abrirConciertoDia: abrirResumenDia,
    abrirNuevoConcierto: function () { abrirFormConcierto(null); },
    cerrarHojasConcierto: cerrarHojasConcierto,
  };
})();
