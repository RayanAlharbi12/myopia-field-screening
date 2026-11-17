/* =====================================================================
   ExportService — research workbook (.xlsx): Participants, Family, Questionnaire.
   Read-only: it reads one database snapshot and never writes.
   The participant name is never exported (de-identified research file).

   Cell conventions (Participants / Family):
     "Not tested"      a clinical test that was not performed
     "Not answered"    a registration question left unanswered
     "Not applicable"  a follow-up whose condition is not met (e.g. VAcc without glasses)
   Questionnaire sheet: Arabic answers; an unanswered question is an empty cell.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, O = MF.OPT, F = MF.fmt, C = MF.clinical, FAM = MF.family, Q = MF.QUESTIONNAIRE;

  var NT = 'Not tested', NA = 'Not applicable', NANS = 'Not answered';
  var SEP = ' | ', DASH = ' — ';

  function txt(v) { return String(v == null ? '' : v).trim(); }
  function when(kind, v) {
    v = txt(v);
    if (!v) return '';
    return kind === 'age' ? 'age ' + v : v;
  }
  function join(parts) { return parts.filter(function (x) { return x; }).join(DASH); }
  function yesNo(b) { return b ? 'Yes' : 'No'; }
  function opt(set, v, missing) { var o = O.find(set, v); return o ? o.en : (missing || NANS); }
  function gateCell(gate, list) {
    if (gate === 'no') return 'No';
    if (gate === 'yes') return list.length ? list.join(SEP) : 'Yes';
    return NANS;
  }
  function powerCell(v) { return F.isNum(v) ? v : NT; }
  function axisCell(v) { return F.isNum(v) ? v : NT; }
  function vaCell(v) { return v || NT; }

  /* ---------- per participant context ---------- */
  function contexts(snap, schoolId) {
    var schools = {}, byP = {};
    snap.schools.forEach(function (s) { schools[s.id] = s; });
    function group(store) {
      var m = {};
      snap[store].forEach(function (r) { (m[r.participant_id] = m[r.participant_id] || []).push(r); });
      return m;
    }
    function index(store) { var m = {}; snap[store].forEach(function (r) { m[r.participant_id] = r; }); return m; }
    var fam = group('family_members'), oc = group('ocular_history_entries'), sys = group('systemic_history_entries'),
      fh = group('family_history_entries'), eom = group('eom_findings');
    var reg = index('registration'), ar = index('autorefraction'), st = index('strabismus'), va = index('visual_acuity'),
      q = index('questionnaire_responses'), ss = index('station_status');
    return snap.participants.filter(function (p) {
      var s = schools[p.school_id];
      if (!s || p.archived) return false;
      if (schoolId) return p.school_id === schoolId;
      return !s.archived;
    }).sort(function (a, b) {
      return schools[a.school_id].number - schools[b.school_id].number || a.seq - b.seq;
    }).map(function (p) {
      var id = p.id;
      return {
        participant: p, school: schools[p.school_id], registration: reg[id] || {}, family_members: fam[id] || [],
        ocular_history_entries: (oc[id] || []).slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }),
        systemic_history_entries: (sys[id] || []).slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }),
        family_history_entries: (fh[id] || []).slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }),
        autorefraction: ar[id] || {}, strabismus: st[id] || {}, eom_findings: eom[id] || [], visual_acuity: va[id] || {},
        questionnaire_responses: q[id] || { answers: {} }, station_status: ss[id] || null
      };
    });
  }

  /* ---------- Participants sheet ---------- */
  function ocularList(b, kind) {
    return b.ocular_history_entries.filter(function (e) { return e.kind === kind && txt(e.name); }).map(function (e) {
      if (kind === 'disease_injury') {
        return opt('diseaseKind', e.subtype, 'Disease/Injury') + ': ' + join([txt(e.name), O.en('eye4', e.eye), when(e.when_kind, e.when)]);
      }
      if (kind === 'surgery') return join([txt(e.name), O.en('eye3', e.eye), when(e.when_kind, e.when)]);
      var name = txt(e.name) + (txt(e.reason) ? ' (' + txt(e.reason) + ')' : '');
      var started = when(e.when_kind, e.when);
      var state = e.ongoing === 'yes' ? 'Ongoing' : e.ongoing === 'no' ? ('Stopped' + (when(e.stop_kind, e.stop_when) ? ': ' + when(e.stop_kind, e.stop_when) : '')) : '';
      return join([name, O.en('eye3', e.eye), started ? 'Started: ' + started : '', state]);
    });
  }
  function coverCols(st, side) {
    var f = C.coverFlow(st, side);
    var test = f.test ? O.en('coverTest', f.test) : NT;
    var phoria = NA, pattern = NA, eye = NA, freq = NA, type = NA;
    if (f.phoria) phoria = st[side + '_phoria'] === 'other' ? 'Other: ' + (txt(st[side + '_phoria_other']) || NANS) : opt('phoriaType', st[side + '_phoria']);
    if (f.tropia) {
      var pat = st[side + '_pattern'];
      pattern = opt('tropiaPattern', pat);
      eye = pat === 'unilateral' ? (st[side + '_eye'] || NANS) : (pat === 'alternating' ? NA : NANS);
      freq = opt('tropiaFrequency', st[side + '_freq']);
      type = st[side + '_type'] === 'other' ? 'Other: ' + (txt(st[side + '_type_other']) || NANS) : opt('tropiaType', st[side + '_type']);
    }
    return [test, phoria, pattern, eye, freq, type];
  }
  function eomFindings(b) {
    var st = b.strabismus;
    if (st.eom_status !== 'abnormal') return NA;
    var order = O.muscles.map(function (m) { return m.v; });
    var list = b.eom_findings.filter(function (x) { return x.selected; }).sort(function (a, c) {
      return (a.eye === c.eye ? 0 : a.eye === 'OD' ? -1 : 1) || order.indexOf(a.muscle) - order.indexOf(c.muscle);
    }).map(function (x) {
      var m = O.muscles.filter(function (mm) { return mm.v === x.muscle; })[0];
      var g = x.grade == null ? 'grade not recorded' : (x.grade > 0 ? '+' + x.grade : String(x.grade));
      return x.eye + ' ' + (m ? m.en : x.muscle) + ' ' + g + (txt(x.note) ? ' (' + txt(x.note) + ')' : '');
    });
    return list.length ? list.join(SEP) : NANS;
  }
  function stationCell(b, key) { return MF.STATION_STATES[C.stationState(b.station_status, key)].en; }

  var PCOLS = [
    ['School_Number', 'int', function (b) { return b.school.number; }],
    ['School_Name', 'text', function (b) { return b.school.name; }],
    ['City', 'text', function (b) { return b.school.city; }],
    ['School_Type', 'text', function (b) { return opt('schoolType', b.school.type); }],
    ['Participant_ID', 'text', function (b) { return b.participant.code; }],
    ['Age', 'int', function (b) { var a = parseInt(b.registration.age, 10); return isFinite(a) ? a : NANS; }],
    ['Gender', 'text', function (b) { return opt('gender', b.registration.gender); }],
    ['Class', 'int', function (b) { var c = b.registration.class_level; return c ? c : NANS; }],
    ['Glasses_Status', 'text', function (b) { return opt('glasses', b.registration.glasses); }],
    ['Glasses_Not_Currently_Worn_Reasons', 'text', function (b) {
      var r = b.registration;
      if (r.glasses !== 'yes_not_now') return NA;
      var list = (r.glasses_reasons || []).slice().sort(function (a, c) {
        var o = O.glassesReasons.map(function (x) { return x.v; }); return o.indexOf(a) - o.indexOf(c);
      }).map(function (v) { return v === 'other' ? 'Other: ' + (txt(r.glasses_reason_other) || NANS) : O.en('glassesReasons', v); });
      return list.length ? list.join(SEP) : NANS;
    }],
    ['Ocular_Disease_Injury_History', 'text', function (b) { return gateCell(b.registration.oc_disease, ocularList(b, 'disease_injury')); }],
    ['Ocular_Surgery_History', 'text', function (b) { return gateCell(b.registration.oc_surgery, ocularList(b, 'surgery')); }],
    ['Ocular_Medication_History', 'text', function (b) { return gateCell(b.registration.oc_med, ocularList(b, 'medication')); }],
    ['Participant_Systemic_History', 'text', function (b) {
      return gateCell(b.registration.sys_self, b.systemic_history_entries.filter(function (e) { return txt(e.name); }).map(function (e) {
        return txt(e.name) + (txt(e.details) ? ' (' + txt(e.details) + ')' : '');
      }));
    }],
    ['Symptoms', 'text', function (b) {
      var r = b.registration;
      if (r.symptoms_gate !== 'yes') return r.symptoms_gate === 'no' ? 'No' : NANS;
      var sel = r.symptoms || [];
      var list = O.symptoms.filter(function (s) { return sel.indexOf(s.v) >= 0; }).map(function (s) {
        return s.v === 'other' ? 'Other: ' + (txt(r.symptom_other) || NANS) : s.en;
      });
      return list.length ? list.join(SEP) : 'Yes';
    }],
    ['Blurry_Vision_Location', 'text', function (b) {
      var r = b.registration;
      if (r.symptoms_gate !== 'yes' || (r.symptoms || []).indexOf('blurry') < 0) return NA;
      var loc = r.blurry_loc || [];
      var list = O.blurryLocation.filter(function (x) { return loc.indexOf(x.v) >= 0; }).map(function (x) { return x.en; });
      return list.length ? list.join(SEP) : NANS;
    }],
    ['Anterior_Segment_Status', 'text', function (b) { return opt('anterior', b.registration.ant_status || null, NT); }],
    ['Anterior_Segment_Findings', 'text', function (b) {
      var r = b.registration;
      if (r.ant_status !== 'abnormal') return NA;
      var out = [];
      O.anteriorStructures.forEach(function (s) {
        ['od', 'os'].forEach(function (e) {
          var v = txt(r['ant_' + s.v + '_' + e]);
          if (v) out.push(e.toUpperCase() + ' ' + s.en + ': ' + v);
        });
      });
      return out.length ? out.join(SEP) : NANS;
    }],
    ['Autoref_OD_Sphere', 'power', function (b) { return powerCell(b.autorefraction.od_sph); }],
    ['Autoref_OD_Cylinder', 'power', function (b) { return powerCell(b.autorefraction.od_cyl); }],
    ['Autoref_OD_Axis', 'int', function (b) { return axisCell(b.autorefraction.od_axis); }],
    ['Autoref_OS_Sphere', 'power', function (b) { return powerCell(b.autorefraction.os_sph); }],
    ['Autoref_OS_Cylinder', 'power', function (b) { return powerCell(b.autorefraction.os_cyl); }],
    ['Autoref_OS_Axis', 'int', function (b) { return axisCell(b.autorefraction.os_axis); }]
  ];
  ['Distance', 'Near'].forEach(function (side) {
    var k = side === 'Distance' ? 'dist' : 'near';
    ['_Cover_Test', '_Phoriatype', '_Tropia_Pattern', '_Tropia_Eye', '_Tropia_Frequency', '_Tropia_Type'].forEach(function (suf, i) {
      PCOLS.push([side + suf, 'text', function (b) { return coverCols(b.strabismus, k)[i]; }]);
    });
  });
  PCOLS = PCOLS.concat([
    ['EOM_Status', 'text', function (b) { return opt('eomStatus', b.strabismus.eom_status || null, NT); }],
    ['EOM_Findings', 'text', eomFindings],
    ['VAsc_OD', 'text', function (b) { return vaCell(b.visual_acuity.vasc_od); }],
    ['VAsc_OS', 'text', function (b) { return vaCell(b.visual_acuity.vasc_os); }],
    ['VAsc_OU', 'text', function (b) { return vaCell(b.visual_acuity.vasc_ou); }],
    ['VAcc_OD', 'text', function (b) { return C.vaccApplicable(b.registration) ? vaCell(b.visual_acuity.vacc_od) : NA; }],
    ['VAcc_OS', 'text', function (b) { return C.vaccApplicable(b.registration) ? vaCell(b.visual_acuity.vacc_os) : NA; }],
    ['VAcc_OU', 'text', function (b) { return C.vaccApplicable(b.registration) ? vaCell(b.visual_acuity.vacc_ou) : NA; }],
    ['Pinhole_OD', 'text', function (b) { return vaCell(b.visual_acuity.ph_od); }],
    ['Pinhole_OS', 'text', function (b) { return vaCell(b.visual_acuity.ph_os); }],
    ['Plus_2DS_OD', 'text', function (b) { return opt('plusLens', b.visual_acuity.plus_od || null, NT); }],
    ['Plus_2DS_OS', 'text', function (b) { return opt('plusLens', b.visual_acuity.plus_os || null, NT); }],
    ['Cause_of_Visual_Impairment', 'text', function (b) { return opt('viCause', b.visual_acuity.cause || null, NT); }],
    ['Amblyopia_Laterality', 'text', function (b) { return b.visual_acuity.cause === 'amblyopia' ? opt('amblyLaterality', b.visual_acuity.ambly_lat) : NA; }],
    ['Amblyopia_Eye', 'text', function (b) {
      var v = b.visual_acuity;
      if (v.cause !== 'amblyopia') return NA;
      if (v.ambly_lat === 'one') return v.ambly_eye || NANS;
      return v.ambly_lat === 'both' ? NA : NANS;
    }],
    ['Other_VI_Cause', 'text', function (b) { return b.visual_acuity.cause === 'other' ? (txt(b.visual_acuity.cause_other) || NANS) : NA; }],
    ['Referral_VA', 'text', function (b) { return yesNo(C.referral(b).va); }],
    ['Referral_Refractive_Error', 'text', function (b) { return yesNo(C.referral(b).re); }],
    ['Referral_Alert', 'text', function (b) { return yesNo(C.referral(b).alert); }],
    ['Registration_Status', 'text', function (b) { return stationCell(b, 'registration'); }],
    ['Autorefraction_Status', 'text', function (b) { return stationCell(b, 'autoref'); }],
    ['Strabismus_EOM_Status', 'text', function (b) { return stationCell(b, 'strabismus'); }],
    ['VA_Status', 'text', function (b) { return stationCell(b, 'va'); }],
    ['Questionnaire_Status', 'text', function (b) { return stationCell(b, 'questionnaire'); }],
    ['Completion_Status', 'text', function (b) { return MF.PARTICIPANT_STATUS[C.participantStatus(b.station_status)].en; }]
  ]);

  /* ---------- Family sheet ---------- */
  var REL = { father: 'Father', mother: 'Mother', participant: 'Participant', sibling: 'Sibling' };
  function famHistCell(b, m, gateField, selField, kind) {
    if (m.relation === 'participant') return NA;
    var g = b.registration[gateField];
    if (g === 'no') return 'No';
    if (g !== 'yes') return NANS;
    if (!m[selField]) return 'No';
    var list = b.family_history_entries.filter(function (e) { return e.member_id === m.id && e.kind === kind && txt(e.name); }).map(function (e) {
      if (kind === 'eye_surgery') return join([txt(e.name), txt(e.when)]);
      if (kind === 'systemic') return txt(e.name) + (txt(e.details) ? ' (' + txt(e.details) + ')' : '');
      return txt(e.name);
    });
    return list.length ? list.join(SEP) : 'Yes';
  }
  var FCOLS = [
    ['Participant_ID', 'text', function (b) { return b.participant.code; }],
    ['Family_Member_ID', 'text', function (b, m) { return b.participant.code + '-' + m.key; }],
    ['Relation', 'text', function (b, m) { return REL[m.relation] || m.relation; }],
    ['Sibling_Sex', 'text', function (b, m) { return m.relation === 'sibling' ? opt('siblingSex', m.sex) : NA; }],
    ['Older_Or_Younger', 'text', function (b, m) { return m.relation === 'sibling' ? opt('olderYounger', m.older) : NA; }],
    ['Birth_Order', 'int', function (b, m) {
      if (m.relation === 'participant') return b.registration.birth_order != null ? b.registration.birth_order : NANS;
      if (m.relation === 'sibling') return m.birth_order != null ? m.birth_order : NANS;
      return NA;
    }],
    ['Wears_Glasses', 'text', function (b, m) {
      if (m.relation === 'participant') return NA;
      var g = b.registration.fam_glasses;
      if (g === 'no') return 'No';
      if (g !== 'yes') return NANS;
      return yesNo(m.glasses);
    }],
    ['Glasses_Type', 'text', function (b, m) {
      if (m.relation === 'participant' || b.registration.fam_glasses !== 'yes' || !m.glasses) return NA;
      return opt('familyGlassesType', m.glasses_type);
    }],
    ['Eye_Disease', 'text', function (b, m) { return famHistCell(b, m, 'fam_disease', 'sel_disease', 'eye_disease'); }],
    ['Eye_Surgery', 'text', function (b, m) { return famHistCell(b, m, 'fam_surgery', 'sel_surgery', 'eye_surgery'); }],
    ['Systemic_Condition', 'text', function (b, m) { return famHistCell(b, m, 'sys_family', 'sel_systemic', 'systemic'); }]
  ];

  /* ---------- Questionnaire sheet (two-row header: section, exact question text) ---------- */
  function questionnaireSheet(list) {
    var items = Q.items;
    var r1 = ['', ''], r2 = ['Participant_ID', 'School_Number'], types = ['text', 'int'];
    items.forEach(function (it) {
      r1.push(it.section.title);
      r2.push(it.text);
      types.push(it.type === 'auto-age' || it.type === 'days' ? 'int' : 'text');
    });
    var rows = [r1, r2];
    list.forEach(function (b) {
      var ans = (b.questionnaire_responses && b.questionnaire_responses.answers) || {};
      rows.push([b.participant.code, b.school.number].concat(items.map(function (it) { return MF.qlogic.cell(it, ans[it.id], b); })));
    });
    return { name: 'Questionnaire', rows: rows, headerRows: 2, types: types, freeze: { rows: 2, cols: 1 }, autoFilter: true, rtl: true, maxWidth: 40, minWidth: 10 };
  }

  function build(snap, schoolId) {
    var list = contexts(snap, schoolId);
    var prow = [PCOLS.map(function (c) { return c[0]; })];
    list.forEach(function (b) { prow.push(PCOLS.map(function (c) { return c[2](b); })); });
    var frow = [FCOLS.map(function (c) { return c[0]; })];
    list.forEach(function (b) {
      FAM.ordered(b.family_members, b.registration).forEach(function (m) { frow.push(FCOLS.map(function (c) { return c[2](b, m); })); });
    });
    return {
      count: list.length,
      sheets: [
        { name: 'Participants', rows: prow, headerRows: 1, types: PCOLS.map(function (c) { return c[1]; }), freeze: { rows: 1, cols: 5 }, autoFilter: true, maxWidth: 46 },
        { name: 'Family', rows: frow, headerRows: 1, types: FCOLS.map(function (c) { return c[1]; }), freeze: { rows: 1, cols: 2 }, autoFilter: true, maxWidth: 46 },
        questionnaireSheet(list)
      ]
    };
  }

  var ExportService = {
    PARTICIPANT_COLUMNS: PCOLS.map(function (c) { return c[0]; }),
    FAMILY_COLUMNS: FCOLS.map(function (c) { return c[0]; }),
    /* returns {blob, filename, count} */
    exportWorkbook: function (opts) {
      opts = opts || {};
      /* Phase 2: the snapshot comes from Supabase (MF.DataService.snapshot) */
      return Promise.resolve(opts.snapshot || MF.repos.db().snapshot()).then(function (snap) {
        var school = opts.schoolId ? snap.schools.filter(function (s) { return s.id === opts.schoolId; })[0] : null;
        var wb = build(snap, opts.schoolId || null);
        var blob = window.XlsxLite.workbook(wb.sheets, { title: 'Myopia Field Screening — research export', creator: 'Myopia Field Screening ' + MF.VERSION, app: 'Myopia Field Screening' });
        var name = school ? 'Myopia_School-' + school.number + '_' + MF.dom.stamp() + '.xlsx' : 'Myopia_All-Schools_' + MF.dom.stamp() + '.xlsx';
        return { blob: blob, filename: name, count: wb.count };
      });
    },
    _build: build
  };
  MF.ExportService = ExportService;
})();
