/* =====================================================================
   SyncEngine — local-first saving with a persistent outbox.

   Every edit is written to the per-user IndexedDB cache together with an
   outbox entry in ONE transaction, then pushed to Supabase:
     patch    changed fields only, guarded by the row version the edit was
              based on (UPDATE … WHERE version = base)
     insert   new repeatable entries (client UUID; safe to retry)
     answers  questionnaire answers by question key (patch_questionnaire)
     station  station status (touch_station; never goes backwards)
   When the server row has moved on, each changed field is compared with
   the value the edit started from:
     unchanged on the server  -> merged automatically and pushed again
     already equal            -> nothing to do
     changed differently      -> conflict, shown to the examiner (never
                                 overwritten silently)
   Set-like lists (symptoms, reasons) merge item by item; next_sibling_no
   keeps the larger value.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, T = MF.tables, TB = MF.TABLES;
  var same = T.same;

  var SET_FIELDS = { registration: ['glasses_reasons', 'symptoms', 'blurry_loc'] };
  var MAX_FIELDS = { registration: ['next_sibling_no'] };
  var STATION_RANK = { not_started: 0, in_progress: 1, completed: 2 };
  var PERMANENT = ['FORBIDDEN', 'CHECK', 'VALIDATION', 'NOT_FOUND', 'IMMUTABLE', 'ARCHIVED', 'INACTIVE', 'UNIQUE'];

  var listeners = {};
  var state = { running: false, timer: 0, lastOk: null, lastError: null, counts: { pending: 0, failed: 0, conflicts: 0 } };
  var seq = Date.now();

  function emit(ev, d) { (listeners[ev] || []).slice().forEach(function (fn) { try { fn(d); } catch (e) { MF.log(e); } }); }
  function db() { return MF.cache.db; }
  function now() { return new Date().toISOString(); }
  function keyOf(table, pk, station) { return table + '|' + pk + (station ? '|' + station : ''); }
  function pkCol(table) { return table === 'station_status' ? 'participant_id' : TB[table].pk; }
  function setMerge(base, local, remote) {
    base = base || []; local = local || []; remote = remote || [];
    var added = local.filter(function (x) { return base.indexOf(x) < 0; });
    var removed = base.filter(function (x) { return local.indexOf(x) < 0; });
    var out = remote.filter(function (x) { return removed.indexOf(x) < 0; });
    added.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /* ---------- staging (called by ParticipantSession) ----------
     change = { table, pid, pk, op: 'patch'|'insert'|'answers'|'station',
                values {f: v}, base {f: v}, baseVersion,           (patch)
                row {...},                                            (insert)
                set {k: v}, unset [k], base {k: v}, baseVersion,      (answers)
                station, status, completed_at }                      (station) */
  function stage(changes) {
    if (!db()) return Promise.reject(MF.err.AppError('UNKNOWN', 'لا توجد قاعدة بيانات محلية مفتوحة.'));
    var stores = ['outbox', 'participants', 'station_status'].concat(T.SINGLES, T.MANYS);
    return db().transaction(stores, function (tx) {
      return changes.reduce(function (pr, ch) { return pr.then(function () { return stageOne(tx, ch); }); }, Promise.resolve());
    }).then(function () { refreshCounts(); kick(); });
  }

  function stageOne(tx, ch) {
    var k = ch.op === 'station' ? keyOf('station_status', ch.pid, ch.station) : keyOf(ch.table, ch.pk);
    return tx.get('outbox', k).then(function (e) {
      if (ch.op === 'cancel') {
        /* removing an entry that never reached the server: forget it entirely */
        if (e && e.op === 'insert') return tx.delete('outbox', k).then(function () { return tx.delete(ch.table, ch.pk); });
        ch = Object.assign({}, ch, { op: 'patch' });
      }
      var fresh = !e;
      e = e || { k: k, n: ++seq, table: ch.op === 'station' ? 'station_status' : ch.table, pid: ch.pid, pk: ch.pk, op: ch.op, rev: 0, attempts: 0, created_at: now() };
      e.rev++; e.updated_at = now(); e.error = null; e.failed = false; e.next_at = 0;
      if (ch.op === 'insert') {
        e.op = 'insert';
        e.row = Object.assign({}, e.row || {}, ch.row);
      } else if (ch.op === 'patch') {
        if (e.op === 'insert') { Object.assign(e.row, ch.values); }
        else {
          e.patch = Object.assign({}, e.patch || {}, ch.values);
          e.base = e.base || {};
          Object.keys(ch.values).forEach(function (f) { if (!(f in e.base)) e.base[f] = ch.base ? ch.base[f] : null; });
          if (fresh || e.base_version == null) e.base_version = ch.baseVersion;
        }
      } else if (ch.op === 'answers') {
        e.set = e.set || {}; e.unset = e.unset || []; e.base = e.base || {};
        Object.keys(ch.set || {}).forEach(function (q) {
          e.set[q] = ch.set[q];
          e.unset = e.unset.filter(function (x) { return x !== q; });
          if (!(q in e.base)) e.base[q] = ch.base ? ch.base[q] : null;
        });
        (ch.unset || []).forEach(function (q) {
          delete e.set[q];
          if (e.unset.indexOf(q) < 0) e.unset.push(q);
          if (!(q in e.base)) e.base[q] = ch.base ? ch.base[q] : null;
        });
        if (fresh || e.base_version == null) e.base_version = ch.baseVersion;
      } else if (ch.op === 'station') {
        if (!e.status || STATION_RANK[ch.status] >= STATION_RANK[e.status]) {
          e.status = ch.status;
          if (ch.status === 'completed') e.completed_at = ch.completed_at || now();
        }
        e.station = ch.station;
      }
      return tx.put('outbox', e).then(function () { return writeLocal(tx, ch); });
    });
  }

  /* keep the cached row equal to what the examiner sees */
  function writeLocal(tx, ch) {
    if (ch.op === 'station') {
      var dbSt = T.ST_TO_DB[ch.station] || ch.station;
      return tx.get('station_status', [ch.pid, dbSt]).then(function (r) {
        r = r || { participant_id: ch.pid, station: dbSt, status: 'not_started', completed_at: null };
        if (STATION_RANK[ch.status] > STATION_RANK[r.status]) { r.status = ch.status; if (ch.status === 'completed') r.completed_at = ch.completed_at || now(); }
        r.updated_at = now();
        return tx.put('station_status', r);
      });
    }
    var table = ch.table;
    var key = ch.pk;
    return tx.get(table, key).then(function (r) {
      if (ch.op === 'insert') r = Object.assign({}, r || {}, ch.row, { version: r && r.version || 0, _local: true });
      else if (ch.op === 'answers') {
        r = r || { participant_id: ch.pid, answers: {} };
        r.answers = Object.assign({}, r.answers || {});
        Object.keys(ch.set || {}).forEach(function (q) { r.answers[q] = ch.set[q]; });
        (ch.unset || []).forEach(function (q) { delete r.answers[q]; });
      } else {
        r = r || {};
        Object.keys(ch.values).forEach(function (f) { r[f] = ch.values[f]; });
      }
      return tx.put(table, r);
    });
  }

  /* ---------- pushing ---------- */
  function eligible(list) {
    var t = Date.now();
    return list.filter(function (e) { return !e.failed && !(e.next_at && e.next_at > t) && !e.inflight; })
      .sort(function (a, b) { return a.n - b.n; });
  }

  function kick() {
    if (state.running || !db()) return;
    if (!MF.net.online || !MF.auth || !MF.auth.canSync()) { publish(); return; }
    state.running = true;
    publish();
    (function loop() {
      if (!db()) { state.running = false; publish(); return; }
      db().getAll('outbox').then(function (list) {
        var next = eligible(list)[0];
        if (!next) { state.running = false; refreshCounts(); scheduleRetry(list); return; }
        return pushOne(next).then(function (outcome) {
          if (outcome === 'stop') { state.running = false; refreshCounts(); return; }
          loop();
        });
      }).catch(function (err) {
        MF.log('sync loop', err);
        state.running = false; refreshCounts();
      });
    })();
  }

  function scheduleRetry(list) {
    clearTimeout(state.timer);
    var t = Date.now(), soon = null;
    list.forEach(function (e) { if (!e.failed && e.next_at && e.next_at > t) soon = soon == null ? e.next_at : Math.min(soon, e.next_at); });
    if (soon != null) state.timer = setTimeout(kick, Math.max(500, soon - t));
  }

  function pushOne(e) {
    var started = { rev: e.rev };
    var job;
    if (e.op === 'insert') job = pushInsert(e);
    else if (e.op === 'patch') job = pushPatch(e, e.patch, e.base, e.base_version);
    else if (e.op === 'answers') job = pushAnswers(e);
    else job = MF.remote.touchStation(e.pid, T.ST_TO_DB[e.station] || e.station, e.status, e.completed_at).then(function (row) { return { row: row }; });
    return job.then(function (res) {
      return settle(e, started, res).then(function () { state.lastOk = now(); state.lastError = null; return 'next'; });
    }, function (err) {
      var w = MF.err.wrap(err);
      if (w.network) { MF.net.report(w); return 'stop'; }
      if (w.auth) { emit('auth', w); return 'stop'; }
      return db().get('outbox', e.k).then(function (cur) {
        if (!cur) return 'next';
        cur.attempts = (cur.attempts || 0) + 1;
        cur.error = w.code;
        cur.error_message = w.message;
        cur.failed = PERMANENT.indexOf(w.code) >= 0 && cur.attempts >= 2;
        cur.next_at = Date.now() + Math.min(300000, 2000 * Math.pow(2, Math.min(cur.attempts, 8)));
        state.lastError = w;
        return db().put('outbox', cur).then(function () { return 'next'; });
      });
    });
  }

  function pushInsert(e) {
    var t = TB[e.table];
    var row = T.pick(e.row, t.insertCols.concat(t.cols));
    return MF.remote.insertRow(e.table, row).then(function (r) { return { row: r }; }, function (err) {
      var w = MF.err.wrap(err);
      if (w.code !== 'UNIQUE') throw err;
      /* already there: a retried insert that did reach the server, or (EOM) the same finding created on another device */
      var find = e.table === 'eom_findings' ? MF.remote.getEom(e.pid, e.row.eye, e.row.muscle) : MF.remote.getRow(e.table, 'id', e.row.id);
      return find.then(function (srv) {
        if (!srv) throw err;
        if (srv.id === e.row.id) return { row: srv };
        /* a different row holds this eye + muscle: adopt its id; values the other device left
           empty become ordinary edits, values it set differently become a conflict */
        var fields = {}, follow = {}, fbase = {};
        t.cols.forEach(function (f) {
          if (e.row[f] === undefined || same(e.row[f], srv[f])) return;
          if (srv[f] == null) { follow[f] = e.row[f]; fbase[f] = null; }
          else fields[f] = { base: null, local: e.row[f], remote: srv[f] };
        });
        return {
          row: srv, replacedId: e.row.id, conflictFields: Object.keys(fields).length ? fields : null,
          follow: Object.keys(follow).length ? { values: follow, base: fbase } : null
        };
      });
    });
  }

  function pushPatch(e, patch, base, baseVersion) {
    var t = TB[e.table];
    var clean = T.pick(patch, t.cols);
    if (!Object.keys(clean).length) return Promise.resolve({ row: null });
    return MF.remote.updateVersioned(e.table, t.pk, e.pk, clean, baseVersion).then(function (rows) {
      if (rows && rows.length) return { row: rows[0], pushed: clean };
      /* nothing updated: the row moved on (or is no longer editable) */
      return MF.remote.getRow(e.table, t.pk, e.pk).then(function (srv) {
        if (!srv) throw MF.err.AppError('FORBIDDEN');
        var retry = {}, conflicts = {};
        Object.keys(clean).forEach(function (f) {
          var local = clean[f], remote = srv[f], b = base ? base[f] : null;
          if (same(remote, local)) return;
          if (same(remote, b)) { retry[f] = local; return; }
          if (SET_FIELDS[e.table] && SET_FIELDS[e.table].indexOf(f) >= 0) { retry[f] = setMerge(b, local, remote); return; }
          if (MAX_FIELDS[e.table] && MAX_FIELDS[e.table].indexOf(f) >= 0) { retry[f] = Math.max(local || 0, remote || 0); return; }
          conflicts[f] = { base: b, local: local, remote: remote };
        });
        var cf = Object.keys(conflicts).length ? conflicts : null;
        if (!Object.keys(retry).length) return { row: srv, pushed: clean, conflictFields: cf };
        if (srv.version === baseVersion) throw MF.err.AppError('FORBIDDEN');   /* same version but not updated: no permission */
        return pushPatch(e, retry, srv, srv.version).then(function (res) {
          return { row: res.row || srv, pushed: clean, conflictFields: cf || res.conflictFields || null };
        });
      });
    });
  }

  function pushAnswers(e) {
    var set = e.set || {}, unset = e.unset || [];
    function attempt(version, s, u, depth) {
      return MF.remote.patchAnswers(e.pid, version, s, u).then(function (res) {
        if (res && res.ok) return { row: res.row };
        var cur = res && res.current;
        if (!cur || depth > 2) throw MF.err.AppError('CONFLICT');
        var ra = cur.answers || {}, s2 = {}, u2 = [], conflicts = {};
        Object.keys(s).forEach(function (q) {
          if (same(ra[q], s[q])) return;
          if (same(ra[q], e.base[q])) s2[q] = s[q];
          else conflicts['answers.' + q] = { base: e.base[q], local: s[q], remote: ra[q] };
        });
        u.forEach(function (q) {
          if (ra[q] === undefined) return;
          if (same(ra[q], e.base[q])) u2.push(q);
          else conflicts['answers.' + q] = { base: e.base[q], local: null, remote: ra[q] };
        });
        var cf = Object.keys(conflicts).length ? conflicts : null;
        if (!Object.keys(s2).length && !u2.length) return { row: cur, conflictFields: cf };
        return attempt(cur.version, s2, u2, depth + 1).then(function (r2) { return { row: r2.row, conflictFields: cf || r2.conflictFields }; });
      });
    }
    return attempt(e.base_version, set, unset, 0);
  }

  /* after a push: drop what the server confirmed, keep later edits, record conflicts */
  function settle(e, started, res) {
    var stores = ['outbox', 'conflicts', 'participants', 'station_status'].concat(T.SINGLES, T.MANYS);
    var row = res.row;
    return db().transaction(stores, function (tx) {
      return tx.get('outbox', e.k).then(function (cur) {
        var jobs = [];
        if (cur) {
          if (cur.rev === started.rev) jobs.push(tx.delete('outbox', e.k));
          else {
            /* edited again while the request was in flight: keep only the newer values */
            if (cur.op === 'insert') {
              var patch = {}, baseV = {};
              TB[cur.table].cols.forEach(function (f) { if (cur.row[f] !== undefined && row && !same(cur.row[f], row[f])) { patch[f] = cur.row[f]; baseV[f] = row[f]; } });
              if (Object.keys(patch).length) { cur.op = 'patch'; cur.patch = patch; cur.base = baseV; cur.base_version = row.version; delete cur.row; jobs.push(tx.put('outbox', cur)); }
              else jobs.push(tx.delete('outbox', e.k));
            } else if (cur.op === 'patch') {
              Object.keys(res.pushed || {}).forEach(function (f) { if (same(cur.patch[f], res.pushed[f])) { delete cur.patch[f]; delete cur.base[f]; } });
              if (row) { cur.base_version = row.version; Object.keys(cur.patch).forEach(function (f) { if (!(f in cur.base)) cur.base[f] = row[f]; }); }
              jobs.push(Object.keys(cur.patch).length ? tx.put('outbox', cur) : tx.delete('outbox', e.k));
            } else if (cur.op === 'answers') {
              Object.keys(e.set || {}).forEach(function (q) { if (same(cur.set[q], e.set[q])) delete cur.set[q]; });
              cur.unset = cur.unset.filter(function (q) { return (e.unset || []).indexOf(q) < 0; });
              if (row) cur.base_version = row.version;
              jobs.push(Object.keys(cur.set).length || cur.unset.length ? tx.put('outbox', cur) : tx.delete('outbox', e.k));
            } else jobs.push(cur.status === e.status ? tx.delete('outbox', e.k) : Promise.resolve());
          }
        }
        if (res.conflictFields) {
          jobs.push(tx.put('conflicts', {
            k: e.k, table: e.table, pid: e.pid, pk: row ? row[pkCol(e.table)] : e.pk, op: e.op === 'answers' ? 'answers' : 'patch',
            fields: res.conflictFields, remote_version: row ? row.version : null, created_at: now()
          }));
        }
        return Promise.all(jobs).then(function () { return cur; });
      }).then(function (cur) {
        if (!row) return null;
        return storeRow(tx, e.table, row, res.replacedId);
      });
    }).then(function (stored) {
      if (stored) emit('row', { table: e.table, row: stored, source: 'push', replacedId: res.replacedId || null });
      if (res.conflictFields) emit('conflict', { pid: e.pid, k: e.k });
      if (res.follow && row) return stage([{ op: 'patch', table: e.table, pid: e.pid, pk: row.id, values: res.follow.values, base: res.follow.base, baseVersion: row.version }]);
    });
  }

  /* write a server row into the cache, keeping any local values still waiting in the outbox */
  function storeRow(tx, table, row, replacedId) {
    var k = table === 'station_status' ? keyOf('station_status', row.participant_id, T.ST_FROM_DB[row.station]) : keyOf(table, row[pkCol(table)]);
    var jobs = [tx.get('outbox', k)];
    if (replacedId) jobs.push(tx.delete(table, replacedId));
    return Promise.all(jobs).then(function (r) {
      var e = r[0];
      var out = overlay(table, row, e);
      if (table === 'participants') {
        return tx.get('participants', row.id).then(function (old) {
          var merged = Object.assign({}, old || {}, out);
          if (old && old._full) merged._full = true;
          return tx.put('participants', merged).then(function () { return merged; });
        });
      }
      return tx.put(table, out).then(function () { return out; });
    });
  }

  function overlay(table, row, e) {
    var out = Object.assign({}, row);
    if (!e) return out;
    if (e.op === 'patch') Object.keys(e.patch || {}).forEach(function (f) { out[f] = e.patch[f]; });
    else if (e.op === 'insert') Object.keys(e.row || {}).forEach(function (f) { out[f] = e.row[f]; });
    else if (e.op === 'answers') {
      out.answers = Object.assign({}, out.answers || {});
      Object.keys(e.set || {}).forEach(function (q) { out.answers[q] = e.set[q]; });
      (e.unset || []).forEach(function (q) { delete out.answers[q]; });
    } else if (e.op === 'station' && STATION_RANK[e.status] > STATION_RANK[out.status]) {
      out.status = e.status; if (e.status === 'completed') out.completed_at = e.completed_at;
    }
    return out;
  }

  /* rows arriving from the server (page loads, realtime) */
  function applyRemote(table, rows, source) {
    if (!db() || !rows || !rows.length) return Promise.resolve([]);
    var stores = ['outbox', 'participants', 'schools', 'station_status'].concat(T.SINGLES, T.MANYS);
    return db().transaction(stores, function (tx) {
      return Promise.all(rows.map(function (row) {
        if (table === 'participant_summary') {
          return tx.get('participants', row.participant_id).then(function (old) {
            if (!old) return null;
            var p = T.participantFromRows(old, row);
            p._summary_at = row.updated_at;
            return tx.put('participants', p).then(function () { return p; });
          });
        }
        if (table === 'schools') return tx.put('schools', row).then(function () { return row; });
        if (table === 'participants' || table === 'station_status' || T.SINGLES.indexOf(table) >= 0 || T.MANYS.indexOf(table) >= 0) {
          return tx.get(table, table === 'station_status' ? [row.participant_id, row.station] : row[pkCol(table)]).then(function (old) {
            /* never step back to an older version than the one already cached */
            if (old && old.version != null && row.version != null && old.version > row.version && !old._local) return null;
            return storeRow(tx, table, row);
          });
        }
        return null;
      }));
    }).then(function (stored) {
      stored = stored.filter(Boolean);
      stored.forEach(function (r) { emit('row', { table: table, row: r, source: source || 'remote' }); });
      return stored;
    });
  }

  /* ---------- status ---------- */
  function refreshCounts() {
    if (!db()) { publish(); return Promise.resolve(); }
    return Promise.all([db().getAll('outbox'), db().getAll('conflicts')]).then(function (r) {
      state.counts = {
        pending: r[0].filter(function (e) { return !e.failed; }).length,
        failed: r[0].filter(function (e) { return e.failed; }).length,
        conflicts: r[1].length,
        byPid: r[0].reduce(function (m, e) { m[e.pid] = (m[e.pid] || 0) + 1; return m; }, {}),
        conflictPids: r[1].reduce(function (m, c) { m[c.pid] = (m[c.pid] || 0) + 1; return m; }, {}),
        errorCode: (r[0].filter(function (e) { return e.error; })[0] || {}).error || null
      };
      publish();
    }, function () { publish(); });
  }

  function status() {
    var c = state.counts;
    var s;
    if (c.conflicts) s = 'conflict';
    else if (c.failed || c.errorCode && c.pending) s = MF.net.online ? 'error' : 'offline';
    else if (!MF.net.online) s = 'offline';
    else if (state.running || c.pending) s = 'syncing';
    else s = 'synced';
    return { state: s, pending: c.pending || 0, failed: c.failed || 0, conflicts: c.conflicts || 0, lastOk: state.lastOk, lastError: state.lastError, byPid: c.byPid || {}, conflictPids: c.conflictPids || {} };
  }
  function publish() { emit('status', status()); }

  MF.net.on(function (online) { publish(); if (online) kick(); });

  MF.sync = {
    stage: stage,
    kick: kick,
    applyRemote: applyRemote,
    status: status,
    refresh: refreshCounts,
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); return function () { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); }; },
    outbox: function () { return db() ? db().getAll('outbox') : Promise.resolve([]); },
    pendingFor: function (pid) { return db() ? db().getAllByIndex('outbox', 'pid', pid) : Promise.resolve([]); },
    conflicts: function (pid) { return db() ? (pid ? db().getAllByIndex('conflicts', 'pid', pid) : db().getAll('conflicts')) : Promise.resolve([]); },
    hasPending: function () { return MF.sync.outbox().then(function (l) { return l.length > 0; }); },

    /* resolve one conflict: choice[field] = 'local' | 'remote' */
    resolve: function (conflict, choice) {
      var keepLocal = {}, keepRemote = {};
      Object.keys(conflict.fields).forEach(function (f) { (choice[f] === 'local' ? keepLocal : keepRemote)[f] = conflict.fields[f]; });
      var stores = ['conflicts', 'outbox'].concat(T.SINGLES, T.MANYS, ['participants']);
      return db().transaction(stores, function (tx) {
        return tx.delete('conflicts', conflict.k).then(function () { return tx.get(conflict.table, conflict.pk); }).then(function (rowNow) {
          var jobs = [];
          if (rowNow) {
            Object.keys(keepRemote).forEach(function (f) {
              if (f.indexOf('answers.') === 0) {
                rowNow.answers = Object.assign({}, rowNow.answers || {});
                var q = f.slice(8), v = keepRemote[f].remote;
                if (v === undefined || v === null) delete rowNow.answers[q]; else rowNow.answers[q] = v;
              } else rowNow[f] = keepRemote[f].remote;
            });
            jobs.push(tx.put(conflict.table, rowNow));
          }
          return Promise.all(jobs).then(function () { return rowNow; });
        });
      }).then(function (rowNow) {
        var lf = Object.keys(keepLocal);
        var after = Promise.resolve();
        if (lf.length) {
          /* re-apply the chosen local values on top of the version that is on the server now */
          if (conflict.op === 'answers') {
            var set = {}, unset = [], base = {};
            lf.forEach(function (f) { var q = f.slice(8), v = keepLocal[f].local; base[q] = keepLocal[f].remote; if (v == null) unset.push(q); else set[q] = v; });
            after = stage([{ op: 'answers', table: 'questionnaire_responses', pid: conflict.pid, pk: conflict.pk, set: set, unset: unset, base: base, baseVersion: conflict.remote_version }]);
          } else {
            var vals = {}, b2 = {};
            lf.forEach(function (f) { vals[f] = keepLocal[f].local; b2[f] = keepLocal[f].remote; });
            after = stage([{ op: 'patch', table: conflict.table, pid: conflict.pid, pk: conflict.pk, values: vals, base: b2, baseVersion: conflict.remote_version }]);
          }
        }
        return after.then(function () {
          if (rowNow) emit('row', { table: conflict.table, row: rowNow, source: 'resolve' });
          refreshCounts();
        });
      });
    },
    /* give up one change that the server keeps refusing */
    discard: function (k) {
      return db().get('outbox', k).then(function (e) {
        if (!e) return;
        return db().delete('outbox', k).then(function () {
          emit('discarded', e);
          refreshCounts();
        });
      });
    },
    retryFailed: function () {
      return MF.sync.outbox().then(function (l) {
        return Promise.all(l.filter(function (e) { return e.failed || e.next_at; }).map(function (e) { e.failed = false; e.next_at = 0; e.attempts = 0; return db().put('outbox', e); }));
      }).then(function () { refreshCounts(); kick(); });
    },
    /* resolves true when nothing is left to send (within the time limit) */
    drain: function (ms) {
      var until = Date.now() + (ms || 15000);
      return new Promise(function (resolve) {
        (function check() {
          kick();
          MF.sync.outbox().then(function (l) {
            var live = l.filter(function (e) { return !e.failed; });
            if (!live.length) { resolve(l.length === 0); return; }
            if (Date.now() > until || !MF.net.online) { resolve(false); return; }
            setTimeout(check, 400);
          }, function () { resolve(false); });
        })();
      });
    },
    reset: function () { clearTimeout(state.timer); state.running = false; state.counts = { pending: 0, failed: 0, conflicts: 0 }; publish(); },
    _setMerge: setMerge
  };
})();
