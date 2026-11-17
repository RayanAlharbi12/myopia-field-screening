/* =====================================================================
   Conflict review. Shown when the same field of the same participant was
   changed on two devices before either change reached the server.
   For every field the examiner sees the value on the server (other device)
   and the value entered on this device, and chooses one:
     اعتماد نسخة الجهاز الآخر   keep remote
     اعتماد نسخة هذا الجهاز     keep local
     دمج                        choose field by field
   Nothing is overwritten until a choice is confirmed.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, ui = MF.ui;

  var WORD = { yes: 'نعم', no: 'لا', male: 'ذكر', female: 'أنثى', yes_not_now: 'نعم، ولكن لا أرتديها حاليًا', previously: 'كنت ألبس نظارة سابقًا', abnormal: 'Abnormal', nad: 'NAD', full: 'Full' };

  function fmt(v) {
    if (v === undefined || v === null || v === '') return '<span class="muted">فارغ (Not tested / لم يُجب)</span>';
    if (v === true) return 'نعم';
    if (v === false) return 'لا';
    if (Array.isArray(v)) return v.length ? v.map(function (x) { return esc(WORD[x] || String(x)); }).join('، ') : '<span class="muted">لا شيء</span>';
    if (typeof v === 'object') return D.ltr(JSON.stringify(v));
    if (typeof v === 'number') return D.ltr(String(v));
    return WORD[v] ? esc(WORD[v]) : '<bdi>' + esc(String(v)) + '</bdi>';
  }
  function fieldLabel(c, f) {
    if (f.indexOf('answers.') === 0) {
      var it = MF.QUESTIONNAIRE.byId[f.slice(8)];
      return 'الاستبيان — ' + esc(it ? it.text : f.slice(8));
    }
    return esc(MF.tableAr(c.table)) + ' — ' + D.ltr(f);
  }

  MF.conflicts = {
    open: function (session) {
      return MF.sync.conflicts(session.pid).then(function (list) {
        if (!list.length) { ui.toast('لا توجد تعارضات لهذا المشارك.'); return; }
        var rows = [];
        list.forEach(function (c, ci) {
          Object.keys(c.fields).forEach(function (f) { rows.push({ ci: ci, f: f, d: c.fields[f], c: c }); });
        });
        var body =
          '<p class="dlg-text">عُدّلت الحقول التالية على جهاز آخر وعلى هذا الجهاز قبل أن تصل المزامنة. اختر القيمة الصحيحة لكل حقل.</p>' +
          '<div class="cf-list">' + rows.map(function (r, i) {
            return '<fieldset class="cf-row"><legend>' + fieldLabel(r.c, r.f) + '</legend>' +
              '<label class="cf-opt"><input type="radio" name="cf' + i + '" value="remote" checked><span><small>على الخادم (جهاز آخر)</small><b>' + fmt(r.d.remote) + '</b></span></label>' +
              '<label class="cf-opt"><input type="radio" name="cf' + i + '" value="local"><span><small>على هذا الجهاز</small><b>' + fmt(r.d.local) + '</b></span></label>' +
              (r.d.base !== undefined ? '<p class="hint">القيمة قبل التعديلين: ' + fmt(r.d.base) + '</p>' : '') +
              '</fieldset>';
          }).join('') + '</div>';
        var picked = null;
        return ui.dialog({
          title: 'مراجعة التعارض', wide: true, body: body,
          actions: [
            { label: 'لاحقًا', value: null },
            { label: 'اعتماد نسخة الجهاز الآخر', value: 'remote' },
            { label: 'اعتماد نسخة هذا الجهاز', value: 'local' },
            { label: 'دمج (حسب الاختيار)', value: 'merge', kind: 'primary', onClick: function (api) {
              picked = rows.map(function (r, i) { var x = api.el.querySelector('input[name="cf' + i + '"]:checked'); return x ? x.value : 'remote'; });
              return true;
            } }
          ]
        }).then(function (v) {
          if (!v) return;
          var chosen = v === 'merge' ? picked : rows.map(function () { return v; });
          return list.reduce(function (pr, c, ci) {
            var choice = {};
            rows.forEach(function (r, i) { if (r.ci === ci) choice[r.f] = chosen[i]; });
            return pr.then(function () { return MF.sync.resolve(c, choice); });
          }, Promise.resolve()).then(function () { ui.toast('تم حل التعارض.'); }, function (err) {
            ui.alert({ title: 'تعذّر حل التعارض', message: esc(MF.err.message(err)) });
          });
        });
      });
    }
  };
})();
