/* School workspace: header, canonical counters, add participant (online), counter settings
   (Administrator), server-side search and paging, live updates, export, offline preparation. */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, ui = MF.ui, O = MF.OPT;

  var DUP_MSG = 'رقم المشارك موجود مسبقًا. يرجى تعديل العداد.';

  function stationShort(key) {
    var s = MF.STATIONS.filter(function (x) { return x.key === key; })[0];
    return s ? s.ar : 'مكتمل';
  }

  function rowHtml(p, school) {
    var s = p.summary || {};
    var cls = O.find('classLevel', s.class_level);
    var done = p.status === 'completed';
    return '<li><a class="p-row' + (p.archived ? ' is-archived' : '') + '" href="#/' + MF.routeFor.participant(p.id, s.current_station || 'registration') + '" data-pid="' + esc(p.id) + '">' +
      '<span class="p-id">' + D.ltr(p.code, 'pid') + '</span>' +
      '<span class="p-name">' + (p.name ? esc(p.name) : '<span class="muted">بدون اسم</span>') + '</span>' +
      '<span class="p-meta">' + [s.age != null ? s.age + ' سنة' : null, s.gender ? O.ar('gender', s.gender) : null, cls ? cls.ar : null, done ? null : stationShort(s.current_station)].filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</span>' +
      '<span class="p-cell p-age"><span class="cell-l">العمر</span>' + (s.age != null ? '<span class="num">' + s.age + '</span>' : '<span class="muted">—</span>') + '</span>' +
      '<span class="p-cell p-gender"><span class="cell-l">الجنس</span>' + (s.gender ? O.ar('gender', s.gender) : '<span class="muted">—</span>') + '</span>' +
      '<span class="p-cell p-class"><span class="cell-l">الصف</span>' + (cls ? cls.ar.replace(' متوسط', '') : '<span class="muted">—</span>') + '</span>' +
      '<span class="p-cell p-station"><span class="cell-l">المحطة</span>' + (done ? '—' : esc(stationShort(s.current_station))) + '</span>' +
      '<span class="p-status">' + (done ? '<span class="badge badge-ok">' + MF.icon('check') + 'مكتمل</span>' : '<span class="badge">مسودة</span>') + '</span>' +
      '<span class="p-ref">' + (s.referral_alert ? '<span class="badge badge-warn" title="إحالة">' + MF.icon('warn') + 'إحالة</span>' : '<span class="sr-only">لا إحالة</span>') + '</span>' +
      '</a></li>';
  }

  function counterDialog(school) {
    return MF.SettingsRepository.participantCounter(school.id).catch(function (err) {
      ui.alert({ title: 'تعذّر فتح إعدادات العداد', message: esc(MF.err.message(err)) });
      throw err;
    }).then(function (c) {
      var code = function (n) { return D.ltr(school.number + '-' + n); };
      var firstFree = (c.highestUsed || 0) + 1;
      return ui.dialog({
        title: 'إعدادات عداد المشاركين',
        body:
          '<dl class="kv">' +
            '<div><dt>آخر رقم مستخدم</dt><dd>' + (c.lastAssigned != null ? code(c.lastAssigned) : '<span class="muted">لا يوجد بعد</span>') + '</dd></div>' +
            (c.highestUsed != null && c.highestUsed !== c.lastAssigned ? '<div><dt>أعلى رقم مسجَّل</dt><dd>' + code(c.highestUsed) + '</dd></div>' : '') +
            '<div><dt>الرقم التالي</dt><dd class="cn-next">' + code(c.next) + '</dd></div>' +
          '</dl>' +
          '<div class="field"><label for="cn-in">تعديل الرقم التالي</label>' +
            '<div class="input-unit" dir="ltr"><span class="unit num">' + school.number + '-</span><input id="cn-in" class="input input-num" inputmode="numeric" pattern="[0-9]*" value="' + c.next + '" autocomplete="off"></div>' +
            '<p class="field-warn cn-warn" hidden></p><p class="field-error cn-err" role="alert" hidden></p></div>' +
          (c.usedSeqs.indexOf(c.next) >= 0 || c.next !== firstFree ? '<button type="button" class="btn btn-quiet cn-free">استخدام أول رقم متاح بعد أعلى رقم مسجَّل: ' + D.ltr(school.number + '-' + firstFree) + '</button>' : '') +
          '<hr class="divider sp">' +
          '<button type="button" class="btn btn-danger-quiet cn-reset">' + MF.icon('restore') + 'إعادة ضبط العداد</button>' +
          '<p class="hint">تغيير العداد لا يحذف أي مشارك ولا يعيد ترقيمه ولا يكتب فوقه. إذا كان الرقم مستخدمًا يُمنع إنشاء مشارك جديد به.</p>',
        actions: [{ label: 'إغلاق', value: null }, {
          label: 'حفظ الرقم التالي', kind: 'primary', value: 'save', onClick: function (api) {
            var el = api.el, v = parseInt(D.normalizeDigits(el.querySelector('#cn-in').value), 10), err = el.querySelector('.cn-err');
            MF.SettingsRepository.setNextParticipantNumber(school.id, v).then(function () {
              api.close('saved');
              ui.toast('الرقم التالي: ' + D.iso(school.number + '-' + v));
            }, function (e) { err.textContent = MF.err.message(e); err.hidden = false; });
            return false;
          }
        }],
        onMount: function (el, api) {
          var inp = el.querySelector('#cn-in'), warn = el.querySelector('.cn-warn');
          function check() {
            var v = parseInt(D.normalizeDigits(inp.value), 10);
            if (v >= 1 && c.usedSeqs.indexOf(v) >= 0) { warn.textContent = 'الرقم ' + D.iso(school.number + '-' + v) + ' مستخدم مسبقًا؛ لن يُسمح بإنشاء مشارك به.'; warn.hidden = false; }
            else warn.hidden = true;
          }
          inp.addEventListener('input', check); check();
          var free = el.querySelector('.cn-free');
          if (free) free.addEventListener('click', function () { inp.value = firstFree; check(); inp.focus(); });
          el.querySelector('.cn-reset').addEventListener('click', function () {
            ui.confirm({
              title: 'إعادة ضبط العداد',
              message: 'هل أنت متأكد من إعادة ضبط عداد المشاركين لهذه المدرسة؟ سيعود الرقم التالي إلى ' + D.ltr(school.number + '-1') + '. لن يُحذف أي مشارك ولن يُعاد ترقيم أحد.',
              confirmLabel: 'إعادة الضبط', danger: true
            }).then(function (ok) {
              if (!ok) return;
              MF.SettingsRepository.resetParticipantCounter(school.id).then(function () {
                api.close('reset');
                ui.toast('أُعيد ضبط العداد. الرقم التالي: ' + D.iso(school.number + '-1'));
              }, function (e) { ui.alert({ title: 'لم يُعَد ضبط العداد', message: esc(MF.err.message(e)) }); });
            });
          });
        }
      });
    });
  }

  var PAGE = 100;

  MF.screens.school = {
    mount: function (root, route) {
      var admin = MF.auth.isAdmin();
      var state = { school: null, rows: [], total: 0, q: '', filter: 'all', archived: false, stats: null, archivedCount: 0, source: 'server', loading: false, reqId: 0 };
      var alive = true;
      root.innerHTML = '<div class="loading" aria-busy="true"></div>';

      function countsHtml() {
        var c = state.stats || { total: 0, draft: 0, completed: 0, referral: 0 };
        return '<span class="ct"><b class="num">' + c.total + '</b><small>المشاركون</small></span>' +
          '<span class="ct"><b class="num">' + c.draft + '</b><small>مسودة</small></span>' +
          '<span class="ct ct-ok"><b class="num">' + c.completed + '</b><small>مكتمل</small></span>' +
          '<span class="ct' + (c.referral ? ' ct-warn' : '') + '">' + (c.referral ? MF.icon('warn', 'ic-sm') : '') + '<b class="num">' + c.referral + '</b><small>إحالة</small></span>';
      }
      function renderList() {
        var list = root.querySelector('[data-list]');
        if (!list) return;
        root.querySelector('[data-counts]').innerHTML = countsHtml();
        D.qsa('[data-filter]', root).forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === state.filter && !state.archived)); });
        var tog = root.querySelector('[data-act="archived"]');
        tog.hidden = !admin || (!state.archivedCount && !state.archived);
        tog.textContent = state.archived ? 'عرض المشاركين الحاليين' : 'المؤرشفون (' + state.archivedCount + ')';
        root.querySelector('.filters').hidden = state.archived;
        var banner = root.querySelector('[data-banner]');
        banner.innerHTML = state.source === 'cache' ? '<div class="notice notice-warn">' + MF.icon('cloudOff') + '<div><strong>لا يوجد اتصال بالخادم.</strong> تُعرض البيانات المحفوظة على هذا الجهاز. يمكنك متابعة إدخال بيانات المشاركين المحفوظين؛ إضافة مشارك جديد تتطلب اتصالًا.</div></div>' : '';
        var nothing = !state.rows.length;
        if (nothing && !state.q && state.filter === 'all' && !state.archived) {
          list.innerHTML = '<div class="empty compact">' + MF.shell.emptyArt() + '<h3>' + (state.source === 'cache' ? 'لا يوجد مشاركون محفوظون على هذا الجهاز' : 'لا يوجد مشاركون بعد') + '</h3>' +
            (state.source === 'cache' ? '<p>اتصل بالإنترنت لعرض قائمة المدرسة.</p>' : '<p>اضغط «إضافة مشارك» لإنشاء ' + D.ltr(state.school.number + '-1') + ' أو الرقم التالي في العداد.</p>') + '</div>';
          return;
        }
        if (nothing) { list.innerHTML = '<p class="no-results">لا توجد نتائج' + (state.q ? ' لـ «' + esc(state.q) + '»' : '') + '.</p>'; return; }
        var more = state.rows.length < state.total;
        list.innerHTML =
          '<div class="p-table" role="table" aria-label="المشاركون">' +
          '<div class="p-head" role="row"><span>الرقم</span><span>الاسم</span><span>العمر</span><span>الجنس</span><span>الصف</span><span>المحطة الحالية</span><span>الحالة</span><span>إحالة</span></div>' +
          '<ul class="p-list">' + state.rows.map(function (p) { return rowHtml(p, state.school); }).join('') + '</ul></div>' +
          (more ? '<div class="more-row"><button type="button" class="btn" data-act="more">عرض المزيد (' + (state.total - state.rows.length) + ')</button></div>' : '') +
          '<p class="hint list-count">' + state.rows.length + ' من ' + state.total + '</p>';
      }

      function loadPage(append, keep) {
        var id = ++state.reqId;
        state.loading = true;
        var limit = keep ? Math.max(PAGE, state.rows.length) : PAGE;
        return MF.ParticipantRepository.page(state.school.id, { archived: state.archived, filter: state.filter, search: state.q, offset: append ? state.rows.length : 0, limit: limit }).then(function (res) {
          if (!alive || id !== state.reqId) return;
          state.rows = append ? state.rows.concat(res.rows) : res.rows;
          state.total = res.total;
          state.source = res.source;
          state.loading = false;
          renderList();
        }, function (err) {
          if (!alive || id !== state.reqId) return;
          state.loading = false;
          root.querySelector('[data-list]').innerHTML = '<div class="empty compact"><h3>تعذّر تحميل المشاركين</h3><p>' + esc(MF.err.message(err)) + '</p><button type="button" class="btn" data-act="reload">إعادة المحاولة</button></div>';
        });
      }
      function loadStats() {
        return MF.SchoolRepository.stats().then(function (r) {
          state.stats = r.value[route.schoolId] || { total: 0, draft: 0, completed: 0, referral: 0 };
          if (admin && r.source === 'server') {
            return MF.ParticipantRepository.page(route.schoolId, { archived: true, limit: 1 }).then(function (a) { state.archivedCount = a.total; });
          }
        }).catch(function () { /* counts stay as they are */ });
      }
      function refreshAll() { return Promise.all([loadStats(), loadPage(false, true)]).then(renderList); }
      var softRefresh = D.debounce(function () { if (alive) refreshAll(); }, 700);
      /* counts change with every station edit in the school: refresh them at most every 1.5 s */
      var refreshCounts = D.debounce(function () {
        if (alive) loadStats().then(function () { var c = root.querySelector('[data-counts]'); if (c) c.innerHTML = countsHtml(); });
      }, 1500);

      function addParticipant(btn) {
        if (!MF.net.online || !MF.auth.canSync()) { ui.alert({ title: 'لا يوجد اتصال', message: MF.err.MSG.OFFLINE_CREATE }); return; }
        btn.disabled = true;
        MF.ParticipantRepository.create(state.school.id).then(function (p) {
          MF.go(MF.routeFor.participant(p.id, 'registration', 'a'));
        }, function (err) {
          btn.disabled = false;
          if (err && err.code === 'DUPLICATE_ID') {
            ui.dialog({
              title: 'لا يمكن إنشاء المشارك',
              body: '<div class="notice notice-warn">' + MF.icon('warn') + '<div><strong>' + DUP_MSG + '</strong>' + (err.data && err.data.code ? '<p>الرقم ' + D.ltr(err.data.code) + ' مستخدم لمشارك موجود (أو مؤرشف).</p>' : '') +
                (admin ? '' : '<p>اطلب من مدير النظام تعديل العداد.</p>') + '</div></div>',
              actions: admin ? [{ label: 'إغلاق', value: null }, { label: 'إعدادات عداد المشاركين', value: 'counter', kind: 'primary' }] : [{ label: 'إغلاق', value: null, kind: 'primary' }]
            }).then(function (v) { if (v === 'counter') counterDialog(state.school).then(refreshAll, function () {}); });
          } else ui.alert({ title: 'تعذّر إنشاء المشارك', message: esc(MF.err.message(err)) });
        });
      }
      function prepareOffline() {
        if (!MF.net.online) { ui.alert({ title: 'لا يوجد اتصال', message: 'تجهيز المدرسة للعمل دون اتصال يتطلب اتصالًا بالإنترنت.' }); return; }
        var hide = ui.toast('جارٍ تنزيل بيانات المدرسة إلى هذا الجهاز…', { timeout: 300000 });
        MF.ParticipantRepository.prepareOffline(state.school.id).then(function (n) {
          hide();
          ui.toast('المدرسة جاهزة للعمل دون اتصال (' + n + ' مشارك).');
          renderReady();
        }, function (err) { hide(); ui.alert({ title: 'لم يكتمل التجهيز', message: esc(MF.err.message(err)) }); });
      }
      function renderReady() {
        MF.ParticipantRepository.offlineReady(state.school.id).then(function (m) {
          var el = root.querySelector('[data-ready]');
          if (el) el.innerHTML = m ? MF.icon('check', 'ic-sm') + '<span>مجهزة للعمل دون اتصال: ' + MF.fmtDate(m.at) + '</span>' : '';
        });
      }
      function schoolMenu(btn) {
        var items = [];
        if (admin) items.push({ label: 'إعدادات عداد المشاركين', icon: 'counter', value: 'counter' }, { label: 'تعديل بيانات المدرسة', icon: 'edit', value: 'edit' });
        items.push({ label: 'تصدير بيانات المدرسة', icon: 'sheet', value: 'export' });
        items.push({ label: 'تجهيز المدرسة للعمل دون اتصال', icon: 'download', value: 'offline', hint: 'تنزيل بيانات جميع مشاركي المدرسة إلى هذا الجهاز' });
        if (admin) items.push({ divider: true }, { label: state.school.archived ? 'استعادة المدرسة' : 'أرشفة المدرسة', icon: state.school.archived ? 'restore' : 'archive', value: 'archive', danger: !state.school.archived });
        ui.menu(btn, items).then(function (v) {
          if (v === 'counter') counterDialog(state.school).catch(function () {});
          else if (v === 'export') MF.actions.exportExcel(state.school.id);
          else if (v === 'edit') editSchool();
          else if (v === 'offline') prepareOffline();
          else if (v === 'archive') {
            var fail = function (e) { ui.alert({ title: 'تعذّر تنفيذ الإجراء', message: esc(MF.err.message(e)) }); };
            if (state.school.archived) MF.SchoolRepository.setArchived(state.school.id, false).then(function () { ui.toast('تمت استعادة المدرسة.'); MF.reroute(); }, fail);
            else ui.confirm({ title: 'أرشفة المدرسة', message: 'ستُخفى المدرسة رقم ' + state.school.number + ' عن الفاحصين ومن «تصدير جميع البيانات». لا يُحذف شيء، ولا يُعاد استخدام رقمها. يمكن استعادتها من «إدارة النظام».', confirmLabel: 'أرشفة', danger: true }).then(function (ok) {
              if (ok) MF.SchoolRepository.setArchived(state.school.id, true).then(function () { ui.toast('أُرشفت المدرسة.'); MF.go(''); }, fail);
            });
          }
        });
      }
      function editSchool() {
        var s = state.school, type = s.type;
        ui.dialog({
          title: 'تعديل بيانات المدرسة',
          body: '<div class="form-grid"><div class="field"><label for="es-n">اسم المدرسة</label><input id="es-n" class="input" value="' + esc(s.name) + '"></div>' +
            '<div class="field"><label for="es-c">المدينة</label><input id="es-c" class="input" value="' + esc(s.city) + '"></div>' +
            '<div class="field"><span class="label">نوع المدرسة</span><div class="choices grid-2" role="radiogroup">' + O.schoolType.map(function (o) { return '<button type="button" class="opt center" role="radio" aria-checked="' + (o.v === type) + '" data-type="' + o.v + '"><span class="mark"></span><span class="opt-t">' + o.ar + '</span></button>'; }).join('') + '</div>' +
            '<p class="hint">تغيير النوع لا يغيّر جنس المشاركين المسجَّلين.</p></div><p class="hint">رقم المدرسة ' + D.ltr(s.number) + ' ثابت ولا يتغيّر.</p><p class="field-error" role="alert" hidden></p></div>',
          actions: [{ label: 'إلغاء', value: null }, {
            label: 'حفظ', kind: 'primary', value: 'save', onClick: function (api) {
              var el = api.el, name = el.querySelector('#es-n').value.trim(), city = el.querySelector('#es-c').value.trim(), err = el.querySelector('.field-error');
              if (!name || !city) { err.textContent = 'اسم المدرسة والمدينة مطلوبان.'; err.hidden = false; return false; }
              MF.SchoolRepository.update(s.id, { name: name, city: city, type: type }).then(function () { api.close('saved'); ui.toast('حُفظت بيانات المدرسة.'); MF.reroute(); },
                function (e2) { err.textContent = MF.err.message(e2); err.hidden = false; });
              return false;
            }
          }],
          onMount: function (el) { D.on(el, 'click', '[data-type]', function (e, b) { type = b.getAttribute('data-type'); D.qsa('[data-type]', el).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); }); }); }
        });
      }

      var ready = MF.SchoolRepository.get(route.schoolId).then(function (r) {
        state.school = r.value;
        var s = state.school;
        if (!alive) return;
        if (!s) {
          root.innerHTML = '<main class="page"><div class="empty"><h3>المدرسة غير موجودة أو غير متاحة لحسابك</h3><a class="btn" href="#/">العودة إلى المدارس</a></div></main>';
          return;
        }
        root.innerHTML =
          '<header class="appbar"><div class="appbar-in">' +
            '<a class="icon-btn back" href="#/" aria-label="العودة إلى المدارس">' + MF.icon('back') + '</a>' +
            '<div class="bar-title"><span class="bar-kicker">المدرسة ' + D.ltr(s.number) + '</span><strong>' + esc(s.name) + '</strong></div>' +
            '<div class="bar-actions">' + MF.shell.barEnd('<button type="button" class="icon-btn" data-act="menu" aria-label="خيارات المدرسة">' + MF.icon('more') + '</button>') + '</div>' +
          '</div></header>' +
          '<main class="page school" id="main"><div class="page-in">' +
            '<div data-banner></div>' +
            '<section class="school-head' + (s.archived ? ' is-archived' : '') + '">' +
              '<div class="sh-no"><span class="num">' + s.number + '</span><small>رقم المدرسة</small></div>' +
              '<div class="sh-main"><h2>' + esc(s.name) + '</h2>' +
                '<p class="sh-meta"><span>' + esc(s.city) + '</span><span class="sep" aria-hidden="true"></span><span>' + O.ar('schoolType', s.type) + '</span>' + (s.archived ? '<span class="badge">مؤرشفة</span>' : '') + '</p>' +
                '<p class="sh-ready" data-ready></p></div>' +
              '<div class="sh-counts" data-counts></div>' +
            '</section>' +
            '<section class="toolbar">' +
              '<button type="button" class="btn btn-primary btn-lg add-p" data-act="add"' + (s.archived ? ' disabled' : '') + '>' + MF.icon('plus') + '<span>إضافة مشارك</span></button>' +
              '<label class="search"><span class="sr-only">بحث برقم المشارك أو الاسم</span>' + MF.icon('search') + '<input type="search" class="input" placeholder="ابحث بالرقم أو الاسم" autocomplete="off" data-search></label>' +
              '<div class="tool-end">' + (admin ? '<button type="button" class="btn" data-act="counter">' + MF.icon('counter') + '<span>عداد المشاركين</span></button>' : '') +
              '<button type="button" class="btn" data-act="export">' + MF.icon('sheet') + '<span>تصدير بيانات المدرسة</span></button></div>' +
            '</section>' +
            '<div class="list-bar"><div class="filters choices" role="group" aria-label="تصفية">' +
              [['all', 'الكل'], ['draft', 'مسودة'], ['completed', 'مكتمل'], ['referral', 'إحالة']].map(function (f) { return '<button type="button" class="opt compact" aria-pressed="false" data-filter="' + f[0] + '">' + f[1] + '</button>'; }).join('') +
              '</div><button type="button" class="btn btn-quiet" data-act="archived" hidden></button></div>' +
            '<div data-list><div class="skeleton" aria-hidden="true"></div></div>' +
          '</div></main>';
        renderReady();
        return refreshAll();
      }, function (err) {
        root.innerHTML = '<main class="page"><div class="empty"><h3>تعذّر فتح المدرسة</h3><p>' + esc(MF.err.message(err)) + '</p><a class="btn" href="#/">العودة إلى المدارس</a></div></main>';
      });

      var off = D.on(root, 'click', '[data-act], [data-filter]', function (e, b) {
        if (b.hasAttribute('data-filter')) { state.filter = b.getAttribute('data-filter'); loadPage(false); renderList(); return; }
        var a = b.getAttribute('data-act');
        if (MF.shell.handleAct(a, b)) return;
        if (a === 'add') addParticipant(b);
        else if (a === 'counter') counterDialog(state.school).then(function () { loadStats().then(renderList); }, function () {});
        else if (a === 'export') MF.actions.exportExcel(state.school.id, b);
        else if (a === 'menu') schoolMenu(b);
        else if (a === 'archived') { state.archived = !state.archived; state.filter = 'all'; loadPage(false); }
        else if (a === 'more') { b.disabled = true; loadPage(true); }
        else if (a === 'reload') refreshAll();
      });
      var search = D.debounce(function (v) { state.q = v; loadPage(false); }, 300);
      var offS = D.on(root, 'input', '[data-search]', function (e, inp) { search(inp.value.trim()); });

      /* live: other devices adding or editing participants of this school */
      var stopLive = MF.live.school(route.schoolId, function (table, row) {
        if (table === 'schools') { state.school = row; return; }
        var pid = table === 'participants' ? row.id : row.participant_id;
        var hit = state.rows.some(function (p) { return p.id === pid; });
        if (hit && MF.cache.db) {
          MF.cache.db.get('participants', pid).then(function (p) {
            if (!p || !alive) return;
            state.rows = state.rows.map(function (x) { return x.id === pid ? p : x; }).filter(function (x) { return !!x.archived === state.archived; });
            renderList();
            refreshCounts();
          });
        } else softRefresh();
      });
      var offNet = MF.net.on(function (on) { if (on && state.school) softRefresh(); });
      return {
        ready: ready,
        unmount: function () { alive = false; off(); offS(); stopLive(); offNet(); softRefresh.cancel(); refreshCounts.cancel(); search.cancel(); }
      };
    }
  };
})();
