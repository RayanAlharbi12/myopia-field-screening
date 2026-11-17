/* =====================================================================
   The Supabase client (official supabase-js, bundled at build time as
   vendor/supabase.js) and the connectivity monitor.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  MF.AUTH_STORAGE_KEY = 'mfs.auth';

  MF.createSupabase = function (cfg) {
    var lib = window.supabase;
    if (!lib || typeof lib.createClient !== 'function') throw new Error('supabase-js is missing from this build (vendor/supabase.js).');
    return lib.createClient(cfg.url, cfg.key, {
      auth: {
        persistSession: true,           /* session tokens only — never the password */
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: MF.AUTH_STORAGE_KEY
      },
      realtime: { params: { eventsPerSecond: 10 } },
      global: { headers: { 'x-client-info': 'myopia-field-screening/' + MF.VERSION } }
    });
  };

  /* ---------- connectivity: browser signal + a light reachability check ---------- */
  var listeners = [];
  var net = MF.net = {
    online: navigator.onLine !== false,
    checkedAt: null,
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    set: function (v) {
      v = !!v;
      net.checkedAt = Date.now();
      if (v === net.online) return;
      net.online = v;
      MF.debug('connectivity', v ? 'online' : 'offline');
      listeners.slice().forEach(function (fn) { try { fn(v); } catch (e) { MF.log(e); } });
    },
    check: function () {
      if (navigator.onLine === false) { net.set(false); return Promise.resolve(false); }
      var cfg = MF.env.config;
      if (!cfg.ok) return Promise.resolve(net.online);
      var ctl = window.AbortController ? new AbortController() : null;
      var t = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
      return fetch(cfg.url + '/auth/v1/health', { headers: { apikey: cfg.key }, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
        .then(function (r) { clearTimeout(t); net.set(r.status < 500); return net.online; },
          function () { clearTimeout(t); net.set(false); return false; });
    },
    /* repositories call this when a request fails, so the indicator reacts at once */
    report: function (appErr) { if (appErr && appErr.network) net.set(false); }
  };
  window.addEventListener('online', function () { net.check(); });
  window.addEventListener('offline', function () { net.set(false); });
  setInterval(function () { if (!net.online || Date.now() - (net.checkedAt || 0) > 60000) net.check(); }, 20000);
})();
