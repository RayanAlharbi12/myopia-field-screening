/* Station 4 — Visual Acuity: VAsc, VAcc (when glasses), Pinhole, +2.00 DS, cause of visual impairment. */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, C = MF.controls, K = MF.stationKit, O = MF.OPT, CL = MF.clinical, F = MF.fmt;

  function slots(prefix, eyes, title) {
    return '<div class="pickers p' + eyes.length + '">' + eyes.map(function (e) {
      return '<div class="mp-slot" data-picker="' + prefix + '_' + e.toLowerCase() + '" data-label="' + e + '" data-aria="' + title + ' ' + e + '"></div>';
    }).join('') + '</div>';
  }

  MF.stations.va = {
    render: function (ctx) {
      var causeOpts = O.viCause.map(function (o) {
        return o.v === 'refractive' ? Object.assign({}, o, { sub: 'Consider refractive error when VA is worse than 6/9 (0.67) and improves with pinhole to 6/9 or better.' }) : o;
      });
      return K.header('va') +
        '<p class="howto">' + MF.icon('info', 'ic-sm') + '<span>المس المقياس مرة لتفعيله ثم اسحب. الأفضل في الأعلى. المس القيمة الوسطى لفتح القائمة أو الكتابة (مثل ' + D.ltr('6/12') + ' أو ' + D.ltr('CF') + ').</span></p>' +
        '<section class="va-grid" dir="ltr">' +
          '<article class="eye-card va-card"><header class="eye-head"><span class="eye-code">VAsc</span><span class="eye-name" dir="rtl">دون تصحيح</span></header>' + slots('vasc', ['OD', 'OS', 'OU'], 'VAsc') + '</article>' +
          '<article class="eye-card va-card" data-when="vacc"><header class="eye-head"><span class="eye-code">VAcc</span><span class="eye-name" dir="rtl">مع التصحيح (النظارة)</span></header>' +
            '<p class="hint" dir="rtl" data-when="vaccOptional">اختياري: المشارك كان يرتدي نظارة سابقًا ولم يعد يرتديها، فلا يُفترض وجود تصحيح حالي. يبقى ' + D.ltr('Not tested') + ' ما لم يُقَس فعلًا بتصحيح.</p>' +
            slots('vacc', ['OD', 'OS', 'OU'], 'VAcc') + '</article>' +
          '<article class="eye-card va-card"><header class="eye-head"><span class="eye-code">Pinhole</span><span class="eye-name" dir="rtl">الثقب</span></header>' + slots('ph', ['OD', 'OS'], 'Pinhole') + '</article>' +
        '</section>' +
        '<div class="notice" data-when="vaccOff">' + MF.icon('info') + '<span>' + D.ltr('VAcc') + ' يظهر عندما تكون إجابة النظارة في التسجيل: نعم، أو نعم ولكن لا يرتديها حاليًا، أو كان يرتديها سابقًا (اختياري).</span></div>' +
        C.keptNote('vacc') +
        '<section class="sub-sec plus"><h3 class="part-h">' + D.ltr('Plus +2.00 DS lens test') + '</h3>' +
          '<div class="plus-grid" dir="ltr">' + ['OD', 'OS'].map(function (e) {
            return '<div class="plus-row"><span class="plus-eye">' + e + '</span>' + C.choice('s|visual_acuity|plus_' + e.toLowerCase(), O.plusLens, { cols: 3, compact: true, center: true, ltr: true, label: '+2.00 DS ' + e }) + '</div>';
          }).join('') + '</div></section>' +
        '<div class="alert-slot" data-va-alert></div>' +
        '<section class="sub-sec cause"><h3 class="part-h">' + D.ltr('Cause of Visual Impairment') + '</h3>' +
          '<p class="hint">سبب رئيسي واحد. يختاره الفاحص؛ لا يُشخَّص تلقائيًا.</p>' +
          C.q('', C.choice('s|visual_acuity|cause', causeOpts, { stack: true, label: 'Cause of Visual Impairment' })) +
          C.reveal('ambly', C.q('كسل بالعين', C.choice('s|visual_acuity|ambly_lat', O.amblyLaterality, { cols: 2, center: true })) +
            C.reveal('amblyEye', C.q('أي عين؟', C.choice('s|visual_acuity|ambly_eye', O.eye2, { cols: 2, center: true, ltr: true })))) +
          C.reveal('strab', '<div class="notice" data-strab-sum></div>') +
          C.reveal('causeOther', C.q('اذكر السبب', C.text('s|visual_acuity|cause_other', { placeholder: 'السبب', dir: 'auto' }))) +
          C.keptNote('cause') +
        '</section>' +
        ctx.completion('مراجعة وإكمال حدة الإبصار');
    },
    mount: function (root, ctx) {
      var s = ctx.session;
      this.pickers = D.qsa('[data-picker]', root).map(function (slot) {
        var field = slot.getAttribute('data-picker');
        return new MF.Picker(slot, {
          kind: 'va', label: slot.getAttribute('data-label'), aria: slot.getAttribute('data-aria'),
          get: function () { return s.b.visual_acuity[field] || null; },
          set: function (v) { s.set('visual_acuity', field, v); },
          flag: function (v) { return F.vaWorseThanLimit(v); }
        });
      });
    },
    when: function (ctx) {
      var v = ctx.b.visual_acuity, vacc = CL.vaccApplicable(ctx.b.registration);
      return {
        vacc: vacc, vaccOff: !vacc, vaccOptional: CL.vaccOptional(ctx.b.registration),
        ambly: v.cause === 'amblyopia', amblyEye: v.cause === 'amblyopia' && v.ambly_lat === 'one',
        strab: v.cause === 'strabismus', causeOther: v.cause === 'other'
      };
    },
    kept: function (ctx) {
      var v = ctx.b.visual_acuity, k = {};
      if (!CL.vaccApplicable(ctx.b.registration) && (v.vacc_od || v.vacc_os || v.vacc_ou)) {
        k.vacc = 'قياسات VAcc السابقة محفوظة (' + ['vacc_od', 'vacc_os', 'vacc_ou'].filter(function (f) { return v[f]; }).map(function (f) { return f.slice(5).toUpperCase() + ' ' + v[f]; }).join('، ') + ') ومخفية لأن إجابة النظارة تغيّرت. لا تُصدَّر ما دامت كذلك.';
      }
      var hid = [];
      if (v.cause !== 'amblyopia' && (v.ambly_lat || v.ambly_eye)) hid.push('كسل بالعين');
      if (v.cause === 'amblyopia' && v.ambly_lat === 'both' && v.ambly_eye) hid.push('العين');
      if (v.cause !== 'other' && String(v.cause_other || '').trim()) hid.push('سبب آخر');
      if (hid.length) k.cause = 'تفاصيل سابقة (' + hid.join('، ') + ') محفوظة ومخفية ولا تُصدَّر.';
      return k;
    },
    sync: function (root, ctx) {
      (this.pickers || []).forEach(function (p) { p.sync(); });
      var rs = CL.vaReasons(ctx.b.visual_acuity, ctx.b.registration), slot = root.querySelector('[data-va-alert]');
      slot.innerHTML = rs.length ? '<div class="notice notice-warn ref-alert" role="status">' + MF.icon('warn') + '<div><strong>تنبيه حدة الإبصار — ' + D.ltr('Referral_VA') + '</strong><p>أسوأ من ' + D.ltr('6/9') + ': ' + rs.map(function (r) { return D.ltr(r.text); }).join('، ') + '</p></div></div>' : '';
      var ss = root.querySelector('[data-strab-sum]');
      if (ss) {
        var st = ctx.b.strabismus;
        ss.innerHTML = MF.icon('info') + '<div><strong>بيانات محطة الحول المسجَّلة</strong><p>' + D.ltr('Distance: ' + CL.coverLine(st, 'dist')) + '</p><p>' + D.ltr('Near: ' + CL.coverLine(st, 'near')) + '</p></div>';
      }
      /* when VAcc is hidden its pickers must not keep an armed state */
      if (!CL.vaccApplicable(ctx.b.registration)) (this.pickers || []).forEach(function (p) { if (/^vacc_/.test(p.host.getAttribute('data-picker'))) p.disarm(); });
    },
    action: function (name, el, ctx) {
      if (name !== 'kept-clear') return;
      var s = ctx.session, key = el.getAttribute('data-key');
      MF.ui.confirm({ title: 'مسح البيانات المخفية', message: 'ستُحذف البيانات المخفية نهائيًا.', confirmLabel: 'مسح', danger: true }).then(function (ok) {
        if (!ok) return;
        if (key === 'vacc') s.setMany('visual_acuity', { vacc_od: null, vacc_os: null, vacc_ou: null });
        if (key === 'cause') {
          var v = ctx.b.visual_acuity, patch = {};
          if (v.cause !== 'amblyopia') { patch.ambly_lat = null; patch.ambly_eye = null; }
          if (v.cause === 'amblyopia' && v.ambly_lat === 'both') patch.ambly_eye = null;
          if (v.cause !== 'other') patch.cause_other = '';
          s.setMany('visual_acuity', patch);
        }
      });
    },
    unmount: function () { (this.pickers || []).forEach(function (p) { p.destroy(); }); this.pickers = []; }
  };
})();
