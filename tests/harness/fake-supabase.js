/* =====================================================================
   TEST-ONLY stand-in for the supabase-js browser build, used by the
   automated browser tests together with tests/harness/server.ts.
   It implements only the parts of the supabase-js v2 API this
   application calls, with the same shapes ({ data, error, count },
   onAuthStateChange events, functions.invoke errors, channels).
   The real application ships the official @supabase/supabase-js.
   ===================================================================== */
(function () {
  'use strict';

  function netError(e) { return { message: 'TypeError: Failed to fetch', details: String(e && e.message || e), hint: '', code: '' }; }

  function Client(url, key, opts) {
    this.url = url.replace(/\/+$/, '');
    this.key = key;
    this.opts = opts || {};
    this.auth = new Auth(this, (this.opts.auth && this.opts.auth.storageKey) || 'sb-auth-token');
    var self = this;
    this.functions = {
      invoke: function (name, o) {
        return self._fetch('/functions/v1/' + name, (o && o.body) || {}, true).then(function (res) {
          if (res.status >= 200 && res.status < 300) return res.json().then(function (d) { return { data: d, error: null }; });
          var e = new Error('Edge Function returned a non-2xx status code');
          e.name = 'FunctionsHttpError'; e.context = res;
          return { data: null, error: e };
        }, function (err) {
          var e = new Error('Failed to send a request to the Edge Function');
          e.name = 'FunctionsFetchError'; e.context = err;
          return { data: null, error: e };
        });
      }
    };
    this._channels = [];
  }
  Client.prototype._headers = function () {
    var t = this.auth._token();
    return { 'content-type': 'application/json', apikey: this.key, authorization: 'Bearer ' + (t || this.key) };
  };
  Client.prototype._fetch = function (path, body, raw) {
    var self = this;
    var go = function () { return fetch(self.url + path, { method: 'POST', headers: self._headers(), body: JSON.stringify(body) }); };
    return go().then(function (res) {
      if (raw) return res;
      return res.json();
    });
  };
  Client.prototype._call = function (path, body) {
    var self = this;
    return this._fetch(path, body).then(function (r) { return r; }, function (e) { return { data: null, error: netError(e), count: null }; });
  };
  Client.prototype.from = function (t) { return new Builder(this, t); };
  Client.prototype.rpc = function (name, args) {
    var self = this;
    return { then: function (res, rej) {
      return self._call('/test/rpc', { name: name, args: args || {} }).then(function (r) {
        if (r && r.error && r.error.code === 'PGRST301') return self.auth._expired().then(function () { return r; });
        return r;
      }).then(res, rej);
    } };
  };
  Client.prototype.channel = function (name) { var c = new Channel(this, name); this._channels.push(c); return c; };
  Client.prototype.removeChannel = function (c) { c._close(); this._channels = this._channels.filter(function (x) { return x !== c; }); return Promise.resolve('ok'); };

  /* ---------- query builder ---------- */
  function Builder(client, table) {
    this.c = client;
    this.q = { table: table, op: 'select', filters: [], ors: [], order: [], range: null, single: null, columns: '*' };
  }
  Builder.prototype.select = function (cols, o) {
    if (this.q.op === 'select') { this.q.columns = cols || '*'; this.q.count = o && o.count || null; this.q.head = !!(o && o.head); }
    else this.q.returning = true;
    return this;
  };
  Builder.prototype.insert = function (v) { this.q.op = 'insert'; this.q.values = v; return this; };
  Builder.prototype.update = function (v) { this.q.op = 'update'; this.q.values = v; return this; };
  ['eq', 'neq', 'gte', 'lte', 'like', 'ilike', 'is'].forEach(function (op) {
    Builder.prototype[op] = function (col, val) { this.q.filters.push({ col: col, op: op, val: val }); return this; };
  });
  Builder.prototype['in'] = function (col, vals) { this.q.filters.push({ col: col, op: 'in', val: vals }); return this; };
  Builder.prototype.or = function (expr) { this.q.ors.push(expr); return this; };
  Builder.prototype.order = function (col, o) { this.q.order.push({ col: col, asc: !o || o.ascending !== false }); return this; };
  Builder.prototype.range = function (a, b) { this.q.range = [a, b]; return this; };
  Builder.prototype.limit = function (n) { this.q.range = [0, n - 1]; return this; };
  Builder.prototype.single = function () { this.q.single = 'single'; return this; };
  Builder.prototype.maybeSingle = function () { this.q.single = 'maybe'; return this; };
  Builder.prototype.then = function (res, rej) {
    var self = this;
    return this.c._call('/test/rest', this.q).then(function (r) {
      if (r && r.error && r.error.code === 'PGRST301') return self.c.auth._expired().then(function () { return r; });
      return { data: r.data === undefined ? null : r.data, error: r.error || null, count: r.count == null ? null : r.count };
    }).then(res, rej);
  };

  /* ---------- auth ---------- */
  function Auth(client, key) { this.c = client; this.key = key; this.cbs = []; }
  Auth.prototype._read = function () { try { return JSON.parse(localStorage.getItem(this.key) || 'null'); } catch (e) { return null; } };
  Auth.prototype._write = function (s) { try { if (s) localStorage.setItem(this.key, JSON.stringify(s)); else localStorage.removeItem(this.key); } catch (e) { /* ignore */ } };
  Auth.prototype._token = function () { var s = this._read(); return s && s.access_token; };
  Auth.prototype._emit = function (ev, s) { this.cbs.slice().forEach(function (cb) { try { cb(ev, s); } catch (e) { console.warn(e); } }); };
  Auth.prototype.onAuthStateChange = function (cb) {
    var self = this;
    this.cbs.push(cb);
    var s = this._read();
    setTimeout(function () { cb('INITIAL_SESSION', s); }, 0);
    return { data: { subscription: { unsubscribe: function () { self.cbs = self.cbs.filter(function (x) { return x !== cb; }); } } } };
  };
  Auth.prototype.getSession = function () { return Promise.resolve({ data: { session: this._read() }, error: null }); };
  Auth.prototype.signInWithPassword = function (cred) {
    var self = this;
    return this.c._fetch('/test/auth/token', cred).then(function (r) {
      if (r.error) { var e = new Error(r.error.message); e.name = 'AuthApiError'; e.code = r.error.code; e.status = r.error.status; return { data: { user: null, session: null }, error: e }; }
      self._write(r.session);
      self._emit('SIGNED_IN', r.session);
      return { data: { user: r.session.user, session: r.session }, error: null };
    }, function (err) { var e = new Error('Failed to fetch'); e.name = 'AuthRetryableFetchError'; e.status = 0; return { data: { user: null, session: null }, error: e }; });
  };
  Auth.prototype.signOut = function () {
    var self = this;
    var done = function () { self._write(null); self._emit('SIGNED_OUT', null); return { error: null }; };
    return this.c._fetch('/test/auth/logout', {}).then(done, done);
  };
  /* an access token the server no longer accepts: try the refresh token, else end the session */
  Auth.prototype._expired = function () {
    var self = this, s = this._read();
    if (!s) return Promise.resolve();
    return this.c._fetch('/test/auth/refresh', { refresh_token: s.refresh_token }).then(function (r) {
      if (r.session) { self._write(r.session); self._emit('TOKEN_REFRESHED', r.session); }
      else { self._write(null); self._emit('SIGNED_OUT', null); }
    }, function () { /* offline: keep the session */ });
  };

  /* ---------- realtime ---------- */
  function Channel(client, name) { this.c = client; this.name = name; this.specs = []; this.handlers = []; this.closed = false; }
  Channel.prototype.on = function (type, cfg, cb) {
    if (type === 'postgres_changes') { this.specs.push({ table: cfg.table, filter: cfg.filter }); this.handlers.push({ table: cfg.table, filter: cfg.filter, cb: cb }); }
    return this;
  };
  Channel.prototype.subscribe = function (statusCb) {
    var self = this;
    this.statusCb = statusCb;
    function connect() {
      if (self.closed) return;
      var ws = self.ws = new WebSocket(self.c.url.replace(/^http/, 'ws') + '/test/realtime');
      ws.onopen = function () { ws.send(JSON.stringify({ type: 'join', token: self.c.auth._token(), specs: self.specs })); };
      ws.onmessage = function (ev) {
        var m = JSON.parse(ev.data);
        if (m.type === 'status') { if (statusCb) statusCb(m.status); return; }
        self.handlers.forEach(function (h) {
          if (h.table !== m.table) return;
          if (h.filter) { var f = /^([a-z_]+)=eq\.(.+)$/.exec(h.filter); if (!f || String(m.new[f[1]]) !== f[2]) return; }
          h.cb({ eventType: m.eventType, new: m.new, old: {}, table: m.table, schema: 'public' });
        });
      };
      ws.onclose = function () { if (!self.closed) { if (statusCb) statusCb('CHANNEL_ERROR'); setTimeout(connect, 1500); } };
      ws.onerror = function () { /* onclose follows */ };
    }
    connect();
    return this;
  };
  Channel.prototype._close = function () { this.closed = true; if (this.ws) try { this.ws.close(); } catch (e) { /* ignore */ } if (this.statusCb) this.statusCb('CLOSED'); };

  window.supabase = { createClient: function (url, key, opts) { return new Client(url, key, opts); } };
})();
