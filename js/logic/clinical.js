/* Clinical rules: referral flags, applicability of conditional fields, station status. No storage here. */
(function () {
  'use strict';
  var MF = window.MF, F = MF.fmt;

  var AR_FIELDS = [
    ['od_sph', 'OD Sphere', 'sphere'], ['od_cyl', 'OD Cylinder', 'cyl'], ['od_axis', 'OD Axis', 'axis'],
    ['os_sph', 'OS Sphere', 'sphere'], ['os_cyl', 'OS Cylinder', 'cyl'], ['os_axis', 'OS Axis', 'axis']
  ];
  var VASC = [['vasc_od', 'VAsc OD'], ['vasc_os', 'VAsc OS'], ['vasc_ou', 'VAsc OU']];
  var VACC = [['vacc_od', 'VAcc OD'], ['vacc_os', 'VAcc OS'], ['vacc_ou', 'VAcc OU']];
  var PH = [['ph_od', 'Pinhole OD'], ['ph_os', 'Pinhole OS']];

  /* VAcc becomes available when the participant has glasses (worn or not currently worn) */
  function vaccApplicable(reg) { return !!reg && (reg.glasses === 'yes' || reg.glasses === 'yes_not_now' || reg.glasses === 'previously'); }
  /* "previously wore glasses": no current correction is assumed — VAcc is optional and stays Not tested unless measured */
  function vaccOptional(reg) { return !!reg && reg.glasses === 'previously'; }

  /* Referral_Refractive_Error: |sphere| or |cylinder| > 1.00 D in either eye. Axis and Not tested never trigger. */
  function refractiveReasons(ar) {
    var out = [];
    if (!ar) return out;
    AR_FIELDS.forEach(function (f) {
      if (f[2] === 'axis') return;
      var v = ar[f[0]];
      if (F.powerOverLimit(v)) out.push({ field: f[1], value: F.power(v), text: f[1] + ' ' + F.power(v) });
    });
    return out;
  }

  /* Referral_VA: any recorded (applicable) VA worse than 6/9. Not tested never triggers. */
  function vaFields(reg) { return VASC.concat(vaccApplicable(reg) ? VACC : [], PH); }
  function vaReasons(va, reg) {
    var out = [];
    if (!va) return out;
    vaFields(reg).forEach(function (f) {
      var v = va[f[0]];
      if (F.vaWorseThanLimit(v)) out.push({ field: f[1], value: v, text: f[1] + ' ' + v });
    });
    return out;
  }

  function referral(b) {
    var re = refractiveReasons(b.autorefraction), va = vaReasons(b.visual_acuity, b.registration);
    return { re: re.length > 0, va: va.length > 0, alert: re.length > 0 || va.length > 0, reReasons: re, vaReasons: va };
  }

  /* ---- station status ---- */
  function stationState(status, key) { return status && status[key] ? status[key].state : 'not_started'; }
  function currentStation(status) {
    for (var i = 0; i < MF.STATIONS.length; i++) {
      if (stationState(status, MF.STATIONS[i].key) !== 'completed') return MF.STATIONS[i].key;
    }
    return null;
  }
  /* Completed only when all five stations were explicitly completed */
  function participantStatus(status) { return currentStation(status) === null ? 'completed' : 'draft'; }

  function summary(b) {
    var reg = b.registration || {}, r = referral(b);
    var age = parseInt(reg.age, 10);
    return {
      age: isFinite(age) ? age : null,
      gender: reg.gender || null,
      class_level: reg.class_level || null,
      current_station: currentStation(b.station_status),
      referral_alert: r.alert, referral_va: r.va, referral_re: r.re
    };
  }

  /* ---- strabismus progressive disclosure (one side: 'dist' or 'near') ---- */
  function coverFlow(st, side) {
    st = st || {};
    var t = st[side + '_test'] || null, pat = st[side + '_pattern'] || null;
    var f = {
      test: t,
      phoria: t === 'phoria',
      phoriaOther: t === 'phoria' && st[side + '_phoria'] === 'other',
      tropia: t === 'tropia',
      eye: t === 'tropia' && pat === 'unilateral',
      freq: t === 'tropia' && (pat === 'alternating' || (pat === 'unilateral' && !!st[side + '_eye'])),
      type: false, typeOther: false
    };
    f.type = f.freq && !!st[side + '_freq'];
    f.typeOther = f.type && st[side + '_type'] === 'other';
    return f;
  }
  /* readable line for one side, e.g. "Tropia — Alternating — Constant — Esotropia" */
  function coverLine(st, side) {
    st = st || {};
    var O = MF.OPT, f = coverFlow(st, side), parts = [];
    if (!f.test) return 'Not tested';
    parts.push(O.en('coverTest', f.test));
    if (f.phoria) {
      var ph = st[side + '_phoria'];
      if (ph) parts.push(ph === 'other' ? 'Other: ' + (st[side + '_phoria_other'] || '…') : O.en('phoriaType', ph));
    }
    if (f.tropia) {
      var pat = st[side + '_pattern'];
      if (pat) parts.push(O.en('tropiaPattern', pat));
      if (f.eye && st[side + '_eye']) parts.push(st[side + '_eye']);
      if (f.freq && st[side + '_freq']) parts.push(O.en('tropiaFrequency', st[side + '_freq']));
      if (f.type && st[side + '_type']) parts.push(st[side + '_type'] === 'other' ? 'Other: ' + (st[side + '_type_other'] || '…') : O.en('tropiaType', st[side + '_type']));
    }
    return parts.join(' — ');
  }

  MF.clinical = {
    AR_FIELDS: AR_FIELDS, VASC: VASC, VACC: VACC, PH: PH,
    vaccApplicable: vaccApplicable, vaccOptional: vaccOptional, refractiveReasons: refractiveReasons, vaFields: vaFields, vaReasons: vaReasons,
    referral: referral, stationState: stationState, currentStation: currentStation,
    participantStatus: participantStatus, summary: summary, coverFlow: coverFlow, coverLine: coverLine
  };
})();
