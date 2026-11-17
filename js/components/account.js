/* =====================================================================
   Account and synchronisation controls shared by every screen:
   the sync / connectivity chip, the account menu, change password,
   sign out (with unsynchronised-changes protection), the sync panel,
   and "about this system" (version and environment status).
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, ui = MF.ui;
  var shell = MF.shell, actions = MF.actions;

  var LABEL = {
    synced: { t: 'تمت المزامنة', icon: 'cloud', cls: 'is-ok' },
    syncing: { t: 'جارٍ المزامنة', icon: 'sync', cls: 'is-busy' },
    offline: { t: 'غير متصل — محفوظ محليًا', icon: 'cloudOff', cls: 'is-off' },
    error: { t: 'خطأ في المزامنة', icon: 'warn', cls: 'is-err' },
    conflict: { t: 'تعارض يحتاج مراجعة', icon: 'split', cls: 'is-err' }
  };
  MF.SYNC_LABEL = LABEL;

  function chipInner(st) {
    var l = LABEL[st.state] || LABEL.synced;
    var n = st.state === 'offline' || st.state === 'syncing' ? st.pending : st.state === 'error' ? st.failed || st.pending : st.state === 'conflict' ? st.conflicts : 0;
    return MF.icon(l.icon, 'ic-sm') + '<span class="sc-t">' + l.t + '</span>' + (n ? '<span class="sc-n num">' + n + '</span>' : '');
  }
  shell.statusChip = function () {
    var st = MF.sync.status();
    return '<button type="button" class="sync-chip ' + (LABEL[st.state] || LABEL.synced).cls + '" data-act="sync" data-sync-chip aria-live="polite">' + chipInner(st) + '</button>';
  };
  function paintChips(st) {
    D.qsa('[data-sync-chip]').forEach(function (b) {
      b.className = 'sync-chip ' + (LABEL[st.state] || LABEL.synced).cls;
      b.innerHTML = chipInner(st);
      b.setAttribute('aria-label', 'حالة المزامنة: ' + (LABEL[st.state] || LABEL.synced).t);
    });
  }
  MF.sync.on('status', paintChips);

  shell.accountButton = function () {
    return '<button type="button" class="icon-btn" data-act="account" aria-label="الحساب">' + MF.icon('user') + '</button>';
  };
  /* the right-hand cluster of every app bar */
  shell.barEnd = function (extra) {
    return shell.statusChip() + (extra || '') + shell.themeButton() + shell.accountButton();
  };

  /* shared click handling for the bar cluster; screens call it from their own handler */
  shell.handleAct = function (a, btn) {
    if (a === 'theme') { MF.theme.toggle(); return true; }
    if (a === 'account') { actions.accountMenu(btn); return true; }
    if (a === 'sync') { actions.syncPanel(); return true; }
    return false;
  };

  function roleAr(r) { return r === 'admin' ? 'مدير النظام' : 'فاحص'; }
  MF.roleAr = roleAr;

  actions.accountMenu = function (btn) {
    var p = MF.auth.profile || {};
    var items = [
      { label: (p.full_name || p.email || '') , hint: roleAr(p.role) + ' — ' + (p.email || ''), icon: 'user', value: null, disabled: true },
      { divider: true },
      { label: 'تغيير كلمة المرور', icon: 'lock', value: 'password', disabled: !MF.net.online }
    ];
    if (MF.auth.isAdmin()) items.push({ label: 'إدارة النظام', icon: 'settings', value: 'admin' });
    items.push({ label: 'الإعدادات', icon: 'settings', value: 'settings' });
    items.push({ label: 'حول النظام', icon: 'info', value: 'about' });
    items.push({ divider: true });
    items.push({ label: 'تسجيل الخروج', icon: 'logout', value: 'logout', danger: true });
    ui.menu(btn, items).then(function (v) {
      if (v === 'password') actions.changePassword();
      else if (v === 'admin') MF.go('admin');
      else if (v === 'settings') actions.settingsSheet();
      else if (v === 'about') actions.about();
      else if (v === 'logout') actions.signOut();
    });
  };

  /* ---------- password ---------- */
  shell.passwordField = function (id, label, auto) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<div class="pw-wrap"><input id="' + id + '" class="input" type="password" autocomplete="' + auto + '" dir="ltr" spellcheck="false" autocapitalize="off">' +
      '<button type="button" class="icon-btn pw-toggle" data-pw-toggle="' + id + '" aria-label="إظهار كلمة المرور" aria-pressed="false">' + MF.icon('eye') + '</button></div></div>';
  };
  shell.bindPasswordToggles = function (root) {
    return D.on(root, 'click', '[data-pw-toggle]', function (e, b) {
      var inp = root.querySelector('#' + b.getAttribute('data-pw-toggle'));
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.setAttribute('aria-pressed', String(show));
      b.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      b.innerHTML = MF.icon(show ? 'eyeOff' : 'eye');
    });
  };
  shell.PW_RULE = 'كلمة المرور: 8 أحرف على الأقل، وتحتوي حروفًا وأرقامًا.';
  shell.checkNewPassword = function (pw, confirm) {
    if (pw.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
    if (new TextEncoder().encode(pw).length > 72) return 'كلمة المرور طويلة جدًا.';
    if (!/[A-Za-z؀-ۿ]/.test(pw) || !/[0-9٠-٩]/.test(pw)) return 'كلمة المرور يجب أن تحتوي حروفًا وأرقامًا.';
    if (confirm != null && pw !== confirm) return 'تأكيد كلمة المرور غير مطابق.';
    return null;
  };

  /* form used both by the forced screen and the dialog; returns a promise when submitted */
  shell.passwordForm = function () {
    return '<form class="form-grid pw-form" novalidate>' +
      shell.passwordField('pw-cur', 'كلمة المرور الحالية', 'current-password') +
      shell.passwordField('pw-new', 'كلمة المرور الجديدة', 'new-password') +
      shell.passwordField('pw-new2', 'تأكيد كلمة المرور الجديدة', 'new-password') +
      '<p class="hint">' + shell.PW_RULE + '</p><p class="field-error" role="alert" hidden></p></form>';
  };
  shell.submitPassword = function (el) {
    var cur = el.querySelector('#pw-cur').value, nw = el.querySelector('#pw-new').value, nw2 = el.querySelector('#pw-new2').value;
    var err = el.querySelector('.field-error');
    var problem = !cur ? 'أدخل كلمة المرور الحالية.' : shell.checkNewPassword(nw, nw2) || (cur === nw ? MF.err.MSG.SAME_PASSWORD : null);
    if (problem) { err.textContent = problem; err.hidden = false; return Promise.reject(null); }
    if (!MF.net.online) { err.textContent = MF.err.MSG.OFFLINE_ACTION; err.hidden = false; return Promise.reject(null); }
    err.hidden = true;
    return MF.auth.changePassword(cur, nw).then(function (st) {
      ['#pw-cur', '#pw-new', '#pw-new2'].forEach(function (s) { el.querySelector(s).value = ''; });
      return st;
    }, function (e) { err.textContent = MF.err.message(e); err.hidden = false; throw null; });
  };

  actions.changePassword = function () {
    return ui.dialog({
      title: 'تغيير كلمة المرور',
      body: shell.passwordForm(),
      actions: [{ label: 'إلغاء', value: null }, {
        label: 'تغيير كلمة المرور', kind: 'primary', value: 'ok', onClick: function (api) {
          var go = api.action(1);
          go.disabled = true;
          shell.submitPassword(api.el).then(function () { api.close('ok'); ui.toast('تم تغيير كلمة المرور.'); }, function () { go.disabled = false; });
          return false;
        }
      }],
      onMount: function (el) {
        shell.bindPasswordToggles(el);
        el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); });
      }
    });
  };

  /* ---------- sign out ---------- */
  actions.signOut = function () {
    return MF.flushCurrent().then(function () { return MF.sync.outbox(); }).then(function (list) {
      if (!list.length) {
        return ui.confirm({ title: 'تسجيل الخروج', message: 'سيُزال ما حُفظ من بيانات البحث على هذا الجهاز لهذا الحساب. كل البيانات محفوظة على الخادم.', confirmLabel: 'تسجيل الخروج' })
          .then(function (ok) { if (ok) return MF.auth.signOut({}).then(function () { location.reload(); }); });
      }
      return ui.dialog({
        title: 'تغييرات لم تُزامن بعد',
        body: '<div class="notice notice-warn">' + MF.icon('warn') + '<div><strong>توجد ' + list.length + ' تغييرات محفوظة على هذا الجهاز فقط ولم تصل إلى الخادم.</strong>' +
          '<p>إذا خرجت الآن مع حذفها فلن تصل إلى قاعدة البيانات.</p></div></div>',
        actions: [
          { label: 'إلغاء', value: null },
          { label: 'الخروج مع إبقائها على هذا الجهاز', value: 'keep' },
          { label: 'مزامنة ثم الخروج', value: 'sync', kind: 'primary', disabled: !MF.net.online }
        ]
      }).then(function (v) {
        if (v === 'keep') return MF.auth.signOut({ keepLocal: true }).then(function () { location.reload(); });
        if (v === 'sync') {
          var hide = ui.toast('جارٍ المزامنة…', { timeout: 20000 });
          return MF.sync.drain(20000).then(function (ok) {
            hide();
            if (ok) return MF.auth.signOut({}).then(function () { location.reload(); });
            ui.alert({ title: 'لم تكتمل المزامنة', message: 'بقيت تغييرات لم تصل إلى الخادم. افتح «حالة المزامنة» لمعرفة السبب، أو اخرج مع إبقائها على هذا الجهاز.' });
          });
        }
      });
    });
  };

  /* ---------- sync panel ---------- */
  function when(iso) {
    if (!iso) return '—';
    try { return D.ltr(new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })); } catch (e) { return '—'; }
  }
  actions.syncPanel = function () {
    return Promise.all([MF.sync.outbox(), MF.sync.conflicts()]).then(function (r) {
      var pids = uniq(r[0].map(function (e) { return e.pid; }).concat(r[1].map(function (c) { return c.pid; })));
      return Promise.all(pids.map(function (pid) { return MF.cache.db ? MF.cache.db.get('participants', pid) : null; })).then(function (ps) {
        var codes = {};
        ps.forEach(function (p) { if (p) codes[p.id] = p.code; });
        return [r[0], r[1], codes];
      });
    }).then(function (r) {
      var out = r[0], conf = r[1], codes = r[2], st = MF.sync.status();
      var who = function (pid) { return codes[pid] ? D.ltr(codes[pid], 'pid') : 'مشارك'; };
      var failed = out.filter(function (e) { return e.failed || e.error; });
      var lbl = LABEL[st.state] || LABEL.synced;
      var body =
        '<div class="sync-head ' + lbl.cls + '">' + MF.icon(lbl.icon) + '<div><strong>' + lbl.t + '</strong><small>' +
          (MF.net.online ? 'متصل بالخادم' : 'لا يوجد اتصال — تُحفظ التعديلات على هذا الجهاز وتُرسَل عند عودة الاتصال') + '</small></div></div>' +
        '<dl class="kv"><div><dt>تغييرات بانتظار الإرسال</dt><dd class="num">' + out.length + '</dd></div>' +
          '<div><dt>تعارضات</dt><dd class="num">' + conf.length + '</dd></div>' +
          '<div><dt>آخر مزامنة ناجحة</dt><dd>' + when(st.lastOk) + '</dd></div></dl>' +
        (conf.length ? '<h3 class="mini-h">تعارضات تحتاج قرارك</h3><div class="arch-list">' + uniq(conf.map(function (c) { return c.pid; })).map(function (pid) {
          return '<div class="arch-row">' + who(pid) + '<span class="arch-t"><strong>' + MF.icon('split', 'ic-sm') + ' تعارض</strong><small>افتح المشارك لمراجعة التعارض</small></span>' +
            '<button type="button" class="btn" data-open="' + esc(pid) + '">فتح</button></div>';
        }).join('') + '</div>' : '') +
        (failed.length ? '<h3 class="mini-h">تغييرات رفضها الخادم أو تعذّر إرسالها</h3><div class="arch-list">' + failed.slice(0, 30).map(function (e) {
          return '<div class="arch-row">' + who(e.pid) + '<span class="arch-t"><strong>' + esc(tableAr(e.table)) + '</strong><small>' + esc(e.error_message || MF.err.MSG[e.error] || e.error || '') + '</small></span>' +
            '<button type="button" class="btn btn-quiet" data-open="' + esc(e.pid) + '">فتح</button>' +
            (e.failed ? '<button type="button" class="btn btn-danger-quiet" data-discard="' + esc(e.k) + '">تجاهل التغيير</button>' : '') + '</div>';
        }).join('') + '</div>' : '');
      return ui.dialog({
        title: 'حالة المزامنة', body: body,
        actions: [{ label: 'إغلاق', value: null }, { label: 'إعادة المحاولة الآن', value: 'retry', kind: 'primary', disabled: !MF.net.online || !out.length }],
        onMount: function (el, api) {
          D.on(el, 'click', '[data-open]', function (e, b) { api.close(); MF.go(MF.routeFor.participant(b.getAttribute('data-open'))); });
          D.on(el, 'click', '[data-discard]', function (e, b) {
            ui.confirm({ title: 'تجاهل التغيير', message: 'سيُحذف هذا التغيير من هذا الجهاز ولن يُرسل إلى الخادم. لا يمكن التراجع.', confirmLabel: 'تجاهل', danger: true }).then(function (ok) {
              if (ok) MF.sync.discard(b.getAttribute('data-discard')).then(function () { api.close(); actions.syncPanel(); });
            });
          });
        }
      }).then(function (v) { if (v === 'retry') MF.sync.retryFailed(); });
    });
  };
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  var TABLE_AR = {
    participants: 'اسم المشارك', registration: 'التسجيل', family_members: 'أفراد الأسرة', ocular_history_entries: 'التاريخ العيني',
    systemic_history_entries: 'الأمراض العامة', family_history_entries: 'التاريخ العائلي', autorefraction: 'الانكسار الموضوعي',
    strabismus: 'الحول', eom_findings: 'حركة عضلات العين', visual_acuity: 'حدة الإبصار', questionnaire_responses: 'الاستبيان', station_status: 'حالة المحطة'
  };
  function tableAr(t) { return TABLE_AR[t] || t; }
  MF.tableAr = tableAr;

  /* ---------- about / environment status ---------- */
  actions.about = function () {
    var cfg = MF.env.config, envi = MF.env.environment;
    var host = cfg.url ? cfg.url.replace(/^https?:\/\//, '') : '—';
    var dbState = '<span class="muted">جارٍ الفحص…</span>';
    return ui.dialog({
      title: 'حول النظام',
      body:
        '<div class="about-head">' + shell.logo() + '<div><strong>' + MF.APP_TITLE + '</strong><small>' + esc(MF.APP_SUB) + '</small></div></div>' +
        '<dl class="kv">' +
          '<div><dt>إصدار التطبيق</dt><dd>' + D.ltr(MF.VERSION + (MF.BUILD ? ' (' + MF.BUILD + ')' : '')) + '</dd></div>' +
          '<div><dt>البيئة</dt><dd>' + esc(envi.ar) + ' ' + D.ltr('(' + envi.key + ')') + '</dd></div>' +
          '<div><dt>قاعدة البيانات</dt><dd data-db-state>' + dbState + '</dd></div>' +
          '<div><dt>الخادم</dt><dd>' + D.ltr(host) + '</dd></div>' +
          '<div><dt>التحديث المباشر</dt><dd>' + (MF.live.count() ? 'متصل (' + MF.live.count() + ')' : 'غير مستخدم في هذه الصفحة') + '</dd></div>' +
          '<div><dt>المستخدم</dt><dd>' + esc((MF.auth.profile && MF.auth.profile.full_name) || '—') + ' — ' + roleAr(MF.auth.profile && MF.auth.profile.role) + '</dd></div>' +
          '<div><dt>إصدار الاستبيان</dt><dd>' + D.ltr('1') + '</dd></div>' +
        '</dl>' +
        '<p class="hint">لا يجمع التطبيق أي بيانات استخدام أو تحليلات.</p>',
      actions: [{ label: 'إغلاق', value: true, kind: 'primary' }],
      onMount: function (el) {
        var slot = el.querySelector('[data-db-state]');
        var t0 = Date.now();
        MF.net.check().then(function (ok) {
          if (!ok) { slot.innerHTML = '<span class="badge badge-warn">غير متاحة من هذا الجهاز الآن</span>'; return; }
          return MF.remote.schoolStats().then(function () {
            slot.innerHTML = '<span class="badge badge-ok">' + MF.icon('check') + 'متصلة</span> <small class="muted">' + D.ltr((Date.now() - t0) + ' ms') + '</small>';
          }, function (e) { slot.innerHTML = '<span class="badge badge-warn">' + esc(MF.err.message(e)) + '</span>'; });
        });
      }
    });
  };
})();
