# Myopia Field Screening Research System — Phase 2 (online, multi-device)

The approved Arabic (RTL) field application — schools, Participant IDs (`1-1`, `1-2` …), the five
stations (Registration, Autorefraction, Strabismus + EOM, Visual Acuity, Questionnaire), the pickers,
“Not tested”, referral rules and the research Excel workbook — now running as a **multi-user web
application** on **Supabase** (database, sign-in, Edge Functions, Realtime) hosted on **Netlify**.

- Sign-in for every user; two roles, **مدير النظام** (Administrator) and **فاحص** (Examiner), enforced by the
  database (Row Level Security and database functions), not only by the interface.
- Several iPads can work on the same school and the same participant; changes appear on the other
  devices within seconds.
- Short network interruptions do not stop fieldwork: edits are saved on the device and sent when the
  connection returns. Same-field edits made on two devices at once are shown for review, never overwritten.
- New Participant IDs are reserved by the server, so two devices can never receive the same ID.
- No demo data, no analytics, no secret key in the browser.

Maintainers: architecture in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), go-live checklist in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), security checklist in [SECURITY.md](SECURITY.md), tests and
results in [TESTING.md](TESTING.md).

---

## 1. Requirements

| You need | Notes |
|---|---|
| A **Supabase** account and one **new, dedicated project** for this study | Free or paid plan. Do not reuse a project that holds other data. |
| A **Netlify** account | Hosts the website (static files only). |
| **Node.js 22** and npm on the computer you deploy from | Only to install the official `@supabase/supabase-js` and build `dist/`. Netlify builds with Node 22 automatically (see `netlify.toml`). |
| The **Supabase CLI** | To deploy the four Edge Functions. Use `npx supabase …` (no install) or `brew install supabase/tap/supabase`. |
| Git repository (GitHub, GitLab or Bitbucket) | Recommended: Netlify builds every push. Manual drag-and-drop of `dist/` also works. |

The project folder:

```
index.html, config.js, manifest.webmanifest   the app entry, the 2 public settings, PWA manifest
css/, js/, vendor/xlsx-lite.js, assets/        application source (no framework, no CDN)
package.json, build/                          npm run dev / npm run build (-> dist/)
netlify.toml                                  Netlify build, routing and security headers
supabase/setup.sql                            the whole database, in one file (generated from migrations/)
supabase/migrations/                          the same SQL split into 8 ordered migrations
supabase/bootstrap_first_admin.sql            one-time: make the first Administrator
supabase/functions/                           4 Edge Functions + shared code
supabase/config.toml                          Edge Function settings for the CLI
supabase/tests/rls_tests.sql                  security test suite (runs and rolls itself back)
tests/                                        automated tests (see TESTING.md)
```

## 2. Create Supabase project

1. <https://supabase.com/dashboard> → **New project**. Choose an organisation, a name (for example
   `myopia-screening`), a strong **database password** (store it in a password manager — the app never needs it)
   and the region closest to the schools.
2. Wait until the project is ready.
3. Note the **project reference** (the part before `.supabase.co` in the Project URL; also in the dashboard address).

## 3. Run database setup

1. Dashboard → **SQL Editor** → **New query**.
2. Open `supabase/setup.sql` from this folder, copy **all** of it, paste, press **Run**.
   It creates the tables, constraints, indexes, Row Level Security policies, database functions, triggers and
   the Realtime publication. It creates **no users, no schools, no participants**. Running it again is safe.
3. Check: **Table Editor** shows 17 tables in `public`; every table shows **RLS enabled**.
4. Run the security suite: open `supabase/tests/rls_tests.sql`, paste it into a new query, **Run**.
   The last result row must say **`ALL PASSED (69 checks)`**. The script uses temporary test users inside one
   transaction and rolls everything back — nothing is left behind.

(Prefer migrations? `npx supabase link --project-ref <ref>` then `npx supabase db push` applies
`supabase/migrations/` in order — the same SQL as `setup.sql`.)

## 4. Deploy Edge Functions

The four functions create users, reset passwords, enable/disable accounts and change passwords. They are the
only code that uses the secret key, and it never leaves Supabase.

From the project folder:

```bash
npx supabase login                                   # opens the browser once
npx supabase link --project-ref <your-project-ref>
npx supabase functions deploy admin-create-user --use-api
npx supabase functions deploy admin-reset-user-password --use-api
npx supabase functions deploy admin-user-status --use-api
npx supabase functions deploy change-password --use-api
```

`--use-api` deploys without Docker. Settings come from `supabase/config.toml` (`verify_jwt = true`: Supabase
checks the caller's sign-in token before the function runs; each function verifies it again and checks the
caller's role in the database). The functions import the official client `npm:@supabase/supabase-js@2.109.0`.

Check: Dashboard → **Edge Functions** lists the four functions.

## 5. Configure Edge Function secrets

Supabase injects `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS` (and the legacy
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`) into every function automatically — **you do not copy any
key anywhere**. You set one value yourself: the web address(es) allowed to call the functions.

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://your-site.netlify.app
```

- Use the exact site address, `https://`, no trailing slash. Several addresses: separate with commas, e.g.
  `https://your-site.netlify.app,https://screening.example.org`.
- For local testing add `http://localhost:5173`.
- Without `ALLOWED_ORIGINS` the functions refuse every call (they never fall back to “allow all”).
- Dashboard alternative: **Edge Functions → Secrets** → add `ALLOWED_ORIGINS`.

## 6. Create first Administrator

### إنشاء أول حساب مدير

Done once. The password is typed only into Supabase's own form; it is never written in any file.

1. Dashboard → **Authentication → Users → Add user → Create new user**.
   Enter the Administrator's e-mail and a strong password; tick **Auto Confirm User**; **Create user**.
2. Open `supabase/bootstrap_first_admin.sql`, replace `REPLACE_WITH_ADMIN_EMAIL` with that e-mail
   (and, if you like, `مدير النظام` with the person's name).
3. Paste it into the **SQL Editor** and **Run**. Expected message: `Administrator ready: <email>`.

The script refuses to run when an active Administrator already exists, so it cannot later be used to grant
rights behind the application's back. Everyone else is created inside the application (section 13).

Then, in the same dashboard (**Authentication → Sign In / Providers**, sometimes shown as
**Authentication → Settings**): switch **off “Allow new users to sign up”**. The application has no public
registration; accounts are created only by Administrators. (Accounts created by an Administrator through the
Edge Function keep working.) Recommended in the same area: minimum password length **8**.

## 7. Configure frontend Supabase URL/publishable key

The browser needs exactly two **public** values, both on Dashboard → **Settings → API Keys** (or the
**Connect** dialog):

| Setting | Value |
|---|---|
| `SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | the **publishable** key `sb_publishable_…` (or the legacy **anon** key) |

Choose one way:

- **Netlify (recommended):** Site configuration → **Environment variables** → add `SUPABASE_URL` and
  `SUPABASE_PUBLISHABLE_KEY`. The build writes them into `dist/config.js`. Nothing is committed.
- **Or** fill them into `config.js` in the project root and commit it.

**Never** use the secret key (`sb_secret_…`) or the `service_role` key here. The build stops with an error if
you try, and the app refuses to start if one reaches `config.js`. If a secret key was ever exposed, rotate it
in **Settings → API Keys**.

If the values are missing the app shows “إعداد الاتصال غير مكتمل” — it never silently works on a local-only
database.

## 8. Run locally

```bash
npm install          # installs the pinned @supabase/supabase-js 2.109.0 and creates package-lock.json
npm run dev          # http://localhost:5173
```

Fill `config.js` (section 7) and add `http://localhost:5173` to `ALLOWED_ORIGINS` (section 5) if you want to
manage users locally. The development server serves the source files directly; the offline service worker is
switched off in development. Commit the generated `package-lock.json` — Netlify then installs exactly the same
versions (`npm ci`).

Debug logging (no passwords or tokens are ever logged): open the app once with `?debug=1`; `?debug=0` turns it off.

## 9. Build production

```bash
npm ci               # or npm install the first time
npm run build        # -> dist/
```

The build bundles the scripts and styles into content-hashed files, copies the official supabase-js browser
build, writes `dist/config.js`, generates the service worker (its cache name changes with every build, so
installed devices update), writes the Content-Security-Policy into `dist/_headers`, and **scans `dist/` for
secret keys** — it fails if it finds one. The build label shown in **حول النظام** is the Git commit on Netlify.

## 10. Configure Supabase Auth URLs

Dashboard → **Authentication → URL Configuration**:

- **Site URL**: `https://your-site.netlify.app` (your production address).
- **Redirect URLs**: add the same address (and `http://localhost:5173` for local work).

The app signs in with e-mail + password only and sends no e-mail links (Administrators set temporary
passwords), but a correct Site URL keeps any Supabase e-mail templates pointing at the right place.

## 11. Deploy to Netlify

**From Git (recommended):** Netlify → **Add new site → Import an existing project** → choose the repository.
`netlify.toml` already sets: build command `npm ci --no-audit --no-fund && npm run build`, publish directory
`dist`, Node 22, routing, security headers and caching. Add the two environment variables (section 7), then
**Deploy**.

**Manual:** run `npm run build` locally (with `config.js` filled or the two variables exported) and drag the
`dist/` folder onto Netlify → **Deploys**. `dist/_headers` carries the CSP; `netlify.toml` headers are not used
by manual uploads, so prefer Git deploys.

After the first deploy: put the final address into `ALLOWED_ORIGINS` (section 5) and **Site URL** (section 10).
If you add a custom domain later, add it to both.

## 12. Login

Open the site → **تسجيل الدخول** with the first Administrator's e-mail and password. The session stays on the
device until **تسجيل الخروج**; tokens are refreshed automatically. On iPad: Safari → Share → **Add to Home
Screen**. WebKit may erase website storage after 7 days without use, while Home-Screen web apps keep their own
counter ([The Register, quoting the WebKit team](https://www.theregister.com/2020/03/26/apple_relax_were_not_totally/));
in any case, let the chip reach **تمت المزامنة** before putting a device away.

- The account menu (person icon) has **تغيير كلمة المرور**, **إدارة النظام** (Administrators), **الإعدادات**,
  **حول النظام** (app version, environment, database status) and **تسجيل الخروج**.
- The chip next to it shows synchronisation: **تمت المزامنة**, **جارٍ المزامنة**, **غير متصل — محفوظ محليًا**,
  **خطأ في المزامنة**, or a review-needed conflict. Tap it for details.

## 13. Create first user from Admin panel

Account menu → **إدارة النظام** → **المستخدمون** (إدارة المستخدمين) → **+ إضافة مستخدم**:
الاسم, البريد الإلكتروني, الدور (فاحص / مدير النظام), a temporary password typed twice
(8+ characters with letters and digits). Message: **تم إنشاء المستخدم بنجاح**.

Give the temporary password to the person privately. At their first sign-in they must choose a new password
before they can see any data (the database itself refuses research data until then).

Per user (⋯ menu): تعديل الاسم, تغيير الدور (with confirmation), إعادة تعيين كلمة المرور (new temporary
password; the person must change it again), تعطيل الحساب / إعادة تفعيل الحساب. The last active Administrator
cannot be demoted or disabled. Every action is written to **سجل التدقيق** (never passwords).

## 14. Test user permissions

Sign in as the new Examiner (another browser or device):

- Sees active schools, can open a school, **إضافة مشارك**, and edit all five stations; can export **one
  school** (تصدير بيانات المدرسة).
- Does **not** see: إدارة النظام, إنشاء مدرسة, عداد المشاركين, تعديل رقم المشارك, archive/restore, export of all
  data, full backup, import. Typing `#/admin` returns to the schools page.
- The database enforces the same rules: calling an administrative function directly (developer tools) returns
  `MFS:NOT_ADMIN`; writing protected columns is refused. `supabase/tests/rls_tests.sql` proves this.

## 15. Test multi-device sync

Two iPads, two accounts (or the same), same school:

1. Both press **+ إضافة مشارك** at the same moment → two different IDs (e.g. `1-20`, `1-21`).
2. Both open the same participant; device A completes **Autorefraction** → device B's station bar shows it
   completed and the values within a few seconds; a toast says the participant was updated from another device.
3. A edits Autorefraction while B edits the Questionnaire → both are kept.
4. A enters VA 6/12 → device B's school list shows **إحالة** for that participant.

## 16. Test offline mode

1. Open the school → ⋯ → **تجهيز المدرسة للعمل دون اتصال** (downloads every participant of that school to the
   device; also happens automatically for each participant you open).
2. Turn on airplane mode. Open a participant, change VA → the bar shows **غير متصل — محفوظ محليًا**. You can
   close and reopen the app; the change stays queued.
3. **+ إضافة مشارك** offline shows: *يتطلب إنشاء مشارك جديد اتصالًا بالإنترنت لحجز رقم المشارك بشكل آمن.* — no
   temporary IDs are ever invented.
4. Turn the network back on → **تمت المزامنة**; the value is in Supabase.
5. Conflict: device B offline changes a field; device A changes the same field online; B reconnects → B shows
   **تعارض — مراجعة** with both values; choose **اعتماد نسخة الجهاز الآخر**, **اعتماد نسخة هذا الجهاز**, or
   **دمج** (field by field). Nothing is overwritten before you choose. Different fields of the same participant
   never conflict; symptom/reason lists merge item by item.

Administrative actions (users, counter, IDs, archive, import) and sign-in need a connection. A device that has
never signed in cannot work offline; an already signed-in device can start offline for up to 7 days since the
server last confirmed the account.

## 17. Excel export

- **تصدير بيانات المدرسة** (school page, everyone) and **تصدير جميع البيانات** (Administrator) read the canonical
  data from Supabase at that moment and produce the approved workbook: sheets **Participants**, **Family**,
  **Questionnaire**, the same columns and codes (Not tested / Not answered / Not applicable), **without names**.
  Archived participants and archived schools are excluded.
- Offline, a school can be exported only if it was fully prepared on this device (section 16); the message
  says it is the device copy and its date. “Export all” requires a connection.

## 18. Backup/restore

Administrator → **إدارة النظام → البيانات**:

- **تصدير نسخة احتياطية كاملة** — one JSON file with every table (schools, participants, all station data,
  questionnaire, station status, audit log). **Contains names** — store it encrypted. Accounts and passwords are
  not included. (Supabase's own automatic database backups depend on the project's plan; check your plan.)
- **استيراد نسخة من النظام الأوفلاين** — imports a backup file made by the Phase 1 offline app: the file is
  validated, a **dry run** shows new/existing schools and participants and every conflict, and nothing is written
  until you tick the confirmation and press **استيراد**. Participant IDs and record IDs are kept (`1-1` stays
  `1-1`); counters move past imported numbers; existing online records are never changed. A Phase 1 school whose
  number is already used online is listed as a conflict and skipped. Each school is imported as one transaction.
- **استعادة نسخة احتياطية كاملة** — the same safe process for a Phase 2 full backup: adds only what is missing.
  To rebuild a lost project: create a new project, run `setup.sql`, create the first Administrator, then restore.

## 19. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| **Login fails** (“البريد الإلكتروني أو كلمة المرور غير صحيحة”) | Wrong e-mail/password, or the user was created in the dashboard without **Auto Confirm**. Reset the password from **إدارة المستخدمين**. “هذا الحساب غير مُعدّ للعمل في النظام”: an Auth user without a profile — create users only from the app (or run the bootstrap once for the first Administrator). |
| **Incorrect Auth Site URL** | Authentication → URL Configuration → Site URL must be the production address (section 10). |
| **Edge Function returns 401** | The caller is not signed in or the session expired — sign in again. Check the four functions are deployed with `verify_jwt = true`. If your project's JWT settings make the gateway reject valid sessions, redeploy with `verify_jwt = false` for these four functions (each function still verifies the caller itself). |
| **User creation fails** | “عنوان هذا الموقع غير مسموح به”: add the site address to `ALLOWED_ORIGINS` (section 5). “خدمة إدارة الحسابات غير متاحة”: deploy the functions (section 4). “يوجد حساب بهذا البريد”: the e-mail exists (perhaps disabled — reactivate it). Weak password: 8+ characters, letters and digits. |
| **RLS blocks a legitimate request** | The account is disabled or still has to change its password (both remove research access by design); the participant or school is archived (examiners cannot see or edit archived records). Check the profile in **إدارة المستخدمين**. Re-run `setup.sql` if policies were edited by hand. |
| **Realtime not updating** | Dashboard → Database → Publications: `supabase_realtime` must list the 14 application tables (re-run `setup.sql`). The CSP must allow `wss://<ref>.supabase.co` (the build does this for `*.supabase.co`; custom domains are added from `SUPABASE_URL`). After a network drop the screen reloads its data automatically. |
| **Offline queue stuck** | Tap the sync chip → **حالة المزامنة**: it lists each waiting change and the server's reason. “إعادة المحاولة الآن” retries. A change the server keeps refusing (e.g. the participant was archived meanwhile) can be **تجاهل التغيير** after review. Signing out with waiting changes warns first; “الخروج مع إبقائها على هذا الجهاز” keeps them for the next sign-in of the same user. |
| **PWA cache stale** | Every build has a new service-worker cache; open clients show **يتوفر إصدار جديد — تحديث الآن**. If a device still shows an old version: close all tabs of the app and reopen; as a last resort Safari → Settings → Advanced → Website Data → remove the site (sign in again afterwards; sync first). |
| **Excel export incomplete** | Exports read the server; archived records are excluded by design. Offline exports only cover a school prepared on that device and only changes known to it — export again online. Check **حالة المزامنة** for changes not yet sent from other devices. |
| **Participant ID conflict** (“رقم المشارك موجود مسبقًا. يرجى تعديل العداد.”) | The school's counter points at a number already used (perhaps archived). An Administrator opens **عداد المشاركين** and uses “أول رقم متاح بعد أعلى رقم مسجَّل”. IDs are never overwritten or reused. |
| “إعداد الاتصال غير مكتمل” / “تم إيقاف التطبيق لحماية قاعدة البيانات” | `config.js` is empty, or contains a secret key. See section 7. |
| Build fails: “@supabase/supabase-js is not installed” | Run `npm ci` (or `npm install`) before `npm run build`. |
