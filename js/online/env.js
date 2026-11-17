/* =====================================================================
   Deployment configuration, environment name, and debug logging.

   config.js (served next to index.html) holds exactly two values:
     SUPABASE_URL              https://<project>.supabase.co
     SUPABASE_PUBLISHABLE_KEY  the browser-safe publishable key (sb_publishable_…)
                               or the legacy "anon" key
   A secret / service_role key is refused here, before anything runs.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  function b64urlJson(part) {
    try {
      var s = part.replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return JSON.parse(decodeURIComponent(escape(atob(s))));
    } catch (e) { return null; }
  }

  /* returns { ok, url, key, problem } — problem is an Arabic sentence for the setup screen */
  function readConfig() {
    var c = window.MFS_CONFIG || {};
    var url = String(c.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    var key = String(c.SUPABASE_PUBLISHABLE_KEY || '').trim();
    var out = { ok: false, url: url, key: key, problem: null, secretKey: false };
    if (!url || !key) { out.problem = 'لم تُضبط إعدادات الاتصال بقاعدة البيانات بعد (config.js).'; return out; }
    var local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(url) && !local) { out.problem = 'عنوان Supabase في config.js غير صالح. يجب أن يبدأ بـ https://'; return out; }
    if (/^sb_secret_/i.test(key)) { out.secretKey = true; out.problem = 'config.js يحتوي على مفتاح سري (secret). هذا المفتاح لا يوضع في المتصفح أبدًا. ضع المفتاح العام (publishable) بدلًا منه، وألغِ المفتاح السري من لوحة Supabase.'; return out; }
    var parts = key.split('.');
    if (parts.length === 3) {
      var payload = b64urlJson(parts[1]);
      if (payload && payload.role === 'service_role') { out.secretKey = true; out.problem = 'config.js يحتوي على مفتاح service_role. هذا المفتاح لا يوضع في المتصفح أبدًا. ضع المفتاح العام (anon / publishable) بدلًا منه، ثم غيّر المفتاح السري من لوحة Supabase.'; return out; }
      if (!payload || payload.role !== 'anon') { out.problem = 'المفتاح في config.js غير معروف. استخدم المفتاح العام (publishable).'; return out; }
    } else if (!/^sb_publishable_/i.test(key)) { out.problem = 'المفتاح في config.js غير معروف. استخدم المفتاح العام (publishable).'; return out; }
    out.ok = true;
    return out;
  }

  function environment() {
    var h = location.hostname || '';
    if (location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1') return { key: 'development', ar: 'تطوير (محلي)' };
    if (/^deploy-preview-\d+--/.test(h) || /--/.test(h) && /netlify\.app$/.test(h)) return { key: 'preview', ar: 'معاينة' };
    return { key: 'production', ar: 'الإنتاج' };
  }

  /* debug logging: add ?debug=1 to the address once (remembered on this device), ?debug=0 to stop */
  var debug = false;
  try {
    var m = /[?&]debug=([01])/.exec(location.search);
    if (m) localStorage.setItem('mfs.debug', m[1]);
    debug = localStorage.getItem('mfs.debug') === '1';
  } catch (e) { /* storage may be blocked */ }

  var REDACT = /(password|token|secret|apikey|authorization|access_token|refresh_token)/i;
  function redact(v, depth) {
    if (depth > 3 || v == null || typeof v !== 'object') return v;
    if (v instanceof Error) return { name: v.name, message: v.message, code: v.code };
    var o = Array.isArray(v) ? [] : {};
    Object.keys(v).forEach(function (k) { o[k] = REDACT.test(k) ? '[redacted]' : redact(v[k], (depth || 0) + 1); });
    return o;
  }

  MF.env = {
    config: readConfig(),
    environment: environment(),
    debug: debug,
    readConfig: readConfig
  };
  MF.debug = function () {
    if (!debug || !window.console) return;
    console.log.apply(console, ['[MFS]'].concat([].slice.call(arguments).map(function (a) { return redact(a, 0); })));
  };
  /* warnings never include passwords or tokens */
  MF.log = function () {
    if (window.console && console.warn) console.warn.apply(console, ['[MFS]'].concat([].slice.call(arguments).map(function (a) { return redact(a, 0); })));
  };
})();
