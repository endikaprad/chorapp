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
  //   - con vibración,
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
  var HORA_MES = 10;
  var MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
                      'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // Dos toques: a los 14 días y, si sigue sin aparecer, a los 28. Ahí paramos.
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
        title: 'ChorApp',
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
      var nombre = MESES_NOMBRE[mm];
      var txt = (window.Frases && window.Frases.avisoMes)
        ? window.Frases.avisoMes(nombre)
        : 'Ya está el resumen de ' + nombre + '. Ábrelo, que hay lectura.';
      notifs.push({
        id: ID_MES_MIN + k,
        title: 'ChorApp',
        body: txt,
        channelId: CANAL_ID,
        schedule: { at: primero, allowWhileIdle: true }
      });
    }
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

  function iniciar() {
    var LN = plugin();
    if (!esNativo() || !LN || !window.Frases || !window.Frases.proximasFechas) return;

    crearCanal(LN);

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
                 n.id === ID_VAGA || n.id === ID_VAGA2 ||
                 (n.id >= ID_RACHA_MIN && n.id <= ID_RACHA_MAX) ||
                 (n.id >= ID_MES_MIN && n.id <= ID_MES_MAX);
        });
        if (!mias.length) return;
        return LN.cancel({ notifications: mias.map(function (n) { return { id: n.id }; }) });
      })
      .then(function () {
        var notifs = fechas.map(function (f) {
          return {
            id: f.id,
            title: 'ChorApp',
            body: f.texto,
            channelId: CANAL_ID,
            schedule: { at: f.fecha }
          };
        });
        // Recordatorios de vaga a los 14 y 28 días sin abrir, a las 15:30.
        AVISOS_VAGA.forEach(function (a) {
          notifs.push({
            id: a.id,
            title: 'ChorApp',
            body: a.textos[Math.floor(Math.random() * a.textos.length)],
            channelId: CANAL_ID,
            schedule: { at: horaVagaEn(a.dias), allowWhileIdle: true }
          });
        });

        // Recordatorios de racha (20:00, tono cabrón).
        agregarAvisosRacha(notifs);

        // Resumen del mes (día 1, 10:00).
        agregarAvisosMes(notifs);

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
            channelId: CANAL_ID,
            schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true }
          }] });
        }).then(function () { return true; });
      })
      .catch(function () { return false; });
  }

  /* ---------- Ayudas para probar (usar desde la consola del WebView) ----------
     window.Avisos.pendientes()  -> lista lo que hay programado
     window.Avisos.probar(20)    -> notificación de prueba dentro de 20 s
     window.Avisos.iniciar()     -> reprograma ahora mismo             */
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

  return {
    iniciar: iniciar,
    crearCanal: crearCanal,
    CANAL_ID: CANAL_ID,
    emitir: emitir,
    pendientes: pendientes,
    probar: probar
  };
})();
