/* Formulario de campo · Estado X
   La pantalla: registrar, ver y exportar los registros, armar el formulario y avisar si hay conexión.
   Todo lo que escribe una persona se pinta con textContent, nunca como HTML. */
(function () {
  'use strict';

  var N = window.Nucleo, A = window.Almacen;
  var VISTAS = ['registrar', 'registros', 'formulario', 'acerca'];
  var forma = N.plantilla();      // el formulario en uso
  var registros = [];             // todos los registros del celular, el más nuevo primero
  var municipios = [];            // [[codigo, municipio, departamento]]
  var editando = null;            // registro que se está corrigiendo
  var borrador = null;            // copia del formulario mientras se edita
  var ultimoArchivo = null;       // { file, ids } del último archivo exportado
  var hayAlmacen = true;

  function $(id) { return document.getElementById(id); }
  function el(etiqueta, attrs, hijos) {
    var n = document.createElement(etiqueta);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === 'texto') n.textContent = v;
      else if (k === 'clase') n.className = v;
      else if (k === 'en') Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    });
    (hijos || []).forEach(function (h) { if (h) n.appendChild(typeof h === 'string' ? document.createTextNode(h) : h); });
    return n;
  }
  function vaciar(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function mensaje(id, texto, enfocar) {
    var p = $(id);
    p.textContent = texto || '';
    p.hidden = !texto;
    if (texto && enfocar) p.focus();
  }

  /* ---------- Vistas ---------- */
  function vistaInicial() {
    var instalada = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    var usada = false;
    try { usada = localStorage.getItem('formulario-de-campo:usada') === '1'; } catch (e) { /* sin permiso */ }
    return instalada || usada || registros.length > 0 ? 'registrar' : 'acerca';
  }
  function mostrar() {
    var h = location.hash.replace('#', '');
    var vista = VISTAS.indexOf(h) >= 0 ? h : (h && $(h) && $('vista-acerca').contains($(h)) ? 'acerca' : vistaInicial());
    // Al salir del editor se conserva lo que estaba escrito, aunque falte guardarlo.
    if (borrador && !$('vista-formulario').hidden && vista !== 'formulario') leerEditor();
    VISTAS.forEach(function (v) { $('vista-' + v).hidden = v !== vista; });
    Array.prototype.forEach.call(document.querySelectorAll('.pestanas a'), function (a) {
      if (a.getAttribute('data-vista') === vista) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.body.setAttribute('data-vista', vista);
    if (vista === 'formulario') abrirEditor();
    if (vista === 'registros') pintarRegistros();
    if (vista !== 'acerca') { try { localStorage.setItem('formulario-de-campo:usada', '1'); } catch (e) { /* sin permiso */ } }
    if (vista === 'acerca' && h && h !== 'acerca' && $(h)) $(h).scrollIntoView();
    else window.scrollTo(0, 0);
  }

  /* ---------- Conexión ---------- */
  function pintarRed() {
    var sin = navigator.onLine === false;
    $('red').classList.toggle('red--sin', sin);
    $('red-texto').textContent = sin
      ? 'Sin conexión: tus registros se guardan en este celular'
      : 'Con conexión · los registros se guardan solo en este celular';
  }

  /* ---------- Contadores ---------- */
  function deHoy() {
    var hoy = N.isoDeHoy();
    return registros.filter(function (r) { return N.isoLocal(r.creado) === hoy; });
  }
  function pintarConteos() {
    var hoy = deHoy().length;
    $('n-hoy').textContent = String(hoy);
    $('n-total').textContent = String(registros.length);
    var b = $('n-pestana');
    b.hidden = registros.length === 0;
    b.textContent = String(registros.length);
    b.setAttribute('aria-label', plural(registros.length, 'registro guardado', 'registros guardados'));
  }

  /* ---------- Registrar ---------- */
  function idCampo(c) { return 'c-' + c.id; }

  function pintarFormulario() {
    $('t-registrar').textContent = forma.titulo;
    var cont = $('campos');
    vaciar(cont);
    forma.campos.forEach(function (c) { cont.appendChild(campo(c)); });
    var aut = forma.autorizacion && forma.autorizacion.activa;
    $('bloque-autorizacion').hidden = !aut;
    $('texto-autorizacion').textContent = aut ? forma.autorizacion.texto : '';
    $('aviso-corchetes').hidden = !(aut && N.faltaCompletar(forma.autorizacion.texto));
    $('autorizo').checked = false;
    limpiarErrores();
    ajustarDocumento();
  }

  function etiquetaDe(c, para) {
    var hijos = [c.etiqueta];
    if (!c.obligatorio) hijos.push(el('span', { clase: 'opc', texto: ' (opcional)' }));
    return para ? el('label', { 'for': para }, hijos) : el('legend', {}, hijos);
  }
  function parrafoError(c) { return el('p', { clase: 'error', id: 'err-' + c.id, hidden: true }); }

  function campo(c) {
    var id = idCampo(c);
    var descrito = 'err-' + c.id;
    if (c.tipo === 'opcion' || c.tipo === 'sino') {
      var opciones = c.tipo === 'sino' ? ['Sí', 'No'] : c.opciones;
      if (opciones.length > 6) {
        var sel = el('select', { clase: 'caja', id: id, name: c.id, 'aria-describedby': descrito, 'aria-required': c.obligatorio ? 'true' : null },
          [el('option', { value: '', texto: 'Elige…' })].concat(opciones.map(function (o) { return el('option', { value: o, texto: o }); })));
        return el('div', { clase: 'campo', 'data-campo': c.id }, [etiquetaDe(c, id), sel, parrafoError(c)]);
      }
      var grupo = el('fieldset', { clase: 'campo campo--grupo', 'data-campo': c.id, 'aria-describedby': descrito }, [etiquetaDe(c)]);
      var chips = el('div', { clase: 'chips' });
      opciones.forEach(function (o, i) {
        var radio = el('input', { type: 'radio', name: c.id, value: o, id: id + '-' + i });
        var titulo = c.rol === 'tipo_documento' && N.NOMBRES_DOCUMENTO[o] ? N.NOMBRES_DOCUMENTO[o] : null;
        chips.appendChild(el('label', { clase: 'chip', title: titulo }, [radio, el('span', { texto: o })]));
      });
      grupo.appendChild(chips);
      if (!c.obligatorio) {
        grupo.appendChild(el('button', { type: 'button', clase: 'quitar-respuesta', texto: 'Quitar la respuesta', hidden: true, en: { click: function () {
          Array.prototype.forEach.call(grupo.querySelectorAll('input'), function (r) { r.checked = false; });
          this.hidden = true;
          var primero = grupo.querySelector('input'); if (primero) primero.focus();
        } } }));
        grupo.addEventListener('change', function () { grupo.querySelector('.quitar-respuesta').hidden = false; });
      }
      if (c.rol === 'tipo_documento') grupo.addEventListener('change', ajustarDocumento);
      grupo.appendChild(parrafoError(c));
      return grupo;
    }

    var attrs = { clase: 'caja', type: 'text', id: id, name: c.id, 'aria-describedby': descrito, 'aria-required': c.obligatorio ? 'true' : null,
      maxlength: String(N.LIMITES.texto), autocomplete: 'off', spellcheck: 'false' };
    var extra = [];
    if (c.tipo === 'numero') { attrs.inputmode = 'decimal'; attrs.maxlength = '20'; }
    if (c.tipo === 'fecha') {
      attrs.inputmode = 'numeric'; attrs.maxlength = '10'; attrs.placeholder = 'dd/mm/aaaa';
      attrs['aria-describedby'] = 'ayuda-' + c.id + ' ' + descrito;
      extra.push(el('p', { clase: 'ayuda', id: 'ayuda-' + c.id, texto: 'Día, mes y año. Ejemplo: 05/03/1990' }));
    }
    if (c.rol === 'nombres' || c.rol === 'apellidos') attrs.autocapitalize = 'words';
    if (c.rol === 'telefono') { attrs.inputmode = 'numeric'; attrs.maxlength = '14'; }
    if (c.rol === 'numero_documento') { attrs.inputmode = 'numeric'; attrs.maxlength = '20'; }
    var entrada = el('input', attrs);
    if (c.tipo === 'fecha') entrada.addEventListener('input', function () {
      // Pone las barras solas cuando se escriben solo números y al final del campo.
      // Si la persona pone sus propias barras («1/1/2000»), se respeta lo que escribió.
      var v = entrada.value;
      var propias = v.split('').some(function (ch, i) { return ch === '/' ? (i !== 2 && i !== 5) : !/[0-9]/.test(ch); });
      if (!propias && entrada.selectionStart === v.length) entrada.value = N.fechaMientras(v);
    });
    var caja = el('div', { clase: 'campo', 'data-campo': c.id }, [etiquetaDe(c, id), entrada]);
    if (c.rol === 'municipio') sugerencias(c, entrada, caja);
    extra.forEach(function (e) { caja.appendChild(e); });
    caja.appendChild(parrafoError(c));
    return caja;
  }

  // El teclado del número de documento: solo números, salvo que el tipo sea «Otro».
  function ajustarDocumento() {
    var tipo = '', campoNum = null;
    forma.campos.forEach(function (c) {
      if (c.rol === 'tipo_documento') tipo = leerValor(c);
      if (c.rol === 'numero_documento') campoNum = c;
    });
    if (!campoNum) return;
    var entrada = $(idCampo(campoNum));
    if (entrada) entrada.setAttribute('inputmode', tipo === 'Otro' ? 'text' : 'numeric');
  }

  /* Sugerencias de municipios (lista del DANE). Se puede escribir cualquier cosa: la lista solo ayuda. */
  function sugerencias(c, entrada, caja) {
    var idLista = 'lista-' + c.id;
    var lista = el('ul', { clase: 'sugerencias', id: idLista, role: 'listbox', 'aria-label': 'Municipios sugeridos', hidden: true });
    var activo = -1, opciones = [];
    entrada.setAttribute('role', 'combobox');
    entrada.setAttribute('aria-autocomplete', 'list');
    entrada.setAttribute('aria-expanded', 'false');
    entrada.setAttribute('aria-controls', idLista);
    entrada.setAttribute('aria-describedby', 'ayuda-' + c.id + ' err-' + c.id);

    function cerrar() { lista.hidden = true; activo = -1; entrada.setAttribute('aria-expanded', 'false'); entrada.removeAttribute('aria-activedescendant'); }
    function elegir(m) { entrada.value = N.textoMunicipio(m); cerrar(); }
    function marcar(i) {
      activo = i;
      Array.prototype.forEach.call(lista.children, function (li, k) { li.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      if (i >= 0) entrada.setAttribute('aria-activedescendant', lista.children[i].id); else entrada.removeAttribute('aria-activedescendant');
    }
    function abrir() {
      opciones = N.buscarMunicipios(municipios, entrada.value, 6);
      vaciar(lista);
      if (!opciones.length) { cerrar(); return; }
      opciones.forEach(function (m, i) {
        var li = el('li', { role: 'option', id: idLista + '-' + i, 'aria-selected': 'false' },
          [el('span', { clase: 'sugerencias__mpio', texto: m[1] }), el('span', { clase: 'sugerencias__dpto', texto: m[2] })]);
        // pointerdown y no click: así se elige antes de que el campo pierda el foco.
        li.addEventListener('pointerdown', function (e) { e.preventDefault(); elegir(m); });
        lista.appendChild(li);
      });
      lista.hidden = false; activo = -1;
      entrada.setAttribute('aria-expanded', 'true');
    }
    entrada.addEventListener('input', abrir);
    entrada.addEventListener('blur', cerrar);
    entrada.addEventListener('keydown', function (e) {
      if (lista.hidden) { if (e.key === 'ArrowDown') { abrir(); if (opciones.length) marcar(0); e.preventDefault(); } return; }
      if (e.key === 'ArrowDown') { marcar((activo + 1) % opciones.length); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { marcar((activo - 1 + opciones.length) % opciones.length); e.preventDefault(); }
      else if (e.key === 'Enter' && activo >= 0) { elegir(opciones[activo]); e.preventDefault(); }
      else if (e.key === 'Escape') { cerrar(); e.preventDefault(); }
    });
    caja.classList.add('campo--sugerencias');
    caja.appendChild(lista);
    caja.appendChild(el('p', { clase: 'ayuda', id: 'ayuda-' + c.id,
      texto: municipios.length ? 'Escribe y elige de la lista del DANE. Si no aparece, escríbelo completo.' : 'Escribe el nombre del municipio.' }));
  }

  function leerValor(c) {
    if (c.tipo === 'opcion' || c.tipo === 'sino') {
      var sel = $(idCampo(c));
      if (sel && sel.tagName === 'SELECT') return sel.value;
      var marcado = document.querySelector('#campos input[name="' + c.id + '"]:checked');
      return marcado ? marcado.value : '';
    }
    var e = $(idCampo(c));
    return e ? e.value : '';
  }
  function ponerValor(c, v) {
    if (v === undefined || v === null) v = '';
    if (c.tipo === 'fecha') v = N.isoAFecha(v) || '';
    if (c.tipo === 'opcion' || c.tipo === 'sino') {
      var sel = $(idCampo(c));
      if (sel && sel.tagName === 'SELECT') { sel.value = v; return; }
      Array.prototype.forEach.call(document.querySelectorAll('#campos input[name="' + c.id + '"]'), function (r) { r.checked = r.value === String(v); });
      var q = document.querySelector('[data-campo="' + c.id + '"] .quitar-respuesta');
      if (q) q.hidden = !v;
      return;
    }
    var e = $(idCampo(c));
    if (e) e.value = String(v);
  }

  function limpiarErrores() {
    Array.prototype.forEach.call(document.querySelectorAll('#form-registro .error'), function (p) { p.hidden = true; p.textContent = ''; });
    Array.prototype.forEach.call(document.querySelectorAll('#form-registro [aria-invalid]'), function (n) { n.removeAttribute('aria-invalid'); });
    Array.prototype.forEach.call(document.querySelectorAll('#form-registro .campo--mal'), function (n) { n.classList.remove('campo--mal'); });
    $('repetido').hidden = true;
  }
  function pintarErrores(errores) {
    var primero = null;
    forma.campos.forEach(function (c) {
      if (!errores[c.id]) return;
      var p = $('err-' + c.id);
      p.textContent = errores[c.id]; p.hidden = false;
      var caja = document.querySelector('[data-campo="' + c.id + '"]');
      caja.classList.add('campo--mal');
      var foco = $(idCampo(c)) || caja.querySelector('input');
      if ($(idCampo(c))) $(idCampo(c)).setAttribute('aria-invalid', 'true'); else caja.setAttribute('aria-invalid', 'true');
      if (!primero) primero = foco;
    });
    if (errores._autorizacion) {
      $('err-autorizo').textContent = errores._autorizacion; $('err-autorizo').hidden = false;
      $('autorizo').setAttribute('aria-invalid', 'true');
      if (!primero) primero = $('autorizo');
    }
    var n = Object.keys(errores).length;
    $('err-resumen').textContent = n === 1 ? 'Falta revisar un dato para poder guardar.' : 'Faltan ' + n + ' datos por revisar para poder guardar.';
    $('err-resumen').hidden = false;
    if (primero) primero.focus();
  }

  function repetidoDe(valores) {
    var cTipo = null, cNum = null;
    forma.campos.forEach(function (c) { if (c.rol === 'tipo_documento') cTipo = c; if (c.rol === 'numero_documento') cNum = c; });
    if (!cNum || !valores[cNum.id]) return null;
    for (var i = 0; i < registros.length; i++) {
      var r = registros[i];
      if (editando && r.id === editando.id) continue;
      if (r.valores[cNum.id] === valores[cNum.id] && (!cTipo || r.valores[cTipo.id] === valores[cTipo.id])) return r;
    }
    return null;
  }

  function guardar(aunqueRepetido) {
    limpiarErrores();
    mensaje('msg-registrar', '');
    var crudos = {};
    forma.campos.forEach(function (c) { crudos[c.id] = leerValor(c); });
    var res = N.validar(forma, crudos, { autorizo: $('autorizo').checked });
    if (!res.ok) { pintarErrores(res.errores); return; }
    $('err-resumen').hidden = true;

    var rep = repetidoDe(res.valores);
    if (rep && !aunqueRepetido) {
      $('repetido-texto').textContent = 'Ya hay un registro con ese documento en este celular: ' + N.resumen(forma, rep).nombre +
        ', del ' + N.isoAFecha(N.isoLocal(rep.creado)) + ' a las ' + N.horaLocal(rep.creado) + '.';
      $('repetido').hidden = false;
      $('btn-repetido-si').focus();
      return;
    }

    var ahora = Date.now();
    var registro = editando
      ? { id: editando.id, creado: editando.creado, modificado: ahora, valores: Object.assign({}, editando.valores), forma: (editando.forma || []).slice() }
      : { id: A.nuevoId(), creado: ahora, valores: {}, forma: [] };
    // Lo que venía de un campo que ya no está en el formulario se conserva; lo demás se reemplaza.
    forma.campos.forEach(function (c) { delete registro.valores[c.id]; });
    Object.keys(res.valores).forEach(function (k) { registro.valores[k] = res.valores[k]; });
    var actuales = {};
    forma.campos.forEach(function (c) { actuales[c.id] = true; });
    registro.forma = forma.campos.map(function (c) { return [c.id, c.etiqueta, c.tipo]; })
      .concat((registro.forma || []).filter(function (f) { return !actuales[f[0]] && registro.valores[f[0]] !== undefined; }));
    registro.autorizo = forma.autorizacion.activa ? true : (editando ? editando.autorizo === true : false);

    $('btn-guardar').disabled = true;
    A.guardarRegistro(registro).then(function () {
      var eraEdicion = !!editando;
      return recargarRegistros().then(function () {
        A.pedirPermanencia();
        terminarEdicion();
        mensaje('msg-registrar', eraEdicion
          ? 'Cambios guardados.'
          : 'Registro guardado en este celular. Hoy van ' + deHoy().length + '.', true);
        window.scrollTo(0, 0);
      });
    }).catch(function () {
      $('err-resumen').textContent = 'No se pudo guardar en este celular. Revisa que tenga espacio libre y vuelve a intentar.';
      $('err-resumen').hidden = false;
    }).then(function () { $('btn-guardar').disabled = false; });
  }

  function empezarEdicion(r) {
    editando = r;
    location.hash = '#registrar';
    pintarFormulario();
    forma.campos.forEach(function (c) { ponerValor(c, r.valores[c.id]); });
    $('autorizo').checked = r.autorizo === true;
    ajustarDocumento();
    $('k-registrar').textContent = 'Corrigiendo un registro';
    $('btn-guardar').textContent = 'Guardar los cambios';
    $('btn-cancelar-edicion').hidden = false;
    mensaje('msg-registrar', '');
  }
  function terminarEdicion() {
    editando = null;
    $('k-registrar').textContent = 'Registro nuevo';
    $('btn-guardar').textContent = 'Guardar registro';
    $('btn-cancelar-edicion').hidden = true;
    pintarFormulario();
  }

  /* ---------- Registros ---------- */
  function recargarRegistros() {
    return A.registros().then(function (lista) { registros = lista; pintarConteos(); });
  }

  function pintarRegistros() {
    var hoy = deHoy().length;
    $('conteo-hoy').textContent = registros.length === 0
      ? 'Todavía no hay registros en este celular.'
      : 'Hoy, ' + N.isoAFecha(N.isoDeHoy()) + ': ' + plural(hoy, 'registro', 'registros') + '. En total hay ' + registros.length + ' en este celular.';
    $('btn-excel').disabled = $('btn-csv').disabled = registros.length === 0;
    $('exportar').hidden = registros.length === 0;

    var cont = $('lista-registros');
    vaciar(cont);
    var dias = {}, orden = [];
    registros.forEach(function (r) {
      var d = N.isoLocal(r.creado);
      if (!dias[d]) { dias[d] = []; orden.push(d); }
      dias[d].push(r);
    });
    var isoHoy = N.isoDeHoy();
    orden.forEach(function (d) {
      var titulo = (d === isoHoy ? 'Hoy · ' : '') + N.isoAFecha(d);
      cont.appendChild(el('h2', { clase: 'dia' }, [titulo, el('span', { clase: 'dia__n', texto: plural(dias[d].length, 'registro', 'registros') })]));
      var ul = el('ul', { clase: 'regs' });
      dias[d].forEach(function (r) { ul.appendChild(filaRegistro(r)); });
      cont.appendChild(ul);
    });
  }

  function filaRegistro(r) {
    var res = N.resumen(forma, r);
    var confirmar = el('div', { clase: 'confirmar', hidden: true });
    var btnBorrar = el('button', { type: 'button', clase: 'boton boton--linea boton--chico', texto: 'Borrar', 'aria-label': 'Borrar el registro de ' + res.nombre });
    var btnSi = el('button', { type: 'button', clase: 'boton boton--peligro boton--chico', texto: 'Sí, borrar' });
    var btnNo = el('button', { type: 'button', clase: 'boton boton--linea boton--chico', texto: 'No' });
    confirmar.appendChild(el('p', { texto: '¿Borrar este registro? No se puede deshacer.' }));
    confirmar.appendChild(el('div', { clase: 'fila-botones' }, [btnSi, btnNo]));
    btnBorrar.addEventListener('click', function () { confirmar.hidden = false; btnSi.focus(); });
    btnNo.addEventListener('click', function () { confirmar.hidden = true; btnBorrar.focus(); });
    btnSi.addEventListener('click', function () {
      A.borrarRegistros([r.id]).then(recargarRegistros).then(function () {
        pintarRegistros();
        mensaje('msg-registros', 'Registro borrado.', true);
      });
    });
    return el('li', { clase: 'reg' }, [
      el('div', { clase: 'reg__datos' }, [
        el('p', { clase: 'reg__nombre', texto: res.nombre }),
        el('p', { clase: 'reg__detalle', texto: [res.detalle, N.horaLocal(r.creado)].filter(Boolean).join(' · ') })
      ]),
      el('div', { clase: 'reg__acciones' }, [
        el('button', { type: 'button', clase: 'boton boton--linea boton--chico', texto: 'Editar', 'aria-label': 'Editar el registro de ' + res.nombre, en: { click: function () { empezarEdicion(r); } } }),
        btnBorrar
      ]),
      confirmar
    ]);
  }

  /* ---------- Exportar ---------- */
  function descargar(bytes, nombre, tipo) {
    var blob = new Blob([bytes], { type: tipo });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: nombre });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    try { return new File([blob], nombre, { type: tipo }); } catch (e) { return null; }
  }

  function exportar(formato) {
    if (!registros.length) return;
    // Del más antiguo al más nuevo: así queda en el orden en que llegó la gente.
    var lista = registros.slice().reverse();
    var t = N.tabla(forma, lista, municipios, window.Excel);
    var base = N.nombreArchivo(forma.titulo);
    var archivo, nombre;
    if (formato === 'xlsx') {
      nombre = base + '.xlsx';
      var bytes = window.Excel.crear({ hoja: forma.titulo, filas: [t.encabezados].concat(t.filas), anchos: t.anchos, estilosCol: t.estilosCol });
      archivo = descargar(bytes, nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      nombre = base + '.csv';
      archivo = descargar(N.csv(t.encabezados, t.filasTexto, t.numericas), nombre, 'text/csv;charset=utf-8');
    }
    ultimoArchivo = { file: archivo, ids: lista.map(function (r) { return r.id; }), nombre: nombre };
    mensaje('msg-registros', '');
    $('despues-titulo').textContent = 'Se descargó ' + nombre;
    $('despues-texto').textContent = 'Trae ' + plural(lista.length, 'registro', 'registros') + '. Ábrelo y revisa que esté completo antes de borrar nada: después de borrar no hay cómo recuperarlos.';
    $('despues-paso1').hidden = false;
    $('despues-paso2').hidden = true;
    var puedeCompartir = false;
    try { puedeCompartir = !!(archivo && navigator.canShare && navigator.canShare({ files: [archivo] })); } catch (e) { puedeCompartir = false; }
    $('btn-compartir').hidden = !puedeCompartir;
    $('despues').hidden = false;
    $('despues-titulo').focus();
  }

  function cerrarDespues() { $('despues').hidden = true; ultimoArchivo = null; pintarRegistros(); }

  /* ---------- Editor del formulario ---------- */
  function copia(o) { return JSON.parse(JSON.stringify(o)); }

  function abrirEditor() {
    if (!borrador) borrador = copia(forma);
    pintarEditor();
  }
  function pintarEditor() {
    $('ed-titulo').value = borrador.titulo;
    $('ed-aut-activa').checked = borrador.autorizacion.activa;
    $('ed-aut-texto').value = borrador.autorizacion.texto;
    var con = $('aviso-con-registros');
    con.hidden = registros.length === 0;
    con.textContent = registros.length === 0 ? '' : 'Hay ' + plural(registros.length, 'registro guardado', 'registros guardados') +
      ' en este celular. Si vas a cambiar los campos, primero expórtalos y bórralos, para no mezclar formularios en un mismo archivo.';
    var ol = $('ed-campos');
    vaciar(ol);
    borrador.campos.forEach(function (c, i) { ol.appendChild(tarjetaCampo(c, i)); });
    $('err-editor').hidden = true;
  }

  // Lleva al borrador lo que hay escrito en la pantalla (sin validar).
  function leerEditor() {
    borrador.titulo = $('ed-titulo').value;
    borrador.autorizacion = { activa: $('ed-aut-activa').checked, texto: $('ed-aut-texto').value };
    Array.prototype.forEach.call($('ed-campos').children, function (li, i) {
      var c = borrador.campos[i];
      c.etiqueta = li.querySelector('[data-ed="etiqueta"]').value;
      c.tipo = li.querySelector('[data-ed="tipo"]').value;
      c.obligatorio = li.querySelector('[data-ed="obligatorio"]').checked;
      if (c.tipo === 'opcion') {
        var area = li.querySelector('[data-ed="opciones"]');
        c.opciones = (area ? area.value : (c.opciones || []).join('\n')).split(/\r?\n/).map(function (o) { return N.limpio(o, N.LIMITES.opcion); }).filter(Boolean);
      } else delete c.opciones;
      if (c.rol && !N.rolPermitido(c.rol, c.tipo)) delete c.rol;
    });
  }

  function mover(i, hacia) {
    leerEditor();
    var j = i + hacia;
    if (j < 0 || j >= borrador.campos.length) return;
    var c = borrador.campos.splice(i, 1)[0];
    borrador.campos.splice(j, 0, c);
    pintarEditor();
    var boton = $('ed-campos').children[j].querySelector(hacia < 0 ? '[data-ed="subir"]' : '[data-ed="bajar"]');
    if (boton.disabled) boton = $('ed-campos').children[j].querySelector(hacia < 0 ? '[data-ed="bajar"]' : '[data-ed="subir"]');
    boton.focus();
    mensaje('msg-formulario', '');
  }

  function tarjetaCampo(c, i) {
    var n = i + 1, total = borrador.campos.length;
    var nombre = c.etiqueta || 'campo ' + n;
    var idE = 'ed-e-' + i, idT = 'ed-t-' + i, idO = 'ed-o-' + i;
    var etiqueta = el('input', { clase: 'caja', type: 'text', id: idE, 'data-ed': 'etiqueta', maxlength: String(N.LIMITES.etiqueta), value: c.etiqueta });
    var tipo = el('select', { clase: 'caja', id: idT, 'data-ed': 'tipo' }, N.TIPOS.map(function (t) {
      return el('option', { value: t[0], texto: t[1], selected: t[0] === c.tipo });
    }));
    var zonaOpciones = el('div', { clase: 'campo', hidden: c.tipo !== 'opcion' }, [
      el('label', { 'for': idO, texto: 'Opciones, una por línea' }),
      el('textarea', { clase: 'caja caja--area', id: idO, 'data-ed': 'opciones', rows: '7' })
    ]);
    zonaOpciones.querySelector('textarea').value = (c.opciones || []).join('\n');
    tipo.addEventListener('change', function () { zonaOpciones.hidden = tipo.value !== 'opcion'; });

    var li = el('li', { clase: 'ed-campo' }, [
      el('div', { clase: 'ed-campo__cab' }, [
        el('span', { clase: 'ed-campo__num', 'aria-hidden': 'true', texto: String(n) }),
        el('div', { clase: 'ed-campo__mover' }, [
          el('button', { type: 'button', clase: 'icono', 'data-ed': 'subir', 'aria-label': 'Subir ' + nombre, disabled: i === 0, texto: '↑', en: { click: function () { mover(i, -1); } } }),
          el('button', { type: 'button', clase: 'icono', 'data-ed': 'bajar', 'aria-label': 'Bajar ' + nombre, disabled: i === total - 1, texto: '↓', en: { click: function () { mover(i, 1); } } }),
          el('button', { type: 'button', clase: 'icono icono--texto', 'data-ed': 'quitar', 'aria-label': 'Quitar ' + nombre, texto: 'Quitar', en: { click: function () {
            leerEditor();
            borrador.campos.splice(i, 1);
            pintarEditor();
            mensaje('msg-formulario', 'Se quitó «' + nombre + '». Falta guardar el formulario.', true);
          } } })
        ])
      ]),
      el('div', { clase: 'campo' }, [el('label', { 'for': idE, texto: 'Nombre del campo' }), etiqueta]),
      el('div', { clase: 'campo' }, [el('label', { 'for': idT, texto: 'Tipo de respuesta' }), tipo]),
      zonaOpciones,
      el('label', { clase: 'casilla' }, [el('input', { type: 'checkbox', 'data-ed': 'obligatorio', checked: c.obligatorio }), el('span', { texto: 'Obligatorio' })]),
      c.rol && N.ROLES[c.rol] ? el('p', { clase: 'ayuda', texto: N.ROLES[c.rol] + '.' }) : null
    ]);
    return li;
  }

  function guardarEditor() {
    leerEditor();
    var res = N.leerForma(borrador);
    if (!res.error && $('ed-aut-activa').checked && !N.limpio($('ed-aut-texto').value)) res = { error: 'Escribe el texto de autorización o desmarca la casilla.' };
    if (res.error) {
      $('err-editor').textContent = res.error; $('err-editor').hidden = false; $('err-editor').scrollIntoView({ block: 'center' });
      return;
    }
    usarForma(res.forma, 'Formulario guardado en este celular: «' + res.forma.titulo + '», con ' + plural(res.forma.campos.length, 'campo', 'campos') + '.');
  }

  function usarForma(nueva, texto) {
    return A.guardarAjuste('formulario', nueva).then(function () {
      forma = nueva;
      borrador = copia(forma);
      if (editando) terminarEdicion(); else pintarFormulario();
      pintarEditor();
      mensaje('msg-formulario', texto, true);
      window.scrollTo(0, 0);
    }).catch(function () {
      $('err-editor').textContent = 'No se pudo guardar el formulario en este celular.'; $('err-editor').hidden = false;
    });
  }

  function importarForma(archivo) {
    if (!archivo) return;
    function fallo(t) { mensaje('msg-formulario', ''); $('err-editor').textContent = t; $('err-editor').hidden = false; $('err-editor').scrollIntoView({ block: 'center' }); }
    if (archivo.size > 200 * 1024) { fallo('Ese archivo es demasiado grande para ser un formulario.'); return; }
    var lector = new FileReader();
    lector.onerror = function () { fallo('No se pudo leer el archivo.'); };
    lector.onload = function () {
      var dato;
      try { dato = JSON.parse(String(lector.result)); } catch (e) { fallo('El archivo no es un formulario de esta herramienta (no es un JSON válido).'); return; }
      var res = N.leerForma(dato);
      if (res.error) { fallo(res.error); return; }
      $('err-editor').hidden = true;
      usarForma(res.forma, 'Formulario importado y guardado: «' + res.forma.titulo + '», con ' + plural(res.forma.campos.length, 'campo', 'campos') + '.');
    };
    lector.readAsText(archivo);
  }

  /* ---------- Sin conexión: service worker ---------- */
  function listo(texto, ok) {
    $('estado-listo').textContent = texto;
    $('punto-listo').classList.toggle('punto--ok', !!ok);
  }
  function prepararSinConexion() {
    if (!('serviceWorker' in navigator)) { listo('Este navegador no permite usar la página sin conexión.', false); return; }
    var recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // Solo se recarga cuando la persona pidió actualizar; la primera instalación no interrumpe.
      if (recargando) location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function ofrecer() { if (reg.waiting && navigator.serviceWorker.controller) $('actualizar').hidden = false; }
      ofrecer();
      reg.addEventListener('updatefound', function () {
        var nuevo = reg.installing;
        if (nuevo) nuevo.addEventListener('statechange', function () { if (nuevo.state === 'installed') ofrecer(); });
      });
      $('btn-actualizar').addEventListener('click', function () {
        if (!reg.waiting) { location.reload(); return; }
        recargando = true;
        reg.waiting.postMessage({ tipo: 'ACTUALIZAR' });
      });
      return navigator.serviceWorker.ready;
    }).then(function () {
      listo('Lista para usar sin conexión en este celular.', true);
    }).catch(function () {
      listo('No se pudo preparar el uso sin conexión. Recarga la página con internet.', false);
    });
  }

  function prepararInstalacion() {
    var aviso = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); aviso = e; $('btn-instalar').hidden = false;
    });
    $('btn-instalar').addEventListener('click', function () {
      if (!aviso) return;
      aviso.prompt();
      aviso = null; $('btn-instalar').hidden = true;
    });
    window.addEventListener('appinstalled', function () { $('btn-instalar').hidden = true; });
  }

  /* ---------- Arranque ---------- */
  function enlazar() {
    window.addEventListener('hashchange', mostrar);
    window.addEventListener('online', pintarRed);
    window.addEventListener('offline', pintarRed);

    $('form-registro').addEventListener('submit', function (e) { e.preventDefault(); guardar(false); });
    $('btn-repetido-si').addEventListener('click', function () { guardar(true); });
    $('btn-repetido-no').addEventListener('click', function () { $('repetido').hidden = true; $('btn-guardar').focus(); });
    $('btn-cancelar-edicion').addEventListener('click', function () { terminarEdicion(); location.hash = '#registros'; });

    $('btn-excel').addEventListener('click', function () { exportar('xlsx'); });
    $('btn-csv').addEventListener('click', function () { exportar('csv'); });
    $('btn-dejar').addEventListener('click', function () { cerrarDespues(); $('btn-excel').focus(); });
    $('btn-compartir').addEventListener('click', function () {
      if (ultimoArchivo && ultimoArchivo.file) navigator.share({ files: [ultimoArchivo.file], title: ultimoArchivo.nombre }).catch(function () { /* la persona cerró el menú */ });
    });
    $('btn-borrar-exportados').addEventListener('click', function () {
      if (!ultimoArchivo) return;
      $('despues-pregunta').textContent = '¿Borrar de este celular los ' + ultimoArchivo.ids.length + ' registros que quedaron en ' + ultimoArchivo.nombre + '? No se puede deshacer.';
      if (ultimoArchivo.ids.length === 1) $('despues-pregunta').textContent = '¿Borrar de este celular el registro que quedó en ' + ultimoArchivo.nombre + '? No se puede deshacer.';
      $('despues-paso1').hidden = true; $('despues-paso2').hidden = false;
      $('btn-borrar-si').focus();
    });
    $('btn-borrar-no').addEventListener('click', function () { $('despues-paso2').hidden = true; $('despues-paso1').hidden = false; $('btn-dejar').focus(); });
    $('btn-borrar-si').addEventListener('click', function () {
      if (!ultimoArchivo) return;
      var n = ultimoArchivo.ids.length;
      A.borrarRegistros(ultimoArchivo.ids).then(recargarRegistros).then(function () {
        cerrarDespues();
        mensaje('msg-registros', n === 1 ? 'Se borró el registro de este celular.' : 'Se borraron ' + n + ' registros de este celular.', true);
      });
    });

    $('form-editor').addEventListener('submit', function (e) { e.preventDefault(); guardarEditor(); });
    $('btn-agregar').addEventListener('click', function () {
      leerEditor();
      if (borrador.campos.length >= N.LIMITES.campos) { $('err-editor').textContent = 'El formulario ya tiene el máximo de campos.'; $('err-editor').hidden = false; return; }
      var usados = {};
      borrador.campos.forEach(function (c) { usados[c.id] = true; });
      registros.forEach(function (r) { (r.forma || []).forEach(function (f) { usados[f[0]] = true; }); });
      borrador.campos.push({ id: N.nuevoId(usados), etiqueta: '', tipo: 'texto', obligatorio: false });
      pintarEditor();
      var ultimo = $('ed-campos').lastElementChild;
      ultimo.querySelector('[data-ed="etiqueta"]').focus();
    });
    $('btn-exportar-forma').addEventListener('click', function () {
      var nombre = 'formulario_' + (N.plano(forma.titulo).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'campo') + '.json';
      descargar(JSON.stringify(forma, null, 2) + '\n', nombre, 'application/json');
      mensaje('msg-formulario', 'Se descargó ' + nombre + ' con el formulario guardado. Compártelo con tu equipo.', true);
    });
    $('archivo-forma').addEventListener('change', function () { importarForma(this.files[0]); this.value = ''; });
    $('btn-plantilla').addEventListener('click', function () { $('plantilla-confirmar').hidden = false; $('btn-plantilla-si').focus(); });
    $('btn-plantilla-no').addEventListener('click', function () { $('plantilla-confirmar').hidden = true; $('btn-plantilla').focus(); });
    $('btn-plantilla-si').addEventListener('click', function () {
      $('plantilla-confirmar').hidden = true;
      usarForma(N.plantilla(), 'Volviste a la plantilla «Inscripción de participantes».');
    });
  }

  function cargarMunicipios() {
    return fetch('data/municipios.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && Array.isArray(d.municipios)) {
        municipios = d.municipios.filter(function (m) { return Array.isArray(m) && m.length === 3; });
        if (d.consultado) $('fecha-municipios').textContent = String(d.consultado);
      }
    }).catch(function () { municipios = []; });
  }

  function arrancar() {
    enlazar();
    pintarRed();
    prepararSinConexion();
    prepararInstalacion();
    var datos = A.abrir().then(function () { return Promise.all([A.leerAjuste('formulario'), recargarRegistros()]); }).then(function (r) {
      var guardada = r[0] ? N.leerForma(r[0]) : null;
      if (guardada && guardada.forma) forma = guardada.forma;
    }).catch(function () {
      hayAlmacen = false;
      $('sin-almacen').hidden = false;
      $('btn-guardar').disabled = true;
      $('btn-guardar-forma').disabled = true;
    });
    Promise.all([datos, cargarMunicipios()]).then(function () {
      pintarFormulario();
      pintarConteos();
      mostrar();
      document.documentElement.setAttribute('data-lista', hayAlmacen ? 'si' : 'no');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
