/* =====================================================================
   Questionnaire definition — Arabic only.

   Source of truth: the official bilingual document
   "Myopia Risk factors survey - english and arabic document.docx" (Arabic column).
   Wording below is copied from that document. The ONLY deliberate changes:
     1. original question numbers / letter labels (1), 15أ, 23ج, 25ب …) are removed;
        the app numbers questions inside each displayed section (UI only — the number
        is never part of the stored text, the stored answer or the Excel header);
     2. the note under the school-day outdoor-hours question that excludes hours
        spent at university (English: "DO NOT include hours during university.") is removed.
   As a direct consequence of (1), the paper-routing note on the close-work question
   ("(إذا كانت الإجابة لا، انتقل إلى السؤال …)") is not shown; the app moves on by itself.

   Item ids are stable research keys; never renumber them.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  var DURATION = ['إطلاقًا', 'أقل من ساعة', 'أكثر من ساعة'];   /* none | lt1 | gt1 */

  function dur(id, text) { return { id: id, type: 'duration', text: text }; }
  function time(id, text) { return { id: id, type: 'time', text: text }; }

  MF.QUESTIONNAIRE = {
    title: 'الاستبيان الأولي - قصر النظر لدى المراهقين: الانتشار وعوامل الخطورة',
    durationOptions: DURATION,
    specifyLabel: '(يرجى التحديد)',
    hourUnit: 'ساعة',
    minuteUnit: 'دقيقة',
    sections: [
      {
        id: 'A', title: 'القسم أ: المعلومات الديموغرافية', short: 'أ',
        note: 'تُعبّأ هذه الإجابات تلقائيًا من بيانات التسجيل والأسرة.',
        items: [
          { id: 'a_id', type: 'auto-id', text: 'الرقم التعريفي للاستبيان:', unnumbered: true },
          { id: 'a_gender', type: 'auto-gender', text: 'ما جنسك؟', options: ['ذكر', 'أنثى'] },
          { id: 'a_age', type: 'auto-age', text: 'كم عمرك؟', unit: 'سنة' },
          { id: 'a_class', type: 'auto-class', text: 'ما مستوى صفك الدراسي؟', options: ['الأول', 'الثاني', 'الثالث'] },
          { id: 'a_parent_one', type: 'auto-parent-one', text: 'أحد والديك يرتدي نظارة.', options: ['نعم', 'لا'] },
          { id: 'a_parent_both', type: 'auto-parent-both', text: 'كلا والديك يرتديان نظارة.', options: ['نعم', 'لا'] }
        ]
      },
      {
        id: 'B1', title: 'القسم ب1: يوم دراسي اعتيادي - الروتين المدرسي والتنقل', short: 'ب1',
        items: [
          { id: 'b1_days', type: 'days', text: 'المدرسة: كم يومًا في الأسبوع تذهب إلى المدرسة؟', unit: 'يومًا', min: 0, max: 7 },
          time('b1_sleep', 'النوم: في أي وقت تذهب عادةً إلى النوم ليلًا في هذه الأيام؟'),
          time('b1_wake', 'النوم: في أي وقت تستيقظ عادةً في الصباح؟'),
          dur('b1_out_before_leave', 'قبل الذهاب إلى المدرسة: بعد الاستيقاظ صباحًا وقبل مغادرة المنزل، هل تقضي أي وقت في الخارج؟'),
          time('b1_leave_home', 'التنقل: في أي وقت تغادر المنزل للذهاب إلى المدرسة؟'),
          { id: 'b1_travel', type: 'travel', text: 'التنقل: كيف تذهب إلى المدرسة وكم يستغرق ذلك؟ إذا كنت تستخدم السيارة والمشي معًا، فاختر الخيارين وحدد الوقت الذي تقضيه في كل وسيلة.' },
          dur('b1_out_before_start', 'المدرسة: بعد وصولك إلى المدرسة وقبل بدء الدوام، هل تقضي أي وقت في الخارج؟')
        ]
      },
      {
        id: 'B2', title: 'القسم ب2: يوم دراسي اعتيادي - أثناء المدرسة وبعدها', short: 'ب2',
        items: [
          time('b2_start', 'المدرسة: في أي وقت يبدأ دوامك المدرسي عادةً؟'),
          dur('b2_out_during', 'المدرسة: خلال يومك الدراسي، هل تقضي أي وقت في الخارج؟'),
          time('b2_finish', 'المدرسة: في أي وقت ينتهي دوامك المدرسي عادةً؟'),
          dur('b2_out_after', 'المدرسة: بعد انتهاء الدوام المدرسي وقبل مغادرتك إلى المنزل، هل تقضي أي وقت في الخارج؟'),
          time('b2_leave_school', 'التنقل: في أي وقت تغادر للعودة إلى المنزل؟'),
          { id: 'b2_same_way', type: 'return', text: 'التنقل: هل تعود إلى المنزل بالطريقة نفسها التي ذهبت بها صباحًا؟', options: ['نعم', 'لا'], followText: 'إذا كانت الإجابة لا، فكيف تعود؟' },
          dur('b2_out_home', 'بعد الوصول إلى المنزل: بعد وصولك إلى المنزل وقبل حلول الليل، هل تقضي أي وقت في الخارج؟')
        ]
      },
      {
        id: 'C', title: 'القسم ج: يوم دراسي اعتيادي - الأنشطة داخل الأماكن المغلقة', short: 'ج',
        intro: 'نود الآن أن نسألك عن كيفية قضاء وقتك عندما لا تكون في المدرسة أو نائمًا. نحتاج إلى معرفة المدة التي تقضيها داخل الأماكن المغلقة أو في الخارج، وأنواع الأنشطة التي تمارسها. سنبدأ بالأنشطة داخل الأماكن المغلقة. تذكّر: لا تحتسب وقت المدرسة أو النوم.',
        items: [
          { type: 'guide', text: 'قبل وبعد يوم دراسي اعتيادي، وأثناء وجودك داخل الأماكن المغلقة، كم من الوقت تقضي يوميًا في الأنشطة التالية؟' },
          dur('c_read_pleasure', 'قراءة مواد مطبوعة للمتعة، مثل مجلة أو رواية؟'),
          dur('c_homework', 'أداء الواجبات أو الدراسة أو حضور دروس بعد المدرسة؟'),
          dur('c_devices', 'استخدام أجهزة الكمبيوتر أو الأجهزة الذكية للدراسة أو الترفيه؟'),
          dur('c_tv', 'مشاهدة التلفاز أو الذهاب إلى السينما؟'),
          dur('c_games', 'لعب ألعاب الفيديو أو الألعاب الإلكترونية؟'),
          dur('c_sport_indoor', 'ممارسة الرياضة أو التمارين داخل الأماكن المغلقة؟'),
          { id: 'c_other', type: 'activities', text: 'هل توجد أنشطة أخرى داخل الأماكن المغلقة تمارسها لأكثر من ساعتين في يوم اعتيادي؟', gate: ['لا يوجد', 'نعم'], rows: ['النشاط:', 'النشاط:', 'النشاط:'], numberedRows: true }
        ]
      },
      {
        id: 'D', title: 'القسم د: يوم دراسي اعتيادي - الأنشطة في الخارج', short: 'د',
        items: [
          { id: 'd_outdoor_hours', type: 'hours', text: 'في الخارج: قبل وبعد يوم دراسي اعتيادي، كم ساعة تقضيها في الخارج؟' },
          dur('d_sport_outdoor', 'ممارسة الرياضة أو التمارين في الخارج؟'),
          { id: 'd_other', type: 'activities', text: 'هل توجد أنشطة أخرى في الخارج تمارسها لأكثر من ساعتين في يوم اعتيادي، مثل الجلوس أو المشي أو البستنة أو التسوق في الخارج؟', gate: ['لا يوجد', 'نعم'], rows: ['النشاط:', 'نشاط آخر:'] }
        ]
      },
      {
        id: 'E', title: 'القسم هـ: عطلة نهاية الأسبوع الاعتيادية - الروتين العام', short: 'هـ',
        items: [
          { type: 'guide', text: 'أسئلة عن كيفية قضاء عطلة نهاية أسبوع اعتيادية' },
          dur('e_tuition', 'الدروس داخل الأماكن المغلقة: هل تحضر أي دروس تعليمية إضافية في عطلة نهاية الأسبوع، مثل الرياضيات أو اللغة أو الموسيقى؟'),
          time('e_sleep', 'النوم: في أي وقت تذهب عادةً إلى النوم ليلًا؟'),
          time('e_wake', 'النوم: في أي وقت تستيقظ عادةً في الصباح؟'),
          { id: 'e_indoor_hours', type: 'hours', text: 'داخل الأماكن المغلقة: كم ساعة تقضيها داخل الأماكن المغلقة في اليوم؟', note: 'لا تحتسب وقت النوم أو الدروس التعليمية الإضافية.' }
        ]
      },
      {
        id: 'F', title: 'القسم و: يوم اعتيادي دون مدرسة - الأنشطة داخل الأماكن المغلقة', short: 'و',
        items: [
          { type: 'guide', text: 'في يوم اعتيادي لا توجد فيه مدرسة، وأثناء وجودك داخل الأماكن المغلقة، كم من الوقت تقضي يوميًا في الأنشطة التالية؟' },
          dur('f_read_pleasure', 'قراءة مواد مطبوعة للمتعة، مثل مجلة أو رواية؟'),
          dur('f_read_study', 'قراءة مواد مطبوعة أو الكتابة باليد للدراسة؟'),
          dur('f_computers', 'استخدام أجهزة الكمبيوتر للدراسة أو الترفيه؟'),
          dur('f_tv', 'مشاهدة التلفاز أو الذهاب إلى السينما؟'),
          dur('f_games', 'لعب ألعاب الفيديو أو الألعاب الإلكترونية؟'),
          dur('f_sport_indoor', 'ممارسة الرياضة أو التمارين داخل الأماكن المغلقة؟'),
          { id: 'f_other', type: 'activities', text: 'هل توجد أنشطة أخرى داخل الأماكن المغلقة تمارسها لأكثر من ساعتين في يوم اعتيادي؟', gate: ['لا يوجد', 'نعم'], rows: ['النشاط:', 'النشاط:', 'النشاط:'], numberedRows: true }
        ]
      },
      {
        id: 'G', title: 'القسم ز: يوم اعتيادي دون مدرسة - الأنشطة في الخارج', short: 'ز',
        items: [
          { id: 'g_outdoor_hours', type: 'hours', text: 'في الخارج: كم ساعة تقضيها في الخارج خلال اليوم؟', note: 'لا تحتسب وقت النوم.' },
          { type: 'guide', text: 'في يوم اعتيادي لا توجد فيه مدرسة، وأثناء وجودك في الخارج، كم من الوقت تقضي يوميًا في الأنشطة التالية؟' },
          { id: 'g_close_work', type: 'activities', text: 'أثناء وجودك في الخارج، هل تقوم بأي أنشطة تتطلب عملاً قريبًا، مثل القراءة للمتعة أو الدراسة، أو استخدام أجهزة الكمبيوتر أو الأجهزة الذكية؟', gate: ['لا', 'نعم'], rows: ['النشاط:', 'نشاط آخر:'] },
          dur('g_sport_outdoor', 'ممارسة الرياضة أو التمارين في الخارج؟'),
          { id: 'g_other', type: 'activities', text: 'هل توجد أنشطة أخرى في الخارج تمارسها لأكثر من ساعتين في يوم اعتيادي من عطلة نهاية الأسبوع، مثل المشي أو البستنة أو التسوق في الخارج؟', gate: ['لا يوجد', 'نعم'], rows: ['النشاط:', 'نشاط آخر:'] },
          { id: 'g_notes', type: 'notes', text: 'ملاحظات:', unnumbered: true }
        ]
      }
    ]
  };

  /* flat list of answerable items (in order), with section reference and UI number */
  MF.QUESTIONNAIRE.items = (function () {
    var out = [];
    MF.QUESTIONNAIRE.sections.forEach(function (s) {
      var n = 0;
      s.items.forEach(function (it) {
        if (it.type === 'guide') return;
        it.section = s;
        it.uiNumber = it.unnumbered ? null : ++n;
        out.push(it);
      });
    });
    return out;
  })();
  MF.QUESTIONNAIRE.byId = MF.QUESTIONNAIRE.items.reduce(function (m, it) { m[it.id] = it; return m; }, {});
})();
