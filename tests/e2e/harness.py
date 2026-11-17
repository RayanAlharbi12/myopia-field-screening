"""TEST-ONLY helpers for the Phase 2 browser tests.

Creates a throw-away PostgreSQL database with the Supabase role emulation,
the real supabase/setup.sql and the test change log, starts the local test
server (tests/harness/server.ts) and offers small helpers for the tests.
All data used by the tests is fictional and created by the tests themselves.
"""
import json
import os
import subprocess
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PSQL = ['psql', '-h', '/tmp', '-p', '54329', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q']
DB = os.environ.get('MFS_E2E_DB', 'mfs_e2e')
PORT = int(os.environ.get('MFS_E2E_PORT', '8790'))
ORIGIN = 'http://127.0.0.1:%d' % PORT

DATA_TABLES = ['audit_log', 'station_status', 'questionnaire_responses', 'visual_acuity', 'eom_findings', 'strabismus',
               'autorefraction', 'family_history_entries', 'systemic_history_entries', 'ocular_history_entries',
               'family_members', 'registration', 'participant_summary', 'participants', 'schools', 'app_counters', 'profiles']


def psql(db, *args, check=True):
    return subprocess.run(PSQL + ['-d', db] + list(args), capture_output=True, text=True, check=check)


def create_db():
    psql('postgres', '-c', 'drop database if exists %s with (force)' % DB, '-c', 'create database %s' % DB)
    for f in ['tests/harness/supabase_emulation.sql', 'supabase/setup.sql', 'tests/harness/changelog.sql']:
        r = psql(DB, '-f', os.path.join(ROOT, f), check=False)
        if r.returncode != 0:
            raise RuntimeError('applying %s failed: %s' % (f, r.stderr[-2000:]))


class Server:
    def __init__(self, root=None):
        self.root = root or ROOT
        self.proc = None

    def start(self):
        log = open(os.path.join(ROOT, 'tests', 'e2e', '.server.log'), 'w')
        self.proc = subprocess.Popen(['bun', os.path.join(ROOT, 'tests/harness/server.ts'), '--root', self.root, '--db', DB, '--port', str(PORT)],
                                     stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)
        for _ in range(100):
            try:
                urllib.request.urlopen(ORIGIN + '/auth/v1/health', timeout=1)
                return self
            except Exception:
                time.sleep(0.1)
        raise RuntimeError('test server did not start; see tests/e2e/.server.log')

    def stop(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except Exception:
                self.proc.kill()


def post(path, body, token=None):
    req = urllib.request.Request(ORIGIN + path, data=json.dumps(body).encode(), method='POST',
                                 headers={'content-type': 'application/json', 'apikey': 'sb_publishable_localtest',
                                          'authorization': 'Bearer ' + (token or 'sb_publishable_localtest')})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'null')


def sql(q, params=None):
    st, body = post('/test/control/sql', {'sql': q, 'params': params or []})
    if st != 200:
        raise RuntimeError('SQL failed: %s -> %s' % (q[:120], body))
    return body['rows']


def reset():
    sql('truncate %s restart identity cascade' % ', '.join('public.' + t for t in DATA_TABLES))
    sql('delete from auth.users')
    sql('truncate _test.changes')
    post('/test/control/expire-tokens', {})


def make_user(email, password, name, role='examiner', must_change=False, active=True):
    uid = sql("insert into auth.users (id, email, encrypted_password, email_confirmed_at) values (gen_random_uuid(), lower($1), extensions.crypt($2, extensions.gen_salt('bf')), now()) returning id::text as id", [email, password])[0]['id']
    sql('insert into public.profiles (id, email, full_name, role, active, must_change_password) values ($1::uuid, lower($2), $3, $4::public.app_role, $5::boolean, $6::boolean)',
        [uid, email, name, role, 'true' if active else 'false', 'true' if must_change else 'false'])
    return uid


def token(email, password):
    st, body = post('/test/auth/token', {'email': email, 'password': password})
    assert st == 200, body
    return body['session']['access_token']


def rest(token_, q):
    return post('/test/rest', q, token_)[1]


def rpc(token_, name, args):
    return post('/test/rpc', {'name': name, 'args': args}, token_)[1]


class Results:
    def __init__(self):
        self.rows = []

    def check(self, name, ok, detail=''):
        self.rows.append((name, bool(ok), detail))
        print(('PASS ' if ok else 'FAIL ') + name + ((' — ' + str(detail)) if detail and not ok else ''), flush=True)
        return ok

    def summary(self):
        failed = [r for r in self.rows if not r[1]]
        print('\n%d checks, %d failed' % (len(self.rows), len(failed)))
        for f in failed:
            print('  FAILED:', f[0], f[2])
        return not failed
