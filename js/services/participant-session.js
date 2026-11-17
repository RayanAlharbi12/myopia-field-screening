/* =====================================================================
   ParticipantSession — the in-memory working copy of one participant.
   The station screens edit through this service exactly as in Phase 1.
   Phase 2: each change is recorded field by field (with the value it
   replaced), written to this device's cache + outbox in one transaction
   (debounced), and then sent to the server by the SyncEngine. Changes
   made on other devices arrive through Realtime and are merged into the
   form without touching fields that are being edited here.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, T = MF.tables, TB = MF.TABLES;

  var STATION_OF = {
    registration: 'registration', family_members: 'registration', ocular_history_entries: 'registration',
    systemic_history_entries: 'registration', family_history_entries: 'registration', participants: 'registration',
    autorefraction: 'autoref', strabismus: 'strabismus', eom_findings: 'strabismus', visual_acuity: 'va',
    questionnaire_responses: 'questionnaire'
  };
  var SINGLE = T.SINGLES;
  var RANK = { not_started: 0, in_progress: 1, completed: 2 };

  function Session(bundle) {
    var self = this;
    this.b = bundle;
    this.pid = bundle.participant.id;
    this.dirty = {};          /* key -> pending change not yet written locally */
    this.inflight = 0;
    this.localError = null;
    this.state = 'synced';
    this.listeners = {};
    SINGLE.forEach(function (s) { if (!self.b[s]) self.b[s] = { participant_id: self.pid, version: 1 }; });
    if (!this.b.questionnaire_responses.answers) this.b.questionnaire_responses.answers = {};
    this._flush = D.debounce(function () { self.flush().catch(function () {}); }, 450);
    this._offs = [
      MF.sync.on('row', function (ev) { self._remote(ev); }),
      MF.sync.on('status', function () { self._publish(); }),
      MF.sync.on('discarded', function (e) { if (e.pid === self.pid) self.emit('discarded', e); })
    ];
    this._publish();
  }

  Session.prototype.on = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); return this; };
  Session.prototype.emit = function (ev, data) { (this.listeners[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { MF.log(e); } }); };
  Session.prototype.dispose = function () { this._flush.cancel(); this._offs.forEach(function (f) { f(); }); this.listeners = {}; };

  /* save indicator: local write first, then server synchronisation */
  Session.prototype._publish = function () {
    var st;
    var sync = MF.sync.status();
    var mine = sync.byPid[this.pid] || 0, conflicts = sync.conflictPids[this.pid] || 0;
    if (this.localError) st = 'local_error';
    else if (conflicts) st = 'conflict';
    else if (Object.keys(this.dirty).length || this.inflight) st = MF.net.online ? 'syncing' : 'offline';
    else if (mine) st = !MF.net.online || !MF.auth.canSync() ? 'offline' : sync.state === 'error' ? 'error' : 'syncing';
    else st = MF.net.online && MF.auth.canSync() ? 'synced' : 'offline';
    var changed = st !== this.state;
    this.state = st;
    this.emit('save', { state: st, error: this.localError, pending: mine, conflicts: conflicts, changed: changed });
  };

  /* ---------- recording changes ---------- */
  function keyFor(table, pk) { return table + '|' + pk; }
  Session.prototype._pk = function (table, rec) { return TB[table] && TB[table].pk === 'id' ? rec.id : this.pid; };

  Session.prototype._markField = function (table, rec, field, oldValue) {
    var pk = table === 'participants' ? rec.id : this._pk(table, rec);
    var k = keyFor(table, pk);
    var d = this.dirty[k];
    if (!d) d = this.dirty[k] = { op: 'patch', table: table, pk: pk, rec: rec, fields: {}, base: {}, baseVersion: rec.version };
    if (d.op === 'patch' && !(field in d.base)) d.base[field] = oldValue === undefined ? null : oldValue;
    d.fields[field] = true;
    this._queue();
  };
  Session.prototype._queue = function () { this._publish(); this._flush(); };

  Session.prototype._touchStation = function (station) {
    if (!station) return;
    var st = this.b.station_status[station] = this.b.station_status[station] || { state: 'not_started' };
    if (st.state !== 'not_started') return;
    st.state = 'in_progress';
    st.updated_at = D.nowIso();
    this.dirty['station|' + station] = { op: 'station', station: station, status: 'in_progress' };
  };

  Session.prototype._afterChange = function (station, info) {
    this._touchStation(station);
    this._recompute();
    this._queue();
    this.emit('change', info || {});
  };

  /* list columns, overall status and referral are recalculated here for display;
     the server keeps its own authoritative copy (participant_summary) */
  Session.prototype._recompute = function () {
    var p = this.b.participant;
    p.summary = MF.clinical.summary(this.b);
    p.status = MF.clinical.participantStatus(this.b.station_status);
  };

  /* ---------- single-record fields ---------- */
  Session.prototype.get = function (store, field) { var r = this.b[store]; return r ? r[field] : undefined; };
  Session.prototype.set = function (store, field, value) {
    var r = this.b[store];
    if (value === undefined) value = null;
    if (T.same(r[field], value)) return false;
    var old = r[field];
    r[field] = value;
    this._markField(store, r, field, old);
    this._afterChange(STATION_OF[store], { store: store, field: field });
    return true;
  };
  Session.prototype.setMany = function (store, patch) {
    var self = this, r = this.b[store], changed = [];
    Object.keys(patch).forEach(function (k) {
      if (!T.same(r[k], patch[k])) { var old = r[k]; r[k] = patch[k]; self._markField(store, r, k, old); changed.push(k); }
    });
    if (!changed.length) return false;
    this._afterChange(STATION_OF[store], { store: store, fields: changed });
    return true;
  };
  Session.prototype.toggleIn = function (store, field, value) {
    var r = this.b[store], list = (r[field] || []).slice(), i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1); else list.push(value);
    return this.set(store, field, list);
  };

  /* participant name lives on the participant record (list + search), edited in Registration */
  Session.prototype.setName = function (name) {
    var p = this.b.participant;
    if (p.name === name) return;
    var old = p.name;
    p.name = name;
    this._markField('participants', p, 'name', old);
    this._afterChange('registration', { store: 'participants', field: 'name' });
  };

  /* questionnaire answers (merged per question on the server) */
  Session.prototype.answer = function (itemId) { return this.b.questionnaire_responses.answers[itemId]; };
  Session.prototype.setAnswer = function (itemId, value) {
    var q = this.b.questionnaire_responses;
    if (T.same(q.answers[itemId], value)) return;
    var old = q.answers[itemId];
    var empty = value === undefined || value === null || value === '';
    if (empty) delete q.answers[itemId]; else q.answers[itemId] = value;
    var k = keyFor('questionnaire_responses', this.pid);
    var d = this.dirty[k] = this.dirty[k] || { op: 'answers', table: 'questionnaire_responses', pk: this.pid, set: {}, unset: {}, base: {}, baseVersion: q.version };
    if (!(itemId in d.base)) d.base[itemId] = old === undefined ? null : old;
    if (empty) { delete d.set[itemId]; d.unset[itemId] = true; } else { d.set[itemId] = true; delete d.unset[itemId]; }
    this._afterChange('questionnaire', { store: 'questionnaire_responses', item: itemId });
  };

  /* ---------- multi-record stores ---------- */
  Session.prototype.list = function (store, filter) {
    var l = this.b[store] || [];
    return filter ? l.filter(filter) : l.slice();
  };
  Session.prototype.find = function (store, id) { return (this.b[store] || []).filter(function (r) { return r.id === id; })[0] || null; };
  Session.prototype.add = function (store, init) {
    var rec = Object.assign({ id: D.uid(), participant_id: this.pid, created_at: D.nowIso(), version: 0, _local: true }, init || {});
    (this.b[store] = this.b[store] || []).push(rec);
    this.dirty[keyFor(store, rec.id)] = { op: 'insert', table: store, pk: rec.id, rec: rec };
    this._afterChange(STATION_OF[store], { store: store, added: rec.id });
    return rec;
  };
  Session.prototype.update = function (store, id, patch) {
    var self = this, rec = this.find(store, id);
    if (!rec) return false;
    var changed = [];
    Object.keys(patch).forEach(function (k) {
      if (!T.same(rec[k], patch[k])) {
        var old = rec[k]; rec[k] = patch[k]; changed.push(k);
        var d = self.dirty[keyFor(store, id)];
        if (!d || d.op !== 'insert') self._markField(store, rec, k, old);
      }
    });
    if (!changed.length) return false;
    this._afterChange(STATION_OF[store], { store: store, id: id, fields: changed });
    return true;
  };
  /* explicit removal of one entry: soft delete (deleted_at), cleared values for EOM,
     or simply forgotten when it never left this device */
  Session.prototype.remove = function (store, id) {
    var l = this.b[store] || [], i = -1;
    l.forEach(function (r, k) { if (r.id === id) i = k; });
    if (i < 0) return Promise.resolve();
    var self = this, rec = l[i], k = keyFor(store, id), d = this.dirty[k], t = TB[store];
    if (d && d.op === 'insert') {                       /* never written anywhere: just forget it */
      delete this.dirty[k];
      l.splice(i, 1);
    } else if (rec._local && !rec.version) {            /* written locally, maybe not on the server yet */
      this.dirty[k] = { op: 'cancel', table: store, pk: id, rec: rec };
      l.splice(i, 1);
    } else if (t.cleared) {                             /* EOM finding: keep the row, clear its values */
      Object.keys(t.cleared).forEach(function (f) { if (!T.same(rec[f], t.cleared[f])) { var old = rec[f]; rec[f] = t.cleared[f]; self._markField(store, rec, f, old); } });
    } else {                                            /* soft delete */
      l.splice(i, 1);
      rec.deleted_at = D.nowIso();
      this._markField(store, rec, 'deleted_at', null);
    }
    this._afterChange(STATION_OF[store], { store: store, removed: id });
    return this.flush();
  };

  /* ---------- stations ---------- */
  Session.prototype.stationState = function (key) { return MF.clinical.stationState(this.b.station_status, key); };
  Session.prototype.complete = function (key) {
    var st = this.b.station_status[key] = this.b.station_status[key] || {};
    st.state = 'completed';
    st.completed_at = D.nowIso();
    st.updated_at = st.completed_at;
    this.dirty['station|' + key] = { op: 'station', station: key, status: 'completed', completed_at: st.completed_at };
    this._recompute();
    this.emit('change', { station: key, completed: true });
    return this.flush();
  };

  /* ---------- writing locally (cache + outbox, one transaction) ---------- */
  Session.prototype._changes = function () {
    var self = this, out = [];
    Object.keys(this.dirty).forEach(function (k) {
      var d = self.dirty[k], t = TB[d.table];
      if (d.op === 'station') out.push({ op: 'station', pid: self.pid, station: d.station, status: d.status, completed_at: d.completed_at || null });
      else if (d.op === 'insert') { d.rec._sent = true; out.push({ op: 'insert', table: d.table, pid: self.pid, pk: d.pk, row: T.pick(d.rec, t.insertCols.concat(t.cols)) }); }
      else if (d.op === 'cancel') out.push({ op: 'cancel', table: d.table, pid: self.pid, pk: d.pk, values: t.cleared ? Object.assign({}, t.cleared) : { deleted_at: d.rec.deleted_at || D.nowIso() }, base: {}, baseVersion: d.rec.version });
      else if (d.op === 'answers') {
        var q = self.b.questionnaire_responses, set = {};
        Object.keys(d.set).forEach(function (id) { set[id] = q.answers[id]; });
        out.push({ op: 'answers', table: 'questionnaire_responses', pid: self.pid, pk: self.pid, set: set, unset: Object.keys(d.unset), base: d.base, baseVersion: d.baseVersion });
      } else {
        var values = {};
        Object.keys(d.fields).forEach(function (f) { values[f] = d.rec[f] === undefined ? null : d.rec[f]; });
        out.push({ op: 'patch', table: d.table, pid: self.pid, pk: d.pk, values: values, base: d.base, baseVersion: d.baseVersion });
      }
    });
    return out;
  };

  Session.prototype.flush = function () {
    var self = this;
    this._flush.cancel();
    var batch = this.dirty;
    var changes = this._changes();
    this.dirty = {};
    if (!changes.length) { this._publish(); return Promise.resolve(); }
    this.inflight++;
    this._publish();
    return MF.sync.stage(changes).then(function () {
      self.inflight--;
      self.localError = null;
      self._publish();
    }, function (err) {
      self.inflight--;
      /* keep everything that was not written, so a retry can save it */
      Object.keys(batch).forEach(function (k) { if (!self.dirty[k]) self.dirty[k] = batch[k]; });
      self.localError = err;
      self._publish();
      MF.log('local save failed', err);
      throw err;
    });
  };
  Session.prototype.hasUnsaved = function () { return Object.keys(this.dirty).length > 0 || this.inflight > 0 || !!this.localError; };
  Session.prototype.retry = function () { MF.sync.retryFailed(); return this.flush(); };

  /* ---------- changes arriving from the server (other devices, or our own push results) ---------- */
  Session.prototype._pendingFields = function (table, pk) {
    var d = this.dirty[keyFor(table, pk)];
    if (!d) return {};
    if (d.op === 'answers') { var o = {}; Object.keys(d.set).concat(Object.keys(d.unset)).forEach(function (q) { o['answers.' + q] = true; }); return o; }
    if (d.op === 'insert' || d.op === 'cancel') return { '*': true };
    return d.fields || {};
  };
  Session.prototype._remote = function (ev) {
    var row = ev.row, table = ev.table, b = this.b, self = this;
    var pid = table === 'participants' ? row.id : row.participant_id;
    if (pid !== this.pid) return;
    var changed = false;
    function copy(rec, cols, pend) {
      if (pend['*']) return;
      cols.forEach(function (c) { if (!pend[c] && row[c] !== undefined && !T.same(rec[c], row[c])) { rec[c] = row[c]; changed = true; } });
      if (row.version != null && (rec.version == null || row.version > rec.version)) rec.version = row.version;
      if (row.updated_at) rec.updated_at = row.updated_at;
    }
    if (table === 'participants') {
      copy(b.participant, ['name', 'code', 'seq', 'archived', 'archived_at'], this._pendingFields('participants', row.id));
    } else if (table === 'station_status') {
      var key = T.ST_FROM_DB[row.station];
      var cur = b.station_status[key] = b.station_status[key] || { state: 'not_started' };
      if (key && RANK[row.status] > RANK[cur.state || 'not_started']) { cur.state = row.status; cur.completed_at = row.completed_at; changed = true; }
    } else if (table === 'questionnaire_responses') {
      var q = b.questionnaire_responses, pend = this._pendingFields(table, this.pid), ra = row.answers || {};
      Object.keys(ra).concat(Object.keys(q.answers)).forEach(function (id) {
        if (pend['answers.' + id]) return;
        if (!T.same(q.answers[id], ra[id])) { if (ra[id] === undefined) delete q.answers[id]; else q.answers[id] = ra[id]; changed = true; }
      });
      if (row.version != null && (q.version == null || row.version > q.version)) q.version = row.version;
    } else if (SINGLE.indexOf(table) >= 0) {
      copy(b[table], TB[table].cols, this._pendingFields(table, this.pid));
    } else if (TB[table] && TB[table].many) {
      var list = b[table] = b[table] || [];
      if (ev.replacedId) list.forEach(function (r) { if (r.id === ev.replacedId) { r.id = row.id; r._local = false; changed = true; } });
      var rec = list.filter(function (r) { return r.id === row.id; })[0];
      if (row.deleted_at) {
        if (rec) { b[table] = list.filter(function (r) { return r.id !== row.id; }); changed = true; }
      } else if (rec) {
        copy(rec, TB[table].cols.concat(['key', 'member_id']), this._pendingFields(table, row.id));
        if (row.version) rec._local = false;
      } else if (!this.dirty[keyFor(table, row.id)]) {
        list.push(Object.assign({}, row)); changed = true;
      }
    } else return;
    if (changed) {
      this._recompute();
      this.emit('change', { structural: true, remote: ev.source === 'realtime' || ev.source === 'resolve' });
      if (ev.source === 'realtime') this.emit('remote', { table: table });
    }
    self._publish();
  };

  MF.ParticipantSession = Session;
})();
