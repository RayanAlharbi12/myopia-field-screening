// =====================================================================
// The four account functions. Each is exposed as its own Edge Function
// (see ../<name>/index.ts); the logic lives here so it can be tested.
//
//   admin-create-user          Administrator creates an account
//   admin-reset-user-password  Administrator sets a new temporary password
//   admin-user-status          Administrator disables / reactivates an account
//   change-password            any active user changes their own password
// =====================================================================
import {
  anonClient, audit, callerClient, checkPassword, dbError, Deps, EMAIL_RE, HttpError, rateLimit,
  readJson, requireAdmin, serve, serviceClient, str, UUID_RE, verifyCaller,
} from './core.ts';

const PROFILE_COLS = 'id, email, full_name, role, active, must_change_password, created_at, updated_at, created_by, last_application_access';
const BAN_FOREVER = '876000h'; // ~100 years; "none" lifts it

function isDuplicateEmail(err: { code?: string; status?: number; message?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return err.code === 'email_exists' || err.code === 'user_already_exists' || err.status === 422 && msg.includes('already') || msg.includes('already been registered');
}
function isWeakPassword(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === 'weak_password' || /password/i.test(err.message || '') && /(weak|short|least)/i.test(err.message || ''));
}

// ---------- admin-create-user ----------
export function adminCreateUser(deps: Deps) {
  return serve(deps, async (req, cfg) => {
    const svc = serviceClient(deps, cfg);
    const caller = await verifyCaller(req, svc);
    requireAdmin(caller);
    const body = await readJson(req);
    const email = str(body.email).trim().toLowerCase();
    const fullName = str(body.full_name).trim();
    const role = str(body.role);
    const password = str(body.password);
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'INVALID_EMAIL');
    if (!fullName || fullName.length > 120) throw new HttpError(400, 'INVALID_NAME');
    if (role !== 'admin' && role !== 'examiner') throw new HttpError(400, 'INVALID_ROLE');
    checkPassword(password, email);
    await rateLimit(svc, caller.userId, ['user.create'], 10, 30);

    const { data: existing, error: exErr } = await svc.from('profiles').select('id').eq('email', email).maybeSingle();
    if (exErr) throw new HttpError(500, 'SERVER_ERROR');
    if (existing) throw new HttpError(409, 'EMAIL_EXISTS');

    const { data: created, error: cErr } = await svc.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (cErr || !created || !created.user) {
      if (isDuplicateEmail(cErr)) throw new HttpError(409, 'EMAIL_EXISTS');
      if (isWeakPassword(cErr)) throw new HttpError(400, 'WEAK_PASSWORD');
      throw new HttpError(500, 'AUTH_CREATE_FAILED');
    }
    const uid = created.user.id;
    const { data: profile, error: pErr } = await svc.from('profiles').insert({
      id: uid, email, full_name: fullName, role, active: true, must_change_password: true, created_by: caller.userId,
    }).select(PROFILE_COLS).single();
    if (pErr || !profile) {
      // keep Auth and profiles consistent: remove the half-created account
      await svc.auth.admin.deleteUser(uid);
      throw new HttpError(500, 'PROFILE_CREATE_FAILED');
    }
    await audit(svc, caller.userId, 'user.create', uid, { email, role });
    return { user: profile };
  });
}

// ---------- admin-reset-user-password ----------
export function adminResetUserPassword(deps: Deps) {
  return serve(deps, async (req, cfg) => {
    const svc = serviceClient(deps, cfg);
    const caller = await verifyCaller(req, svc);
    requireAdmin(caller);
    const body = await readJson(req);
    const userId = str(body.user_id);
    const password = str(body.password);
    if (!UUID_RE.test(userId)) throw new HttpError(400, 'BAD_REQUEST');
    const { data: target, error: tErr } = await svc.from('profiles').select('id, email').eq('id', userId).maybeSingle();
    if (tErr) throw new HttpError(500, 'SERVER_ERROR');
    if (!target) throw new HttpError(404, 'NOT_FOUND');
    checkPassword(password, target.email);
    await rateLimit(svc, caller.userId, ['user.password_reset'], 10, 30);

    const { error: uErr } = await svc.auth.admin.updateUserById(userId, { password });
    if (uErr) {
      if (isWeakPassword(uErr)) throw new HttpError(400, 'WEAK_PASSWORD');
      throw new HttpError(500, 'AUTH_UPDATE_FAILED');
    }
    const { data: profile, error: pErr } = await svc.from('profiles').update({ must_change_password: true })
      .eq('id', userId).select(PROFILE_COLS).single();
    if (pErr) throw new HttpError(500, 'SERVER_ERROR');
    await audit(svc, caller.userId, 'user.password_reset', userId, { email: target.email });
    return { user: profile };
  });
}

// ---------- admin-user-status ----------
export function adminUserStatus(deps: Deps) {
  return serve(deps, async (req, cfg) => {
    const svc = serviceClient(deps, cfg);
    const caller = await verifyCaller(req, svc);
    requireAdmin(caller);
    const body = await readJson(req);
    const userId = str(body.user_id);
    const active = body.active;
    if (!UUID_RE.test(userId) || typeof active !== 'boolean') throw new HttpError(400, 'BAD_REQUEST');

    // the database function checks Administrator rights and protects the last Administrator,
    // and runs as the caller (not with the secret key)
    const asCaller = callerClient(deps, cfg, caller.token);
    const { data: profile, error } = await asCaller.rpc('admin_set_user_active', { p_user_id: userId, p_active: active });
    if (error) throw dbError(error);

    // end (or allow again) the person's sign-in sessions in Supabase Auth
    const { error: bErr } = await svc.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : BAN_FOREVER });
    if (bErr) return { user: profile, warning: 'SESSIONS_NOT_UPDATED' };
    return { user: profile };
  });
}

// ---------- change-password ----------
export function changePassword(deps: Deps) {
  return serve(deps, async (req, cfg) => {
    const svc = serviceClient(deps, cfg);
    const caller = await verifyCaller(req, svc); // active accounts only; must_change_password is allowed here
    const body = await readJson(req);
    const current = str(body.current_password);
    const next = str(body.new_password);
    if (!current) throw new HttpError(400, 'CURRENT_PASSWORD_REQUIRED');
    if (current === next) throw new HttpError(400, 'SAME_PASSWORD');
    checkPassword(next, caller.email);
    await rateLimit(svc, caller.userId, ['user.password_change_failed'], 15, 5);

    // confirm the current password with a throw-away sign-in, then end that extra session
    const probe = anonClient(deps, cfg);
    const { data: signIn, error: sErr } = await probe.auth.signInWithPassword({ email: caller.email, password: current });
    if (sErr || !signIn || !signIn.user || signIn.user.id !== caller.userId) {
      await audit(svc, caller.userId, 'user.password_change_failed', caller.userId, {});
      throw new HttpError(400, 'WRONG_PASSWORD');
    }
    try { await probe.auth.signOut({ scope: 'local' }); } catch (_) { /* the probe session expires on its own */ }

    const { error: uErr } = await svc.auth.admin.updateUserById(caller.userId, { password: next });
    if (uErr) {
      if (isWeakPassword(uErr)) throw new HttpError(400, 'WEAK_PASSWORD');
      throw new HttpError(500, 'AUTH_UPDATE_FAILED');
    }
    const { data: profile, error: pErr } = await svc.from('profiles').update({ must_change_password: false })
      .eq('id', caller.userId).select(PROFILE_COLS).single();
    if (pErr) throw new HttpError(500, 'SERVER_ERROR');
    await audit(svc, caller.userId, 'user.password_change', caller.userId, {});
    return { user: profile };
  });
}

export const HANDLERS: Record<string, (deps: Deps) => (req: Request) => Promise<Response>> = {
  'admin-create-user': adminCreateUser,
  'admin-reset-user-password': adminResetUserPassword,
  'admin-user-status': adminUserStatus,
  'change-password': changePassword,
};
