/* Arma un .xlsx real (Office Open XML) sin librerías: unas pocas partes XML dentro de un .zip.
   Los números van como números y las fechas como fechas, para que Excel pueda filtrar y ordenar.
   Viene de Estado-X/facturas-colombia (assets/excel.js, licencia MIT, Copyright (c) 2026 Estado X):
   https://github.com/Estado-X/facturas-colombia
   Aquí se quitó lo propio de las facturas (columnas, totales y fórmulas) y se dejó un libro
   de una sola hoja. Ninguna celda se escribe como fórmula. */
(function (raiz) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function columna(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function serial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return null;
    return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  // Estilos: 0 normal · 1 encabezado · 2 fecha (dd/mm/aaaa) · 3 texto literal (quotePrefix)
  var ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2EBDC"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  var ENCABEZADO = 1, FECHA = 2, LITERAL = 3;

  function celda(ref, v, estilo) {
    if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"' + (estilo ? ' s="' + estilo + '"' : '') + '><v>' + v + '</v></c>';
    if (v === null || v === undefined || v === '') return '';
    // Texto que empieza como fórmula: se marca como texto literal para que Excel nunca lo calcule.
    if (/^[=+\-@\t\r]/.test(String(v)) && estilo !== ENCABEZADO) estilo = LITERAL;
    return '<c r="' + ref + '" t="inlineStr"' + (estilo ? ' s="' + estilo + '"' : '') + '><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
  }

  /* filas: [[valor, ...]] con el encabezado en la primera · anchos: ancho por columna
     estilosCol: estilo por columna para las filas de datos (2 = fecha) */
  function hoja(filas, anchos, estilosCol) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + anchos.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols><sheetData>';
    filas.forEach(function (fila, r) {
      x += '<row r="' + (r + 1) + '">';
      fila.forEach(function (v, c) {
        var est = r === 0 ? ENCABEZADO : (estilosCol ? estilosCol[c] : 0);
        // Una fecha que no llegó como número se deja como texto, sin formato de fecha.
        if (est === FECHA && typeof v !== 'number') est = 0;
        x += celda(columna(c) + (r + 1), v, est);
      });
      x += '</row>';
    });
    x += '</sheetData>';
    if (filas.length > 1) x += '<autoFilter ref="A1:' + columna(filas[0].length - 1) + filas.length + '"/>';
    return x + '</worksheet>';
  }

  // Nombre de hoja válido para Excel: sin \ / ? * [ ] : ni apóstrofos, y de 31 caracteres como máximo.
  function nombreHoja(t) {
    var n = String(t || '').replace(/[\\\/\?\*\[\]:']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31).trim();
    return n || 'Registros';
  }

  /* tabla: { hoja, filas: [[encabezados], [fila], ...], anchos, estilosCol } → Uint8Array del .xlsx */
  function crear(tabla, Zip, fechaZip) {
    Zip = Zip || raiz.Zip;
    var filas = tabla.filas;
    var n = filas[0].length;
    var anchos = tabla.anchos || filas[0].map(function () { return 18; });
    var nom = nombreHoja(tabla.hoja);
    var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var archivos = [
      { nombre: '[Content_Types].xml', datos: XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },
      { nombre: '_rels/.rels', datos: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { nombre: 'xl/workbook.xml', datos: XML +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + esc(nom) + '" sheetId="1" r:id="rId1"/></sheets>' +
        (filas.length > 1 ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' + "'" + esc(nom) + "'" + '!$A$1:$' + columna(n - 1) + '$' + filas.length + '</definedName></definedNames>' : '') +
        '</workbook>' },
      { nombre: 'xl/_rels/workbook.xml.rels', datos: XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>' },
      { nombre: 'xl/worksheets/sheet1.xml', datos: hoja(filas, anchos, tabla.estilosCol) },
      { nombre: 'xl/styles.xml', datos: ESTILOS }
    ];
    return Zip.crear(archivos, fechaZip);
  }

  var Excel = { crear: crear, serial: serial, columna: columna, nombreHoja: nombreHoja, FECHA: FECHA };
  if (typeof module !== 'undefined' && module.exports) module.exports = Excel;
  else raiz.Excel = Excel;
})(this);
