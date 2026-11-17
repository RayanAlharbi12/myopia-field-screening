/* Station review before "إكمال القسم".
   errors   -> must be fixed first (only the questionnaire duration/activity rules)
   warnings -> shown inline; the examiner may complete anyway
   notTested-> clinical items still "Not tested" (shown for awareness, never blocking) */
(function () {
  'use strict';
  var MF = window.MF, C = MF.clinical, FAM = MF.family, F = MF.fmt;

  function gate(v) { return v === 'yes' || v === 'no'; }

  function registration(b) {
    var reg = b.registration || {}, p = b.participant || {}, w = [], nt = [];
    var oc = b.ocular_history_entries || [], sys = b.systemic_history_entries || [], fh = b.family_history_entries || [];
    if (!String(p.name || '').trim()) w.push('اسم المشارك غير مُدخل.');
    if (!(parseInt(reg.age, 10) > 0)) w.push('العمر غير مُدخل.');
    if (!reg.gender) w.push('الجنس غير محدد.');
    if (!reg.class_level) w.push('الصف غير محدد.');
    if (!reg.glasses) w.push('سؤال النظارة دون إجابة.');
    else if (reg.glasses === 'yes_not_now') {
      var rs = reg.glasses_reasons || [];
      if (!rs.length) w.push('لم يُحدَّد سبب عدم ارتداء النظارة.');
      if (rs.indexOf('other') >= 0 && !String(reg.glasses_reason_other || '').trim()) w.push('«سبب آخر» للنظارة دون توضيح.');
    }
    [['oc_disease', 'disease_injury', 'التاريخ المرضي أو الإصابة في العين'], ['oc_surgery', 'surgery', 'العمليات السابقة في العين'], ['oc_med', 'medication', 'أدوية العين']].forEach(function (g) {
      if (!gate(reg[g[0]])) { w.push('سؤال «' + g[2] + '» دون إجابة.'); return; }
      if (reg[g[0]] === 'yes') {
        var list = oc.filter(function (e) { return e.kind === g[1]; });
        if (!list.length) w.push('«' + g[2] + '»: الإجابة نعم دون أي إدخال.');
        list.forEach(function (e) { if (!String(e.name || '').trim()) w.push('«' + g[2] + '»: يوجد إدخال دون وصف.'); });
      }
    });
    FAM.issues(reg, b.family_members).forEach(function (i) { w.push(i.text); });
    var rel = FAM.relatives(b.family_members, reg);
    if (!gate(reg.fam_glasses)) w.push('سؤال نظارة أفراد العائلة دون إجابة.');
    else if (reg.fam_glasses === 'yes') {
      var sel = rel.filter(function (m) { return m.glasses; });
      if (!sel.length) w.push('نظارة أفراد العائلة: لم يُحدَّد أي فرد.');
      sel.forEach(function (m) { if (!m.glasses_type) w.push(FAM.label(m, reg) + ': نوع النظارة غير محدد.'); });
    }
    [['fam_disease', 'sel_disease', 'eye_disease', 'أمراض العين في العائلة'], ['fam_surgery', 'sel_surgery', 'eye_surgery', 'عمليات العين في العائلة'], ['sys_family', 'sel_systemic', 'systemic', 'الأمراض العامة في العائلة']].forEach(function (g) {
      if (!gate(reg[g[0]])) { w.push('سؤال «' + g[3] + '» دون إجابة.'); return; }
      if (reg[g[0]] === 'yes') {
        var sel = rel.filter(function (m) { return m[g[1]]; });
        if (!sel.length) w.push('«' + g[3] + '»: لم يُحدَّد أي فرد.');
        sel.forEach(function (m) {
          var ent = fh.filter(function (e) { return e.member_id === m.id && e.kind === g[2] && String(e.name || '').trim(); });
          if (!ent.length) w.push('«' + g[3] + '»: ' + FAM.label(m, reg) + ' دون إدخال.');
        });
      }
    });
    if (!gate(reg.sys_self)) w.push('سؤال الأمراض العامة لدى المشارك دون إجابة.');
    else if (reg.sys_self === 'yes' && !sys.some(function (e) { return String(e.name || '').trim(); })) w.push('الأمراض العامة لدى المشارك: الإجابة نعم دون إدخال.');
    if (!gate(reg.symptoms_gate)) w.push('سؤال الأعراض دون إجابة.');
    else if (reg.symptoms_gate === 'yes') {
      var sy = reg.symptoms || [];
      if (!sy.length) w.push('الأعراض: الإجابة نعم دون اختيار أي عرض.');
      if (sy.indexOf('blurry') >= 0 && !(reg.blurry_loc || []).length) w.push('Blurry Vision: لم يُحدَّد القريب أو البعيد.');
      if (sy.indexOf('other') >= 0 && !String(reg.symptom_other || '').trim()) w.push('العرض الآخر غير مذكور.');
    }
    if (!reg.ant_status) nt.push('Anterior Segment');
    return { errors: [], warnings: w, notTested: nt };
  }

  function autoref(b) {
    var ar = b.autorefraction || {}, nt = [];
    C.AR_FIELDS.forEach(function (f) { if (ar[f[0]] == null) nt.push(f[1]); });
    return { errors: [], warnings: [], notTested: nt };
  }

  function strabismus(b) {
    var st = b.strabismus || {}, w = [], nt = [];
    [['dist', 'Distance'], ['near', 'Near']].forEach(function (s) {
      var f = C.coverFlow(st, s[0]);
      if (!f.test) { nt.push('Cover test — ' + s[1]); return; }
      if (f.phoria && !st[s[0] + '_phoria']) w.push(s[1] + ': نوع الـ Phoria غير محدد.');
      if (f.phoriaOther && !String(st[s[0] + '_phoria_other'] || '').trim()) w.push(s[1] + ': Phoria «Other» دون وصف.');
      if (f.tropia) {
        if (!st[s[0] + '_pattern']) w.push(s[1] + ': Alternating / Unilateral غير محدد.');
        else if (st[s[0] + '_pattern'] === 'unilateral' && !st[s[0] + '_eye']) w.push(s[1] + ': العين (OD / OS) غير محددة.');
        else if (!st[s[0] + '_freq']) w.push(s[1] + ': Intermittent / Constant غير محدد.');
        else if (!st[s[0] + '_type']) w.push(s[1] + ': نوع الـ Tropia غير محدد.');
        if (f.typeOther && !String(st[s[0] + '_type_other'] || '').trim()) w.push(s[1] + ': Tropia «Other» دون وصف.');
      }
    });
    if (!st.eom_status) nt.push('EOM');
    else if (st.eom_status === 'abnormal') {
      var sel = (b.eom_findings || []).filter(function (x) { return x.selected; });
      if (!sel.length) w.push('EOM Abnormal: لم تُحدَّد أي عضلة.');
      sel.forEach(function (x) { if (x.grade == null) w.push('EOM ' + x.eye + ' ' + x.muscle + ': الدرجة غير محددة.'); });
    }
    return { errors: [], warnings: w, notTested: nt };
  }

  function va(b) {
    var v = b.visual_acuity || {}, reg = b.registration || {}, w = [], nt = [];
    C.VASC.concat(C.vaccApplicable(reg) && !C.vaccOptional(reg) ? C.VACC : [], C.PH).forEach(function (f) { if (!v[f[0]]) nt.push(f[1]); });
    if (!v.plus_od) nt.push('+2.00 DS OD');
    if (!v.plus_os) nt.push('+2.00 DS OS');
    if (!v.cause) nt.push('Cause of Visual Impairment');
    if (v.cause === 'amblyopia') {
      if (!v.ambly_lat) w.push('كسل بالعين: عين واحدة أو العينان غير محدد.');
      else if (v.ambly_lat === 'one' && !v.ambly_eye) w.push('كسل بالعين: العين (OD / OS) غير محددة.');
    }
    if (v.cause === 'other' && !String(v.cause_other || '').trim()) w.push('«سبب آخر» دون توضيح.');
    if (v.cause === 'strabismus') {
      var st = b.strabismus || {};
      if (!st.dist_test && !st.near_test) w.push('اختير «حول» بينما لم يُسجَّل فحص الحول بعد.');
    }
    return { errors: [], warnings: w, notTested: nt };
  }

  function questionnaire(b) {
    var ans = (b.questionnaire_responses || {}).answers || {}, errors = [], w = [];
    MF.QUESTIONNAIRE.sections.forEach(function (s) {
      var r = MF.qlogic.sectionReview(s, ans, b);
      r.errors.forEach(function (e) { errors.push(s.title.split(':')[0] + ' — سؤال ' + (e.item.uiNumber || '') + ': ' + e.text); });
      if (r.unanswered) w.push(s.title.split(':')[0] + ': ' + r.unanswered + ' من ' + r.total + ' دون إجابة.');
    });
    return { errors: errors, warnings: w, notTested: [] };
  }

  MF.review = { registration: registration, autoref: autoref, strabismus: strabismus, va: va, questionnaire: questionnaire };
})();
