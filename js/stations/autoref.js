/* Station 2 — Autorefraction (objective refraction): OD / OS sphere, cylinder, axis. */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, K = MF.stationKit, F = MF.fmt, CL = MF.clinical;

  var EYES = [['od', 'OD', 'العين اليمنى'], ['os', 'OS', 'العين اليسرى']];
  var MEAS = [['sph', 'Sphere', 'sphere', 'D'], ['cyl', 'Cylinder', 'cyl', 'D'], ['axis', 'Axis', 'axis', '°']];

  function eyeSummary(ar, e) {
    var s = ar[e + '_sph'], c = ar[e + '_cyl'], a = ar[e + '_axis'];
    if (s == null && c == null && a == null) return 'Not tested';
    return (s == null ? 'NT' : F.power(s)) + ' / ' + (c == null ? 'NT' : F.power(c)) + ' × ' + (a == null ? 'NT' : a + '°');
  }

  MF.stations.autoref = {
    render: function (ctx) {
      return K.header('autoref', '<p class="st-note">' + D.ltr('Objective Refraction') + '</p>') +
        '<p class="howto">' + MF.icon('info', 'ic-sm') + '<span>المس المقياس مرة لتفعيله ثم اسحب. المس القيمة الوسطى لفتح القائمة أو الكتابة. كل القيم تبدأ ' + D.ltr('Not tested') + '.</span></p>' +
        '<section class="eyes" dir="ltr">' + EYES.map(function (e) {
          return '<article class="eye-card" aria-label="' + e[1] + '">' +
            '<header class="eye-head"><span class="eye-code">' + e[1] + '</span><span class="eye-name" dir="rtl">' + e[2] + '</span><span class="eye-sum" data-eye-sum="' + e[0] + '"></span></header>' +
            '<div class="pickers p3">' + MEAS.map(function (m) { return '<div class="mp-slot" data-picker="' + e[0] + '_' + m[0] + '" data-kind="' + m[2] + '" data-label="' + m[1] + '" data-sub="' + m[3] + '" data-aria="' + e[1] + ' ' + m[1] + '"></div>'; }).join('') + '</div>' +
          '</article>';
        }).join('') + '</section>' +
        '<div class="alert-slot" data-ref-alert></div>' +
        ctx.completion('مراجعة وإكمال الانكسار الموضوعي');
    },
    mount: function (root, ctx) {
      var s = ctx.session;
      this.pickers = D.qsa('[data-picker]', root).map(function (slot) {
        var field = slot.getAttribute('data-picker'), kind = slot.getAttribute('data-kind');
        return new MF.Picker(slot, {
          kind: kind, label: slot.getAttribute('data-label'), sub: slot.getAttribute('data-sub'), aria: slot.getAttribute('data-aria'),
          get: function () { return s.b.autorefraction[field]; },
          set: function (v) { s.set('autorefraction', field, v); },
          flag: kind === 'axis' ? null : function (v) { return F.powerOverLimit(v); }
        });
      });
    },
    sync: function (root, ctx) {
      var ar = ctx.b.autorefraction;
      (this.pickers || []).forEach(function (p) { p.sync(); });
      EYES.forEach(function (e) { var el = root.querySelector('[data-eye-sum="' + e[0] + '"]'); if (el) el.textContent = eyeSummary(ar, e[0]); });
      var rs = CL.refractiveReasons(ar), slot = root.querySelector('[data-ref-alert]');
      slot.innerHTML = rs.length ? '<div class="notice notice-warn ref-alert" role="status">' + MF.icon('warn') + '<div><strong>تنبيه انكساري — ' + D.ltr('Referral_Refractive_Error') + '</strong>' +
        '<p>القيمة المطلقة أكبر من ' + D.ltr('1.00 D') + ': ' + rs.map(function (r) { return D.ltr(r.text); }).join('، ') + '</p></div></div>' : '';
    },
    unmount: function () { (this.pickers || []).forEach(function (p) { p.destroy(); }); this.pickers = []; }
  };
})();
