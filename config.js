/* =====================================================================
   Deployment configuration — the ONLY two values the browser needs.

   SUPABASE_URL              Project URL, e.g. https://abcdefghijkl.supabase.co
   SUPABASE_PUBLISHABLE_KEY  The PUBLISHABLE key (starts with sb_publishable_)
                             or the legacy "anon" public key.

   Never put a secret key (sb_secret_…) or the service_role key here:
   the application refuses to start if you do.
   On Netlify you can leave this file as it is and set the environment
   variables SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY instead — the build
   writes them into dist/config.js.
   ===================================================================== */
window.MFS_CONFIG = {
  SUPABASE_URL: 'https://ehrbdzwycmwqfravaods.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_euoKrb6KJkaX39AfJ0m6Bw_RqewAcYM'
};
