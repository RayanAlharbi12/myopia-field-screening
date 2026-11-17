/* Station 3 — Strabismus & Ocular Motility: A. Cover test (distance, near) · B. EOM */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, C = MF.controls, K = MF.stationKit, O = MF.OPT, CL = MF.clinical;

  var SIDES = [['dist', 'Distance', 'للبعيد'], ['near', 'Near', 'للقريب']];
  var EOM = 'eom_findings';

  function coverPanel(side) {
    var k = side[0], b = function (f) { return 's|strabismus|' + k + '_' + f; };
    return '<article class="ct-card" aria-label="Cover test ' + side[1] + '">' +
      '<header class="ct-head"><span class="ct-name">' + D.ltr(side[1]) + '</span><span class="ct-ar">' + side[2] + '</span></header>' +
      C.q('', C.choice(b('test'), O.coverTest, { cols: 4, compact: true, center: true, ltr: true, label: 'Cover test ' + side[1] }), { cls: 'ct-primary' }) +
      C.reveal(k + '_phoria',
        C.q(D.ltr('Phoria type'), C.choice(b('phoria'), O.phoriaType, { cols: 2, compact: true, ltr: true })) +
        C.reveal(k + '_phoriaOther', C.q('Other', C.text(b('phoria_other'), { placeholder: 'اذكر النوع', dir: 'auto' })))) +
      C.reveal(k + '_tropia',
        C.q(D.ltr('Tropia'), C.choice(b('pattern'), O.tropiaPattern, { cols: 2, compact: true, ltr: true })) +
        C.reveal(k + '_eye', C.q('أي عين؟', C.choice(b('eye'), O.eye2, { cols: 2, compact: true, center: true, ltr: true }))) +
        C.reveal(k + '_freq', C.q(D.ltr('Frequency'), C.choice(b('freq'), O.tropiaFrequency, { cols: 2, compact: true, ltr: true }))) +
        C.reveal(k + '_type', C.q(D.ltr('Tropia type'), C.choice(b('type'), O.tropiaType, { cols: 2, compact: true, ltr: true })) +
          C.reveal(k + '_typeOther', C.q('Other', C.text(b('type_other'), { placeholder: 'اذكر النوع', dir: 'auto' }))))) +
      C.keptNote(k + '_branch') +
      '<p class="ct-line" data-ct-line="' + k + '"></p>' +
      '</article>';
  }

  function finding(ctx, eye, muscle) {
    return ctx.session.list(EOM, function (x) { return x.eye === eye && x.muscle === muscle; })[0] || null;
  }

  function eomEye(ctx, eye) {
    return '<div class="eom-eye"><h4 class="eom-eye-h">' + D.ltr(eye) + '</h4>' + O.muscles.map(function (m) {
      var f = finding(ctx, eye, m.v), sel = !!(f && f.selected);
      var grades = O.eomGrades.map(function (g) { return { v: g, ar: g > 0 ? '+' + g : String(g) }; });
      return '<div class="mus' + (sel ? ' is-sel' : '') + '" data-mus="' + eye + '-' + m.v + '">' +
        '<button type="button" class="opt is-multi mus-btn" aria-pressed="' + sel + '" data-sa="muscle" data-eye="' + eye + '" data-muscle="' + m.v + '"><span class="mark" aria-hidden="true"></span>' +
          '<span class="opt-t"><bdi dir="ltr">' + m.en + '</bdi><span class="sub"><bdi dir="ltr">' + m.v + '</bdi></span></span></button>' +
        (f ? '<div class="mus-b" data-when="mus_' + f.id + '">' +
          '<p class="mus-help" dir="ltr"><span>Primary: ' + m.actions[0] + '</span>' + (m.actions[1] ? '<span>Secondary: ' + m.actions[1] + '</span>' : '') + (m.actions[2] ? '<span>Tertiary: ' + m.actions[2] + '</span>' : '') + '</p>' +
          '<div class="grade" dir="ltr">' + C.choice('i|' + EOM + '|' + f.id + '|grade', grades, { compact: true, center: true, cls: 'grade-row', label: eye + ' ' + m.en + ' grade', ltr: true }) +
          '<p class="grade-key"><span>−4 … −1 limitation</span><span>0 full</span><span>+1 … +4 overaction</span></p></div>' +
          C.q('ملاحظة <span class="opt-l">(اختياري)</span>', C.text('i|' + EOM + '|' + f.id + '|note', { placeholder: 'ملاحظة قصيرة', dir: 'auto' })) +
        '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  MF.stations.strabismus = {
    render: function (ctx) {
      return K.header('strabismus') +
        '<section class="sub-sec"><h3 class="part-h"><span class="part-code">A</span>' + D.ltr('Cover Test') + ' / الحول</h3>' +
          '<p class="hint">البعيد والقريب مستقلان تمامًا؛ لا يُنسخ أحدهما إلى الآخر.</p>' +
          '<div class="ct-grid">' + SIDES.map(coverPanel).join('') + '</div></section>' +
        '<section class="sub-sec"><h3 class="part-h"><span class="part-code">B</span>' + D.ltr('EOM') + ' — حركة عضلات العين</h3>' +
          C.q('', C.choice('s|strabismus|eom_status', O.eomStatus, { cols: 3, center: true, ltr: true, label: 'EOM' })) +
          C.reveal('eomAbnormal', '<p class="hint">اختر العضلة أو العضلات المتأثرة، ثم الدرجة. وصف حركة العضلة للمساعدة فقط ولا يُستخدم للتشخيص.</p><div class="eom-grid" dir="ltr" data-list="eom"></div>') +
          C.keptNote('eom') +
        '</section>' +
        ctx.completion('مراجعة وإكمال الحول وحركة العين');
    },
    when: function (ctx) {
      var st = ctx.b.strabismus, w = {};
      SIDES.forEach(function (s) {
        var f = CL.coverFlow(st, s[0]);
        w[s[0] + '_phoria'] = f.phoria; w[s[0] + '_phoriaOther'] = f.phoriaOther;
        w[s[0] + '_tropia'] = f.tropia; w[s[0] + '_eye'] = f.eye; w[s[0] + '_freq'] = f.freq;
        w[s[0] + '_type'] = f.type; w[s[0] + '_typeOther'] = f.typeOther;
      });
      w.eomAbnormal = st.eom_status === 'abnormal';
      ctx.session.list(EOM).forEach(function (x) { w['mus_' + x.id] = !!x.selected; });
      return w;
    },
    kept: function (ctx) {
      var st = ctx.b.strabismus, k = {};
      SIDES.forEach(function (s) {
        var f = CL.coverFlow(st, s[0]), p = s[0] + '_';
        var hidden = [];
        if (!f.phoria && st[p + 'phoria']) hidden.push('Phoria type');
        if (!f.tropia && (st[p + 'pattern'] || st[p + 'freq'] || st[p + 'type'])) hidden.push('Tropia');
        if (f.tropia && st[p + 'pattern'] === 'alternating' && st[p + 'eye']) hidden.push('Eye');
        if (hidden.length) k[p + 'branch'] = 'إجابات سابقة (' + hidden.join('، ') + ') محفوظة ومخفية لأن الاختيار الحالي لا يتطلبها، ولا تُصدَّر.';
      });
      if (st.eom_status !== 'abnormal' && ctx.session.list(EOM, function (x) { return x.selected; }).length) k.eom = 'نتائج العضلات (Abnormal) محفوظة ومخفية، ولا تُصدَّر ما دامت الحالة ليست Abnormal.';
      return k;
    },
    sync: function (root, ctx) {
      K.syncLists(root, ctx, {
        eom: {
          sig: function (c) { return c.session.list(EOM).map(function (x) { return x.id + (x.selected ? '1' : '0'); }).sort().join(','); },
          html: function (c) { return eomEye(c, 'OD') + eomEye(c, 'OS'); }
        }
      });
      SIDES.forEach(function (s) {
        var el = root.querySelector('[data-ct-line="' + s[0] + '"]');
        if (el) el.innerHTML = D.ltr(CL.coverLine(ctx.b.strabismus, s[0]));
      });
    },
    action: function (name, el, ctx) {
      var s = ctx.session;
      if (name === 'muscle') {
        var eye = el.getAttribute('data-eye'), mus = el.getAttribute('data-muscle');
        var f = finding(ctx, eye, mus);
        /* deselecting keeps the grade and note (hidden); selecting again restores them */
        if (!f) f = s.add(EOM, { eye: eye, muscle: mus, selected: true, grade: null, note: '' });
        else s.update(EOM, f.id, { selected: !f.selected });
        return;
      }
      if (name === 'kept-clear') {
        var key = el.getAttribute('data-key');
        MF.ui.confirm({ title: 'مسح البيانات المخفية', message: 'ستُحذف البيانات المخفية نهائيًا.', confirmLabel: 'مسح', danger: true }).then(function (ok) {
          if (!ok) return;
          if (key === 'eom') s.list(EOM).forEach(function (x) { s.remove(EOM, x.id).catch(function () {}); });
          else {
            var p = key.split('_')[0] + '_', st = ctx.b.strabismus, f = CL.coverFlow(st, key.split('_')[0]), patch = {};
            if (!f.phoria) { patch[p + 'phoria'] = null; patch[p + 'phoria_other'] = ''; }
            if (!f.tropia) { patch[p + 'pattern'] = null; patch[p + 'eye'] = null; patch[p + 'freq'] = null; patch[p + 'type'] = null; patch[p + 'type_other'] = ''; }
            if (f.tropia && st[p + 'pattern'] === 'alternating') patch[p + 'eye'] = null;
            s.setMany('strabismus', patch);
          }
        });
      }
    }
  };
})();
