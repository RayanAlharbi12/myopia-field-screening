/* Shared repository plumbing: the active storage adapter, timestamps, audit trail. */
(function () {
  'use strict';
  var MF = window.MF;
  var D = MF.dom;

  MF.repos = MF.repos || {};

  /* the active adapter; Phase 2 swaps this for a Supabase-backed adapter */
  MF.repos.adapter = null;
  MF.repos.useAdapter = function (adapter) { MF.repos.adapter = adapter; };
  MF.repos.db = function () {
    if (!MF.repos.adapter) throw new Error('No storage adapter configured.');
    return MF.repos.adapter;
  };

  MF.repos.stampNew = function (rec) {
    var t = D.nowIso();
    rec.created_at = rec.created_at || t;
    rec.updated_at = t;
    return rec;
  };
  MF.repos.touch = function (rec) { rec.updated_at = D.nowIso(); return rec; };

  /* audit_metadata: an append-only log of significant events (not every keystroke) */
  MF.repos.audit = function (tx, entity, entityId, action, detail) {
    return tx.put('audit_metadata', {
      id: D.uid(), entity: entity, entity_id: entityId, action: action,
      detail: detail || null, at: D.nowIso()
    });
  };

  /* typed error for business rules (duplicate IDs etc.) */
  function RuleError(code, message, data) {
    var e = new Error(message);
    e.name = 'RuleError'; e.code = code; e.data = data || null;
    return e;
  }
  MF.repos.RuleError = RuleError;

  /* simple single-record and multi-record store helpers used by the named repositories */
  MF.repos.single = function (store) {
    return {
      get: function (pid) { return MF.repos.db().get(store, pid); },
      save: function (rec) { MF.repos.touch(rec); return MF.repos.db().put(store, rec); }
    };
  };
  MF.repos.many = function (store) {
    return {
      list: function (pid) { return MF.repos.db().getAllByIndex(store, 'participant_id', pid); },
      save: function (rec) { MF.repos.touch(rec); return MF.repos.db().put(store, rec); },
      remove: function (id) { return MF.repos.db().delete(store, id); }
    };
  };
})();
