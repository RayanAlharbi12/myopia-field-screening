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
