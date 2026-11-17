-- =====================================================================
-- Security / RLS test suite — Myopia Field Screening Phase 2
-- Run in the Supabase SQL Editor (or psql as postgres) AFTER setup.sql.
-- Everything runs inside one transaction that is ROLLED BACK at the end:
-- the temporary test users, school and participants never persist.
-- Result: a table of checks; the last row says "ALL PASSED" or lists failures.
-- =====================================================================
begin;

create temp table rls_results (n serial, name text, ok boolean, detail text) on commit drop;
grant all on rls_results to public;
grant all on sequence rls_results_n_seq to public;

-- check(name, user (null = anonymous), sql, expectation)
--   'ok'       statement succeeds          'deny'     statement raises an error
--   'rows>0'   query returns rows          'rows=0'   query returns no rows
--   'affects>0' / 'affects=0'              rows changed by an UPDATE/INSERT
create function pg_temp.chk(p_name text, p_uid uuid, p_sql text, p_expect text) returns void
language plpgsql as $$
declare v_n bigint; v_ok boolean; v_detail text;
begin
  begin
    perform set_config('request.jwt.claims',
      case when p_uid is null then '{"role":"anon"}' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
    execute case when p_uid is null then 'set local role anon' else 'set local role authenticated' end;
    if p_expect in ('rows>0', 'rows=0') then
      execute 'select count(*) from (' || p_sql || ') q' into v_n;
      v_ok := case p_expect when 'rows>0' then v_n > 0 else v_n = 0 end;
      v_detail := 'rows=' || v_n;
    else
      execute p_sql;
      get diagnostics v_n = row_count;
      v_ok := case p_expect when 'ok' then true when 'deny' then false when 'affects>0' then v_n > 0 when 'affects=0' then v_n = 0 end;
      v_detail := 'affected=' || v_n;
    end if;
    execute 'reset role';
  exception when others then
    v_ok := (p_expect in ('deny', 'affects=0', 'rows=0'));
    v_detail := sqlstate || ' ' || sqlerrm;
  end;
  insert into rls_results (name, ok, detail) values (p_name, v_ok, v_detail);
end $$;

-- ---------- fixtures (rolled back) ----------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'rls-admin@test.invalid'),
  ('00000000-0000-4000-8000-00000000a002', 'rls-admin2@test.invalid'),
  ('00000000-0000-4000-8000-00000000e001', 'rls-examiner@test.invalid'),
  ('00000000-0000-4000-8000-00000000e002', 'rls-disabled@test.invalid'),
  ('00000000-0000-4000-8000-00000000e003', 'rls-mustchange@test.invalid');
insert into public.profiles (id, email, full_name, role, active, must_change_password) values
  ('00000000-0000-4000-8000-00000000a001', 'rls-admin@test.invalid', 'RLS Admin', 'admin', true, false),
  ('00000000-0000-4000-8000-00000000a002', 'rls-admin2@test.invalid', 'RLS Admin 2', 'admin', false, false),
  ('00000000-0000-4000-8000-00000000e001', 'rls-examiner@test.invalid', 'RLS Examiner', 'examiner', true, false),
  ('00000000-0000-4000-8000-00000000e002', 'rls-disabled@test.invalid', 'RLS Disabled', 'examiner', false, false),
  ('00000000-0000-4000-8000-00000000e003', 'rls-mustchange@test.invalid', 'RLS MustChange', 'examiner', true, true);

-- Inside this (rolled back) transaction only: set aside any real Administrators so the
-- "last active Administrator" checks below are deterministic. Nothing is kept.
update public.profiles set active = false where id not in (
  '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-00000000e001',
  '00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000e003');

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to public;

-- admin creates two schools and one participant in each (through the real functions)
do $$
declare s1 public.schools; s2 public.schools; p jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true);
  set local role authenticated;
  s1 := public.create_school('RLS School One', 'City', 'boys');
  s2 := public.create_school('RLS School Two', 'City', 'girls');
  p := public.create_participant(s1.id);
  reset role;
  insert into ids values ('s1', s1.id), ('s2', s2.id), ('p1', (p ->> 'id')::uuid);
end $$;

-- ---------- 1. anonymous ----------
select pg_temp.chk('anon: cannot read schools', null, 'select * from public.schools', 'deny');
select pg_temp.chk('anon: cannot read participants (names)', null, 'select * from public.participants', 'deny');
select pg_temp.chk('anon: cannot read clinical results', null, 'select * from public.autorefraction', 'deny');
select pg_temp.chk('anon: cannot read questionnaire answers', null, 'select * from public.questionnaire_responses', 'deny');
select pg_temp.chk('anon: cannot read profiles', null, 'select * from public.profiles', 'deny');
select pg_temp.chk('anon: cannot create participant', null, format('select public.create_participant(%L)', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('anon: cannot modify anything', null, format('update public.registration set age = 9 where participant_id = %L', (select v from ids where k = 'p1')), 'deny');

-- ---------- 2. examiner reads ----------
select pg_temp.chk('examiner: can read active schools', '00000000-0000-4000-8000-00000000e001', 'select * from public.schools', 'rows>0');
select pg_temp.chk('examiner: can read active participants', '00000000-0000-4000-8000-00000000e001', 'select * from public.participant_list', 'rows>0');
select pg_temp.chk('examiner: sees only own profile', '00000000-0000-4000-8000-00000000e001', 'select * from public.profiles where id <> ''00000000-0000-4000-8000-00000000e001''', 'rows=0');
select pg_temp.chk('examiner: cannot read audit log', '00000000-0000-4000-8000-00000000e001', 'select * from public.audit_log', 'rows=0');

-- ---------- 3. examiner creates a participant through the approved function ----------
select pg_temp.chk('examiner: can create participant (create_participant)', '00000000-0000-4000-8000-00000000e001',
  format('select public.create_participant(%L)', (select v from ids where k = 's1')), 'ok');
select pg_temp.chk('examiner: cannot insert participants directly', '00000000-0000-4000-8000-00000000e001',
  format('insert into public.participants (school_id, seq, code) values (%L, 500, ''1-500'')', (select v from ids where k = 's1')), 'deny');

-- ---------- 4. examiner edits clinical stations ----------
select pg_temp.chk('examiner: can update autorefraction', '00000000-0000-4000-8000-00000000e001',
  format('update public.autorefraction set od_sph = -1.25 where participant_id = %L', (select v from ids where k = 'p1')), 'affects>0');
select pg_temp.chk('server: version bumped and referral computed', '00000000-0000-4000-8000-00000000a001',
  format('select 1 from public.autorefraction a join public.participant_summary s using (participant_id) where a.participant_id = %L and a.version = 2 and a.updated_by = ''00000000-0000-4000-8000-00000000e001'' and s.referral_re and s.referral_alert', (select v from ids where k = 'p1')), 'rows>0');
select pg_temp.chk('examiner: can update questionnaire (patch_questionnaire)', '00000000-0000-4000-8000-00000000e001',
  format('select public.patch_questionnaire(%L, 1, ''{"b1_days":5}''::jsonb, null)', (select v from ids where k = 'p1')), 'ok');
select pg_temp.chk('examiner: stale questionnaire version is reported as conflict', '00000000-0000-4000-8000-00000000e001',
  format('select 1 where (public.patch_questionnaire(%L, 1, ''{"b1_days":6}''::jsonb, null) ->> ''conflict'')::boolean', (select v from ids where k = 'p1')), 'rows>0');
select pg_temp.chk('examiner: can add a history entry', '00000000-0000-4000-8000-00000000e001',
  format('insert into public.ocular_history_entries (participant_id, kind, name) values (%L, ''surgery'', ''test'')', (select v from ids where k = 'p1')), 'affects>0');
select pg_temp.chk('examiner: refraction must be on 0.25 D steps', '00000000-0000-4000-8000-00000000e001',
  format('update public.autorefraction set od_sph = -1.32 where participant_id = %L', (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('examiner: cannot move a record to another participant', '00000000-0000-4000-8000-00000000e001',
  format('update public.registration set participant_id = gen_random_uuid() where participant_id = %L', (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('examiner: cannot delete records', '00000000-0000-4000-8000-00000000e001',
  format('delete from public.registration where participant_id = %L', (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('examiner: cannot add father/mother rows', '00000000-0000-4000-8000-00000000e001',
  format('insert into public.family_members (participant_id, relation, key) values (%L, ''father'', ''S9'')', (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('examiner: station status never goes backwards', '00000000-0000-4000-8000-00000000e001',
  format('select 1 from public.touch_station(%L, ''autorefraction'', ''in_progress'') where status = ''in_progress''', (select v from ids where k = 'p1')), 'rows>0');

-- ---------- 5-8. examiner cannot do administrative actions ----------
select pg_temp.chk('examiner: cannot alter participant counter', '00000000-0000-4000-8000-00000000e001',
  format('select public.set_next_participant_number(%L, 50)', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('examiner: cannot alter counter column directly', '00000000-0000-4000-8000-00000000e001',
  format('update public.schools set next_participant_seq = 50 where id = %L', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('examiner: cannot read counter details', '00000000-0000-4000-8000-00000000e001',
  format('select public.school_counter_info(%L)', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('examiner: cannot edit Participant ID (function)', '00000000-0000-4000-8000-00000000e001',
  format('select public.change_participant_seq(%L, 77)', (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('examiner: cannot edit Participant ID (direct)', '00000000-0000-4000-8000-00000000e001',
  format('update public.participants set seq = 77, code = ''1-77'' where id = %L', (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('examiner: cannot archive school', '00000000-0000-4000-8000-00000000e001',
  format('select public.set_school_archived(%L, true)', (select v from ids where k = 's2')), 'deny');
select pg_temp.chk('examiner: cannot archive participant', '00000000-0000-4000-8000-00000000e001',
  format('select public.set_participant_archived(%L, true)', (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('examiner: cannot create school', '00000000-0000-4000-8000-00000000e001',
  'select public.create_school(''x'', ''y'', ''boys'')', 'deny');
select pg_temp.chk('examiner: cannot change user roles', '00000000-0000-4000-8000-00000000e001',
  'select public.admin_set_user_role(''00000000-0000-4000-8000-00000000e001'', ''admin'')', 'deny');
select pg_temp.chk('examiner: cannot promote self by direct update', '00000000-0000-4000-8000-00000000e001',
  'update public.profiles set role = ''admin'' where id = ''00000000-0000-4000-8000-00000000e001''', 'deny');
select pg_temp.chk('examiner: cannot disable users', '00000000-0000-4000-8000-00000000e001',
  'select public.admin_set_user_active(''00000000-0000-4000-8000-00000000a001'', false)', 'deny');
select pg_temp.chk('examiner: cannot create profiles', '00000000-0000-4000-8000-00000000e001',
  'insert into public.profiles (id, email, full_name, role) values (gen_random_uuid(), ''x@x.x'', ''x'', ''admin'')', 'deny');
select pg_temp.chk('examiner: cannot import data', '00000000-0000-4000-8000-00000000e001',
  'select public.admin_import(''{"schools":[],"participants":[]}''::jsonb, true, ''test'')', 'deny');

-- ---------- 9. administrator ----------
select pg_temp.chk('admin: can read counter details', '00000000-0000-4000-8000-00000000a001',
  format('select public.school_counter_info(%L)', (select v from ids where k = 's1')), 'ok');
select pg_temp.chk('admin: counter may point at a used number (approved Phase 1 behaviour: warning)', '00000000-0000-4000-8000-00000000a001',
  format('select public.set_next_participant_number(%L, 1)', (select v from ids where k = 's1')), 'ok');
select pg_temp.chk('…but creating a participant with it is refused (no overwrite)', '00000000-0000-4000-8000-00000000e001',
  format('select public.create_participant(%L)', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('…and the existing participant 1 is unchanged', '00000000-0000-4000-8000-00000000a001',
  format('select 1 from public.participants where id = %L and seq = 1', (select v from ids where k = 'p1')), 'rows>0');
select pg_temp.chk('admin: can set the next number', '00000000-0000-4000-8000-00000000a001',
  format('select public.set_next_participant_number(%L, 40)', (select v from ids where k = 's1')), 'ok');
select pg_temp.chk('admin: can edit Participant ID', '00000000-0000-4000-8000-00000000a001',
  format('select public.change_participant_seq(%L, 30)', (select v from ids where k = 'p1')), 'ok');
select pg_temp.chk('admin: duplicate Participant ID refused', '00000000-0000-4000-8000-00000000a001',
  format('select public.change_participant_seq((select id from public.participants where school_id = %L and id <> %L order by seq limit 1), 30)',
         (select v from ids where k = 's1'), (select v from ids where k = 'p1')), 'deny');
select pg_temp.chk('admin: can archive participant', '00000000-0000-4000-8000-00000000a001',
  format('select public.set_participant_archived(%L, true)', (select v from ids where k = 'p1')), 'ok');
select pg_temp.chk('examiner: archived participant hidden', '00000000-0000-4000-8000-00000000e001',
  format('select * from public.participants where id = %L', (select v from ids where k = 'p1')), 'rows=0');
select pg_temp.chk('examiner: archived participant not editable', '00000000-0000-4000-8000-00000000e001',
  format('update public.visual_acuity set vasc_od = ''6/6'' where participant_id = %L', (select v from ids where k = 'p1')), 'affects=0');
select pg_temp.chk('admin: still sees archived participant', '00000000-0000-4000-8000-00000000a001',
  format('select * from public.participants where id = %L', (select v from ids where k = 'p1')), 'rows>0');
select pg_temp.chk('admin: archived ID is never reused (counter set to it, creation refused)', '00000000-0000-4000-8000-00000000a001',
  format('select public.set_next_participant_number(%L, 30); select public.create_participant(%L)', (select v from ids where k = 's1'), (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('admin: can restore participant', '00000000-0000-4000-8000-00000000a001',
  format('select public.set_participant_archived(%L, false)', (select v from ids where k = 'p1')), 'ok');
select pg_temp.chk('admin: can archive school', '00000000-0000-4000-8000-00000000a001',
  format('select public.set_school_archived(%L, true)', (select v from ids where k = 's2')), 'ok');
select pg_temp.chk('examiner: archived school hidden', '00000000-0000-4000-8000-00000000e001',
  format('select * from public.schools where id = %L', (select v from ids where k = 's2')), 'rows=0');
select pg_temp.chk('admin: can restore school', '00000000-0000-4000-8000-00000000a001',
  format('select public.set_school_archived(%L, false)', (select v from ids where k = 's2')), 'ok');
select pg_temp.chk('admin: can change a user role', '00000000-0000-4000-8000-00000000a001',
  'select public.admin_set_user_role(''00000000-0000-4000-8000-00000000e003'', ''admin'')', 'ok');
select pg_temp.chk('admin: can change it back', '00000000-0000-4000-8000-00000000a001',
  'select public.admin_set_user_role(''00000000-0000-4000-8000-00000000e003'', ''examiner'')', 'ok');
select pg_temp.chk('admin: role change is audited', '00000000-0000-4000-8000-00000000a001',
  'select 1 from public.audit_log where action = ''user.role_change'' and entity_id = ''00000000-0000-4000-8000-00000000e003''', 'rows>0');
select pg_temp.chk('admin: can read audit log', '00000000-0000-4000-8000-00000000a001', 'select * from public.audit_log', 'rows>0');
select pg_temp.chk('admin: import dry run', '00000000-0000-4000-8000-00000000a001',
  'select public.admin_import(''{"schools":[],"participants":[]}''::jsonb, true, ''test'')', 'ok');
select pg_temp.chk('admin: last active admin cannot be demoted', '00000000-0000-4000-8000-00000000a001',
  'select public.admin_set_user_role(''00000000-0000-4000-8000-00000000a001'', ''examiner'')', 'deny');
select pg_temp.chk('admin: last active admin cannot be disabled', '00000000-0000-4000-8000-00000000a001',
  'select public.admin_set_user_active(''00000000-0000-4000-8000-00000000a001'', false)', 'deny');

-- ---------- 10. disabled / password-change-pending users ----------
select pg_temp.chk('disabled: cannot read schools', '00000000-0000-4000-8000-00000000e002', 'select * from public.schools', 'rows=0');
select pg_temp.chk('disabled: cannot read research records', '00000000-0000-4000-8000-00000000e002', 'select * from public.registration', 'rows=0');
select pg_temp.chk('disabled: cannot edit research records', '00000000-0000-4000-8000-00000000e002',
  format('update public.registration set age = 10 where participant_id = %L', (select v from ids where k = 'p1')), 'affects=0');
select pg_temp.chk('disabled: cannot create participants', '00000000-0000-4000-8000-00000000e002',
  format('select public.create_participant(%L)', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('disabled: can still read own profile (to see the disabled message)', '00000000-0000-4000-8000-00000000e002',
  'select * from public.profiles where id = ''00000000-0000-4000-8000-00000000e002''', 'rows>0');
select pg_temp.chk('must-change-password: no research access yet', '00000000-0000-4000-8000-00000000e003', 'select * from public.schools', 'rows=0');
select pg_temp.chk('must-change-password: cannot create participants yet', '00000000-0000-4000-8000-00000000e003',
  format('select public.create_participant(%L)', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('disabled administrator: cannot use administrator functions', '00000000-0000-4000-8000-00000000a002',
  format('select public.set_school_archived(%L, true)', (select v from ids where k = 's1')), 'deny');
select pg_temp.chk('disabled administrator: cannot read other profiles', '00000000-0000-4000-8000-00000000a002',
  'select * from public.profiles where id <> ''00000000-0000-4000-8000-00000000a002''', 'rows=0');
select pg_temp.chk('authenticated without a profile: no access', '00000000-0000-4000-8000-0000000000ff', 'select * from public.schools', 'rows=0');

-- ---------- summary ----------
select n, case when ok then 'PASS' else 'FAIL' end as result, name, detail from rls_results order by n;
select case when bool_and(ok) then 'ALL PASSED (' || count(*) || ' checks)' else 'FAILED: ' || string_agg(name, '; ') filter (where not ok) end as summary
  from rls_results;

rollback;
