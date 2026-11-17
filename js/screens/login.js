/* Sign-in, forced password change, and the configuration problem screen. */
(function () {
  'use strict';
  var MF = window.MF, D = MF.dom, esc = D.esc, shell = MF.shell;

  function frame(inner) {
    return '<main class="page auth-page" id="main"><div class="auth-card">' +
      '<div class="auth-brand">' + shell.logo('logo-lg') + '<h1>' + MF.APP_TITLE + '</h1><p>' + esc(MF.APP_SUB) + '</p></div>' +
      inner +
      '<p class="auth-foot">' + D.ltr('v' + MF.VERSION) + '</p>' +
      '</div><div class="auth-theme">' + shell.themeButton() + '</div></main>';
  }

  MF.screens.login = {
    mount: function (root, route, opts) {
      opts = opts || {};
      var note = opts.message || MF.auth.message;
      root.innerHTML = frame(
        '<form class="form-grid auth-form" novalidate>' +
          (note ? '<div class="notice notice-warn" role="alert">' + MF.icon('info') + '<div>' + esc(note) + '</div></div>' : '') +
          '<div class="field"><label for="li-email">البريد الإلكتروني</label><input id="li-email" class="input" type="email" autocomplete="username" dir="ltr" inputmode="email" spellcheck="false" autocapitalize="off" required></div>' +
          shell.passwordField('li-pw', 'كلمة المرور', 'current-password') +
          '<p class="field-error" role="alert" hidden></p>' +
          '<button type="submit" class="btn btn-primary btn-lg btn-block" data-submit>' + MF.icon('lock') + '<span>تسجيل الدخول</span></button>' +
          '<p class="hint auth-hint" data-net-hint' + (MF.net.online ? ' hidden' : '') + '>لا يوجد اتصال بالإنترنت. يتطلب تسجيل الدخول اتصالًا.</p>' +
          '<p class="hint">الحسابات يُنشئها مدير النظام. لا يوجد تسجيل ذاتي.</p>' +
        '</form>');
      var form = root.querySelector('form'), err = root.querySelector('.field-error'), btn = root.querySelector('[data-submit]');
      var offs = [shell.bindPasswordToggles(root), D.on(root, 'click', '[data-act="theme"]', function () { MF.theme.toggle(); })];
      var offNet = MF.net.on(function (on) { var h = root.querySelector('[data-net-hint]'); if (h) h.hidden = on; });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = root.querySelector('#li-email').value.trim(), pw = root.querySelector('#li-pw').value;
        if (!email || !pw) { err.textContent = 'أدخل البريد الإلكتروني وكلمة المرور.'; err.hidden = false; return; }
        err.hidden = true;
        btn.disabled = true;
        MF.auth.signIn(email, pw).then(function (st) {
          var pwEl = root.querySelector('#li-pw');
          if (!pwEl) return;                       /* already moved on to the application */
          pwEl.value = '';
          if (st === 'disabled' || st === 'no_profile' || st === 'signed_out') {
            btn.disabled = false;
            err.textContent = MF.auth.message || MF.err.MSG.UNKNOWN; err.hidden = false;
          }
          /* other states are handled by the app (auth listener) */
        }, function (e2) {
          btn.disabled = false;
          var pwEl = root.querySelector('#li-pw');
          if (pwEl) pwEl.value = '';
          err.textContent = MF.err.message(e2); err.hidden = false;
        });
      });
      setTimeout(function () { var em = root.querySelector('#li-email'); if (em) em.focus(); }, 60);
      return { unmount: function () { offs.forEach(function (f) { f(); }); offNet(); } };
    }
  };

  MF.screens.mustChange = {
    mount: function (root) {
      var p = MF.auth.profile || {};
      root.innerHTML = frame(
        '<div class="auth-form">' +
          '<h2 class="auth-h">تغيير كلمة المرور مطلوب</h2>' +
          '<p class="dlg-text">مرحبًا ' + esc(p.full_name || '') + '. يجب اختيار كلمة مرور جديدة قبل استخدام النظام. أدخل كلمة المرور المؤقتة التي أعطاك إياها مدير النظام.</p>' +
          shell.passwordForm() +
          '<button type="button" class="btn btn-primary btn-lg btn-block" data-submit>' + MF.icon('lock') + '<span>تغيير كلمة المرور</span></button>' +
          '<button type="button" class="btn btn-quiet btn-block" data-logout>' + MF.icon('logout') + '<span>تسجيل الخروج</span></button>' +
        '</div>');
      var offs = [shell.bindPasswordToggles(root), D.on(root, 'click', '[data-act="theme"]', function () { MF.theme.toggle(); })];
      var btn = root.querySelector('[data-submit]');
      function go() {
        btn.disabled = true;
        shell.submitPassword(root).then(function () { MF.ui.toast('تم تغيير كلمة المرور.'); }, function () { btn.disabled = false; });
      }
      btn.addEventListener('click', go);
      root.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); go(); });
      root.querySelector('[data-logout]').addEventListener('click', function () { MF.auth.signOut({}).then(function () { location.reload(); }); });
      return { unmount: function () { offs.forEach(function (f) { f(); }); } };
    }
  };

  MF.screens.setup = {
    mount: function (root, route, opts) {
      var cfg = MF.env.config;
      root.innerHTML = frame(
        '<div class="notice ' + (cfg.secretKey ? 'notice-danger' : 'notice-warn') + '">' + MF.icon('warn') + '<div><strong>' + (cfg.secretKey ? 'تم إيقاف التطبيق لحماية قاعدة البيانات' : 'إعداد الاتصال غير مكتمل') + '</strong>' +
          '<p>' + esc((opts && opts.message) || cfg.problem || '') + '</p>' +
          '<p class="hint">راجع قسم «إعداد config.js» في دليل النشر (README).</p></div></div>');
      var off = D.on(root, 'click', '[data-act="theme"]', function () { MF.theme.toggle(); });
      return { unmount: off };
    }
  };
})();
