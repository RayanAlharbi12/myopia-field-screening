/* =====================================================================
   Participant working form: compact context bar (ID, name, school, status,
   referral, save state), station navigation, the active station, and the
   shared "review and complete" block at the bottom of every station.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, ui = MF.ui, C = MF.clinical;

  function stationDef(key) { return MF.STATIONS.filter(function (s) { return s.key === key; })[0] || MF.STATIONS[0]; }
  function nextStation(key) {
    var i = MF.STATIONS.indexOf(stationDef(key));
    return MF.STATIONS[i + 1] || null;
  }
  function fmtTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); } catch (e) { return ''; }
  }

  MF.screens.participant = {
    mount: function (root, route) {
      var view = { root: root, route: route, session: null, station: null, stationRoot: null, offs: [] };
      root.innerHTML = '<div class="loading" aria-busy="true"></div>';

      var admin = MF.auth.isAdmin();
      var ready = MF.ParticipantRepository.loadBundle(route.pid).then(function (bundle) {
        if (!bundle) {
          root.innerHTML = '<main class="page"><div class="empty"><h3>المشارك غير موجود أو غير متاح لحسابك</h3><p class="hint">قد يكون مؤرشفًا.</p><a class="btn" href="#/">العودة إلى المدارس</a></div></main>';
          return;
        }
        var s = view.session = new MF.ParticipantSession(bundle);
        build();
        s.on('save', renderSave);
        s.on('change', function (info) { schedule(info); });
        s.on('remote', remoteNotice);
        s.on('discarded', function () { reloadFromServer(); });
        openStation(route);
        if (bundle.source === 'cache') MF.ui.toast('لا يوجد اتصال: تُعرض نسخة هذا الجهاز من بيانات المشارك. تُرسل التعديلات عند عودة الاتصال.', { timeout: 6000 });
        view.stopLive = MF.live.participant(route.pid);
        view.offNet = MF.net.on(function (on) { if (on) reloadFromServer(); });
      }, function (err) {
        MF.log(err);
        root.innerHTML = '<main class="page"><div class="empty"><h3>تعذّر تحميل بيانات المشارك</h3><p class="hint">' + esc(MF.err.message(err)) + '</p><a class="btn" href="#/">العودة</a></div></main>';
      });

      /* after a reconnection: fetch the server copy again; changes merge into the open form */
      var reloadFromServer = D.debounce(function () {
        if (!view.session || !MF.net.online) return;
        MF.ParticipantRepository.loadBundle(view.session.pid).catch(function () { /* stays on the local copy */ });
      }, 800);
      var lastRemote = 0;
      function remoteNotice() {
        if (Date.now() - lastRemote < 15000) return;
        lastRemote = Date.now();
        MF.ui.toast('حُدّثت بيانات هذا المشارك من جهاز آخر.', { timeout: 3500 });
      }
      function readOnly() { var b = view.session.b; return !!(b.participant.archived || b.school && b.school.archived); }

      /* ---------- shell ---------- */
      function build() {
        var b = view.session.b, p = b.participant, sc = b.school;
        root.innerHTML =
          '<header class="ctx" data-ctx><div class="ctx-in">' +
            '<a class="icon-btn back" href="#/' + MF.routeFor.school(sc.id) + '" aria-label="العودة إلى المدرسة">' + MF.icon('back') + '</a>' +
            '<div class="ctx-id" data-ctx-id></div>' +
            '<div class="ctx-main"><strong class="ctx-name" data-ctx-name></strong><span class="ctx-school">' + 'المدرسة ' + D.ltr(sc.number) + ' — ' + esc(sc.name) + '</span></div>' +
            '<div class="ctx-flags" data-ctx-flags></div>' +
            '<div class="ctx-save" data-save aria-live="polite"></div>' +
            '<button type="button" class="icon-btn" data-act="pmenu" aria-label="خيارات المشارك">' + MF.icon('more') + '</button>' +
          '</div></header>' +
          '<div class="pv">' +
            '<nav class="snav" aria-label="المحطات" data-snav></nav>' +
            '<main class="station-wrap" id="main"><div data-ro></div><div data-conflict></div><div class="station" data-station></div></main>' +
          '</div>';
        view.stationRoot = root.querySelector('[data-station]');
        view.offs.push(D.on(root, 'click', '[data-act]', onAct));
        /* station-specific actions and inputs are forwarded to the active station module */
        view.offs.push(D.on(view.stationRoot, 'click', '[data-sa]', function (e, el) {
          if (view.station && view.station.action) view.station.action(el.getAttribute('data-sa'), el, ctx(), e);
        }));
        ['input', 'change'].forEach(function (type) {
          view.offs.push(D.on(view.stationRoot, type, '[data-qa]', function (e, el) {
            if (view.station && view.station.input) view.station.input(el, ctx(), e);
          }));
        });
        MF.controls.install(view.stationRoot, function () { return view.session; }, {
          beforeChoice: function (bind, v, opt) { return view.station && view.station.beforeChoice ? view.station.beforeChoice(bind, v, opt, ctx()) : true; },
          afterChoice: function (bind, v, opt) { if (view.station && view.station.afterChoice) view.station.afterChoice(bind, v, opt, ctx()); },
          afterInput: function (bind, v, el) { if (view.station && view.station.afterInput) view.station.afterInput(bind, v, el, ctx()); }
        });
        renderContext();
        renderSave({ state: view.session.state });
        /* the station navigation sticks right under the context bar, whatever its height */
        var head = root.querySelector('[data-ctx]');
        var setH = function () { root.style.setProperty('--ctx-h', head.offsetHeight + 'px'); };
        setH();
        if (window.ResizeObserver) { view.ro = new ResizeObserver(setH); view.ro.observe(head); }
        else { window.addEventListener('resize', setH); view.offs.push(function () { window.removeEventListener('resize', setH); }); }
      }

      function ctx() {
        return {
          session: view.session, b: view.session.b, school: view.session.b.school,
          station: view.route.station, part: view.route.part,
          goPart: function (part) { MF.go(MF.routeFor.participant(view.session.pid, view.route.station, part)); },
          goStation: function (key, part) { MF.go(MF.routeFor.participant(view.session.pid, key, part)); },
          completion: completionHtml,
          refresh: function () { schedule({ structural: true }); }
        };
      }

      function renderContext() {
        var b = view.session.b, p = b.participant, ref = C.referral(b);
        root.querySelector('[data-ctx-id]').innerHTML = '<span class="cid-l">رقم المشارك</span>' + D.ltr(p.code, 'pid-lg');
        var nm = root.querySelector('[data-ctx-name]');
        nm.innerHTML = p.name ? esc(p.name) : '<span class="muted">بدون اسم</span>';
        var done = p.status === 'completed';
        var ro = readOnly();
        view.stationRoot.inert = ro;
        view.stationRoot.classList.toggle('is-readonly', ro);
        var rob = root.querySelector('[data-ro]');
        if (rob) rob.innerHTML = ro ? '<div class="notice notice-warn">' + MF.icon('archive') + '<div><strong>' + (p.archived ? 'هذا المشارك مؤرشف' : 'هذه المدرسة مؤرشفة') + ' — للعرض فقط.</strong> استعده أولًا لتعديل بياناته.</div></div>' : '';
        root.querySelector('[data-ctx-flags]').innerHTML =
          (p.archived ? '<span class="badge">مؤرشف</span>' : '') +
          (done ? '<span class="badge badge-ok">' + MF.icon('check') + '<span>مكتمل</span></span>' : '<span class="badge"><span>مسودة</span></span>') +
          (ref.alert ? '<button type="button" class="badge badge-warn ref-btn" data-act="referral" aria-label="إحالة — عرض الأسباب">' + MF.icon('warn') + '<span>إحالة</span></button>' : '');
        var nav = root.querySelector('[data-snav]');
        nav.innerHTML = '<ol class="snav-list">' + MF.STATIONS.map(function (st) {
          var state = C.stationState(b.station_status, st.key), cur = st.key === view.route.station;
          return '<li><a class="sn-item' + (cur ? ' is-current' : '') + '" href="#/' + MF.routeFor.participant(p.id, st.key) + '"' + (cur ? ' aria-current="step"' : '') + '>' +
            MF.statusRing(state) +
            '<span class="sn-t"><span class="sn-ar">' + st.ar + '</span><span class="sn-short">' + st.short + '</span><span class="sn-en">' + st.en + '</span></span>' +
            '<span class="sn-state">' + MF.STATION_STATES[state].ar + '</span></a></li>';
        }).join('') + '</ol>';
      }

      /* save / synchronisation state of THIS participant */
      function renderSave(ev) {
        var el = root.querySelector('[data-save]');
        if (!el) return;
        var st = ev.state;
        if (st === 'local_error') {
          el.className = 'ctx-save is-error';
          el.innerHTML = '<button type="button" class="save-err" data-act="retry">' + MF.icon('warn', 'ic-sm') + '<span>تعذّر الحفظ — إعادة المحاولة</span></button>';
          if (ev.changed) ui.toast('لم تُحفظ آخر التعديلات على هذا الجهاز. البيانات ما زالت ظاهرة؛ اضغط «إعادة المحاولة».', { tone: 'danger', timeout: 8000 });
        } else if (st === 'error') {
          el.className = 'ctx-save is-error';
          el.innerHTML = '<button type="button" class="save-err" data-act="sync">' + MF.icon('warn', 'ic-sm') + '<span>خطأ في المزامنة</span></button>';
        } else if (st === 'conflict') {
          el.className = 'ctx-save is-error';
          el.innerHTML = '<button type="button" class="save-err" data-act="conflict">' + MF.icon('split', 'ic-sm') + '<span>تعارض — مراجعة</span></button>';
        } else if (st === 'offline') {
          el.className = 'ctx-save is-offline';
          el.innerHTML = MF.icon('cloudOff', 'ic-sm') + '<span class="save-t">غير متصل — محفوظ محليًا</span>';
        } else if (st === 'syncing') {
          el.className = 'ctx-save is-saving';
          el.innerHTML = '<span class="dot" aria-hidden="true"></span><span class="save-t">جارٍ المزامنة</span>';
        } else {
          el.className = 'ctx-save is-saved';
          el.innerHTML = MF.icon('cloud', 'ic-sm') + '<span class="save-t">تمت المزامنة</span>';
        }
        var cb = root.querySelector('[data-conflict]');
        if (cb) cb.innerHTML = st === 'conflict' ? '<div class="notice notice-danger">' + MF.icon('split') + '<div><strong>عُدّلت بعض بيانات هذا المشارك من جهاز آخر في الوقت نفسه.</strong><p>لم يُكتب فوق أي من النسختين. راجع الاختلافات واختر القيمة الصحيحة.</p>' +
          '<button type="button" class="btn btn-primary" data-act="conflict">مراجعة التعارض</button></div></div>' : '';
      }

      /* ---------- stations ---------- */
      function openStation(r) {
        var key = r.station;
        if (!MF.stations[key]) {
          key = C.currentStation(view.session.b.station_status) || 'registration';
          MF.go(MF.routeFor.participant(view.session.pid, key), true);
          return;
        }
        if (view.station && view.station.unmount) view.station.unmount(view.stationRoot, ctx());
        MF.Picker.prune();
        view.route = r;
        view.station = MF.stations[key];
        var c = ctx();
        if (view.station.normalizePart) {
          var part = view.station.normalizePart(r.part, c);
          if (part !== r.part) { MF.go(MF.routeFor.participant(view.session.pid, key, part), true); return; }
        }
        view.stationRoot.setAttribute('data-key', key);
        view.stationRoot.classList.remove('st-in'); void view.stationRoot.offsetWidth; view.stationRoot.classList.add('st-in');
        view.stationRoot.innerHTML = view.station.render(c);
        /* widths set from script (the content security policy allows no inline style attributes) */
        D.qsa('[data-w]', view.stationRoot).forEach(function (el) { el.style.width = el.getAttribute('data-w') + '%'; });
        if (view.station.mount) view.station.mount(view.stationRoot, c);
        syncAll({ structural: true });
        renderContext();
        var curPart = view.stationRoot.querySelector('.parts .part.is-current');
        if (curPart) { try { curPart.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* ignore */ } }
        window.scrollTo(0, 0);
      }

      var pending = null, rafId = 0;
      function schedule(info) {
        pending = pending || {};
        if (info) Object.keys(info).forEach(function (k) { pending[k] = info[k]; });
        if (rafId) return;
        rafId = requestAnimationFrame(function () {
          rafId = 0;
          var inf = pending; pending = null;
          syncAll(inf || {});
        });
      }
      function syncAll(info) {
        if (!view.station) return;
        var c = ctx();
        if (view.station.sync) view.station.sync(view.stationRoot, c, info || {});
        MF.controls.sync(view.stationRoot, view.session, view.station.when ? view.station.when(c) : null);
        if (view.station.kept) MF.controls.keptSync(view.stationRoot, view.station.kept(c));
        syncCompletion();
        renderContext();
      }

      /* ---------- review and complete (bottom of every station) ---------- */
      function completionHtml(title) {
        return '<section class="complete" data-complete aria-labelledby="cb-t">' +
          '<h3 class="cb-title" id="cb-t">' + esc(title || 'المراجعة والإكمال') + '</h3>' +
          '<div class="cb-review" data-cb-review></div>' +
          '<div class="cb-confirm" data-cb-confirm hidden><p>توجد ملاحظات أو قياسات لم تُفحص. هل تريد إكمال القسم على أي حال؟</p>' +
            '<div class="cb-confirm-a"><button type="button" class="btn btn-primary" data-act="complete-force">إكمال القسم على أي حال</button><button type="button" class="btn" data-act="complete-cancel">متابعة المراجعة</button></div></div>' +
          '<div class="cb-done" data-cb-done hidden></div>' +
          '<button type="button" class="btn btn-primary btn-lg btn-block cb-btn" data-act="complete">' + MF.icon('check') + '<span>إكمال القسم</span></button>' +
          '</section>';
      }
      function syncCompletion() {
        var box = view.stationRoot.querySelector('[data-complete]');
        if (!box) return;
        var key = view.route.station, b = view.session.b;
        var r = MF.review[key](b);
        var state = C.stationState(b.station_status, key);
        var html = '';
        if (r.errors.length) html += '<div class="notice notice-danger">' + MF.icon('warn') + '<div><strong>يجب تصحيح ما يلي قبل الإكمال:</strong><ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div></div>';
        if (r.warnings.length) html += '<div class="notice notice-warn">' + MF.icon('info') + '<div><strong>ملاحظات (' + r.warnings.length + ')</strong><ul>' + r.warnings.slice(0, 14).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + (r.warnings.length > 14 ? '<li>… و' + (r.warnings.length - 14) + ' غيرها</li>' : '') + '</ul></div></div>';
        if (r.notTested.length) html += '<div class="nt-line"><span class="nt-l">Not tested:</span>' + r.notTested.map(function (t) { return '<span class="nt-chip">' + D.ltr(t) + '</span>'; }).join('') + '</div>';
        if (!html) html = '<p class="cb-ok">' + MF.icon('check', 'ic-sm') + '<span>كل العناصر مُدخلة.</span></p>';
        box.querySelector('[data-cb-review]').innerHTML = html;
        var btn = box.querySelector('.cb-btn');
        var done = box.querySelector('[data-cb-done]');
        btn.disabled = r.errors.length > 0;
        if (state === 'completed') {
          var st = b.station_status[key], nx = nextStation(key);
          done.hidden = false;
          done.innerHTML = '<div class="notice notice-ok">' + MF.icon('check') + '<div><strong>اكتمل هذا القسم</strong>' + (st.completed_at ? ' <span class="muted">' + D.ltr(fmtTime(st.completed_at)) + '</span>' : '') + '<p>يمكنك التعديل في أي وقت، وتُحفظ التعديلات تلقائيًا ويبقى القسم مكتملًا.</p></div></div>' +
            (nx ? '<button type="button" class="btn btn-lg btn-block" data-act="next-station">' + '<span>الانتقال إلى: ' + nx.ar + '</span>' + MF.icon('forward') + '</button>' :
              (b.participant.status === 'completed' ? '<a class="btn btn-lg btn-block" href="#/' + MF.routeFor.school(b.school.id) + '">اكتملت جميع المحطات — العودة إلى المدرسة</a>' : ''));
          btn.hidden = true;
          box.querySelector('[data-cb-confirm]').hidden = true;
        } else {
          done.hidden = true;
          btn.hidden = false;
        }
      }
      function doComplete(force) {
        var key = view.route.station, b = view.session.b, r = MF.review[key](b);
        var box = view.stationRoot.querySelector('[data-complete]');
        if (r.errors.length) { box.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
        if (!force && (r.warnings.length || r.notTested.length)) {
          var cf = box.querySelector('[data-cb-confirm]');
          cf.hidden = false;
          box.querySelector('.cb-btn').hidden = true;
          cf.querySelector('[data-act="complete-force"]').focus({ preventScroll: true });
          return;
        }
        view.session.complete(key).then(function () {
          ui.toast('اكتمل قسم «' + stationDef(key).ar + '».');
        }, function () { /* the save indicator reports the failure */ });
        syncAll({});
      }

      /* ---------- actions ---------- */
      function onAct(e, btn) {
        var a = btn.getAttribute('data-act');
        if (a === 'complete') doComplete(false);
        else if (a === 'complete-force') doComplete(true);
        else if (a === 'complete-cancel') { var box = view.stationRoot.querySelector('[data-complete]'); box.querySelector('[data-cb-confirm]').hidden = true; box.querySelector('.cb-btn').hidden = false; }
        else if (a === 'next-station') { var nx = nextStation(view.route.station); if (nx) MF.go(MF.routeFor.participant(view.session.pid, nx.key)); }
        else if (a === 'retry') view.session.retry().catch(function () {});
        else if (a === 'sync') MF.actions.syncPanel();
        else if (a === 'conflict') MF.conflicts.open(view.session);
        else if (a === 'referral') referralInfo();
        else if (a === 'pmenu') participantMenu(btn);
      }

      function referralInfo() {
        var r = C.referral(view.session.b);
        var li = function (x) { return '<li>' + D.ltr(x.text) + '</li>'; };
        ui.dialog({
          title: 'إحالة',
          body:
            (r.re ? '<div class="ref-sec"><h3 class="mini-h">Referral_Refractive_Error</h3><p class="hint">القيمة المطلقة للكرة أو الأسطوانة أكبر من 1.00 D</p><ul class="ref-list">' + r.reReasons.map(li).join('') + '</ul></div>' : '') +
            (r.va ? '<div class="ref-sec"><h3 class="mini-h">Referral_VA</h3><p class="hint">حدة إبصار مسجَّلة أسوأ من 6/9</p><ul class="ref-list">' + r.vaReasons.map(li).join('') + '</ul></div>' : '') +
            '<p class="hint">التنبيه للمساعدة فقط؛ القرار السريري للفاحص.</p>',
          actions: [{ label: 'حسنًا', value: true, kind: 'primary' }]
        });
      }

      function participantMenu(btn) {
        var p = view.session.b.participant;
        var items = [];
        if (admin) items.push({ label: 'تعديل رقم المشارك', icon: 'edit', value: 'edit-id', disabled: p.archived || !MF.net.online });
        items.push({ label: 'العودة إلى المدرسة', icon: 'school', value: 'school' });
        items.push({ label: 'حالة المزامنة', icon: 'sync', value: 'sync' });
        if (admin) items.push({ divider: true }, { label: p.archived ? 'استعادة المشارك' : 'أرشفة المشارك', icon: p.archived ? 'restore' : 'archive', value: 'archive', danger: !p.archived, disabled: !MF.net.online });
        ui.menu(btn, items).then(function (v) {
          if (v === 'sync') MF.actions.syncPanel();
          if (v === 'edit-id') editId();
          else if (v === 'school') MF.go(MF.routeFor.school(view.session.b.school.id));
          else if (v === 'archive') archive();
        });
      }

      /* تعديل رقم المشارك: same school, no duplicates, explicit confirmation */
      function editId() {
        var s = view.session, p = s.b.participant, sc = s.b.school;
        MF.ParticipantRepository.usedSeqs(sc.id).then(function (seqs) {
          var used = seqs.filter(function (q) { return q !== p.seq; });
          var val = p.seq;
          return ui.dialog({
            title: 'تعديل رقم المشارك',
            body:
              '<p class="dlg-text">الرقم الحالي: ' + D.ltr(p.code, 'pid') + '. يتغيّر الجزء الثاني فقط، وتبقى المدرسة نفسها.</p>' +
              '<div class="field"><label for="eid-in">الرقم الجديد</label><div class="input-unit" dir="ltr"><span class="unit num">' + sc.number + '-</span>' +
              '<input id="eid-in" class="input input-num" inputmode="numeric" pattern="[0-9]*" value="' + p.seq + '" autocomplete="off"></div>' +
              '<p class="hint eid-prev"></p><p class="field-error eid-err" role="alert" hidden></p></div>',
            actions: [{ label: 'إلغاء', value: null }, {
              label: 'متابعة', kind: 'primary', value: 'next', onClick: function (api) {
                var err = api.el.querySelector('.eid-err');
                if (!(val >= 1)) { err.textContent = 'أدخل رقمًا صحيحًا.'; err.hidden = false; return false; }
                if (val === p.seq) { err.textContent = 'الرقم لم يتغيّر.'; err.hidden = false; return false; }
                if (used.indexOf(val) >= 0) { err.textContent = 'رقم المشارك ' + D.iso(sc.number + '-' + val) + ' موجود مسبقًا.'; err.hidden = false; return false; }
                return true;
              }
            }],
            onMount: function (el, api) {
              var inp = el.querySelector('#eid-in'), prev = el.querySelector('.eid-prev'), err = el.querySelector('.eid-err');
              function upd() {
                val = parseInt(D.normalizeDigits(inp.value), 10);
                err.hidden = true;
                prev.innerHTML = val >= 1 ? 'سيصبح: ' + D.ltr(p.code) + ' ← ' + D.ltr(sc.number + '-' + val) : '';
                if (val >= 1 && used.indexOf(val) >= 0) { err.textContent = 'رقم المشارك ' + D.iso(sc.number + '-' + val) + ' موجود مسبقًا.'; err.hidden = false; }
                api.action(1).disabled = !(val >= 1) || val === p.seq || used.indexOf(val) >= 0;
              }
              inp.addEventListener('input', upd); upd();
              setTimeout(function () { inp.focus(); inp.select(); }, 60);
            }
          }).then(function (v) {
            if (v !== 'next') return;
            var to = sc.number + '-' + val;
            return ui.confirm({
              title: 'تأكيد تعديل رقم المشارك',
              message: 'سيتغيّر رقم المشارك من ' + D.ltr(p.code) + ' إلى ' + D.ltr(to) + '. تبقى جميع بياناته كما هي. هل تريد المتابعة؟',
              confirmLabel: 'تعديل الرقم'
            }).then(function (ok) {
              if (!ok) return;
              return s.flush().then(function () { return MF.ParticipantRepository.changeSequence(p.id, val); }).then(function (np) {
                p.seq = np.seq; p.code = np.code; p.updated_at = np.updated_at;
                renderContext();
                ui.toast('أصبح رقم المشارك ' + D.iso(np.code) + '.');
              }, function (err) { ui.alert({ title: 'لم يُعدَّل الرقم', message: esc(MF.err.message(err)) }); });
            });
          });
        });
      }

      function archive() {
        var s = view.session, p = s.b.participant;
        if (p.archived) {
          s.flush().then(function () { return MF.ParticipantRepository.setArchived(p.id, false); }).then(function (np) { p.archived = false; p.archived_at = null; p.updated_at = np.updated_at; renderContext(); ui.toast('تمت استعادة المشارك.'); },
            function (err) { ui.alert({ title: 'تعذّرت الاستعادة', message: esc(MF.err.message(err)) }); });
          return;
        }
        ui.confirm({
          title: 'أرشفة المشارك',
          message: 'سيُخفى المشارك ' + D.ltr(p.code) + ' من قائمة المدرسة ومن ملف Excel. لا تُحذف بياناته، ولا يُعاد استخدام رقمه تلقائيًا. يمكن استعادته من «المؤرشفون».',
          confirmLabel: 'أرشفة', danger: true
        }).then(function (ok) {
          if (!ok) return;
          s.flush().then(function () { return MF.sync.drain(8000); }).then(function () { return MF.ParticipantRepository.setArchived(p.id, true); }).then(function () {
            p.archived = true;
            ui.toast('أُرشف المشارك ' + D.iso(p.code) + '.');
            MF.go(MF.routeFor.school(s.b.school.id));
          }, function (err) { ui.alert({ title: 'تعذّرت الأرشفة', message: esc(MF.err.message(err)) }); });
        });
      }

      return {
        ready: ready,
        update: function (r) { if (!view.session) return; openStation(r); },
        flush: function () { return view.session ? view.session.flush().catch(function () {}) : Promise.resolve(); },
        hasUnsaved: function () { return view.session ? view.session.hasUnsaved() : false; },
        beforeLeave: function () { return view.session ? view.session.flush().catch(function () {}) : Promise.resolve(); },
        unmount: function () {
          if (view.stopLive) view.stopLive();
          if (view.offNet) view.offNet();
          reloadFromServer.cancel();
          if (view.session) { view.session.flush().catch(function () {}); view.session.dispose(); }
          if (view.station && view.station.unmount) view.station.unmount(view.stationRoot, ctx());
          view.offs.forEach(function (f) { f(); });
          if (view.ro) view.ro.disconnect();
          cancelAnimationFrame(rafId);
        }
      };
    }
  };
})();
