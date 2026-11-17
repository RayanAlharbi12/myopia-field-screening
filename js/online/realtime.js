/* =====================================================================
   Realtime (Supabase Postgres Changes). One approach, narrowly scoped:
     home page          schools
     school page        that school's participants + their summaries
     participant form   that participant's rows in every station table
   Realtime applies each subscriber's Row Level Security, so a device only
   receives rows its user may read. Every subscription is removed when its
   screen closes; after a lost connection the screen reloads its data.
   ===================================================================== */
(function () {
  'use strict';
  var MF = window.MF;
  var open = {};
  var n = 0;

  function subscribe(name, specs, onRow) {
    if (!MF.sb || !MF.auth.canSync()) return function () {};
    var id = name + ':' + (++n);
    var ch = MF.sb.channel(id);
    specs.forEach(function (s) {
      var cfg = { event: '*', schema: 'public', table: s.table };
      if (s.filter) cfg.filter = s.filter;
      ch.on('postgres_changes', cfg, function (payload) {
        var row = payload && payload.new;
        if (!row || !Object.keys(row).length) return;
        MF.sync.applyRemote(s.table, [row], 'realtime').then(function (stored) {
          if (stored.length && onRow) onRow(s.table, stored[0]);
        }, function (e) { MF.log('realtime apply', e); });
      });
    });
    ch.subscribe(function (status) { MF.debug('realtime', id, status); });
    open[id] = ch;
    return function () {
      if (!open[id]) return;
      delete open[id];
      try { MF.sb.removeChannel(ch); } catch (e) { /* already closed */ }
    };
  }

  var STATION_TABLES = ['registration', 'autorefraction', 'strabismus', 'visual_acuity', 'questionnaire_responses', 'station_status',
    'family_members', 'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'eom_findings'];

  MF.live = {
    schools: function (onRow) { return subscribe('schools', [{ table: 'schools' }], onRow); },
    school: function (schoolId, onRow) {
      return subscribe('school', [
        { table: 'participants', filter: 'school_id=eq.' + schoolId },
        { table: 'participant_summary', filter: 'school_id=eq.' + schoolId },
        { table: 'schools', filter: 'id=eq.' + schoolId }
      ], onRow);
    },
    participant: function (pid, onRow) {
      return subscribe('participant', [{ table: 'participants', filter: 'id=eq.' + pid }, { table: 'participant_summary', filter: 'participant_id=eq.' + pid }]
        .concat(STATION_TABLES.map(function (t) { return { table: t, filter: 'participant_id=eq.' + pid }; })), onRow);
    },
    stopAll: function () {
      Object.keys(open).forEach(function (id) { try { MF.sb.removeChannel(open[id]); } catch (e) { /* ignore */ } delete open[id]; });
    },
    count: function () { return Object.keys(open).length; }
  };
})();
