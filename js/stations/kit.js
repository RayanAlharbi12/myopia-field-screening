/* Shared helpers for station modules: station header, part navigation,
   signature-based list re-rendering, two-step removal. */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc;
  var K = MF.stationKit = {};

  K.header = function (key, extra) {
    var st = MF.STATIONS.filter(function (s) { return s.key === key; })[0];
    return '<header class="st-head"><div class="st-head-t"><span class="st-no num">' + st.no + '</span>' +
      '<div><h2>' + st.ar + '</h2><p class="st-en">' + st.en + '</p></div></div>' + (extra || '') + '</header>';
  };

  /* parts = [{id, code, title, done:boolean}] */
  K.partNav = function (parts, current, label) {
    return '<nav class="parts" aria-label="' + esc(label || 'أقسام المحطة') + '"><ol>' + parts.map(function (p) {
      var cur = p.id === current;
      return '<li><button type="button" class="part' + (cur ? ' is-current' : '') + (p.done ? ' is-done' : '') + '" data-sa="part" data-part="' + p.id + '" title="' + esc(p.title) + '" aria-label="' + esc(p.code + ' — ' + p.title) + '"' + (cur ? ' aria-current="step"' : '') + '>' +
        '<span class="part-code">' + esc(p.code) + '</span><span class="part-t">' + esc(p.title) + '</span>' +
        (p.done ? '<span class="part-dot" aria-label="مكتمل الإدخال">' + MF.icon('check', 'ic-sm') + '</span>' : '') + '</button></li>';
    }).join('') + '</ol></nav>';
  };
  K.partFooter = function (parts, current, nextLabel) {
    var i = parts.findIndex(function (p) { return p.id === current; });
    var prev = parts[i - 1], next = parts[i + 1];
    return '<div class="part-foot">' +
      (prev ? '<button type="button" class="btn" data-sa="part" data-part="' + prev.id + '">' + MF.icon('back') + '<span>السابق: ' + esc(prev.title) + '</span></button>' : '<span></span>') +
      (next ? '<button type="button" class="btn btn-primary" data-sa="part" data-part="' + next.id + '"><span>' + esc(nextLabel || 'التالي') + ': ' + esc(next.title) + '</span>' + MF.icon('forward') + '</button>' : '') +
      '</div>';
  };
  K.updatePartNav = function (root, parts) {
    D.qsa('.part[data-part]', root).forEach(function (b) {
      var p = parts.filter(function (x) { return x.id === b.getAttribute('data-part'); })[0];
      if (!p) return;
      b.classList.toggle('is-done', !!p.done);
      var dot = b.querySelector('.part-dot');
      if (p.done && !dot) b.insertAdjacentHTML('beforeend', '<span class="part-dot" aria-label="مكتمل الإدخال">' + MF.icon('check', 'ic-sm') + '</span>');
      if (!p.done && dot) dot.remove();
    });
  };

  /* lists: {key: {sig(ctx) -> string, html(ctx) -> string}} — re-render a [data-list] only when its structure changed */
  K.syncLists = function (root, ctx, lists) {
    D.qsa('[data-list]', root).forEach(function (el) {
      var def = lists[el.getAttribute('data-list')];
      if (!def) return;
      var sig = def.sig(ctx);
      if (el._sig === sig) return;
      var hadFocus = el.contains(document.activeElement) ? document.activeElement.getAttribute('data-b') : null;
      el.innerHTML = def.html(ctx);
      el._sig = sig;
      if (hadFocus) { var f = el.querySelector('[data-b="' + hadFocus + '"]'); if (f && f.focus) f.focus({ preventScroll: true }); }
    });
  };

  /* two-step remove: first tap arms the button for 4 s, second tap removes */
  K.removeButton = function (store, id, label) {
    return '<button type="button" class="btn btn-quiet rm" data-sa="rm" data-store="' + esc(store) + '" data-id="' + esc(id) + '">' + MF.icon('trash', 'ic-sm') + '<span>' + esc(label || 'حذف') + '</span></button>';
  };
  K.handleRemove = function (btn, ctx, after) {
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      var t = btn.querySelector('span'), old = t.textContent;
      t.textContent = 'اضغط مرة أخرى للتأكيد';
      btn._t = setTimeout(function () { btn.classList.remove('is-armed'); t.textContent = old; }, 4000);
      return;
    }
    clearTimeout(btn._t);
    ctx.session.remove(btn.getAttribute('data-store'), btn.getAttribute('data-id')).then(function () {
      if (after) after();
    }, function () { MF.ui.toast('تعذّر الحذف. لم يتغيّر شيء.', { tone: 'danger' }); });
  };

  K.focusLater = function (root, selector) {
    setTimeout(function () {
      var el = root.querySelector(selector);
      if (el) { try { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'center', behavior: D.prefersReducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ } }
    }, 80);
  };

  /* flexible timing: year / age / short description */
  K.whenCtl = function (store, e, kindField, valueField, label, o) {
    o = o || {};
    var C = MF.controls;
    return C.q(label + (o.optional ? ' <span class="opt-l">(اختياري)</span>' : ''),
      '<div class="when">' + C.choice('i|' + store + '|' + e.id + '|' + kindField, MF.OPT.whenKind, { compact: true, cls: 'when-kind' }) +
      '<input class="input when-v" data-b="i|' + store + '|' + e.id + '|' + valueField + '" data-type="text" data-when-input="' + esc(kindField) + '" data-entry-id="' + esc(e.id) + '" data-store="' + esc(store) + '" autocomplete="off" aria-label="' + esc(label) + '"></div>', { cls: 'q-when' });
  };
  K.syncWhenInputs = function (root, session) {
    D.qsa('[data-when-input]', root).forEach(function (inp) {
      var e = session.find(inp.getAttribute('data-store'), inp.getAttribute('data-entry-id'));
      if (!e) return;
      var k = e[inp.getAttribute('data-when-input')] || 'year';
      var ph = k === 'year' ? 'مثال: 2024' : k === 'age' ? 'العمر بالسنوات، مثال: 9' : 'مثال: قبل سنتين، في الطفولة';
      if (inp.placeholder !== ph) inp.placeholder = ph;
      var im = k === 'text' ? 'text' : 'numeric';
      if (inp.getAttribute('inputmode') !== im) inp.setAttribute('inputmode', im);
    });
  };
})();
