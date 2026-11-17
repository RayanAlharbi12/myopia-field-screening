/* Schools home: logo, title, sync status, account, the school list (canonical counts
   from the server), create school and export all (Administrator). Live updates. */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, ui = MF.ui;


  function schoolRow(s, c) {
    return '<li><a class="school-row" href="#/' + MF.routeFor.school(s.id) + '">' +
      '<span class="school-no" aria-label="رقم المدرسة"><span class="num">' + s.number + '</span></span>' +
      '<span class="school-main"><strong class="school-name">' + esc(s.name) + '</strong>' +
        '<span class="school-meta"><span>' + esc(s.city) + '</span><span class="sep" aria-hidden="true"></span><span>' + MF.OPT.ar('schoolType', s.type) + '</span></span></span>' +
      '<span class="school-stats">' +
        '<span class="st"><b class="num">' + c.total + '</b><small>مشارك</small></span>' +
        '<span class="st"><b class="num">' + c.completed + '</b><small>مكتمل</small></span>' +
        (c.referral ? '<span class="st st-warn">' + MF.icon('warn', 'ic-sm') + '<b class="num">' + c.referral + '</b><small>إحالة</small></span>' : '') +
      '</span>' +
      '<span class="row-go" aria-hidden="true">' + MF.icon('forward') + '</span></a></li>';
  }

  function createSchool() {
    if (!MF.net.online) { ui.alert({ title: 'لا يوجد اتصال', message: MF.err.MSG.OFFLINE_ACTION }); return Promise.resolve(); }
    return Promise.resolve().then(function () {
      var type = null;
      return ui.dialog({
        title: 'إنشاء مدرسة',
        body:
          '<form class="form-grid" novalidate>' +
            '<div class="field"><label for="sc-name">اسم المدرسة</label><input id="sc-name" class="input" autocomplete="off" required autofocus></div>' +
            '<div class="field"><label for="sc-city">المدينة</label><input id="sc-city" class="input" autocomplete="off" required></div>' +
            '<div class="field"><span class="label" id="sc-type-l">نوع المدرسة</span>' +
              '<div class="choices grid-2" role="radiogroup" aria-labelledby="sc-type-l">' +
                MF.OPT.schoolType.map(function (o) { return '<button type="button" class="opt center" role="radio" aria-checked="false" data-type="' + o.v + '"><span class="mark"></span><span class="opt-t">' + o.ar + '</span></button>'; }).join('') +
              '</div></div>' +
            '<p class="hint">يُعطى رقم المدرسة تلقائيًا من قاعدة البيانات (التالي بعد آخر رقم مستخدم).</p>' +
            '<p class="field-error" role="alert" hidden></p>' +
          '</form>',
        actions: [{ label: 'إلغاء', value: null }, {
          label: 'إنشاء', kind: 'primary', value: 'create', onClick: function (api) {
            var el = api.el, err = el.querySelector('.field-error');
            var name = el.querySelector('#sc-name').value.trim(), city = el.querySelector('#sc-city').value.trim();
            var miss = [];
            if (!name) miss.push('اسم المدرسة');
            if (!city) miss.push('المدينة');
            if (!type) miss.push('نوع المدرسة');
            if (miss.length) { err.textContent = 'أكمل: ' + miss.join('، ') + '.'; err.hidden = false; return false; }
            api.action(1).disabled = true;
            MF.SchoolRepository.create({ name: name, city: city, type: type }).then(function (s) {
              api.close(s);
              ui.toast('أُنشئت المدرسة رقم ' + s.number + '.');
              MF.go(MF.routeFor.school(s.id));
            }, function (e) {
              api.action(1).disabled = false;
              err.textContent = e && e.code ? MF.err.message(e) : (e && e.message || 'تعذّر إنشاء المدرسة.'); err.hidden = false;
            });
            return false;
          }
        }],
        onMount: function (el) {
          D.on(el, 'click', '[data-type]', function (e, b) {
            type = b.getAttribute('data-type');
            D.qsa('[data-type]', el).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
          });
          el.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); });
        }
      });
    });
  }

  MF.screens.home = {
    mount: function (root) {
      var admin = MF.auth.isAdmin();
      root.innerHTML =
        '<header class="appbar home-bar"><div class="appbar-in">' +
          '<div class="brand">' + MF.shell.logo() + '<div class="brand-t"><h1>' + MF.APP_TITLE + '</h1><p>' + esc(MF.APP_SUB) + '</p></div></div>' +
          '<div class="bar-actions">' + MF.shell.barEnd() + '</div></div></header>' +
        '<main class="page home" id="main"><div class="page-in">' +
          '<div data-banner></div>' +
          '<div class="home-head"><div><h2 class="page-title">المدارس</h2><p class="page-sub" data-sub></p></div>' +
            '<div class="head-actions">' +
              (admin ? '<button type="button" class="btn" data-act="export-all" hidden>' + MF.icon('sheet') + '<span>تصدير جميع البيانات</span></button>' +
                '<button type="button" class="btn btn-primary" data-act="create" hidden>' + MF.icon('plus') + '<span>إنشاء مدرسة</span></button>' : '') +
            '</div></div>' +
          '<div data-list><div class="skeleton" aria-hidden="true"></div></div>' +
          '<footer class="home-foot"><p>' + MF.icon('info', 'ic-sm') + '<span>البيانات محفوظة في قاعدة البيانات المشتركة وتظهر على جميع الأجهزة. عند انقطاع الاتصال تُحفظ التعديلات على هذا الجهاز وتُرسل تلقائيًا عند عودته.</span></p></footer>' +
        '</div></main>';

      var off = D.on(root, 'click', '[data-act]', function (e, b) {
        var a = b.getAttribute('data-act');
        if (MF.shell.handleAct(a, b)) return;
        if (a === 'create') createSchool();
        else if (a === 'export-all') MF.actions.exportExcel(null, b);
      });

      var alive = true;
      function load() {
        return Promise.all([MF.SchoolRepository.list(), MF.SchoolRepository.stats()]).then(function (res) {
          if (!alive) return;
          var schools = res[0].value, stats = res[1].value, list = root.querySelector('[data-list]');
          var fromCache = res[0].source === 'cache';
          root.querySelector('[data-banner]').innerHTML = fromCache ? '<div class="notice notice-warn">' + MF.icon('cloudOff') + '<div><strong>لا يوجد اتصال بالخادم.</strong> تُعرض المدارس المحفوظة على هذا الجهاز؛ الأعداد تشمل ما حُمّل على هذا الجهاز فقط.</div></div>' : '';
          var exportBtn = root.querySelector('[data-act="export-all"]'), createBtn = root.querySelector('.head-actions [data-act="create"]');
          if (exportBtn) exportBtn.hidden = !schools.length;
          if (createBtn) createBtn.hidden = !schools.length;
          if (!schools.length) {
            root.querySelector('[data-sub]').textContent = '';
            list.innerHTML =
              '<div class="empty">' + MF.shell.emptyArt() +
                '<h3>' + (fromCache ? 'لا توجد مدارس محفوظة على هذا الجهاز' : 'لا توجد مدارس حتى الآن') + '</h3>' +
                (admin ? '<p>ابدأ بإنشاء مدرسة. يحصل كل مشارك فيها على رقم بسيط مثل ' + D.ltr('1-1') + '.</p>' +
                  '<button type="button" class="btn btn-primary btn-lg" data-act="create">' + MF.icon('plus') + '<span>إنشاء مدرسة</span></button>'
                  : '<p>' + (fromCache ? 'اتصل بالإنترنت لتحميل المدارس.' : 'يُنشئ مدير النظام المدارس. ستظهر هنا فور إنشائها.') + '</p>') +
              '</div>';
            return;
          }
          var total = 0;
          schools.forEach(function (s) { total += (stats[s.id] || {}).total || 0; });
          root.querySelector('[data-sub]').textContent = schools.length + ' مدرسة — ' + total + ' مشارك';
          list.innerHTML = '<ul class="school-list">' + schools.map(function (s) { return schoolRow(s, stats[s.id] || { total: 0, completed: 0, referral: 0 }); }).join('') + '</ul>';
        }, function (err) {
          if (!alive) return;
          root.querySelector('[data-list]').innerHTML = '<div class="empty"><h3>تعذّر تحميل المدارس</h3><p>' + esc(MF.err.message(err)) + '</p><button type="button" class="btn" data-act="reload">إعادة المحاولة</button></div>';
        });
      }
      var reload = D.debounce(load, 500);
      var offR = D.on(root, 'click', '[data-act="reload"]', function () { load(); });
      var stopLive = MF.live.schools(function () { reload(); });
      var offNet = MF.net.on(function (on) { if (on) reload(); });
      var timer = setInterval(function () { if (document.visibilityState === 'visible' && MF.net.online) reload(); }, 60000);
      return { ready: load(), unmount: function () { alive = false; off(); offR(); stopLive(); offNet(); clearInterval(timer); reload.cancel(); } };
    }
  };
})();
