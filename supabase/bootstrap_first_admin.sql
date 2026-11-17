-- =====================================================================
-- One-time: make the first Administrator.
--
-- Before running this:
--   1. Supabase Dashboard → Authentication → Users → "Add user" → "Create new user".
--      Enter the administrator's email and a strong password and tick
--      "Auto Confirm User". (The password is typed only there; it is never
--      written in this file or anywhere in the application.)
--   2. Replace the email below with that same address.
--   3. Run this whole file once in Dashboard → SQL Editor.
--
-- It refuses to run when an active Administrator already exists, so it
-- cannot be used later to give someone administrator rights behind the
-- application's back. Further users are created from the application
-- (إدارة المستخدمين).
-- =====================================================================
do $$
declare
  v_email text := 'Rayan.m.alharbi1@gmail.com';   -- ← the administrator's email
  v_name  text := 'Rayan';                  -- ← shown in the application; can be changed later
  v_user  auth.users;
begin
  if v_email = 'REPLACE_WITH_ADMIN_EMAIL' or position('@' in v_email) = 0 then
    raise exception 'Edit v_email at the top of this file first.';
  end if;
  if exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'An active Administrator already exists. Create further users from the application (إدارة المستخدمين).';
  end if;
  select * into v_user from auth.users where lower(email) = lower(btrim(v_email));
  if not found then
    raise exception 'No Supabase Auth user with email %. Create it first in Authentication → Users.', v_email;
  end if;

  insert into public.profiles (id, email, full_name, role, active, must_change_password, created_by)
  values (v_user.id, lower(v_user.email), v_name, 'admin', true, false, null)
  on conflict (id) do update
     set role = 'admin', active = true, must_change_password = false, full_name = excluded.full_name;

  insert into public.audit_log (action, entity_type, entity_id, performed_by, metadata)
  values ('user.bootstrap_admin', 'user', v_user.id::text, null, jsonb_build_object('email', lower(v_user.email)));

  raise notice 'Administrator ready: %', lower(v_user.email);
end $$;
