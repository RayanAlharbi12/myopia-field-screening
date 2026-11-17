/* Questionnaire rules: derived demographics, inline validation, one-cell export values. */
(function () {
  'use strict';
  var MF = window.MF, F = MF.fmt, Q = MF.QUESTIONNAIRE;

  var H = Q.hourUnit, M = Q.minuteUnit;
  function n(v) { return typeof v === 'number' && isFinite(v) ? v : (v === '' || v == null ? null : (isFinite(+v) ? +v : null)); }
  function hours(v) { return F.num(v) + ' ' + H; }
  function minutes(v) { return F.num(v) + ' ' + M; }

  /* demographic section: auto-populated from Registration and Family data */
  function derived(item, b) {
    var reg = b.registration || {}, p = b.participant || {};
    switch (item.type) {
      case 'auto-id': return p.code || null;
      case 'auto-gender': return reg.gender === 'male' ? 'ذكر' : reg.gender === 'female' ? 'أنثى' : null;
      case 'auto-age': { var a = parseInt(reg.age, 10); return isFinite(a) ? a : null; }
      case 'auto-class': { var c = MF.OPT.find('classLevel', reg.class_level); return c ? c.q : null; }
      case 'auto-parent-one': return MF.family.parentGlasses(reg, b.family_members).one;
      case 'auto-parent-both': return MF.family.parentGlasses(reg, b.family_members).both;
    }
    return null;
  }
  function isAuto(item) { return item.type.indexOf('auto-') === 0; }

  function travelParts(a) {
    var parts = [];
    if (a && a.car) parts.push('السيارة' + (n(a.car_min) != null ? ' — ' + minutes(n(a.car_min)) : ''));
    if (a && a.walk) parts.push('المشي' + (n(a.walk_min) != null ? ' — ' + minutes(n(a.walk_min)) : ''));
    return parts;
  }

  /* the single Excel cell for an item ('' when unanswered) */
  function cell(item, ans, b) {
    if (isAuto(item)) { var d = derived(item, b); return d == null ? '' : d; }
    if (ans == null || ans === '') return '';
    switch (item.type) {
      case 'duration':
        if (ans.choice === 'none') return Q.durationOptions[0];
        if (ans.choice === 'lt1') return Q.durationOptions[1];
        if (ans.choice === 'gt1') return n(ans.hours) != null ? hours(n(ans.hours)) : Q.durationOptions[2];
        return '';
      case 'time': return /^\d{2}:\d{2}$/.test(ans) ? ans : '';
      case 'days': return n(ans) != null ? n(ans) : '';
      case 'hours': return n(ans) != null ? hours(n(ans)) : '';
      case 'travel': return travelParts(ans).join(' | ');
      case 'return':
        if (ans.same === 'yes') return item.options[0];
        if (ans.same === 'no') { var t = travelParts(ans); return item.options[1] + (t.length ? ': ' + t.join(' | ') : ''); }
        return '';
      case 'activities':
        if (ans.gate === 'none') return item.gate[0];
        if (ans.gate === 'yes') {
          var rows = (ans.rows || []).filter(function (r) { return r && (String(r.name || '').trim() || n(r.hours) != null); })
            .map(function (r) { return String(r.name || '').trim() + (n(r.hours) != null ? ' — ' + hours(n(r.hours)) : ''); });
          return rows.length ? rows.join(' | ') : item.gate[1];
        }
        return '';
      case 'notes': return String(ans).trim();
    }
    return '';
  }

  function answered(item, ans, b) {
    if (isAuto(item)) return derived(item, b) != null;
    if (item.type === 'notes') return true;   /* optional */
    return cell(item, ans, b) !== '';
  }

  /* errors block "إكمال القسم"; warnings never block */
  function itemIssues(item, ans) {
    var errors = [], warnings = [];
    if (isAuto(item) || item.type === 'notes') return { errors: errors, warnings: warnings };
    if (item.type === 'duration' && ans && ans.choice === 'gt1') {
      var h = n(ans.hours);
      if (h == null) errors.push('أدخل عدد الساعات.');
      else if (h <= 1) warnings.push('القيمة المدخلة لا تزيد على ساعة.');
      else if (h > 24) errors.push('عدد الساعات لا يمكن أن يتجاوز 24.');
    }
    if (item.type === 'hours' && ans != null && ans !== '' && n(ans) != null && n(ans) > 24) errors.push('عدد الساعات لا يمكن أن يتجاوز 24.');
    if ((item.type === 'travel' || (item.type === 'return' && ans && ans.same === 'no')) && ans) {
      if (ans.car && n(ans.car_min) == null) errors.push('أدخل عدد دقائق السيارة.');
      if (ans.walk && n(ans.walk_min) == null) errors.push('أدخل عدد دقائق المشي.');
    }
    if (item.type === 'activities' && ans && ans.gate === 'yes') {
      var any = false;
      (ans.rows || []).forEach(function (r, i) {
        if (!r) return;
        var nm = String(r.name || '').trim(), hh = n(r.hours);
        if (nm || hh != null) any = true;
        if (nm && hh == null) errors.push('أدخل عدد ساعات «' + nm + '».');
        if (!nm && hh != null) errors.push('أدخل اسم النشاط للساعات المدخلة.');
        if (hh != null && hh > 24) errors.push('عدد الساعات لا يمكن أن يتجاوز 24.');
      });
      if (!any) warnings.push('اختير «نعم» دون إدخال أي نشاط.');
    }
    return { errors: errors, warnings: warnings };
  }

  function sectionReview(section, answers, b) {
    var errors = [], unanswered = 0, total = 0;
    section.items.forEach(function (it) {
      if (it.type === 'guide' || it.type === 'notes') return;
      total++;
      var a = answers[it.id];
      if (!answered(it, a, b)) unanswered++;
      itemIssues(it, a).errors.forEach(function (e) { errors.push({ item: it, text: e }); });
    });
    return { errors: errors, unanswered: unanswered, total: total };
  }

  MF.qlogic = { derived: derived, isAuto: isAuto, cell: cell, answered: answered, itemIssues: itemIssues, sectionReview: sectionReview };
})();
