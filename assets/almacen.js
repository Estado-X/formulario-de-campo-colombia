/* Formulario de campo · Estado X
   Guarda todo en IndexedDB, la base de datos del propio navegador: los registros y la
   definición del formulario viven en este celular y no salen de él. */
(function (raiz) {
  'use strict';

  var NOMBRE = 'formulario-de-campo';
  var VERSION = 1;
  var base = null;

  function abrir() {
    if (base) return Promise.resolve(base);
    return new Promise(function (ok, mal) {
      if (!raiz.indexedDB) { mal(new Error('sin-indexeddb')); return; }
      var p;
      try { p = raiz.indexedDB.open(NOMBRE, VERSION); } catch (e) { mal(e); return; }
      p.onupgradeneeded = function () {
        var db = p.result;
        if (!db.objectStoreNames.contains('registros')) db.createObjectStore('registros', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('ajustes')) db.createObjectStore('ajustes', { keyPath: 'clave' });
      };
      p.onsuccess = function () {
        base = p.result;
        base.onversionchange = function () { base.close(); base = null; };
        ok(base);
      };
      p.onerror = function () { mal(p.error || new Error('sin-indexeddb')); };
      p.onblocked = function () { mal(new Error('bloqueada')); };
    });
  }

  // Corre `trabajo(almacen)` dentro de una transacción y resuelve cuando termina de guardarse.
  function transaccion(nombre, modo, trabajo) {
    return abrir().then(function (db) {
      return new Promise(function (ok, mal) {
        var t = db.transaction(nombre, modo);
        var resultado;
        t.oncomplete = function () { ok(resultado); };
        t.onerror = function () { mal(t.error); };
        t.onabort = function () { mal(t.error || new Error('No se pudo guardar.')); };
        var pedido = trabajo(t.objectStore(nombre));
        if (pedido) pedido.onsuccess = function () { resultado = pedido.result; };
      });
    });
  }

  function registros() {
    return transaccion('registros', 'readonly', function (a) { return a.getAll(); }).then(function (lista) {
      return (lista || []).sort(function (x, y) { return y.creado - x.creado; });
    });
  }
  function guardarRegistro(r) { return transaccion('registros', 'readwrite', function (a) { a.put(r); }); }
  function borrarRegistros(ids) {
    return transaccion('registros', 'readwrite', function (a) { ids.forEach(function (id) { a.delete(id); }); });
  }
  function leerAjuste(clave) {
    return transaccion('ajustes', 'readonly', function (a) { return a.get(clave); }).then(function (f) { return f ? f.valor : null; });
  }
  function guardarAjuste(clave, valor) {
    return transaccion('ajustes', 'readwrite', function (a) { a.put({ clave: clave, valor: valor }); });
  }

  // Identificador único de un registro, hecho en el celular.
  function nuevoId() {
    if (raiz.crypto && raiz.crypto.randomUUID) return raiz.crypto.randomUUID();
    var b = new Uint8Array(16);
    raiz.crypto.getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }

  // Le pide al navegador que no borre estos datos por su cuenta si falta espacio. No siempre lo concede.
  function pedirPermanencia() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* sin soporte */ }
  }

  raiz.Almacen = {
    abrir: abrir, registros: registros, guardarRegistro: guardarRegistro, borrarRegistros: borrarRegistros,
    leerAjuste: leerAjuste, guardarAjuste: guardarAjuste, nuevoId: nuevoId, pedirPermanencia: pedirPermanencia
  };
})(this);
