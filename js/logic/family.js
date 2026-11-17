/* Family Builder rules: labels, consistency checks, parent-glasses derivation. */
(function () {
  'use strict';
  var MF = window.MF, F = MF.fmt, O = MF.OPT;

  function keyNo(m) { var n = parseInt(String(m.key || '').replace(/\D/g, ''), 10); return isFinite(n) ? n : 0; }
  function siblings(members) {
    return (members || []).filter(function (m) { return m.relation === 'sibling'; }).sort(function (a, b) {
      var ao = a.birth_order == null ? 999 : a.birth_order, bo = b.birth_order == null ? 999 : b.birth_order;
      return ao - bo || keyNo(a) - keyNo(b);
    });
  }
  function byRelation(members, rel) { return (members || []).filter(function (m) { return m.relation === rel; })[0] || null; }

  /* ordered list: father, mother, then all children by birth order (participant included) */
  function ordered(members, reg) {
    var kids = siblings(members).slice();
    var p = byRelation(members, 'participant');
    if (p) {
      var po = reg && reg.birth_order != null ? reg.birth_order : 999;
      var at = kids.findIndex(function (k) { return (k.birth_order == null ? 999 : k.birth_order) > po; });
      if (at < 0) kids.push(p); else kids.splice(at, 0, p);
    }
    return [byRelation(members, 'father'), byRelation(members, 'mother')].filter(Boolean).concat(kids);
  }

  /* e.g. "الأخ — الأول بين الأبناء — أكبر من المشارك" */
  function label(m, reg, index) {
    if (!m) return '';
    if (m.relation === 'father') return 'الأب';
    if (m.relation === 'mother') return 'الأم';
    if (m.relation === 'participant') {
      return 'المشارك' + (reg && reg.birth_order ? ' — ' + F.ordinal(reg.birth_order) + ' بين الأبناء' : '');
    }
    var sx = O.find('siblingSex', m.sex);
    var parts = [sx ? sx.the : 'أخ / أخت' + (index ? ' ' + index : '')];
    if (m.birth_order) parts.push(F.ordinal(m.birth_order) + ' بين الأبناء');
    if (m.older) parts.push(O.ar('olderYounger', m.older));
    return parts.join(' — ');
  }

  /* members that family-history questions can be about (everyone except the participant) */
  function relatives(members, reg) { return ordered(members, reg).filter(function (m) { return m.relation !== 'participant'; }); }

  function expectedSiblings(reg) {
    var n = parseInt(reg && reg.family_size, 10);
    return isFinite(n) ? Math.max(0, n - 3) : null;
  }

  /* consistency warnings (inline, never blocking) */
  function issues(reg, members) {
    var out = [];
    reg = reg || {};
    var size = parseInt(reg.family_size, 10);
    var sibs = siblings(members);
    if (!isFinite(size)) out.push({ field: 'family_size', text: 'لم يُحدَّد عدد أفراد الأسرة.' });
    else {
      if (size < 3) out.push({ field: 'family_size', text: 'أقل عدد منطقي لأفراد الأسرة هو 3 (الأب والأم والمشارك).' });
      var exp = Math.max(0, size - 3);
      if (sibs.length !== exp) {
        out.push({ field: 'family_size', mismatch: true, text: 'عدد أفراد الأسرة ' + size + ' يعني ' + exp + ' من الإخوة والأخوات، والمسجَّل حاليًا ' + sibs.length + '.' });
      }
    }
    var kids = isFinite(size) ? size - 2 : null;
    var po = reg.birth_order;
    if (po == null) out.push({ field: 'birth_order', text: 'لم يُحدَّد ترتيب المشارك بين الأبناء.' });
    else if (kids != null && po > kids) out.push({ field: 'birth_order', text: 'ترتيب المشارك (' + po + ') أكبر من عدد الأبناء (' + kids + ').' });
    var seen = {};
    if (po != null) seen[po] = ['المشارك'];
    sibs.forEach(function (s, i) {
      var name = label(s, reg, i + 1);
      var miss = [];
      if (!s.sex) miss.push('النوع');
      if (!s.older) miss.push('أكبر/أصغر');
      if (s.birth_order == null) miss.push('الترتيب');
      if (miss.length) out.push({ member: s.id, text: name + ': لم يُحدَّد ' + miss.join('، ') + '.' });
      if (s.birth_order != null) {
        if (kids != null && s.birth_order > kids) out.push({ member: s.id, text: name + ': الترتيب أكبر من عدد الأبناء (' + kids + ').' });
        (seen[s.birth_order] = seen[s.birth_order] || []).push(name);
        if (po != null && s.older) {
          var shouldBeOlder = s.birth_order < po;
          if (s.birth_order !== po && shouldBeOlder !== (s.older === 'older')) {
            out.push({ member: s.id, text: name + ': الترتيب لا يتوافق مع «' + O.ar('olderYounger', s.older) + '».' });
          }
        }
      }
    });
    Object.keys(seen).forEach(function (k) {
      if (seen[k].length > 1) out.push({ text: 'الترتيب ' + F.ordinal(+k) + ' مكرر (' + seen[k].join('، ') + '). تحقق، وقد يكون توأمًا.' });
    });
    return out;
  }

  /* Parent-glasses questionnaire items, derived from the structured family glasses answers.
     "أحد والديك يرتدي نظارة." = exactly one parent; "كلا والديك يرتديان نظارة." = both parents.
     Any glasses type counts. Unanswered family-glasses question -> not derived yet (null). */
  function parentGlasses(reg, members) {
    if (!reg || (reg.fam_glasses !== 'yes' && reg.fam_glasses !== 'no')) return { one: null, both: null, count: null };
    var f = byRelation(members, 'father'), m = byRelation(members, 'mother');
    var on = reg.fam_glasses === 'yes';
    var n = (on && f && f.glasses ? 1 : 0) + (on && m && m.glasses ? 1 : 0);
    return { one: n === 1 ? 'نعم' : 'لا', both: n === 2 ? 'نعم' : 'لا', count: n };
  }

  MF.family = {
    siblings: siblings, byRelation: byRelation, ordered: ordered, label: label, relatives: relatives,
    expectedSiblings: expectedSiblings, issues: issues, parentGlasses: parentGlasses
  };
})();
