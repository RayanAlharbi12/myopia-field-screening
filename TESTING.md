# Testing — checklist and results

## How the tests run

Everything below runs without a Supabase account, against the **real project code**:

- **Database**: `supabase/setup.sql` applied to a local PostgreSQL 16 that reproduces Supabase's roles
  (`anon`, `authenticated`, `service_role`), `auth.uid()` and the Realtime publication
  (`tests/harness/supabase_emulation.sql` — test-only, never for Supabase).
- **Edge Functions**: the real code in `supabase/functions/_shared/` (run with Bun instead of Deno).
- **Browser**: the real application in Chromium (Playwright), talking to a local **test stand-in** for the
  Supabase HTTP/Realtime APIs (`tests/harness/server.ts` + `tests/harness/fake-supabase.js`). The stand-in
  executes every query **as the signed-in user's database role** (so RLS, triggers and functions decide), runs
  the Edge Function code, and delivers Realtime changes only to subscribers whose RLS allows the row.

Run all groups: `bash tests/run_all.sh` (PostgreSQL on `/tmp:54329`, Bun, Node 22, Python 3 + Playwright + openpyxl).

## What was NOT tested here (do these after deployment)

| Not verified locally | Why | How to verify |
|---|---|---|
| The hosted Supabase project (Auth server, PostgREST, Realtime service, Edge Runtime/Deno, `verify_jwt` gateway) | No Supabase project or network access from the build environment | README §3 (run `rls_tests.sql` in the SQL Editor), §12–16, `docs/DEPLOYMENT.md` “Verify” list |
| The official `@supabase/supabase-js` 2.109.0 in the browser | The npm registry was not reachable here; tests used a stand-in with the same API shape | Netlify installs it (`npm ci`); the deploy log prints the version; README §15–16 on the live site |
| Netlify itself (build image, `_headers`, redirects) | No Netlify access | `docs/DEPLOYMENT.md`; the same build script, headers and SPA fallback were tested locally |
| Real Safari / iPadOS (TEST 29) | Only Chromium is available here | On an iPad: sign in, Add to Home Screen, airplane-mode edit, reconnect, pickers, keyboard |
| Firefox | Not installed here | Optional quick check |

## Results (final run, 16 November 2026, Chromium 153, PostgreSQL 16, Bun 1.4.4, Node 22)

`bash tests/run_all.sh` → **ALL TEST GROUPS PASSED**

| Group | File(s) | Result |
|---|---|---|
| Database: `setup.sql` on an empty database, re-applied (idempotent), no demo data | `tests/db/run_db_tests.sh` | passed |
| RLS / security suite | `supabase/tests/rls_tests.sql` | **69 / 69** |
| Participant-ID concurrency: 6 parallel sessions × 40 `create_participant` | `tests/db/concurrency_test.sh` | 240 unique, consecutive IDs, 1 200 station rows, 240 audit rows |
| Edge Function unit tests (config, CORS, caller checks, password policy, audit) | `tests/functions/functions.test.ts` | **15 / 15** |
| Edge Functions over HTTP with the real database | `tests/e2e/test_functions_http.py` | **19 / 19** |
| Spec tests 1–35 in the browser | `tests/e2e/test_phase2.py` | **94 / 94** |
| Field-level merge, Phase 1 import, full backup / restore | `tests/e2e/test_sync_import.py` | **20 / 20** |
| Approved Phase 1 behaviour on Phase 2 (the Phase 1 QA flow + 4th glasses option) | `tests/e2e/phase1_regression.py` | **106 / 106** |
| Production build, CSP, offline reload, PWA update, secret scan | `tests/e2e/test_dist.py` | **24 / 24** |

## Spec tests 1–35

| # | Test | Status | Evidence |
|---|---|---|---|
| 1 | Fresh database | ✅ local | 17 tables, RLS on all, policies/functions/triggers/constraints/indexes, 14 Realtime tables, 0 rows |
| 2 | First admin | ✅ local | dashboard-style Auth user + `bootstrap_first_admin.sql`; second run refused; login opens the app |
| 3 | Anonymous security | ✅ local | REST reads, RPCs and Edge Functions refused without a session; app shows only sign-in |
| 4 | Create user | ✅ local | via إدارة المستخدمين: Auth user + profile, Examiner, must_change_password; “تم إنشاء المستخدم بنجاح”; duplicate e-mail clean error; audit without password |
| 5 | First login password | ✅ local | forced change screen; weak password refused; no research rows before the change; access after |
| 6 | Examiner permissions | ✅ local | opens school, adds participant, enters clinical data; no admin page, counter, ID edit, archive |
| 7 | Frontend tampering | ✅ local | examiner calling admin RPCs, direct column writes, admin Edge Function, import → all refused; nothing changed |
| 8 | Admin role | ✅ local | schools, counter, archive/restore, audit log entries |
| 9 | Disable user | ✅ local | profile inactive + Auth ban; disabled user signed out with message, cache removed, sign-in refused, RLS denies; reactivation works |
| 10 | Participant concurrency | ✅ local | two browsers press + at once → 1-2 and 1-3; plus 240-call database test |
| 11 | Counter | ✅ local | next = 20 → 1-20; existing IDs unchanged |
| 12 | Duplicate counter | ✅ local | dialog warns; creating with the used number blocked with the approved message; no overwrite |
| 13 | Two devices | ✅ local | device B shows A's completed Autorefraction and values live |
| 14 | Different stations | ✅ local | Autorefraction (A) and Questionnaire (B) both kept |
| 15 | Offline | ✅ local | offline edit → “غير متصل — محفوظ محليًا”; queue survives a reload (server unreachable) and a full offline reload through the service worker |
| 16 | Reconnect | ✅ local | queued VA reaches the database |
| 17 | Offline create participant | ✅ local | exact message; nothing created |
| 18 | Conflict | ✅ local | stale offline edit vs online edit → conflict shown, server value kept until choice; resolution applied |
| 19 | Referral realtime | ✅ local | VA 6/12 on A → إحالة on B's list without reload; server summary flags |
| 20 | Excel school | ✅ local | approved sheets and columns, values from the database, no names |
| 21 | Global export | ✅ local | Administrator workbook with both schools |
| 22 | Questionnaire | ✅ local | survives reload, visible on another device, JSONB `questionnaire_version = 1`, in Excel |
| 23 | Archive | ✅ local | hidden from list, still in database, number not reusable, restore |
| 24 | Session | ✅ local | page closed and reopened → still signed in |
| 25 | Logout cache | ✅ local | per-user IndexedDB and session removed; warning when changes are unsent |
| 26 | Password reset | ✅ local | must_change_password true → forced change works |
| 27 | Last admin | ✅ local | demote and disable refused (UI, database function, Edge Function) |
| 28 | Mobile | ✅ local (Chromium emulation) | phone 390×844, iPad portrait/landscape, laptop: no horizontal page scroll on home, school, station, admin; screenshots reviewed |
| 29 | Real Safari | ⚠️ not run here | WebKit is not available in this environment — do on an iPad (see table above) |
| 30 | PWA update | ✅ local | second build offered “يتوفر إصدار جديد”, client switched to the new build, old caches removed |
| 31 | RLS | ✅ local | 69 / 69 (also run inside the browser test database) |
| 32 | Service role search | ✅ | no secret strings in `dist/` or frontend sources; the build refuses secret keys (tested with `sb_secret_…` and a `service_role` JWT) |
| 33 | Production build | ✅ local (test client) | build completes, no TODO, every referenced and precached file exists; the real build requires `npm ci` (fails clearly without it) |
| 34 | Netlify | ⚠️ configuration validated locally | the built site runs under its CSP with no violations, deep-link refresh and unknown paths work; real Netlify deploy and Auth URL settings to be checked after deployment |
| 35 | Full field flow | ✅ local | Examiner: create → Registration → Autorefraction → Strabismus + EOM → VA → Questionnaire, all completed on the server, Completed in export |

Also covered: two devices editing **different fields** of one record (no conflict, both kept), symptom lists
merged item by item, expired session → back to sign-in with the expiry message, Phase 1 backup import
(validation, dry run, conflict for a used school number, IDs and UUIDs kept, values, EOM, station status,
questionnaire, counters advanced, audit, re-import adds nothing), full backup restored into an empty database
with identical row counts, Edge Function rate limiting (6th wrong current password → 429), origins outside
`ALLOWED_ORIGINS` refused.

