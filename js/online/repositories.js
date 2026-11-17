/* =====================================================================
   Phase 2 repositories. Same names and methods the screens already use
   (SchoolRepository, ParticipantRepository, SettingsRepository), now backed
   by Supabase as the source of truth with the per-user cache for offline
   reading and editing. Administrative actions and new participants need a
   connection (the server allocates numbers and checks permissions).
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, T = MF.tables, R = MF.remote;

  function online() { return MF.net.online && MF.auth.canSync(); }
  function needOnline(code) { if (!online()) throw MF.err.AppError(code || 'OFFLINE_ACTION'); }
  function cdb() { return MF.cache.db; }
  function code(schoolNumber, seq) { return schoolNumber + '-' + seq; }

  /* try the server; on a lost connection use the cache (and say so) */
  function serverOr(fromServer, fromCache) {
    if (!online()) return Promise.resolve(fromCache()).then(function (v) { return { value: v, source: 'cache' }; });
    return fromServer().then(function (v) { return { value: v, source: 'server' }; }, function (err) {
      if (err && err.network) return Promise.resolve(fromCache()).then(function (v) { return { value: v, source: 'cache' }; });
      throw err;
    });
  }

  /* ---------- schools ---------- */
  var Schools = MF.SchoolRepository = {
    list: function (opts) {
      opts = opts || {};
      return serverOr(function () {
        return R.schools({ archived: opts.includeArchived ? undefined : false }).then(function (rows) {
          return MF.sync.applyRemote('schools', rows, 'load').then(function () { return rows; });
        });
      }, function () {
        return cdb() ? cdb().getAll('schools').then(function (rows) {
          return rows.filter(function (s) { return opts.includeArchived || !s.archived; }).sort(function (a, b) { return a.number - b.number; });
        }) : [];
      });
    },
    archived: function () { needOnline(); return R.schools({ archived: true }); },
    get: function (id) {
      return serverOr(function () {
        return R.school(id).then(function (s) { return s ? MF.sync.applyRemote('schools', [s], 'load').then(function () { return s; }) : null; });
      }, function () { return cdb() ? cdb().get('schools', id).then(function (s) { return s || null; }) : null; });
    },
    /* canonical counts from the server; offline: counted from this device's copy */
    stats: function () {
      return serverOr(function () {
        return R.schoolStats().then(function (rows) {
          var m = {};
          (rows || []).forEach(function (r) { m[r.school_id] = { total: r.total, draft: r.draft, completed: r.completed, referral: r.referral }; });
          return m;
        });
      }, function () {
        return cdb() ? cdb().getAll('participants').then(function (parts) {
          var m = {};
          parts.forEach(function (p) {
            if (p.archived) return;
            var c = m[p.school_id] = m[p.school_id] || { total: 0, draft: 0, completed: 0, referral: 0 };
            c.total++;
            if (p.status === 'completed') c.completed++; else c.draft++;
            if (p.summary && p.summary.referral_alert) c.referral++;
          });
          return m;
        }) : {};
      });
    },
    create: function (input) {
      var name = String(input.name || '').trim(), city = String(input.city || '').trim(), type = input.type;
      if (!name) return Promise.reject(MF.repos.RuleError('NAME_REQUIRED', 'اسم المدرسة مطلوب.'));
      if (!city) return Promise.reject(MF.repos.RuleError('CITY_REQUIRED', 'المدينة مطلوبة.'));
      if (type !== 'boys' && type !== 'girls') return Promise.reject(MF.repos.RuleError('TYPE_REQUIRED', 'اختر نوع المدرسة.'));
      return Promise.resolve().then(function () { needOnline(); return R.createSchool(name, city, type); }).then(function (s) {
        return MF.sync.applyRemote('schools', [s], 'load').then(function () { return s; });
      });
    },
    update: function (id, patch) {
      return Promise.resolve().then(function () { needOnline(); return R.updateSchool(id, patch.name, patch.city, patch.type); }).then(function (s) {
        return MF.sync.applyRemote('schools', [s], 'load').then(function () { return s; });
      });
    },
    setArchived: function (id, archived) {
      return Promise.resolve().then(function () { needOnline(); return R.setSchoolArchived(id, !!archived); }).then(function (s) {
        return MF.sync.applyRemote('schools', [s], 'load').then(function () { return s; });
      });
    }
  };

  /* ---------- participant counter (Administrator) ---------- */
  MF.SettingsRepository = {
    participantCounter: function (schoolId) {
      return Promise.resolve().then(function () { needOnline(); return R.counterInfo(schoolId); }).then(function (c) {
        return { next: c.next, lastAssigned: c.last_assigned, highestUsed: c.highest_used, usedSeqs: c.used_seqs || [] };
      });
    },
    setNextParticipantNumber: function (schoolId, next) {
      next = parseInt(next, 10);
      if (!(next >= 1 && next <= 99999)) return Promise.reject(MF.repos.RuleError('RANGE', 'أدخل رقمًا صحيحًا من 1 إلى 99999.'));
      return Promise.resolve().then(function () { needOnline(); return R.setCounter(schoolId, next, false); });
    },
    resetParticipantCounter: function (schoolId) { return Promise.resolve().then(function () { needOnline(); return R.setCounter(schoolId, 1, true); }); }
  };

  /* ---------- participants ---------- */
  function cachedPage(schoolId, o) {
    if (!cdb()) return { rows: [], total: 0 };
    return cdb().getAllByIndex('participants', 'school_id', schoolId).then(function (rows) {
      var q = MF.dom.normalizeDigits(String(o.search || '')).trim(), qn = R.normAr(q);
      var list = rows.filter(function (p) {
        if (!!p.archived !== !!o.archived) return false;
        if (o.filter === 'draft' && p.status === 'completed') return false;
        if (o.filter === 'completed' && p.status !== 'completed') return false;
        if (o.filter === 'referral' && !(p.summary && p.summary.referral_alert)) return false;
        if (!q) return true;
        return String(p.code).indexOf(q) === 0 || String(p.seq) === q || R.normAr(p.name).indexOf(qn) >= 0;
      }).sort(function (a, b) { return a.seq - b.seq; });
      var off = o.offset || 0, lim = o.limit || 100;
      return { rows: list.slice(off, off + lim), total: list.length };
    });
  }

  var Parts = MF.ParticipantRepository = {
    code: code,
    /* one page of the school list: { rows, total, source } */
    page: function (schoolId, o) {
      o = o || {};
      return serverOr(function () {
        return R.listParticipants(schoolId, o).then(function (res) {
          var light = res.rows.map(function (p) { var c = Object.assign({}, p); delete c.version; return c; });
          return cacheLight(light).then(function () { return res; });
        });
      }, function () { return cachedPage(schoolId, o); }).then(function (r) { r.value.source = r.source; return r.value; });
    },

    /* + إضافة مشارك — online only: the server reserves the next number atomically */
    create: function (schoolId) {
      if (!online()) return Promise.reject(MF.err.AppError('OFFLINE_CREATE'));
      return R.createParticipant(schoolId).then(function (p) {
        return MF.sync.applyRemote('participants', [p], 'load').then(function () { return p; });
      }, function (err) {
        if (err.code === 'DUPLICATE_ID') err.data = { code: err.detail || '' };
        throw err;
      });
    },
    changeSequence: function (pid, newSeq) {
      newSeq = parseInt(newSeq, 10);
      if (!(newSeq >= 1 && newSeq <= 99999)) return Promise.reject(MF.repos.RuleError('RANGE', 'أدخل رقمًا صحيحًا من 1 إلى 99999.'));
      return Promise.resolve().then(function () { needOnline(); return R.changeSeq(pid, newSeq); }).then(function (p) {
        return MF.sync.applyRemote('participants', [p], 'load').then(function () { return p; });
      });
    },
    setArchived: function (pid, archived) {
      return Promise.resolve().then(function () { needOnline(); return R.setParticipantArchived(pid, !!archived); }).then(function (p) {
        return MF.sync.applyRemote('participants', [p], 'load').then(function () { return p; });
      });
    },
    /* used numbers of a school (Administrator: edit ID dialog) */
    usedSeqs: function (schoolId) { return MF.SettingsRepository.participantCounter(schoolId).then(function (c) { return c.usedSeqs; }); },

    /* everything of one participant for the working form, or null; .source tells where it came from */
    loadBundle: function (pid) {
      return serverOr(function () {
        return R.bundleRows(pid).then(function (rows) { return rows ? storeBundle(rows).then(function () { return true; }) : false; });
      }, function () { return null; }).then(function (r) {
        if (r.source === 'server' && r.value === false) return null;
        return MF.cache.bundle(pid).then(function (cb) {
          if (!cb) { if (r.source === 'cache') { var e = MF.err.AppError('NOT_CACHED', 'هذا المشارك غير محفوظ على هذا الجهاز، ولا يوجد اتصال بالإنترنت لتحميله.'); throw e; } return null; }
          var b = toSessionBundle(cb);
          b.source = r.source;
          return b;
        });
      });
    },

    /* download a whole school's records so they can be opened and edited without a connection */
    prepareOffline: function (schoolId, onProgress) {
      needOnline();
      var tables = ['participants', 'participant_summary', 'station_status'].concat(T.SINGLES, T.MANYS);
      return R.participantIds(schoolId, false).then(function (ids) {
        var done = 0;
        return tables.reduce(function (pr, t) {
          return pr.then(function () {
            return R.rowsFor(t, ids).then(function (rows) {
              return MF.sync.applyRemote(t, rows, 'prefetch');
            }).then(function () { done++; if (onProgress) onProgress(done / tables.length); });
          });
        }, Promise.resolve()).then(function () { return markFull(ids); }).then(function () {
          return MF.cache.setMeta('school_full:' + schoolId, { at: new Date().toISOString(), count: ids.length });
        }).then(function () { return ids.length; });
      });
    },
    offlineReady: function (schoolId) { return MF.cache.meta('school_full:' + schoolId); }
  };

  function cacheLight(rows) {
    if (!cdb() || !rows.length) return Promise.resolve();
    return cdb().transaction(['participants'], function (tx) {
      return Promise.all(rows.map(function (p) {
        return tx.get('participants', p.id).then(function (old) {
          var merged = Object.assign({}, old || {}, p);
          if (old && old._full) merged._full = true;
          if (old && old.version != null) merged.version = old.version;
          return tx.put('participants', merged);
        });
      }));
    });
  }

  function markFull(ids) {
    return cdb().transaction(['participants'], function (tx) {
      return Promise.all(ids.map(function (id) {
        return tx.get('participants', id).then(function (p) { if (p) { p._full = true; return tx.put('participants', p); } });
      }));
    });
  }

  function storeBundle(rows) {
    var p = rows.participants;
    var jobs = [
      ['schools', rows.school ? [rows.school] : []],
      ['participants', [p]],
      ['participant_summary', rows.participant_summary ? [rows.participant_summary] : []],
      ['station_status', rows.station_status]
    ];
    T.SINGLES.forEach(function (t) { if (rows[t]) jobs.push([t, [rows[t]]]); });
    T.MANYS.forEach(function (t) { jobs.push([t, rows[t]]); });
    return jobs.reduce(function (pr, j) { return pr.then(function () { return MF.sync.applyRemote(j[0], j[1], 'load'); }); }, Promise.resolve())
      .then(function () { return markFull([p.id]); });
  }

  function toSessionBundle(cb) {
    var b = { participant: cb.participant, school: cb.school };
    T.SINGLES.forEach(function (t) { b[t] = cb[t]; });
    T.MANYS.forEach(function (t) { b[t] = (cb[t] || []).filter(function (r) { return !r.deleted_at; }); });
    b.station_status = T.statusFromRows(cb.participant.id, cb._statusRows);
    if (b.questionnaire_responses && !b.questionnaire_responses.answers) b.questionnaire_responses.answers = {};
    return b;
  }
  Parts._toSessionBundle = toSessionBundle;
})();
