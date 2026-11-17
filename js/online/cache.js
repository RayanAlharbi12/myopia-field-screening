/* =====================================================================
   Per-user offline cache (IndexedDB "mfs-cache-<user id>").
   Holds the rows this device has loaded, the outbox of changes not yet
   confirmed by the server, open conflicts and small metadata.
   One database per signed-in user: a shared tablet never mixes accounts,
   and a clean sign-out deletes it.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;

  var SCHEMA = {
    schools: { key: 'id' },
    participants: { key: 'id', indexes: [['school_id', 'school_id']] },
    registration: { key: 'participant_id' },
    autorefraction: { key: 'participant_id' },
    strabismus: { key: 'participant_id' },
    visual_acuity: { key: 'participant_id' },
    questionnaire_responses: { key: 'participant_id' },
    family_members: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    ocular_history_entries: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    systemic_history_entries: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    family_history_entries: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    eom_findings: { key: 'id', indexes: [['participant_id', 'participant_id']] },
    station_status: { key: ['participant_id', 'station'], indexes: [['participant_id', 'participant_id']] },
    outbox: { key: 'k', indexes: [['pid', 'pid']] },
    conflicts: { key: 'k', indexes: [['pid', 'pid']] },
    meta: { key: 'key' }
  };
  var VERSION = 1;

  function dbName(uid) { return 'mfs-cache-' + uid; }

  var cache = MF.cache = {
    SCHEMA: SCHEMA,
    db: null,
    uid: null,
    open: function (uid) {
      if (cache.db && cache.uid === uid) return Promise.resolve(cache.db);
      if (cache.db) cache.close();
      var a = new MF.storage.IndexedDBAdapter(dbName(uid), VERSION, SCHEMA);
      return a.open().then(function () {
        cache.db = a; cache.uid = uid;
        a.requestPersistence();
        return a;
      });
    },
    close: function () { if (cache.db) cache.db.close(); cache.db = null; cache.uid = null; },
    /* removes this user's cached research data from the device */
    destroy: function (uid) {
      if (cache.uid === uid) cache.close();
      return MF.storage.IndexedDBAdapter.deleteDatabase(dbName(uid));
    },
    meta: function (key) { return cache.db ? cache.db.get('meta', key).then(function (r) { return r ? r.value : undefined; }) : Promise.resolve(undefined); },
    setMeta: function (key, value) { return cache.db ? cache.db.put('meta', { key: key, value: value, at: new Date().toISOString() }) : Promise.resolve(); },

    /* cached participant bundle in the shape the working form uses (null when not on this device) */
    bundle: function (pid) {
      if (!cache.db) return Promise.resolve(null);
      var T = MF.tables;
      var stores = ['participants', 'schools', 'station_status'].concat(T.SINGLES, T.MANYS);
      return cache.db.transaction(stores, function (tx) {
        return tx.get('participants', pid).then(function (p) {
          if (!p || !p._full) return null;
          return Promise.all([tx.get('schools', p.school_id), tx.getAllByIndex('station_status', 'participant_id', pid)]
            .concat(T.SINGLES.map(function (s) { return tx.get(s, pid); }))
            .concat(T.MANYS.map(function (s) { return tx.getAllByIndex(s, 'participant_id', pid); }))).then(function (r) {
            if (!r[0]) return null;
            var b = { participant: p, school: r[0], _statusRows: r[1] }, i = 2;
            T.SINGLES.forEach(function (s) { b[s] = r[i++] || null; });
            T.MANYS.forEach(function (s) { b[s] = r[i++] || []; });
            return b;
          });
        });
      }, 'readonly');
    }
  };
})();
