/* Shared shell pieces: logo, app bar, empty-state art, and app-level actions
   (Excel export, Administrator backup / import, settings, archived schools). */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, ui = MF.ui;

  MF.LOGO_SRC = window.MF_LOGO_SRC || 'assets/logo.svg';
  MF.APP_TITLE = 'نظام الفحص الميداني لقصر النظر';
  MF.APP_SUB = 'Myopia Field Screening — Research System';

  var shell = MF.shell = {};

  /* the official logo, unaltered; in dark mode it sits on a light tile */
  shell.logo = function (cls) {
    return '<span class="logo-tile' + (cls ? ' ' + cls : '') + '"><img src="' + esc(MF.LOGO_SRC) + '" alt="شعار الفحص البصري المدرسي" width="40" height="40" decoding="async"></span>';
  };

  shell.themeButton = function () {
    return '<button type="button" class="icon-btn" data-act="theme" data-theme-icon aria-label="تبديل المظهر (فاتح / داكن)">' + MF.icon(MF.theme.effective() === 'dark' ? 'sun' : 'moon') + '</button>';
  };

  /* quiet geometric accent for empty states: partial rings and the logo's arc */
  shell.emptyArt = function () {
    return '<svg class="empty-art" viewBox="0 0 160 120" aria-hidden="true">' +
      '<circle cx="80" cy="58" r="44" fill="none" stroke="var(--line-2)" stroke-width="1.5" stroke-dasharray="3 5"/>' +
      '<path d="M44 58a36 36 0 0 1 72 0" fill="none" stroke="var(--accent-line)" stroke-width="2" stroke-linecap="round"/>' +
      '<circle cx="80" cy="58" r="18" fill="var(--accent-soft)"/>' +
      '<path d="M73 50h14M73 58h11M73 66h14M73 50v16" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
      '<path d="M50 104q30-8 60 0" fill="none" stroke="var(--gold)" stroke-width="2.4" stroke-linecap="round"/>' +
      '</svg>';
  };

  /* ---------- actions ---------- */
  var actions = MF.actions = {};

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return D.ltr(new Date(iso).toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })); } catch (e) { return D.ltr(iso); }
  }
  MF.fmtDate = fmtDate;

  /* Excel export from the canonical database (names are never exported) */
  actions.exportExcel = function (schoolId, btn) {
    if (!schoolId && !MF.auth.isAdmin()) { ui.alert({ title: 'غير متاح', message: 'تصدير جميع البيانات متاح لمدير النظام فقط. يمكنك تصدير بيانات مدرسة من صفحتها.' }); return Promise.resolve(); }
    if (btn) btn.disabled = true;
    var hide = ui.toast('جارٍ تجهيز ملف Excel…', { timeout: 60000 });
    return MF.flushCurrent().then(function () { return MF.DataService.snapshot(schoolId || null); }).then(function (res) {
      return MF.ExportService.exportWorkbook({ schoolId: schoolId || null, snapshot: res.snap }).then(function (r) {
        hide();
        D.downloadBlob(r.filename, r.blob);
        if (res.source === 'cache') ui.alert({ title: 'تم التصدير من نسخة هذا الجهاز', message: 'لا يوجد اتصال بالإنترنت، فصُدّر الملف (' + r.count + ' مشارك) من بيانات المدرسة المجهزة على هذا الجهاز بتاريخ ' + fmtDate(res.at) + ' مع تعديلات هذا الجهاز. قد لا يتضمن تعديلات أجهزة أخرى بعد ذلك.' });
        else ui.toast('تم إنشاء ملف Excel من قاعدة البيانات (' + r.count + ' مشارك).');
      });
    }).catch(function (err) {
      hide();
      MF.log(err);
      ui.alert({ title: 'تعذّر التصدير', message: 'لم يُنشأ ملف Excel. لم تتغيّر أي بيانات. ' + esc(MF.err.message(err)) });
    }).then(function () { if (btn) btn.disabled = false; });
  };

  /* تصدير نسخة احتياطية كاملة — Administrator */
  actions.fullBackup = function () {
    return ui.confirm({
      title: 'تصدير نسخة احتياطية كاملة',
      message: 'سيُنشأ ملف JSON بكل المدارس والمشاركين وبياناتهم وسجل التدقيق من قاعدة البيانات.',
      extra: '<div class="notice notice-warn">' + MF.icon('warn') + '<div><strong>الملف يحتوي أسماء المشاركين وبيانات بحثية حساسة.</strong><p>احفظه في مكان آمن ومشفّر، ولا ترسله عبر قنوات غير آمنة. حسابات المستخدمين وكلمات المرور غير مشمولة.</p></div></div>',
      confirmLabel: 'تصدير النسخة'
    }).then(function (ok) {
      if (!ok) return;
      var hide = ui.toast('جارٍ تجهيز النسخة الاحتياطية…', { timeout: 120000 });
      return MF.DataService.fullBackup().then(function (r) {
        hide();
        D.downloadBlob(r.filename, r.blob);
        ui.toast('تم تصدير النسخة الاحتياطية (' + r.summary.schools + ' مدرسة، ' + r.summary.participants + ' مشارك).');
      }, function (err) { hide(); ui.alert({ title: 'تعذّر تصدير النسخة الاحتياطية', message: esc(MF.err.message(err)) }); });
    });
  };

  /* استيراد نسخة من النظام الأوفلاين / استعادة نسخة كاملة — Administrator.
     validate -> dry run (nothing written) -> summary + conflicts -> explicit confirmation -> import.
     Existing online records are never overwritten; Participant IDs are kept. */
  actions.importData = function (expect) {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      if (!MF.net.online) { ui.alert({ title: 'لا يوجد اتصال', message: MF.err.MSG.OFFLINE_ACTION }); return; }
      MF.DataService.readImportFile(f).then(function (parsed) {
        if (!parsed.ok) {
          return ui.dialog({
            title: 'الملف غير صالح للاستيراد',
            body: '<div class="notice notice-danger">' + MF.icon('warn') + '<div><strong>لم يُستورد شيء ولم تتغيّر قاعدة البيانات.</strong><ul>' + parsed.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div></div>',
            actions: [{ label: 'إغلاق', value: true, kind: 'primary' }]
          });
        }
        if (expect && parsed.kind !== expect) {
          return ui.alert({ title: 'نوع الملف مختلف', message: parsed.kind === 'phase1' ? 'هذا ملف من النظام الأوفلاين (المرحلة الأولى). استخدم «استيراد نسخة من النظام الأوفلاين».' : 'هذا ملف نسخة احتياطية كاملة من النظام الإلكتروني. استخدم «استعادة نسخة احتياطية كاملة».' });
        }
        var hide = ui.toast('جارٍ التحقق (تشغيل تجريبي دون كتابة)…', { timeout: 120000 });
        return MF.DataService.importDryRun(parsed).then(function (plan) {
          hide();
          return confirmImport(f, parsed, plan);
        }, function (err) { hide(); ui.alert({ title: 'تعذّر التحقق من الملف', message: 'لم يُستورد شيء. ' + esc(MF.err.message(err)) }); });
      });
    });
    input.click();
  };

  function conflictText(c) {
    if (c.type === 'school_number') return 'المدرسة رقم ' + D.iso(c.school_number) + ' (' + c.name + '): الرقم مستخدم لمدرسة أخرى في قاعدة البيانات — لن تُستورد هي ومشاركوها.';
    if (c.type === 'participant_id') return 'رقم المشارك ' + D.iso(c.code) + ' مستخدم لمشارك آخر في قاعدة البيانات — لن يُستورد.';
    if (c.type === 'school_skipped') return 'المشارك ' + D.iso(c.code) + ' يتبع مدرسة لن تُستورد.';
    return JSON.stringify(c);
  }

  function confirmImport(f, parsed, plan) {
    var nothing = !plan.schools_new && !plan.participants_new;
    var body =
      '<p class="dlg-text">الملف: <bdi>' + esc(f.name) + '</bdi> — ' + (parsed.kind === 'phase1' ? 'نسخة من النظام الأوفلاين (المرحلة الأولى)' : 'نسخة احتياطية كاملة من النظام الإلكتروني') +
        (parsed.meta && parsed.meta.exported_at ? '، بتاريخ ' + fmtDate(parsed.meta.exported_at) : '') + '.</p>' +
      '<h3 class="mini-h">نتيجة التشغيل التجريبي (لم يُكتب شيء بعد)</h3>' +
      '<dl class="kv"><div><dt>مدارس جديدة</dt><dd class="num">' + plan.schools_new + '</dd></div>' +
        '<div><dt>مدارس موجودة (يُضاف إليها الجديد فقط)</dt><dd class="num">' + plan.schools_matched + '</dd></div>' +
        '<div><dt>مشاركون جدد</dt><dd class="num">' + plan.participants_new + '</dd></div>' +
        '<div><dt>مشاركون موجودون مسبقًا (لن يُغيَّروا)</dt><dd class="num">' + plan.participants_existing + '</dd></div>' +
        '<div><dt>تعارضات</dt><dd class="num">' + plan.conflicts.length + '</dd></div></dl>' +
      (plan.conflicts.length ? '<div class="notice notice-warn">' + MF.icon('warn') + '<div><strong>لن تُستورد العناصر التالية:</strong><ul>' + plan.conflicts.slice(0, 10).map(function (c) { return '<li>' + esc(conflictText(c)) + '</li>'; }).join('') + (plan.conflicts.length > 10 ? '<li>… و' + (plan.conflicts.length - 10) + ' غيرها</li>' : '') + '</ul></div></div>' : '') +
      '<p class="hint">تُحفظ أرقام المشاركين كما هي (مثل ' + D.ltr('1-1') + ')، وتتقدّم العدادات بعدها. لا يُحذف ولا يُستبدل أي سجل موجود. تُستورد كل مدرسة في عملية واحدة كاملة.</p>' +
      (nothing ? '' : '<label class="check-line"><input type="checkbox" class="imp-ok"> <span>راجعت الملخص وأريد الاستيراد إلى قاعدة البيانات.</span></label>');
    return ui.dialog({
      title: 'تأكيد الاستيراد', body: body, wide: true,
      actions: nothing ? [{ label: 'إغلاق', value: null, kind: 'primary' }] : [{ label: 'إلغاء', value: null }, { label: 'استيراد', value: 'go', kind: 'primary', disabled: true }],
      onMount: function (el, api) {
        var c = el.querySelector('.imp-ok');
        if (c) c.addEventListener('change', function () { api.action(1).disabled = !c.checked; });
      }
    }).then(function (v) {
      if (v !== 'go') return;
      var hide = ui.toast('جارٍ الاستيراد…', { timeout: 300000 });
      return MF.DataService.importApply(parsed).then(function (res) {
        hide();
        var msg = 'أُضيفت ' + res.schools_new + ' مدرسة و' + res.participants_new + ' مشارك.';
        if (res.failed.length) msg += ' لم تُستورد المدارس: ' + res.failed.map(function (x) { return x.school + ' (' + x.message + ')'; }).join('، ') + '.';
        ui.alert({ title: res.failed.length ? 'اكتمل الاستيراد جزئيًا' : 'اكتمل الاستيراد', message: esc(msg) });
        MF.reroute();
      }, function (err) { hide(); ui.alert({ title: 'لم يكتمل الاستيراد', message: esc(MF.err.message(err)) }); });
    });
  }

  actions.settingsSheet = function () {
    var t = MF.theme.get();
    function themeOpt(v, label) { return '<button type="button" class="opt compact center" role="radio" aria-checked="' + (t === v) + '" data-theme-v="' + v + '"><span class="mark"></span><span class="opt-t">' + label + '</span></button>'; }
    var est = MF.cache.db ? MF.cache.db.estimate() : Promise.resolve({});
    return Promise.all([est, MF.sync.outbox()]).then(function (r) {
      var e = r[0] || {}, pending = r[1].length;
      var used = e.usage != null ? (e.usage / 1024 / 1024).toFixed(1) + ' MB' : '—';
      return ui.dialog({
        title: 'الإعدادات',
        body:
          '<section class="set-sec"><h3 class="mini-h">المظهر</h3><div class="choices grid-3" role="radiogroup">' + themeOpt('light', 'فاتح') + themeOpt('dark', 'داكن') + themeOpt('auto', 'حسب الجهاز') + '</div></section>' +
          '<section class="set-sec"><h3 class="mini-h">هذا الجهاز</h3>' +
            '<dl class="kv"><div><dt>مصدر البيانات</dt><dd>قاعدة البيانات على الخادم (Supabase)</dd></div>' +
            '<div><dt>النسخة المحلية</dt><dd>نسخة مؤقتة للعمل دون اتصال، لهذا الحساب فقط</dd></div>' +
            '<div><dt>المساحة المستخدمة</dt><dd class="num">' + used + '</dd></div>' +
            '<div><dt>تغييرات بانتظار الإرسال</dt><dd class="num">' + pending + '</dd></div></dl>' +
            '<button type="button" class="btn btn-danger-quiet btn-block" data-a="clear-cache"' + (pending ? ' disabled' : '') + '>' + MF.icon('trash') + 'مسح النسخة المحلية من هذا الجهاز</button>' +
            (pending ? '<p class="hint">لا يمكن المسح قبل مزامنة التغييرات المعلّقة.</p>' : '<p class="hint">لا يؤثر على قاعدة البيانات؛ تُحمَّل البيانات من جديد عند الحاجة.</p>') +
          '</section>',
        onMount: function (el, api) {
          D.on(el, 'click', '[data-theme-v]', function (ev, b) {
            MF.theme.set(b.getAttribute('data-theme-v'));
            D.qsa('[data-theme-v]', el).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
          });
          D.on(el, 'click', '[data-a="clear-cache"]', function () {
            api.close();
            ui.confirm({ title: 'مسح النسخة المحلية', message: 'ستُحذف البيانات المؤقتة لهذا الحساب من هذا الجهاز. قاعدة البيانات على الخادم لا تتأثر.', confirmLabel: 'مسح', danger: true }).then(function (ok) {
              if (!ok) return;
              var uid = MF.auth.user && MF.auth.user.id;
              MF.cache.destroy(uid).then(function () { return MF.cache.open(uid); }).then(function () { ui.toast('مُسحت النسخة المحلية.'); MF.reroute(); });
            });
          });
        }
      });
    });
  };

  actions.archivedSchools = function () {
    return MF.SchoolRepository.archived().then(function (list) {
      return ui.dialog({
        title: 'المدارس المؤرشفة',
        body: list.length ? '<div class="arch-list">' + list.map(function (s) {
          return '<div class="arch-row"><span class="num-badge num">' + s.number + '</span><span class="arch-t"><strong>' + esc(s.name) + '</strong><small>' + esc(s.city) + ' — ' + MF.OPT.ar('schoolType', s.type) + '</small></span>' +
            '<a class="btn btn-quiet" href="#/' + MF.routeFor.school(s.id) + '">فتح</a>' +
            '<button type="button" class="btn" data-restore="' + esc(s.id) + '">' + MF.icon('restore') + 'استعادة</button></div>';
        }).join('') + '</div><p class="hint">أرقام المدارس المؤرشفة لا يُعاد استخدامها.</p>' : '<p class="dlg-text">لا توجد مدارس مؤرشفة.</p>',
        onMount: function (el, api) {
          D.on(el, 'click', '[data-restore]', function (e, b) {
            b.disabled = true;
            MF.SchoolRepository.setArchived(b.getAttribute('data-restore'), false).then(function () {
              api.close(); ui.toast('تمت استعادة المدرسة.'); MF.reroute();
            }, function (err) { b.disabled = false; ui.alert({ title: 'تعذّرت الاستعادة', message: esc(MF.err.message(err)) }); });
          });
          D.on(el, 'click', 'a', function () { api.close(); });
        }
      });
    }, function (err) { ui.alert({ title: 'تعذّر عرض المدارس المؤرشفة', message: esc(MF.err.message(err)) }); });
  };
})();
