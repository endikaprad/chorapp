/* ============================================================
   avisos.js — Notificaciones en fechas señaladas.

   window.Avisos.iniciar() programa notificaciones locales SIN abrir la app:
     - Fechas señaladas de window.Frases (cumpleaños, fiestas…), ~13 meses.
     - "Recordatorio de vaga" a los 14 y 28 días sin abrir la app (15:30).
     - "Recordatorio de racha" a las 20:00 si tiene una racha viva y aún no
       ha estudiado hoy (+ los 2 días siguientes por si no abre la app).
       Tono cabrón (window.Frases.avisoRacha). Se reprograma en cada
       apertura y al registrar la práctica del día (study.js), así que en
       cuanto estudia, el aviso de esa tarde se cancela solo.
     - Resumen mensual (día 1, 10:00) y Wrapped anual (31 dic, 12:00).
     - Conciertos: la víspera a las 19:00 ("mañana cantáis, repasa hoy"),
       el día a las 13:00 (ánimo) y el día después a las 12:00 ("¿qué tal?").
     - "Ese trozo difícil sigue ahí": la canción con el fragmento difícil
       más abandonado (12+ días sin tocar), mañana a las 17:00.
     - "Medalla a un paso": si el próximo logro de racha/constancia está a
       1 día de caer, mañana a las 10:00.
     Las dos últimas y la de racha se recalculan en cada apertura: en cuanto
     estudia lo que tocaba, el aviso desaparece solo.

   window.Avisos.emitir(titulo, texto) lanza una notificación al
   instante. Lo usa control-remoto.js cuando el panel del hijo manda
   una notificación personalizada.

   Es 100% local: usa @capacitor/local-notifications, no hace falta
   servidor ni internet. Cada vez que se abre la app se vuelven a
   programar, así la ventana de fechas siempre está al día.

   TODOS los avisos salen por el canal "chorapp": SIN sonido pero CON
   vibración (ver CANAL). Las push con la app cerrada (worker) también
   apuntan a este canal.

   En el navegador (npm run dev) no hace nada: las notificaciones
   locales solo existen en el APK.

   Requiere el plugin @capacitor/local-notifications (Fase 2):
     npm i @capacitor/local-notifications
     npm run sync
   ============================================================ */

window.Avisos = (function () {
  'use strict';

  // Rango de ids que usamos, para no pisar otras notificaciones y poder
  // limpiar solo las nuestras. proximasFechas() da ids tipo 20260912.
  var ID_MIN = 20000000;
  var ID_MAX = 30000000;
  var DIAS_VISTA = 400; // ~13 meses por delante

  // Canal de notificación (Android 8+). TODOS los avisos van por aquí:
  //   - sin sonido (apunta a un audio mudo en res/raw/silencio.wav que
  //     genera scripts/android-fix.js),
  //   - con vibración corta (el patrón por defecto de Android para
  //     importancia "normal": un único zumbido breve, nada agresivo),
  //   - importancia "normal" (aparece en la barra, no salta como pop-up).
  // OJO: una vez creado, Android NO deja cambiar sonido/vibración del canal
  // por código (solo la usuaria en ajustes). Si hay que cambiarlo, subir el
  // id (chorapp -> chorapp2) aquí Y en worker/src/index.js.
  var CANAL_ID = 'chorapp';
  var CANAL = {
    id: CANAL_ID,
    name: 'ChorApp',
    description: 'Recordatorios y avisos de ChorApp',
    importance: 3,          // DEFAULT: barra de estado, sin heads-up agresivo
    visibility: 1,          // PUBLIC
    sound: 'silencio',      // audio mudo -> sin sonido
    vibration: true,        // pero sí vibra
    lights: true,
    lightColor: '#1512D6'
  };

  // "Recordatorio de vaga": salta a las 15:30 si pasan 14 días sin abrir
  // la app. Como cada apertura reprograma todo, esta notificación se
  // empuja siempre 14 días hacia delante; solo suena si de verdad no
  // entra en dos semanas. Tono cariñosamente cabrón.
  var ID_VAGA = 17777777;
  var ID_VAGA2 = 17777778;
  var ID_VAGA3 = 17777779;   // "¿te has olvidado de mí?" al mes largo
  var HORA_VAGA = 15;
  var MIN_VAGA = 30;

  // Recordatorio de racha: cada tarde a las 20:00, para que no la pierda por
  // pereza. Se reprograma en cada apertura; si estudia (abre la app), el de
  // ese día se cancela solo. Tono cabrón: canta regular, pero que no falle.
  var ID_RACHA_MIN = 17100000;
  var ID_RACHA_MAX = 17100010;
  var HORA_RACHA = 20;   // 20:00
  var DIAS_RACHA = 3;    // hoy + los 2 días siguientes

  // Resumen del mes: notificación el día 1 a las 10:00 con el balance del
  // mes que acaba de terminar. Al abrir la app ese día sale la hoja (home.js).
  var ID_MES_MIN = 17200000;
  var ID_MES_MAX = 17200010;
  var ID_ANUAL = 17200020;   // Wrapped anual (31 de diciembre)

  // "¿Qué tal el concierto?": el día DESPUÉS de cada concierto, a las 12:00.
  // Pregunta cómo fue y la empuja a añadir el recuerdo (foto + nota) en
  // Práctica. Tono cabrón. id = ID_POST_BASE + AAAAMMDD del día del concierto.
  var ID_POST_MIN = 51000000;
  var ID_POST_MAX = 52000000;
  var ID_POST_BASE = 51000000;
  var HORA_POST = 12;

  // "Mañana concierto": la víspera de cada concierto, a las 19:00.
  // id = ID_VISPERA_BASE + AAAAMMDD del día del concierto.
  var ID_VISPERA_MIN = 53000000;
  var ID_VISPERA_MAX = 54000000;
  var ID_VISPERA_BASE = 53000000;
  var HORA_VISPERA = 19;

  // "Ese trozo difícil sigue ahí": una sola notificación (la canción con
  // el fragmento difícil más abandonado), mañana a las 17:00. Se reprograma
  // en cada apertura, así que en cuanto toca esa canción, desaparece.
  var ID_TROZO = 17300000;
  var HORA_TROZO = 17;
  var DIAS_TROZO = 12;   // días sin tocar la canción para que salte

  // "Te falta un día para la medalla X": una sola notificación, mañana a
  // las 10:00, cuando un logro de racha/constancia está a 1 día de caer.
  var ID_LOGRO = 17400000;
  var HORA_LOGRO = 10;
  var HORA_MES = 10;
  var HORA_ANUAL = 12;
  var MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // Tres toques: a los 14 días, a los 28 y, si un mes largo después sigue
  // sin aparecer, uno último a los 45 en plan "¿te has olvidado de mí?".
  var AVISOS_VAGA = [
    {
      id: ID_VAGA,
      dias: 14,
      textos: [
        'Dos semanas sin abrir ChorApp. ¿El coro ahora es de adorno, Maite?',
        'Llevas 14 días sin estudiar. Las canciones no se aprenden solas, guapa.',
        'Maite, tu racha está criando polvo. Dos semanas ya. A ensayar.',
        'Nadie ha tocado ChorApp en dos semanas. Sospechoso. Muy sospechoso.',
        'El coro Bihotsak te echa de menos. Y esta app también. 14 días fuera.'
      ]
    },
    {
      id: ID_VAGA2,
      dias: 28,
      textos: [
        'Un mes entero sin abrir ChorApp. Ya ni te insisto más, Maite.',
        'Cuatro semanas. La app se rinde. El coro no debería, pero la app sí.',
        'Último aviso: 28 días sin estudiar. A partir de aquí es cosa tuya.',
        'Un mes fuera. Espero que al menos estés cantando en la ducha.'
      ]
    },
    {
      id: ID_VAGA3,
      dias: 45,
      textos: [
        'Ama, me pasé meses haciendo esta app para ti. Mes y medio sin abrirla. No pasa nada. Solo eran meses de mi vida.',
        'Tu hijo, currándose esta app noche tras noche durante meses. Tú: 45 días sin tocarla. Pero tranquila, que yo encantado.',
        'Meses programando esto para que estudies mejor. Mes y medio criando polvo. Al menos dime que cantas en la ducha, Ama.',
        'Hola, soy la app que tu hijo tardó meses en hacer con todo el cariño. ¿Un huequito para mí esta semana? ¿No? Vale.',
        '45 días. Me acuerdo de las noches montando el reproductor, la grabadora, el calendario... para esto. Un abrazo igualmente, Ama.',
        'Meses de trabajo, un regalo hecho a mano, y lleva mes y medio cerrado. No me enfado. Solo me quedo aquí, esperando. Como siempre.',
        'Podrías abrir la app de tu hijo aunque sea por pena. Mes y medio, Ama. Que le eché horas de las de verdad.'
      ]
    }
  ];

  function horaVagaEn(dias) {
    var d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(HORA_VAGA, MIN_VAGA, 0, 0);
    return d;
  }

  /* Añade a `notifs` los recordatorios de racha:
       - HOY a las 20:00 (o dentro de 2 min si ya pasaron, salvo que sea
         muy tarde): solo si tiene racha viva y aún no ha estudiado hoy.
       - MAÑANA y pasado a las 20:00: por si esos días no abre la app
         (si la abre y estudia, la reprogramación de ese día los cancela).
     Solo si de verdad hay una racha que perder. */
  function agregarAvisosRacha(notifs) {
    if (!window.Practica || !window.Frases || !window.Frases.avisoRacha) return;

    var dias = window.Practica.diasPracticados ? window.Practica.diasPracticados() : [];
    if (!dias.length) return;

    var racha = window.Practica.racha ? window.Practica.racha() : 0;
    if (racha < 1) return;   // sin racha viva no hay nada que recordar

    var info = window.Practica.rachaInfo ? window.Practica.rachaInfo() : null;
    var hoyHecho = info ? !!info.hoyHecho : false;

    var ahora = new Date();

    for (var d = 0; d < DIAS_RACHA; d++) {
      var cuando = new Date();
      cuando.setDate(ahora.getDate() + d);
      cuando.setHours(HORA_RACHA, 0, 0, 0);
      var urgente = false;

      if (d === 0) {
        if (hoyHecho) continue;                 // ya ha estudiado: nada esta tarde
        urgente = true;
        if (cuando.getTime() <= ahora.getTime()) {
          // Ya pasaron las 20:00. Si aún es hora decente, avisa en 2 min.
          if (ahora.getHours() >= 23) continue; // a dormir
          cuando = new Date(ahora.getTime() + 2 * 60 * 1000);
        }
      }

      notifs.push({
        id: ID_RACHA_MIN + d,
        title: urgente ? 'Se te escapa la racha' : 'Racha en juego',
        body: window.Frases.avisoRacha(racha, urgente),
        channelId: CANAL_ID,
        schedule: { at: cuando, allowWhileIdle: true }
      });
    }
  }

  /* Notificación del resumen mensual: el día 1 de los próximos meses a las
     10:00. Nombra el mes que acaba de terminar. Tono cabrón. */
  function agregarAvisosMes(notifs) {
    var ahora = new Date();
    for (var k = 0; k < 3; k++) {
      var primero = new Date(ahora.getFullYear(), ahora.getMonth() + 1 + k, 1, HORA_MES, 0, 0, 0);
      if (primero.getTime() <= ahora.getTime()) continue;
      var mm = primero.getMonth() - 1, aa = primero.getFullYear();
      if (mm < 0) { mm = 11; aa--; }
      if (mm === 11) continue;   // el resumen de diciembre lo cubre el Wrapped anual del 31
      var nombre = MESES_NOMBRE[mm];
      var txt = (window.Frases && window.Frases.avisoMes)
        ? window.Frases.avisoMes(nombre)
        : 'Ya está el resumen de ' + nombre + '. Ábrelo, que hay lectura.';
      notifs.push({
        id: ID_MES_MIN + k,
        title: 'Resumen de ' + nombre,
        body: txt,
        channelId: CANAL_ID,
        schedule: { at: primero, allowWhileIdle: true }
      });
    }
  }

  /* Notificación del Wrapped ANUAL: el 31 de diciembre a las 12:00 (este año
     o, si ya pasó, el del año que viene). Tono cálido. */
  function agregarAvisoAnual(notifs) {
    var ahora = new Date();
    var at = new Date(ahora.getFullYear(), 11, 31, HORA_ANUAL, 0, 0, 0);
    if (at.getTime() <= ahora.getTime()) at = new Date(ahora.getFullYear() + 1, 11, 31, HORA_ANUAL, 0, 0, 0);
    var txt = (window.Frases && window.Frases.avisoAnual)
      ? window.Frases.avisoAnual(at.getFullYear())
      : 'Tu año en ChorApp ya está listo. Ábrelo con calma, Ama.';
    notifs.push({
      id: ID_ANUAL,
      title: 'Tu año en ChorApp',
      body: txt,
      channelId: CANAL_ID,
      schedule: { at: at, allowWhileIdle: true }
    });
  }

  /* Notificación del día después de cada concierto (12:00): "¿qué tal fue?"
     + recuérdale añadir el recuerdo. Recorre los conciertos y programa
     los que su "día siguiente a las 12:00" aún esté por llegar. */
  function agregarAvisosPostConcierto(notifs) {
    if (!window.Conciertos || !window.Conciertos.listar) return;
    var textoDe = (window.Frases && window.Frases.avisoPostConcierto) || null;
    var lista = [];
    try { lista = window.Conciertos.listar() || []; } catch (e) { return; }

    lista.forEach(function (c) {
      var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec((c && c.fecha) || '');
      if (!p) return;
      // día siguiente al concierto, a las 12:00
      var at = new Date(+p[1], +p[2] - 1, +p[3] + 1, HORA_POST, 0, 0, 0);
      if (at.getTime() <= Date.now()) return;
      var ymd = (+p[1]) * 10000 + (+p[2]) * 100 + (+p[3]);
      notifs.push({
        id: ID_POST_BASE + ymd,
        title: '¿Qué tal el concierto?',
        body: textoDe ? textoDe()
          : '¿Qué tal el concierto de ayer? Añade una foto al recuerdo en Práctica.',
        channelId: CANAL_ID,
        schedule: { at: at, allowWhileIdle: true }
      });
    });
  }

  /* Aviso la VÍSPERA de cada concierto (19:00): "mañana cantáis, repasa
     hoy". Recorre los conciertos y programa los que su víspera aún esté
     por llegar. Complementa a los avisos del día y del día después. */
  function agregarAvisosVispera(notifs) {
    if (!window.Conciertos || !window.Conciertos.listar) return;
    var textoDe = (window.Frases && window.Frases.avisoVispera) || null;
    var lista = [];
    try { lista = window.Conciertos.listar() || []; } catch (e) { return; }

    lista.forEach(function (c) {
      var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec((c && c.fecha) || '');
      if (!p) return;
      // día ANTES del concierto, a las 19:00
      var at = new Date(+p[1], +p[2] - 1, +p[3] - 1, HORA_VISPERA, 0, 0, 0);
      if (at.getTime() <= Date.now()) return;
      var ymd = (+p[1]) * 10000 + (+p[2]) * 100 + (+p[3]);
      notifs.push({
        id: ID_VISPERA_BASE + ymd,
        title: 'Bihotsak canta mañana',
        body: textoDe ? textoDe(c.lugar || '')
          : 'Mañana hay concierto con Bihotsak. Repasa hoy con calma.',
        channelId: CANAL_ID,
        schedule: { at: at, allowWhileIdle: true }
      });
    });
  }

  /* Aviso de "trozo difícil olvidado": busca la canción con un fragmento
     marcado como difícil que lleve más días sin tocarse (al menos
     DIAS_TROZO) y programa UNA notificación para mañana a las 17:00.
     Si mañana toca esa canción, la reprogramación de ese día lo quita. */
  function agregarAvisoTrozo(notifs) {
    if (!window.Sesiones || !window.Sesiones.listar || !window.Canciones) return;
    if (!window.Practica || !window.Practica.leer) return;
    var textoDe = (window.Frases && window.Frases.avisoTrozo) || null;

    // Última fecha (ISO) en que se estudió cada canción.
    var ultimo = {};
    var reg = window.Practica.leer() || {};
    Object.keys(reg).forEach(function (dia) {
      (reg[dia] || []).forEach(function (id) {
        if (id && (!ultimo[id] || dia > ultimo[id])) ultimo[id] = dia;
      });
    });

    // Canciones con al menos un fragmento difícil.
    var conTrozo = {};
    try {
      window.Sesiones.listar().forEach(function (s) {
        (s.marcas || []).forEach(function (m) {
          if (m.cancionId && (m.fragmentos || []).length) conTrozo[m.cancionId] = true;
        });
      });
    } catch (e) { return; }

    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    var mejor = null, masDias = -1;
    Object.keys(conTrozo).forEach(function (id) {
      var iso = ultimo[id];
      if (!iso) return;   // nunca estudiada: no damos la lata todavía
      var d = new Date(iso + 'T00:00:00');
      var dias = Math.round((hoy - d) / 86400000);
      if (dias < DIAS_TROZO) return;
      var c = window.Canciones.obtener(id);
      if (!c || c.estado === 'aprendida') return;   // ya aprendida: la dejamos en paz
      if (dias > masDias) { masDias = dias; mejor = c; }
    });
    if (!mejor) return;

    var at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(HORA_TROZO, 0, 0, 0);
    notifs.push({
      id: ID_TROZO,
      title: 'Ese trozo sigue ahí',
      body: textoDe ? textoDe(mejor.titulo)
        : 'Ese trozo difícil de «' + mejor.titulo + '» sigue esperándote.',
      channelId: CANAL_ID,
      schedule: { at: at, allowWhileIdle: true }
    });
  }

  /* Aviso de "medalla a un paso": si el próximo logro pendiente es de racha
     o de constancia (días) y le falta 1 para caer, programa UNA notificación
     para mañana a las 10:00. Al conseguirlo, la reprogramación lo quita. */
  function agregarAvisoLogro(notifs) {
    if (!window.Logros || !window.Logros.resumen) return;
    var textoDe = (window.Frases && window.Frases.avisoLogroCerca) || null;

    var sig = null;
    try { sig = window.Logros.resumen().siguiente; } catch (e) { return; }
    if (!sig || sig.hecho) return;
    if (sig.m !== 'racha' && sig.m !== 'dias') return;   // solo los que avanzan estudiando
    var falta = (sig.objetivo || 0) - (sig.valor || 0);
    if (falta !== 1) return;

    var at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(HORA_LOGRO, 0, 0, 0);
    notifs.push({
      id: ID_LOGRO,
      title: 'Medalla a un paso',
      body: textoDe ? textoDe(sig.titulo)
        : 'Te falta un día de estudio para la medalla «' + sig.titulo + '».',
      channelId: CANAL_ID,
      schedule: { at: at, allowWhileIdle: true }
    });
  }

  function plugin() {
    var Cap = window.Capacitor;
    return (Cap && Cap.Plugins && Cap.Plugins.LocalNotifications) || null;
  }
  function esNativo() {
    var Cap = window.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  // Crea (o deja como está) el canal silencioso+vibración. Idempotente.
  function crearCanal(LN) {
    LN = LN || plugin();
    if (!esNativo() || !LN || !LN.createChannel) return Promise.resolve();
    return LN.createChannel(CANAL).catch(function (e) {
      if (window.console) console.warn('Avisos: no se pudo crear el canal', e);
    });
  }

  // Al tocar la notificación del resumen (mensual o anual), llevar a Inicio
  // y abrir el Wrapped. Sin esto, si la app estaba en segundo plano en otra
  // pestaña, el toque solo la trae al frente y el Wrapped no aparece.
  var listenerPuesto = false;
  function engancharToque(LN) {
    if (listenerPuesto || !LN || !LN.addListener) return;
    listenerPuesto = true;
    LN.addListener('localNotificationActionPerformed', function (ev) {
      var id = ev && ev.notification && ev.notification.id;

      // "¿Qué tal el concierto?": abre Práctica en el resumen de ese día,
      // desde donde puede añadir el recuerdo (foto + nota).
      if (id >= ID_POST_MIN && id <= ID_POST_MAX) {
        var ymd = id - ID_POST_BASE;
        var yy = Math.floor(ymd / 10000);
        var mm = Math.floor((ymd % 10000) / 100);
        var dd = ymd % 100;
        var iso = yy + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
        if (window.App && window.App.ir) {
          window.App.ir('practica', { reemplazar: true, datos: { conciertoDia: iso } });
        }
        return;
      }

      var esResumen = (id >= ID_MES_MIN && id <= ID_MES_MAX) || id === ID_ANUAL;
      if (!esResumen) return;
      if (window.App && window.App.ir) window.App.ir('inicio', { reemplazar: true });
      // Por si ya estaba en Inicio y home.js no vuelve a renderizar.
      setTimeout(function () {
        if (!window.ResumenMes) return;
        var d = null;
        try {
          d = (window.ResumenMes.anualPendiente && window.ResumenMes.anualPendiente()) ||
              (window.ResumenMes.pendiente && window.ResumenMes.pendiente());
        } catch (e) { d = null; }
        if (d) {
          window.ResumenMes.abrirHoja(d);
          if (d.esAnual) window.ResumenMes.marcarAnualVisto(d.anio);
          else window.ResumenMes.marcarVisto(d.anio, d.mes);
        }
      }, 300);
    });
  }

  function iniciar() {
    var LN = plugin();
    if (!esNativo() || !LN || !window.Frases || !window.Frases.proximasFechas) return;

    crearCanal(LN);
    engancharToque(LN);

    LN.checkPermissions()
      .then(function (res) {
        if (res && res.display === 'granted') return { display: 'granted' };
        return LN.requestPermissions();
      })
      .then(function (res) {
        if (!res || res.display !== 'granted') return;
        return reprogramar(LN);
      })
      .catch(function (e) {
        if (window.console) console.warn('Avisos: no se pudieron programar', e);
      });
  }

  function reprogramar(LN) {
    var fechas = window.Frases.proximasFechas(DIAS_VISTA);

    return LN.getPending()
      .then(function (pend) {
        // Cancela las nuestras que ya estén puestas (evita duplicados y
        // quita las que hayan cambiado de texto).
        var mias = ((pend && pend.notifications) || []).filter(function (n) {
          return (n.id >= ID_MIN && n.id < ID_MAX) ||
                 n.id === ID_VAGA || n.id === ID_VAGA2 || n.id === ID_VAGA3 ||
                 (n.id >= ID_RACHA_MIN && n.id <= ID_RACHA_MAX) ||
                 (n.id >= ID_MES_MIN && n.id <= ID_MES_MAX) ||
                 n.id === ID_ANUAL ||
                 (n.id >= ID_POST_MIN && n.id <= ID_POST_MAX) ||
                 (n.id >= ID_VISPERA_MIN && n.id <= ID_VISPERA_MAX) ||
                 n.id === ID_TROZO || n.id === ID_LOGRO;
        });
        if (!mias.length) return;
        return LN.cancel({ notifications: mias.map(function (n) { return { id: n.id }; }) });
      })
      .then(function () {
        var TITULO_FECHA = {
          cumpleMaite: '¡Feliz cumpleaños, Maite!',
          otroCumple: 'Hoy toca felicitar',
          fiesta: 'Fecha señalada'
        };
        var notifs = fechas.map(function (f) {
          return {
            id: f.id,
            title: TITULO_FECHA[f.categoria] || 'Fecha señalada',
            body: f.texto,
            channelId: CANAL_ID,
            schedule: { at: f.fecha }
          };
        });
        // Recordatorios de vaga a los 14 y 28 días sin abrir, a las 15:30.
        AVISOS_VAGA.forEach(function (a) {
          notifs.push({
            id: a.id,
            title: '¿Sigues ahí?',
            body: a.textos[Math.floor(Math.random() * a.textos.length)],
            channelId: CANAL_ID,
            schedule: { at: horaVagaEn(a.dias), allowWhileIdle: true }
          });
        });

        // Recordatorios de racha (20:00, tono cabrón).
        agregarAvisosRacha(notifs);

        // Resumen del mes (día 1, 10:00) y Wrapped anual (31 dic, 12:00).
        agregarAvisosMes(notifs);
        agregarAvisoAnual(notifs);

        // "¿Qué tal el concierto?" el día después de cada concierto (12:00).
        agregarAvisosPostConcierto(notifs);

        // La víspera de cada concierto (19:00): "mañana cantáis, repasa hoy".
        agregarAvisosVispera(notifs);

        // "Ese trozo difícil sigue ahí" (mañana 17:00) y "medalla a un paso"
        // (mañana 10:00). Una de cada como mucho; se recalculan en cada apertura.
        agregarAvisoTrozo(notifs);
        agregarAvisoLogro(notifs);

        // Sin "largeBody" Android las corta a una línea (ver LocalNotificationManager):
        // con él usa BigTextStyle y se ve el texto completo al desplegar.
        notifs.forEach(function (n) { if (n.body && !n.largeBody) n.largeBody = n.body; });

        return LN.schedule({ notifications: notifs });
      });
  }

  /* ---------- Notificación inmediata (panel del hijo) ---------- */
  // Devuelve una promesa. En web (sin plugin) no hace nada.
  function emitir(titulo, texto) {
    var LN = plugin();
    texto = String(texto || '').trim();
    if (!esNativo() || !LN || !texto) return Promise.resolve(false);
    return LN.checkPermissions()
      .then(function (r) { return (r && r.display === 'granted') ? r : LN.requestPermissions(); })
      .then(function (r) {
        if (!r || r.display !== 'granted') return false;
        return crearCanal(LN).then(function () {
          return LN.schedule({ notifications: [{
            // id rotatorio fuera del rango de las fechas (20M–30M).
            id: 18000000 + (Date.now() % 1000000),
            title: String(titulo || 'ChorApp').trim() || 'ChorApp',
            body: texto,
            largeBody: texto,
            channelId: CANAL_ID,
            schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true }
          }] });
        }).then(function () { return true; });
      })
      .catch(function () { return false; });
  }

  /* ---------- Ayudas para probar (usar desde la consola del WebView) ----------
     window.Avisos.pendientes()          -> lista lo que hay programado
     window.Avisos.probar(20)            -> notificación de prueba (genérica) en 20 s
     window.Avisos.probarProximas()      -> dispara YA las de las próximas 48h, con su texto real
     window.Avisos.probarProximas(24)    -> solo las de hoy/mañana
     window.Avisos.iniciar()             -> reprograma ahora mismo             */
  function pendientes() {
    var LN = plugin();
    if (!LN) return Promise.resolve([]);
    return LN.getPending().then(function (p) {
      var l = (p && p.notifications) || [];
      if (window.console) console.table(l.map(function (n) {
        return { id: n.id, cuando: n.schedule && n.schedule.at, texto: n.body };
      }));
      return l;
    });
  }

  function probar(segundos) {
    var LN = plugin();
    if (!LN) { if (window.console) console.warn('Avisos: solo en el APK'); return; }
    segundos = segundos || 15;
    return LN.checkPermissions()
      .then(function (r) { return r.display === 'granted' ? r : LN.requestPermissions(); })
      .then(function () { return crearCanal(LN); })
      .then(function () {
        return LN.schedule({ notifications: [{
          id: 19999999,
          title: 'ChorApp (prueba)',
          body: 'Si ves esto, las notificaciones funcionan.',
          channelId: CANAL_ID,
          schedule: { at: new Date(Date.now() + segundos * 1000), allowWhileIdle: true }
        }] });
      })
      .then(function () { if (window.console) console.log('Aviso de prueba en', segundos, 's'); });
  }

  // Dispara YA (en unos segundos, una detrás de otra) copias de los avisos
  // ya programados que caigan dentro de las próximas `horas` (48 por
  // defecto = "las de mañana"), con su título y texto reales — para ver
  // cómo le va a llegar a Maite sin esperar al día.
  //   window.Avisos.probarProximas()     -> las de las próximas 48h
  //   window.Avisos.probarProximas(24)   -> solo las de hoy/mañana (24h)
  function probarProximas(horas) {
    var LN = plugin();
    if (!LN) { if (window.console) console.warn('Avisos: solo en el APK'); return Promise.resolve([]); }
    horas = horas || 48;
    var limite = Date.now() + horas * 3600 * 1000;
    return LN.getPending()
      .then(function (p) {
        var candidatas = ((p && p.notifications) || []).filter(function (n) {
          var at = n.schedule && n.schedule.at ? new Date(n.schedule.at).getTime() : 0;
          return at > Date.now() && at <= limite;
        });
        if (!candidatas.length) {
          if (window.console) console.log('Avisos: nada programado en las próximas', horas, 'h.');
          return [];
        }
        return crearCanal(LN).then(function () {
          var notifs = candidatas.map(function (n, i) {
            return {
              id: 19900000 + i,
              title: n.title,
              body: n.body,
              largeBody: n.body,
              channelId: n.channelId || CANAL_ID,
              schedule: { at: new Date(Date.now() + (i + 1) * 4000), allowWhileIdle: true }
            };
          });
          if (window.console) {
            console.log('Avisos: probando ' + notifs.length + ' aviso(s) real(es), uno cada 4s:');
            console.table(notifs.map(function (n) { return { titulo: n.title, texto: n.body }; }));
          }
          return LN.schedule({ notifications: notifs }).then(function () { return notifs; });
        });
      });
  }

  return {
    iniciar: iniciar,
    crearCanal: crearCanal,
    CANAL_ID: CANAL_ID,
    emitir: emitir,
    pendientes: pendientes,
    probar: probar,
    probarProximas: probarProximas
  };
})();
