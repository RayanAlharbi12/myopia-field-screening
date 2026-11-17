/* =====================================================================
   Station 5 — Questionnaire (Arabic only), one section at a time.
   Demographics are visible and auto-populated from Registration / Family.
   Numbers are UI-only (renumbered inside each displayed section).
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, K = MF.stationKit, Q = MF.QUESTIONNAIRE, QL = MF.qlogic;

  var SECTIONS = Q.sections;
  var DUR = [['none', Q.durationOptions[0]], ['lt1', Q.durationOptions[1]], ['gt1', Q.durationOptions[2]]];

  function sec(id) { return SECTIONS.filter(function (s) { return s.id === id; })[0] || SECTIONS[0]; }
  function ans(ctx, id) { return ctx.session.answer(id); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function setAns(ctx, id, v) { ctx.session.setAnswer(id, v); }
  function num(v) { var s = D.normalizeDigits(v); if (s === '') return null; var n = parseFloat(s); return isFinite(n) ? n : null; }

  function opt(item, v, label, mode) {
    return '<button type="button" class="opt' + (mode === 'many' ? ' is-multi' : '') + '" ' + (mode === 'many' ? 'aria-pressed="false"' : 'role="radio" aria-checked="false"') +
      ' data-sa="q" data-item="' + item.id + '" data-v="' + esc(v) + '"><span class="mark" aria-hidden="true"></span><span class="opt-t">' + esc(label) + '</span></button>';
  }
  function numIn(item, key, o) {
    o = o || {};
    return '<input class="input input-num q-num-in" type="text" inputmode="decimal" autocomplete="off" data-qa="num" data-item="' + item.id + '" data-key="' + key + '"' +
      ' aria-label="' + esc(o.aria || '') + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>';
  }
  function travelRows(item) {
    return '<div class="travel">' + [['car', 'السيارة'], ['walk', 'المشي']].map(function (m) {
      return '<div class="travel-row"><button type="button" class="opt is-multi" aria-pressed="false" data-sa="q-mode" data-item="' + item.id + '" data-mode="' + m[0] + '"><span class="mark" aria-hidden="true"></span><span class="opt-t">' + m[1] + ':</span></button>' +
        '<div class="input-unit" data-qwhen="' + item.id + ':' + m[0] + '">' + numIn(item, m[0] + '_min', { aria: m[1] + ' بالدقائق', placeholder: '____' }) + '<span class="unit">' + Q.minuteUnit + '</span></div></div>';
    }).join('') + '</div>';
  }

  function control(item, ctx) {
    var b = ctx.b;
    switch (item.type) {
      case 'auto-id': case 'auto-gender': case 'auto-age': case 'auto-class': case 'auto-parent-one': case 'auto-parent-both': {
        var src = item.type.indexOf('parent') >= 0 ? 'مستنتج من بيانات الأسرة (نظارة الأب والأم)' : item.type === 'auto-id' ? 'رقم المشارك' : 'من بيانات التسجيل';
        var link = item.type.indexOf('parent') >= 0 ? 'e' : 'a';
        return '<div class="auto" data-auto="' + item.id + '"><span class="auto-v" data-auto-v></span><span class="auto-src">' + MF.icon('restore', 'ic-sm') + esc(src) +
          (item.type === 'auto-id' ? '' : ' — <button type="button" class="link-btn" data-sa="goto-reg" data-part="' + link + '">تعديل في التسجيل</button>') + '</span></div>';
      }
      case 'duration':
        return '<div class="choices stack-sm" role="radiogroup">' + DUR.map(function (d) { return opt(item, d[0], d[1]); }).join('') + '</div>' +
          '<div class="dur-h" data-qwhen="' + item.id + ':gt1"><label class="input-unit"><span class="spec">' + esc(Q.specifyLabel) + ':</span>' + numIn(item, 'hours', { aria: 'عدد الساعات', placeholder: '____' }) + '<span class="unit">' + Q.hourUnit + '</span></label></div>';
      case 'time':
        return '<div class="time-row"><input class="input" type="time" step="60" data-qa="time" data-item="' + item.id + '" aria-label="الساعة والدقيقة"><button type="button" class="btn btn-quiet" data-sa="q-clear" data-item="' + item.id + '">مسح</button></div>';
      case 'days': {
        var o = '';
        for (var i = item.min; i <= item.max; i++) o += opt(item, String(i), String(i));
        return '<div class="choices days" role="radiogroup">' + o + '</div><p class="hint">' + esc(item.unit) + '</p>';
      }
      case 'hours':
        return '<label class="input-unit">' + numIn(item, 'value', { aria: 'عدد الساعات', placeholder: '________' }) + '<span class="unit">' + Q.hourUnit + '</span></label>';
      case 'travel':
        return travelRows(item);
      case 'return':
        return '<div class="choices grid-2" role="radiogroup">' + opt(item, 'yes', item.options[0]) + opt(item, 'no', item.options[1]) + '</div>' +
          '<div class="follow" data-qwhen="' + item.id + ':no"><p class="follow-t">' + esc(item.followText) + '</p>' + travelRows(item) + '</div>';
      case 'activities':
        return '<div class="choices grid-2" role="radiogroup">' + opt(item, 'none', item.gate[0]) + opt(item, 'yes', item.gate[1]) + '</div>' +
          '<div class="acts" data-qwhen="' + item.id + ':yes">' + item.rows.map(function (lab, i) {
            return '<div class="act-row">' + (item.numberedRows ? '<span class="act-n num">' + (i + 1) + '.</span>' : '') + '<span class="act-l">' + esc(lab) + '</span>' +
              '<input class="input act-name" type="text" autocomplete="off" data-qa="act-name" data-item="' + item.id + '" data-row="' + i + '" aria-label="' + esc(lab) + ' ' + (i + 1) + '" placeholder="__________">' +
              '<span class="input-unit">' + numIn(item, 'row' + i, { aria: 'عدد الساعات للنشاط ' + (i + 1), placeholder: '____' }) + '<span class="unit">' + Q.hourUnit + '</span></span></div>';
          }).join('') + '<p class="hint">لا يلزم ملء كل الصفوف.</p></div>';
      case 'notes':
        return '<textarea class="textarea" data-qa="notes" data-item="' + item.id + '" rows="4" aria-label="ملاحظات"></textarea>';
    }
    return '';
  }

  function itemHtml(item, ctx) {
    return '<div class="qq" data-qitem="' + item.id + '">' +
      '<div class="q-label">' + (item.uiNumber ? '<span class="q-num num">' + item.uiNumber + '</span>' : '') + '<span class="q-text">' + esc(item.text) + '</span></div>' +
      (item.note ? '<p class="q-note">' + esc(item.note) + '</p>' : '') +
      '<div class="q-ctl">' + control(item, ctx) + '</div>' +
      '<p class="field-error" data-qerr hidden></p><p class="field-warn" data-qwarn hidden></p></div>';
  }

  function sectionState(ctx) {
    var a = ctx.b.questionnaire_responses.answers || {};
    return SECTIONS.map(function (s) {
      var r = QL.sectionReview(s, a, ctx.b);
      return { id: s.id, code: s.short, title: s.title.split(': ')[1] || s.title, done: r.unanswered === 0 && r.errors.length === 0, errors: r.errors.length };
    });
  }

  MF.stations.questionnaire = {
    normalizePart: function (part) { return SECTIONS.some(function (s) { return s.id === part; }) ? part : SECTIONS[0].id; },
    render: function (ctx) {
      var s = sec(ctx.part), idx = SECTIONS.indexOf(s), n = SECTIONS.length;
      var parts = sectionState(ctx);
      var body = '';
      if (s.intro) body += '<p class="q-intro">' + esc(s.intro) + '</p>';
      if (s.note) body += '<p class="hint">' + esc(s.note) + '</p>';
      s.items.forEach(function (it) {
        if (it.type === 'guide') body += '<p class="q-guide">' + esc(it.text) + '</p>';
        else body += itemHtml(it, ctx);
      });
      return K.header('questionnaire', '<p class="st-note">' + esc(Q.title) + '</p>') +
        '<div class="q-progress" aria-label="التقدم في الاستبيان"><span class="qp-t">القسم ' + (idx + 1) + ' من ' + n + '</span><span class="qp-bar"><span data-w="' + Math.round((idx + 1) / n * 100) + '"></span></span></div>' +
        K.partNav(parts, s.id, 'أقسام الاستبيان') +
        '<section class="part-body q-sec" data-part-body="' + s.id + '"><h3 class="part-h q-title">' + esc(s.title) + '</h3>' + body + '</section>' +
        '<div class="part-foot">' +
          (idx > 0 ? '<button type="button" class="btn" data-sa="part" data-part="' + SECTIONS[idx - 1].id + '">' + MF.icon('back') + '<span>السابق</span></button>' : '<span></span>') +
          (idx < n - 1 ? '<button type="button" class="btn btn-primary" data-sa="part" data-part="' + SECTIONS[idx + 1].id + '"><span>التالي</span>' + MF.icon('forward') + '</button>' : '') +
        '</div>' +
        (idx === n - 1 ? ctx.completion('مراجعة وإكمال الاستبيان') : '<p class="cb-later">' + MF.icon('info', 'ic-sm') + '<span>زر «إكمال القسم» في نهاية الاستبيان.</span></p>');
    },

    sync: function (root, ctx) {
      var a = ctx.b.questionnaire_responses.answers || {};
      K.updatePartNav(root, sectionState(ctx));
      D.qsa('[data-qitem]', root).forEach(function (box) {
        var item = Q.byId[box.getAttribute('data-qitem')], v = a[item.id];
        if (QL.isAuto(item)) {
          var d = QL.derived(item, ctx.b);
          var el = box.querySelector('[data-auto-v]');
          el.innerHTML = d == null ? '<span class="muted">' + (item.type.indexOf('parent') >= 0 ? 'لم تُسجَّل نظارة الأسرة بعد' : 'لم يُسجَّل بعد') + '</span>' : (item.type === 'auto-id' ? D.ltr(d, 'pid') : esc(d) + (item.unit ? ' ' + esc(item.unit) : ''));
          return;
        }
        /* choice states */
        D.qsa('[data-sa="q"]', box).forEach(function (b) {
          var ov = b.getAttribute('data-v'), on = false;
          if (item.type === 'duration') on = v && v.choice === ov;
          else if (item.type === 'days') on = v != null && String(v) === ov;
          else if (item.type === 'return') on = v && v.same === ov;
          else if (item.type === 'activities') on = v && v.gate === ov;
          b.setAttribute('aria-checked', String(!!on));
        });
        D.qsa('[data-sa="q-mode"]', box).forEach(function (b) { b.setAttribute('aria-pressed', String(!!(v && v[b.getAttribute('data-mode')]))); });
        /* conditional parts */
        D.qsa('[data-qwhen]', box).forEach(function (w) {
          var k = w.getAttribute('data-qwhen').split(':')[1], show = false;
          if (item.type === 'duration') show = v && v.choice === k;
          else if (item.type === 'return') show = v && v.same === k;
          else if (item.type === 'activities') show = v && v.gate === k;
          else if (item.type === 'travel') show = v && v[k];
          if (item.type === 'return' && (k === 'car' || k === 'walk')) show = v && v[k];
          if (w.hidden === !show) return;
          w.hidden = !show;
          if (show && !D.prefersReducedMotion()) { w.classList.remove('rv-in'); void w.offsetWidth; w.classList.add('rv-in'); }
        });
        /* inputs (never overwrite the field being typed in) */
        D.qsa('input[data-qa], textarea[data-qa]', box).forEach(function (inp) {
          if (document.activeElement === inp) return;
          var qa = inp.getAttribute('data-qa'), key = inp.getAttribute('data-key'), val = '';
          if (qa === 'time') val = v || '';
          else if (qa === 'notes') val = v || '';
          else if (qa === 'act-name') { var r = v && v.rows && v.rows[+inp.getAttribute('data-row')]; val = r && r.name || ''; }
          else if (qa === 'num') {
            if (item.type === 'hours') val = v;
            else if (key === 'hours') val = v && v.hours;
            else if (/^row\d$/.test(key)) { var rr = v && v.rows && v.rows[+key.slice(3)]; val = rr ? rr.hours : null; }
            else val = v && v[key];
            val = val == null ? '' : String(val);
          }
          if (inp.value !== val) inp.value = val;
        });
        var iss = QL.itemIssues(item, v);
        var er = box.querySelector('[data-qerr]'), wr = box.querySelector('[data-qwarn]');
        er.hidden = !iss.errors.length; er.textContent = iss.errors.join(' ');
        wr.hidden = !iss.warnings.length || !!iss.errors.length; wr.textContent = iss.warnings.join(' ');
        box.classList.toggle('has-error', iss.errors.length > 0);
      });
    },

    action: function (name, el, ctx) {
      if (name === 'part') { MF.flushCurrent(); ctx.goPart(el.getAttribute('data-part')); return; }
      if (name === 'goto-reg') { ctx.goStation('registration', el.getAttribute('data-part')); return; }
      var id = el.getAttribute('data-item'), item = Q.byId[id];
      if (!item) return;
      var v = clone(ans(ctx, id));
      if (name === 'q-clear') {
        if (v == null) return;
        setAns(ctx, id, null);
        MF.ui.toast('مُسحت الإجابة.', { action: { label: 'تراجع', fn: function () { setAns(ctx, id, v); } } });
        return;
      }
      if (name === 'q-mode') {
        v = v || {};
        var m = el.getAttribute('data-mode');
        v[m] = !v[m];                     /* minutes stay stored; exported only while the mode is ticked */
        setAns(ctx, id, v);
        if (v[m]) K.focusLater(el.closest('.travel-row'), 'input');
        return;
      }
      if (name === 'q') {
        var ov = el.getAttribute('data-v');
        if (item.type === 'duration') { v = v || {}; v.choice = ov; setAns(ctx, id, v); if (ov === 'gt1') K.focusLater(el.closest('.qq'), '.dur-h input'); }
        else if (item.type === 'days') setAns(ctx, id, parseInt(ov, 10));
        else if (item.type === 'return') { v = v || {}; v.same = ov; setAns(ctx, id, v); }
        else if (item.type === 'activities') { v = v || { rows: [] }; v.gate = ov; v.rows = v.rows || []; setAns(ctx, id, v); if (ov === 'yes') K.focusLater(el.closest('.qq'), '.act-name'); }
      }
    },

    input: function (el, ctx, e) {
      var id = el.getAttribute('data-item'), item = Q.byId[id], qa = el.getAttribute('data-qa');
      if (!item) return;
      var v = clone(ans(ctx, id));
      if (qa === 'time') { if (e.type === 'input' || e.type === 'change') setAns(ctx, id, el.value || null); return; }
      if (qa === 'notes') { setAns(ctx, id, el.value); return; }
      if (qa === 'act-name') {
        v = v || { gate: 'yes', rows: [] }; v.rows = v.rows || [];
        var i = +el.getAttribute('data-row');
        v.rows[i] = Object.assign({ name: '', hours: null }, v.rows[i] || {}, { name: el.value });
        setAns(ctx, id, v);
        return;
      }
      if (qa === 'num') {
        var key = el.getAttribute('data-key'), n = num(el.value);
        if (e.type === 'change') el.value = n == null ? '' : String(n);
        if (item.type === 'hours') { setAns(ctx, id, n); return; }
        v = v || {};
        if (key === 'hours') v.hours = n;
        else if (/^row\d$/.test(key)) { v.rows = v.rows || []; var r = +key.slice(3); v.rows[r] = Object.assign({ name: '', hours: null }, v.rows[r] || {}, { hours: n }); }
        else v[key] = n;
        setAns(ctx, id, v);
      }
    }
  };
})();
