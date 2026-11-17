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
