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
