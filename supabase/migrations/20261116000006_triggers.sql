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
