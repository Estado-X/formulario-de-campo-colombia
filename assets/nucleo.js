/* Formulario de campo · Estado X
   La lógica sin pantalla: la plantilla, las reglas de validación, la lectura de un
   formulario importado y la tabla que se exporta. No toca la página ni guarda nada. */
(function (raiz) {
  'use strict';

  var TIPOS = [
    ['texto', 'Texto'],
    ['numero', 'Número'],
    ['fecha', 'Fecha'],
    ['opcion', 'Una opción de varias'],
    ['sino', 'Sí o no']
  ];
  var LIMITES = { campos: 60, etiqueta: 120, opciones: 40, opcion: 80, titulo: 80, autorizacion: 3000, texto: 500 };

  /* Un «rol» le da a un campo de la plantilla una regla propia (documento, teléfono, municipio).
     Sigue al campo aunque le cambies el nombre; un campo nuevo no tiene rol. */
  var ROLES = {
    nombres: '',
    apellidos: '',
    tipo_documento: '',
    numero_documento: 'Número de documento: se revisa según el tipo',
    fecha_nacimiento: 'Fecha de nacimiento: no puede ser futura',
    municipio: 'Municipio: sugiere la lista del DANE',
    telefono: 'Teléfono: solo números; 10 dígitos (celular, o fijo con indicativo 60X)'
  };

  var TEXTO_AUTORIZACION = 'Autorizo de manera previa, expresa e informada a [nombre de la organización], ' +
    'como responsable del tratamiento ([dirección y teléfono del responsable]), para recolectar, guardar y usar mis datos personales con el fin de [finalidad], ' +
    'de acuerdo con la Ley 1581 de 2012 y las normas que la reglamentan. ' +
    'Me informaron que puedo conocer, actualizar, rectificar y pedir que se supriman mis datos, ' +
    'y revocar esta autorización, por medio de [canal para ejercer derechos]. ' +
    'También me informaron que responder preguntas sobre datos sensibles o sobre niños, niñas y adolescentes es facultativo ' +
    '(artículo 12 de la Ley 1581 de 2012).';

  function plantilla() {
    return {
      formato: 'formulario-de-campo',
      version: 1,
      titulo: 'Inscripción de participantes',
      autorizacion: { activa: true, texto: TEXTO_AUTORIZACION },
      campos: [
        { id: 'nombres', etiqueta: 'Nombres', tipo: 'texto', obligatorio: true, rol: 'nombres' },
        { id: 'apellidos', etiqueta: 'Apellidos', tipo: 'texto', obligatorio: true, rol: 'apellidos' },
        { id: 'tipo_documento', etiqueta: 'Tipo de documento', tipo: 'opcion', obligatorio: true, rol: 'tipo_documento',
          opciones: ['CC', 'TI', 'CE', 'PPT', 'RC', 'Otro'] },
        { id: 'numero_documento', etiqueta: 'Número de documento', tipo: 'texto', obligatorio: true, rol: 'numero_documento' },
        { id: 'fecha_nacimiento', etiqueta: 'Fecha de nacimiento', tipo: 'fecha', obligatorio: true, rol: 'fecha_nacimiento' },
        { id: 'sexo', etiqueta: 'Sexo', tipo: 'opcion', obligatorio: false,
          opciones: ['Mujer', 'Hombre', 'Intersexual', 'Prefiero no decir'] },
        { id: 'municipio', etiqueta: 'Municipio', tipo: 'texto', obligatorio: true, rol: 'municipio' },
        { id: 'vereda_barrio', etiqueta: 'Vereda o barrio', tipo: 'texto', obligatorio: false },
        { id: 'telefono', etiqueta: 'Teléfono', tipo: 'texto', obligatorio: false, rol: 'telefono' }
      ]
    };
  }

  var NOMBRES_DOCUMENTO = {
    CC: 'Cédula de ciudadanía', TI: 'Tarjeta de identidad', CE: 'Cédula de extranjería',
    PPT: 'Permiso por protección temporal', RC: 'Registro civil', Otro: 'Otro documento'
  };

  /* ---------- Texto ---------- */
  function limpio(t, max) {
    return String(t == null ? '' : t).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || LIMITES.texto);
  }
  function plano(t) {
    return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function dos(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- Fechas ---------- */
  // «31/12/1990» → «1990-12-31», o null si esa fecha no existe.
  function fechaAIso(texto) {
    var m = /^\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})\s*$/.exec(texto || '');
    if (!m) return null;
    var d = +m[1], mes = +m[2], a = +m[3];
    var f = new Date(Date.UTC(a, mes - 1, d));
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null;
    return a + '-' + dos(mes) + '-' + dos(d);
  }
  function isoAFecha(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  function isoDeHoy(ahora) {
    var f = ahora || new Date();
    return f.getFullYear() + '-' + dos(f.getMonth() + 1) + '-' + dos(f.getDate());
  }
  function isoLocal(ms) { return isoDeHoy(new Date(ms)); }
  function horaLocal(ms) {
    var f = new Date(ms), h = f.getHours(), ap = h < 12 ? 'a. m.' : 'p. m.';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + dos(f.getMinutes()) + ' ' + ap;
  }
  // Mientras se escribe: «31121990» → «31/12/1990».
  function fechaMientras(texto) {
    var n = String(texto || '').replace(/\D/g, '').slice(0, 8);
    if (n.length > 4) return n.slice(0, 2) + '/' + n.slice(2, 4) + '/' + n.slice(4);
    if (n.length > 2) return n.slice(0, 2) + '/' + n.slice(2);
    return n;
  }

  /* ---------- Validación de un registro ----------
     valores: { idCampo: texto tal como se escribió } · devuelve { errores: {id: mensaje}, valores: {id: valor limpio} }
     Las fechas quedan en formato ISO (aaaa-mm-dd) y los números como número. */
  function validar(forma, valores, opciones) {
    opciones = opciones || {};
    var hoy = opciones.hoy || isoDeHoy();
    var errores = {}, salida = {};
    var tipoDoc = '';
    forma.campos.forEach(function (c) { if (c.rol === 'tipo_documento') tipoDoc = limpio(valores[c.id]); });

    forma.campos.forEach(function (c) {
      var crudo = valores[c.id];
      var v = limpio(crudo);
      if (!v) {
        if (c.obligatorio) errores[c.id] = c.tipo === 'opcion' || c.tipo === 'sino' ? 'Elige una opción.' : 'Este dato es obligatorio.';
        return;
      }
      if (c.tipo === 'numero') {
        var num = v.replace(/\s/g, '').replace(',', '.');
        if (!/^-?\d+(\.\d+)?$/.test(num) || !isFinite(+num)) { errores[c.id] = 'Escribe solo un número.'; return; }
        salida[c.id] = +num; return;
      }
      if (c.tipo === 'fecha') {
        var iso = fechaAIso(v);
        if (!iso) { errores[c.id] = 'Esa fecha no existe. Escríbela así: día/mes/año, por ejemplo 05/03/1990.'; return; }
        if (iso < '1900-01-01') { errores[c.id] = 'Revisa el año.'; return; }
        if (c.rol === 'fecha_nacimiento' && iso > hoy) { errores[c.id] = 'La fecha de nacimiento no puede ser futura.'; return; }
        salida[c.id] = iso; return;
      }
      if (c.tipo === 'opcion') {
        if ((c.opciones || []).indexOf(v) < 0) { errores[c.id] = 'Elige una de las opciones.'; return; }
        salida[c.id] = v; return;
      }
      if (c.tipo === 'sino') {
        if (v !== 'Sí' && v !== 'No') { errores[c.id] = 'Elige Sí o No.'; return; }
        salida[c.id] = v; return;
      }
      if (c.rol === 'numero_documento') {
        var doc = v.replace(/[\s.,]/g, '');
        if (tipoDoc === 'Otro' || !tipoDoc) {
          if (!/^[A-Za-z0-9\-]{3,20}$/.test(doc)) { errores[c.id] = 'Usa solo letras y números, sin espacios (de 3 a 20).'; return; }
          salida[c.id] = doc.toUpperCase(); return;
        }
        if (!/^\d+$/.test(doc)) { errores[c.id] = 'Para ' + tipoDoc + ' escribe solo números, sin puntos ni letras.'; return; }
        if (tipoDoc === 'CC' && (doc.length < 3 || doc.length > 10)) { errores[c.id] = 'Una cédula de ciudadanía tiene máximo 10 números. Revísala.'; return; }
        if (tipoDoc === 'TI' && (doc.length < 10 || doc.length > 11)) { errores[c.id] = 'Una tarjeta de identidad tiene 10 u 11 números. Revísala.'; return; }
        if (doc.length < 3 || doc.length > 15) { errores[c.id] = 'Revisa el número: debe tener entre 3 y 15 números.'; return; }
        salida[c.id] = doc; return;
      }
      if (c.rol === 'telefono') {
        var tel = v.replace(/[\s\-().]/g, '');
        if (!/^\d+$/.test(tel)) { errores[c.id] = 'Escribe solo números.'; return; }
        // Se siguen aceptando 7 números por los fijos anotados a la antigua; el mensaje guía a 10.
        if (tel.length !== 7 && tel.length !== 10) { errores[c.id] = 'Un teléfono tiene 10 números (celular, o fijo con indicativo 60X).'; return; }
        salida[c.id] = tel; return;
      }
      salida[c.id] = v;
    });

    if (forma.autorizacion && forma.autorizacion.activa && !opciones.autorizo) {
      errores._autorizacion = 'Sin la autorización de la persona no se puede guardar el registro.';
    }
    return { errores: errores, valores: salida, ok: Object.keys(errores).length === 0 };
  }

  /* ---------- Leer y revisar una definición de formulario (la guardada o un JSON importado) ----------
     Devuelve { forma } limpia o { error } con el motivo. Nunca confía en lo que trae el archivo. */
  function leerForma(dato) {
    if (!dato || typeof dato !== 'object' || Array.isArray(dato)) return { error: 'El archivo no es un formulario de esta herramienta.' };
    if (dato.formato !== 'formulario-de-campo') return { error: 'El archivo no es un formulario de esta herramienta.' };
    if (dato.version !== 1) return { error: 'El formulario es de una versión que esta página no conoce.' };
    if (!Array.isArray(dato.campos) || dato.campos.length === 0) return { error: 'El formulario no tiene campos.' };
    if (dato.campos.length > LIMITES.campos) return { error: 'El formulario tiene demasiados campos (máximo ' + LIMITES.campos + ').' };

    var titulo = limpio(dato.titulo, LIMITES.titulo) || 'Formulario';
    var ids = {}, campos = [], error = '';
    var tipos = TIPOS.map(function (t) { return t[0]; });
    dato.campos.forEach(function (c, i) {
      if (error) return;
      if (!c || typeof c !== 'object') { error = 'El campo ' + (i + 1) + ' no se puede leer.'; return; }
      var etiqueta = limpio(c.etiqueta, LIMITES.etiqueta);
      if (!etiqueta) { error = 'El campo ' + (i + 1) + ' no tiene nombre.'; return; }
      if (tipos.indexOf(c.tipo) < 0) { error = 'El campo «' + etiqueta + '» tiene un tipo que esta página no conoce.'; return; }
      var id = typeof c.id === 'string' && /^[a-z0-9_]{1,40}$/.test(c.id) ? c.id : '';
      if (!id || ids[id]) id = nuevoId(ids);
      ids[id] = true;
      var campo = { id: id, etiqueta: etiqueta, tipo: c.tipo, obligatorio: c.obligatorio === true };
      if (c.tipo === 'opcion') {
        var vistas = {}, ops = [];
        (Array.isArray(c.opciones) ? c.opciones : []).forEach(function (o) {
          var t = limpio(o, LIMITES.opcion);
          if (t && !vistas[t] && ops.length < LIMITES.opciones) { vistas[t] = true; ops.push(t); }
        });
        if (ops.length < 2) { error = 'El campo «' + etiqueta + '» necesita al menos dos opciones.'; return; }
        campo.opciones = ops;
      }
      if (typeof c.rol === 'string' && Object.prototype.hasOwnProperty.call(ROLES, c.rol) && rolPermitido(c.rol, c.tipo)) campo.rol = c.rol;
      campos.push(campo);
    });
    if (error) return { error: error };
    // Un rol solo puede estar en un campo.
    var roles = {};
    campos.forEach(function (c) { if (c.rol) { if (roles[c.rol]) delete c.rol; else roles[c.rol] = true; } });

    var aut = dato.autorizacion && typeof dato.autorizacion === 'object' ? dato.autorizacion : {};
    var texto = String(aut.texto == null ? '' : aut.texto).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, LIMITES.autorizacion);
    var activa = aut.activa === true && texto.length > 0;
    return { forma: { formato: 'formulario-de-campo', version: 1, titulo: titulo, autorizacion: { activa: activa, texto: texto }, campos: campos } };
  }
  function rolPermitido(rol, tipo) {
    if (rol === 'tipo_documento') return tipo === 'opcion';
    if (rol === 'fecha_nacimiento') return tipo === 'fecha';
    return tipo === 'texto';
  }
  function nuevoId(usados) {
    var n = 1;
    while (usados['campo_' + n]) n++;
    return 'campo_' + n;
  }
  function faltaCompletar(texto) { return /\[[^\]]+\]/.test(texto || ''); }

  /* ---------- Municipios ---------- */
  // lista: [[codigo, municipio, departamento]] · devuelve hasta `max` coincidencias, primero las que empiezan igual.
  function buscarMunicipios(lista, texto, max) {
    var q = plano(texto);
    if (q.length < 2) return [];
    var empieza = [], contiene = [];
    for (var i = 0; i < lista.length && empieza.length < (max || 6); i++) {
      var n = plano(lista[i][1] + ', ' + lista[i][2]);
      var p = n.indexOf(q);
      if (p === 0) empieza.push(lista[i]);
      else if (p > 0 && contiene.length < (max || 6)) contiene.push(lista[i]);
    }
    return empieza.concat(contiene).slice(0, max || 6);
  }
  function textoMunicipio(m) { return m[1] === m[2] ? m[1] : m[1] + ', ' + m[2]; }
  // Encuentra el municipio que corresponde exactamente a lo escrito («Medellín, Antioquia» o un nombre que no se repite).
  function hallarMunicipio(lista, texto) {
    var q = plano(texto);
    if (!q) return null;
    var porNombre = [];
    for (var i = 0; i < lista.length; i++) {
      if (plano(textoMunicipio(lista[i])) === q || plano(lista[i][1] + ', ' + lista[i][2]) === q) return lista[i];
      if (plano(lista[i][1]) === q) porNombre.push(lista[i]);
    }
    return porNombre.length === 1 ? porNombre[0] : null;
  }

  /* ---------- Tabla para exportar ----------
     registros: [{ id, creado, valores, forma: [[id, etiqueta, tipo], ...] }]
     Devuelve { encabezados, filas (valores para Excel), filasTexto (para CSV), estilosCol, anchos }.
     Las columnas siguen el formulario de hoy; si un registro viejo tiene un campo que ya no está, va al final. */
  function tabla(forma, registros, municipios, Excel) {
    var columnas = [];
    var vistos = {};
    forma.campos.forEach(function (c) {
      vistos[c.id] = true;
      columnas.push({ id: c.id, etiqueta: c.etiqueta, tipo: c.tipo, rol: c.rol });
      if (c.rol === 'municipio') {
        columnas.push({ id: c.id, etiqueta: 'Departamento', derivada: 'departamento' });
        columnas.push({ id: c.id, etiqueta: 'Código DIVIPOLA', derivada: 'codigo' });
      }
    });
    registros.forEach(function (r) {
      (r.forma || []).forEach(function (f) {
        if (!vistos[f[0]] && r.valores && r.valores[f[0]] !== undefined) {
          vistos[f[0]] = true;
          columnas.push({ id: f[0], etiqueta: f[1], tipo: f[2] });
        }
      });
    });
    var hayAutorizacion = registros.some(function (r) { return r.autorizo === true; }) || (forma.autorizacion && forma.autorizacion.activa);
    if (hayAutorizacion) columnas.push({ etiqueta: 'Autorización de datos', fija: 'autorizo' });
    columnas.push({ etiqueta: 'Fecha del registro', fija: 'fecha', tipo: 'fecha' });
    columnas.push({ etiqueta: 'Hora del registro', fija: 'hora' });
    columnas.push({ etiqueta: 'Id del registro', fija: 'id' });

    // Encabezados sin repetir: «Nombre», «Nombre (2)»…
    var cuenta = {};
    var encabezados = columnas.map(function (c) {
      var e = c.etiqueta, k = plano(e);
      cuenta[k] = (cuenta[k] || 0) + 1;
      return cuenta[k] > 1 ? e + ' (' + cuenta[k] + ')' : e;
    });

    var filas = [], filasTexto = [];
    registros.forEach(function (r) {
      var fila = [], texto = [];
      columnas.forEach(function (c) {
        var v = '', t = '';
        if (c.fija === 'autorizo') { v = t = r.autorizo === true ? 'Sí' : ''; }
        else if (c.fija === 'fecha') { var iso = isoLocal(r.creado); v = Excel ? Excel.serial(iso) : iso; t = isoAFecha(iso); }
        else if (c.fija === 'hora') { v = t = horaLocal(r.creado); }
        else if (c.fija === 'id') { v = t = r.id; }
        else {
          var crudo = r.valores ? r.valores[c.id] : undefined;
          if (crudo === undefined || crudo === null) crudo = '';
          if (c.derivada || c.rol === 'municipio') {
            var m = crudo && municipios ? hallarMunicipio(municipios, crudo) : null;
            if (c.derivada === 'departamento') v = t = m ? m[2] : '';
            else if (c.derivada === 'codigo') v = t = m ? m[0] : '';
            else v = t = m ? m[1] : String(crudo);
          } else if (c.tipo === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(crudo)) {
            v = Excel ? Excel.serial(crudo) : crudo; t = isoAFecha(crudo);
          } else if (c.tipo === 'numero' && typeof crudo === 'number') {
            v = crudo; t = String(crudo);
          } else { v = t = String(crudo); }
        }
        fila.push(v); texto.push(t);
      });
      filas.push(fila); filasTexto.push(texto);
    });
    return {
      encabezados: encabezados,
      filas: filas,
      filasTexto: filasTexto,
      estilosCol: columnas.map(function (c) { return c.tipo === 'fecha' && !c.derivada ? (Excel ? Excel.FECHA : 0) : 0; }),
      anchos: columnas.map(function (c) {
        if (c.fija === 'id') return 30;
        if (c.tipo === 'fecha' || c.fija === 'hora') return 16;
        return Math.max(14, Math.min(34, c.etiqueta.length + 6));
      }),
      numericas: columnas.map(function (c) { return c.tipo === 'numero'; })
    };
  }

  /* CSV (RFC 4180, separado por comas, con BOM para que Excel lea las tildes).
     Una celda de texto que empiece por = + - @ (o tabulador) se guarda con un apóstrofo adelante,
     para que ninguna hoja de cálculo la tome como fórmula. */
  function csv(encabezados, filasTexto, numericas) {
    function celda(v, esNumero) {
      var s = String(v == null ? '' : v);
      if (!(esNumero && /^-?\d+(\.\d+)?$/.test(s)) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lineas = [encabezados.map(function (e) { return celda(e, false); }).join(',')];
    filasTexto.forEach(function (f) {
      lineas.push(f.map(function (v, i) { return celda(v, numericas && numericas[i]); }).join(','));
    });
    return '\uFEFF' + lineas.join('\r\n') + '\r\n';
  }

  // «Inscripción de participantes» → «inscripcion-de-participantes_2026-12-17_1530»
  function nombreArchivo(titulo, ahora) {
    var f = ahora || new Date();
    var base = plano(titulo).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'registros';
    return base + '_' + isoDeHoy(f) + '_' + dos(f.getHours()) + dos(f.getMinutes());
  }

  // Resumen de un registro para la lista: nombre, documento y lugar, con lo que haya.
  function resumen(forma, registro) {
    var v = registro.valores || {};
    function porRol(rol) {
      for (var i = 0; i < forma.campos.length; i++) if (forma.campos[i].rol === rol && v[forma.campos[i].id]) return String(v[forma.campos[i].id]);
      return '';
    }
    var nombre = [porRol('nombres'), porRol('apellidos')].filter(Boolean).join(' ');
    if (!nombre) {
      var primeros = [];
      (registro.forma || []).forEach(function (f) { if (primeros.length < 2 && v[f[0]] !== undefined && v[f[0]] !== '') primeros.push(f[2] === 'fecha' ? isoAFecha(v[f[0]]) : String(v[f[0]])); });
      nombre = primeros.join(' · ') || 'Registro sin datos';
    }
    var doc = [porRol('tipo_documento'), porRol('numero_documento')].filter(Boolean).join(' ');
    return { nombre: nombre, detalle: [doc, porRol('municipio')].filter(Boolean).join(' · ') };
  }

  var Nucleo = {
    TIPOS: TIPOS, LIMITES: LIMITES, ROLES: ROLES, NOMBRES_DOCUMENTO: NOMBRES_DOCUMENTO, TEXTO_AUTORIZACION: TEXTO_AUTORIZACION,
    plantilla: plantilla, limpio: limpio, plano: plano,
    fechaAIso: fechaAIso, isoAFecha: isoAFecha, isoDeHoy: isoDeHoy, isoLocal: isoLocal, horaLocal: horaLocal, fechaMientras: fechaMientras,
    validar: validar, leerForma: leerForma, nuevoId: nuevoId, rolPermitido: rolPermitido, faltaCompletar: faltaCompletar,
    buscarMunicipios: buscarMunicipios, textoMunicipio: textoMunicipio, hallarMunicipio: hallarMunicipio,
    tabla: tabla, csv: csv, nombreArchivo: nombreArchivo, resumen: resumen
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Nucleo;
  else raiz.Nucleo = Nucleo;
})(this);
