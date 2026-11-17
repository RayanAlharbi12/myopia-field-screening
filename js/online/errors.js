/* =====================================================================
   Error mapping: database, network, sign-in and server-function errors
   become one AppError { code, message (Arabic), network, auth, retry }.
   Technical details go to the debug log only — never passwords or keys.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  var MSG = {
    NETWORK: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.',
    TIMEOUT: 'انتهت مهلة الاتصال بالخادم. أعد المحاولة.',
    NOT_AUTHENTICATED: 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.',
    SESSION_EXPIRED: 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى؛ التغييرات غير المُزامنة محفوظة على هذا الجهاز.',
    INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    ACCOUNT_DISABLED: 'هذا الحساب معطّل. تواصل مع مدير النظام.',
    NO_PROFILE: 'هذا الحساب غير مُعدّ للعمل في النظام. تواصل مع مدير النظام.',
    NOT_ADMIN: 'هذا الإجراء متاح لمدير النظام فقط.',
    INACTIVE: 'لا يمكن تنفيذ هذا الإجراء بهذا الحساب (معطّل أو بانتظار تغيير كلمة المرور).',
    FORBIDDEN: 'ليست لديك صلاحية لهذا الإجراء، أو أن السجل مؤرشف.',
    NOT_FOUND: 'السجل غير موجود أو لم يعد متاحًا.',
    ARCHIVED: 'هذا السجل مؤرشف.',
    DUPLICATE_ID: 'رقم المشارك موجود مسبقًا. يرجى تعديل العداد.',
    RANGE: 'أدخل رقمًا صحيحًا من 1 إلى 99999.',
    NOT_CACHED: 'هذا المشارك غير محفوظ على هذا الجهاز، ولا يوجد اتصال بالإنترنت لتحميله.',
    SEQ_IN_USE: 'هذا الرقم مستخدم لمشارك موجود (أو مؤرشف) في هذه المدرسة.',
    LAST_ADMIN: 'لا يمكن تعطيل أو تغيير دور آخر مدير نشط في النظام.',
    IMMUTABLE: 'لا يمكن تغيير هذا الحقل.',
    VALIDATION: 'البيانات المُدخلة غير صالحة.',
    CHECK: 'قيمة خارج النطاق المسموح.',
    UNIQUE: 'القيمة مستخدمة مسبقًا.',
    EMAIL_EXISTS: 'يوجد حساب بهذا البريد الإلكتروني مسبقًا.',
    INVALID_EMAIL: 'البريد الإلكتروني غير صالح.',
    INVALID_NAME: 'الاسم مطلوب (حتى 120 حرفًا).',
    INVALID_ROLE: 'اختر الدور.',
    WEAK_PASSWORD: 'كلمة المرور ضعيفة: 8 أحرف على الأقل، وتحتوي حروفًا وأرقامًا.',
    WRONG_PASSWORD: 'كلمة المرور الحالية غير صحيحة.',
    SAME_PASSWORD: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.',
    CURRENT_PASSWORD_REQUIRED: 'أدخل كلمة المرور الحالية.',
    RATE_LIMITED: 'محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.',
    ORIGIN_NOT_ALLOWED: 'عنوان هذا الموقع غير مسموح به في إعدادات الخادم (ALLOWED_ORIGINS).',
    ALLOWED_ORIGINS_NOT_SET: 'إعداد الخادم ALLOWED_ORIGINS غير مضبوط. راجع دليل النشر.',
    SERVER_MISCONFIGURED: 'إعدادات الخادم غير مكتملة. راجع دليل النشر.',
    FUNCTION_UNAVAILABLE: 'خدمة إدارة الحسابات غير متاحة على الخادم. تأكد من نشر Edge Functions.',
    SESSIONS_NOT_UPDATED: 'حُفظ التغيير، لكن تعذّر تحديث جلسات الدخول للحساب.',
    PROFILE_CREATE_FAILED: 'تعذّر إنشاء ملف المستخدم؛ لم يُنشأ الحساب.',
    AUTH_CREATE_FAILED: 'تعذّر إنشاء الحساب في نظام الدخول.',
    AUTH_UPDATE_FAILED: 'تعذّر تحديث كلمة المرور في نظام الدخول.',
    CONFLICT: 'عُدّل هذا السجل من جهاز آخر.',
    OFFLINE_CREATE: 'يتطلب إنشاء مشارك جديد اتصالًا بالإنترنت لحجز رقم المشارك بشكل آمن.',
    OFFLINE_ACTION: 'هذا الإجراء يتطلب اتصالًا بالإنترنت.',
    SERVER_ERROR: 'حدث خطأ في الخادم. أعد المحاولة لاحقًا.',
    UNKNOWN: 'حدث خطأ غير متوقع.'
  };

  function AppError(code, message, extra) {
    var e = new Error(message || MSG[code] || MSG.UNKNOWN);
    e.name = 'AppError';
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  function isNetworkMessage(m) {
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|the internet connection appears to be offline|network error/i.test(m || '');
  }

  /* classify anything thrown or returned by supabase-js / fetch */
  function wrap(err) {
    if (!err) return AppError('UNKNOWN');
    if (err.name === 'AppError') return err;
    var msg = String(err.message || err.error_description || err.msg || err);
    var code = err.code != null ? String(err.code) : '';
    var status = err.status || (err.context && err.context.status) || 0;
    var out;
    var mfs = /MFS:([A-Z_]+)/.exec(msg);
    if (mfs) out = AppError(mfs[1], MSG[mfs[1]] || MSG.UNKNOWN, { detail: err.details || null });
    else if (err.name === 'FunctionsFetchError' || err.name === 'AuthRetryableFetchError' || isNetworkMessage(msg) || err.name === 'TypeError' && /fetch/i.test(msg)) out = AppError('NETWORK', null, { network: true, retry: true });
    else if (err.name === 'AbortError' || /timeout/i.test(msg)) out = AppError('TIMEOUT', null, { network: true, retry: true });
    else if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) out = AppError('INVALID_CREDENTIALS');
    else if (code === 'user_banned' || /banned/i.test(msg)) out = AppError('ACCOUNT_DISABLED', null, { auth: true });
    else if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || status === 429) out = AppError('RATE_LIMITED', null, { retry: true });
    else if (code === 'PGRST301' || code === 'PGRST303' || /jwt expired|invalid jwt|refresh token/i.test(msg) || status === 401) out = AppError('SESSION_EXPIRED', null, { auth: true });
    else if (code === '42501') out = AppError('FORBIDDEN');
    else if (code === '23505') out = AppError('UNIQUE');
    else if (code === '23514' || code === '22P02' || code === '22003') out = AppError('CHECK');
    else if (code === '22023') out = AppError('VALIDATION');
    else if (code === 'PGRST116') out = AppError('NOT_FOUND');
    else if (status >= 500) out = AppError('SERVER_ERROR', null, { retry: true });
    else out = AppError('UNKNOWN', MSG.UNKNOWN);
    out.original = { name: err.name, code: code, status: status, message: msg.slice(0, 300) };
    MF.debug('error', out.code, out.original);
    return out;
  }

  /* server-function errors carry { error: { code } } in the response body */
  function fromFunction(err) {
    if (!err) return null;
    var ctx = err.context;
    if (err.name === 'FunctionsHttpError' && ctx && typeof ctx.json === 'function') {
      return ctx.clone().json().then(function (body) {
        var c = body && body.error && body.error.code;
        if (c) return AppError(c, MSG[c] || MSG.SERVER_ERROR, { status: ctx.status });
        return wrap({ status: ctx.status, message: 'function error' });
      }, function () { return wrap({ status: ctx.status, message: 'function error' }); });
    }
    if (err.name === 'FunctionsRelayError') return Promise.resolve(AppError('FUNCTION_UNAVAILABLE'));
    return Promise.resolve(wrap(err));
  }

  MF.err = { MSG: MSG, AppError: AppError, wrap: wrap, fromFunction: fromFunction, message: function (e) { return wrap(e).message; } };
})();
