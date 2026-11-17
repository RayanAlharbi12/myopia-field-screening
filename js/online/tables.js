/* =====================================================================
   Database table metadata used by the cache, the sync engine and export:
   which columns the application may write, primary keys, and the mapping
   between the approved Phase 1 station keys and the database station names.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  var T = {
    participants: { pk: 'id', cols: ['name'], versioned: true },
    registration: {
      pk: 'participant_id', single: true, station: 'registration', versioned: true,
      cols: ['age', 'gender', 'class_level', 'glasses', 'glasses_reasons', 'glasses_reason_other', 'oc_disease', 'oc_surgery', 'oc_med',
        'family_size', 'birth_order', 'next_sibling_no', 'fam_glasses', 'fam_disease', 'fam_surgery', 'sys_self', 'sys_family',
        'symptoms_gate', 'symptoms', 'blurry_loc', 'symptom_other', 'ant_status', 'ant_lids_od', 'ant_lids_os', 'ant_cornea_od',
        'ant_cornea_os', 'ant_pupil_od', 'ant_pupil_os']
    },
    autorefraction: { pk: 'participant_id', single: true, station: 'autoref', versioned: true, cols: ['od_sph', 'od_cyl', 'od_axis', 'os_sph', 'os_cyl', 'os_axis'] },
    strabismus: {
      pk: 'participant_id', single: true, station: 'strabismus', versioned: true,
      cols: ['dist_test', 'dist_phoria', 'dist_phoria_other', 'dist_pattern', 'dist_eye', 'dist_freq', 'dist_type', 'dist_type_other',
        'near_test', 'near_phoria', 'near_phoria_other', 'near_pattern', 'near_eye', 'near_freq', 'near_type', 'near_type_other', 'eom_status']
    },
    visual_acuity: {
      pk: 'participant_id', single: true, station: 'va', versioned: true,
      cols: ['vasc_od', 'vasc_os', 'vasc_ou', 'vacc_od', 'vacc_os', 'vacc_ou', 'ph_od', 'ph_os', 'plus_od', 'plus_os', 'cause', 'ambly_lat', 'ambly_eye', 'cause_other']
    },
    questionnaire_responses: { pk: 'participant_id', single: true, station: 'questionnaire', versioned: true, answers: true, cols: ['answers'] },
    family_members: {
      pk: 'id', many: true, station: 'registration', versioned: true, softDelete: true,
      insertCols: ['id', 'participant_id', 'relation', 'key'],
      cols: ['sex', 'older', 'birth_order', 'glasses', 'glasses_type', 'sel_disease', 'sel_surgery', 'sel_systemic', 'deleted_at']
    },
    ocular_history_entries: {
      pk: 'id', many: true, station: 'registration', versioned: true, softDelete: true,
      insertCols: ['id', 'participant_id', 'kind'],
      cols: ['subtype', 'name', 'reason', 'eye', 'when_kind', 'when', 'ongoing', 'stop_kind', 'stop_when', 'deleted_at']
    },
    systemic_history_entries: { pk: 'id', many: true, station: 'registration', versioned: true, softDelete: true, insertCols: ['id', 'participant_id'], cols: ['name', 'details', 'deleted_at'] },
    family_history_entries: {
      pk: 'id', many: true, station: 'registration', versioned: true, softDelete: true,
      insertCols: ['id', 'participant_id', 'member_id', 'kind'], cols: ['name', 'when', 'details', 'deleted_at']
    },
    /* no soft delete: one row per eye + muscle; "removing" a finding clears it */
    eom_findings: {
      pk: 'id', many: true, station: 'strabismus', versioned: true,
      insertCols: ['id', 'participant_id', 'eye', 'muscle'], cols: ['grade', 'note', 'selected'],
      cleared: { selected: false, grade: null, note: null }
    }
  };
  var SINGLES = ['registration', 'autorefraction', 'strabismus', 'visual_acuity', 'questionnaire_responses'];
  var MANYS = ['family_members', 'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'eom_findings'];

  /* approved station keys (Phase 1, used by the interface) <-> database station names */
  var ST_TO_DB = { registration: 'registration', autoref: 'autorefraction', strabismus: 'strabismus_eom', va: 'visual_acuity', questionnaire: 'questionnaire' };
  var ST_FROM_DB = {};
  Object.keys(ST_TO_DB).forEach(function (k) { ST_FROM_DB[ST_TO_DB[k]] = k; });

  /* station_status rows -> the in-memory shape used by the clinical logic */
  function statusFromRows(pid, rows) {
    var st = { participant_id: pid };
    MF.STATIONS.forEach(function (s) { st[s.key] = { state: 'not_started', updated_at: null, completed_at: null }; });
    (rows || []).forEach(function (r) {
      var k = ST_FROM_DB[r.station];
      if (k) st[k] = { state: r.status, updated_at: r.updated_at || null, completed_at: r.completed_at || null };
    });
    return st;
  }

  /* participant row + summary row -> the participant record the screens use */
  function participantFromRows(p, sum) {
    var out = {};
    Object.keys(p).forEach(function (k) { out[k] = p[k]; });
    if (sum) {
      out.summary = {
        age: sum.age, gender: sum.gender, class_level: sum.class_level,
        current_station: ST_FROM_DB[sum.current_station] || null,
        referral_alert: !!sum.referral_alert, referral_va: !!sum.referral_va, referral_re: !!sum.referral_re
      };
      out.status = sum.status === 'completed' ? 'completed' : 'draft';
    }
    if (!out.summary) out.summary = { age: null, gender: null, class_level: null, current_station: 'registration', referral_alert: false, referral_va: false, referral_re: false };
    if (!out.status) out.status = 'draft';
    return out;
  }

  /* participant_list view row (participant + summary columns side by side) */
  function participantFromListRow(r) {
    return participantFromRows({
      id: r.id, school_id: r.school_id, seq: r.seq, code: r.code, name: r.name, archived: r.archived,
      archived_at: r.archived_at, updated_at: r.updated_at, version: r.version
    }, r);
  }

  function pick(rec, cols) {
    var o = {};
    cols.forEach(function (c) { if (rec[c] !== undefined) o[c] = rec[c]; });
    return o;
  }

  function same(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
  }

  MF.TABLES = T;
  MF.tables = {
    SINGLES: SINGLES, MANYS: MANYS, ST_TO_DB: ST_TO_DB, ST_FROM_DB: ST_FROM_DB,
    statusFromRows: statusFromRows, participantFromRows: participantFromRows, participantFromListRow: participantFromListRow,
    pick: pick, same: same
  };
})();
