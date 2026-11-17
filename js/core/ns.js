/* =====================================================================
   Myopia Field Screening Research System — Phase 2 (online, multi-device)
   Namespace and application constants.

   Layering (each layer only talks to the one below it):
     screens / stations / components      (UI — unchanged clinical workflow)
       -> logic/*                          (clinical & business rules, no storage)
       -> services/* + online/repositories (data services)
       -> online/remote.js   Supabase (source of truth, RLS-enforced)
          online/cache.js    per-user IndexedDB cache + outbox (offline)
          online/sync.js     outbox -> Supabase, conflict detection
   ===================================================================== */
(function () {
  'use strict';
  var MF = (window.MF = window.MF || {});

  MF.VERSION = '2.0.0';
  MF.PHASE = 'Phase 2 — online';

  MF.DB_NAME = 'myopia-field-screening';
  MF.DB_VERSION = 1;

  MF.BACKUP_FORMAT = 'myopia-field-screening-backup';
  MF.BACKUP_VERSION = 1;

  /* Every clinical test starts as "Not tested". It is stored as null,
     never as 0, 6/6, Ortho, NAD, Pass, Full, None or Normal. */
  MF.NT = null;
  MF.NT_LABEL = 'Not tested';

  /* tiny preference keys (localStorage: theme, last route, sign-in session tokens, profile summary) */
  MF.PREF_THEME = 'mfs.theme';
  MF.PREF_LAST_ROUTE = 'mfs.lastRoute';

  MF.log = function () {
    if (window.console && console.warn) console.warn.apply(console, ['[MFS]'].concat([].slice.call(arguments)));
  };
})();
