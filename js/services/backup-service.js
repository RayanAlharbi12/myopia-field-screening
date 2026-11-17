/* =====================================================================
   BackupService — JSON backup, validated import (merge or replace), clear test data.
   An invalid file never touches the database: validation happens first, and
   every write runs in a single IndexedDB transaction (all or nothing).
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF, S = MF.storage, D = MF.dom;

  function keyOf(store, rec) { return rec ? rec[S.SCHEMA[store].key] : undefined; }
  function newer(a, b) { return String(a && a.updated_at || '') > String(b && b.updated_at || ''); }

  function summarize(data) {
    var parts = data.participants || [];
    return {
      schools: (data.schools || []).length,
      schoolsActive: (data.schools || []).filter(function (s) { return !s.archived; }).length,
      participants: parts.length,
      participantsActive: parts.filter(function (p) { return !p.archived; }).length,
      completed: parts.filter(function (p) { return p.status === 'completed' && !p.archived; }).length,
      questionnaires: (data.questionnaire_responses || []).filter(function (q) { return q.answers && Object.keys(q.answers).length; }).length
    };
  }

  /* ---------- validation ---------- */
  function validate(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['الملف ليس نسخة احتياطية صالحة (JSON غير مقروء).'] };
    if (obj.format !== MF.BACKUP_FORMAT) errors.push('هذا الملف ليس نسخة احتياطية من نظام الفحص الميداني لقصر النظر.');
    if (!(obj.version >= 1)) errors.push('إصدار النسخة الاحتياطية غير معروف.');
    else if (obj.version > MF.BACKUP_VERSION) errors.push('النسخة الاحتياطية من إصدار أحدث من هذا التطبيق (' + obj.version + ').');
    var data = obj.data;
    if (!data || typeof data !== 'object') errors.push('لا توجد بيانات داخل الملف.');
    if (errors.length) return { ok: false, errors: errors };

    var clean = {};
    S.STORES.forEach(function (s) {
      var list = data[s];
      if (list == null) { clean[s] = []; return; }
      if (!Array.isArray(list)) { errors.push('المخزن «' + s + '» ليس قائمة.'); clean[s] = []; return; }
      var k = S.SCHEMA[s].key, seen = {};
      list.forEach(function (r, i) {
        if (!r || typeof r !== 'object') { errors.push(s + ' #' + (i + 1) + ': سجل غير صالح.'); return; }
        var key = r[k];
        if (typeof key !== 'string' || !key) { errors.push(s + ' #' + (i + 1) + ': المفتاح «' + k + '» مفقود.'); return; }
        if (seen[key]) { errors.push(s + ': مفتاح مكرر ' + key + '.'); return; }
        seen[key] = true;
      });
      clean[s] = list;
    });
    if (errors.length) return { ok: false, errors: errors.slice(0, 12) };

    var schools = {}, nums = {};
    clean.schools.forEach(function (sc) {
      schools[sc.id] = sc;
      if (!(Number.isInteger(sc.number) && sc.number >= 1)) errors.push('مدرسة برقم غير صالح.');
      else if (nums[sc.number]) errors.push('رقم المدرسة ' + sc.number + ' مكرر داخل الملف.');
      nums[sc.number] = true;
      if (sc.type !== 'boys' && sc.type !== 'girls') errors.push('نوع مدرسة غير صالح (' + sc.number + ').');
    });
    var parts = {}, seqs = {};
    clean.participants.forEach(function (p) {
      parts[p.id] = p;
      if (!schools[p.school_id]) errors.push('مشارك مرتبط بمدرسة غير موجودة.');
      if (!(Number.isInteger(p.seq) && p.seq >= 1)) errors.push('مشارك برقم تسلسلي غير صالح.');
      var k2 = p.school_id + '|' + p.seq;
      if (seqs[k2]) errors.push('رقم المشارك ' + D.iso(p.code || p.seq) + ' مكرر داخل الملف.');
      seqs[k2] = true;
    });
    S.PER_PARTICIPANT_SINGLE.concat(S.PER_PARTICIPANT_MANY).forEach(function (s) {
      clean[s].forEach(function (r) { if (!parts[r.participant_id]) errors.push('سجل في «' + s + '» غير مرتبط بمشارك موجود.'); });
    });
    clean.family_history_entries.forEach(function (e) {
      if (!clean.family_members.some(function (m) { return m.id === e.member_id; })) errors.push('سجل تاريخ عائلي غير مرتبط بفرد من الأسرة.');
    });
    if (errors.length) {
      var uniq = errors.filter(function (e, i) { return errors.indexOf(e) === i; });
      return { ok: false, errors: uniq.slice(0, 12) };
    }
    return { ok: true, errors: [], data: clean, meta: { exported_at: obj.exported_at || null, app_version: obj.app_version || null }, summary: summarize(clean) };
  }

  /* ---------- merge plan (no writes) ---------- */
  function planMerge(incoming, local) {
    var ops = [], add = 0, update = 0, same = 0, conflicts = [];
    var localIdx = {};
    S.STORES.forEach(function (s) {
      var m = {}; local[s].forEach(function (r) { m[keyOf(s, r)] = r; }); localIdx[s] = m;
    });
    var skipSchools = {}, skipParticipants = {};
    var localNum = {}; local.schools.forEach(function (sc) { localNum[sc.number] = sc; });
    incoming.schools.forEach(function (sc) {
      var mine = localIdx.schools[sc.id];
      if (!mine && localNum[sc.number]) {
        skipSchools[sc.id] = true;
        conflicts.push('المدرسة رقم ' + sc.number + ' («' + sc.name + '») لم تُدمج: الرقم نفسه مستخدم على هذا الجهاز لمدرسة أخرى («' + localNum[sc.number].name + '»).');
      }
    });
    var localSeq = {}; local.participants.forEach(function (p) { localSeq[p.school_id + '|' + p.seq] = p; });
    incoming.participants.forEach(function (p) {
      if (skipSchools[p.school_id]) { skipParticipants[p.id] = true; return; }
      var mine = localIdx.participants[p.id];
      var clash = localSeq[p.school_id + '|' + p.seq];
      if (!mine && clash) {
        skipParticipants[p.id] = true;
        conflicts.push('المشارك ' + D.iso(p.code || p.seq) + ' لم يُدمج: الرقم نفسه مستخدم على هذا الجهاز لمشارك آخر.');
      } else if (mine && clash && clash.id !== p.id) {
        skipParticipants[p.id] = true;
        conflicts.push('المشارك ' + D.iso(p.code || p.seq) + ' لم يُحدَّث: رقمه الجديد مستخدم على هذا الجهاز.');
      }
    });
    S.STORES.forEach(function (s) {
      incoming[s].forEach(function (r) {
        if (s === 'schools' && skipSchools[r.id]) return;
        if (s === 'participants' && skipParticipants[r.id]) return;
        if (r.participant_id && skipParticipants[r.participant_id]) return;
        if (s === 'settings') {
          var mine = localIdx.settings[r.key];
          if (/^participant_counter:/.test(r.key) && skipSchools[r.school_id || r.key.split(':')[1]]) return;
          if (mine && typeof r.next === 'number') {
            if (r.next > (mine.next || 0)) { ops.push({ store: s, rec: Object.assign({}, mine, { next: r.next }) }); update++; } else same++;
            return;
          }
          if (!mine) { ops.push({ store: s, rec: r }); add++; } else same++;
          return;
        }
        var cur = localIdx[s][keyOf(s, r)];
        if (!cur) { ops.push({ store: s, rec: r }); add++; }
        else if (newer(r, cur)) { ops.push({ store: s, rec: r }); update++; }
        else same++;
      });
    });
    /* the school counter must stay above every school number now present */
    var maxNum = 0;
    local.schools.concat(incoming.schools.filter(function (sc) { return !skipSchools[sc.id]; })).forEach(function (sc) { maxNum = Math.max(maxNum, sc.number); });
    var sc = localIdx.settings[MF.SchoolRepository.COUNTER_KEY];
    var plannedSc = ops.filter(function (o) { return o.store === 'settings' && o.rec.key === MF.SchoolRepository.COUNTER_KEY; })[0];
    var nextNum = Math.max(maxNum + 1, (plannedSc ? plannedSc.rec.next : (sc ? sc.next : 1)) || 1);
    if (plannedSc) plannedSc.rec.next = nextNum;
    else ops.push({ store: 'settings', rec: Object.assign({ key: MF.SchoolRepository.COUNTER_KEY }, sc || {}, { next: nextNum }) });
    return { ops: ops, add: add, update: update, same: same, conflicts: conflicts };
  }

  var BackupService = {
    exportBackup: function () {
      return MF.repos.db().snapshot().then(function (snap) {
        var payload = {
          format: MF.BACKUP_FORMAT, version: MF.BACKUP_VERSION, app_version: MF.VERSION,
          exported_at: D.nowIso(), summary: summarize(snap), data: snap
        };
        var blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
        return { blob: blob, filename: 'Myopia_Backup_' + D.stamp() + '.json', summary: payload.summary };
      });
    },

    readFile: function (file) {
      return new Promise(function (resolve) {
        if (!file) { resolve({ ok: false, errors: ['لم يُختر أي ملف.'] }); return; }
        if (file.size > 200 * 1024 * 1024) { resolve({ ok: false, errors: ['حجم الملف كبير جدًا.'] }); return; }
        var fr = new FileReader();
        fr.onload = function () {
          var obj = null;
          try { obj = JSON.parse(fr.result); } catch (e) { resolve({ ok: false, errors: ['تعذّرت قراءة الملف: ليس ملف JSON صالحًا.'] }); return; }
          resolve(validate(obj));
        };
        fr.onerror = function () { resolve({ ok: false, errors: ['تعذّرت قراءة الملف.'] }); };
        fr.readAsText(file);
      });
    },
    validate: validate,

    previewMerge: function (parsed) {
      return MF.repos.db().snapshot().then(function (local) {
        var plan = planMerge(parsed.data, local);
        plan.localSummary = summarize(local);
        return plan;
      });
    },

    applyMerge: function (parsed) {
      return MF.repos.db().transaction(S.STORES, function (tx) {
        return Promise.all(S.STORES.map(function (s) { return tx.getAll(s); })).then(function (lists) {
          var local = {}; S.STORES.forEach(function (s, i) { local[s] = lists[i]; });
          var plan = planMerge(parsed.data, local);   /* recomputed inside the transaction */
          return plan.ops.reduce(function (p, op) { return p.then(function () { return tx.put(op.store, op.rec); }); }, Promise.resolve())
            .then(function () { return MF.repos.audit(tx, 'database', 'local', 'import_merge', { added: plan.add, updated: plan.update, conflicts: plan.conflicts.length }); })
            .then(function () { return plan; });
        });
      });
    },

    applyReplace: function (parsed) {
      var data = parsed.data;
      return MF.repos.db().transaction(S.STORES, function (tx) {
        return Promise.all(S.STORES.map(function (s) { return tx.clear(s); })).then(function () {
          var all = [];
          S.STORES.forEach(function (s) { data[s].forEach(function (r) { all.push([s, r]); }); });
          return all.reduce(function (p, x) { return p.then(function () { return tx.put(x[0], x[1]); }); }, Promise.resolve());
        }).then(function () { return MF.repos.audit(tx, 'database', 'local', 'import_replace', summarize(data)); });
      });
    },

    /* مسح بيانات النسخة التجريبية — deletes all local schools, participants and counters */
    clearAll: function () { return MF.repos.db().clearAll(); },
    summarize: summarize
  };
  MF.BackupService = BackupService;
})();
