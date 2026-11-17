// =====================================================================
// Shared server-side helpers for the Edge Functions.
// Runs only on Supabase (Deno). The secret / service-role key is read
// from the function environment and never leaves the server.
// Nothing here logs passwords, tokens or keys.
// =====================================================================

// deno-lint-ignore no-explicit-any
export type AnyClient = any;
export type CreateClient = (url: string, key: string, options?: Record<string, unknown>) => AnyClient;
export interface Deps {
  env: (name: string) => string | undefined;
  createClient: CreateClient;
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// ---------- configuration ----------
function pickKey(json: string | undefined, legacy: string | undefined): string | undefined {
  if (json) {
    try {
      const dict = JSON.parse(json);
      if (dict && typeof dict === 'object') {
        if (typeof dict.default === 'string' && dict.default) return dict.default;
        const first = Object.values(dict).find((v) => typeof v === 'string' && v);
        if (typeof first === 'string') return first;
      }
    } catch (_) { /* fall through to the legacy variable */ }
  }
  return legacy || undefined;
}

export interface Config {
  url: string;
  secretKey: string;
  publishableKey: string;
  allowedOrigins: string[];
}

export function readConfig(deps: Deps): Config {
  const url = deps.env('SUPABASE_URL');
  const secretKey = pickKey(deps.env('SUPABASE_SECRET_KEYS'), deps.env('SUPABASE_SERVICE_ROLE_KEY'));
  const publishableKey = pickKey(deps.env('SUPABASE_PUBLISHABLE_KEYS'), deps.env('SUPABASE_ANON_KEY'));
  const allowedOrigins = (deps.env('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!url || !secretKey || !publishableKey) throw new HttpError(500, 'SERVER_MISCONFIGURED', 'Supabase environment variables are missing.');
  return { url, secretKey, publishableKey, allowedOrigins };
}

// ---------- HTTP ----------
export function corsHeaders(req: Request, cfg: Config | null): Record<string, string> {
  const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && cfg && cfg.allowedOrigins.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function json(req: Request, cfg: Config | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req, cfg), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) throw new HttpError(415, 'BAD_REQUEST', 'JSON body required.');
  const text = await req.text();
  if (text.length > 20000) throw new HttpError(413, 'BAD_REQUEST', 'Body too large.');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch (_) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }
}

// ---------- clients ----------
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** service client: bypasses RLS; used only for Auth administration, profiles and audit rows */
export function serviceClient(deps: Deps, cfg: Config): AnyClient {
  return deps.createClient(cfg.url, cfg.secretKey, NO_SESSION);
}

/** a client that acts as the caller, so database functions apply the caller's own rights */
export function callerClient(deps: Deps, cfg: Config, token: string): AnyClient {
  return deps.createClient(cfg.url, cfg.publishableKey, { ...NO_SESSION, global: { headers: { Authorization: 'Bearer ' + token } } });
}

/** a throw-away client used only to check a password (its session is ended immediately) */
export function anonClient(deps: Deps, cfg: Config): AnyClient {
  return deps.createClient(cfg.url, cfg.publishableKey, NO_SESSION);
}

// ---------- caller ----------
export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'examiner';
  active: boolean;
  must_change_password: boolean;
}
export interface Caller {
  token: string;
  userId: string;
  email: string;
  profile: Profile;
}

export async function verifyCaller(req: Request, svc: AnyClient): Promise<Caller> {
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) throw new HttpError(401, 'NOT_AUTHENTICATED');
  const token = m[1].trim();
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data || !data.user) throw new HttpError(401, 'NOT_AUTHENTICATED');
  const user = data.user;
  const { data: profile, error: perr } = await svc.from('profiles')
    .select('id, email, full_name, role, active, must_change_password').eq('id', user.id).maybeSingle();
  if (perr) throw new HttpError(500, 'SERVER_ERROR');
  if (!profile) throw new HttpError(403, 'NO_PROFILE');
  if (!profile.active) throw new HttpError(403, 'ACCOUNT_DISABLED');
  return { token, userId: user.id, email: (user.email || profile.email || '').toLowerCase(), profile };
}

export function requireAdmin(c: Caller): void {
  if (c.profile.role !== 'admin' || c.profile.must_change_password) throw new HttpError(403, 'NOT_ADMIN');
}

// ---------- validation ----------
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** password policy (also shown in the interface): 8–72 characters, letters and digits */
export function checkPassword(pw: string, email?: string): void {
  const bytes = new TextEncoder().encode(pw).length;
  if (pw.length < 8) throw new HttpError(400, 'WEAK_PASSWORD', 'At least 8 characters.');
  if (bytes > 72) throw new HttpError(400, 'WEAK_PASSWORD', 'At most 72 bytes.');
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/[0-9٠-٩]/.test(pw)) throw new HttpError(400, 'WEAK_PASSWORD', 'Letters and digits.');
  if (/^(.)\1+$/.test(pw)) throw new HttpError(400, 'WEAK_PASSWORD', 'Too simple.');
  if (email && pw.toLowerCase() === email.toLowerCase()) throw new HttpError(400, 'WEAK_PASSWORD', 'Same as email.');
}

// ---------- audit & rate limiting (audit rows never contain passwords) ----------
export async function audit(svc: AnyClient, performedBy: string | null, action: string, entityId: string | null, metadata: Record<string, unknown>): Promise<void> {
  const clean = { ...metadata };
  delete (clean as Record<string, unknown>).password;
  delete (clean as Record<string, unknown>).temp_password;
  delete (clean as Record<string, unknown>).current_password;
  delete (clean as Record<string, unknown>).new_password;
  const { error } = await svc.from('audit_log').insert({ action, entity_type: 'user', entity_id: entityId, performed_by: performedBy, metadata: clean });
  if (error) throw new HttpError(500, 'SERVER_ERROR');
}

export async function rateLimit(svc: AnyClient, performedBy: string, actions: string[], minutes: number, max: number): Promise<void> {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count, error } = await svc.from('audit_log').select('id', { count: 'exact', head: true })
    .eq('performed_by', performedBy).in('action', actions).gte('performed_at', since);
  if (error) throw new HttpError(500, 'SERVER_ERROR');
  if ((count || 0) >= max) throw new HttpError(429, 'RATE_LIMITED');
}

/** maps a database function error (raised as MFS:CODE) to an HTTP error */
export function dbError(err: { message?: string; code?: string } | null): HttpError {
  const msg = (err && err.message) || '';
  const m = /MFS:([A-Z_]+)/.exec(msg);
  if (m) {
    const code = m[1];
    const status = code === 'NOT_ADMIN' || code === 'INACTIVE' ? 403 : code === 'NOT_FOUND' ? 404 : 409;
    return new HttpError(status, code);
  }
  return new HttpError(500, 'SERVER_ERROR');
}

// ---------- request wrapper ----------
export function serve(deps: Deps, handler: (req: Request, cfg: Config) => Promise<Record<string, unknown>>) {
  return async (req: Request): Promise<Response> => {
    let cfg: Config | null = null;
    try {
      cfg = readConfig(deps);
    } catch (_) {
      return json(req, null, 500, { error: { code: 'SERVER_MISCONFIGURED' } });
    }
    const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
    if (!cfg.allowedOrigins.length) return json(req, cfg, 500, { error: { code: 'ALLOWED_ORIGINS_NOT_SET' } });
    if (origin && !cfg.allowedOrigins.includes(origin)) return json(req, cfg, 403, { error: { code: 'ORIGIN_NOT_ALLOWED' } });
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders(req, cfg) });
    if (req.method !== 'POST') return json(req, cfg, 405, { error: { code: 'METHOD_NOT_ALLOWED' } });
    try {
      const out = await handler(req, cfg);
      return json(req, cfg, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(req, cfg, e.status, { error: { code: e.code } });
      // unexpected: log the kind only, never request bodies
      console.error('unexpected error', e instanceof Error ? e.name : typeof e);
      return json(req, cfg, 500, { error: { code: 'SERVER_ERROR' } });
    }
  };
}
