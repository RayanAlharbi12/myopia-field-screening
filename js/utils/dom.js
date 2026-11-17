/* DOM helpers, escaping and bidi isolation. */
(function () {
  'use strict';
  var MF = window.MF;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Clinical values, IDs, eyes and units are always shown left-to-right and
     isolated from the surrounding Arabic, so 1-17 never reads as 17-1. */
  function ltr(v, cls) {
    return '<bdi dir="ltr" class="ltr' + (cls ? ' ' + cls : '') + '">' + esc(v) + '</bdi>';
  }

  /* plain-text equivalent of ltr(): LEFT-TO-RIGHT ISOLATE ... POP DIRECTIONAL ISOLATE */
  function iso(v) { return '\u2066' + String(v == null ? '' : v) + '\u2069'; }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function frag(html) {
    var t = document.createElement('template');
    t.innerHTML = html;
    return t.content;
  }
  function el(html) { return frag(html.trim()).firstElementChild; }

  /* delegated listener; returns an unsubscribe function */
  function on(root, type, selector, fn, opts) {
    function h(e) {
      var t = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (t && root.contains(t)) fn.call(t, e, t);
    }
    root.addEventListener(type, h, opts || false);
    return function () { root.removeEventListener(type, h, opts || false); };
  }

  function attr(name, v) { return v == null || v === false ? '' : ' ' + name + '="' + esc(v === true ? name : v) + '"'; }

  function debounce(fn, ms) {
    var t = null, args = null, self = null;
    function run() { t = null; var a = args; args = null; fn.apply(self, a); }
    function d() { self = this; args = arguments; if (t) clearTimeout(t); t = setTimeout(run, ms); }
    d.flush = function () { if (t) { clearTimeout(t); run(); } };
    d.cancel = function () { if (t) clearTimeout(t); t = null; };
    d.pending = function () { return !!t; };
    return d;
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  function nowIso() { return new Date().toISOString(); }

  /* Arabic-Indic and Persian digits, Arabic decimal/thousand separators, minus variants -> ASCII */
  function normalizeDigits(s) {
    return String(s == null ? '' : s)
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/[٫،,]/g, '.')
      .replace(/[−‒–—﹣－]/g, '-')
      .replace(/＋/g, '+')
      .replace(/\s+/g, '');
  }

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  function stamp(d) {
    d = d || new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function prefGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function prefSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* preferences are optional */ } }

  MF.dom = {
    esc: esc, ltr: ltr, iso: iso, qs: qs, qsa: qsa, frag: frag, el: el, on: on, attr: attr,
    debounce: debounce, uid: uid, nowIso: nowIso, normalizeDigits: normalizeDigits,
    downloadBlob: downloadBlob, stamp: stamp, prefersReducedMotion: prefersReducedMotion,
    prefGet: prefGet, prefSet: prefSet
  };
})();
