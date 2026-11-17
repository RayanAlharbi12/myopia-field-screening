/* Formatting and parsing of clinical values (display, typed entry, export). */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom;

  var MINUS = '−';   /* true minus sign for display; exports use ASCII "-" */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* +1.25 / 0.00 / −1.25 */
  function power(v, ascii) {
    if (!isNum(v)) return MF.NT_LABEL;
    var a = Math.abs(v).toFixed(2);
    if (v > 0) return '+' + a;
    if (v < 0) return (ascii ? '-' : MINUS) + a;
    return '0.00';
  }
  function axis(v) { return isNum(v) ? v + '°' : MF.NT_LABEL; }
  function va(v) { return v ? v : MF.NT_LABEL; }

  function display(kind, v) {
    if (v == null) return MF.NT_LABEL;
    if (kind === 'axis') return axis(v);
    if (kind === 'va') return va(v);
    return power(v);
  }

  /* ---- typed entry --------------------------------------------------
     returns {value, snapped:boolean, from:string} or {error, suggestions?} */
  function parsePower(kind, raw) {
    var sc = MF.SCALES[kind];
    var s = D.normalizeDigits(raw).replace(/d$/i, '');
    if (s === '' ) return { error: 'empty' };
    if (/^(nt|not ?tested)$/i.test(s)) return { value: null, nt: true };
    if (s === 'plano' || s === 'pl') s = '0';
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return { error: 'أدخل رقمًا مثل −1.25 أو +0.50' };
    var n = parseFloat(s);
    if (!isFinite(n)) return { error: 'أدخل رقمًا مثل −1.25 أو +0.50' };
    if (n < sc.min || n > sc.max) return { error: 'القيمة خارج النطاق (' + power(sc.min) + ' إلى ' + power(sc.max) + ')' };
    var snapped = Math.round(n / sc.step) * sc.step;
    snapped = Math.round(snapped * 100) / 100;
    if (Object.is(snapped, -0)) snapped = 0;
    return { value: snapped, snapped: Math.abs(snapped - n) > 1e-9, from: s };
  }
  function parseAxis(raw) {
    var s = D.normalizeDigits(raw).replace(/[°º]/g, '');
    if (s === '') return { error: 'empty' };
    if (/^(nt|not ?tested)$/i.test(s)) return { value: null, nt: true };
    if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'أدخل محورًا من 0 إلى 180' };
    var n = parseFloat(s);
    if (n < 0 || n > 180) return { error: 'المحور يجب أن يكون من 0° إلى 180°' };
    var snapped = Math.round(n / 5) * 5;
    return { value: snapped, snapped: snapped !== n, from: s };
  }
  function parseVA(raw) {
    var s = D.normalizeDigits(raw).toUpperCase().replace(/\\/g, '/');
    if (s === '') return { error: 'empty' };
    if (/^(NT|NOTTESTED)$/.test(s.replace(/\s/g, ''))) return { value: null, nt: true };
    var scale = MF.VA_SCALE;
    var aliases = { 'PL': 'LP', 'NPL': 'NLP', 'FC': 'CF', 'HMM': 'HM' };
    if (aliases[s]) s = aliases[s];
    var exact = scale.filter(function (v) { return v.toUpperCase() === s; })[0];
    if (exact) return { value: exact };
    /* invalid: never invent a value — offer the closest valid choices */
    var sugg = [];
    var m = /^6\/(\d+(\.\d+)?)$/.exec(s);
    if (m) {
      var d = parseFloat(m[1]);
      var nums = scale.filter(function (v) { return /^6\//.test(v); });
      nums.sort(function (a, b) { return Math.abs(parseFloat(a.slice(2)) - d) - Math.abs(parseFloat(b.slice(2)) - d); });
      sugg = nums.slice(0, 2);
    } else {
      sugg = scale.filter(function (v) { return v.toUpperCase().indexOf(s) === 0; });
      if (!sugg.length) sugg = scale.filter(function (v) { return v.toUpperCase().indexOf(s.charAt(0)) >= 0; }).slice(0, 4);
    }
    return { error: 'قيمة غير مدرجة', suggestions: sugg };
  }
  function parse(kind, raw) {
    if (kind === 'axis') return parseAxis(raw);
    if (kind === 'va') return parseVA(raw);
    return parsePower(kind, raw);
  }

  /* index of a VA value (0 = 6/6 = best); -1 if not tested */
  function vaRank(v) { return v ? MF.VA_SCALE.indexOf(v) : -1; }
  function vaWorseThanLimit(v) { var r = vaRank(v); return r >= 0 && r > MF.VA_SCALE.indexOf(MF.VA_REFERRAL_LIMIT); }
  function powerOverLimit(v) { return isNum(v) && Math.abs(v) > MF.REFRACTIVE_LIMIT + 1e-9; }

  /* Arabic ordinals for birth order ("الأول بين الأبناء") */
  var ORD = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
    'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'];
  function ordinal(n) { return ORD[n] || ('رقم ' + n); }

  /* numbers in Arabic UI are shown with Western digits for consistency with clinical values */
  function num(n, digits) {
    if (!isNum(n)) return '';
    var s = digits != null ? n.toFixed(digits) : String(n);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  MF.fmt = {
    MINUS: MINUS, isNum: isNum, power: power, axis: axis, va: va, display: display,
    parse: parse, vaRank: vaRank, vaWorseThanLimit: vaWorseThanLimit, powerOverLimit: powerOverLimit,
    ordinal: ordinal, num: num
  };
})();
