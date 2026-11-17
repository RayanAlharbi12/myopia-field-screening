// Unit tests for the Edge Function code (run with: bun test tests/functions).
// The Supabase client is replaced by small stubs; no network, no database.
import { describe, expect, test } from 'bun:test';
import { checkPassword, readConfig, HttpError, audit } from '../../supabase/functions/_shared/core.ts';
import { HANDLERS } from '../../supabase/functions/_shared/handlers.ts';

const ORIGIN = 'https://screening.example.org';
const baseEnv: Record<string, string> = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_unit' }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_unit' }),
  ALLOWED_ORIGINS: ORIGIN + ', https://other.example.org/',
};
const deps = (env: Record<string, string | undefined>, client: any = {}) => ({ env: (k: string) => env[k], createClient: () => client });
const req = (method: string, headers: Record<string, string> = {}, body?: any) =>
  new Request('https://abc.supabase.co/functions/v1/x', { method, headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });

describe('configuration', () => {
  test('reads the new JSON key dictionaries (default key)', () => {
    const c = readConfig(deps(baseEnv) as any);
    expect(c.secretKey).toBe('sb_secret_unit');
    expect(c.publishableKey).toBe('sb_publishable_unit');
    expect(c.allowedOrigins).toEqual([ORIGIN, 'https://other.example.org']);
  });
  test('falls back to the legacy variables', () => {
    const c = readConfig(deps({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'legacy-secret', SUPABASE_ANON_KEY: 'legacy-anon' }) as any);
    expect(c.secretKey).toBe('legacy-secret');
    expect(c.publishableKey).toBe('legacy-anon');
  });
  test('missing environment -> 500 SERVER_MISCONFIGURED', async () => {
    const r = await HANDLERS['admin-create-user'](deps({}) as any)(req('POST'));
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('SERVER_MISCONFIGURED');
  });
  test('ALLOWED_ORIGINS not set -> explicit error, never "allow all"', async () => {
    const r = await HANDLERS['change-password'](deps({ ...baseEnv, ALLOWED_ORIGINS: '' }) as any)(req('POST'));
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('ALLOWED_ORIGINS_NOT_SET');
  });
});

describe('HTTP and CORS', () => {
  const h = HANDLERS['admin-user-status'](deps(baseEnv) as any);
  test('preflight from an allowed origin', async () => {
    const r = await h(req('OPTIONS'));
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(r.headers.get('access-control-allow-headers')).toContain('authorization');
  });
  test('other origins are refused', async () => {
    const r = await h(req('POST', { origin: 'https://evil.example.com' }));
    expect(r.status).toBe(403);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });
  test('only POST', async () => {
    expect((await h(req('GET'))).status).toBe(405);
  });
  test('no bearer token -> 401', async () => {
    const r = await h(req('POST', {}, {}));
    expect(r.status).toBe(401);
  });
});

describe('caller verification', () => {
  function client(profile: any) {
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null }) },
      from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: profile, error: null }) }),
    };
  }
  test('examiner calling an Administrator function -> 403 NOT_ADMIN', async () => {
    const r = await HANDLERS['admin-create-user'](deps(baseEnv, client({ id: 'u1', role: 'examiner', active: true, must_change_password: false })) as any)(req('POST', { authorization: 'Bearer t' }, {}));
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe('NOT_ADMIN');
  });
  test('Administrator who must still change the password -> 403', async () => {
    const r = await HANDLERS['admin-create-user'](deps(baseEnv, client({ id: 'u1', role: 'admin', active: true, must_change_password: true })) as any)(req('POST', { authorization: 'Bearer t' }, {}));
    expect(r.status).toBe(403);
  });
  test('disabled account -> 403 ACCOUNT_DISABLED', async () => {
    const r = await HANDLERS['change-password'](deps(baseEnv, client({ id: 'u1', role: 'admin', active: false, must_change_password: false })) as any)(req('POST', { authorization: 'Bearer t' }, {}));
    expect((await r.json()).error.code).toBe('ACCOUNT_DISABLED');
  });
  test('account without profile -> 403 NO_PROFILE', async () => {
    const r = await HANDLERS['change-password'](deps(baseEnv, client(null)) as any)(req('POST', { authorization: 'Bearer t' }, {}));
    expect((await r.json()).error.code).toBe('NO_PROFILE');
  });
  test('errors never echo request content', async () => {
    const r = await HANDLERS['admin-create-user'](deps(baseEnv, client({ id: 'u1', role: 'examiner', active: true, must_change_password: false })) as any)(req('POST', { authorization: 'Bearer t' }, { password: 'Secret123abc' }));
    expect(await r.text()).not.toContain('Secret123abc');
  });
});

describe('password policy and audit', () => {
  test('policy', () => {
    expect(() => checkPassword('short1')).toThrow(HttpError);
    expect(() => checkPassword('onlyletters')).toThrow(HttpError);
    expect(() => checkPassword('12345678')).toThrow(HttpError);
    expect(() => checkPassword('a'.repeat(70) + '1234')).toThrow(HttpError); // > 72 bytes
    expect(() => checkPassword('Field2026x', 'field2026x')).toThrow(HttpError);
    expect(() => checkPassword('Field2026x')).not.toThrow();
    expect(() => checkPassword('كلمةسر٢٠٢٦أ')).not.toThrow();
  });
  test('audit rows never contain passwords', async () => {
    let row: any = null;
    const svc = { from: () => ({ insert: async (r: any) => { row = r; return { error: null }; } }) };
    await audit(svc, 'u1', 'user.create', 'u2', { email: 'x@y.z', password: 'p', temp_password: 't', new_password: 'n', current_password: 'c' });
    expect(row.metadata).toEqual({ email: 'x@y.z' });
  });
});
