# Security checklist — Phase 2

Status after the final review. “Test” names refer to [TESTING.md](TESTING.md).

| # | Area | How it is handled | Verified by |
|---|---|---|---|
| 1 | **Row Level Security** | Enabled on all 17 tables. `anon` has no privileges. `authenticated` reads through policies that require an active profile whose password was changed; archived records only for Administrators. No DELETE privilege for anyone but the owner. | `rls_tests.sql` (69 checks), T1, T3, T31 |
| 2 | **Secrets in the frontend** | The browser holds only the project URL and the publishable/anon key. The build refuses `sb_secret_…` / `service_role` keys and scans `dist/` for secret material; the app refuses to start with one in `config.js`. The secret key exists only as Supabase's injected Edge Function environment. | T32, build tests |
| 3 | **Edge Function authorization** | Each function: verifies the bearer token with Supabase Auth, loads the caller's profile (must exist and be active), checks the Administrator role (and that their own password was changed) for admin functions, validates every input, CORS limited to `ALLOWED_ORIGINS` (missing → refuses all), rate limits, audit rows without passwords. `verify_jwt = true` adds the platform check. | `functions.test.ts` (15), `test_functions_http.py` (19), T7 |
| 4 | **Role escalation** | Users cannot update `profiles` at all; roles change only through `admin_set_user_role` (Administrator check inside the database) or account creation by an Administrator. Self-promotion and direct column writes are refused. Last active Administrator cannot be demoted or disabled. | rls_tests, T7, T27 |
| 5 | **Participant ID race conditions** | `create_participant` locks the school row, refuses duplicates, inserts and advances the counter in one transaction; `(school_id, seq)` and `code` are unique; IDs cannot be changed by examiners (no column privilege) and changes by Administrators are audited. No offline ID creation. | `concurrency_test.sh` (240 parallel creations), T10, T12, T17 |
| 6 | **Offline cache exposure** | One IndexedDB database per user; deleted on a clean sign-out and when an account is found disabled; sign-out with unsent changes warns and keeps them only on explicit choice. The cache is not encrypted (browser storage): use device passcodes / MDM on field tablets. | T9, T25 |
| 7 | **Backup access** | Full backup and import only for Administrators (interface) — the data they read is what RLS already allows Administrators; `admin_import` checks the role in the database. The backup file contains names and is labelled so. | T7 (`admin_import` refused), import tests |
| 8 | **Archive permissions** | Archive/restore only through Administrator database functions; archived participants/schools hidden from Examiners and not editable by anyone until restored; archived numbers are never reused. | rls_tests, T23 |
| 9 | **Excel export permissions** | Exports read through RLS with the user's own session. “Export all” is offered to Administrators only. Names are never exported. Note: Examiners can technically read every *active* school through the API (they need this for fieldwork). | T20, T21, T6 |
| 10 | **Realtime authorization** | Postgres Changes evaluates each subscriber's RLS; subscriptions are narrow (one school / one participant) and closed with their screen. Disabled users receive nothing. | T13, T19 |
| 11 | **Conflict handling** | Optimistic versions + per-field comparison with the value each edit started from; genuine same-field conflicts are shown and never overwritten silently; different fields merge automatically. | T18, merge tests |
| 12 | Passwords | Only in Supabase Auth (bcrypt). Never in profiles, IndexedDB, localStorage, logs or audit rows. Temporary passwords force a change before any research access. Policy: 8–72 bytes, letters and digits. | T4, T5, T26, function tests |
| 13 | Sessions | supabase-js session tokens in localStorage (not passwords). Disabling an account bans it in Auth (sessions cannot be refreshed) and RLS denies research data at once. Expired sessions return to sign-in without losing queued changes. | T9, T24, expiry test |
| 14 | Browser hardening | CSP `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co …; frame-ancestors 'none'`, no inline scripts or style attributes, `X-Content-Type-Options`, `X-Frame-Options DENY`, HSTS, strict Referrer-Policy, Permissions-Policy. No third-party scripts, fonts or analytics. | test_dist (CSP violations: none) |
| 15 | Public sign-up | The app has no registration; **disable “Allow new users to sign up”** in Supabase Auth (README §6). Even if left on, a self-registered Auth user has no profile and therefore no access. | rls_tests (“no profile”) |
| 16 | Audit | `audit_log` written only by definer functions / Edge Functions; readable only by Administrators; password-like keys stripped. | T4, T8 |

## Residual risks (accepted, documented)

- A disabled user's already-issued access token stays syntactically valid until it expires (Supabase default
  about one hour), but every research table and function refuses it immediately (inactive profile).
- Data kept on a device by “الخروج مع إبقائها على هذا الجهاز” stays readable to someone with that unlocked device
  and developer tools; it is not shown to another account in the app.
- Supabase Realtime and Auth rate limits and JWT settings are platform-managed; review them in the dashboard.
