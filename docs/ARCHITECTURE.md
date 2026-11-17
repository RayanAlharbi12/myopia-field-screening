# Architecture — Phase 2

## Layers

```
screens / stations / components      approved Phase 1 interface (unchanged clinical workflow)
  └─ logic/*                          clinical rules, review, referral, questionnaire (unchanged)
      └─ services/participant-session  the working copy of one participant (same API as Phase 1)
          └─ online/repositories       SchoolRepository, ParticipantRepository, SettingsRepository
              ├─ online/remote          every Supabase call (supabase-js), errors mapped to Arabic
              ├─ online/cache           per-user IndexedDB: rows, outbox, conflicts, metadata
              ├─ online/sync            outbox -> Supabase, versions, merge / conflict detection
              ├─ online/realtime        Postgres Changes subscriptions per screen
              └─ online/auth            sign-in, profile, role, forced password change, sign-out
```

The interface never calls Supabase directly. The station modules still edit through
`ParticipantSession.set / setMany / add / update / remove / setAnswer / complete`.

## Database (supabase/setup.sql)

| Table | Content |
|---|---|
| `profiles` | one row per Auth user: name, e-mail, role (`admin` / `examiner`), active, must_change_password, created_by, last_application_access |
| `schools` | number (never reused), name, city, type, next/last participant sequence, archive fields |
| `participants` | school, `seq`, `code` (`<school number>-<seq>`, unique per school), name (+ normalised Arabic search column), archive fields, version |
| `participant_summary` | derived by the database: age, gender, class, current station, Draft/Completed, referral flags (school lists and counts) |
| `registration`, `autorefraction`, `strabismus`, `visual_acuity` | one row per participant, one column per approved field, with value checks (0.25 D steps, axis 0–180 by 5, VA scale, option codes) |
| `family_members`, `ocular_history_entries`, `systemic_history_entries`, `family_history_entries` | repeatable entries (client UUIDs, soft delete with `deleted_at`) |
| `eom_findings` | one row per eye + muscle (grade −4…+4, note, selected) |
| `questionnaire_responses` | `answers` JSONB keyed by the approved stable question ids, `questionnaire_version = 1` |
| `station_status` | one row per participant and station: not_started / in_progress / completed, completed_at/by (never goes backwards) |
| `audit_log` | administrative actions and participant creation (never passwords) |
| `app_counters` | the school-number counter (only database functions touch it) |

Every table: UUID keys, `created_at/by`, `updated_at/by`, `version` (increased by trigger on each update),
Row Level Security enabled. Foreign keys are `ON DELETE RESTRICT`; nothing is deleted by the application.

### Rights

- `anon`: nothing.
- `authenticated`: SELECT through RLS; UPDATE only of clinical columns (never IDs, school, counters, archive
  fields, roles); INSERT only of repeatable entries (siblings only for family members). No DELETE.
- Everything administrative runs in `SECURITY DEFINER` functions with `search_path = ''` that check
  `is_admin()` themselves: `create_school`, `update_school`, `set_school_archived`, `school_counter_info`,
  `set_next_participant_number`, `change_participant_seq`, `set_participant_archived`, `admin_set_user_role`,
  `admin_set_user_active`, `admin_update_user_name`, `admin_import`.
- `is_active_user()` = profile active **and** password already changed. Disabled users and users who still
  must change their password see no research rows at all.
- Examiners see active schools and participants of active schools; Administrators also see archived ones.
  Archived records are not editable by anyone (restore first).

### Participant IDs

`create_participant(school)` locks the school row (`SELECT … FOR UPDATE`), takes `next_participant_seq`,
refuses an existing `(school, seq)` with `MFS:DUPLICATE_ID`, inserts the participant and all station rows,
advances the counter and writes the audit row — one transaction. Concurrent calls queue on the row lock
(tested with 6 parallel sessions × 40 participants: 240 unique consecutive IDs). Offline devices cannot create
participants. As in Phase 1, an Administrator may set the counter to any number (the dialog warns if it is
used); creating with a used number is refused, so IDs are never overwritten or silently reused.

## Saving and synchronisation

1. A station edit changes the in-memory record and records the field **and the value it replaced**.
2. After 450 ms (or on station change / leaving the page) the changes are written to IndexedDB together with
   an **outbox** entry, in one transaction. The participant bar shows **جارٍ المزامنة** /
   **غير متصل — محفوظ محليًا**.
3. The SyncEngine sends outbox entries in order:
   - **patch**: `UPDATE table SET changed fields WHERE pk = … AND version = <version the edit was based on>`
   - **insert**: new entries with the UUID generated on the device (a retried insert is recognised)
   - **answers**: `patch_questionnaire(pid, expected_version, set, unset)` — per question
   - **station**: `touch_station(pid, station, status)` — monotonic, never conflicts
4. If no row was updated (another device saved first), the current server row is read and each changed field
   is compared with the value the edit started from:
   - unchanged on the server → re-sent automatically on top of the new version
   - already equal → nothing to do
   - changed differently → **conflict**: kept aside, shown to the examiner (keep remote / keep local / per-field
     merge); nothing is overwritten until a choice is made
   - list fields (`symptoms`, `glasses_reasons`, `blurry_loc`) merge item by item; `next_sibling_no` keeps the larger value.
5. A change the server refuses permanently (e.g. participant archived meanwhile) stays visible in
   **حالة المزامنة** until it is retried or explicitly discarded.

The cache is a separate IndexedDB database per user (`mfs-cache-<user id>`). A clean sign-out deletes it; a
sign-out with unsent changes asks first. A disabled account's cache is deleted when the app detects it.

## Realtime

Supabase **Postgres Changes** on the `supabase_realtime` publication, scoped per screen: home → `schools`;
school page → that school's `participants` and `participant_summary`; working form → that participant's rows
in the station tables. Realtime checks each subscriber's RLS, so a device only receives rows its user may read.
Subscriptions are removed when the screen closes. After a lost connection the screen reloads its data.
Incoming rows update the cache and the open form without touching fields that are being edited on this device.

## Offline

- Shell: the service worker precaches the hashed bundles and the page (network first for the page and
  `config.js`, cache first for hashed bundles; Supabase requests are never cached).
- Data: participants opened on the device, or a whole school via **تجهيز المدرسة للعمل دون اتصال**.
- Start-up offline is allowed only with a stored session and a profile confirmed by the server within 7 days.
- Creating participants, administration, sign-in and “export all” need a connection.

## Edge Functions (supabase/functions)

`admin-create-user`, `admin-reset-user-password`, `admin-user-status`, `change-password`; shared code in
`_shared/`. Each verifies the bearer token with Supabase Auth, loads the caller's profile, checks the role,
validates input, rate-limits (audit-based), and writes audit rows without passwords. `admin-user-status` calls
the database function **as the caller** (so the last-Administrator rule applies) and then bans/unbans the Auth
user so sessions end. `change-password` re-checks the current password, sets the new one and clears
`must_change_password`. CORS is limited to `ALLOWED_ORIGINS`.

## Export, backup, import

- Excel: the approved `ExportService` workbook builder, fed with rows read from Supabase (paged), converted to
  the approved in-memory shape. Names are never exported.
- Full backup (Administrator): every table as JSON (version 2).
- Import (Administrator): Phase 1 backup (version 1, validated with the approved Phase 1 validator, converted)
  or Phase 2 backup → `admin_import(payload, dry_run => true)` → summary → confirmation → per-school
  transaction. Existing rows are never changed; IDs are kept; counters move past imported numbers.
