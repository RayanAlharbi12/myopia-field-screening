/* =====================================================================
   Remote data access — every call to Supabase goes through here.
   Returns plain rows; throws AppError (see errors.js). The database
   decides what each signed-in user may read or change (RLS + functions).
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, T = MF.tables;
  var PAGE = 1000;
  var PROFILE_COLS = 'id, email, full_name, role, active, must_change_password, created_at, updated_at, created_by, last_application_access';

  function sb() {
    if (!MF.sb) throw MF.err.AppError('SERVER_MISCONFIGURED');
    return MF.sb;
  }
  function fail(e) {
    var w = MF.err.wrap(e);
    MF.net.report(w);
    if (!w.network) MF.net.set(true);   /* the server answered, so we are online */
    throw w;
  }
  function run(builder) {
    return Promise.resolve().then(function () { return builder; }).then(function (res) {
      if (res.error) fail(res.error);
      MF.net.set(true);
      return res;
    }, fail);
  }
  function data(builder) { return run(builder).then(function (r) { return r.data; }); }
  function rpc(name, args) { return data(sb().rpc(name, args || {})); }

  /* read every page of a query (build(from, to) returns a fresh builder) */
  function all(build) {
    var out = [];
    function page(from) {
      return data(build(from, from + PAGE - 1)).then(function (rows) {
        out = out.concat(rows || []);
        if (rows && rows.length === PAGE) return page(from + PAGE);
        return out;
      });
    }
    return page(0);
  }
  function chunks(list, n) { var r = []; for (var i = 0; i < list.length; i += n) r.push(list.slice(i, i + n)); return r; }

  /* Arabic search normalisation — identical to mfs_normalize_ar() in the database */
  function normAr(t) {
    var from = 'أإآٱىةؤئ', to = 'اااايهوي';
    return String(t || '').replace(/[ً-ْٰـ]/g, '').split('').map(function (ch) {
      var i = from.indexOf(ch); return i >= 0 ? to[i] : ch;
    }).join('').toLowerCase();
  }
  /* characters with meaning in PostgREST filter syntax are removed from search text */
  function safeTerm(t) { return String(t || '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim(); }

  var R = MF.remote = {
    normAr: normAr,

    /* ---------- account ---------- */
    profile: function (uid) { return data(sb().from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle()); },
    touchAccess: function () { return rpc('touch_last_access'); },
    users: function () { return data(sb().from('profiles').select(PROFILE_COLS).order('created_at', { ascending: true })); },
    setUserRole: function (uid, role) { return rpc('admin_set_user_role', { p_user_id: uid, p_role: role }); },
    setUserName: function (uid, name) { return rpc('admin_update_user_name', { p_user_id: uid, p_full_name: name }); },
    invoke: function (name, body) {
      return Promise.resolve().then(function () { return sb().functions.invoke(name, { body: body }); }).then(function (res) {
        if (res.error) return MF.err.fromFunction(res.error).then(function (e) { MF.net.report(e); throw e; });
        MF.net.set(true);
        if (res.data && res.data.error) throw MF.err.AppError(res.data.error.code || 'SERVER_ERROR');
        return res.data;
      }, fail);
    },

    /* ---------- schools ---------- */
    schools: function (opts) {
      opts = opts || {};
      var q = sb().from('schools').select('*').order('number', { ascending: true });
      if (opts.archived === true) q = q.eq('archived', true);
      else if (opts.archived === false) q = q.eq('archived', false);
      return data(q);
    },
    school: function (id) { return data(sb().from('schools').select('*').eq('id', id).maybeSingle()); },
    schoolStats: function () { return rpc('school_stats'); },
    createSchool: function (name, city, type) { return rpc('create_school', { p_name: name, p_city: city, p_type: type }); },
    updateSchool: function (id, name, city, type) { return rpc('update_school', { p_school_id: id, p_name: name, p_city: city, p_type: type }); },
    setSchoolArchived: function (id, archived) { return rpc('set_school_archived', { p_school_id: id, p_archived: archived }); },
    counterInfo: function (id) { return rpc('school_counter_info', { p_school_id: id }); },
    setCounter: function (id, next, reset) { return rpc('set_next_participant_number', { p_school_id: id, p_next: next, p_reset: !!reset }); },

    /* ---------- participants ---------- */
    /* one page of a school's list: { rows, total }. filter: all | draft | completed | referral */
    listParticipants: function (schoolId, o) {
      o = o || {};
      var q = sb().from('participant_list').select('*', { count: 'exact' }).eq('school_id', schoolId).eq('archived', !!o.archived);
      if (o.filter === 'draft') q = q.neq('status', 'completed');
      else if (o.filter === 'completed') q = q.eq('status', 'completed');
      else if (o.filter === 'referral') q = q.eq('referral_alert', true);
      var term = safeTerm(MF.dom.normalizeDigits(o.search || ''));
      if (term) {
        if (/^\d+$/.test(term)) q = q.or('code.like.' + term + '%,seq.eq.' + term);
        else if (/^\d+-\d*$/.test(term)) q = q.like('code', term + '%');
        else q = q.ilike('name_search', '%' + normAr(term) + '%');
      }
      q = q.order('seq', { ascending: true }).range(o.offset || 0, (o.offset || 0) + (o.limit || 100) - 1);
      return run(q).then(function (r) { return { rows: (r.data || []).map(T.participantFromListRow), total: r.count || 0 }; });
    },
    /* every active (or archived) participant id of a school, for offline preparation */
    participantIds: function (schoolId, archived) {
      return all(function (a, b) { return sb().from('participants').select('id').eq('school_id', schoolId).eq('archived', !!archived).order('seq').range(a, b); })
        .then(function (rows) { return rows.map(function (r) { return r.id; }); });
    },
    createParticipant: function (schoolId) { return rpc('create_participant', { p_school_id: schoolId }); },
    changeSeq: function (pid, seq) { return rpc('change_participant_seq', { p_participant_id: pid, p_new_seq: seq }); },
    setParticipantArchived: function (pid, archived) { return rpc('set_participant_archived', { p_participant_id: pid, p_archived: archived }); },
    archivedParticipants: function () {
      return all(function (a, b) { return sb().from('participant_list').select('*').eq('archived', true).order('updated_at', { ascending: false }).range(a, b); })
        .then(function (rows) { return rows.map(T.participantFromListRow); });
    },

    /* everything of one participant: raw rows keyed by table */
    bundleRows: function (pid) {
      var c = sb();
      var jobs = [
        data(c.from('participants').select('*').eq('id', pid).maybeSingle()),
        data(c.from('participant_summary').select('*').eq('participant_id', pid).maybeSingle()),
        data(c.from('station_status').select('*').eq('participant_id', pid))
      ].concat(T.SINGLES.map(function (t) { return data(c.from(t).select('*').eq('participant_id', pid).maybeSingle()); }))
        .concat(T.MANYS.map(function (t) { return data(c.from(t).select('*').eq('participant_id', pid).order('created_at', { ascending: true })); }));
      return Promise.all(jobs).then(function (r) {
        if (!r[0]) return null;
        var out = { participants: r[0], participant_summary: r[1], station_status: r[2] || [] }, i = 3;
        T.SINGLES.forEach(function (t) { out[t] = r[i++]; });
        T.MANYS.forEach(function (t) { out[t] = r[i++] || []; });
        return data(c.from('schools').select('*').eq('id', r[0].school_id).maybeSingle()).then(function (s) { out.school = s; return out; });
      });
    },
    /* the same rows for many participants at once (offline preparation, export) */
    rowsFor: function (table, ids, extra) {
      var col = table === 'participants' ? 'id' : 'participant_id';
      return chunks(ids, 150).reduce(function (pr, part) {
        return pr.then(function (acc) {
          return all(function (a, b) {
            var q = sb().from(table).select('*').in(col, part);
            if (extra) q = extra(q);
            return q.order(col).range(a, b);
          }).then(function (rows) { return acc.concat(rows); });
        });
      }, Promise.resolve([]));
    },
    tableAll: function (table, orderCol) {
      return all(function (a, b) { return sb().from(table).select('*').order(orderCol || 'created_at', { ascending: true }).range(a, b); });
    },

    /* ---------- field changes (optimistic versioning) ---------- */
    updateVersioned: function (table, pkCol, pk, patch, baseVersion) {
      return data(sb().from(table).update(patch).eq(pkCol, pk).eq('version', baseVersion).select());
    },
    getRow: function (table, pkCol, pk) { return data(sb().from(table).select('*').eq(pkCol, pk).maybeSingle()); },
    getEom: function (pid, eye, muscle) { return data(sb().from('eom_findings').select('*').eq('participant_id', pid).eq('eye', eye).eq('muscle', muscle).maybeSingle()); },
    insertRow: function (table, row) { return data(sb().from(table).insert(row).select().single()); },
    patchAnswers: function (pid, version, set, unset) { return rpc('patch_questionnaire', { p_participant_id: pid, p_expected_version: version, p_set: set, p_unset: unset }); },
    touchStation: function (pid, station, status, completedAt) {
      return rpc('touch_station', { p_participant_id: pid, p_station: station, p_status: status, p_completed_at: completedAt || null });
    },

    /* ---------- administration ---------- */
    audit: function (o) {
      o = o || {};
      var q = sb().from('audit_log').select('*', { count: 'exact' }).order('performed_at', { ascending: false });
      if (o.prefix) q = q.like('action', safeTerm(o.prefix) + '%');
      q = q.range(o.offset || 0, (o.offset || 0) + (o.limit || 50) - 1);
      return run(q).then(function (r) { return { rows: r.data || [], total: r.count || 0 }; });
    },
    importData: function (payload, dryRun, source) { return rpc('admin_import', { p_payload: payload, p_dry_run: !!dryRun, p_source: source }); }
  };
})();
