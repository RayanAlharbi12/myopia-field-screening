-- =====================================================================
-- 002: tables and constraints. Re-runnable (create if not exists).
-- Column names deliberately equal the approved Phase 1 field names, so the
-- clinical logic, review rules and Excel export run unchanged on these rows.
-- "Not tested" is always NULL — never 0, 6/6, Ortho, NAD, Pass, Full.
-- Normal deletion is archive (schools, participants) or soft delete
-- (deleted_at on repeatable entries); foreign keys use ON DELETE RESTRICT.
-- =====================================================================

-- ---------- users ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email text not null check (char_length(email) between 3 and 320),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  role public.app_role not null default 'examiner',
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  last_application_access timestamptz
);

create table if not exists public.app_counters (
  key text primary key,
  value integer not null check (value >= 1)
);

-- ---------- schools & participants ----------
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  city text not null check (char_length(btrim(city)) between 1 and 120),
  type public.school_type not null,
  next_participant_seq integer not null default 1 check (next_participant_seq between 1 and 99999),
  last_assigned_seq integer check (last_assigned_seq between 1 and 99999),
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete restrict,
  seq integer not null check (seq between 1 and 99999),
  code text not null unique check (code ~ '^[0-9]+-[0-9]+$'),
  name text not null default '' check (char_length(name) <= 200),
  name_search text generated always as (public.mfs_normalize_ar(name)) stored,
  archived boolean not null default false,
  archived_at timestamptz,
  archived_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  constraint participants_school_seq_key unique (school_id, seq)
);

-- derived, maintained by triggers only (list columns, overall status, referral)
create table if not exists public.participant_summary (
  participant_id uuid primary key references public.participants (id) on delete restrict,
  school_id uuid not null references public.schools (id) on delete restrict,
  age smallint,
  gender text,
  class_level smallint,
  current_station public.station_name,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  referral_re boolean not null default false,
  referral_va boolean not null default false,
  referral_alert boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------- station 1: registration ----------
create table if not exists public.registration (
  participant_id uuid primary key references public.participants (id) on delete restrict,
  age smallint check (age between 0 and 99),
  gender text check (gender in ('male', 'female')),
  class_level smallint check (class_level between 1 and 3),
  glasses text check (glasses in ('yes', 'no', 'yes_not_now', 'previously')),
  glasses_reasons text[] not null default '{}' check (glasses_reasons <@ array['headache','uncomfortable','not_clear','forgot','other']::text[]),
  glasses_reason_other text check (char_length(glasses_reason_other) <= 500),
  oc_disease text check (oc_disease in ('yes', 'no')),
  oc_surgery text check (oc_surgery in ('yes', 'no')),
  oc_med text check (oc_med in ('yes', 'no')),
  family_size smallint check (family_size between 0 and 99),
  birth_order smallint check (birth_order between 0 and 99),
  next_sibling_no integer not null default 1 check (next_sibling_no >= 1),
  fam_glasses text check (fam_glasses in ('yes', 'no')),
  fam_disease text check (fam_disease in ('yes', 'no')),
  fam_surgery text check (fam_surgery in ('yes', 'no')),
  sys_self text check (sys_self in ('yes', 'no')),
  sys_family text check (sys_family in ('yes', 'no')),
  symptoms_gate text check (symptoms_gate in ('yes', 'no')),
  symptoms text[] not null default '{}' check (symptoms <@ array['blurry','headache','photophobia','diplopia','asthenopia','pain','redness','itching','watering','squinting','closing_one_eye','other']::text[]),
  blurry_loc text[] not null default '{}' check (blurry_loc <@ array['near','distance']::text[]),
  symptom_other text check (char_length(symptom_other) <= 500),
  ant_status text check (ant_status in ('nad', 'abnormal')),
  ant_lids_od text check (char_length(ant_lids_od) <= 500),
  ant_lids_os text check (char_length(ant_lids_os) <= 500),
  ant_cornea_od text check (char_length(ant_cornea_od) <= 500),
  ant_cornea_os text check (char_length(ant_cornea_os) <= 500),
  ant_pupil_od text check (char_length(ant_pupil_od) <= 500),
  ant_pupil_os text check (char_length(ant_pupil_os) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete restrict,
  relation text not null check (relation in ('father', 'mother', 'participant', 'sibling')),
  key text not null check (key ~ '^(F|M|P|S[0-9]+)$'),
  sex text check (sex in ('male', 'female')),
  older text check (older in ('older', 'younger')),
  birth_order smallint check (birth_order between 0 and 99),
  glasses boolean not null default false,
  glasses_type text check (glasses_type in ('distance', 'near', 'both')),
  sel_disease boolean not null default false,
  sel_surgery boolean not null default false,
  sel_systemic boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  constraint family_members_key_unique unique (participant_id, key)
);

create table if not exists public.ocular_history_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete restrict,
  kind text not null check (kind in ('disease_injury', 'surgery', 'medication')),
  subtype text check (subtype in ('disease', 'injury')),
  name text check (char_length(name) <= 500),
  reason text check (char_length(reason) <= 500),
  eye text check (eye in ('OD', 'OS', 'OU', 'unknown')),
  when_kind text check (when_kind in ('year', 'age', 'text')),
  "when" text check (char_length("when") <= 200),
  ongoing text check (ongoing in ('yes', 'no')),
  stop_kind text check (stop_kind in ('year', 'age', 'text')),
  stop_when text check (char_length(stop_when) <= 200),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table if not exists public.systemic_history_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete restrict,
  name text check (char_length(name) <= 500),
  details text check (char_length(details) <= 1000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table if not exists public.family_history_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete restrict,
  member_id uuid not null references public.family_members (id) on delete restrict,
  kind text not null check (kind in ('eye_disease', 'eye_surgery', 'systemic')),
  name text check (char_length(name) <= 500),
  "when" text check (char_length("when") <= 200),
  details text check (char_length(details) <= 1000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

-- ---------- station 2: autorefraction (exact 0.25 D / 5° steps) ----------
create table if not exists public.autorefraction (
  participant_id uuid primary key references public.participants (id) on delete restrict,
  od_sph numeric(5,2) check (od_sph between -20 and 20 and od_sph * 4 = trunc(od_sph * 4)),
  od_cyl numeric(5,2) check (od_cyl between -10 and 10 and od_cyl * 4 = trunc(od_cyl * 4)),
  od_axis smallint check (od_axis between 0 and 180 and od_axis % 5 = 0),
  os_sph numeric(5,2) check (os_sph between -20 and 20 and os_sph * 4 = trunc(os_sph * 4)),
  os_cyl numeric(5,2) check (os_cyl between -10 and 10 and os_cyl * 4 = trunc(os_cyl * 4)),
  os_axis smallint check (os_axis between 0 and 180 and os_axis % 5 = 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

-- ---------- station 3: strabismus + EOM ----------
create table if not exists public.strabismus (
  participant_id uuid primary key references public.participants (id) on delete restrict,
  dist_test text check (dist_test in ('ortho', 'phoria', 'tropia')),
  dist_phoria text check (dist_phoria in ('eso', 'exo', 'hyper', 'hypo', 'other')),
  dist_phoria_other text check (char_length(dist_phoria_other) <= 300),
  dist_pattern text check (dist_pattern in ('alternating', 'unilateral')),
  dist_eye text check (dist_eye in ('OD', 'OS')),
  dist_freq text check (dist_freq in ('intermittent', 'constant')),
  dist_type text check (dist_type in ('eso', 'exo', 'hyper', 'hypo', 'incyclo', 'excyclo', 'other')),
  dist_type_other text check (char_length(dist_type_other) <= 300),
  near_test text check (near_test in ('ortho', 'phoria', 'tropia')),
  near_phoria text check (near_phoria in ('eso', 'exo', 'hyper', 'hypo', 'other')),
  near_phoria_other text check (char_length(near_phoria_other) <= 300),
  near_pattern text check (near_pattern in ('alternating', 'unilateral')),
  near_eye text check (near_eye in ('OD', 'OS')),
  near_freq text check (near_freq in ('intermittent', 'constant')),
  near_type text check (near_type in ('eso', 'exo', 'hyper', 'hypo', 'incyclo', 'excyclo', 'other')),
  near_type_other text check (char_length(near_type_other) <= 300),
  eom_status text check (eom_status in ('full', 'abnormal')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

create table if not exists public.eom_findings (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete restrict,
  eye text not null check (eye in ('OD', 'OS')),
  muscle text not null check (muscle in ('MR', 'LR', 'SR', 'IR', 'SO', 'IO')),
  grade smallint check (grade between -4 and 4),
  note text check (char_length(note) <= 500),
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  constraint eom_findings_unique unique (participant_id, eye, muscle)
);

-- ---------- station 4: visual acuity ----------
create table if not exists public.visual_acuity (
  participant_id uuid primary key references public.participants (id) on delete restrict,
  vasc_od text check (vasc_od is null or public.mfs_va_rank(vasc_od) is not null),
  vasc_os text check (vasc_os is null or public.mfs_va_rank(vasc_os) is not null),
  vasc_ou text check (vasc_ou is null or public.mfs_va_rank(vasc_ou) is not null),
  vacc_od text check (vacc_od is null or public.mfs_va_rank(vacc_od) is not null),
  vacc_os text check (vacc_os is null or public.mfs_va_rank(vacc_os) is not null),
  vacc_ou text check (vacc_ou is null or public.mfs_va_rank(vacc_ou) is not null),
  ph_od text check (ph_od is null or public.mfs_va_rank(ph_od) is not null),
  ph_os text check (ph_os is null or public.mfs_va_rank(ph_os) is not null),
  plus_od text check (plus_od in ('pass', 'fail')),
  plus_os text check (plus_os in ('pass', 'fail')),
  cause text check (cause in ('none', 'amblyopia', 'strabismus', 'refractive', 'retinal', 'cataract', 'other', 'undetermined')),
  ambly_lat text check (ambly_lat in ('one', 'both')),
  ambly_eye text check (ambly_eye in ('OD', 'OS')),
  cause_other text check (char_length(cause_other) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

-- ---------- station 5: questionnaire (stable item ids, never UI numbers) ----------
create table if not exists public.questionnaire_responses (
  participant_id uuid primary key references public.participants (id) on delete restrict,
  questionnaire_version integer not null default 1 check (questionnaire_version >= 1),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1
);

-- ---------- station status: one independent row per station ----------
create table if not exists public.station_status (
  participant_id uuid not null references public.participants (id) on delete restrict,
  station public.station_name not null,
  status public.station_state not null default 'not_started',
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  version integer not null default 1,
  primary key (participant_id, station)
);

-- ---------- audit ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  entity_type text not null,
  entity_id text,
  performed_by uuid,
  performed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
