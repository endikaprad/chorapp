/* ============================================================
   backup.js — Copia de seguridad de los datos de ChorApp.

   Botón discreto en la esquina superior derecha de Inicio (junto
   al de tema, solo visible ahí). Es mantenimiento, no algo que
   Ama necesite tocar — pero está a la vista por si hace falta.

   Exporta TODO lo guardado en Almacen (localStorage, prefijo
   "chorapp:"): canciones, sesiones, marcas, notas, diario,
   racha, logros… Los archivos adjuntos (audio/PDF/imágenes) NO
   se incluyen — viven aparte (Filesystem/IndexedDB) y pesarían
   demasiado para un JSON; si se restaura en un móvil nuevo hay
   que volver a adjuntarlos.

   Dos vías:
     - Manual: botón "Exportar" -> menú nativo de compartir
       (Drive, email, WhatsApp…), igual que las grabaciones.
     - Automática: 1 vez por semana, en segundo plano y sin
       avisar, sube el JSON a la misma Firebase Realtime Database
       que ya usan control-remoto.js / progreso.js (ruta
       /backups/ultima, sobrescribe la anterior — no acumula
       historial para no hinchar la base). El hijo puede
       descargarla desde el panel remoto. No hace falta login: la
       ruta /backups ya es escribible por la app, igual que
       /status.

   window.Backup.exportar()        -> Promise, comparte el JSON
   window.Backup.importar(file)    -> Promise<datos>, lee y valida
   window.Backup.diasDesdeUltima() -> días desde la última copia
                                       exportada a mano, o null
   window.Backup.diasDesdeNube()   -> días desde la última subida
                                       automática, o null
   window.Backup.revisarAutomatica() -> sube a la nube si toca
                                       (se llama en cada arranque)
   window.Backup.avisoPendiente()  -> true si hace >14 días que no
                                       hay copia (ni manual ni nube)
   window.Backup.abrirPanel()      -> abre la hoja de mantenimiento
   ============================================================ */

window.Backup = (function () {
  'use strict';

  var CLAVE_ULTIMA = 'backup:ultima';
  var CLAVE_NUBE = 'backup:nube:ultima';
  var CADA_MS_NUBE = 7 * 24 * 60 * 60 * 1000;   // 1 vez por semana
  var AVISO_DIAS = 14;

  function hoyISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dia;
  }

  function marcarHecha() {
    if (window.Almacen) window.Almacen.guardar(CLAVE_ULTIMA, hoyISO());
  }

  function diasDesdeUltima() {
    var iso = window.Almacen ? window.Almacen.leer(CLAVE_ULTIMA, null) : null;
    if (!iso) return null;
    var ms = Date.now() - new Date(iso + 'T00:00:00').getTime();
    return Math.max(0, Math.round(ms / 86400000));
  }

  function recogerDatos() {
    var datos = {};
    var prefijo = 'chorapp:';
    for (var i = 0; i < localStorage.length; i++) {
      var clave = localStorage.key(i);
      if (clave.indexOf(prefijo) !== 0) continue;
      try {
        datos[clave.slice(prefijo.length)] = JSON.parse(localStorage.getItem(clave));
      } catch (e) { /* clave corrupta: se omite */ }
    }
    return datos;
  }

  function exportar() {
    var payload = {
      app: 'chorapp',
      formato: 1,
      fecha: new Date().toISOString(),
      datos: recogerDatos(),
    };
    var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    var nombre = 'chorapp-copia-' + hoyISO() + '.json';

    if (!window.Compartir) return Promise.reject(new Error('sin Compartir'));
    return window.Compartir.enviar({
      blob: blob,
      nombre: nombre,
      texto: 'Copia de seguridad de ChorApp (' + hoyISO() + ')',
      titulo: 'Copia de seguridad de ChorApp',
      dialogTitle: 'Guardar copia de seguridad',
    }).then(function (r) {
      marcarHecha();
      return r;
    });
  }

  function leerArchivo(archivo) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(r.error || new Error('lectura')); };
      r.readAsText(archivo);
    });
  }

  // Lee y valida el archivo; NO aplica nada todavía.
  function importar(archivo) {
    return leerArchivo(archivo).then(function (texto) {
      var payload;
      try { payload = JSON.parse(texto); } catch (e) { throw new Error('El archivo no es una copia válida.'); }
      if (!payload || payload.app !== 'chorapp' || !payload.datos || typeof payload.datos !== 'object') {
        throw new Error('El archivo no es una copia de ChorApp.');
      }
      return payload.datos;
    });
  }

  function aplicar(datos) {
    Object.keys(datos).forEach(function (clave) {
      window.Almacen.guardar(clave, datos[clave]);
    });
  }

  /* --------------------------------------------------------
     Copia automática semanal a Firebase (misma base que
     control-remoto.js / progreso.js — sin login, PATCH directo).
     -------------------------------------------------------- */

  function marcarNubeHecha() {
    if (window.Almacen) window.Almacen.guardar(CLAVE_NUBE, hoyISO());
  }

  function diasDesdeNube() {
    var iso = window.Almacen ? window.Almacen.leer(CLAVE_NUBE, null) : null;
    if (!iso) return null;
    var ms = Date.now() - new Date(iso + 'T00:00:00').getTime();
    return Math.max(0, Math.round(ms / 86400000));
  }

  // true si ni la copia manual ni la de la nube se han hecho en AVISO_DIAS.
  function avisoPendiente() {
    var dm = diasDesdeUltima();
    var dn = diasDesdeNube();
    if (dm === null && dn === null) return true;
    var mejor = Math.min(dm === null ? Infinity : dm, dn === null ? Infinity : dn);
    return mejor >= AVISO_DIAS;
  }

  function subirNube() {
    return fetch('data/control.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        var dbUrl = cfg && cfg.dbUrl ? String(cfg.dbUrl).replace(/\/+$/, '') : null;
        if (!dbUrl) throw new Error('sin dbUrl');
        var payload = { app: 'chorapp', formato: 1, fecha: new Date().toISOString(), datos: recogerDatos() };
        return fetch(dbUrl + '/backups/ultima.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      })
      .then(function (res) {
        if (!res || !res.ok) throw new Error('fallo al subir');
        marcarNubeHecha();
      });
  }

  function esNativo() {
    var Cap = window.Capacitor;
    return !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  }

  // Se llama en cada arranque (home.js). Solo actúa en el APK real (en
  // `npm run dev` no se sube nada, para no escribir en la base de datos
  // real de Maite en cada prueba). Solo sube si ha pasado 1 semana desde
  // la última subida; falla en silencio (sin red, sin conf…) y se
  // reintenta en el próximo arranque.
  function revisarAutomatica() {
    if (!esNativo()) return;
    var ult = 0;
    try { ult = new Date((window.Almacen && window.Almacen.leer(CLAVE_NUBE, null)) + 'T00:00:00').getTime() || 0; } catch (e) {}
    if (ult && (Date.now() - ult) < CADA_MS_NUBE) return;
    subirNube().catch(function (e) { console.warn('Backup: subida automática fallida', e); });
  }

  /* --------------------------------------------------------
     Hoja de mantenimiento (exportar / restaurar).
     -------------------------------------------------------- */
  function abrirPanel() {
    var previa = document.querySelector('.hoja--backup');
    if (previa) return;
    var btnBackupHeader = document.getElementById('btn-backup');

    var dias = diasDesdeUltima();
    var estado = dias === null
      ? 'Todavía no se ha exportado ninguna copia a mano.'
      : (dias === 0 ? 'Última copia a mano: hoy.' : 'Última copia a mano: hace ' + dias + (dias === 1 ? ' día.' : ' días.'));

    var diasNube = diasDesdeNube();
    var estadoNube = diasNube === null
      ? 'Copia automática en la nube: todavía no se ha subido ninguna.'
      : (diasNube === 0 ? 'Copia automática en la nube: hoy.' : 'Copia automática en la nube: hace ' + diasNube + (diasNube === 1 ? ' día.' : ' días.'));

    var capa = document.createElement('div');
    capa.className = 'hoja hoja--backup';
    capa.innerHTML =
      '<div class="hoja__fondo" data-cerrar></div>' +
      '<div class="hoja__panel" role="dialog" aria-modal="true">' +
        '<div class="hoja__asa" aria-hidden="true"></div>' +
        '<h2 class="hoja__titulo">Mantenimiento</h2>' +
        '<p class="campo__ayuda" data-estado></p>' +
        '<p class="campo__ayuda" data-estado-nube></p>' +
        '<button type="button" class="btn btn--primario" data-exportar style="width:100%;margin-bottom:10px;">Exportar copia de seguridad</button>' +
        '<button type="button" class="btn btn--texto" data-subir-nube style="width:100%;margin-bottom:10px;">Subir ahora a la nube</button>' +
        '<button type="button" class="btn btn--texto" data-importar style="width:100%;margin-bottom:18px;">Restaurar desde una copia</button>' +
        '<input type="file" accept="application/json,.json" data-archivo hidden>' +
      '</div>';
    capa.querySelector('[data-estado]').textContent = estado;
    capa.querySelector('[data-estado-nube]').textContent = estadoNube;

    document.body.appendChild(capa);
    void capa.offsetWidth;
    capa.classList.add('is-abierta');

    function cerrar() {
      capa.classList.remove('is-abierta');
      setTimeout(function () { if (capa.parentNode) capa.parentNode.removeChild(capa); }, 320);
    }
    capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);

    capa.querySelector('[data-exportar]').addEventListener('click', function (ev) {
      var btn = ev.currentTarget;
      btn.disabled = true;
      exportar().then(function () {
        if (window.UI) window.UI.aviso('Copia exportada', { tipo: 'ok' });
        if (btnBackupHeader) btnBackupHeader.classList.remove('tiene-aviso');
        cerrar();
      }).catch(function (e) {
        console.warn('Backup: fallo al exportar', e);
        if (window.UI) window.UI.aviso('No se pudo exportar la copia', { tipo: 'error' });
        btn.disabled = false;
      });
    });

    capa.querySelector('[data-subir-nube]').addEventListener('click', function (ev) {
      var btn = ev.currentTarget;
      btn.disabled = true;
      subirNube().then(function () {
        if (window.UI) window.UI.aviso('Copia subida a la nube', { tipo: 'ok' });
        if (btnBackupHeader) btnBackupHeader.classList.remove('tiene-aviso');
        cerrar();
      }).catch(function (e) {
        console.warn('Backup: fallo al subir a la nube', e);
        if (window.UI) window.UI.aviso('No se pudo subir la copia (¿sin conexión?)', { tipo: 'error' });
        btn.disabled = false;
      });
    });

    var input = capa.querySelector('[data-archivo]');
    capa.querySelector('[data-importar]').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var archivo = input.files && input.files[0];
      input.value = '';
      if (!archivo) return;
      importar(archivo).then(function (datos) {
        var n = Object.keys(datos).length;
        var preguntar = window.UI
          ? window.UI.confirmar('Se reemplazarán los datos actuales (' + n + ' claves) por los de esta copia. La app se recargará.', { titulo: 'Restaurar copia', ok: 'Restaurar', cancelar: 'Cancelar', peligro: true })
          : Promise.resolve(window.confirm('¿Restaurar copia? Se reemplazarán los datos actuales.'));
        return preguntar.then(function (ok) {
          if (!ok) return;
          aplicar(datos);
          marcarHecha();
          location.reload();
        });
      }).catch(function (e) {
        console.warn('Backup: fallo al importar', e);
        if (window.UI) window.UI.aviso(e.message || 'No se pudo leer la copia', { tipo: 'error' });
      });
    });
  }

  return {
    exportar: exportar,
    importar: importar,
    diasDesdeUltima: diasDesdeUltima,
    diasDesdeNube: diasDesdeNube,
    subirNube: subirNube,
    revisarAutomatica: revisarAutomatica,
    avisoPendiente: avisoPendiente,
    abrirPanel: abrirPanel,
  };
})();
