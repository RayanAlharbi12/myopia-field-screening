/* =====================================================================
   App shell: boot, sign-in gate, theme, hash router, unsaved-data safety,
   global error handling and application updates.
   Routes (after sign-in):
     #/                              schools home
     #/school/<schoolId>             school workspace
     #/p/<participantId>/<station>[/<part>]   participant working form
     #/admin[/<tab>]                 administration (Administrator only)
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom;
  MF.screens = MF.screens || {};
  MF.stations = MF.stations || {};

  var app = { current: null, el: null };
  MF.app = app;

  /* ---------- theme (persisted locally; "auto" follows the device) ---------- */
  MF.theme = {
    get: function () { var t = D.prefGet(MF.PREF_THEME); return t === 'light' || t === 'dark' ? t : 'auto'; },
    effective: function () {
      var t = MF.theme.get();
      if (t !== 'auto') return t;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    set: function (t) {
      if (t === 'auto') { D.prefSet(MF.PREF_THEME, null); document.documentElement.removeAttribute('data-theme'); }
      else { D.prefSet(MF.PREF_THEME, t); document.documentElement.setAttribute('data-theme', t); }
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', MF.theme.effective() === 'dark' ? '#0F1412' : '#EFF2EF');
      D.qsa('[data-theme-icon]').forEach(function (b) { b.innerHTML = MF.icon(MF.theme.effective() === 'dark' ? 'sun' : 'moon'); });
    },
    toggle: function () { MF.theme.set(MF.theme.effective() === 'dark' ? 'light' : 'dark'); },
    apply: function () { MF.theme.set(MF.theme.get()); }
  };
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onMq = function () { if (MF.theme.get() === 'auto') MF.theme.apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  }

  /* ---------- router ---------- */
  function parse(hash) {
    var h = String(hash || '').replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'school' && parts[1]) return { screen: 'school', schoolId: parts[1] };
    if (parts[0] === 'p' && parts[1]) return { screen: 'participant', pid: parts[1], station: parts[2] || null, part: parts[3] || null };
    if (parts[0] === 'admin') return { screen: 'admin', tab: parts[1] || 'users' };
    return { screen: 'home' };
  }
  MF.go = function (path, replace) {
    var h = '#/' + path.replace(/^#?\/?/, '');
    if (replace) { history.replaceState(null, '', h); route(); }
    else if (location.hash === h) route();
    else location.hash = h;
  };
  MF.routeFor = {
    home: function () { return ''; },
    school: function (id) { return 'school/' + encodeURIComponent(id); },
    participant: function (pid, station, part) { return 'p/' + encodeURIComponent(pid) + '/' + (station || 'registration') + (part ? '/' + encodeURIComponent(part) : ''); },
    admin: function (tab) { return 'admin' + (tab ? '/' + tab : ''); }
  };

  /* which screen the account may see right now */
  function gate(r) {
    var st = MF.auth.state;
    if (!MF.env.config.ok) return { screen: 'setup' };
    if (st === 'must_change') return { screen: 'mustChange' };
    if (st !== 'ready' && st !== 'offline') return { screen: 'login' };
    if (r.screen === 'admin' && !MF.auth.isAdmin()) return { screen: 'home' };
    return r;
  }

  var routing = Promise.resolve();
  function route() {
    routing = routing.then(function () {
      var r = gate(parse(location.hash));
      var cur = app.current;
      /* same participant: let the screen switch station without reloading */
      if (cur && cur.route.screen === 'participant' && r.screen === 'participant' && cur.route.pid === r.pid && cur.instance.update) {
        cur.route = r;
        return cur.instance.update(r);
      }
      var leave = cur && cur.instance.beforeLeave ? cur.instance.beforeLeave() : Promise.resolve();
      return Promise.resolve(leave).then(function () {
        if (cur && cur.instance.unmount) cur.instance.unmount();
        MF.Picker.prune();
        var scr = MF.screens[r.screen] || MF.screens.home;
        app.el.innerHTML = '';
        window.scrollTo(0, 0);
        app.current = { route: r, instance: scr.mount(app.el, r) || {} };
        if (r.screen !== 'login' && r.screen !== 'mustChange' && r.screen !== 'setup') D.prefSet(MF.PREF_LAST_ROUTE, location.hash);
        return app.current.instance.ready;
      });
    }).catch(function (err) { MF.log('route error', err); MF.ui.toast('حدث خطأ أثناء فتح الصفحة.', { tone: 'danger' }); });
    return routing;
  }
  MF.reroute = route;

  /* ---------- unsaved-data safety ---------- */
  function flushCurrent() {
    var c = app.current;
    if (c && c.instance.flush) return c.instance.flush();
    return Promise.resolve();
  }
  MF.flushCurrent = flushCurrent;
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushCurrent(); });
  window.addEventListener('pagehide', function () { flushCurrent(); });
  window.addEventListener('beforeunload', function (e) {
    var c = app.current;
    if (c && c.instance.hasUnsaved && c.instance.hasUnsaved()) {
      flushCurrent();
      e.preventDefault(); e.returnValue = '';
    }
  });

  /* keep the active field visible when the on-screen keyboard opens */
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || !t.matches || !t.matches('input:not([type="checkbox"]):not([type="radio"]), textarea')) return;
    setTimeout(function () {
      var vv = window.visualViewport;
      var vh = vv ? vv.height : window.innerHeight;
      var r = t.getBoundingClientRect();
      var top = vv ? vv.offsetTop : 0;
      if (r.bottom > top + vh - 16 || r.top < top + 120) {
        try { t.scrollIntoView({ block: 'center', behavior: D.prefersReducedMotion() ? 'auto' : 'smooth' }); } catch (err) { t.scrollIntoView(); }
      }
    }, 320);
  });

  /* ---------- global error handling (no data is ever discarded here) ---------- */
  var lastErrToast = 0;
  function unexpected(err) {
    MF.log('unexpected', err);
    if (Date.now() - lastErrToast < 8000) return;
    lastErrToast = Date.now();
    try { MF.ui.toast('حدث خطأ غير متوقع. التعديلات المحفوظة لم تتأثر.', { tone: 'danger', timeout: 5000 }); } catch (e) { /* ignore */ }
  }
  window.addEventListener('error', function (e) { if (e && e.error) unexpected(e.error); });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    if (r && r.name === 'AppError') { MF.debug('unhandled AppError', r.code); return; }
    unexpected(r);
  });

  /* ---------- application updates (service worker) ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || window.MF_NO_SW) return;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      reloading = true;
      MF.flushCurrent().then(function () { location.reload(); });
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function offer(w) {
        MF.ui.toast('يتوفر إصدار جديد من التطبيق.', {
          timeout: 600000,
          action: { label: 'تحديث الآن', fn: function () { MF.flushCurrent().then(function () { w.postMessage({ type: 'SKIP_WAITING' }); }); } }
        });
      }
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
      setInterval(function () { reg.update().catch(function () {}); }, 30 * 60000);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') reg.update().catch(function () {}); });
    }, function (e) { MF.log('service worker', e); });
  }

  /* ---------- boot ---------- */
  MF.boot = function () {
    app.el = document.getElementById('app');
    MF.theme.apply();
    window.addEventListener('hashchange', route);
    if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/');
    registerSW();
    if (!MF.env.config.ok) { route(); return; }
    if (!window.indexedDB) { app.el.innerHTML = '<main class="page fatal"><div class="empty"><h1>المتصفح لا يدعم التخزين المحلي</h1><p>يحتاج التطبيق إلى قاعدة بيانات المتصفح (IndexedDB) للعمل دون اتصال. قد تكون معطّلة في وضع التصفح الخاص.</p></div></main>'; return; }
    try { MF.sb = MF.createSupabase(MF.env.config); } catch (e) { MF.log(e); route(); return; }
    app.el.innerHTML = '<div class="loading" aria-busy="true"></div>';
    var lastState = null;
    MF.auth.on(function (st, why) {
      if (why === 'profile') { MF.ui.toast('تغيّرت صلاحيات حسابك.'); route(); return; }
      if (st === lastState) return;
      lastState = st;
      if ((st === 'ready' || st === 'offline') && app.current && (app.current.route.screen === 'login' || app.current.route.screen === 'mustChange')) {
        var last = D.prefGet(MF.PREF_LAST_ROUTE);
        if (last && /^#\/(school|p|admin)\//.test(last) && location.hash !== last) { location.hash = last; return; }
      }
      route();
    });
    MF.sync.on('auth', function () { MF.auth.recheck(); });
    MF.net.check().then(function () { return MF.auth.init(); }).then(function (st) { lastState = st; route(); }, function (e) { MF.log(e); route(); });
  };
})();
