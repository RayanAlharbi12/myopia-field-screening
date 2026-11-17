/* =====================================================================
   إدارة النظام (Administrator only — the database enforces it as well):
   users, archived schools and participants, audit log, data (export all,
   full backup, Phase 1 import, restore), system status.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, ui = MF.ui, R = MF.remote;

  var TABS = [
    ['users', 'المستخدمون', 'users'],
    ['archive', 'الأرشيف', 'archive'],
    ['audit', 'سجل التدقيق', 'clock'],
    ['data', 'البيانات', 'sheet'],
    ['system', 'حالة النظام', 'info']
  ];

  var ACTION_AR = {
    'school.create': 'إنشاء مدرسة', 'school.update': 'تعديل مدرسة', 'school.archive': 'أرشفة مدرسة', 'school.restore': 'استعادة مدرسة',
    'participant.create': 'إنشاء مشارك', 'participant.change_id': 'تعديل رقم مشارك', 'participant.archive': 'أرشفة مشارك', 'participant.restore': 'استعادة مشارك',
    'participant_counter.set': 'تعديل عداد المشاركين', 'participant_counter.reset': 'إعادة ضبط عداد المشاركين',
    'user.create': 'إنشاء مستخدم', 'user.role_change': 'تغيير دور مستخدم', 'user.disable': 'تعطيل مستخدم', 'user.reactivate': 'إعادة تفعيل مستخدم',
    'user.rename': 'تعديل اسم مستخدم', 'user.password_reset': 'إعادة تعيين كلمة مرور', 'user.password_change': 'تغيير كلمة المرور',
    'user.password_change_failed': 'محاولة تغيير كلمة مرور فاشلة', 'user.bootstrap_admin': 'إنشاء أول مدير', 'data.import': 'استيراد بيانات'
  };

  function when(iso) { return MF.fmtDate(iso); }
  function statusOf(u) {
    if (!u.active) return '<span class="badge badge-warn">معطّل</span>';
    if (u.must_change_password) return '<span class="badge">بانتظار تغيير كلمة المرور</span>';
    return '<span class="badge badge-ok">' + MF.icon('check') + 'نشط</span>';
  }

  /* ---------- users ---------- */
  function userDialog() {
    var role = 'examiner';
    return ui.dialog({
      title: 'إضافة مستخدم',
      body:
        '<form class="form-grid" novalidate>' +
          '<div class="field"><label for="nu-name">الاسم</label><input id="nu-name" class="input" autocomplete="off" maxlength="120" autofocus></div>' +
          '<div class="field"><label for="nu-email">البريد الإلكتروني</label><input id="nu-email" class="input" type="email" dir="ltr" autocomplete="off" spellcheck="false" autocapitalize="off"></div>' +
          '<div class="field"><span class="label" id="nu-role-l">الدور</span><div class="choices grid-2" role="radiogroup" aria-labelledby="nu-role-l">' +
            '<button type="button" class="opt center" role="radio" aria-checked="true" data-role="examiner"><span class="mark"></span><span class="opt-t">فاحص</span></button>' +
            '<button type="button" class="opt center" role="radio" aria-checked="false" data-role="admin"><span class="mark"></span><span class="opt-t">مدير النظام</span></button></div></div>' +
          MF.shell.passwordField('nu-pw', 'كلمة المرور المؤقتة', 'new-password') +
          MF.shell.passwordField('nu-pw2', 'تأكيد كلمة المرور المؤقتة', 'new-password') +
          '<p class="hint">' + MF.shell.PW_RULE + ' سيُطلب من المستخدم تغييرها عند أول دخول. سلّمها له بطريقة آمنة.</p>' +
          '<p class="field-error" role="alert" hidden></p>' +
        '</form>',
      actions: [{ label: 'إلغاء', value: null }, {
        label: 'إنشاء المستخدم', kind: 'primary', value: 'ok', onClick: function (api) {
          var el = api.el, err = el.querySelector('.field-error'), go = api.action(1);
          var name = el.querySelector('#nu-name').value.trim(), email = el.querySelector('#nu-email').value.trim().toLowerCase();
          var pw = el.querySelector('#nu-pw').value, pw2 = el.querySelector('#nu-pw2').value;
          var problem = !name ? 'الاسم مطلوب.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? MF.err.MSG.INVALID_EMAIL : MF.shell.checkNewPassword(pw, pw2);
          if (problem) { err.textContent = problem; err.hidden = false; return false; }
          err.hidden = true; go.disabled = true;
          R.invoke('admin-create-user', { email: email, full_name: name, role: role, password: pw }).then(function (res) {
            api.close(res.user);
            ui.toast('تم إنشاء المستخدم بنجاح');
          }, function (e) { go.disabled = false; err.textContent = MF.err.message(e); err.hidden = false; });
          return false;
        }
      }],
      onMount: function (el) {
        MF.shell.bindPasswordToggles(el);
        D.on(el, 'click', '[data-role]', function (e, b) { role = b.getAttribute('data-role'); D.qsa('[data-role]', el).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); }); });
        el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); });
      }
    });
  }

  function resetPasswordDialog(u) {
    return ui.dialog({
      title: 'إعادة تعيين كلمة المرور',
      body: '<p class="dlg-text">كلمة مرور مؤقتة جديدة لـ <strong>' + esc(u.full_name) + '</strong> <bdi>' + esc(u.email) + '</bdi>. سيُطلب منه تغييرها عند الدخول التالي.</p>' +
        '<form class="form-grid" novalidate>' + MF.shell.passwordField('rp-pw', 'كلمة المرور المؤقتة', 'new-password') + MF.shell.passwordField('rp-pw2', 'تأكيد كلمة المرور المؤقتة', 'new-password') +
        '<p class="hint">' + MF.shell.PW_RULE + '</p><p class="field-error" role="alert" hidden></p></form>',
      actions: [{ label: 'إلغاء', value: null }, {
        label: 'تعيين كلمة المرور', kind: 'primary', value: 'ok', onClick: function (api) {
          var el = api.el, err = el.querySelector('.field-error'), go = api.action(1);
          var pw = el.querySelector('#rp-pw').value, pw2 = el.querySelector('#rp-pw2').value;
          var problem = MF.shell.checkNewPassword(pw, pw2);
          if (problem) { err.textContent = problem; err.hidden = false; return false; }
          go.disabled = true;
          R.invoke('admin-reset-user-password', { user_id: u.id, password: pw }).then(function () { api.close('ok'); ui.toast('عُيّنت كلمة مرور مؤقتة جديدة.'); },
            function (e) { go.disabled = false; err.textContent = MF.err.message(e); err.hidden = false; });
          return false;
        }
      }],
      onMount: function (el) { MF.shell.bindPasswordToggles(el); el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); }); }
    });
  }

  function usersTab(box, ctx) {
    function load() {
      box.innerHTML = '<div class="skeleton" aria-hidden="true"></div>';
      return R.users().then(function (list) {
        ctx.users = list;
        var me = MF.auth.user && MF.auth.user.id;
        box.innerHTML =
          '<div class="adm-head"><p class="page-sub">' + list.length + ' مستخدم — الصلاحيات يفرضها الخادم وقاعدة البيانات.</p>' +
            '<button type="button" class="btn btn-primary" data-u="add">' + MF.icon('plus') + '<span>إضافة مستخدم</span></button></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الدور</th><th>الحالة</th><th>آخر دخول للتطبيق</th><th><span class="sr-only">إجراءات</span></th></tr></thead><tbody>' +
          list.map(function (u) {
            return '<tr' + (u.active ? '' : ' class="is-off"') + '><td data-l="الاسم"><strong>' + esc(u.full_name) + '</strong>' + (u.id === me ? ' <small class="muted">(أنت)</small>' : '') + '</td>' +
              '<td data-l="البريد"><bdi>' + esc(u.email) + '</bdi></td><td data-l="الدور">' + MF.roleAr(u.role) + '</td><td data-l="الحالة">' + statusOf(u) + '</td><td data-l="آخر دخول">' + when(u.last_application_access) + '</td>' +
              '<td class="td-act"><button type="button" class="icon-btn" data-u="menu" data-id="' + esc(u.id) + '" aria-label="إجراءات ' + esc(u.full_name) + '">' + MF.icon('more') + '</button></td></tr>';
          }).join('') + '</tbody></table></div>';
      }, function (err) { box.innerHTML = '<div class="notice notice-danger">' + MF.icon('warn') + '<div>' + esc(MF.err.message(err)) + '</div></div>'; });
    }
    function find(id) { return (ctx.users || []).filter(function (u) { return u.id === id; })[0]; }
    function fail(e) { ui.alert({ title: 'لم يُنفَّذ الإجراء', message: esc(MF.err.message(e)) }); }
    var off = D.on(box, 'click', '[data-u]', function (e, b) {
      var a = b.getAttribute('data-u');
      if (a === 'add') { userDialog().then(function (u) { if (u) load(); }); return; }
      var u = find(b.getAttribute('data-id'));
      if (!u) return;
      var me = MF.auth.user && MF.auth.user.id === u.id;
      ui.menu(b, [
        { label: 'تعديل الاسم', icon: 'edit', value: 'name' },
        { label: u.role === 'admin' ? 'تغيير الدور إلى فاحص' : 'تغيير الدور إلى مدير النظام', icon: 'users', value: 'role' },
        { label: 'إعادة تعيين كلمة المرور', icon: 'lock', value: 'reset' },
        { divider: true },
        { label: u.active ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب', icon: u.active ? 'x' : 'restore', value: 'status', danger: u.active }
      ]).then(function (v) {
        if (v === 'role') {
          var to = u.role === 'admin' ? 'examiner' : 'admin';
          ui.confirm({
            title: 'تغيير الدور',
            message: 'سيصبح <strong>' + esc(u.full_name) + '</strong> ' + MF.roleAr(to) + '.' + (to === 'admin' ? ' سيتمكن من إدارة المستخدمين والعدادات والأرشفة والتصدير الكامل.' : ' سيفقد صلاحيات الإدارة.') + (me ? ' (هذا حسابك.)' : ''),
            confirmLabel: 'تغيير الدور', danger: to === 'examiner'
          }).then(function (ok) { if (ok) R.setUserRole(u.id, to).then(function () { ui.toast('تم تغيير الدور.'); load(); if (me) MF.auth.recheck(); }, fail); });
        } else if (v === 'status') {
          if (u.active) {
            ui.confirm({
              title: 'تعطيل الحساب',
              message: 'لن يتمكن <strong>' + esc(u.full_name) + '</strong> من الدخول أو الوصول إلى بيانات البحث، وتنتهي جلساته. لا تُحذف أي بيانات أدخلها.' + (me ? ' تحذير: هذا حسابك وستخرج من النظام.' : ''),
              confirmLabel: 'تعطيل', danger: true
            }).then(function (ok) {
              if (ok) R.invoke('admin-user-status', { user_id: u.id, active: false }).then(function (r) { ui.toast(r && r.warning ? MF.err.MSG.SESSIONS_NOT_UPDATED : 'عُطّل الحساب.'); load(); if (me) MF.auth.recheck(); }, fail);
            });
          } else R.invoke('admin-user-status', { user_id: u.id, active: true }).then(function () { ui.toast('أُعيد تفعيل الحساب.'); load(); }, fail);
        } else if (v === 'reset') resetPasswordDialog(u).then(function (ok) { if (ok) load(); });
        else if (v === 'name') {
          ui.dialog({
            title: 'تعديل الاسم',
            body: '<div class="field"><label for="un-n">الاسم</label><input id="un-n" class="input" maxlength="120" value="' + esc(u.full_name) + '"></div><p class="field-error" role="alert" hidden></p>',
            actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', kind: 'primary', value: 'ok', onClick: function (api) {
              var n = api.el.querySelector('#un-n').value.trim(), err = api.el.querySelector('.field-error');
              if (!n) { err.textContent = 'الاسم مطلوب.'; err.hidden = false; return false; }
              R.setUserName(u.id, n).then(function () { api.close('ok'); ui.toast('حُفظ الاسم.'); load(); }, function (e2) { err.textContent = MF.err.message(e2); err.hidden = false; });
              return false;
            } }]
          });
        }
      });
    });
    load();
    return off;
  }

  /* ---------- archive ---------- */
  function archiveTab(box) {
    function load() {
      box.innerHTML = '<div class="skeleton" aria-hidden="true"></div>';
      return Promise.all([MF.SchoolRepository.archived(), R.archivedParticipants(), R.schools({})]).then(function (r) {
        var schools = r[0], parts = r[1], byId = {};
        r[2].forEach(function (s) { byId[s.id] = s; });
        box.innerHTML =
          '<section class="set-sec"><h3 class="mini-h">المدارس المؤرشفة (' + schools.length + ')</h3>' +
          (schools.length ? '<div class="arch-list">' + schools.map(function (s) {
            return '<div class="arch-row"><span class="num-badge num">' + s.number + '</span><span class="arch-t"><strong>' + esc(s.name) + '</strong><small>' + esc(s.city) + ' — أُرشفت ' + when(s.archived_at) + '</small></span>' +
              '<a class="btn btn-quiet" href="#/' + MF.routeFor.school(s.id) + '">فتح</a><button type="button" class="btn" data-rs="' + esc(s.id) + '">' + MF.icon('restore') + 'استعادة</button></div>';
          }).join('') + '</div>' : '<p class="hint">لا توجد مدارس مؤرشفة.</p>') + '</section>' +
          '<section class="set-sec"><h3 class="mini-h">المشاركون المؤرشفون (' + parts.length + ')</h3>' +
          (parts.length ? '<div class="arch-list">' + parts.map(function (p) {
            var s = byId[p.school_id];
            return '<div class="arch-row">' + D.ltr(p.code, 'pid') + '<span class="arch-t"><strong>' + (p.name ? esc(p.name) : '<span class="muted">بدون اسم</span>') + '</strong><small>' + (s ? esc(s.name) : '') + ' — أُرشف ' + when(p.archived_at) + '</small></span>' +
              '<a class="btn btn-quiet" href="#/' + MF.routeFor.participant(p.id) + '">فتح</a><button type="button" class="btn" data-rp="' + esc(p.id) + '">' + MF.icon('restore') + 'استعادة</button></div>';
          }).join('') + '</div>' : '<p class="hint">لا يوجد مشاركون مؤرشفون.</p>') +
          '<p class="hint">الأرقام المؤرشفة لا يُعاد استخدامها تلقائيًا.</p></section>';
      }, function (err) { box.innerHTML = '<div class="notice notice-danger">' + MF.icon('warn') + '<div>' + esc(MF.err.message(err)) + '</div></div>'; });
    }
    var off = D.on(box, 'click', '[data-rs], [data-rp]', function (e, b) {
      b.disabled = true;
      var job = b.hasAttribute('data-rs') ? MF.SchoolRepository.setArchived(b.getAttribute('data-rs'), false) : MF.ParticipantRepository.setArchived(b.getAttribute('data-rp'), false);
      job.then(function () { ui.toast('تمت الاستعادة.'); load(); }, function (err) { b.disabled = false; ui.alert({ title: 'تعذّرت الاستعادة', message: esc(MF.err.message(err)) }); });
    });
    load();
    return off;
  }

  /* ---------- audit ---------- */
  function auditTab(box, ctx) {
    var st = { offset: 0, prefix: '' };
    var names = {};
    function details(r) {
      var m = r.metadata || {}, parts = [];
      if (m.code) parts.push(D.ltr(m.code));
      if (m.from != null && m.to != null) parts.push(D.ltr(String(m.from)) + ' ← ' + D.ltr(String(m.to)));
      if (m.email) parts.push('<bdi>' + esc(m.email) + '</bdi>');
      if (m.number != null) parts.push('المدرسة ' + D.ltr(m.number));
      if (m.school_number != null && m.code == null) parts.push('المدرسة ' + D.ltr(m.school_number));
      if (m.name) parts.push(esc(m.name));
      if (m.role) parts.push(MF.roleAr(m.role));
      if (r.action === 'data.import') parts.push('مدارس جديدة ' + (m.schools_new || 0) + '، مشاركون جدد ' + (m.participants_new || 0));
      return parts.join(' — ');
    }
    function load() {
      return Promise.all([R.audit({ offset: st.offset, limit: 50, prefix: st.prefix }), ctx.users ? Promise.resolve(ctx.users) : R.users()]).then(function (r) {
        ctx.users = r[1];
        r[1].forEach(function (u) { names[u.id] = u.full_name; });
        var res = r[0];
        var list = box.querySelector('[data-audit]');
        list.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>التفاصيل</th></tr></thead><tbody>' +
          (res.rows.length ? res.rows.map(function (a) {
            return '<tr><td data-l="الوقت">' + when(a.performed_at) + '</td><td data-l="المستخدم">' + esc(names[a.performed_by] || (a.performed_by ? '—' : 'النظام')) + '</td><td data-l="الإجراء">' + esc(ACTION_AR[a.action] || a.action) + '</td><td data-l="التفاصيل">' + details(a) + '</td></tr>';
          }).join('') : '<tr><td colspan="4" class="muted">لا توجد سجلات.</td></tr>') + '</tbody></table></div>' +
          '<div class="pager"><button type="button" class="btn" data-pg="prev"' + (st.offset ? '' : ' disabled') + '>السابق</button>' +
          '<span class="muted">' + (res.total ? (st.offset + 1) + '–' + (st.offset + res.rows.length) + ' من ' + res.total : '') + '</span>' +
          '<button type="button" class="btn" data-pg="next"' + (st.offset + res.rows.length < res.total ? '' : ' disabled') + '>التالي</button></div>';
      }, function (err) { box.querySelector('[data-audit]').innerHTML = '<div class="notice notice-danger">' + MF.icon('warn') + '<div>' + esc(MF.err.message(err)) + '</div></div>'; });
    }
    box.innerHTML = '<div class="adm-head"><div class="filters choices" role="group" aria-label="تصفية السجل">' +
      [['', 'الكل'], ['user.', 'المستخدمون'], ['participant', 'المشاركون والعدادات'], ['school.', 'المدارس'], ['data.', 'الاستيراد']].map(function (f, i) {
        return '<button type="button" class="opt compact" aria-pressed="' + (i === 0) + '" data-af="' + f[0] + '">' + f[1] + '</button>';
      }).join('') + '</div></div><div data-audit><div class="skeleton" aria-hidden="true"></div></div>' +
      '<p class="hint">يُسجَّل كل إجراء إداري وإنشاء المشاركين. لا تُسجَّل كلمات المرور أبدًا.</p>';
    var off = D.on(box, 'click', '[data-pg], [data-af]', function (e, b) {
      if (b.hasAttribute('data-af')) {
        st.prefix = b.getAttribute('data-af'); st.offset = 0;
        D.qsa('[data-af]', box).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      } else st.offset = Math.max(0, st.offset + (b.getAttribute('data-pg') === 'next' ? 50 : -50));
      load();
    });
    load();
    return off;
  }

  /* ---------- data ---------- */
  function dataTab(box) {
    box.innerHTML =
      '<div class="action-list">' +
        '<button type="button" class="action-row" data-d="export">' + MF.icon('sheet') + '<span><strong>تصدير جميع البيانات (Excel)</strong><small>كل المدارس النشطة من قاعدة البيانات — بدون أسماء المشاركين</small></span></button>' +
        '<button type="button" class="action-row" data-d="backup">' + MF.icon('download') + '<span><strong>تصدير نسخة احتياطية كاملة</strong><small>ملف JSON بكل الجداول (يحتوي الأسماء — احفظه بأمان)</small></span></button>' +
        '<button type="button" class="action-row" data-d="phase1">' + MF.icon('upload') + '<span><strong>استيراد نسخة من النظام الأوفلاين</strong><small>ملف النسخة الاحتياطية من المرحلة الأولى — تشغيل تجريبي وملخص قبل أي كتابة</small></span></button>' +
        '<button type="button" class="action-row" data-d="restore">' + MF.icon('restore') + '<span><strong>استعادة نسخة احتياطية كاملة</strong><small>يُضاف ما ليس موجودًا فقط؛ لا يُستبدل ولا يُحذف أي سجل</small></span></button>' +
      '</div>';
    return D.on(box, 'click', '[data-d]', function (e, b) {
      var a = b.getAttribute('data-d');
      if (a === 'export') MF.actions.exportExcel(null, b);
      else if (a === 'backup') MF.actions.fullBackup();
      else if (a === 'phase1') MF.actions.importData('phase1');
      else if (a === 'restore') MF.actions.importData('phase2');
    });
  }

  function systemTab(box) {
    var cfg = MF.env.config;
    box.innerHTML = '<dl class="kv">' +
      '<div><dt>إصدار التطبيق</dt><dd>' + D.ltr(MF.VERSION) + '</dd></div>' +
      '<div><dt>البيئة</dt><dd>' + esc(MF.env.environment.ar) + '</dd></div>' +
      '<div><dt>الخادم</dt><dd>' + D.ltr(cfg.url.replace(/^https?:\/\//, '')) + '</dd></div>' +
      '<div><dt>نوع المفتاح في المتصفح</dt><dd>' + (/^sb_publishable_/.test(cfg.key) ? 'publishable (عام)' : 'anon (عام — قديم)') + '</dd></div>' +
      '<div><dt>قاعدة البيانات</dt><dd data-db>…</dd></div>' +
      '<div><dt>خدمة الحسابات (Edge Functions)</dt><dd data-fn>…</dd></div>' +
      '</dl><button type="button" class="btn" data-sys="about">' + MF.icon('info') + 'حول النظام</button>';
    var t0 = Date.now();
    R.schoolStats().then(function () { box.querySelector('[data-db]').innerHTML = '<span class="badge badge-ok">' + MF.icon('check') + 'متصلة</span> <small class="muted">' + D.ltr((Date.now() - t0) + ' ms') + '</small>'; },
      function (e) { box.querySelector('[data-db]').innerHTML = '<span class="badge badge-warn">' + esc(MF.err.message(e)) + '</span>'; });
    /* a request without a body: a deployed function answers BAD_REQUEST, which proves it is reachable */
    R.invoke('admin-user-status', {}).then(function () { box.querySelector('[data-fn]').innerHTML = '<span class="badge badge-ok">متاحة</span>'; }, function (e) {
      var ok = e.code === 'BAD_REQUEST' || e.code === 'NOT_ADMIN';
      box.querySelector('[data-fn]').innerHTML = ok ? '<span class="badge badge-ok">' + MF.icon('check') + 'متاحة</span>' : '<span class="badge badge-warn">' + esc(MF.err.message(e)) + '</span>';
    });
    return D.on(box, 'click', '[data-sys]', function () { MF.actions.about(); });
  }

  MF.screens.admin = {
    mount: function (root, route) {
      var tab = TABS.some(function (t) { return t[0] === route.tab; }) ? route.tab : 'users';
      root.innerHTML =
        '<header class="appbar"><div class="appbar-in">' +
          '<a class="icon-btn back" href="#/" aria-label="العودة إلى المدارس">' + MF.icon('back') + '</a>' +
          '<div class="bar-title"><span class="bar-kicker">مدير النظام</span><strong>إدارة النظام</strong></div>' +
          '<div class="bar-actions">' + MF.shell.barEnd() + '</div></div></header>' +
        '<main class="page admin" id="main"><div class="page-in">' +
          '<nav class="adm-tabs" aria-label="أقسام الإدارة">' + TABS.map(function (t) {
            return '<a class="adm-tab' + (t[0] === tab ? ' is-current' : '') + '" href="#/' + MF.routeFor.admin(t[0]) + '"' + (t[0] === tab ? ' aria-current="page"' : '') + '>' + MF.icon(t[2], 'ic-sm') + '<span>' + t[1] + '</span></a>';
          }).join('') + '</nav>' +
          '<h2 class="page-title">' + (tab === 'users' ? 'إدارة المستخدمين' : TABS.filter(function (t) { return t[0] === tab; })[0][1]) + '</h2>' +
          (MF.net.online ? '' : '<div class="notice notice-warn">' + MF.icon('cloudOff') + '<div>الإدارة تتطلب اتصالًا بالإنترنت.</div></div>') +
          '<div data-tab></div>' +
        '</div></main>';
      var box = root.querySelector('[data-tab]'), ctx = {};
      var offTab = tab === 'users' ? usersTab(box, ctx) : tab === 'archive' ? archiveTab(box) : tab === 'audit' ? auditTab(box, ctx) : tab === 'data' ? dataTab(box) : systemTab(box);
      var off = D.on(root, 'click', '.appbar [data-act]', function (e, b) { MF.shell.handleAct(b.getAttribute('data-act'), b); });
      return { unmount: function () { off(); if (offTab) offTab(); } };
    }
  };
})();
