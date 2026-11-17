/* =====================================================================
   Offline storage adapter — IndexedDB.

   Phase 2: the online repositories use Supabase as the source of truth and
   this adapter as the per-user offline cache and outbox (js/online/cache.js).

   Adapter contract:

     open()                                   -> Promise
     get(store, key)                          -> Promise<record|undefined>
     getAll(store)                            -> Promise<record[]>
     getAllByIndex(store, index, value)       -> Promise<record[]>
     put(store, record)                       -> Promise<record>
     delete(store, key)                       -> Promise
     transaction(stores, fn)                  -> Promise<fn result>
        fn(tx) receives tx.get / tx.getAll / tx.getAllByIndex / tx.put /
        tx.delete / tx.clear — all writes inside commit together or not at all.
     clearAll()                               -> Promise
     estimate()                               -> Promise<{usage, quota, persisted}>
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  /* store name -> { key, indexes: [[name, keyPath, {unique}]] } */
  var SCHEMA = {
    schools: { key: 'id', indexes: [['number', 'number', { unique: true }]] },
    participants: { key: 'id', indexes: [['school_id', 'school_id'], ['school_seq', ['school_id', 'seq'], { unique: true }]] },
    registration: { key: 'participant_id' },
    family_members: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    ocular_history_entries: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    systemic_history_entries: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    family_history_entries: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    autorefraction: { key: 'participant_id' },
    strabismus: { key: 'participant_id' },
    eom_findings: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    visual_acuity: { key: 'participant_id' },
    questionnaire_responses: { key: 'participant_id' },
    station_status: { key: 'participant_id' },
    settings: { key: 'key' },
    audit_metadata: { key: 'id', indexes: [['entity_id', 'entity_id']] }
  };
  var STORES = Object.keys(SCHEMA);

  /* stores holding one record per participant, or many records per participant */
  var PER_PARTICIPANT_SINGLE = ['registration', 'autorefraction', 'strabismus', 'visual_acuity', 'questionnaire_responses', 'station_status'];
  var PER_PARTICIPANT_MANY = ['family_members', 'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'eom_findings'];

  function req(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('IndexedDB request failed')); };
    });
  }

  /* schema: { store: { key, indexes } } — defaults to the Phase 1 layout (still used to
     validate Phase 1 backup files); the Phase 2 per-user cache passes its own schema. */
  function IndexedDBAdapter(name, version, schema) {
    this.name = name || MF.DB_NAME;
    this.version = version || MF.DB_VERSION;
    this.schema = schema || SCHEMA;
    this.stores = Object.keys(this.schema);
    this.db = null;
  }

  IndexedDBAdapter.prototype.open = function () {
    var self = this;
    if (self.db) return Promise.resolve(self.db);
    if (!window.indexedDB) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
    return new Promise(function (resolve, reject) {
      var r;
      try { r = indexedDB.open(self.name, self.version); } catch (e) { reject(e); return; }
      r.onupgradeneeded = function (ev) {
        var db = r.result;
        self.stores.forEach(function (s) {
          var def = self.schema[s], os;
          if (!db.objectStoreNames.contains(s)) os = db.createObjectStore(s, { keyPath: def.key });
          else os = r.transaction.objectStore(s);
          (def.indexes || []).forEach(function (ix) {
            if (!os.indexNames.contains(ix[0])) os.createIndex(ix[0], ix[1], ix[2] || {});
          });
        });
      };
      r.onsuccess = function () {
        self.db = r.result;
        self.db.onversionchange = function () { self.db.close(); self.db = null; };
        resolve(self.db);
      };
      r.onerror = function () { reject(r.error || new Error('Could not open the local database.')); };
      r.onblocked = function () { reject(new Error('The local database is open in another tab with an older version. Close other tabs and reload.')); };
    });
  };

  function wrapTx(t) {
    return {
      raw: t,
      get: function (s, k) { return req(t.objectStore(s).get(k)); },
      getAll: function (s) { return req(t.objectStore(s).getAll()); },
      getAllByIndex: function (s, ix, v) { return req(t.objectStore(s).index(ix).getAll(v)); },
      put: function (s, rec) { return req(t.objectStore(s).put(rec)).then(function () { return rec; }); },
      delete: function (s, k) { return req(t.objectStore(s).delete(k)); },
      clear: function (s) { return req(t.objectStore(s).clear()); },
      abort: function (err) { t._mfAbortReason = err; try { t.abort(); } catch (e) { /* already done */ } }
    };
  }

  /* Run fn inside ONE readwrite transaction across the given stores.
     Resolves with fn's result only after the transaction has committed. */
  IndexedDBAdapter.prototype.transaction = function (stores, fn, mode) {
    var self = this;
    return self.open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t, result, failed = null;
        try { t = db.transaction(stores, mode || 'readwrite'); } catch (e) { reject(e); return; }
        var tx = wrapTx(t);
        t.oncomplete = function () { if (failed) reject(failed); else resolve(result); };
        t.onabort = function () { reject(t._mfAbortReason || failed || t.error || new Error('The change was not saved (transaction aborted).')); };
        t.onerror = function (e) { failed = failed || t.error; };
        Promise.resolve().then(function () { return fn(tx); }).then(function (r) { result = r; }, function (err) {
          failed = err;
          tx.abort(err);
        });
      });
    });
  };

  IndexedDBAdapter.prototype.get = function (s, k) { return this.transaction([s], function (tx) { return tx.get(s, k); }, 'readonly'); };
  IndexedDBAdapter.prototype.getAll = function (s) { return this.transaction([s], function (tx) { return tx.getAll(s); }, 'readonly'); };
  IndexedDBAdapter.prototype.getAllByIndex = function (s, ix, v) { return this.transaction([s], function (tx) { return tx.getAllByIndex(s, ix, v); }, 'readonly'); };
  IndexedDBAdapter.prototype.put = function (s, rec) { return this.transaction([s], function (tx) { return tx.put(s, rec); }); };
  IndexedDBAdapter.prototype.delete = function (s, k) { return this.transaction([s], function (tx) { return tx.delete(s, k); }); };

  /* read every store in one consistent snapshot */
  IndexedDBAdapter.prototype.snapshot = function (only) {
    var stores = only || this.stores;
    return this.transaction(stores, function (tx) {
      return Promise.all(stores.map(function (s) { return tx.getAll(s); })).then(function (lists) {
        var out = {};
        stores.forEach(function (s, i) { out[s] = lists[i]; });
        return out;
      });
    }, 'readonly');
  };

  IndexedDBAdapter.prototype.clearAll = function () {
    var stores = this.stores;
    return this.transaction(stores, function (tx) {
      return Promise.all(stores.map(function (s) { return tx.clear(s); }));
    });
  };

  IndexedDBAdapter.prototype.close = function () { if (this.db) { this.db.close(); this.db = null; } };

  /* delete a whole local database (used to remove a signed-out user's cache) */
  IndexedDBAdapter.deleteDatabase = function (name) {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { resolve(); return; }
      var r = indexedDB.deleteDatabase(name);
      r.onsuccess = function () { resolve(); };
      r.onerror = function () { reject(r.error || new Error('Could not delete the local database.')); };
      r.onblocked = function () { resolve(); };
    });
  };

  IndexedDBAdapter.prototype.estimate = function () {
    var out = { usage: null, quota: null, persisted: null };
    if (!navigator.storage) return Promise.resolve(out);
    var p1 = navigator.storage.estimate ? navigator.storage.estimate().then(function (e) { out.usage = e.usage; out.quota = e.quota; }, function () {}) : Promise.resolve();
    var p2 = navigator.storage.persisted ? navigator.storage.persisted().then(function (p) { out.persisted = p; }, function () {}) : Promise.resolve();
    return Promise.all([p1, p2]).then(function () { return out; });
  };

  /* ask the browser not to evict this origin's data (best effort) */
  IndexedDBAdapter.prototype.requestPersistence = function () {
    if (navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(function () { return false; });
    return Promise.resolve(false);
  };

  MF.storage = {
    SCHEMA: SCHEMA,
    STORES: STORES,
    PER_PARTICIPANT_SINGLE: PER_PARTICIPANT_SINGLE,
    PER_PARTICIPANT_MANY: PER_PARTICIPANT_MANY,
    IndexedDBAdapter: IndexedDBAdapter
  };
})();
