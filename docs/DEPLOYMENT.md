# Deployment guide — go-live checklist

The full explanations are in [README.md](../README.md) (same numbering). Tick each line.

## Supabase

- [ ] New, dedicated project created; database password stored in a password manager (README §2).
- [ ] `supabase/setup.sql` run in the SQL Editor; 17 tables, RLS enabled on all (§3).
- [ ] `supabase/tests/rls_tests.sql` run → last row **ALL PASSED (69 checks)** (§3).
- [ ] Four Edge Functions deployed (§4):
  ```bash
  npx supabase login
  npx supabase link --project-ref <ref>
  npx supabase functions deploy admin-create-user --use-api
  npx supabase functions deploy admin-reset-user-password --use-api
  npx supabase functions deploy admin-user-status --use-api
  npx supabase functions deploy change-password --use-api
  ```
- [ ] Secret set (§5): `npx supabase secrets set ALLOWED_ORIGINS=https://<your-site>.netlify.app`
- [ ] First Administrator: dashboard user (Auto Confirm) + `supabase/bootstrap_first_admin.sql` with the e-mail filled in (§6).
- [ ] Authentication: **Allow new users to sign up = off**; minimum password length 8 (§6).
- [ ] Authentication → URL Configuration: Site URL and Redirect URL = production address (§10).

## Netlify

- [ ] Site imported from Git; `netlify.toml` detected (build `npm ci … && npm run build`, publish `dist`, Node 22) (§11).
- [ ] Environment variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (publishable key, never a secret key) (§7).
- [ ] `package-lock.json` committed (created by `npm install` once) so builds are reproducible (§8).
- [ ] Deploy succeeded; deploy log shows `secret scan: clean` and the project URL.
- [ ] Final address copied into `ALLOWED_ORIGINS` and Auth Site URL (custom domain too, if any).

## Verify on the production address

- [ ] Sign in as the Administrator; **حول النظام** shows version 2.0.0, environment الإنتاج, database متصلة.
- [ ] **إدارة النظام → حالة النظام**: database متصلة, Edge Functions متاحة.
- [ ] Create a school and an Examiner (**تم إنشاء المستخدم بنجاح**); the Examiner's first sign-in forces a new password.
- [ ] Examiner: add a participant, enter values in two stations, see **تمت المزامنة**.
- [ ] Second device: same participant updates live; airplane-mode edit syncs after reconnecting (README §15–16).
- [ ] School Excel export opens with sheets Participants / Family / Questionnaire and no names.
- [ ] Reload a deep link (`…/#/school/<id>`) — opens directly.
- [ ] iPads: Add to Home Screen; sign in once online on each device before field use.
- [ ] Phase 1 data (if any): **إدارة النظام → البيانات → استيراد نسخة من النظام الأوفلاين**, review the dry run, import.
- [ ] Remove any test users/schools you created for verification (archive schools; disable users).

## Updating later

Push to the repository → Netlify builds → open devices show **يتوفر إصدار جديد — تحديث الآن**.
Database changes: add a new migration file, run it in the SQL Editor (or `npx supabase db push`), and
regenerate `setup.sql` with `npm run setup-sql`. Edge Function changes: redeploy that function.
