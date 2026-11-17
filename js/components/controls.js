/* =====================================================================
   Form controls and the binding engine used by the stations.
   Binding keys (data-b):
     s|store|field        a field of a single per-participant record
     i|store|id|field     a field of one entry in a multi-record store
     n                    the participant name (participant record)
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc;
  var C = MF.controls = {};

  function enc(v) { return esc(JSON.stringify(v === undefined ? null : v)); }

  C.read = function (session, b) {
    var p = b.split('|');
    if (p[0] === 's') { var r = session.b[p[1]]; return r ? r[p[2]] : undefined; }
    if (p[0] === 'i') { var e = session.find(p[1], p[2]); return e ? e[p[3]] : undefined; }
    if (p[0] === 'n') return session.b.participant.name;
    return undefined;
  };
  C.write = function (session, b, v) {
    var p = b.split('|');
    if (p[0] === 's') return session.set(p[1], p[2], v);
    if (p[0] === 'i') { var patch = {}; patch[p[3]] = v; return session.update(p[1], p[2], patch); }
    if (p[0] === 'n') return session.setName(v);
  };

  /* single choice; options [{v, ar, sub?}] — an option with v === null is the explicit "Not tested" */
  C.choice = function (bind, options, o) {
    o = o || {};
    var cls = 'choices' + (o.cols ? ' grid-' + o.cols : '') + (o.stack ? ' stack' : '') + (o.cls ? ' ' + o.cls : '');
    return '<div class="' + cls + '" role="radiogroup" data-b="' + esc(bind) + '" data-mode="one"' + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + '>' +
      options.map(function (op) {
        var text = o.ltr || op.ltr ? D.ltr(op.ar) : esc(op.ar);
        return '<button type="button" role="radio" aria-checked="false" class="opt' + (op.v === null ? ' opt-nt' : '') + (o.compact ? ' compact' : '') + (o.center ? ' center' : '') + '" data-v="' + enc(op.v) + '">' +
          '<span class="mark" aria-hidden="true"></span><span class="opt-t">' + text + (op.sub ? '<span class="sub">' + esc(op.sub) + '</span>' : '') + '</span></button>';
      }).join('') + '</div>';
  };
  /* multiple choice (array field) */
  C.multi = function (bind, options, o) {
    o = o || {};
    var cls = 'choices' + (o.cols ? ' grid-' + o.cols : '') + (o.stack ? ' stack' : '') + (o.cls ? ' ' + o.cls : '');
    return '<div class="' + cls + '" role="group" data-b="' + esc(bind) + '" data-mode="many"' + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + '>' +
      options.map(function (op) {
        return '<button type="button" aria-pressed="false" class="opt is-multi' + (o.compact ? ' compact' : '') + '" data-v="' + enc(op.v) + '">' +
          '<span class="mark" aria-hidden="true"></span><span class="opt-t">' + (o.ltr ? D.ltr(op.ar) : esc(op.ar)) + '</span></button>';
      }).join('') + '</div>';
  };
  /* a boolean toggle rendered as one checkable option */
  C.toggle = function (bind, text, o) {
    o = o || {};
    return '<div class="choices" data-b="' + esc(bind) + '" data-mode="bool">' +
      '<button type="button" aria-pressed="false" class="opt is-multi' + (o.compact ? ' compact' : '') + (o.block ? ' opt-wide' : '') + '" data-v="true"><span class="mark" aria-hidden="true"></span><span class="opt-t">' + text + '</span></button></div>';
  };

  C.text = function (bind, o) {
    o = o || {};
    var t = o.type || 'text';
    return '<input class="input' + (o.num ? ' input-num' : '') + (o.cls ? ' ' + o.cls : '') + '" data-b="' + esc(bind) + '" data-type="' + esc(o.dtype || 'text') + '"' +
      ' type="' + t + '"' + (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') + (o.pattern ? ' pattern="' + o.pattern + '"' : '') +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.maxlength ? ' maxlength="' + o.maxlength + '"' : '') +
      (o.id ? ' id="' + esc(o.id) + '"' : '') + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') +
      ' autocomplete="off"' + (o.dir ? ' dir="' + o.dir + '"' : '') + ' enterkeyhint="next">';
  };
  C.textarea = function (bind, o) {
    o = o || {};
    return '<textarea class="textarea" data-b="' + esc(bind) + '" data-type="text"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '') + ' rows="' + (o.rows || 4) + '"></textarea>';
  };

  /* question block */
  C.q = function (label, control, o) {
    o = o || {};
    return '<div class="q' + (o.cls ? ' ' + o.cls : '') + '"' + (o.id ? ' id="' + esc(o.id) + '"' : '') + (o.when ? ' data-when="' + esc(o.when) + '"' : '') + '>' +
      (label ? '<div class="q-label">' + (o.num != null ? '<span class="q-num num">' + o.num + '</span>' : '') + '<span class="q-text">' + label + '</span></div>' : '') +
      (o.hint ? '<p class="hint">' + o.hint + '</p>' : '') +
      '<div class="q-ctl">' + control + '</div>' + (o.after || '') + '</div>';
  };
  /* progressive disclosure: a follow-up that appears only when its condition is met */
  C.reveal = function (when, html, o) {
    o = o || {};
    return '<div class="reveal' + (o.cls ? ' ' + o.cls : '') + '" data-when="' + esc(when) + '">' + html + '</div>';
  };
  /* note shown when a hidden branch still holds data (it is kept, never silently deleted) */
  C.keptNote = function (key) {
    return '<div class="kept" data-kept="' + esc(key) + '" hidden>' + MF.icon('info', 'ic-sm') + '<span class="kept-t"></span>' +
      '<button type="button" class="btn btn-quiet kept-clear" data-sa="kept-clear" data-key="' + esc(key) + '">مسح البيانات المخفية</button></div>';
  };

  /* ---------- binding engine ---------- */
  function parseInput(el) {
    var t = el.getAttribute('data-type'), raw = el.value;
    if (t === 'int' || t === 'num') {
      var s = D.normalizeDigits(raw);
      if (s === '') return null;
      var n = t === 'int' ? parseInt(s, 10) : parseFloat(s);
      return isFinite(n) ? n : null;
    }
    return raw;
  }

  /* install delegated handlers once per root; getSession() returns the active session */
  C.install = function (root, getSession, hooks) {
    hooks = hooks || {};
    root.addEventListener('click', function (e) {
      var opt = e.target.closest('.opt[data-v]');
      if (!opt || !root.contains(opt)) return;
      var box = opt.closest('[data-b]');
      if (!box || box.tagName === 'INPUT') return;
      var s = getSession(), b = box.getAttribute('data-b'), mode = box.getAttribute('data-mode');
      var v = JSON.parse(opt.getAttribute('data-v'));
      if (hooks.beforeChoice && hooks.beforeChoice(b, v, opt) === false) return;
      if (mode === 'many') {
        var list = (C.read(s, b) || []).slice(), i = list.indexOf(v);
        if (i >= 0) list.splice(i, 1); else list.push(v);
        C.write(s, b, list);
      } else if (mode === 'bool') {
        C.write(s, b, !C.read(s, b));
      } else {
        /* a single-choice answer is set, never toggled off by a second tap */
        C.write(s, b, v);
      }
      if (hooks.afterChoice) hooks.afterChoice(b, v, opt);
    });
    root.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.matches || !el.matches('[data-b]') || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      var v = parseInput(el);
      C.write(getSession(), el.getAttribute('data-b'), v);
      if (hooks.afterInput) hooks.afterInput(el.getAttribute('data-b'), v, el);
    });
    root.addEventListener('change', function (e) {
      var el = e.target;
      if (!el.matches || !el.matches('input[data-b][data-type="int"], input[data-b][data-type="num"]')) return;
      /* normalise the visible text on leaving the field (e.g. Arabic digits) */
      var v = parseInput(el);
      el.value = v == null ? '' : String(v);
    });
  };

  C.sync = function (root, session, when) {
    D.qsa('[data-b]', root).forEach(function (el) {
      var b = el.getAttribute('data-b'), v = C.read(session, b);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (document.activeElement === el) return;          /* never fight the examiner's typing */
        var s = v == null ? '' : String(v);
        if (el.value !== s) el.value = s;
        return;
      }
      var mode = el.getAttribute('data-mode');
      D.qsa('.opt[data-v]', el).forEach(function (opt) {
        var ov = JSON.parse(opt.getAttribute('data-v'));
        if (mode === 'many') opt.setAttribute('aria-pressed', String((v || []).indexOf(ov) >= 0));
        else if (mode === 'bool') opt.setAttribute('aria-pressed', String(!!v));
        else opt.setAttribute('aria-checked', String(v === ov || (ov === null && v == null)));
      });
    });
    if (when) {
      D.qsa('[data-when]', root).forEach(function (el) {
        var k = el.getAttribute('data-when');
        var show = !!when[k];
        if (el.hidden === !show) return;
        el.hidden = !show;
        if (show && !D.prefersReducedMotion()) { el.classList.remove('rv-in'); void el.offsetWidth; el.classList.add('rv-in'); }
      });
    }
  };

  C.keptSync = function (root, kept) {
    D.qsa('[data-kept]', root).forEach(function (el) {
      var k = el.getAttribute('data-kept'), info = kept && kept[k];
      el.hidden = !info;
      if (info) el.querySelector('.kept-t').textContent = info;
    });
  };
})();
