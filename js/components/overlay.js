/* Dialogs, bottom sheets, menus and toasts (no native alert/confirm). */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc;
  var ui = MF.ui = MF.ui || {};
  var stack = [];

  function host() {
    var h = document.getElementById('overlay-root');
    if (!h) { h = document.createElement('div'); h.id = 'overlay-root'; document.body.appendChild(h); }
    return h;
  }
  function lockScroll(on) { document.documentElement.classList.toggle('no-scroll', on); }
  function focusables(el) {
    return D.qsa('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])', el)
      .filter(function (x) { return x.offsetParent !== null || x === document.activeElement; });
  }

  /* dialog({title, body, actions:[{label, value, kind, disabled, id}], dismissible, sheet, wide, onMount(el, api)}) -> Promise<value> */
  ui.dialog = function (o) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var id = 'dlg-' + Math.random().toString(36).slice(2);
      var actions = (o.actions || []).map(function (a, i) {
        return '<button type="button" class="btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : a.kind === 'quiet' ? 'btn-quiet' : '') + '" data-dlg-v="' + i + '"' + (a.id ? ' id="' + esc(a.id) + '"' : '') + (a.disabled ? ' disabled' : '') + '>' + esc(a.label) + '</button>';
      }).join('');
      var wrap = D.el(
        '<div class="ov' + (o.sheet ? ' ov-sheet' : '') + '" role="presentation">' +
        '<div class="ov-scrim" data-dlg-scrim></div>' +
        '<div class="ov-panel' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + id + '-t">' +
          '<div class="ov-head"><h2 class="ov-title" id="' + id + '-t">' + esc(o.title || '') + '</h2>' +
          (o.dismissible === false ? '' : '<button type="button" class="icon-btn ov-x" data-dlg-close aria-label="إغلاق">' + MF.icon('x') + '</button>') + '</div>' +
          '<div class="ov-body">' + (o.body || '') + '</div>' +
          (actions ? '<div class="ov-actions">' + actions + '</div>' : '') +
        '</div></div>');
      host().appendChild(wrap);
      stack.push(wrap);
      lockScroll(true);
      requestAnimationFrame(function () { wrap.classList.add('in'); });
      var done = false, openedAt = Date.now();
      function close(v) {
        if (done) return;
        done = true;
        wrap.classList.remove('in');
        wrap.classList.add('out');
        stack.splice(stack.indexOf(wrap), 1);
        setTimeout(function () { wrap.remove(); if (!stack.length) lockScroll(false); }, 160);
        document.removeEventListener('keydown', onKey, true);
        if (o.onClose) { try { o.onClose(v); } catch (e) { MF.log(e); } }
        try { if (prevFocus && prevFocus.focus && document.body.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        resolve(v);
      }
      function onKey(e) {
        if (stack[stack.length - 1] !== wrap) return;
        if (e.key === 'Escape' && o.dismissible !== false) { e.preventDefault(); close(undefined); }
        if (e.key === 'Tab') {
          var f = focusables(wrap.querySelector('.ov-panel'));
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', function (e) {
        var b = e.target.closest('[data-dlg-v]');
        if (b && !b.disabled) {
          var a = o.actions[+b.getAttribute('data-dlg-v')];
          if (a.onClick) { var r = a.onClick(api); if (r === false) return; }
          close(a.value);
          return;
        }
        if (e.target.closest('[data-dlg-close]')) close(undefined);
        else if (e.target.hasAttribute('data-dlg-scrim') && o.dismissible !== false && !o.modal && Date.now() - openedAt > 400) close(undefined);
      });
      var api = {
        el: wrap.querySelector('.ov-panel'), close: close,
        action: function (i) { return wrap.querySelectorAll('[data-dlg-v]')[i]; }
      };
      if (o.onMount) o.onMount(api.el, api);
      setTimeout(function () {
        if (done) return;
        if (api.el.contains(document.activeElement) && document.activeElement !== api.el) return;   /* the user is already in a field */
        var target = api.el.querySelector('[autofocus]') || (o.focusFirst === false ? null : focusables(api.el).filter(function (x) { return !x.classList.contains('ov-x'); })[0]);
        try { (target || api.el.querySelector('.ov-x') || api.el).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }, 30);
    });
  };

  ui.confirm = function (o) {
    return ui.dialog({
      title: o.title, wide: o.wide,
      body: (o.message ? '<p class="dlg-text">' + o.message + '</p>' : '') + (o.extra || ''),
      actions: [
        { label: o.cancelLabel || 'إلغاء', value: false },
        { label: o.confirmLabel || 'تأكيد', value: true, kind: o.danger ? 'danger' : 'primary' }
      ]
    }).then(function (v) { return v === true; });
  };

  ui.alert = function (o) {
    return ui.dialog({ title: o.title, body: '<p class="dlg-text">' + o.message + '</p>', actions: [{ label: o.okLabel || 'حسنًا', value: true, kind: 'primary' }] });
  };

  /* popover menu anchored to a button. items: [{label, icon, value, danger, disabled, divider}] */
  ui.menu = function (anchor, items) {
    return new Promise(function (resolve) {
      var m = D.el('<div class="menu" role="menu">' + items.map(function (it, i) {
        if (it.divider) return '<div class="menu-div" role="separator"></div>';
        return '<button type="button" role="menuitem" class="menu-item' + (it.danger ? ' danger' : '') + '" data-mi="' + i + '"' + (it.disabled ? ' disabled' : '') + '>' +
          (it.icon ? MF.icon(it.icon) : '<span class="ic"></span>') + '<span>' + esc(it.label) + '</span>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</button>';
      }).join('') + '</div>');
      var scrim = D.el('<div class="menu-scrim"></div>');
      host().appendChild(scrim); host().appendChild(m);
      var r = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      var w = Math.min(300, vw - 24);
      m.style.width = w + 'px';
      var left = r.left + r.width - w;          /* RTL: align the menu's right edge with the button */
      left = Math.max(12, Math.min(left, vw - w - 12));
      m.style.left = left + 'px';
      var top = r.bottom + 6;
      m.style.top = top + 'px';
      requestAnimationFrame(function () {
        var mh = m.offsetHeight, vh = window.innerHeight;
        if (top + mh > vh - 12) m.style.top = Math.max(12, r.top - mh - 6) + 'px';
        m.classList.add('in');
        var f = m.querySelector('.menu-item:not([disabled])'); if (f) f.focus({ preventScroll: true });
      });
      function close(v) {
        m.remove(); scrim.remove();
        document.removeEventListener('keydown', key, true);
        try { anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        resolve(v);
      }
      function key(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(undefined); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          var list = D.qsa('.menu-item:not([disabled])', m), i = list.indexOf(document.activeElement);
          e.preventDefault();
          (list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length] || list[0]).focus();
        }
      }
      document.addEventListener('keydown', key, true);
      scrim.addEventListener('click', function () { close(undefined); });
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-mi]');
        if (b && !b.disabled) close(items[+b.getAttribute('data-mi')].value);
      });
    });
  };

  /* toast(message, {action:{label, fn}, timeout, tone}) */
  var toastT = null;
  ui.toast = function (message, o) {
    o = o || {};
    var h = document.getElementById('toast-root');
    if (!h) { h = document.createElement('div'); h.id = 'toast-root'; h.setAttribute('aria-live', 'polite'); document.body.appendChild(h); }
    h.innerHTML = '';
    var t = D.el('<div class="toast' + (o.tone ? ' toast-' + o.tone : '') + '" role="status"><span>' + esc(message) + '</span>' +
      (o.action ? '<button type="button" class="toast-act">' + esc(o.action.label) + '</button>' : '') + '</div>');
    h.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });
    if (o.action) t.querySelector('.toast-act').addEventListener('click', function () { o.action.fn(); hide(); });
    function hide() { t.classList.remove('in'); setTimeout(function () { t.remove(); }, 200); }
    clearTimeout(toastT);
    toastT = setTimeout(hide, o.timeout || (o.action ? 6000 : 2600));
    return hide;
  };
})();
