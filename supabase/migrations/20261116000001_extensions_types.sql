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
