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
