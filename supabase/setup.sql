-- =====================================================================
-- Myopia Field Screening — Phase 2 — consolidated database setup
-- Generated from supabase/migrations (20261116000001_extensions_types.sql, 20261116000002_tables.sql, 20261116000003_indexes.sql, 20261116000004_functions.sql, 20261116000005_import.sql, 20261116000006_triggers.sql, 20261116000007_grants_rls.sql, 20261116000008_realtime.sql).
-- Run once in the Supabase SQL Editor of a NEW, dedicated project.
-- Safe to re-run: objects are created idempotently.
-- Creates no users, no schools, no participants (no demo data).
-- =====================================================================

-- >>>>> 20261116000001_extensions_types.sql
-- =====================================================================
-- Myopia Field Screening — Phase 2 (online)
-- 001: extensions and enumerated types. Re-runnable.
-- =====================================================================
create extension if not exists pg_trgm with schema extensions;

do $$ begin create type public.app_role as enum ('admin', 'examiner');
exception when duplicate_object then null; end $$;

do $$ begin create type public.school_type as enum ('boys', 'girls');
exception when duplicate_object then null; end $$;

do $$ begin create type public.station_name as enum ('registration', 'autorefraction', 'strabismus_eom', 'visual_acuity', 'questionnaire');
exception when duplicate_object then null; end $$;

do $$ begin create type public.station_state as enum ('not_started', 'in_progress', 'completed');
exception when duplicate_object then null; end $$;

-- Arabic-aware search key: unify alef/yaa/taa-marbuta/hamza forms, drop diacritics and tatweel.
create or replace function public.mfs_normalize_ar(t text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(translate(coalesce(t, ''), 'أإآٱىةؤئ', 'اااايهوي'), '[ً-ْٰـ]', '', 'g'))
$$;

-- VA scale rank: 0 = 6/6 (best) … 11 = NLP; null = Not tested.
create or replace function public.mfs_va_rank(v text) returns int
language sql immutable parallel safe set search_path = '' as $$
  select array_position(array['6/6','6/7.5','6/9','6/12','6/18','6/24','6/36','6/60','CF','HM','LP','NLP']::text[], v) - 1
$$;


-- >>>>> 20261116000002_tables.sql
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


-- >>>>> 20261116000003_indexes.sql
-- =====================================================================
-- 003: indexes. Re-runnable.
-- (schools.number, participants (school_id, seq), participants.code and all
--  station primary keys are already indexed by their unique/primary keys.)
-- =====================================================================
create unique index if not exists profiles_email_lower_key on public.profiles (lower(email));
create index if not exists profiles_role_active_idx on public.profiles (role, active);

create index if not exists schools_archived_number_idx on public.schools (archived, number);

-- participant list per school: active first, ordered by sequence (pagination)
create index if not exists participants_school_archived_seq_idx on public.participants (school_id, archived, seq);
-- Arabic name search (normalised) and code prefix search
create index if not exists participants_name_search_trgm_idx on public.participants using gin (name_search extensions.gin_trgm_ops);
create index if not exists participants_code_pattern_idx on public.participants (code text_pattern_ops);

create index if not exists participant_summary_school_status_idx on public.participant_summary (school_id, status);
create index if not exists participant_summary_school_referral_idx on public.participant_summary (school_id) where referral_alert;

create index if not exists family_members_participant_idx on public.family_members (participant_id);
create index if not exists ocular_history_participant_idx on public.ocular_history_entries (participant_id);
create index if not exists systemic_history_participant_idx on public.systemic_history_entries (participant_id);
create index if not exists family_history_participant_idx on public.family_history_entries (participant_id);
create index if not exists family_history_member_idx on public.family_history_entries (member_id);
create index if not exists eom_findings_participant_idx on public.eom_findings (participant_id);

create index if not exists audit_log_performed_at_idx on public.audit_log (performed_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);


-- >>>>> 20261116000004_functions.sql
-- =====================================================================
-- 004: functions. Re-runnable (create or replace).
-- Every SECURITY DEFINER function pins search_path = '' and checks the
-- caller itself; EXECUTE is granted explicitly in 007_grants_rls.sql.
-- Errors raised for the app use messages 'MFS:<CODE>' (mapped to Arabic
-- in the client); details never contain secrets.
-- =====================================================================

-- ---------- identity helpers (definer: read profiles without RLS recursion) ----------
create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and not p.must_change_password
  )
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and not p.must_change_password and p.role = 'admin'
  )
$$;

create or replace function public.can_read_participant(p_participant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and exists (
    select 1 from public.participants p join public.schools s on s.id = p.school_id
    where p.id = p_participant_id and (public.is_admin() or (not p.archived and not s.archived))
  )
$$;

create or replace function public.can_edit_participant(p_participant_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and exists (
    select 1 from public.participants p join public.schools s on s.id = p.school_id
    where p.id = p_participant_id and not p.archived and not s.archived
  )
$$;

-- ---------- audit (internal; never stores passwords) ----------
create or replace function public.write_audit(p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (action, entity_type, entity_id, performed_by, metadata)
  values (p_action, p_entity_type, p_entity_id, auth.uid(), coalesce(p_metadata, '{}'::jsonb) - 'password' - 'temp_password')
$$;

create or replace function public.mfs_require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'MFS:NOT_ADMIN';
  end if;
end $$;

create or replace function public.mfs_require_active() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_user() then
    raise exception using errcode = '42501', message = 'MFS:INACTIVE';
  end if;
end $$;

-- ---------- derived participant summary (list columns, status, referral) ----------
-- Mirrors the approved client rules exactly:
--   Referral_Refractive_Error: |sphere| or |cylinder| > 1.00 D in either eye
--   Referral_VA: any recorded VA worse than 6/9 (VAsc, VAcc when applicable, Pinhole)
--   Completed only when all five stations are completed
create or replace function public.refresh_participant_summary(p_participant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.registration;
  a public.autorefraction;
  v public.visual_acuity;
  v_re boolean;
  v_va boolean;
  v_vacc boolean;
  v_cur public.station_name;
  v_rows integer;
begin
  select * into r from public.registration where participant_id = p_participant_id;
  select * into a from public.autorefraction where participant_id = p_participant_id;
  select * into v from public.visual_acuity where participant_id = p_participant_id;
  v_re := coalesce(abs(a.od_sph) > 1, false) or coalesce(abs(a.od_cyl) > 1, false)
       or coalesce(abs(a.os_sph) > 1, false) or coalesce(abs(a.os_cyl) > 1, false);
  v_vacc := coalesce(r.glasses in ('yes', 'yes_not_now', 'previously'), false);
  v_va := coalesce(public.mfs_va_rank(v.vasc_od) > 2, false) or coalesce(public.mfs_va_rank(v.vasc_os) > 2, false)
       or coalesce(public.mfs_va_rank(v.vasc_ou) > 2, false)
       or (v_vacc and (coalesce(public.mfs_va_rank(v.vacc_od) > 2, false) or coalesce(public.mfs_va_rank(v.vacc_os) > 2, false)
                       or coalesce(public.mfs_va_rank(v.vacc_ou) > 2, false)))
       or coalesce(public.mfs_va_rank(v.ph_od) > 2, false) or coalesce(public.mfs_va_rank(v.ph_os) > 2, false);
  select count(*) into v_rows from public.station_status where participant_id = p_participant_id;
  select s.station into v_cur from public.station_status s
   where s.participant_id = p_participant_id and s.status <> 'completed'
   order by s.station limit 1;                       -- enum order = workflow order
  if v_cur is null and v_rows < 5 then v_cur := 'registration'; end if;

  insert into public.participant_summary as ps
    (participant_id, school_id, age, gender, class_level, current_station, status, referral_re, referral_va, referral_alert, updated_at)
  select p.id, p.school_id, r.age, r.gender, r.class_level, v_cur,
         case when v_cur is null then 'completed' else 'draft' end,
         v_re, v_va, v_re or v_va, now()
    from public.participants p where p.id = p_participant_id
  on conflict (participant_id) do update set
    school_id = excluded.school_id, age = excluded.age, gender = excluded.gender, class_level = excluded.class_level,
    current_station = excluded.current_station, status = excluded.status, referral_re = excluded.referral_re,
    referral_va = excluded.referral_va, referral_alert = excluded.referral_alert, updated_at = now()
  where (ps.age, ps.gender, ps.class_level, ps.current_station, ps.status, ps.referral_re, ps.referral_va, ps.referral_alert)
        is distinct from
        (excluded.age, excluded.gender, excluded.class_level, excluded.current_station, excluded.status, excluded.referral_re, excluded.referral_va, excluded.referral_alert);
end $$;

-- ---------- trigger functions ----------
-- INSERT: server owns audit columns (an admin import may keep historical timestamps)
create or replace function public.tg_audit_insert() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_import boolean := coalesce(current_setting('mfs.importing', true), '') = 'on';
begin
  if not v_import or new.created_at is null then new.created_at := now(); end if;
  if not v_import or new.updated_at is null then new.updated_at := now(); end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.updated_by := new.created_by;
  if tg_table_name <> 'schools' then new.version := 1; end if;
  return new;
end $$;

-- UPDATE: bump version, stamp updated_*, freeze created_* and the identity columns
-- listed in the trigger arguments (e.g. participant_id) so rows cannot be moved.
create or replace function public.tg_audit_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  col text;
  j_new jsonb := to_jsonb(new);
  j_old jsonb := to_jsonb(old);
begin
  foreach col in array tg_argv loop
    if (j_new -> col) is distinct from (j_old -> col) then
      raise exception using errcode = '42501', message = 'MFS:IMMUTABLE', detail = col;
    end if;
  end loop;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  if tg_table_name <> 'schools' then new.version := old.version + 1; end if;
  return new;
end $$;

-- station status never goes backwards; completion is stamped on the server
create or replace function public.tg_station_status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'completed' then
    new.status := 'completed';
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
    return new;
  end if;
  if new.status = 'completed' then
    if new.completed_at is null or new.completed_at > now() + interval '5 minutes' or new.completed_at < old.created_at then
      new.completed_at := now();
    end if;
    new.completed_by := coalesce(auth.uid(), new.completed_by);
  else
    if new.status = 'not_started' and old.status <> 'not_started' then new.status := old.status; end if;
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end $$;

-- siblings get a unique key per participant even when two devices add one offline
create or replace function public.tg_family_member_key() returns trigger
language plpgsql set search_path = '' as $$
declare v_next integer;
begin
  if new.relation = 'sibling' and exists (select 1 from public.family_members m where m.participant_id = new.participant_id and m.key = new.key) then
    select coalesce(max(substring(m.key from 2)::integer), 0) + 1 into v_next
      from public.family_members m where m.participant_id = new.participant_id and m.key ~ '^S[0-9]+$';
    new.key := 'S' || v_next;
  end if;
  return new;
end $$;

-- a family-history entry must point to a member of the same participant
create or replace function public.tg_family_history_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.family_members m where m.id = new.member_id and m.participant_id = new.participant_id) then
    raise exception using errcode = '23503', message = 'MFS:INVALID_MEMBER';
  end if;
  return new;
end $$;

create or replace function public.tg_refresh_summary() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.refresh_participant_summary(new.participant_id);
  return null;
end $$;

create or replace function public.tg_profiles_updated() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.id := old.id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end $$;

-- ---------- session helpers ----------
create or replace function public.touch_last_access() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_application_access = now() where id = auth.uid() and active
$$;

-- ---------- schools (Administrator) ----------
create or replace function public.create_school(p_name text, p_city text, p_type public.school_type)
returns public.schools language plpgsql security definer set search_path = '' as $$
declare
  v_counter integer;
  v_number integer;
  s public.schools;
begin
  perform public.mfs_require_admin();
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_city), '') = '' or p_type is null then
    raise exception using errcode = '22023', message = 'MFS:VALIDATION', detail = 'name, city and type are required';
  end if;
  insert into public.app_counters (key, value) values ('school_number', 1) on conflict (key) do nothing;
  select value into v_counter from public.app_counters where key = 'school_number' for update;
  select greatest(v_counter, coalesce(max(number), 0) + 1) into v_number from public.schools;
  insert into public.schools (number, name, city, type) values (v_number, btrim(p_name), btrim(p_city), p_type) returning * into s;
  update public.app_counters set value = v_number + 1 where key = 'school_number';
  perform public.write_audit('school.create', 'school', s.id::text, jsonb_build_object('number', s.number, 'name', s.name));
  return s;
end $$;

create or replace function public.update_school(p_school_id uuid, p_name text, p_city text, p_type public.school_type)
returns public.schools language plpgsql security definer set search_path = '' as $$
declare s public.schools;
begin
  perform public.mfs_require_admin();
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_city), '') = '' or p_type is null then
    raise exception using errcode = '22023', message = 'MFS:VALIDATION', detail = 'name, city and type are required';
  end if;
  update public.schools set name = btrim(p_name), city = btrim(p_city), type = p_type where id = p_school_id returning * into s;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  perform public.write_audit('school.update', 'school', s.id::text, jsonb_build_object('number', s.number, 'name', s.name, 'city', s.city, 'type', s.type));
  return s;
end $$;

create or replace function public.set_school_archived(p_school_id uuid, p_archived boolean)
returns public.schools language plpgsql security definer set search_path = '' as $$
declare s public.schools;
begin
  perform public.mfs_require_admin();
  update public.schools
     set archived = p_archived,
         archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then auth.uid() else null end
   where id = p_school_id returning * into s;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  perform public.write_audit(case when p_archived then 'school.archive' else 'school.restore' end, 'school', s.id::text, jsonb_build_object('number', s.number));
  return s;
end $$;

-- ---------- participant counter (Administrator) ----------
create or replace function public.school_counter_info(p_school_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.schools; v_high integer;
begin
  perform public.mfs_require_admin();
  select * into s from public.schools where id = p_school_id;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  select max(seq) into v_high from public.participants where school_id = p_school_id;
  return jsonb_build_object('next', s.next_participant_seq, 'last_assigned', s.last_assigned_seq, 'highest_used', v_high,
    'used_seqs', coalesce((select jsonb_agg(seq order by seq) from public.participants where school_id = p_school_id), '[]'::jsonb));
end $$;

-- Changing the counter never deletes, renumbers or overwrites a participant.
-- As in the approved Phase 1 workflow, the counter may be set to any number
-- (the dialog warns when it is already used); creating a participant with a
-- number that exists in the school — archived included — is then refused by
-- create_participant (MFS:DUPLICATE_ID), so nothing can ever be overwritten.
create or replace function public.set_next_participant_number(p_school_id uuid, p_next integer, p_reset boolean default false)
returns public.schools language plpgsql security definer set search_path = '' as $$
declare s public.schools; v_from integer; v_used boolean;
begin
  perform public.mfs_require_admin();
  if p_next is null or p_next < 1 or p_next > 99999 then
    raise exception using errcode = '22023', message = 'MFS:RANGE';
  end if;
  select * into s from public.schools where id = p_school_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  v_used := exists (select 1 from public.participants where school_id = p_school_id and seq = p_next);
  v_from := s.next_participant_seq;
  update public.schools set next_participant_seq = p_next where id = p_school_id returning * into s;
  perform public.write_audit(case when p_reset then 'participant_counter.reset' else 'participant_counter.set' end, 'school', s.id::text,
    jsonb_build_object('school_number', s.number, 'from', v_from, 'to', p_next, 'number_in_use', v_used));
  return s;
end $$;

-- ---------- participants ----------
-- + إضافة مشارك: lock the school row, take the next sequence, refuse collisions,
-- create the participant and all station rows, advance the counter — one transaction.
-- Two devices pressing at the same moment are serialised by the row lock.
create or replace function public.create_participant(p_school_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.schools;
  v_seq integer;
  v_code text;
  v_pid uuid := gen_random_uuid();
begin
  perform public.mfs_require_active();
  select * into s from public.schools where id = p_school_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  if s.archived then raise exception using errcode = 'P0001', message = 'MFS:ARCHIVED'; end if;
  v_seq := s.next_participant_seq;
  v_code := s.number || '-' || v_seq;
  if exists (select 1 from public.participants where school_id = s.id and seq = v_seq) then
    raise exception using errcode = 'P0001', message = 'MFS:DUPLICATE_ID', detail = v_code;
  end if;
  insert into public.participants (id, school_id, seq, code) values (v_pid, s.id, v_seq, v_code);
  insert into public.registration (participant_id, gender) values (v_pid, case when s.type = 'girls' then 'female' else 'male' end);
  insert into public.family_members (participant_id, relation, key, sex) values
    (v_pid, 'father', 'F', 'male'), (v_pid, 'mother', 'M', 'female'), (v_pid, 'participant', 'P', null);
  insert into public.autorefraction (participant_id) values (v_pid);
  insert into public.strabismus (participant_id) values (v_pid);
  insert into public.visual_acuity (participant_id) values (v_pid);
  insert into public.questionnaire_responses (participant_id, questionnaire_version) values (v_pid, 1);
  insert into public.station_status (participant_id, station)
    select v_pid, st from unnest(enum_range(null::public.station_name)) as st;
  update public.schools set next_participant_seq = least(v_seq + 1, 99999), last_assigned_seq = v_seq where id = s.id;
  perform public.refresh_participant_summary(v_pid);
  perform public.write_audit('participant.create', 'participant', v_pid::text, jsonb_build_object('code', v_code, 'school_number', s.number));
  return (select to_jsonb(p) from public.participants p where p.id = v_pid);
end $$;

-- تعديل رقم المشارك (Administrator): same school, no duplicates, audited
create or replace function public.change_participant_seq(p_participant_id uuid, p_new_seq integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.participants; s public.schools; v_from text; v_to text;
begin
  perform public.mfs_require_admin();
  if p_new_seq is null or p_new_seq < 1 or p_new_seq > 99999 then
    raise exception using errcode = '22023', message = 'MFS:RANGE';
  end if;
  select * into p from public.participants where id = p_participant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  select * into s from public.schools where id = p.school_id for update;
  if p.archived then raise exception using errcode = 'P0001', message = 'MFS:ARCHIVED'; end if;
  v_from := p.code;
  v_to := s.number || '-' || p_new_seq;
  if p_new_seq = p.seq then return to_jsonb(p); end if;
  if exists (select 1 from public.participants where school_id = p.school_id and seq = p_new_seq and id <> p.id) then
    raise exception using errcode = 'P0001', message = 'MFS:DUPLICATE_ID', detail = v_to;
  end if;
  update public.participants set seq = p_new_seq, code = v_to where id = p.id returning * into p;
  perform public.write_audit('participant.change_id', 'participant', p.id::text, jsonb_build_object('from', v_from, 'to', v_to));
  return to_jsonb(p);
end $$;

create or replace function public.set_participant_archived(p_participant_id uuid, p_archived boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.participants;
begin
  perform public.mfs_require_admin();
  update public.participants
     set archived = p_archived,
         archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then auth.uid() else null end
   where id = p_participant_id returning * into p;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  perform public.write_audit(case when p_archived then 'participant.archive' else 'participant.restore' end, 'participant', p.id::text, jsonb_build_object('code', p.code));
  return to_jsonb(p);
end $$;

-- ---------- stations ----------
-- Station status is monotonic (not started -> in progress -> completed). Runs with the
-- caller's rights, so RLS decides whether the participant may be edited.
create or replace function public.touch_station(p_participant_id uuid, p_station public.station_name, p_status public.station_state, p_completed_at timestamptz default null)
returns public.station_status language plpgsql security invoker set search_path = '' as $$
declare rec public.station_status;
begin
  update public.station_status
     set status = p_status, completed_at = case when p_status = 'completed' then p_completed_at else null end
   where participant_id = p_participant_id and station = p_station
  returning * into rec;
  if not found then raise exception using errcode = '42501', message = 'MFS:FORBIDDEN'; end if;
  return rec;
end $$;

-- Questionnaire answers are merged per question key with an optimistic version check.
create or replace function public.patch_questionnaire(p_participant_id uuid, p_expected_version integer, p_set jsonb, p_unset text[])
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare cur public.questionnaire_responses;
begin
  if p_set is not null and jsonb_typeof(p_set) <> 'object' then
    raise exception using errcode = '22023', message = 'MFS:VALIDATION';
  end if;
  select * into cur from public.questionnaire_responses where participant_id = p_participant_id for update;
  if not found then raise exception using errcode = '42501', message = 'MFS:FORBIDDEN'; end if;
  if cur.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'conflict', true, 'current', to_jsonb(cur));
  end if;
  update public.questionnaire_responses
     set answers = (answers - coalesce(p_unset, '{}'::text[])) || coalesce(p_set, '{}'::jsonb)
   where participant_id = p_participant_id
  returning * into cur;
  return jsonb_build_object('ok', true, 'row', to_jsonb(cur));
end $$;

-- ---------- dashboards ----------
create or replace function public.school_stats() returns table (school_id uuid, total integer, draft integer, completed integer, referral integer)
language sql stable security invoker set search_path = '' as $$
  select p.school_id,
         count(*)::integer,
         count(*) filter (where s.status <> 'completed')::integer,
         count(*) filter (where s.status = 'completed')::integer,
         count(*) filter (where s.referral_alert)::integer
    from public.participants p
    join public.participant_summary s on s.participant_id = p.id
   where not p.archived
   group by p.school_id
$$;

-- ---------- users (Administrator) — the last active Administrator is protected ----------
create or replace function public.admin_set_user_role(p_user_id uuid, p_role public.app_role) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare t public.profiles; v_admins integer;
begin
  perform public.mfs_require_admin();
  perform 1 from public.profiles where role = 'admin' and active for update;
  select * into t from public.profiles where id = p_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  if t.role = p_role then return t; end if;
  if t.role = 'admin' and t.active then
    select count(*) into v_admins from public.profiles where role = 'admin' and active;
    if v_admins <= 1 then raise exception using errcode = 'P0001', message = 'MFS:LAST_ADMIN'; end if;
  end if;
  update public.profiles set role = p_role where id = p_user_id returning * into t;
  perform public.write_audit('user.role_change', 'user', t.id::text, jsonb_build_object('email', t.email, 'to', p_role));
  return t;
end $$;

create or replace function public.admin_set_user_active(p_user_id uuid, p_active boolean) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare t public.profiles; v_admins integer;
begin
  perform public.mfs_require_admin();
  perform 1 from public.profiles where role = 'admin' and active for update;
  select * into t from public.profiles where id = p_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  if t.active = p_active then return t; end if;
  if not p_active and t.role = 'admin' then
    select count(*) into v_admins from public.profiles where role = 'admin' and active;
    if v_admins <= 1 then raise exception using errcode = 'P0001', message = 'MFS:LAST_ADMIN'; end if;
  end if;
  update public.profiles set active = p_active where id = p_user_id returning * into t;
  perform public.write_audit(case when p_active then 'user.reactivate' else 'user.disable' end, 'user', t.id::text, jsonb_build_object('email', t.email));
  return t;
end $$;

create or replace function public.admin_update_user_name(p_user_id uuid, p_full_name text) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare t public.profiles;
begin
  perform public.mfs_require_admin();
  if coalesce(btrim(p_full_name), '') = '' then raise exception using errcode = '22023', message = 'MFS:VALIDATION'; end if;
  update public.profiles set full_name = btrim(p_full_name) where id = p_user_id returning * into t;
  if not found then raise exception using errcode = 'P0002', message = 'MFS:NOT_FOUND'; end if;
  perform public.write_audit('user.rename', 'user', t.id::text, jsonb_build_object('email', t.email));
  return t;
end $$;


-- >>>>> 20261116000005_import.sql
-- =====================================================================
-- 005: Administrator import (Phase 1 offline backup, or a Phase 2 full backup).
-- p_payload uses table names as keys and the approved field names inside.
-- Rules: validate, classify, dry run first; existing online records are never
-- overwritten; a school number or participant ID already used by another
-- record is reported as a conflict and skipped; IDs (1-1, 1-2 …) are kept and
-- counters move past them. The whole import is one transaction.
-- =====================================================================
create or replace function public.admin_import(p_payload jsonb, p_dry_run boolean default true, p_source text default 'phase1')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_s jsonb;
  v_p jsonb;
  v_rec jsonb;
  v_tbl text;
  v_sid uuid;
  v_pid uuid;
  v_num integer;
  v_target public.schools;
  v_school_map jsonb := '{}'::jsonb;        -- incoming school id -> 'new' | 'match' | 'skip'
  v_school_number jsonb := '{}'::jsonb;     -- incoming school id -> number (for codes)
  v_new_parts uuid[] := '{}';
  v_conflicts jsonb := '[]'::jsonb;
  v_schools_new integer := 0;
  v_schools_match integer := 0;
  v_parts_existing integer := 0;
  v_singles text[] := array['registration', 'autorefraction', 'strabismus', 'visual_acuity', 'questionnaire_responses'];
  v_manys text[] := array['family_members', 'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'eom_findings'];
  v_defaults jsonb := jsonb_build_object(
    'registration', jsonb_build_object('glasses_reasons', '[]'::jsonb, 'symptoms', '[]'::jsonb, 'blurry_loc', '[]'::jsonb, 'next_sibling_no', 1),
    'family_members', jsonb_build_object('glasses', false, 'sel_disease', false, 'sel_surgery', false, 'sel_systemic', false),
    'eom_findings', jsonb_build_object('selected', true),
    'questionnaire_responses', jsonb_build_object('questionnaire_version', 1, 'answers', '{}'::jsonb));
  v_station public.station_name;
  v_result jsonb;
begin
  perform public.mfs_require_admin();
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(coalesce(p_payload -> 'schools', '[]')) <> 'array'
     or jsonb_typeof(coalesce(p_payload -> 'participants', '[]')) <> 'array' then
    raise exception using errcode = '22023', message = 'MFS:VALIDATION', detail = 'payload must contain schools and participants arrays';
  end if;

  -- ---- pass 1: schools ----
  for v_s in select e from jsonb_array_elements(coalesce(p_payload -> 'schools', '[]')) e loop
    begin
      v_sid := (v_s ->> 'id')::uuid;
      v_num := (v_s ->> 'number')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'MFS:VALIDATION', detail = 'invalid school id/number';
    end;
    if v_num is null or v_num < 1 or coalesce(v_s ->> 'type', '') not in ('boys', 'girls') or coalesce(btrim(v_s ->> 'name'), '') = '' then
      raise exception using errcode = '22023', message = 'MFS:VALIDATION', detail = 'invalid school ' || coalesce(v_num::text, '?');
    end if;
    select * into v_target from public.schools where id = v_sid;
    if found then
      v_school_map := v_school_map || jsonb_build_object(v_sid::text, 'match');
      v_school_number := v_school_number || jsonb_build_object(v_sid::text, v_target.number);
      v_schools_match := v_schools_match + 1;
    elsif exists (select 1 from public.schools where number = v_num) then
      v_school_map := v_school_map || jsonb_build_object(v_sid::text, 'skip');
      v_conflicts := v_conflicts || jsonb_build_object('type', 'school_number', 'school_number', v_num, 'name', v_s ->> 'name');
    else
      v_school_map := v_school_map || jsonb_build_object(v_sid::text, 'new');
      v_school_number := v_school_number || jsonb_build_object(v_sid::text, v_num);
      v_schools_new := v_schools_new + 1;
    end if;
  end loop;

  -- ---- pass 2: participants ----
  for v_p in select e from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]')) e loop
    begin
      v_pid := (v_p ->> 'id')::uuid;
      v_sid := (v_p ->> 'school_id')::uuid;
      v_num := (v_p ->> 'seq')::integer;
    exception when others then
      raise exception using errcode = '22023', message = 'MFS:VALIDATION', detail = 'invalid participant id/school/seq';
    end;
    if v_num is null or v_num < 1 or v_num > 99999 then
      raise exception using errcode = '22023', message = 'MFS:VALIDATION', detail = 'invalid participant sequence';
    end if;
    if coalesce(v_school_map ->> v_sid::text, 'skip') = 'skip' then
      v_conflicts := v_conflicts || jsonb_build_object('type', 'school_skipped', 'code', coalesce(v_p ->> 'code', v_num::text));
    elsif exists (select 1 from public.participants where id = v_pid) then
      v_parts_existing := v_parts_existing + 1;
    elsif exists (select 1 from public.participants where school_id = v_sid and seq = v_num) then
      v_conflicts := v_conflicts || jsonb_build_object('type', 'participant_id', 'code', (v_school_number ->> v_sid::text) || '-' || v_num);
    else
      v_new_parts := v_new_parts || v_pid;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'dry_run', p_dry_run, 'source', p_source,
    'schools_new', v_schools_new, 'schools_matched', v_schools_match,
    'participants_new', coalesce(array_length(v_new_parts, 1), 0),
    'participants_existing', v_parts_existing,
    'conflicts', v_conflicts);
  if p_dry_run then return v_result; end if;

  -- ---- write (one transaction; any constraint failure rolls everything back) ----
  perform set_config('mfs.importing', 'on', true);

  for v_s in select e from jsonb_array_elements(coalesce(p_payload -> 'schools', '[]')) e loop
    if v_school_map ->> (v_s ->> 'id') = 'new' then
      insert into public.schools (id, number, name, city, type, archived, archived_at, created_at, updated_at)
      values ((v_s ->> 'id')::uuid, (v_s ->> 'number')::integer, btrim(v_s ->> 'name'), coalesce(nullif(btrim(v_s ->> 'city'), ''), '—'),
              (v_s ->> 'type')::public.school_type, coalesce((v_s ->> 'archived')::boolean, false),
              case when coalesce((v_s ->> 'archived')::boolean, false) then coalesce((v_s ->> 'archived_at')::timestamptz, now()) end,
              (v_s ->> 'created_at')::timestamptz, (v_s ->> 'updated_at')::timestamptz);
    end if;
  end loop;

  for v_p in select e from jsonb_array_elements(coalesce(p_payload -> 'participants', '[]')) e loop
    v_pid := (v_p ->> 'id')::uuid;
    continue when not (v_pid = any (v_new_parts));
    v_sid := (v_p ->> 'school_id')::uuid;
    insert into public.participants (id, school_id, seq, code, name, archived, archived_at, created_at, updated_at)
    values (v_pid, v_sid, (v_p ->> 'seq')::integer, (v_school_number ->> v_sid::text) || '-' || (v_p ->> 'seq'),
            coalesce(v_p ->> 'name', ''), coalesce((v_p ->> 'archived')::boolean, false),
            case when coalesce((v_p ->> 'archived')::boolean, false) then coalesce((v_p ->> 'archived_at')::timestamptz, now()) end,
            (v_p ->> 'created_at')::timestamptz, (v_p ->> 'updated_at')::timestamptz);

    foreach v_tbl in array v_singles loop
      select e into v_rec from jsonb_array_elements(coalesce(p_payload -> v_tbl, '[]')) e where e ->> 'participant_id' = v_pid::text limit 1;
      v_rec := coalesce(v_defaults -> v_tbl, '{}'::jsonb) || jsonb_strip_nulls(coalesce(v_rec, '{}'::jsonb))
               || jsonb_build_object('participant_id', v_pid, 'version', 1);
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', v_tbl, v_tbl) using v_rec;
    end loop;

    -- father, mother and participant always exist
    foreach v_tbl in array array['F', 'M', 'P'] loop
      if not exists (select 1 from jsonb_array_elements(coalesce(p_payload -> 'family_members', '[]')) e
                     where e ->> 'participant_id' = v_pid::text and e ->> 'key' = v_tbl) then
        insert into public.family_members (participant_id, relation, key, sex)
        values (v_pid, case v_tbl when 'F' then 'father' when 'M' then 'mother' else 'participant' end, v_tbl,
                case v_tbl when 'F' then 'male' when 'M' then 'female' end);
      end if;
    end loop;
    foreach v_tbl in array v_manys loop
      for v_rec in select e from jsonb_array_elements(coalesce(p_payload -> v_tbl, '[]')) e where e ->> 'participant_id' = v_pid::text
                   order by (e ->> 'created_at') nulls first loop
        v_rec := coalesce(v_defaults -> v_tbl, '{}'::jsonb) || jsonb_strip_nulls(v_rec) || jsonb_build_object('version', 1);
        execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', v_tbl, v_tbl) using v_rec;
      end loop;
    end loop;

    for v_station in select unnest(enum_range(null::public.station_name)) loop
      select e into v_rec from jsonb_array_elements(coalesce(p_payload -> 'station_status', '[]')) e
       where e ->> 'participant_id' = v_pid::text and e ->> 'station' = v_station::text limit 1;
      insert into public.station_status (participant_id, station, status, completed_at, created_at, updated_at)
      values (v_pid, v_station, coalesce((v_rec ->> 'status')::public.station_state, 'not_started'),
              case when v_rec ->> 'status' = 'completed' then coalesce((v_rec ->> 'completed_at')::timestamptz, now()) end,
              (v_rec ->> 'created_at')::timestamptz, (v_rec ->> 'updated_at')::timestamptz);
    end loop;
    perform public.refresh_participant_summary(v_pid);
  end loop;

  -- counters move past every imported number; nothing is renumbered
  update public.schools s
     set next_participant_seq = least(99999, greatest(s.next_participant_seq, coalesce((select max(p.seq) + 1 from public.participants p where p.school_id = s.id), 1))),
         last_assigned_seq = coalesce(s.last_assigned_seq, (select max(p.seq) from public.participants p where p.school_id = s.id))
   where s.id in (select (k)::uuid from jsonb_object_keys(v_school_map) k where v_school_map ->> k in ('new', 'match'));
  insert into public.app_counters (key, value) values ('school_number', 1) on conflict (key) do nothing;
  update public.app_counters set value = greatest(value, coalesce((select max(number) + 1 from public.schools), 1)) where key = 'school_number';

  perform public.write_audit('data.import', 'database', null, v_result - 'conflicts' || jsonb_build_object('conflict_count', jsonb_array_length(v_conflicts)));
  return v_result || jsonb_build_object('dry_run', false);
end $$;


-- >>>>> 20261116000006_triggers.sql
-- =====================================================================
-- 006: triggers. Re-runnable (drop if exists + create).
-- Trigger names start with a number: PostgreSQL fires same-event triggers
-- in name order (guards first, then audit/version, then summaries).
-- =====================================================================
do $$
declare
  t text;
  versioned text[] := array['participants', 'registration', 'family_members', 'ocular_history_entries', 'systemic_history_entries',
                            'family_history_entries', 'autorefraction', 'strabismus', 'eom_findings', 'visual_acuity',
                            'questionnaire_responses', 'station_status', 'schools'];
  frozen jsonb := jsonb_build_object(
    'participants', array['id', 'school_id'],
    'registration', array['participant_id'],
    'family_members', array['id', 'participant_id', 'relation', 'key'],
    'ocular_history_entries', array['id', 'participant_id', 'kind'],
    'systemic_history_entries', array['id', 'participant_id'],
    'family_history_entries', array['id', 'participant_id', 'member_id', 'kind'],
    'autorefraction', array['participant_id'],
    'strabismus', array['participant_id'],
    'eom_findings', array['id', 'participant_id', 'eye', 'muscle'],
    'visual_acuity', array['participant_id'],
    'questionnaire_responses', array['participant_id', 'questionnaire_version'],
    'station_status', array['participant_id', 'station'],
    'schools', array['id', 'number']);
  args text;
begin
  foreach t in array versioned loop
    execute format('drop trigger if exists "20_audit_insert" on public.%I', t);
    execute format('create trigger "20_audit_insert" before insert on public.%I for each row execute function public.tg_audit_insert()', t);
    select string_agg(quote_literal(x), ', ') into args from jsonb_array_elements_text(frozen -> t) x;
    execute format('drop trigger if exists "20_audit_update" on public.%I', t);
    execute format('create trigger "20_audit_update" before update on public.%I for each row execute function public.tg_audit_update(%s)', t, args);
  end loop;
end $$;

drop trigger if exists "10_station_status_guard" on public.station_status;
create trigger "10_station_status_guard" before update on public.station_status
  for each row execute function public.tg_station_status_guard();

drop trigger if exists "10_family_member_key" on public.family_members;
create trigger "10_family_member_key" before insert on public.family_members
  for each row execute function public.tg_family_member_key();

drop trigger if exists "10_family_history_member" on public.family_history_entries;
create trigger "10_family_history_member" before insert or update of member_id on public.family_history_entries
  for each row execute function public.tg_family_history_member();

do $$
declare t text;
begin
  foreach t in array array['registration', 'autorefraction', 'visual_acuity', 'station_status'] loop
    execute format('drop trigger if exists "30_refresh_summary" on public.%I', t);
    execute format('create trigger "30_refresh_summary" after insert or update on public.%I for each row execute function public.tg_refresh_summary()', t);
  end loop;
end $$;

drop trigger if exists "20_profiles_updated" on public.profiles;
create trigger "20_profiles_updated" before update on public.profiles
  for each row execute function public.tg_profiles_updated();


-- >>>>> 20261116000007_grants_rls.sql
-- =====================================================================
-- 007: views, privileges and Row Level Security. Re-runnable.
-- Principles
--  * anon gets nothing at all.
--  * authenticated gets only what field screening needs; every row is
--    additionally filtered by RLS (active profile, password changed,
--    not archived unless Administrator).
--  * administrative changes (schools, counters, IDs, archive, users,
--    import) happen only through SECURITY DEFINER functions that check
--    is_admin() themselves; there is no direct write privilege for them.
--  * no DELETE privilege for anyone but the owner: repeatable entries use
--    deleted_at (soft delete); schools/participants use archive.
-- =====================================================================

-- ---------- list view (runs with the caller's rights) ----------
create or replace view public.participant_list with (security_invoker = true) as
  select p.id, p.school_id, p.seq, p.code, p.name, p.name_search, p.archived, p.archived_at, p.updated_at,
         s.age, s.gender, s.class_level, s.current_station, s.status, s.referral_re, s.referral_va, s.referral_alert
    from public.participants p
    join public.participant_summary s on s.participant_id = p.id;

-- ---------- remove Supabase's broad default grants ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- ---------- table privileges for signed-in users ----------
grant select on public.profiles, public.schools, public.participant_summary, public.participant_list, public.audit_log to authenticated;
grant select, update (name) on public.participants to authenticated;
grant select, update on public.registration, public.autorefraction, public.strabismus, public.visual_acuity to authenticated;
grant select, update (answers) on public.questionnaire_responses to authenticated;
grant select, insert, update on public.family_members, public.ocular_history_entries, public.systemic_history_entries,
  public.family_history_entries, public.eom_findings to authenticated;
grant select, update (status, completed_at) on public.station_status to authenticated;

-- server-side Edge Functions use the secret/service key (bypasses RLS)
grant select, insert, update on public.profiles, public.audit_log to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------- function privileges ----------
grant execute on function
  public.is_active_user(), public.is_admin(),
  public.can_read_participant(uuid), public.can_edit_participant(uuid),
  public.mfs_normalize_ar(text), public.mfs_va_rank(text),
  public.touch_last_access(),
  public.create_school(text, text, public.school_type),
  public.update_school(uuid, text, text, public.school_type),
  public.set_school_archived(uuid, boolean),
  public.school_counter_info(uuid),
  public.set_next_participant_number(uuid, integer, boolean),
  public.create_participant(uuid),
  public.change_participant_seq(uuid, integer),
  public.set_participant_archived(uuid, boolean),
  public.touch_station(uuid, public.station_name, public.station_state, timestamptz),
  public.patch_questionnaire(uuid, integer, jsonb, text[]),
  public.school_stats(),
  public.admin_set_user_role(uuid, public.app_role),
  public.admin_set_user_active(uuid, boolean),
  public.admin_update_user_name(uuid, text),
  public.admin_import(jsonb, boolean, text)
to authenticated;
grant execute on function public.is_active_user(), public.is_admin() to service_role;

-- ---------- Row Level Security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'app_counters', 'schools', 'participants', 'participant_summary', 'registration',
    'family_members', 'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'autorefraction',
    'strabismus', 'eom_findings', 'visual_acuity', 'questionnaire_responses', 'station_status', 'audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- helper: (re)create a policy idempotently
create or replace function public.mfs_policy(p_table text, p_name text, p_cmd text, p_using text, p_check text default null)
returns void language plpgsql set search_path = '' as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute format('create policy %I on public.%I for %s to authenticated %s %s', p_name, p_table, p_cmd,
    case when p_using is not null then 'using (' || p_using || ')' else '' end,
    case when p_check is not null then 'with check (' || p_check || ')' else '' end);
end $$;
revoke all on function public.mfs_policy(text, text, text, text, text) from public, anon, authenticated;

do $$ begin perform public.mfs_policy('profiles', 'profiles_select_own_or_admin', 'select', 'id = (select auth.uid()) or (select public.is_admin())'); end $$;
-- app_counters: no policy => no access for signed-in users (definer functions only)
do $$ begin perform public.mfs_policy('schools', 'schools_select_active', 'select', '(select public.is_active_user()) and (not archived or (select public.is_admin()))'); end $$;
do $$ begin perform public.mfs_policy('participants', 'participants_select', 'select', 'public.can_read_participant(id)'); end $$;
do $$ begin perform public.mfs_policy('participants', 'participants_update_name', 'update', 'public.can_edit_participant(id)', 'public.can_edit_participant(id)'); end $$;
do $$ begin perform public.mfs_policy('participant_summary', 'participant_summary_select', 'select', 'public.can_read_participant(participant_id)'); end $$;
do $$ begin perform public.mfs_policy('audit_log', 'audit_log_select_admin', 'select', '(select public.is_admin())'); end $$;

do $$
declare t text;
begin
  foreach t in array array['registration', 'autorefraction', 'strabismus', 'visual_acuity', 'questionnaire_responses', 'station_status',
                           'family_members', 'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'eom_findings'] loop
    perform public.mfs_policy(t, t || '_select', 'select', 'public.can_read_participant(participant_id)');
    perform public.mfs_policy(t, t || '_update', 'update', 'public.can_edit_participant(participant_id)', 'public.can_edit_participant(participant_id)');
  end loop;
  foreach t in array array['ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'eom_findings'] loop
    perform public.mfs_policy(t, t || '_insert', 'insert', null, 'public.can_edit_participant(participant_id)');
  end loop;
end $$;
-- only siblings are added from the app; father/mother/participant are created with the participant
do $$ begin perform public.mfs_policy('family_members', 'family_members_insert', 'insert', null, 'public.can_edit_participant(participant_id) and relation = ''sibling'''); end $$;

-- the helper is only needed while this file runs
drop function if exists public.mfs_policy(text, text, text, text, text);


-- >>>>> 20261116000008_realtime.sql
-- =====================================================================
-- 008: Realtime (Postgres Changes). Re-runnable.
-- Chosen approach: Postgres Changes on the supabase_realtime publication.
-- Realtime evaluates each change against the subscriber's RLS policies, so a
-- device only receives rows it is allowed to SELECT (disabled users and
-- anonymous connections receive nothing). Clients subscribe narrowly:
-- one school's participants/summary on the school page, one participant's
-- station tables on the working form, schools on the home page.
-- =====================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['schools', 'participants', 'participant_summary', 'registration', 'family_members',
    'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'autorefraction', 'strabismus',
    'eom_findings', 'visual_acuity', 'questionnaire_responses', 'station_status'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
