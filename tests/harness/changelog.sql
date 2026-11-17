-- TEST-ONLY: records row changes so the local test server can emulate
-- Supabase Realtime (Postgres Changes). Never install this in Supabase.
create schema if not exists _test;
create table if not exists _test.changes (id bigserial primary key, tbl text not null, op text not null, row_data jsonb not null, at timestamptz not null default now());
create or replace function _test.capture() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into _test.changes (tbl, op, row_data) values (TG_TABLE_NAME, TG_OP, to_jsonb(NEW));
  return NEW;
end $$;
do $$
declare t text;
begin
  foreach t in array array['schools', 'participants', 'participant_summary', 'registration', 'family_members',
    'ocular_history_entries', 'systemic_history_entries', 'family_history_entries', 'autorefraction', 'strabismus',
    'eom_findings', 'visual_acuity', 'questionnaire_responses', 'station_status'] loop
    execute format('drop trigger if exists "99_test_capture" on public.%I', t);
    execute format('create trigger "99_test_capture" after insert or update on public.%I for each row execute function _test.capture()', t);
  end loop;
end $$;
