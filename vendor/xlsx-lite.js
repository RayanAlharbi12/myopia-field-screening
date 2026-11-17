/* =====================================================================
   xlsx-lite — a small, dependency-free .xlsx (SpreadsheetML) writer.
   Bundled locally: no CDN, works offline. Written for this project.

   XlsxLite.workbook(sheets, meta) -> Blob
   sheet = {
     name: 'Participants',
     rows: [[...], ...],           // first `headerRows` rows are headers
     headerRows: 1 | 2,
     types: ['text'|'int'|'power'|'num', ...],   // per column, for data rows
     freeze: { rows: 1, cols: 0 },
     autoFilter: true,             // filter on the last header row
     rtl: false,                   // right-to-left sheet view
     minWidth: 8, maxWidth: 48
   }
   Strings are shared strings (UTF-8, so Arabic is preserved exactly).
   A numeric-looking text such as "1-17" or "6/9" stays text.
   ===================================================================== */
(function (root) {
  'use strict';

  var XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NSR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NSP = 'http://schemas.openxmlformats.org/package/2006/relationships';

  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colRef(i) { var s = ''; i += 1; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  /* style ids (cellXfs order below) */
  var ST = { normal: 0, header: 1, text: 2, int: 3, power: 4, section: 5, num: 6 };
  var STYLES = XML +
    '<styleSheet xmlns="' + NS + '">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="+0.00;-0.00;0.00"/></numFmts>' +
    '<fonts count="3">' +
      '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FF3E4A45"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="4">' +
      '<fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEEA"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F6F3"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFB9C4BD"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf numFmtId="49" fontId="2" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function SharedStrings() { this.map = Object.create(null); this.list = []; this.count = 0; }
  SharedStrings.prototype.idx = function (s) {
    s = String(s); this.count++;
    if (!(s in this.map)) { this.map[s] = this.list.length; this.list.push(s); }
    return this.map[s];
  };
  SharedStrings.prototype.xml = function () {
    return XML + '<sst xmlns="' + NS + '" count="' + this.count + '" uniqueCount="' + this.list.length + '">' +
      this.list.map(function (s) { return '<si><t xml:space="preserve">' + esc(s) + '</t></si>'; }).join('') + '</sst>';
  };

  /* display width estimate (Arabic and CJK are roughly as wide as Latin at 11pt) */
  function textWidth(v) {
    var s = String(v == null ? '' : v), w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2E80 ? 1.8 : 1;
    return w;
  }

  function sheetXml(sh, sst) {
    var rows = sh.rows, hr = sh.headerRows || 1, types = sh.types || [];
    var ncol = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    var minW = sh.minWidth || 8, maxW = sh.maxWidth || 48;
    var out = [XML + '<worksheet xmlns="' + NS + '" xmlns:r="' + NSR + '">'];
    out.push('<dimension ref="A1:' + colRef(Math.max(ncol, 1) - 1) + Math.max(rows.length, 1) + '"/>');
    var fr = (sh.freeze && sh.freeze.rows) || 0, fc = (sh.freeze && sh.freeze.cols) || 0;
    out.push('<sheetViews><sheetView workbookViewId="0"' + (sh.rtl ? ' rightToLeft="1"' : '') + '>');
    if (fr || fc) {
      var tl = colRef(fc) + (fr + 1);
      var pane = fr && fc ? 'bottomRight' : (fr ? 'bottomLeft' : 'topRight');
      out.push('<pane' + (fc ? ' xSplit="' + fc + '"' : '') + (fr ? ' ySplit="' + fr + '"' : '') + ' topLeftCell="' + tl + '" activePane="' + pane + '" state="frozen"/>');
      out.push('<selection pane="' + pane + '" activeCell="' + tl + '" sqref="' + tl + '"/>');
    }
    out.push('</sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"/>');
    out.push('<cols>');
    for (var c = 0; c < ncol; c++) {
      var w = 0;
      for (var r = hr; r < rows.length && r < hr + 400; r++) w = Math.max(w, textWidth(rows[r][c]));
      var hw = 0;
      for (var h = 0; h < hr; h++) hw = Math.max(hw, Math.min(textWidth(rows[h] && rows[h][c]), h === hr - 1 ? 34 : 22));
      w = Math.max(w, hw);
      w = Math.min(Math.max(w + 2, minW), maxW);
      out.push('<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w.toFixed(1) + '" customWidth="1"/>');
    }
    out.push('</cols><sheetData>');
    rows.forEach(function (row, ri) {
      var isHead = ri < hr;
      var ht = '';
      if (isHead) {
        var longest = row.reduce(function (m, v) { return Math.max(m, textWidth(v)); }, 0);
        if (ri === hr - 1 && longest > 30) ht = ' ht="' + (hr > 1 ? 64 : 30) + '" customHeight="1"';
        else if (ri < hr - 1 && longest > 22) ht = ' ht="30" customHeight="1"';
      }
      var cells = '';
      for (var ci = 0; ci < row.length; ci++) {
        var v = row[ci], ref = colRef(ci) + (ri + 1);
        if (v === '' || v == null) continue;
        if (isHead) {
          cells += '<c r="' + ref + '" t="s" s="' + (ri < hr - 1 ? ST.section : ST.header) + '"><v>' + sst.idx(v) + '</v></c>';
          continue;
        }
        var t = types[ci] || 'text';
        if (typeof v === 'number' && isFinite(v) && t !== 'text') {
          var s = t === 'int' ? ST.int : t === 'power' ? ST.power : ST.num;
          cells += '<c r="' + ref + '" s="' + s + '"><v>' + v + '</v></c>';
        } else {
          cells += '<c r="' + ref + '" t="s" s="' + ST.text + '"><v>' + sst.idx(v) + '</v></c>';
        }
      }
      out.push('<row r="' + (ri + 1) + '"' + ht + '>' + cells + '</row>');
    });
    out.push('</sheetData>');
    if (sh.autoFilter && ncol) out.push('<autoFilter ref="A' + hr + ':' + colRef(ncol - 1) + Math.max(rows.length, hr) + '"/>');
    out.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
    out.push('</worksheet>');
    return out.join('');
  }

  /* ---- ZIP (stored, no compression) ---- */
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files, mime) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0, d = new Date();
    var tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (s, b) { return s + b.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: mime });
  }

  function workbook(sheets, meta) {
    meta = meta || {};
    var sst = new SharedStrings();
    var sheetFiles = sheets.map(function (sh, i) { return { name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sh, sst) }; });
    var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var ct = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
    var rels = XML + '<Relationships xmlns="' + NSP + '">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
    var defined = sheets.map(function (s, i) {
      if (!s.autoFilter) return '';
      var hr = s.headerRows || 1, ncol = s.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      if (!ncol) return '';
      return '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + s.name.replace(/'/g, "''") + '\'!$A$' + hr + ':$' + colRef(ncol - 1) + '$' + Math.max(s.rows.length, hr) + '</definedName>';
    }).join('');
    var wb = XML + '<workbook xmlns="' + NS + '" xmlns:r="' + NSR + '"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
      sheets.map(function (s, i) { return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
      '</sheets>' + (defined ? '<definedNames>' + defined + '</definedNames>' : '') + '</workbook>';
    var wbRels = XML + '<Relationships xmlns="' + NSP + '">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId' + (sheets.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '</Relationships>';
    var core = XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(meta.title || 'Export') + '</dc:title><dc:creator>' + esc(meta.creator || 'xlsx-lite') + '</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified>' +
      '</cp:coreProperties>';
    var app = XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>' + esc(meta.app || 'xlsx-lite') + '</Application></Properties>';
    var files = [
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rels },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app },
      { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: STYLES }
    ].concat(sheetFiles, [{ name: 'xl/sharedStrings.xml', data: sst.xml() }]);
    return zip(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  root.XlsxLite = { workbook: workbook, _zip: zip, _crc32: crc32 };
})(window);
