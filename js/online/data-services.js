/* =====================================================================
   Phase 2 data services:
     snapshot()        canonical rows from Supabase (or, offline, a school
                       this device prepared completely) in the shape the
                       approved Excel export reads
     fullBackup()      Administrator: every table as one JSON file
     importFile()      Administrator: Phase 1 offline backup or Phase 2 full
                       backup -> validate -> dry run -> confirm -> import
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, T = MF.tables, R = MF.remote;
  var TABLES = ['participants', 'participant_summary', 'station_status'].concat(T.SINGLES, T.MANYS);

  function toSnapshot(schools, raw) {
    var sums = {};
    (raw.participant_summary || []).forEach(function (s) { sums[s.participant_id] = s; });
    var st = {};
    (raw.station_status || []).forEach(function (r) { (st[r.participant_id] = st[r.participant_id] || []).push(r); });
    var snap = { schools: schools, participants: raw.participants.map(function (p) { return T.participantFromRows(p, sums[p.id]); }) };
    T.SINGLES.forEach(function (t) { snap[t] = raw[t] || []; });
    T.MANYS.forEach(function (t) { snap[t] = (raw[t] || []).filter(function (r) { return !r.deleted_at; }); });
    snap.station_status = snap.participants.map(function (p) { return T.statusFromRows(p.id, st[p.id]); });
    return snap;
  }

  function serverSnapshot(schoolId) {
    if (schoolId) {
      return R.school(schoolId).then(function (s) {
        if (!s) throw MF.err.AppError('NOT_FOUND');
        return R.participantIds(schoolId, false).then(function (ids) {
          var raw = {};
          return TABLES.reduce(function (pr, t) {
            return pr.then(function () { return R.rowsFor(t, ids).then(function (rows) { raw[t] = rows; }); });
          }, Promise.resolve()).then(function () { return toSnapshot([s], raw); });
        });
      });
    }
    return R.schools({ archived: false }).then(function (schools) {
      var raw = {};
      return TABLES.reduce(function (pr, t) {
        return pr.then(function () { return R.tableAll(t, t === 'participant_summary' ? 'participant_id' : 'created_at').then(function (rows) { raw[t] = rows; }); });
      }, Promise.resolve()).then(function () { return toSnapshot(schools, raw); });
    });
  }

  function cacheSnapshot(schoolId) {
    var db = MF.cache.db;
    return Promise.all([db.get('schools', schoolId), db.getAllByIndex('participants', 'school_id', schoolId)]).then(function (r) {
      var school = r[0], parts = r[1].filter(function (p) { return !p.archived && p._full; });
      var snap = { schools: school ? [school] : [], participants: parts };
      var ids = parts.map(function (p) { return p.id; });
      var jobs = T.SINGLES.map(function (t) { return Promise.all(ids.map(function (id) { return db.get(t, id); })).then(function (l) { snap[t] = l.filter(Boolean); }); })
        .concat(T.MANYS.map(function (t) { return Promise.all(ids.map(function (id) { return db.getAllByIndex(t, 'participant_id', id); })).then(function (l) { snap[t] = [].concat.apply([], l).filter(function (x) { return !x.deleted_at; }); }); }))
        .concat([Promise.all(ids.map(function (id) { return db.getAllByIndex('station_status', 'participant_id', id).then(function (rows) { return T.statusFromRows(id, rows); }); })).then(function (l) { snap.station_status = l; })]);
      return Promise.all(jobs).then(function () { return snap; });
    });
  }

  /* { snap, source: 'server' | 'cache', at } — offline only for a school prepared on this device */
  function snapshot(schoolId) {
    if (MF.net.online && MF.auth.canSync()) return serverSnapshot(schoolId).then(function (s) { return { snap: s, source: 'server' }; });
    if (!schoolId) return Promise.reject(MF.err.AppError('OFFLINE_EXPORT', 'تصدير جميع البيانات يتطلب اتصالًا بالإنترنت، لأن هذا الجهاز لا يحمل نسخة كاملة من قاعدة البيانات.'));
    return MF.ParticipantRepository.offlineReady(schoolId).then(function (meta) {
      if (!meta) throw MF.err.AppError('OFFLINE_EXPORT', 'لا يوجد اتصال، وبيانات هذه المدرسة غير مجهزة بالكامل على هذا الجهاز. اتصل بالإنترنت للتصدير من قاعدة البيانات، أو جهّز المدرسة للعمل دون اتصال مسبقًا.');
      return cacheSnapshot(schoolId).then(function (s) { return { snap: s, source: 'cache', at: meta.at }; });
    });
  }

  /* ---------- Administrator: full backup (includes names) ---------- */
  function fullBackup() {
    if (!MF.auth.isAdmin()) return Promise.reject(MF.err.AppError('NOT_ADMIN'));
    if (!MF.net.online) return Promise.reject(MF.err.AppError('OFFLINE_ACTION'));
    var data = {};
    var list = [['schools', 'number']].concat(TABLES.map(function (t) { return [t, t === 'participant_summary' ? 'participant_id' : 'created_at']; }), [['audit_log', 'performed_at']]);
    return list.reduce(function (pr, x) {
      return pr.then(function () { return (x[0] === 'schools' ? R.schools({}) : R.tableAll(x[0], x[1])).then(function (rows) { data[x[0]] = rows; }); });
    }, Promise.resolve()).then(function () {
      var obj = {
        format: MF.BACKUP_FORMAT, version: 2, phase: 2, app_version: MF.VERSION, exported_at: new Date().toISOString(),
        contains_names: true, questionnaire_version: 1, data: data
      };
      var blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
      return {
        blob: blob, filename: 'Myopia_Full-Backup_' + MF.dom.stamp() + '.json',
        summary: { schools: data.schools.length, participants: data.participants.length }
      };
    });
  }

  /* ---------- Administrator: import ---------- */
  function fromPhase1(clean) {
    var p = { schools: clean.schools, participants: clean.participants };
    T.SINGLES.forEach(function (t) { p[t] = clean[t] || []; });
    T.MANYS.forEach(function (t) { p[t] = clean[t] || []; });
    p.questionnaire_responses = p.questionnaire_responses.map(function (q) { return Object.assign({}, q, { questionnaire_version: 1, answers: q.answers || {} }); });
    p.station_status = [];
    (clean.station_status || []).forEach(function (st) {
      MF.STATIONS.forEach(function (s) {
        var x = st[s.key];
        if (x && x.state) p.station_status.push({ participant_id: st.participant_id, station: T.ST_TO_DB[s.key], status: x.state, completed_at: x.completed_at || null });
      });
    });
    return p;
  }

  function validatePhase2(obj) {
    var errors = [];
    if (!obj || obj.format !== MF.BACKUP_FORMAT || obj.version !== 2 || !obj.data) return { ok: false, errors: ['هذا الملف ليس نسخة احتياطية كاملة من النظام الإلكتروني.'] };
    var d = obj.data;
    ['schools', 'participants'].concat(T.SINGLES, T.MANYS, ['station_status']).forEach(function (t) {
      if (d[t] != null && !Array.isArray(d[t])) errors.push('الجدول «' + t + '» ليس قائمة.');
    });
    if (errors.length) return { ok: false, errors: errors };
    var payload = { schools: d.schools || [], participants: d.participants || [], station_status: d.station_status || [] };
    T.SINGLES.concat(T.MANYS).forEach(function (t) { payload[t] = d[t] || []; });
    return { ok: true, payload: payload, meta: { exported_at: obj.exported_at || null } };
  }

  /* parse + validate a chosen file: { ok, errors, kind: 'phase1'|'phase2', payload, meta, summary } */
  function readImportFile(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(fr.result || '')); } catch (e) { resolve({ ok: false, errors: ['الملف ليس JSON صالحًا.'] }); return; }
        if (obj && obj.version === 2) { var v2 = validatePhase2(obj); v2.kind = 'phase2'; resolve(v2); return; }
        var v1 = MF.BackupService.validate(obj);
        if (!v1.ok) { resolve(v1); return; }
        resolve({ ok: true, kind: 'phase1', payload: fromPhase1(v1.data), meta: v1.meta, summary: v1.summary });
      };
      fr.onerror = function () { resolve({ ok: false, errors: ['تعذّرت قراءة الملف.'] }); };
      fr.readAsText(file);
    });
  }

  /* split by school so each school imports as one database transaction */
  function bySchool(payload) {
    var partsBySchool = {};
    payload.participants.forEach(function (p) { (partsBySchool[p.school_id] = partsBySchool[p.school_id] || []).push(p); });
    return payload.schools.map(function (s) {
      var parts = partsBySchool[s.id] || [];
      var ids = {};
      parts.forEach(function (p) { ids[p.id] = true; });
      var chunk = { schools: [s], participants: parts };
      T.SINGLES.concat(T.MANYS, ['station_status']).forEach(function (t) { chunk[t] = (payload[t] || []).filter(function (r) { return ids[r.participant_id]; }); });
      return { school: s, payload: chunk };
    });
  }

  function importRun(parsed, dryRun) {
    var chunks = bySchool(parsed.payload);
    var total = { schools_new: 0, schools_matched: 0, participants_new: 0, participants_existing: 0, conflicts: [], failed: [] };
    return chunks.reduce(function (pr, c) {
      return pr.then(function () {
        return R.importData(c.payload, dryRun, parsed.kind).then(function (r) {
          total.schools_new += r.schools_new; total.schools_matched += r.schools_matched;
          total.participants_new += r.participants_new; total.participants_existing += r.participants_existing;
          total.conflicts = total.conflicts.concat(r.conflicts || []);
        }, function (err) {
          if (dryRun || err.network) throw err;
          total.failed.push({ school: c.school.number, message: MF.err.message(err) });
        });
      });
    }, Promise.resolve()).then(function () { return total; });
  }

  MF.DataService = {
    snapshot: snapshot,
    fullBackup: fullBackup,
    readImportFile: readImportFile,
    importDryRun: function (parsed) { return importRun(parsed, true); },
    importApply: function (parsed) { return importRun(parsed, false); },
    _fromPhase1: fromPhase1
  };
})();
