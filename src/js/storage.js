/* ============================================================
   storage.js — Persistencia local de ChorApp
   Envuelve localStorage con una interfaz estable. Al empaquetar
   con Capacitor se puede sustituir el cuerpo por
   @capacitor/preferences manteniendo Almacen.leer / .guardar / .borrar.
   ============================================================ */

window.Almacen = (function () {
  'use strict';
  var PREFIJO = 'chorapp:';

  function leer(clave, porDefecto) {
    if (porDefecto === undefined) porDefecto = null;
    try {
      var bruto = localStorage.getItem(PREFIJO + clave);
      return bruto == null ? porDefecto : JSON.parse(bruto);
    } catch (e) {
      console.warn('Almacen: no se pudo leer', clave, e);
      return porDefecto;
    }
  }

  function guardar(clave, valor) {
    try {
      localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    } catch (e) {
      console.warn('Almacen: no se pudo guardar', clave, e);
    }
  }

  function borrar(clave) {
    localStorage.removeItem(PREFIJO + clave);
  }

  return { leer: leer, guardar: guardar, borrar: borrar };
})();
