/* =====================================================================
   Station 1 — Registration (A–H), one part at a time.
   A Basic · B Glasses · C Ocular history · D Family Builder ·
   E Family history · F Systemic history · G Symptoms · H Anterior segment
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, C = MF.controls, K = MF.stationKit, O = MF.OPT, FAM = MF.family, F = MF.fmt;

  var PARTS = [
    { id: 'a', code: 'A', title: 'المعلومات الأساسية' },
    { id: 'b', code: 'B', title: 'النظارة' },
    { id: 'c', code: 'C', title: 'التاريخ المرضي للعين' },
    { id: 'd', code: 'D', title: 'بناء الأسرة' },
    { id: 'e', code: 'E', title: 'التاريخ العائلي للعين' },
    { id: 'f', code: 'F', title: 'الأمراض العامة' },
    { id: 'g', code: 'G', title: 'الأعراض' },
    { id: 'h', code: 'H', title: 'الجزء الأمامي للعين' }
  ];
  var OC = 'ocular_history_entries', FH = 'family_history_entries', SY = 'systemic_history_entries', FMB = 'family_members';

  function gateYes(v) { return v === 'yes'; }
  function answered(v) { return v === 'yes' || v === 'no'; }
  function reg(ctx) { return ctx.b.registration; }
  function kids(r) { var n = parseInt(r.family_size, 10); return isFinite(n) && n >= 3 ? n - 2 : null; }
  function ocList(ctx, kind) { return ctx.session.list(OC, function (e) { return e.kind === kind; }).sort(byCreated); }
  function byCreated(a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }
  function fhList(ctx, memberId, kind) { return ctx.session.list(FH, function (e) { return e.member_id === memberId && e.kind === kind; }).sort(byCreated); }

  function partsWithState(ctx) {
    var r = reg(ctx), p = ctx.b.participant, issues = FAM.issues(r, ctx.b.family_members);
    var done = {
      a: !!(String(p.name || '').trim() && parseInt(r.age, 10) > 0 && r.gender && r.class_level),
      b: !!r.glasses && (r.glasses !== 'yes_not_now' || (r.glasses_reasons || []).length > 0),
      c: answered(r.oc_disease) && answered(r.oc_surgery) && answered(r.oc_med),
      d: r.family_size != null && r.birth_order != null && issues.length === 0,
      e: answered(r.fam_glasses) && answered(r.fam_disease) && answered(r.fam_surgery),
      f: answered(r.sys_self) && answered(r.sys_family),
      g: answered(r.symptoms_gate),
      h: !!r.ant_status
    };
    return PARTS.map(function (x) { return Object.assign({}, x, { done: done[x.id] }); });
  }

  /* ---------------- A. Basic information ---------------- */
  function partA(ctx) {
    var sc = ctx.school, p = ctx.b.participant;
    var ages = [11, 12, 13, 14, 15, 16];
    return '<div class="grid-form">' +
      '<div class="q pid-q"><div class="q-label"><span class="q-text">رقم المشارك</span></div><div class="pid-ro">' + D.ltr(p.code, 'pid-xl') + '<span class="hint">للقراءة فقط — يُعدَّل من قائمة ⋯ عند الحاجة</span></div></div>' +
      C.q('اسم المشارك', C.text('n', { placeholder: 'الاسم كما يُستخدم في المدرسة', aria: 'اسم المشارك' }), { hint: 'يظهر في التطبيق فقط ولا يُصدَّر في ملف البحث.' }) +
      C.q('العمر', '<div class="age-row">' + C.text('s|registration|age', { dtype: 'int', inputmode: 'numeric', pattern: '[0-9]*', num: true, cls: 'age-in', maxlength: 2, aria: 'العمر بالسنوات' }) + '<span class="unit">سنة</span>' +
        '<div class="quick" role="group" aria-label="اختيار سريع للعمر">' + ages.map(function (a) { return '<button type="button" class="opt compact center" data-sa="age" data-v="' + a + '" aria-pressed="false">' + a + '</button>'; }).join('') + '</div></div>') +
      C.q('الجنس', C.choice('s|registration|gender', O.gender, { cols: 2, center: true }), { hint: 'محدد مسبقًا حسب نوع المدرسة (' + O.ar('schoolType', sc.type) + ')، ويمكن تصحيحه.' }) +
      C.q('الصف', C.choice('s|registration|class_level', O.classLevel, { cols: 3, center: true })) +
      '</div>';
  }

  /* ---------------- B. Glasses ---------------- */
  function partB() {
    return C.q('هل ترتدي نظارة؟', C.choice('s|registration|glasses', O.glasses, { stack: true })) +
      C.reveal('glassesReasons',
        C.q('السبب؟', C.multi('s|registration|glasses_reasons', O.glassesReasons, { stack: true }), { hint: 'يمكن اختيار أكثر من سبب.' }) +
        C.reveal('glassesOther', C.q('سبب آخر', C.text('s|registration|glasses_reason_other', { placeholder: 'اذكر السبب' })))) +
      C.keptNote('glassesReasons') +
      '<p class="notice" data-when="vaccInfo">' + MF.icon('info') + '<span>سيظهر قياس ' + D.ltr('VAcc') + ' في محطة حدة الإبصار، بجانب ' + D.ltr('VAsc') + '.</span></p>' +
      '<p class="notice" data-when="vaccOptional">' + MF.icon('info') + '<span>قياس ' + D.ltr('VAcc') + ' في محطة حدة الإبصار اختياري لهذا المشارك، ويبقى ' + D.ltr('Not tested') + ' ما لم يُقَس فعلًا بتصحيح.</span></p>';
  }

  /* ---------------- C. Ocular history ---------------- */
  function ocEntry(e, kind, i) {
    var st = OC, id = e.id, b = function (f) { return 'i|' + st + '|' + id + '|' + f; };
    var head = '<div class="entry-head"><span class="entry-n num">' + (i + 1) + '</span><span class="entry-t">' +
      (kind === 'disease_injury' ? 'مرض / إصابة' : kind === 'surgery' ? 'عملية' : 'دواء') + '</span>' + K.removeButton(st, id) + '</div>';
    var body = '';
    if (kind === 'disease_injury') {
      body = C.q('النوع', C.choice(b('subtype'), O.diseaseKind, { cols: 2, compact: true, center: true })) +
        C.q('الوصف / التشخيص', C.text(b('name'), { placeholder: 'مثال: التهاب الملتحمة التحسسي' })) +
        C.q('أي عين', C.choice(b('eye'), O.eye4, { cols: 4, compact: true, center: true })) +
        K.whenCtl(st, e, 'when_kind', 'when', 'متى حدثت؟');
    } else if (kind === 'surgery') {
      body = C.q('نوع العملية', C.text(b('name'), { placeholder: 'مثال: تصحيح الحول' })) +
        C.q('أي عين', C.choice(b('eye'), O.eye3, { cols: 3, compact: true, center: true })) +
        K.whenCtl(st, e, 'when_kind', 'when', 'متى أجريت؟');
    } else {
      body = C.q('اسم / نوع الدواء', C.text(b('name'), { placeholder: 'مثال: قطرة أتروبين 0.01%' })) +
        C.q('سبب الاستخدام <span class="opt-l">(اختياري)</span>', C.text(b('reason'), { placeholder: 'اختياري' })) +
        C.q('أي عين', C.choice(b('eye'), O.eye3, { cols: 3, compact: true, center: true })) +
        K.whenCtl(st, e, 'when_kind', 'when', 'متى بدأ استخدامه؟') +
        C.q('هل ما زلت تستخدمه؟', C.choice(b('ongoing'), O.medOngoing, { cols: 2, compact: true })) +
        C.reveal('med_stop_' + id, K.whenCtl(st, e, 'stop_kind', 'stop_when', 'متى توقفت عن استخدامه؟'));
    }
    return '<article class="entry" data-entry="' + esc(id) + '">' + head + '<div class="entry-b">' + body + '</div></article>';
  }
  function ocBlock(gateField, kind, question, addLabel, keptKey, emptyText) {
    return '<section class="block">' +
      C.q(question, C.choice('s|registration|' + gateField, O.noYes, { cols: 2, center: true })) +
      C.reveal(keptKey, '<div class="entries" data-list="' + kind + '"></div>' +
        '<button type="button" class="btn add-btn" data-sa="add-oc" data-kind="' + kind + '">' + MF.icon('plus') + '<span>' + esc(addLabel) + '</span></button>') +
      C.keptNote(keptKey) + '</section>';
  }
  function partC() {
    return ocBlock('oc_disease', 'disease_injury', 'هل يوجد تاريخ مرضي أو إصابة سابقة في العين؟', 'إضافة مرض / إصابة', 'ocDisease') +
      ocBlock('oc_surgery', 'surgery', 'هل أجريت أي عملية سابقة في العين؟', 'إضافة عملية', 'ocSurgery') +
      ocBlock('oc_med', 'medication', 'هل تستخدم أو سبق أن استخدمت أدوية للعين؟', 'إضافة دواء', 'ocMed');
  }
  function ocListDef(kind) {
    return {
      sig: function (ctx) { return ocList(ctx, kind).map(function (e) { return e.id; }).join(','); },
      html: function (ctx) {
        var l = ocList(ctx, kind);
        return l.length ? l.map(function (e, i) { return ocEntry(e, kind, i); }).join('') : '<p class="entries-empty">لا توجد إدخالات بعد. أضف الإدخال الأول.</p>';
      }
    };
  }

  /* ---------------- D. Family Builder ---------------- */
  function orderChoice(bind, n, aria) {
    if (!n || n > 14) return C.text(bind, { dtype: 'int', inputmode: 'numeric', pattern: '[0-9]*', num: true, cls: 'order-in', aria: aria, placeholder: '—' });
    var opts = [];
    for (var i = 1; i <= n; i++) opts.push({ v: i, ar: String(i) });
    return C.choice(bind, opts, { compact: true, center: true, cls: 'order-choices', label: aria });
  }
  function sibCard(m, i, ctx) {
    var r = reg(ctx), b = function (f) { return 'i|' + FMB + '|' + m.id + '|' + f; };
    return '<article class="entry sib" data-entry="' + esc(m.id) + '">' +
      '<div class="entry-head"><span class="entry-n num">' + (i + 1) + '</span><span class="entry-t" data-mlabel="' + esc(m.id) + '"></span>' + K.removeButton(FMB, m.id, 'إزالة') + '</div>' +
      '<div class="entry-b sib-b">' +
        C.q('النوع', C.choice(b('sex'), O.siblingSex, { cols: 2, compact: true, center: true })) +
        C.q('أكبر أم أصغر من المشارك؟', C.choice(b('older'), O.olderYounger, { cols: 2, compact: true, center: true })) +
        C.q('ترتيبه بين الأبناء', orderChoice(b('birth_order'), kids(r), 'ترتيبه بين الأبناء')) +
      '</div></article>';
  }
  function partD() {
    return '<section class="block">' +
      C.q('كم عدد أفراد الأسرة؟', '<div class="stepper">' +
        '<button type="button" class="icon-btn bordered" data-sa="fs-step" data-d="-1" aria-label="إنقاص">−</button>' +
        C.text('s|registration|family_size', { dtype: 'int', inputmode: 'numeric', pattern: '[0-9]*', num: true, cls: 'step-in', aria: 'عدد أفراد الأسرة', maxlength: 2 }) +
        '<button type="button" class="icon-btn bordered" data-sa="fs-step" data-d="1" aria-label="زيادة">+</button></div>',
        { hint: 'يشمل: الأب، الأم، المشارك، جميع الإخوة، جميع الأخوات. الحد الأدنى 3.' }) +
      C.q('ما ترتيب المشارك بين الأبناء؟', '<div data-list="birth-order"></div>', { hint: 'الترتيب بين الأبناء فقط؛ الوالدان لا يُحسبان.' }) +
      '</section>' +
      '<section class="block fam">' +
        '<h3 class="block-h">أفراد الأسرة</h3>' +
        '<ul class="fam-fixed"><li>' + MF.icon('user', 'ic-sm') + '<span>الأب</span></li><li>' + MF.icon('user', 'ic-sm') + '<span>الأم</span></li><li class="is-p">' + MF.icon('user', 'ic-sm') + '<span data-plabel></span></li></ul>' +
        '<div class="entries" data-list="sibs"></div>' +
        '<button type="button" class="btn add-btn" data-sa="add-sib">' + MF.icon('plus') + '<span>إضافة أخ / أخت</span></button>' +
        '<div data-fam-issues></div>' +
      '</section>';
  }

  /* ---------------- E. Family history ---------------- */
  function memberRows(ctx, selField, prefix, inner) {
    var rel = FAM.relatives(ctx.b.family_members, reg(ctx));
    return rel.map(function (m) {
      return '<div class="mem" data-mem="' + esc(m.id) + '">' +
        C.toggle('i|' + FMB + '|' + m.id + '|' + selField, '<span data-mlabel="' + esc(m.id) + '"></span>', { block: true }) +
        C.reveal(prefix + m.id, '<div class="mem-b">' + inner(m) + '</div>') + '</div>';
    }).join('') + (rel.length <= 2 ? '<p class="hint">يظهر الإخوة والأخوات هنا بعد إضافتهم في «بناء الأسرة».</p>' : '');
  }
  function fhEntries(ctx, m, kind) {
    var l = fhList(ctx, m.id, kind);
    var nameL = kind === 'eye_disease' ? 'اسم / نوع المرض' : kind === 'eye_surgery' ? 'نوع العملية' : 'اسم / نوع الحالة';
    return l.map(function (e, i) {
      var b = function (f) { return 'i|' + FH + '|' + e.id + '|' + f; };
      return '<div class="fh-entry" data-entry="' + esc(e.id) + '">' +
        '<div class="fh-row">' + C.q(nameL + (l.length > 1 ? ' ' + (i + 1) : ''), C.text(b('name'), { placeholder: nameL })) +
        (kind === 'eye_surgery' ? C.q('متى أجريت؟ <span class="opt-l">(اختياري)</span>', C.text(b('when'), { placeholder: 'إن كان معروفًا' })) : '') +
        (kind === 'systemic' ? C.q('تفاصيل <span class="opt-l">(اختياري)</span>', C.text(b('details'), { placeholder: 'اختياري' })) : '') +
        '</div>' + (l.length > 1 ? K.removeButton(FH, e.id) : '') + '</div>';
    }).join('') +
      '<button type="button" class="btn btn-quiet add-more" data-sa="add-fh" data-member="' + esc(m.id) + '" data-kind="' + kind + '">' + MF.icon('plus', 'ic-sm') + '<span>' + (kind === 'eye_disease' ? 'إضافة مرض آخر' : kind === 'eye_surgery' ? 'إضافة عملية أخرى' : 'إضافة حالة أخرى') + '</span></button>';
  }
  function famListDef(selField, prefix, kind) {
    return {
      sig: function (ctx) {
        var rel = FAM.relatives(ctx.b.family_members, reg(ctx));
        return rel.map(function (m) { return m.id + (kind ? ':' + fhList(ctx, m.id, kind).map(function (e) { return e.id; }).join('.') : ''); }).join(',');
      },
      html: function (ctx) {
        return memberRows(ctx, selField, prefix, function (m) {
          if (!kind) return C.q('هل النظارة:', C.choice('i|' + FMB + '|' + m.id + '|glasses_type', O.familyGlassesType, { cols: 3, compact: true, center: true }));
          return fhEntries(ctx, m, kind);
        });
      }
    };
  }
  function famBlock(gateField, question, listKey, keptKey, hint) {
    return '<section class="block">' +
      C.q(question, C.choice('s|registration|' + gateField, O.noYes, { cols: 2, center: true })) +
      C.reveal(keptKey, '<p class="sel-hint">' + esc(hint) + '</p><div class="mems" data-list="' + listKey + '"></div>') +
      C.keptNote(keptKey) + '</section>';
  }
  function partE() {
    return famBlock('fam_glasses', 'هل يوجد أحد من أفراد العائلة يرتدي نظارة؟', 'fam-glasses', 'famGlasses', 'اختر كل من يرتدي نظارة، ثم حدّد نوعها.') +
      famBlock('fam_disease', 'هل يوجد أي مرض في العين لدى أحد أفراد العائلة؟', 'fam-disease', 'famDisease', 'اختر فردًا أو أكثر، ثم اكتب اسم / نوع المرض.') +
      famBlock('fam_surgery', 'هل سبق لأحد أفراد العائلة إجراء عملية في العين؟', 'fam-surgery', 'famSurgery', 'اختر فردًا أو أكثر، ثم اكتب نوع العملية.');
  }

  /* ---------------- F. Systemic ---------------- */
  function sysEntries(ctx) {
    var l = ctx.session.list(SY).sort(byCreated);
    return (l.length ? l.map(function (e, i) {
      var b = function (f) { return 'i|' + SY + '|' + e.id + '|' + f; };
      return '<article class="entry" data-entry="' + esc(e.id) + '"><div class="entry-head"><span class="entry-n num">' + (i + 1) + '</span><span class="entry-t">حالة</span>' + K.removeButton(SY, e.id) + '</div>' +
        '<div class="entry-b">' + C.q('اسم / نوع الحالة', C.text(b('name'), { placeholder: 'مثال: الربو' })) +
        C.q('تفاصيل <span class="opt-l">(اختياري)</span>', C.text(b('details'), { placeholder: 'اختياري' })) + '</div></article>';
    }).join('') : '<p class="entries-empty">لا توجد إدخالات بعد.</p>');
  }
  function partF() {
    return '<section class="block">' +
      C.q('هل لدى المشارك أي أمراض أو مشاكل صحية عامة؟', C.choice('s|registration|sys_self', O.noYes, { cols: 2, center: true })) +
      C.reveal('sysSelf', '<div class="entries" data-list="sys-self"></div><button type="button" class="btn add-btn" data-sa="add-sys">' + MF.icon('plus') + '<span>إضافة حالة</span></button>') +
      C.keptNote('sysSelf') + '</section>' +
      famBlock('sys_family', 'هل يوجد لدى أحد أفراد العائلة أي أمراض أو مشاكل صحية عامة؟', 'fam-systemic', 'sysFamily', 'اختر فردًا أو أكثر، ثم اكتب اسم / نوع الحالة.');
  }

  /* ---------------- G. Symptoms ---------------- */
  function partG() {
    return C.q('هل توجد أعراض؟', C.choice('s|registration|symptoms_gate', O.noYes, { cols: 2, center: true })) +
      C.reveal('symptoms',
        C.q('الأعراض', C.multi('s|registration|symptoms', O.symptoms, { cls: 'sym-grid', ltr: true }), { hint: 'يمكن اختيار أكثر من عرض.' }) +
        C.reveal('blurry', C.q(D.ltr('Blurry Vision') + ': القريب أم البعيد؟', C.multi('s|registration|blurry_loc', O.blurryLocation, { cols: 2 }), { hint: 'يمكن اختيار الاثنين.' })) +
        C.reveal('symptomOther', C.q('اذكر العرض الآخر', C.text('s|registration|symptom_other', { placeholder: 'العرض' })))) +
      C.keptNote('symptoms') + C.keptNote('blurry');
  }

  /* ---------------- H. Anterior segment ---------------- */
  function partH() {
    var rows = O.anteriorStructures.map(function (s) {
      return '<div class="ant-row"><span class="ant-l">' + esc(s.en) + '</span>' +
        ['od', 'os'].map(function (e) { return '<label class="ant-cell"><span class="ant-eye">' + e.toUpperCase() + '</span>' + C.text('s|registration|ant_' + s.v + '_' + e, { placeholder: '—', aria: e.toUpperCase() + ' ' + s.en, dir: 'auto' }) + '</label>'; }).join('') + '</div>';
    }).join('');
    return C.q(D.ltr('Anterior Segment Evaluation'), C.choice('s|registration|ant_status', O.anterior, { cols: 3, center: true, ltr: true })) +
      C.reveal('antAbnormal', '<div class="ant-grid" dir="ltr"><div class="ant-row ant-headrow"><span></span><span class="ant-eye-h">OD</span><span class="ant-eye-h">OS</span></div>' + rows + '</div><p class="hint">نص سريري قصير؛ لا يلزم تعبئة كل الحقول.</p>') +
      C.keptNote('antDetails');
  }

  var PART_HTML = { a: partA, b: partB, c: partC, d: partD, e: partE, f: partF, g: partG, h: partH };

  var LISTS = {
    disease_injury: ocListDef('disease_injury'),
    surgery: ocListDef('surgery'),
    medication: ocListDef('medication'),
    'birth-order': {
      sig: function (ctx) { return String(kids(reg(ctx))); },
      html: function (ctx) { return orderChoice('s|registration|birth_order', kids(reg(ctx)), 'ترتيب المشارك بين الأبناء'); }
    },
    sibs: {
      sig: function (ctx) { return kids(reg(ctx)) + '|' + FAM.siblings(ctx.b.family_members).map(function (m) { return m.id; }).sort().join(','); },
      html: function (ctx) {
        var s = ctx.b.family_members.filter(function (m) { return m.relation === 'sibling'; }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)) || String(a.key).localeCompare(String(b.key)); });
        return s.length ? s.map(function (m, i) { return sibCard(m, i, ctx); }).join('') : '<p class="entries-empty">لا يوجد إخوة أو أخوات مسجَّلون.</p>';
      }
    },
    'fam-glasses': famListDef('glasses', 'fg_', null),
    'fam-disease': famListDef('sel_disease', 'fd_', 'eye_disease'),
    'fam-surgery': famListDef('sel_surgery', 'fs_', 'eye_surgery'),
    'fam-systemic': famListDef('sel_systemic', 'fy_', 'systemic'),
    'sys-self': { sig: function (ctx) { return ctx.session.list(SY).map(function (e) { return e.id; }).join(','); }, html: sysEntries }
  };

  /* ---------------- siblings follow the family size ---------------- */
  function isEmptySibling(ctx, m) {
    return !m.sex && !m.older && m.birth_order == null && !m.glasses && !m.sel_disease && !m.sel_surgery && !m.sel_systemic &&
      !ctx.session.list(FH, function (e) { return e.member_id === m.id; }).length;
  }
  function addSibling(ctx) {
    var r = reg(ctx), n = r.next_sibling_no || 1;
    ctx.session.set('registration', 'next_sibling_no', n + 1);
    return ctx.session.add(FMB, { relation: 'sibling', key: 'S' + n, order: 10 + n, sex: null, older: null, birth_order: null, glasses: false, glasses_type: null, sel_disease: false, sel_surgery: false, sel_systemic: false });
  }
  function reconcileSiblings(ctx) {
    var size = parseInt(reg(ctx).family_size, 10);
    if (!(size >= 3 && size <= 30)) return;
    var exp = size - 3;
    var sibs = ctx.b.family_members.filter(function (m) { return m.relation === 'sibling'; });
    var i;
    for (i = sibs.length; i < exp; i++) addSibling(ctx);
    if (sibs.length > exp) {
      /* only empty rows are removed automatically; filled rows stay and a mismatch warning is shown */
      var extra = sibs.length - exp;
      sibs.slice().reverse().forEach(function (m) {
        if (extra > 0 && isEmptySibling(ctx, m)) { extra--; ctx.session.remove(FMB, m.id).catch(function () {}); }
      });
    }
  }
  /* fill "older / younger" from the birth orders when it is still empty */
  function autoOlder(ctx) {
    var po = reg(ctx).birth_order;
    if (po == null) return;
    FAM.siblings(ctx.b.family_members).forEach(function (m) {
      if (m.older == null && m.birth_order != null && m.birth_order !== po) ctx.session.update(FMB, m.id, { older: m.birth_order < po ? 'older' : 'younger' });
    });
  }

  var reconcileLater = D.debounce(function (ctx) { reconcileSiblings(ctx); }, 700);

  function keptText(n, what) { return (n > 1 ? n + ' إدخالات' : 'إدخال واحد') + ' (' + what + ') محفوظ ومخفي لأن الإجابة الحالية «لا». لا يُصدَّر ما دامت الإجابة كذلك.'; }

  MF.stations.registration = {
    parts: PARTS,
    normalizePart: function (part) { return PARTS.some(function (p) { return p.id === part; }) ? part : 'a'; },

    render: function (ctx) {
      var part = ctx.part || 'a', meta = PARTS.filter(function (p) { return p.id === part; })[0];
      var html = K.header('registration') + K.partNav(partsWithState(ctx), part, 'أقسام التسجيل') +
        '<section class="part-body" data-part-body="' + part + '"><h3 class="part-h"><span class="part-code">' + meta.code + '</span>' + esc(meta.title) + '</h3>' +
        PART_HTML[part](ctx) + '</section>' + K.partFooter(PARTS, part);
      if (part === 'h') html += ctx.completion('مراجعة وإكمال التسجيل');
      else html += '<p class="cb-later">' + MF.icon('info', 'ic-sm') + '<span>زر «إكمال القسم» في نهاية التسجيل (القسم H).</span></p>';
      return html;
    },

    when: function (ctx) {
      var r = reg(ctx), s = ctx.session, w = {};
      var reasons = r.glasses_reasons || [], sym = r.symptoms || [];
      w.glassesReasons = r.glasses === 'yes_not_now';
      w.glassesOther = w.glassesReasons && reasons.indexOf('other') >= 0;
      w.vaccInfo = r.glasses === 'yes' || r.glasses === 'yes_not_now';
      w.vaccOptional = r.glasses === 'previously';
      w.ocDisease = gateYes(r.oc_disease); w.ocSurgery = gateYes(r.oc_surgery); w.ocMed = gateYes(r.oc_med);
      s.list(OC, function (e) { return e.kind === 'medication'; }).forEach(function (e) { w['med_stop_' + e.id] = e.ongoing === 'no'; });
      w.famGlasses = gateYes(r.fam_glasses); w.famDisease = gateYes(r.fam_disease); w.famSurgery = gateYes(r.fam_surgery);
      w.sysSelf = gateYes(r.sys_self); w.sysFamily = gateYes(r.sys_family);
      ctx.b.family_members.forEach(function (m) {
        w['fg_' + m.id] = !!m.glasses; w['fd_' + m.id] = !!m.sel_disease; w['fs_' + m.id] = !!m.sel_surgery; w['fy_' + m.id] = !!m.sel_systemic;
      });
      w.symptoms = gateYes(r.symptoms_gate);
      w.blurry = w.symptoms && sym.indexOf('blurry') >= 0;
      w.symptomOther = w.symptoms && sym.indexOf('other') >= 0;
      w.antAbnormal = r.ant_status === 'abnormal';
      return w;
    },

    kept: function (ctx) {
      var r = reg(ctx), s = ctx.session, k = {};
      if (r.glasses !== 'yes_not_now' && ((r.glasses_reasons || []).length || String(r.glasses_reason_other || '').trim())) k.glassesReasons = 'أسباب عدم ارتداء النظارة محفوظة ومخفية لأن الإجابة الحالية لا تتطلبها. لا تُصدَّر ما دامت الإجابة كذلك.';
      [['oc_disease', 'disease_injury', 'ocDisease', 'مرض / إصابة'], ['oc_surgery', 'surgery', 'ocSurgery', 'عمليات'], ['oc_med', 'medication', 'ocMed', 'أدوية']].forEach(function (g) {
        var n = s.list(OC, function (e) { return e.kind === g[1]; }).length;
        if (!gateYes(r[g[0]]) && n) k[g[2]] = keptText(n, g[3]);
      });
      var rel = ctx.b.family_members.filter(function (m) { return m.relation !== 'participant'; });
      if (!gateYes(r.fam_glasses) && rel.some(function (m) { return m.glasses; })) k.famGlasses = 'تحديدات «يرتدي نظارة» لأفراد العائلة محفوظة ومخفية، ولا تُصدَّر ما دامت الإجابة الحالية «لا».';
      [['fam_disease', 'sel_disease', 'eye_disease', 'famDisease'], ['fam_surgery', 'sel_surgery', 'eye_surgery', 'famSurgery'], ['sys_family', 'sel_systemic', 'systemic', 'sysFamily']].forEach(function (g) {
        var n = s.list(FH, function (e) { return e.kind === g[2] && String(e.name || '').trim(); }).length;
        if (!gateYes(r[g[0]]) && (n || rel.some(function (m) { return m[g[1]]; }))) k[g[3]] = 'بيانات أفراد العائلة لهذا السؤال محفوظة ومخفية (' + n + ' إدخال)، ولا تُصدَّر ما دامت الإجابة الحالية «لا».';
      });
      var ns = s.list(SY).length;
      if (!gateYes(r.sys_self) && ns) k.sysSelf = keptText(ns, 'حالات صحية');
      if (!gateYes(r.symptoms_gate) && ((r.symptoms || []).length || String(r.symptom_other || '').trim())) k.symptoms = 'الأعراض المختارة سابقًا محفوظة ومخفية لأن الإجابة الحالية «لا».';
      if (gateYes(r.symptoms_gate) && (r.symptoms || []).indexOf('blurry') < 0 && (r.blurry_loc || []).length) k.blurry = 'اختيار القريب/البعيد لـ Blurry Vision محفوظ ومخفي.';
      if (r.ant_status !== 'abnormal' && O.anteriorStructures.some(function (x) { return String(r['ant_' + x.v + '_od'] || '').trim() || String(r['ant_' + x.v + '_os'] || '').trim(); })) k.antDetails = 'تفاصيل Abnormal محفوظة ومخفية، ولا تُصدَّر ما دامت الحالة ليست Abnormal.';
      return k;
    },

    sync: function (root, ctx) {
      K.syncLists(root, ctx, LISTS);
      K.updatePartNav(root, partsWithState(ctx));
      K.syncWhenInputs(root, ctx.session);
      var r = reg(ctx);
      D.qsa('[data-mlabel]', root).forEach(function (el) {
        var m = ctx.session.find(FMB, el.getAttribute('data-mlabel'));
        if (!m) return;
        var sibs = ctx.b.family_members.filter(function (x) { return x.relation === 'sibling'; }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
        var t = FAM.label(m, r, sibs.indexOf(m) + 1);
        if (el.textContent !== t) el.textContent = t;
      });
      var pl = root.querySelector('[data-plabel]');
      if (pl) pl.textContent = FAM.label(FAM.byRelation(ctx.b.family_members, 'participant'), r);
      D.qsa('[data-sa="age"]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(String(r.age) === b.getAttribute('data-v'))); });
      var iss = root.querySelector('[data-fam-issues]');
      if (iss) {
        var list = FAM.issues(r, ctx.b.family_members);
        iss.innerHTML = list.length ? '<div class="notice notice-warn">' + MF.icon('info') + '<div><strong>تحقق من بناء الأسرة</strong><ul>' + list.map(function (x) { return '<li>' + esc(x.text) + '</li>'; }).join('') + '</ul></div></div>' : (r.family_size != null ? '<p class="cb-ok">' + MF.icon('check', 'ic-sm') + '<span>بناء الأسرة متّسق مع العدد المدخل.</span></p>' : '');
      }
    },

    afterChoice: function (bind, v, opt, ctx) {
      if (bind === 's|registration|birth_order' || /^i\|family_members\|[^|]+\|birth_order$/.test(bind)) autoOlder(ctx);
      var m = /^i\|family_members\|([^|]+)\|(sel_disease|sel_surgery|sel_systemic)$/.exec(bind);
      if (m) {
        var mem = ctx.session.find(FMB, m[1]);
        var kind = { sel_disease: 'eye_disease', sel_surgery: 'eye_surgery', sel_systemic: 'systemic' }[m[2]];
        if (mem && mem[m[2]] && !fhList(ctx, mem.id, kind).length) {
          var e = ctx.session.add(FH, { member_id: mem.id, kind: kind, name: '', when: '', details: '' });
          K.focusLater(document, '[data-entry="' + e.id + '"] input');
        }
      }
    },
    afterInput: function (bind, v, el, ctx) {
      if (bind === 's|registration|family_size') reconcileLater(ctx);
      if (bind === 's|registration|birth_order' || /\|birth_order$/.test(bind)) autoOlder(ctx);
    },

    action: function (name, el, ctx) {
      var s = ctx.session, r = reg(ctx);
      if (name === 'part') { MF.flushCurrent(); ctx.goPart(el.getAttribute('data-part')); return; }
      if (name === 'age') { s.set('registration', 'age', parseInt(el.getAttribute('data-v'), 10)); return; }
      if (name === 'fs-step') {
        var cur = parseInt(r.family_size, 10), d = +el.getAttribute('data-d');
        var nv = isFinite(cur) ? cur + d : (d > 0 ? 3 : 3);
        nv = Math.max(3, Math.min(30, nv));
        s.set('registration', 'family_size', nv);
        reconcileSiblings(ctx);
        return;
      }
      if (name === 'add-sib') {
        var m = addSibling(ctx);
        K.focusLater(document, '[data-entry="' + m.id + '"] .opt');
        return;
      }
      if (name === 'add-oc') {
        var kind = el.getAttribute('data-kind');
        var e = s.add(OC, { kind: kind, subtype: null, name: '', reason: '', eye: null, when_kind: 'year', when: '', ongoing: null, stop_kind: 'year', stop_when: '' });
        K.focusLater(document, '[data-entry="' + e.id + '"] input[type="text"]');
        return;
      }
      if (name === 'add-sys') {
        var e2 = s.add(SY, { name: '', details: '' });
        K.focusLater(document, '[data-entry="' + e2.id + '"] input');
        return;
      }
      if (name === 'add-fh') {
        var e3 = s.add(FH, { member_id: el.getAttribute('data-member'), kind: el.getAttribute('data-kind'), name: '', when: '', details: '' });
        K.focusLater(document, '[data-entry="' + e3.id + '"] input');
        return;
      }
      if (name === 'rm') {
        var store = el.getAttribute('data-store');
        K.handleRemove(el, ctx, function () { if (store === FMB) autoOlder(ctx); });
        return;
      }
      if (name === 'kept-clear') clearKept(el.getAttribute('data-key'), ctx);
    }
  };

  function clearKept(key, ctx) {
    var s = ctx.session, r = reg(ctx);
    MF.ui.confirm({ title: 'مسح البيانات المخفية', message: 'ستُحذف البيانات المخفية لهذا السؤال نهائيًا. لا يمكن التراجع.', confirmLabel: 'مسح', danger: true }).then(function (ok) {
      if (!ok) return;
      var rmKind = function (store, pred) { s.list(store, pred).forEach(function (e) { s.remove(store, e.id).catch(function () {}); }); };
      var rel = ctx.b.family_members.filter(function (m) { return m.relation !== 'participant'; });
      if (key === 'glassesReasons') s.setMany('registration', { glasses_reasons: [], glasses_reason_other: '' });
      else if (key === 'ocDisease') rmKind(OC, function (e) { return e.kind === 'disease_injury'; });
      else if (key === 'ocSurgery') rmKind(OC, function (e) { return e.kind === 'surgery'; });
      else if (key === 'ocMed') rmKind(OC, function (e) { return e.kind === 'medication'; });
      else if (key === 'famGlasses') rel.forEach(function (m) { s.update(FMB, m.id, { glasses: false, glasses_type: null }); });
      else if (key === 'famDisease' || key === 'famSurgery' || key === 'sysFamily') {
        var sel = { famDisease: 'sel_disease', famSurgery: 'sel_surgery', sysFamily: 'sel_systemic' }[key];
        var kind = { famDisease: 'eye_disease', famSurgery: 'eye_surgery', sysFamily: 'systemic' }[key];
        rel.forEach(function (m) { var p = {}; p[sel] = false; s.update(FMB, m.id, p); });
        rmKind(FH, function (e) { return e.kind === kind; });
      }
      else if (key === 'sysSelf') rmKind(SY, function () { return true; });
      else if (key === 'symptoms') s.setMany('registration', { symptoms: [], blurry_loc: [], symptom_other: '' });
      else if (key === 'blurry') s.set('registration', 'blurry_loc', []);
      else if (key === 'antDetails') {
        var p2 = {};
        O.anteriorStructures.forEach(function (x) { p2['ant_' + x.v + '_od'] = ''; p2['ant_' + x.v + '_os'] = ''; });
        s.setMany('registration', p2);
      }
      MF.ui.toast('مُسحت البيانات المخفية.');
    });
  }
})();
