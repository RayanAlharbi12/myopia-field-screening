// =====================================================================
// TEST-ONLY local stand-in for Supabase, used by the automated browser
// tests. It runs the REAL database (setup.sql on local PostgreSQL 16 with
// the same roles, RLS, functions and triggers) and the REAL Edge Function
// code (supabase/functions/_shared/handlers.ts). What it emulates:
//   - Auth: password sign-in, tokens, bans (simplified, no JWT signing)
//   - PostgREST: the query features this app uses, executed as the
//     signed-in user's role with request.jwt.claims (so RLS applies)
//   - Realtime Postgres Changes: row changes are delivered over a
//     WebSocket only if the subscriber can SELECT the row (RLS checked)
// Usage: bun tests/harness/server.ts --root <app dir> --db <database> --port 8790
// Never deploy this. It has test-only control endpoints under /test/.
// =====================================================================
import { SQL } from 'bun';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { HANDLERS } from '../../supabase/functions/_shared/handlers.ts';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const ROOT = arg('root', join(import.meta.dir, '..', '..'));
const DB = arg('db', 'mfs_e2e');
const PORT = Number(arg('port', '8790'));
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PUBLISHABLE = 'sb_publishable_localtest';
const SECRET = 'sb_secret_localtest_server_only';
const DIST = existsSync(join(ROOT, 'version.json'));

const sql = new SQL({ hostname: '127.0.0.1', port: 54329, username: 'postgres', database: DB, max: 20 });

// ---------- schema metadata ----------
type ColMap = Record<string, Record<string, string>>;
let COLS: ColMap = {};
let FUNCS: Record<string, { args: { name: string; type: string }[]; set: boolean; kind: string; ret: string }> = {};
async function loadMeta() {
  COLS = {};
  const rows = await sql.unsafe(`select c.table_name, c.column_name, case when c.data_type = 'ARRAY' then format_type(a.atttypid, a.atttypmod) when c.data_type = 'USER-DEFINED' then 'public.' || c.udt_name else format_type(a.atttypid, a.atttypmod) end as t
    from information_schema.columns c join pg_attribute a on a.attrelid = ('public.' || quote_ident(c.table_name))::regclass and a.attname = c.column_name
    where c.table_schema = 'public'`);
  for (const r of rows) (COLS[r.table_name] = COLS[r.table_name] || {})[r.column_name] = r.t;
  FUNCS = {};
  const fns = await sql.unsafe(`select p.proname, p.proretset, t.typtype, format_type(p.prorettype, null) as ret,
      coalesce(p.proargnames, '{}') as names, coalesce((select array_agg(format_type(x, null) order by o) from unnest(p.proargtypes) with ordinality u(x, o)), '{}') as types
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public'`);
  for (const f of fns) {
    const names: string[] = Array.isArray(f.names) ? f.names : parseArr(f.names);
    const types: string[] = Array.isArray(f.types) ? f.types : parseArr(f.types);
    FUNCS[f.proname] = { args: types.map((t, i) => ({ name: names[i], type: t })), set: f.proretset, kind: f.typtype, ret: f.ret };
  }
}
function parseArr(s: string): string[] { return String(s || '').replace(/^\{|\}$/g, '').split(',').filter(Boolean).map((x) => x.replace(/^"|"$/g, '')); }

// ---------- auth ----------
interface Who { kind: 'anon' | 'user' | 'service'; uid?: string; email?: string; token?: string }
const tokens = new Map<string, { uid: string; email: string; refresh: string }>();
const refreshes = new Map<string, string>(); // refresh -> access
function newToken() { return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''); }

async function passwordOk(email: string, password: string) {
  const r = await sql.unsafe(`select id, email, banned_until from auth.users where lower(email) = lower($1) and encrypted_password is not null and encrypted_password = extensions.crypt($2, encrypted_password)`, [email, password]);
  return r[0] || null;
}
function issue(uid: string, email: string) {
  const access = newToken(), refresh = newToken();
  tokens.set(access, { uid, email, refresh });
  refreshes.set(refresh, access);
  return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email } };
}
async function banned(uid: string) {
  const r = await sql.unsafe(`select banned_until from auth.users where id = $1`, [uid]);
  return !r[0] || (r[0].banned_until && new Date(r[0].banned_until).getTime() > Date.now());
}
function whoFromHeaders(h: Headers): Who {
  const key = h.get('apikey') || '';
  const auth = (h.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (auth === SECRET || key === SECRET && (!auth || auth === SECRET)) return { kind: 'service' };
  const t = tokens.get(auth);
  if (t) return { kind: 'user', uid: t.uid, email: t.email, token: auth };
  return { kind: 'anon' };
}

// ---------- execution as a role ----------
async function asRole<T>(who: Who, fn: (tx: any) => Promise<T>): Promise<T> {
  return await sql.begin(async (tx: any) => {
    if (who.kind === 'service') {
      await tx.unsafe(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await tx.unsafe('set local role service_role');
    } else if (who.kind === 'user') {
      await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who.uid, role: 'authenticated', email: who.email })]);
      await tx.unsafe('set local role authenticated');
    } else {
      await tx.unsafe(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await tx.unsafe('set local role anon');
    }
    return await fn(tx);
  });
}
/* parameters are always sent as text and cast in SQL (avoids driver-side type guessing) */
function pgArray(v: any[]): string {
  return '{' + v.map((x) => x === null || x === undefined ? 'NULL' : '"' + String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
}
function toText(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return pgArray(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function pgErr(e: any) {
  const code = e && e.errno ? String(e.errno) : '';
  return { code, message: e && e.message ? String(e.message) : 'error', details: null, hint: null };
}

// ---------- PostgREST-like query execution ----------
const ID = /^[a-z_][a-z0-9_]*$/;
interface Filter { col: string; op: string; val: any }
interface Query {
  table: string; op: 'select' | 'insert' | 'update'; columns?: string; count?: string | null; head?: boolean;
  filters?: Filter[]; ors?: string[]; order?: { col: string; asc: boolean }[]; range?: [number, number] | null;
  single?: 'single' | 'maybe' | null; values?: any; returning?: boolean;
}
function colType(t: string, c: string) {
  const m = COLS[t];
  if (!m || !m[c]) throw { errno: '42703', message: `column ${t}.${c} does not exist` };
  return m[c];
}
function where(q: Query, params: any[]) {
  const parts: string[] = [];
  const one = (f: Filter) => {
    if (!ID.test(f.col)) throw { errno: '42703', message: 'bad column' };
    const t = colType(q.table, f.col);
    const c = `"${f.col}"`;
    switch (f.op) {
      case 'eq': params.push(f.val === null ? null : String(f.val)); return f.val === null ? `${c} is null` : `${c} = $${params.length}::text::${t}`;
      case 'neq': params.push(String(f.val)); return `${c} is distinct from $${params.length}::text::${t}`;
      case 'gte': params.push(String(f.val)); return `${c} >= $${params.length}::text::${t}`;
      case 'lte': params.push(String(f.val)); return `${c} <= $${params.length}::text::${t}`;
      case 'like': params.push(String(f.val).replace(/\*/g, '%')); return `${c}::text like $${params.length}`;
      case 'ilike': params.push(String(f.val).replace(/\*/g, '%')); return `${c}::text ilike $${params.length}`;
      case 'in': params.push(pgArray(f.val as any[])); return `${c}::text = any($${params.length}::text::text[])`;
      case 'is': return `${c} is ${f.val === null ? 'null' : f.val ? 'true' : 'false'}`;
      default: throw { errno: 'PGRST100', message: 'unsupported operator ' + f.op };
    }
  };
  for (const f of q.filters || []) parts.push(one(f));
  for (const o of q.ors || []) {
    const alts = o.split(',').map((x) => { const i = x.indexOf('.'), j = x.indexOf('.', i + 1); return one({ col: x.slice(0, i), op: x.slice(i + 1, j), val: x.slice(j + 1) }); });
    parts.push('(' + alts.join(' or ') + ')');
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}
function colsList(q: Query) {
  const raw = (q.columns || '*').trim();
  if (raw === '*') return '*';
  return raw.split(',').map((s) => s.trim()).map((c) => { if (!ID.test(c)) throw { errno: '42703', message: 'bad column' }; colType(q.table, c); return `"${c}"`; }).join(', ');
}
async function execQuery(who: Who, q: Query) {
  if (!ID.test(q.table) || !COLS[q.table]) return { data: null, error: { code: '42P01', message: `relation "${q.table}" does not exist` }, count: null };
  try {
    return await asRole(who, async (tx) => {
      const params: any[] = [];
      const t = `public."${q.table}"`;
      if (q.op === 'select') {
        const w = where(q, params);
        let count: number | null = null;
        if (q.count) count = (await tx.unsafe(`select count(*)::int as n from ${t}${w}`, params))[0].n;
        if (q.head) return { data: null, error: null, count };
        const ord = (q.order || []).map((o) => { colType(q.table, o.col); return `"${o.col}" ${o.asc ? 'asc' : 'desc'}`; }).join(', ');
        const lim = q.range ? ` limit ${Number(q.range[1]) - Number(q.range[0]) + 1} offset ${Number(q.range[0])}` : '';
        const r = await tx.unsafe(`select coalesce(json_agg(x), '[]'::json) as rows from (select ${colsList(q)} from ${t}${w}${ord ? ' order by ' + ord : ''}${lim}) x`, params);
        return finish(q, r[0].rows, count);
      }
      if (q.op === 'insert') {
        const list = Array.isArray(q.values) ? q.values : [q.values];
        const out: any[] = [];
        for (const v of list) {
          const keys = Object.keys(v).filter((k) => { colType(q.table, k); return ID.test(k); });
          const cl = keys.map((k) => `"${k}"`).join(', ');
          const r = await tx.unsafe(`with ins as (insert into ${t} (${cl}) select ${cl} from json_populate_record(null::${t}, $1::text::json) returning *) select coalesce(json_agg(ins), '[]'::json) as rows from ins`, [JSON.stringify(v)]);
          out.push(...r[0].rows);
        }
        return finish(q, q.returning ? out : null, null);
      }
      if (q.op === 'update') {
        const v = q.values || {};
        const keys = Object.keys(v).filter((k) => { colType(q.table, k); return ID.test(k); });
        params.push(JSON.stringify(v));
        const w = where(q, params);
        const cl = keys.map((k) => `"${k}"`).join(', ');
        const r = await tx.unsafe(`with up as (update ${t} set (${cl}) = (select ${cl} from json_populate_record(null::${t}, $1::text::json)) ${w} returning *) select coalesce(json_agg(up), '[]'::json) as rows from up`, params);
        return finish(q, q.returning ? r[0].rows : null, null);
      }
      throw { errno: 'PGRST100', message: 'unsupported' };
    });
  } catch (e: any) {
    if (e && e.__result) return e.__result;
    return { data: null, error: pgErr(e), count: null };
  }
}
function finish(q: Query, rows: any[] | null, count: number | null) {
  if (rows && q.single) {
    if (rows.length > 1 || (q.single === 'single' && rows.length === 0)) {
      // PostgREST: the statement is rolled back when .single() does not match exactly one row
      throw { __result: { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null }, count: null } };
    }
    return { data: rows[0] || null, error: null, count };
  }
  return { data: rows, error: null, count };
}

async function execRpc(who: Who, name: string, args: Record<string, any>) {
  const f = FUNCS[name];
  if (!f || !ID.test(name)) return { data: null, error: { code: 'PGRST202', message: 'function not found' } };
  try {
    return await asRole(who, async (tx) => {
      const params: any[] = [];
      const named = Object.keys(args || {}).map((k) => {
        const a = f.args.find((x) => x.name === k);
        if (!a) throw { errno: 'PGRST202', message: 'unknown argument ' + k };
        const v = args[k];
        params.push(toText(v));
        return `${k} => $${params.length}::text::${a.type}`;
      }).join(', ');
      const call = `public."${name}"(${named})`;
      if (f.set) return { data: (await tx.unsafe(`select coalesce(json_agg(r), '[]'::json) as v from ${call} r`, params))[0].v, error: null };
      if (f.ret === 'void') { await tx.unsafe(`select ${call}`, params); return { data: null, error: null }; }
      return { data: (await tx.unsafe(`select to_json(${call}) as v`, params))[0].v, error: null };
    });
  } catch (e: any) { return { data: null, error: pgErr(e) }; }
}

// ---------- in-process client for the Edge Function code ----------
class ServerBuilder {
  q: Query; who: Who;
  constructor(who: Who, table: string) { this.who = who; this.q = { table, op: 'select', filters: [], ors: [], order: [], range: null, single: null }; }
  select(cols?: string, o?: { count?: string; head?: boolean }) { if (this.q.op === 'select') { this.q.columns = cols || '*'; this.q.count = o && o.count || null; this.q.head = !!(o && o.head); } else this.q.returning = true; return this; }
  insert(v: any) { this.q.op = 'insert'; this.q.values = v; return this; }
  update(v: any) { this.q.op = 'update'; this.q.values = v; return this; }
  eq(c: string, v: any) { this.q.filters!.push({ col: c, op: 'eq', val: v }); return this; }
  neq(c: string, v: any) { this.q.filters!.push({ col: c, op: 'neq', val: v }); return this; }
  gte(c: string, v: any) { this.q.filters!.push({ col: c, op: 'gte', val: v }); return this; }
  in(c: string, v: any[]) { this.q.filters!.push({ col: c, op: 'in', val: v }); return this; }
  ilike(c: string, v: string) { this.q.filters!.push({ col: c, op: 'ilike', val: v }); return this; }
  like(c: string, v: string) { this.q.filters!.push({ col: c, op: 'like', val: v }); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.q.order!.push({ col: c, asc: !o || o.ascending !== false }); return this; }
  single() { this.q.single = 'single'; return this; }
  maybeSingle() { this.q.single = 'maybe'; return this; }
  then(res: any, rej: any) { return execQuery(this.who, this.q).then(res, rej); }
}
function serverCreateClient(_url: string, key: string, options?: any) {
  const header = options && options.global && options.global.headers && options.global.headers.Authorization || '';
  const bearer = String(header).replace(/^Bearer\s+/i, '');
  let who: Who = key === SECRET ? { kind: 'service' } : tokens.get(bearer) ? { kind: 'user', uid: tokens.get(bearer)!.uid, email: tokens.get(bearer)!.email, token: bearer } : { kind: 'anon' };
  let ownToken: string | null = null;
  const err = (message: string, extra: any = {}) => ({ name: 'AuthApiError', message, status: extra.status || 400, code: extra.code });
  return {
    from: (t: string) => new ServerBuilder(who, t),
    rpc: (n: string, a: any) => execRpc(who, n, a),
    auth: {
      getUser: async (token: string) => {
        const t = tokens.get(token);
        if (!t || await banned(t.uid)) return { data: { user: null }, error: err('invalid JWT', { status: 401 }) };
        return { data: { user: { id: t.uid, email: t.email } }, error: null };
      },
      signInWithPassword: async ({ email, password }: any) => {
        const u = await passwordOk(email, password);
        if (!u) return { data: { user: null, session: null }, error: err('Invalid login credentials', { code: 'invalid_credentials' }) };
        const s = issue(u.id, u.email);
        ownToken = s.access_token;
        return { data: { user: s.user, session: s }, error: null };
      },
      signOut: async () => { if (ownToken) { tokens.delete(ownToken); ownToken = null; } return { error: null }; },
      admin: {
        createUser: async ({ email, password, user_metadata }: any) => {
          if (who.kind !== 'service') return { data: null, error: err('not allowed', { status: 403 }) };
          const ex = await sql.unsafe(`select 1 from auth.users where lower(email) = lower($1)`, [email]);
          if (ex.length) return { data: { user: null }, error: err('A user with this email address has already been registered', { status: 422, code: 'email_exists' }) };
          const r = await sql.unsafe(`insert into auth.users (id, email, encrypted_password, raw_user_meta_data, email_confirmed_at) values (gen_random_uuid(), lower($1), extensions.crypt($2, extensions.gen_salt('bf')), $3::jsonb, now()) returning id, email`, [email, password, JSON.stringify(user_metadata || {})]);
          return { data: { user: r[0] }, error: null };
        },
        updateUserById: async (id: string, attrs: any) => {
          if (who.kind !== 'service') return { data: null, error: err('not allowed', { status: 403 }) };
          if (attrs.password) await sql.unsafe(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), updated_at = now() where id = $1`, [id, attrs.password]);
          if (attrs.ban_duration) await sql.unsafe(`update auth.users set banned_until = case when $2 = 'none' then null else now() + interval '100 years' end where id = $1`, [id, attrs.ban_duration]);
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async (id: string) => { await sql.unsafe(`delete from auth.users where id = $1`, [id]); return { data: null, error: null }; },
      },
    },
  };
}
const functionEnv: Record<string, string> = {
  SUPABASE_URL: ORIGIN,
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }),
  ALLOWED_ORIGINS: ORIGIN,
};
const FN: Record<string, (r: Request) => Promise<Response>> = {};
for (const name of Object.keys(HANDLERS)) FN[name] = HANDLERS[name]({ env: (k: string) => functionEnv[k], createClient: serverCreateClient as any });

// ---------- realtime emulation ----------
interface Sub { ws: any; who: Who; specs: { table: string; filter?: string }[] }
const subs = new Set<Sub>();
let lastChange = 0;
const PK: Record<string, string[]> = { station_status: ['participant_id', 'station'], participant_summary: ['participant_id'] };
function pkOf(t: string) { return PK[t] || (COLS[t] && COLS[t].id ? ['id'] : ['participant_id']); }
async function pollChanges() {
  try {
    const rows = await sql.unsafe(`select id, tbl, op, row_data from _test.changes where id > $1 order by id limit 500`, [lastChange]);
    for (const ch of rows) {
      lastChange = Number(ch.id);
      for (const s of subs) {
        for (const spec of s.specs) {
          if (spec.table !== ch.tbl) continue;
          if (spec.filter) {
            const m = /^([a-z_]+)=eq\.(.+)$/.exec(spec.filter);
            if (!m || String(ch.row_data[m[1]]) !== m[2]) continue;
          }
          const keys = pkOf(ch.tbl);
          const filters = keys.map((k) => ({ col: k, op: 'eq', val: ch.row_data[k] }));
          const vis = await execQuery(s.who, { table: ch.tbl, op: 'select', filters, single: 'maybe' });
          if (vis.data) s.ws.send(JSON.stringify({ table: ch.tbl, eventType: ch.op, new: vis.data, schema: 'public' }));
        }
      }
    }
  } catch (e) { /* database restarting between tests */ }
  setTimeout(pollChanges, 120);
}

// ---------- HTTP ----------
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let csp: string | null = null;
if (DIST && existsSync(join(ROOT, '_headers'))) { const m = /Content-Security-Policy:\s*(.+)/.exec(readFileSync(join(ROOT, '_headers'), 'utf8')); if (m) csp = m[1].trim(); }

function staticFile(path: string): Response {
  if (path === '/config.js') return new Response(`window.MFS_CONFIG = ${JSON.stringify({ SUPABASE_URL: ORIGIN, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE })};`, { headers: { 'content-type': TYPES['.js'], 'cache-control': 'no-store' } });
  if (!DIST && path === '/vendor/supabase.js') return new Response(readFileSync(join(import.meta.dir, 'fake-supabase.js')), { headers: { 'content-type': TYPES['.js'] } });
  if (!DIST && path === '/sw.js') return new Response('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",()=>self.registration.unregister());', { headers: { 'content-type': TYPES['.js'] } });
  if (path === '/') path = '/index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    if (DIST) path = '/index.html'; else return new Response('not found', { status: 404 });
  }
  const f = existsSync(file) && !statSync(file).isDirectory() ? file : join(ROOT, 'index.html');
  const h: Record<string, string> = { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': /assets\/build\//.test(f) ? 'public, max-age=31536000, immutable' : 'no-cache' };
  if (csp && f.endsWith('.html')) h['content-security-policy'] = csp;
  return new Response(readFileSync(f), { headers: h });
}

await loadMeta();
pollChanges();

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req, server) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/test/realtime') { if (server.upgrade(req, { data: {} })) return undefined as any; return new Response('upgrade failed', { status: 400 }); }
    if (p === '/auth/v1/health') return json({ ok: true });
    if (p.startsWith('/functions/v1/')) {
      const fn = FN[p.slice('/functions/v1/'.length)];
      if (!fn) return json({ error: { code: 'NOT_FOUND' } }, 404);
      return fn(req);
    }
    if (p.startsWith('/test/')) {
      const body: any = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      const who = whoFromHeaders(req.headers);
      /* like PostgREST: a bearer token that is neither a key nor a valid session is rejected (401) */
      const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if ((p === '/test/rest' || p === '/test/rpc') && bearer && bearer !== PUBLISHABLE && bearer !== SECRET && !tokens.has(bearer)) {
        return json({ data: null, error: { code: 'PGRST301', message: 'JWT expired', details: null, hint: null } }, 401);
      }
      if (p === '/test/rest') return json(await execQuery(who, body));
      if (p === '/test/rpc') return json(await execRpc(who, body.name, body.args || {}));
      if (p === '/test/auth/token') {
        const u = await passwordOk(String(body.email || ''), String(body.password || ''));
        if (!u) return json({ error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } }, 400);
        if (u.banned_until && new Date(u.banned_until).getTime() > Date.now()) return json({ error: { message: 'User is banned', code: 'user_banned', status: 400 } }, 400);
        return json({ session: issue(u.id, u.email) });
      }
      if (p === '/test/auth/refresh') {
        const old = refreshes.get(String(body.refresh_token || ''));
        const t = old && tokens.get(old);
        if (!t || await banned(t.uid)) return json({ error: { message: 'Invalid Refresh Token', code: 'refresh_token_not_found', status: 400 } }, 400);
        tokens.delete(old!); refreshes.delete(String(body.refresh_token));
        return json({ session: issue(t.uid, t.email) });
      }
      if (p === '/test/auth/logout') { if (who.token) { const t = tokens.get(who.token); if (t) refreshes.delete(t.refresh); tokens.delete(who.token); } return json({ ok: true }); }
      // ---- control endpoints (tests only) ----
      if (p === '/test/control/sql') { try { return json({ rows: await sql.unsafe(body.sql, body.params || []) }); } catch (e: any) { return json({ error: pgErr(e) }, 400); } }
      if (p === '/test/control/reload-meta') { await loadMeta(); return json({ ok: true }); }
      if (p === '/test/control/expire-tokens') { const n = tokens.size; tokens.clear(); refreshes.clear(); return json({ expired: n }); }
      if (p === '/test/control/realtime') return json({ subscribers: subs.size });
      return json({ error: 'unknown test endpoint' }, 404);
    }
    if (req.method !== 'GET') return new Response('method not allowed', { status: 405 });
    return staticFile(p);
  },
  websocket: {
    message(ws: any, msg: any) {
      try {
        const m = JSON.parse(String(msg));
        if (m.type === 'join') {
          const t = tokens.get(m.token || '');
          const sub: Sub = { ws, who: t ? { kind: 'user', uid: t.uid, email: t.email } : { kind: 'anon' }, specs: m.specs || [] };
          ws.data.sub = sub;
          subs.add(sub);
          ws.send(JSON.stringify({ type: 'status', status: 'SUBSCRIBED' }));
        }
      } catch (_) { /* ignore */ }
    },
    close(ws: any) { if (ws.data && ws.data.sub) subs.delete(ws.data.sub); },
  },
});
console.log(`TEST server on ${ORIGIN} (root ${ROOT}, database ${DB}, ${DIST ? 'production build' : 'source'})`);
