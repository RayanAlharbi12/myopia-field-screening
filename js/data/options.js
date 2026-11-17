/* =====================================================================
   Clinical and registration option sets.
   v  = stored internal value (never shown)
   ar = label shown in the app
   en = label written to the research Excel (Participants / Family sheets)
   Changing an export label here changes it everywhere in the export.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  MF.STATIONS = [
    { key: 'registration', no: 1, ar: 'التسجيل', short: 'التسجيل', en: 'Registration' },
    { key: 'autoref', no: 2, ar: 'الانكسار الموضوعي', short: 'الانكسار', en: 'Autorefraction' },
    { key: 'strabismus', no: 3, ar: 'الحول وحركة العين', short: 'الحول', en: 'Strabismus & EOM' },
    { key: 'va', no: 4, ar: 'حدة الإبصار', short: 'الإبصار', en: 'Visual Acuity' },
    { key: 'questionnaire', no: 5, ar: 'الاستبيان', short: 'الاستبيان', en: 'Questionnaire' }
  ];
  MF.STATION_STATES = {
    not_started: { ar: 'لم يبدأ', en: 'Not started' },
    in_progress: { ar: 'قيد التنفيذ', en: 'In progress' },
    completed: { ar: 'مكتمل', en: 'Completed' }
  };
  MF.PARTICIPANT_STATUS = {
    draft: { ar: 'مسودة', en: 'Draft' },
    completed: { ar: 'مكتمل', en: 'Completed' }
  };

  var O = {};

  O.schoolType = [
    { v: 'boys', ar: 'بنين', en: 'Boys' },
    { v: 'girls', ar: 'بنات', en: 'Girls' }
  ];
  O.gender = [
    { v: 'male', ar: 'ذكر', en: 'Male' },
    { v: 'female', ar: 'أنثى', en: 'Female' }
  ];
  /* stored internally as 1 / 2 / 3 */
  O.classLevel = [
    { v: 1, ar: 'الأول متوسط', en: '1', q: 'الأول' },
    { v: 2, ar: 'الثاني متوسط', en: '2', q: 'الثاني' },
    { v: 3, ar: 'الثالث متوسط', en: '3', q: 'الثالث' }
  ];
  O.noYes = [
    { v: 'no', ar: 'لا', en: 'No' },
    { v: 'yes', ar: 'نعم', en: 'Yes' }
  ];
  O.glasses = [
    { v: 'yes', ar: 'نعم', en: 'Yes' },
    { v: 'no', ar: 'لا', en: 'No' },
    { v: 'yes_not_now', ar: 'نعم، ولكن لا أرتديها حاليًا', en: 'Yes, not currently worn' },
    { v: 'previously', ar: 'كنت ألبس نظارة سابقًا ولم أعد ألبسها', en: 'Previously wore glasses but no longer wears them' }
  ];
  O.glassesReasons = [
    { v: 'headache', ar: 'المقاس يسبب لي صداع', en: 'Prescription causes headache' },
    { v: 'uncomfortable', ar: 'غير مرتاح', en: 'Uncomfortable' },
    { v: 'not_clear', ar: 'لا أرى بوضوح بالنظارة', en: 'Does not see clearly with glasses' },
    { v: 'forgot', ar: 'نسيتها بالمنزل', en: 'Left at home' },
    { v: 'other', ar: 'سبب آخر', en: 'Other' }
  ];
  O.diseaseKind = [
    { v: 'disease', ar: 'مرض', en: 'Disease' },
    { v: 'injury', ar: 'إصابة', en: 'Injury' }
  ];
  O.eye4 = [
    { v: 'OD', ar: 'OD', en: 'OD' },
    { v: 'OS', ar: 'OS', en: 'OS' },
    { v: 'OU', ar: 'OU', en: 'OU' },
    { v: 'unknown', ar: 'غير محدد', en: 'Unspecified' }
  ];
  O.eye3 = [
    { v: 'OD', ar: 'OD', en: 'OD' },
    { v: 'OS', ar: 'OS', en: 'OS' },
    { v: 'OU', ar: 'OU', en: 'OU' }
  ];
  O.eye2 = [
    { v: 'OD', ar: 'OD', en: 'OD' },
    { v: 'OS', ar: 'OS', en: 'OS' }
  ];
  /* flexible timing: a year, an age, or a short description */
  O.whenKind = [
    { v: 'year', ar: 'سنة', en: 'Year' },
    { v: 'age', ar: 'العمر', en: 'Age' },
    { v: 'text', ar: 'وصف', en: 'Description' }
  ];
  O.medOngoing = [
    { v: 'yes', ar: 'نعم، ما زلت أستخدمه', en: 'Ongoing' },
    { v: 'no', ar: 'لا، توقفت عنه', en: 'Stopped' }
  ];
  O.siblingSex = [
    { v: 'male', ar: 'أخ', en: 'Male', the: 'الأخ' },
    { v: 'female', ar: 'أخت', en: 'Female', the: 'الأخت' }
  ];
  O.olderYounger = [
    { v: 'older', ar: 'أكبر من المشارك', en: 'Older' },
    { v: 'younger', ar: 'أصغر من المشارك', en: 'Younger' }
  ];
  O.familyGlassesType = [
    { v: 'distance', ar: 'للبعيد', en: 'Distance' },
    { v: 'near', ar: 'للقريب', en: 'Near' },
    { v: 'both', ar: 'للبعيد والقريب', en: 'Distance and near' }
  ];
  O.symptoms = [
    { v: 'blurry', ar: 'Blurry Vision', en: 'Blurry Vision' },
    { v: 'headache', ar: 'Headache', en: 'Headache' },
    { v: 'photophobia', ar: 'Photophobia', en: 'Photophobia' },
    { v: 'diplopia', ar: 'Double Vision', en: 'Double Vision' },
    { v: 'asthenopia', ar: 'Eye strain / Asthenopia', en: 'Eye strain / Asthenopia' },
    { v: 'pain', ar: 'Eye pain', en: 'Eye pain' },
    { v: 'redness', ar: 'Redness', en: 'Redness' },
    { v: 'itching', ar: 'Itching', en: 'Itching' },
    { v: 'watering', ar: 'Watering / excessive tearing', en: 'Watering / excessive tearing' },
    { v: 'squinting', ar: 'Squinting', en: 'Squinting' },
    { v: 'closing_one_eye', ar: 'Closing one eye', en: 'Closing one eye' },
    { v: 'other', ar: 'Other', en: 'Other' }
  ];
  O.blurryLocation = [
    { v: 'near', ar: 'القريب', en: 'Near' },
    { v: 'distance', ar: 'البعيد', en: 'Distance' }
  ];
  O.anterior = [
    { v: null, ar: 'Not tested', en: 'Not tested' },
    { v: 'nad', ar: 'NAD', en: 'NAD' },
    { v: 'abnormal', ar: 'Abnormal', en: 'Abnormal' }
  ];
  O.anteriorStructures = [
    { v: 'lids', ar: 'Eyelids and Conjunctiva', en: 'Eyelids and Conjunctiva' },
    { v: 'cornea', ar: 'Cornea', en: 'Cornea' },
    { v: 'pupil', ar: 'Pupil and Lens', en: 'Pupil and Lens' }
  ];

  /* ---------- Strabismus & ocular motility ---------- */
  O.coverTest = [
    { v: null, ar: 'Not tested', en: 'Not tested' },
    { v: 'ortho', ar: 'Ortho', en: 'Ortho' },
    { v: 'phoria', ar: 'Phoria', en: 'Phoria' },
    { v: 'tropia', ar: 'Tropia', en: 'Tropia' }
  ];
  O.phoriaType = [
    { v: 'eso', ar: 'Esophoria', en: 'Esophoria' },
    { v: 'exo', ar: 'Exophoria', en: 'Exophoria' },
    { v: 'hyper', ar: 'Hyperphoria', en: 'Hyperphoria' },
    { v: 'hypo', ar: 'Hypophoria', en: 'Hypophoria' },
    { v: 'other', ar: 'Other', en: 'Other' }
  ];
  O.tropiaPattern = [
    { v: 'alternating', ar: 'Alternating', en: 'Alternating' },
    { v: 'unilateral', ar: 'Unilateral', en: 'Unilateral' }
  ];
  O.tropiaFrequency = [
    { v: 'intermittent', ar: 'Intermittent', en: 'Intermittent' },
    { v: 'constant', ar: 'Constant', en: 'Constant' }
  ];
  O.tropiaType = [
    { v: 'eso', ar: 'Esotropia', en: 'Esotropia' },
    { v: 'exo', ar: 'Exotropia', en: 'Exotropia' },
    { v: 'hyper', ar: 'Hypertropia', en: 'Hypertropia' },
    { v: 'hypo', ar: 'Hypotropia', en: 'Hypotropia' },
    { v: 'incyclo', ar: 'Incyclotropia', en: 'Incyclotropia' },
    { v: 'excyclo', ar: 'Excyclotropia', en: 'Excyclotropia' },
    { v: 'other', ar: 'Other', en: 'Other' }
  ];
  O.eomStatus = [
    { v: null, ar: 'Not tested', en: 'Not tested' },
    { v: 'full', ar: 'Full', en: 'Full' },
    { v: 'abnormal', ar: 'Abnormal', en: 'Abnormal' }
  ];
  /* Standard extraocular-muscle action mapping (primary / secondary / tertiary).
     Informational helper only — never used to diagnose. */
  O.muscles = [
    { v: 'MR', en: 'Medial Rectus', actions: ['Adduction'] },
    { v: 'LR', en: 'Lateral Rectus', actions: ['Abduction'] },
    { v: 'SR', en: 'Superior Rectus', actions: ['Elevation', 'Intorsion', 'Adduction'] },
    { v: 'IR', en: 'Inferior Rectus', actions: ['Depression', 'Extorsion', 'Adduction'] },
    { v: 'SO', en: 'Superior Oblique', actions: ['Intorsion', 'Depression', 'Abduction'] },
    { v: 'IO', en: 'Inferior Oblique', actions: ['Extorsion', 'Elevation', 'Abduction'] }
  ];
  O.eomGrades = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

  /* ---------- Visual acuity ---------- */
  O.plusLens = [
    { v: null, ar: 'Not tested', en: 'Not tested' },
    { v: 'pass', ar: 'Pass', en: 'Pass' },
    { v: 'fail', ar: 'Fail', en: 'Fail' }
  ];
  O.viCause = [
    { v: null, ar: 'Not tested', en: 'Not tested' },
    { v: 'none', ar: 'لا يوجد', en: 'None' },
    { v: 'amblyopia', ar: 'كسل بالعين', en: 'Amblyopia' },
    { v: 'strabismus', ar: 'حول', en: 'Strabismus' },
    { v: 'refractive', ar: 'خطأ انكساري', en: 'Refractive error' },
    { v: 'retinal', ar: 'مرض في الشبكية', en: 'Retinal disease' },
    { v: 'cataract', ar: 'ماء أبيض', en: 'Cataract' },
    { v: 'other', ar: 'سبب آخر', en: 'Other' },
    { v: 'undetermined', ar: 'سبب غير محدد', en: 'Undetermined' }
  ];
  O.amblyLaterality = [
    { v: 'one', ar: 'عين واحدة', en: 'Unilateral' },
    { v: 'both', ar: 'العينان', en: 'Bilateral' }
  ];

  O.find = function (set, v) {
    var list = O[set] || set;
    for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i];
    return null;
  };
  O.ar = function (set, v) { var o = O.find(set, v); return o ? o.ar : ''; };
  O.en = function (set, v) { var o = O.find(set, v); return o ? o.en : ''; };

  MF.OPT = O;

  /* =====================================================================
     Measurement scales for the picker
     ===================================================================== */
  function powerScale(max) {
    var out = [];
    for (var i = Math.round(max * 4); i >= -Math.round(max * 4); i--) out.push(i / 4);
    return out;
  }
  var VA = ['6/6', '6/7.5', '6/9', '6/12', '6/18', '6/24', '6/36', '6/60', 'CF', 'HM', 'LP', 'NLP'];
  MF.SCALES = {
    /* top of the wheel first: more plus at the top, as listed in the specification */
    sphere: { values: powerScale(20), rest: 0, step: 0.25, min: -20, max: 20, unit: 'D' },
    cyl: { values: powerScale(10), rest: 0, step: 0.25, min: -10, max: 10, unit: 'D' },
    axis: { values: (function () { var a = []; for (var d = 0; d <= 180; d += 5) a.push(d); return a; })(), rest: 90, step: 5, min: 0, max: 180, unit: '°' },
    /* better vision at the top */
    va: { values: VA, rest: '6/6' }
  };
  MF.VA_SCALE = VA;
  MF.VA_REFERRAL_LIMIT = '6/9';   /* worse than this triggers Referral_VA */
  MF.REFRACTIVE_LIMIT = 1.00;     /* |sphere| or |cylinder| > 1.00 D triggers Referral_Refractive_Error */
})();
