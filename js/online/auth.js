/* =====================================================================
   AuthService — sign-in, the signed-in user's profile and role, forced
   password change, disabled accounts, session expiry, sign-out.

   States:
     signed_out    show the sign-in screen
     must_change   the account must set a new password before anything else
     ready         online, profile checked
     offline       no connection; working from this device's cache with the
                   profile last confirmed by the server (at most 7 days old)
     disabled / no_profile   refused: message, then signed out
   Passwords are sent only to Supabase Auth or the change-password function;
   they are never stored or logged.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;
  var PROFILE_KEY = 'mfs.profile';
  var OFFLINE_DAYS = 7;
  var listeners = [];

  function readStoredSession() {
    try { var s = JSON.parse(localStorage.getItem(MF.AUTH_STORAGE_KEY) || 'null'); return s && s.user && s.user.id ? s : null; } catch (e) { return null; }
  }
  function readProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { return null; } }
  function saveProfile(p) {
    try {
      if (!p) localStorage.removeItem(PROFILE_KEY);
      else localStorage.setItem(PROFILE_KEY, JSON.stringify({ id: p.id, email: p.email, full_name: p.full_name, role: p.role, active: p.active, must_change_password: p.must_change_password, validated_at: new Date().toISOString() }));
    } catch (e) { /* storage may be blocked */ }
  }

  var A = MF.auth = {
    state: 'init',
    user: null,
    profile: null,
    message: null,
    signingOut: false,

    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    _set: function (st, msg) {
      var changed = st !== A.state;
      A.state = st;
      if (msg !== undefined) A.message = msg;
      MF.debug('auth state', st);
      if (changed) listeners.slice().forEach(function (fn) { try { fn(st); } catch (e) { MF.log(e); } });
    },
    isAdmin: function () { return !!A.profile && A.profile.role === 'admin' && (A.state === 'ready' || A.state === 'offline'); },
    canWork: function () { return A.state === 'ready' || A.state === 'offline'; },
    canSync: function () { return A.state === 'ready'; },

    /* boot: restore the stored session, then confirm the profile with the server */
    init: function () {
      var sb = MF.sb;
      sb.auth.onAuthStateChange(function (event, session) {
        MF.debug('auth event', event);
        if (event === 'SIGNED_OUT' && !A.signingOut && A.state !== 'signed_out') {
          /* the session ended elsewhere (expired, revoked or account disabled) — local changes stay on this device */
          A.user = null;
          A._set('signed_out', MF.err.MSG.SESSION_EXPIRED);
        } else if (event === 'TOKEN_REFRESHED' && session && A.state === 'offline' && MF.net.online) {
          A.validate();
        }
      });
      return sb.auth.getSession().then(function (res) {
        var session = res && res.data && res.data.session;
        if (session && session.user) { A.user = session.user; return A.validate(); }
        var stored = readStoredSession();
        if (stored && (res.error || !MF.net.online)) { A.user = stored.user; return A.validate(); }
        A._set('signed_out');
        return A.state;
      }, function () {
        var stored = readStoredSession();
        if (stored) { A.user = stored.user; return A.validate(); }
        A._set('signed_out');
        return A.state;
      });
    },

    /* read the profile from the server; fall back to the cached one only when offline */
    validate: function () {
      if (!A.user) { A._set('signed_out'); return Promise.resolve(A.state); }
      var uid = A.user.id;
      return MF.remote.profile(uid).then(function (p) {
        if (!p) return A._refuse('no_profile', MF.err.MSG.NO_PROFILE, false);
        if (!p.active) return A._refuse('disabled', MF.err.MSG.ACCOUNT_DISABLED, true);
        A.profile = p;
        saveProfile(p);
        return MF.cache.open(uid).then(function () {
          if (p.must_change_password) { A._set('must_change', null); return A.state; }
          A._set('ready', null);
          MF.remote.touchAccess().catch(function () { /* not essential */ });
          MF.sync.refresh();
          MF.sync.kick();
          return A.state;
        });
      }, function (err) {
        if (err.network) {
          var cp = readProfile();
          var fresh = cp && cp.id === uid && cp.validated_at && (Date.now() - Date.parse(cp.validated_at)) < OFFLINE_DAYS * 86400000;
          if (fresh && cp.active && !cp.must_change_password) {
            A.profile = cp;
            return MF.cache.open(uid).then(function () { A._set('offline', null); MF.sync.refresh(); return A.state; });
          }
          A._set('signed_out', 'لا يوجد اتصال بالإنترنت، ولا يمكن التحقق من الحساب على هذا الجهاز. اتصل بالإنترنت ثم سجّل الدخول.');
          return A.state;
        }
        if (err.auth) { A._set('signed_out', MF.err.MSG.SESSION_EXPIRED); return A.state; }
        A._set('signed_out', err.message);
        return A.state;
      });
    },

    /* refused accounts are signed out; a disabled account's cached research data is removed */
    _refuse: function (st, msg, purge) {
      var uid = A.user && A.user.id;
      A.profile = null;
      saveProfile(null);
      A.signingOut = true;
      var done = MF.sb.auth.signOut({ scope: 'local' }).catch(function () {}).then(function () {
        A.signingOut = false;
        A.user = null;
        return purge && uid ? MF.cache.destroy(uid).catch(function () {}) : null;
      });
      return done.then(function () { A._set(st, msg); return st; });
    },

    signIn: function (email, password) {
      return MF.sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') }).then(function (res) {
        if (res.error) throw MF.err.wrap(res.error);
        A.user = res.data.user;
        MF.net.set(true);
        return A.validate();
      }, function (e) { var w = MF.err.wrap(e); MF.net.report(w); throw w; });
    },

    /* keepLocal: leave unsynchronised changes (and this user's cache) on the device */
    signOut: function (opts) {
      opts = opts || {};
      var uid = A.user && A.user.id;
      A.signingOut = true;
      MF.live && MF.live.stopAll();
      return MF.sb.auth.signOut({ scope: 'local' }).catch(function () { /* offline: the local session is still cleared */ }).then(function () {
        A.signingOut = false;
        saveProfile(null);
        A.user = null; A.profile = null;
        if (!opts.keepLocal && uid) return MF.cache.destroy(uid).catch(function () {});
        MF.cache.close();
      }).then(function () {
        MF.sync.reset();
        A._set('signed_out', opts.message || null);
      });
    },

    changePassword: function (current, next) {
      return MF.remote.invoke('change-password', { current_password: current, new_password: next }).then(function (res) {
        if (res && res.user) { A.profile = res.user; saveProfile(res.user); }
        return A.validate();
      });
    },

    /* re-check the account now and then (role changes, disabling, password resets) */
    recheck: function () {
      if (!A.user || !MF.net.online || A.state === 'signed_out') return Promise.resolve(A.state);
      var before = A.profile ? A.profile.role + '|' + A.profile.must_change_password : '';
      return A.validate().then(function (st) {
        var after = A.profile ? A.profile.role + '|' + A.profile.must_change_password : '';
        if (before && after && before !== after) listeners.slice().forEach(function (fn) { try { fn(st, 'profile'); } catch (e) { MF.log(e); } });
        return st;
      });
    }
  };

  setInterval(function () { if (A.state === 'ready' || A.state === 'offline') A.recheck(); }, 5 * 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (A.state === 'ready' || A.state === 'offline')) A.recheck(); });
  MF.net.on(function (online) { if (online && A.state === 'offline') A.validate(); });
})();
