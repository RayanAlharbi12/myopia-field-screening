#!/usr/bin/env python3
"""Edge Functions against the real database (through the local test stand-in).
Rate limits, validation, duplicate e-mail, last-Administrator protection, and that
Auth and profiles stay consistent. Fictional accounts only."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import harness as h  # noqa: E402

R = h.Results()
ok = R.check


def fn(name, body, token):
    return h.post('/functions/v1/' + name, body, token)


def main():
    h.create_db()
    s = h.Server().start()
    try:
        h.reset()
        h.make_user('admin@test.invalid', 'AdminPass123', 'مدير', 'admin')
        ta = h.token('admin@test.invalid', 'AdminPass123')
        st, b = fn('admin-create-user', {'email': 'bad-email', 'full_name': 'x', 'role': 'examiner', 'password': 'GoodPass123'}, ta)
        ok('invalid e-mail -> 400 INVALID_EMAIL', st == 400 and b['error']['code'] == 'INVALID_EMAIL', (st, b))
        st, b = fn('admin-create-user', {'email': 'e1@test.invalid', 'full_name': 'x', 'role': 'superuser', 'password': 'GoodPass123'}, ta)
        ok('unknown role -> 400 INVALID_ROLE', st == 400 and b['error']['code'] == 'INVALID_ROLE', (st, b))
        st, b = fn('admin-create-user', {'email': 'e1@test.invalid', 'full_name': 'x', 'role': 'examiner', 'password': 'weak'}, ta)
        ok('weak temporary password -> 400 WEAK_PASSWORD', st == 400 and b['error']['code'] == 'WEAK_PASSWORD', (st, b))
        ok('nothing created by refused requests', h.sql("select count(*)::int as n from auth.users where email = 'e1@test.invalid'")[0]['n'] == 0)
        st, b = fn('admin-create-user', {'email': 'E1@Test.Invalid', 'full_name': 'فاحص', 'role': 'examiner', 'password': 'GoodPass123'}, ta)
        ok('user created (e-mail stored in lower case)', st == 200 and b['user']['email'] == 'e1@test.invalid' and b['user']['must_change_password'] is True, (st, b))
        uid = b['user']['id']
        st, b = fn('admin-create-user', {'email': 'e1@test.invalid', 'full_name': 'y', 'role': 'admin', 'password': 'GoodPass123'}, ta)
        ok('duplicate e-mail -> 409 EMAIL_EXISTS', st == 409 and b['error']['code'] == 'EMAIL_EXISTS', (st, b))
        ok('Auth users and profiles stay one-to-one', h.sql('select (select count(*) from auth.users)::int as a, (select count(*) from public.profiles)::int as p')[0] == {'a': 2, 'p': 2})
        te = h.token('e1@test.invalid', 'GoodPass123')
        st, b = fn('admin-reset-user-password', {'user_id': uid, 'password': 'Other1234'}, te)
        ok('examiner cannot reset passwords -> 403', st == 403, (st, b))
        st, b = fn('admin-user-status', {'user_id': uid, 'active': False}, te)
        ok('examiner cannot disable accounts -> 403', st == 403, (st, b))
        st, b = fn('admin-reset-user-password', {'user_id': '00000000-0000-4000-8000-000000000000', 'password': 'Other1234'}, ta)
        ok('reset for an unknown account -> 404', st == 404, (st, b))
        # change-password rate limit: 5 wrong attempts in 15 minutes
        codes = [fn('change-password', {'current_password': 'wrong%d' % i, 'new_password': 'NewPass999'}, te)[1]['error']['code'] for i in range(6)]
        ok('wrong current password refused; 6th attempt rate-limited', codes[:5] == ['WRONG_PASSWORD'] * 5 and codes[5] == 'RATE_LIMITED', codes)
        ok('failed attempts audited without passwords', all('wrong' not in r['m'] for r in h.sql("select metadata::text as m from audit_log where action = 'user.password_change_failed'")))
        st, b = fn('change-password', {'current_password': 'GoodPass123', 'new_password': 'GoodPass123'}, te)
        ok('same password refused', st == 400 and b['error']['code'] == 'SAME_PASSWORD', (st, b))
        st, b = fn('admin-user-status', {'user_id': h.sql("select id::text from profiles where email='admin@test.invalid'")[0]['id'], 'active': False}, ta)
        ok('last Administrator cannot be disabled -> 409 LAST_ADMIN', st == 409 and b['error']['code'] == 'LAST_ADMIN', (st, b))
        st, b = fn('admin-user-status', {'user_id': uid, 'active': False}, ta)
        ok('disable: profile inactive + Auth ban', st == 200 and h.sql("select (banned_until > now()) as b from auth.users where id = $1::uuid", [uid])[0]['b'] is True)
        st2, b2 = h.post('/test/auth/token', {'email': 'e1@test.invalid', 'password': 'GoodPass123'})
        ok('disabled account cannot sign in', st2 == 400, (st2, b2))
        rows = h.rest(te, {'table': 'schools', 'op': 'select', 'filters': [], 'columns': '*'})
        ok('existing session of the disabled account sees no research data (RLS)', rows.get('data') == [], rows)
        st, b = fn('admin-user-status', {'user_id': uid, 'active': True}, ta)
        ok('reactivate lifts the ban', st == 200 and h.sql("select banned_until from auth.users where id = $1::uuid", [uid])[0]['banned_until'] is None)
        import urllib.request
        req = urllib.request.Request(h.ORIGIN + '/functions/v1/admin-create-user', data=b'{}', method='POST',
                                     headers={'content-type': 'application/json', 'authorization': 'Bearer ' + ta, 'origin': 'https://evil.example.com'})
        try:
            urllib.request.urlopen(req)
            code = 200
        except urllib.error.HTTPError as e:
            code = e.code
        ok('request from a non-allowed origin -> 403', code == 403, code)
    finally:
        s.stop()
    sys.exit(0 if R.summary() else 1)


if __name__ == '__main__':
    main()
