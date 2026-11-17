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
