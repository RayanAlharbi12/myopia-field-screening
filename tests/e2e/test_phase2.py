#!/usr/bin/env python3
"""Phase 2 automated tests (spec tests 1-35 where they can run locally).

Runs the application in Chromium against the local test stand-in
(tests/harness/server.ts): the real database schema, RLS, functions and
triggers on PostgreSQL 16, and the real Edge Function code.
All people, schools and values here are fictional test data.

    python3 tests/e2e/test_phase2.py
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time

import openpyxl
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import harness as h  # noqa: E402

OUT = os.environ.get('MFS_E2E_OUT', '/tmp/mfs-e2e')
os.makedirs(OUT, exist_ok=True)
R = h.Results()
ok = R.check

ADMIN = ('admin@test.invalid', 'AdminPass123', 'مدير الاختبار')
EXAM = ('examiner@test.invalid', 'TempPass123', 'فاحص الاختبار')
EXAM_NEW = 'ExamPass456'


# ---------------------------------------------------------------- helpers
class Device:
    def __init__(self, browser, name, viewport=(1280, 900), **kw):
        self.ctx = browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]}, accept_downloads=True, **kw)
        self.name = name
        self.errors = []
        self.page = self.new_page()

    def new_page(self):
        p = self.ctx.new_page()
        p.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)))
        p.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' and 'ERR_INTERNET_DISCONNECTED' not in m.text and 'Failed to load resource' not in m.text else None)
        return p

    def close(self):
        self.ctx.close()


def login(pg, email, pw, expect='.home-head'):
    pg.goto(h.ORIGIN + '/#/')
    pg.wait_for_selector('#li-email', timeout=10000)
    pg.fill('#li-email', email)
    pg.fill('#li-pw', pw)
    pg.click('[data-submit]')
    if expect:
        pg.wait_for_selector(expect, timeout=10000)


def wait_synced(pg, timeout=10000):
    pg.wait_for_timeout(150)
    pg.wait_for_function("""() => { const e = document.querySelector('[data-save]'); const c = MF.app.current && MF.app.current.instance;
        return e && e.classList.contains('is-saved') && (!c || !c.hasUnsaved || !c.hasUnsaved()) && MF.sync.status().pending === 0; }""", timeout=timeout)


def save_state(pg):
    el = pg.locator('[data-save]')
    return el.inner_text().strip() if el.count() else ''


def one(q, params=None):
    rows = h.sql(q, params or [])
    return rows[0] if rows else None


def click_opt(scope, text):
    scope.get_by_role('radio', name=text, exact=True).first.click()
    scope.page.wait_for_timeout(80)


def type_picker(pg, field, value):
    w = pg.locator('[data-picker="%s"] .mp-wheel' % field)
    w.scroll_into_view_if_needed()
    w.focus()
    pg.keyboard.type(value)
    pg.wait_for_selector('.pl-input')
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(400)


def complete_station(pg):
    pg.locator('[data-act="complete"]').click()
    pg.wait_for_timeout(200)
    force = pg.locator('[data-act="complete-force"]')
    if force.is_visible():
        force.click()
    pg.wait_for_selector('[data-cb-done]:not([hidden])', timeout=5000)


def open_participant(pg, pid, station='registration', part=None):
    pg.goto(h.ORIGIN + '/#/p/%s/%s%s' % (pid, station, '/' + part if part else ''))
    pg.wait_for_selector('.ctx .pid-lg', timeout=10000)
    pg.wait_for_timeout(300)


def school_page(pg, sid):
    pg.goto(h.ORIGIN + '/#/school/' + sid)
    pg.wait_for_selector('.school-head', timeout=10000)
    pg.wait_for_timeout(300)


def add_participant(pg):
    pg.locator('[data-act="add"]').click()
    pg.wait_for_selector('.ctx .pid-lg', timeout=10000)
    return pg.locator('.ctx .pid-lg').inner_text().strip(), pg.evaluate('() => MF.app.current.route.pid')


def set_counter(pg, n):
    pg.locator('[data-act="counter"]').click()
    pg.wait_for_selector('#cn-in')
    pg.fill('#cn-in', str(n))
    pg.locator('.ov-actions .btn-primary').click()
    pg.wait_for_timeout(600)


def block_server(pg, blocked):
    pat = ['**/test/rest', '**/test/rpc', '**/auth/v1/health', '**/functions/v1/**']
    for p_ in pat:
        if blocked:
            pg.route(p_, lambda route: route.abort('internetdisconnected'))
        else:
            pg.unroute(p_)


def no_hscroll(pg):
    # compare with the device width: on mobile the layout viewport grows when something overflows
    return pg.evaluate('() => document.scrollingElement.scrollWidth <= document.documentElement.clientWidth + 1 && window.scrollX === 0 && window.innerWidth <= screen.width + 1')


# ---------------------------------------------------------------- tests
def run(browser):
    st = {}

    # ---------- TEST 1 — fresh database ----------
    counts = one("""select
      (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE')::int as tables,
      (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)::int as rls,
      (select count(*) from pg_policies where schemaname='public')::int as policies,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')::int as functions,
      (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgname not like '99_test%')::int as triggers,
      (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public')::int as realtime,
      (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public')::int as constraints,
      (select count(*) from pg_indexes where schemaname='public')::int as indexes,
      (select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public')::int as rows_est""")
    data_rows = sum(one('select count(*)::int as n from public.%s' % t)['n'] for t in ['schools', 'participants', 'profiles', 'audit_log', 'registration'])
    ok('T1 all 17 tables exist with RLS enabled on every table', counts['tables'] == 17 and counts['rls'] == 17, counts)
    ok('T1 policies, functions, triggers, constraints, indexes present', counts['policies'] >= 25 and counts['functions'] >= 30 and counts['triggers'] >= 30 and counts['constraints'] >= 60 and counts['indexes'] >= 20, counts)
    ok('T1 realtime publication has the 14 application tables', counts['realtime'] == 14, counts['realtime'])
    ok('T1 no demo records', data_rows == 0, data_rows)

    # ---------- TEST 2 — first admin (dashboard user + bootstrap SQL) ----------
    h.sql("insert into auth.users (id, email, encrypted_password, email_confirmed_at) values (gen_random_uuid(), $1, extensions.crypt($2, extensions.gen_salt('bf')), now())", [ADMIN[0], ADMIN[1]])
    boot = open(os.path.join(h.ROOT, 'supabase/bootstrap_first_admin.sql'), encoding='utf-8').read().replace(":= 'REPLACE_WITH_ADMIN_EMAIL'", ":= '%s'" % ADMIN[0]).replace(":= 'مدير النظام'", ":= '%s'" % ADMIN[2])
    with tempfile.NamedTemporaryFile('w', suffix='.sql', delete=False, encoding='utf-8') as f:
        f.write(boot)
    r = h.psql(h.DB, '-f', f.name, check=False)
    ok('T2 bootstrap script creates the first Administrator', r.returncode == 0 and 'Administrator ready' in r.stderr, r.stderr[-300:])
    r2 = h.psql(h.DB, '-f', f.name, check=False)
    ok('T2 bootstrap refuses to run again', r2.returncode != 0 and 'already exists' in r2.stderr)
    A = Device(browser, 'A')
    login(A.page, ADMIN[0], ADMIN[1])
    ok('T2 admin login succeeds and the application opens', A.page.locator('.home-head').is_visible())
    A.page.locator('[data-act="account"]').click()
    ok('T2 account menu shows administration for the Administrator', A.page.locator('.menu-item', has_text='إدارة النظام').count() == 1)
    A.page.keyboard.press('Escape')

    # ---------- TEST 3 — anonymous security ----------
    anon = [h.post('/test/rest', {'table': t, 'op': 'select', 'filters': [], 'columns': '*'}, None)[1] for t in ['schools', 'participants', 'registration', 'questionnaire_responses', 'profiles', 'audit_log']]
    ok('T3 anonymous REST reads are refused', all(x.get('error') and x['error']['code'] == '42501' for x in anon), [x.get('error') for x in anon])
    rp = h.post('/test/rpc', {'name': 'create_school', 'args': {'p_name': 'x', 'p_city': 'y', 'p_type': 'boys'}}, None)[1]
    ok('T3 anonymous function calls are refused', rp.get('error') and rp['error']['code'] == '42501', rp)
    fn = h.post('/functions/v1/admin-create-user', {'email': 'x@test.invalid', 'full_name': 'x', 'role': 'admin', 'password': 'Abcdefg123'}, None)
    ok('T3 anonymous Edge Function call is refused', fn[0] == 401, fn)
    anon_dev = Device(browser, 'anon')
    anon_dev.page.goto(h.ORIGIN + '/#/admin')
    anon_dev.page.wait_for_selector('#li-email')
    ok('T3 without a session the app shows only the sign-in screen', anon_dev.page.locator('.p-row, .school-list, .tbl').count() == 0)
    anon_dev.close()

    # schools for the following tests (created through the UI)
    def create_school(pg, name, city, typ):
        pg.goto(h.ORIGIN + '/#/')
        pg.wait_for_selector('.home-head')
        pg.locator('[data-act="create"]:visible').first.click()
        pg.fill('#sc-name', name)
        pg.fill('#sc-city', city)
        pg.locator('.ov [data-type]', has_text=typ).click()
        pg.locator('.ov-actions .btn-primary').click()
        pg.wait_for_selector('.school-head')
        return pg.evaluate('() => MF.app.current.route.schoolId')
    st['s1'] = create_school(A.page, 'مدرسة الاختبار الأولى', 'الرياض', 'بنين')
    st['s2'] = create_school(A.page, 'مدرسة الاختبار الثانية', 'جدة', 'بنات')
    ok('T8 admin creates schools 1 and 2', [x['number'] for x in h.sql('select number from schools order by number')] == [1, 2])

    # ---------- TEST 4 — create user ----------
    A.page.goto(h.ORIGIN + '/#/admin/users')
    A.page.wait_for_selector('[data-u="add"]')
    ok('T4 page title إدارة المستخدمين', 'إدارة المستخدمين' in A.page.locator('.page-title').inner_text())
    A.page.locator('[data-u="add"]').click()
    A.page.fill('#nu-name', EXAM[2])
    A.page.fill('#nu-email', EXAM[0])
    A.page.fill('#nu-pw', EXAM[1])
    A.page.fill('#nu-pw2', EXAM[1])
    A.page.locator('.ov-actions .btn-primary').click()
    A.page.wait_for_selector('.toast:has-text("تم إنشاء المستخدم بنجاح")', timeout=10000)
    ok('T4 success message تم إنشاء المستخدم بنجاح', True)
    A.page.wait_for_selector('.tbl tr:has-text("%s")' % EXAM[0], timeout=10000)
    prof = one('select p.role::text, p.must_change_password, p.active, (select count(*) from auth.users u where u.id = p.id)::int as auth from profiles p where email = $1', [EXAM[0]])
    ok('T4 Auth account + profile, role Examiner, must_change_password', prof and prof['auth'] == 1 and prof['role'] == 'examiner' and prof['must_change_password'] is True and prof['active'] is True, prof)
    audit = one("select metadata::text as m from audit_log where action = 'user.create'")
    ok('T4 audited without the password', audit and EXAM[1] not in audit['m'] and 'password' not in audit['m'], audit)
    A.page.locator('[data-u="add"]').click()
    A.page.fill('#nu-name', 'مكرر')
    A.page.fill('#nu-email', EXAM[0].upper())
    A.page.fill('#nu-pw', 'OtherPass123')
    A.page.fill('#nu-pw2', 'OtherPass123')
    A.page.locator('.ov-actions .btn-primary').click()
    A.page.wait_for_timeout(1200)
    ok('T4 duplicate email gives a clean error', 'يوجد حساب بهذا البريد' in A.page.locator('.ov .field-error').inner_text())
    A.page.keyboard.press('Escape')
    A.page.wait_for_timeout(300)

    # ---------- TEST 5 — first login forces a password change ----------
    B = Device(browser, 'B')
    login(B.page, EXAM[0], EXAM[1], expect='#pw-cur')
    ok('T5 forced password-change screen', 'تغيير كلمة المرور مطلوب' in B.page.locator('main').inner_text())
    blocked = h.post('/test/rest', {'table': 'schools', 'op': 'select', 'filters': [], 'columns': '*'}, h.token(EXAM[0], EXAM[1]))[1]
    ok('T5 no research access before the change (RLS)', blocked.get('data') == [], blocked)
    B.page.fill('#pw-cur', EXAM[1])
    B.page.fill('#pw-new', 'short')
    B.page.fill('#pw-new2', 'short')
    B.page.locator('[data-submit]').click()
    ok('T5 weak password refused', '8 أحرف' in B.page.locator('.field-error').inner_text())
    B.page.fill('#pw-new', EXAM_NEW)
    B.page.fill('#pw-new2', EXAM_NEW)
    B.page.locator('[data-submit]').click()
    B.page.wait_for_selector('.home-head', timeout=10000)
    ok('T5 after the change, access granted', B.page.locator('.school-list').count() == 1)
    ok('T5 must_change_password cleared', one('select must_change_password from profiles where email=$1', [EXAM[0]])['must_change_password'] is False)

    # ---------- TEST 6 — examiner permissions (interface) ----------
    ok('T6 examiner sees no create-school / export-all', B.page.locator('[data-act="create"], [data-act="export-all"]').count() == 0)
    B.page.goto(h.ORIGIN + '/#/admin/users')
    B.page.wait_for_timeout(800)
    ok('T6 examiner cannot open user management (redirected)', B.page.locator('[data-u="add"]').count() == 0 and B.page.locator('.home-head').count() == 1)
    school_page(B.page, st['s1'])
    ok('T6 no counter control for examiner', B.page.locator('[data-act="counter"]').count() == 0)
    B.page.locator('[data-act="menu"]').click()
    items = B.page.locator('.menu-item').all_inner_texts()
    B.page.keyboard.press('Escape')
    ok('T6 school menu has no counter / archive / edit', not any(('عداد' in x or 'أرشفة' in x or 'تعديل' in x) for x in items), items)
    code, pid = add_participant(B.page)
    ok('T6 examiner can add a participant (1-1)', code == '1-1', code)
    st['p1'] = pid
    B.page.locator('input[data-b="n"]').fill('مشارك تجريبي أول')
    B.page.locator('input[data-b="s|registration|age"]').fill('13')
    click_opt(B.page.locator('[data-b="s|registration|class_level"]'), 'الثاني متوسط')
    wait_synced(B.page)
    open_participant(B.page, pid, 'autoref')
    type_picker(B.page, 'od_sph', '-1.50')
    wait_synced(B.page)
    ok('T6 examiner can enter clinical data (stored on the server)', float(one('select od_sph from autorefraction where participant_id=$1::uuid', [pid])['od_sph']) == -1.5)
    B.page.locator('[data-act="pmenu"]').click()
    pitems = B.page.locator('.menu-item').all_inner_texts()
    B.page.keyboard.press('Escape')
    ok('T6 examiner cannot edit Participant ID or archive', not any(('تعديل رقم' in x or 'أرشفة' in x) for x in pitems), pitems)

    # ---------- TEST 7 — frontend tampering (examiner calls admin operations directly) ----------
    tam = B.page.evaluate("""async (a) => {
        const out = {};
        const r1 = await MF.sb.rpc('set_next_participant_number', { p_school_id: a.s, p_next: 50, p_reset: false }); out.counter = r1.error && r1.error.message;
        const r2 = await MF.sb.rpc('change_participant_seq', { p_participant_id: a.p, p_new_seq: 77 }); out.editId = r2.error && r2.error.message;
        const r3 = await MF.sb.rpc('set_school_archived', { p_school_id: a.s, p_archived: true }); out.archive = r3.error && r3.error.message;
        const r4 = await MF.sb.rpc('admin_set_user_role', { p_user_id: a.u, p_role: 'admin' }); out.role = r4.error && r4.error.message;
        const r5 = await MF.sb.from('schools').update({ next_participant_seq: 50 }).eq('id', a.s).select(); out.direct = r5.error ? r5.error.code : 'rows=' + (r5.data || []).length;
        const r6 = await MF.sb.from('profiles').update({ role: 'admin' }).eq('id', a.u).select(); out.self = r6.error ? r6.error.code : 'rows=' + (r6.data || []).length;
        const r7 = await MF.sb.functions.invoke('admin-create-user', { body: { email: 'evil@test.invalid', full_name: 'x', role: 'admin', password: 'Abcdefg123' } }); out.fn = r7.error ? r7.error.context.status : 'ok';
        const r8 = await MF.sb.rpc('admin_import', { p_payload: { schools: [], participants: [] }, p_dry_run: true, p_source: 'x' }); out.imp = r8.error && r8.error.message;
        return out; }""", {'s': st['s1'], 'p': pid, 'u': one('select id::text from profiles where email=$1', [EXAM[0]])['id']})
    ok('T7 examiner tampering refused by the database/server', tam['counter'] == 'MFS:NOT_ADMIN' and tam['editId'] == 'MFS:NOT_ADMIN' and tam['archive'] == 'MFS:NOT_ADMIN' and tam['role'] == 'MFS:NOT_ADMIN'
       and tam['direct'] == '42501' and tam['self'] == '42501' and tam['fn'] == 403 and tam['imp'] == 'MFS:NOT_ADMIN', tam)
    ok('T7 nothing changed', one('select next_participant_seq, archived from schools where id=$1::uuid', [st['s1']]) == {'next_participant_seq': 2, 'archived': False}
       and one('select count(*)::int as n from profiles where role=\'admin\'')['n'] == 1)

    # ---------- TEST 10 — participant concurrency (two browsers) ----------
    school_page(A.page, st['s1'])
    school_page(B.page, st['s1'])
    A.page.evaluate("() => { window.__go = () => document.querySelector('[data-act=add]').click(); }")
    B.page.evaluate("() => { window.__go = () => document.querySelector('[data-act=add]').click(); }")
    A.page.evaluate('() => window.__go()')
    B.page.evaluate('() => window.__go()')
    A.page.wait_for_selector('.ctx .pid-lg', timeout=10000)
    B.page.wait_for_selector('.ctx .pid-lg', timeout=10000)
    ca, cb = A.page.locator('.ctx .pid-lg').inner_text().strip(), B.page.locator('.ctx .pid-lg').inner_text().strip()
    ok('T10 simultaneous add -> different IDs (1-2, 1-3)', sorted([ca, cb]) == ['1-2', '1-3'], (ca, cb))
    ok('T10 no duplicate in the database', one('select count(*)::int as n, count(distinct code)::int as d from participants')['n'] == one('select count(distinct code)::int as d from participants')['d'])

    # ---------- TEST 11 / 12 — counter ----------
    school_page(A.page, st['s1'])
    set_counter(A.page, 20)
    code20, p20 = add_participant(A.page)
    ok('T11 new participant uses the new number (1-20)', code20 == '1-20', code20)
    ok('T11 existing IDs unchanged', [x['code'] for x in h.sql('select code from participants order by seq')] == ['1-1', '1-2', '1-3', '1-20'])
    school_page(A.page, st['s1'])
    A.page.locator('[data-act="counter"]').click()
    A.page.wait_for_selector('#cn-in')
    A.page.fill('#cn-in', '2')
    A.page.wait_for_timeout(200)
    warn = A.page.locator('.cn-warn').inner_text()
    ok('T12 dialog warns that 1-2 is already used', 'مستخدم مسبقًا' in warn, warn)
    A.page.locator('.ov-actions .btn-primary').click()
    A.page.wait_for_timeout(800)
    A.page.locator('[data-act="add"]').click()
    A.page.wait_for_selector('.ov-panel:has-text("رقم المشارك موجود مسبقًا. يرجى تعديل العداد.")', timeout=8000)
    ok('T12 creating with a used number is blocked with the approved message', True)
    ok('T12 no overwrite (1-2 unchanged, still 4 participants)', one("select count(*)::int as n from participants")['n'] == 4 and one("select count(*)::int as n from participants where code='1-2'")['n'] == 1)
    A.page.keyboard.press('Escape')
    set_counter(A.page, 21)

    # ---------- TEST 13 — two devices, same participant ----------
    pid = st['p1']
    open_participant(A.page, pid, 'autoref')
    open_participant(B.page, pid, 'autoref')
    B.page.wait_for_timeout(500)
    type_picker(A.page, 'od_cyl', '-0.75')
    type_picker(A.page, 'od_axis', '90')
    complete_station(A.page)
    wait_synced(A.page)
    B.page.wait_for_function("() => { const a = [...document.querySelectorAll('.sn-item')][1]; return a && a.querySelector('.ring-completed'); }", timeout=8000)
    ok('T13 device B receives the completed station status', True)
    b_cyl = B.page.locator('[data-picker="od_cyl"] .mp-wheel').get_attribute('aria-valuetext')
    ok('T13 device B shows device A\'s value', b_cyl == '−0.75', b_cyl)

    # ---------- TEST 14 — different stations at the same time ----------
    open_participant(B.page, pid, 'questionnaire', 'C')
    type_picker(A.page, 'os_sph', '-2.25')
    B.page.locator('.qq').first.locator('.opt', has_text='أقل من ساعة').click()
    wait_synced(A.page)
    wait_synced(B.page)
    row = one("select a.os_sph, q.answers::text as ans from autorefraction a join questionnaire_responses q using (participant_id) where participant_id=$1::uuid", [pid])
    ok('T14 both edits survive (autorefraction + questionnaire)', float(row['os_sph']) == -2.25 and 'lt1' in row['ans'] or float(row['os_sph']) == -2.25 and 'أقل' in row['ans'], row)

    # ---------- TEST 19 — referral appears live on the other device's list ----------
    school_page(B.page, st['s1'])
    open_participant(A.page, p20, 'va')
    type_picker(A.page, 'vasc_od', '6/12')
    wait_synced(A.page)
    B.page.wait_for_function("(code) => [...document.querySelectorAll('.p-row')].some(r => r.querySelector('.pid') && r.querySelector('.pid').textContent.trim() === code && r.querySelector('.badge-warn'))", arg='1-20', timeout=8000)
    ok('T19 device B list shows إحالة for 1-20 without reloading', True)
    ok('T19 server summary has the referral', one('select referral_va, referral_alert from participant_summary where participant_id=$1::uuid', [p20]) == {'referral_va': True, 'referral_alert': True})

    # ---------- TEST 15 / 16 — offline edit, reload, reconnect ----------
    open_participant(B.page, p20, 'va')
    B.page.wait_for_timeout(300)
    B.ctx.set_offline(True)
    B.page.wait_for_timeout(300)
    type_picker(B.page, 'vasc_os', '6/18')
    B.page.wait_for_timeout(800)
    ok('T15 offline indicator: غير متصل — محفوظ محليًا', 'غير متصل' in save_state(B.page), save_state(B.page))
    q = B.page.evaluate("() => MF.sync.outbox().then(l => l.map(e => [e.table, e.patch]))")
    ok('T15 change queued in the persistent outbox', any(t == 'visual_acuity' and p.get('vasc_os') == '6/18' for t, p in q), q)
    ok('T15 not on the server yet', one('select vasc_os from visual_acuity where participant_id=$1::uuid', [p20])['vasc_os'] is None)
    # reload while the server is unreachable: the queue must survive
    B.ctx.set_offline(False)
    block_server(B.page, True)
    B.page.reload()
    B.page.wait_for_selector('.ctx .pid-lg', timeout=10000)
    B.page.wait_for_timeout(800)
    q2 = B.page.evaluate("() => MF.sync.outbox().then(l => l.length)")
    ok('T15 queued change survives a reload (server unreachable)', q2 >= 1 and 'غير متصل' in save_state(B.page), (q2, save_state(B.page)))
    va_os = B.page.locator('[data-picker="vasc_os"] .mp-wheel').get_attribute('aria-valuetext')
    ok('T15 form shows the locally saved value after reload', va_os == '6/18', va_os)
    block_server(B.page, False)
    B.page.evaluate('() => MF.net.check()')
    wait_synced(B.page, 15000)
    ok('T16 queued VA synchronised; Supabase has 6/18', one('select vasc_os from visual_acuity where participant_id=$1::uuid', [p20])['vasc_os'] == '6/18')

    # ---------- TEST 17 — offline add participant ----------
    school_page(B.page, st['s1'])
    before = one('select count(*)::int as n from participants')['n']
    B.ctx.set_offline(True)
    B.page.wait_for_timeout(300)
    B.page.locator('[data-act="add"]').click()
    B.page.wait_for_selector('.ov-panel')
    msg = B.page.locator('.ov-panel').inner_text()
    ok('T17 clear message: internet required for a safe Participant ID', 'يتطلب إنشاء مشارك جديد اتصالًا بالإنترنت لحجز رقم المشارك بشكل آمن.' in msg, msg)
    B.page.keyboard.press('Escape')
    ok('T17 no participant created, no temporary ID', one('select count(*)::int as n from participants')['n'] == before and B.page.locator('.ctx .pid-lg').count() == 0)
    B.ctx.set_offline(False)
    B.page.wait_for_timeout(500)

    # ---------- TEST 18 — conflict ----------
    open_participant(B.page, p20, 'va')
    open_participant(A.page, p20, 'va')
    B.ctx.set_offline(True)
    B.page.wait_for_timeout(300)
    type_picker(B.page, 'ph_od', '6/9')           # stale offline edit
    type_picker(A.page, 'ph_od', '6/7.5')         # same field, online, other device
    wait_synced(A.page)
    B.ctx.set_offline(False)
    B.page.evaluate('() => MF.net.check()')
    B.page.wait_for_function("() => document.querySelector('[data-save]').textContent.includes('تعارض')", timeout=12000)
    ok('T18 conflict detected and shown', 'تعارض' in save_state(B.page))
    ok('T18 no silent overwrite (server keeps the other device value)', one('select ph_od from visual_acuity where participant_id=$1::uuid', [p20])['ph_od'] == '6/7.5')
    B.page.locator('[data-conflict] [data-act="conflict"]').click()
    B.page.wait_for_selector('.cf-row')
    both = B.page.locator('.cf-row').first.inner_text()
    ok('T18 dialog shows both values', '6/9' in both and '6/7.5' in both, both)
    B.page.locator('.ov-actions .btn', has_text='اعتماد نسخة هذا الجهاز').click()
    wait_synced(B.page, 12000)
    ok('T18 resolution applied (kept this device value)', one('select ph_od from visual_acuity where participant_id=$1::uuid', [p20])['ph_od'] == '6/9')

    # ---------- TEST 22 — questionnaire survives save, reload, another device, export ----------
    open_participant(A.page, pid, 'questionnaire', 'C')
    A.page.wait_for_timeout(500)
    first = A.page.locator('.qq').first
    first.locator('.opt', has_text='أكثر من ساعة').click()
    A.page.wait_for_timeout(200)
    first.locator('.dur-h input').fill('2.5')
    first.locator('.dur-h input').blur()
    wait_synced(A.page)
    A.page.reload()
    A.page.wait_for_selector('.qq')
    A.page.wait_for_timeout(500)
    v1 = A.page.locator('.qq').first.locator('.dur-h input').input_value()
    open_participant(B.page, pid, 'questionnaire', 'C')
    v2 = B.page.locator('.qq').first.locator('.dur-h input').input_value()
    ok('T22 answer survives reload and is visible on another device', v1 == '2.5' and v2 == '2.5', (v1, v2))
    qv = one("select questionnaire_version, answers::text as a from questionnaire_responses where participant_id=$1::uuid", [pid])
    ok('T22 stored as JSONB with questionnaire_version 1', qv['questionnaire_version'] == 1 and '2.5' in qv['a'], qv)

    # ---------- TEST 20 — Excel for the school (canonical source) ----------
    school_page(B.page, st['s1'])
    with B.page.expect_download(timeout=20000) as d:
        B.page.locator('[data-act="export"]').click()
    x1 = os.path.join(OUT, 'school1.xlsx')
    d.value.save_as(x1)
    wb = openpyxl.load_workbook(x1)
    ok('T20 approved sheets', wb.sheetnames == ['Participants', 'Family', 'Questionnaire'], wb.sheetnames)
    P = wb['Participants']
    hdr = [c.value for c in P[1]]
    expected_cols = B.page.evaluate('() => MF.ExportService.PARTICIPANT_COLUMNS')
    ok('T20 approved column structure', hdr == expected_cols, (len(hdr), len(expected_cols)))
    ids = [P.cell(r, hdr.index('Participant_ID') + 1).value for r in range(2, P.max_row + 1)]
    ok('T20 all active participants of the school from the server', ids == ['1-1', '1-2', '1-3', '1-20'], ids)
    pidx = hdr.index('Participant_ID') + 1
    rows = {P.cell(r, pidx).value: {hdr[i]: P.cell(r, i + 1).value for i in range(len(hdr))} for r in range(2, P.max_row + 1)}
    ok('T20 values come from Supabase (1-1 OD sphere -1.5, cyl -0.75; 1-20 VAsc OS 6/18)', rows['1-1']['Autoref_OD_Sphere'] == -1.5 and rows['1-1']['Autoref_OD_Cylinder'] == -0.75 and rows['1-20']['VAsc_OS'] == '6/18',
       (rows['1-1']['Autoref_OD_Sphere'], rows['1-1']['Autoref_OD_Cylinder'], rows['1-20']['VAsc_OS']))
    allv = [str(c.value) for ws in wb for row_ in ws.iter_rows() for c in row_ if c.value is not None]
    ok('T20 participant names absent', not any('مشارك تجريبي' in v for v in allv))
    ok('T22 questionnaire answer exported', any('2.5' in v for v in [str(c.value) for c in wb['Questionnaire'][3] if c.value is not None]))

    # ---------- TEST 21 — global export (Administrator) ----------
    school_page(A.page, st['s2'])
    _, pg2 = add_participant(A.page)
    A.page.goto(h.ORIGIN + '/#/')
    A.page.wait_for_selector('[data-act="export-all"]:visible')
    with A.page.expect_download(timeout=20000) as d2:
        A.page.locator('[data-act="export-all"]').click()
    x2 = os.path.join(OUT, 'all.xlsx')
    d2.value.save_as(x2)
    P2 = openpyxl.load_workbook(x2)['Participants']
    h2 = [c.value for c in P2[1]]
    ids2 = [P2.cell(r, h2.index('Participant_ID') + 1).value for r in range(2, P2.max_row + 1)]
    ok('T21 all schools in one workbook (complete shared data)', ids2 == ['1-1', '1-2', '1-3', '1-20', '2-1'], ids2)

    # ---------- TEST 8 / 23 — admin operations, archive ----------
    open_participant(A.page, h.sql("select id::text from participants where code='1-3'")[0]['id'])
    A.page.locator('[data-act="pmenu"]').click()
    A.page.locator('.menu-item', has_text='أرشفة المشارك').click()
    A.page.locator('.ov-actions .btn-danger').click()
    A.page.wait_for_selector('.school-head', timeout=10000)
    A.page.wait_for_timeout(500)
    codes = A.page.locator('.p-row .pid').all_inner_texts()
    ok('T23 archived participant removed from the active list', '1-3' not in [c.strip() for c in codes], codes)
    ok('T23 record remains in the database (archived)', one("select archived from participants where code='1-3'")['archived'] is True)
    set_counter(A.page, 3)
    A.page.locator('[data-act="add"]').click()
    A.page.wait_for_selector('.ov-panel:has-text("رقم المشارك موجود مسبقًا")', timeout=8000)
    ok('T23 archived ID cannot be reused (creation refused)', one("select count(*)::int as n from participants where seq = 3 and school_id=$1::uuid", [st['s1']])['n'] == 1)
    A.page.keyboard.press('Escape')
    set_counter(A.page, 21)
    A.page.goto(h.ORIGIN + '/#/admin/archive')
    A.page.wait_for_selector('[data-rp]')
    A.page.locator('[data-rp]').first.click()
    A.page.wait_for_timeout(1000)
    ok('T23 restore works', one("select archived from participants where code='1-3'")['archived'] is False)
    A.page.goto(h.ORIGIN + '/#/admin/audit')
    A.page.wait_for_selector('.tbl')
    A.page.wait_for_timeout(500)
    at = A.page.locator('.tbl').inner_text()
    ok('T8 audit log lists administrative actions', 'أرشفة مشارك' in at and 'تعديل عداد المشاركين' in at and 'إنشاء مستخدم' in at, at[:200])

    # ---------- TEST 26 — password reset ----------
    A.page.goto(h.ORIGIN + '/#/admin/users')
    A.page.wait_for_selector('.tbl')
    A.page.locator('tr', has_text=EXAM[0]).locator('[data-u="menu"]').click()
    A.page.locator('.menu-item', has_text='إعادة تعيين كلمة المرور').click()
    A.page.fill('#rp-pw', 'ResetPass789')
    A.page.fill('#rp-pw2', 'ResetPass789')
    A.page.locator('.ov-actions .btn-primary').click()
    A.page.wait_for_timeout(1200)
    ok('T26 must_change_password true after reset', one('select must_change_password from profiles where email=$1', [EXAM[0]])['must_change_password'] is True)
    C = Device(browser, 'C')
    login(C.page, EXAM[0], 'ResetPass789', expect='#pw-cur')
    C.page.fill('#pw-cur', 'ResetPass789')
    C.page.fill('#pw-new', 'FinalPass321')
    C.page.fill('#pw-new2', 'FinalPass321')
    C.page.locator('[data-submit]').click()
    C.page.wait_for_selector('.home-head', timeout=10000)
    ok('T26 forced change after reset works', one('select must_change_password from profiles where email=$1', [EXAM[0]])['must_change_password'] is False)
    C.close()

    # ---------- TEST 27 — last administrator ----------
    A.page.goto(h.ORIGIN + '/#/admin/users')
    A.page.wait_for_selector('.tbl')
    A.page.locator('tr', has_text=ADMIN[0]).locator('[data-u="menu"]').click()
    A.page.locator('.menu-item', has_text='تغيير الدور').click()
    A.page.locator('.ov-actions .btn-danger').click()
    A.page.wait_for_timeout(1000)
    msg = A.page.locator('.ov-panel').inner_text() if A.page.locator('.ov-panel').count() else ''
    ok('T27 last active Administrator cannot be demoted', 'آخر مدير' in msg and one('select role::text from profiles where email=$1', [ADMIN[0]])['role'] == 'admin', msg)
    A.page.keyboard.press('Escape')
    A.page.wait_for_timeout(300)
    A.page.locator('tr', has_text=ADMIN[0]).locator('[data-u="menu"]').click()
    A.page.locator('.menu-item', has_text='تعطيل الحساب').click()
    A.page.locator('.ov-actions .btn-danger').click()
    A.page.wait_for_timeout(1200)
    msg2 = A.page.locator('.ov-panel').inner_text() if A.page.locator('.ov-panel').count() else ''
    ok('T27 last active Administrator cannot be disabled', 'آخر مدير' in msg2 and one('select active from profiles where email=$1', [ADMIN[0]])['active'] is True, msg2)
    A.page.keyboard.press('Escape')

    # ---------- TEST 24 — session survives closing the page ----------
    B.page.close()
    B.page = B.new_page()
    B.page.goto(h.ORIGIN + '/#/')
    B.page.wait_for_selector('.home-head', timeout=10000)
    ok('T24 reopened browser keeps a valid session', B.page.locator('#li-email').count() == 0)

    # ---------- TEST 9 — disable user ----------
    A.page.goto(h.ORIGIN + '/#/admin/users')
    A.page.wait_for_selector('.tbl')
    A.page.locator('tr', has_text=EXAM[0]).locator('[data-u="menu"]').click()
    A.page.locator('.menu-item', has_text='تعطيل الحساب').click()
    A.page.locator('.ov-actions .btn-danger').click()
    A.page.wait_for_timeout(1200)
    ok('T9 profile disabled and Auth user banned', one('select p.active, (u.banned_until > now()) as banned from profiles p join auth.users u on u.id=p.id where p.email=$1', [EXAM[0]]) == {'active': False, 'banned': True})
    uid = one('select id::text from profiles where email=$1', [EXAM[0]])['id']
    B.page.reload()
    B.page.wait_for_selector('#li-email', timeout=10000)
    ok('T9 disabled user is signed out with a message', 'معطّل' in B.page.locator('main').inner_text())
    dbs = B.page.evaluate('() => indexedDB.databases ? indexedDB.databases().then(l => l.map(d => d.name)) : []')
    ok('T9 disabled user\'s cached research data removed from the device', ('mfs-cache-' + uid) not in dbs, dbs)
    r_old = h.post('/test/rest', {'table': 'participants', 'op': 'select', 'filters': [], 'columns': '*'}, h.token(ADMIN[0], ADMIN[1]))  # admin still fine
    ok('T9 Administrator unaffected', len(r_old[1]['data']) >= 5)
    login(B.page, EXAM[0], 'FinalPass321', expect=None)
    B.page.wait_for_timeout(1500)
    ok('T9 disabled user cannot sign in again', B.page.locator('.home-head').count() == 0)
    A.page.locator('tr', has_text=EXAM[0]).locator('[data-u="menu"]').click()
    A.page.locator('.menu-item', has_text='إعادة تفعيل').click()
    A.page.wait_for_timeout(1200)
    ok('T9 reactivation restores access', one('select active from profiles where email=$1', [EXAM[0]])['active'] is True)

    # ---------- TEST 25 — sign-out removes the cache ----------
    login(B.page, EXAM[0], 'FinalPass321')
    open_participant(B.page, pid, 'va')
    B.page.goto(h.ORIGIN + '/#/')
    B.page.wait_for_selector('.home-head')
    B.page.locator('[data-act="account"]').click()
    B.page.locator('.menu-item', has_text='تسجيل الخروج').click()
    B.page.locator('.ov-actions .btn-primary').click()
    B.page.wait_for_selector('#li-email', timeout=10000)
    left = B.page.evaluate("""() => Promise.all([indexedDB.databases ? indexedDB.databases() : [], Object.keys(localStorage)]).then(r => ({ dbs: r[0].map(d => d.name), ls: r[1] }))""")
    ok('T25 sign-out deletes this user\'s cached data and session', not any(n.startswith('mfs-cache-') for n in left['dbs']) and 'mfs.auth' not in left['ls'] and 'mfs.profile' not in left['ls'], left)

    # unsynchronised changes are protected at sign-out
    login(B.page, EXAM[0], 'FinalPass321')
    open_participant(B.page, pid, 'va')
    B.ctx.set_offline(True)
    B.page.wait_for_timeout(300)
    type_picker(B.page, 'vasc_ou', '6/9')
    B.page.evaluate('() => MF.flushCurrent()')
    B.page.goto(h.ORIGIN + '/#/')
    B.page.wait_for_selector('.home-head')
    B.page.locator('[data-act="account"]').click()
    B.page.locator('.menu-item', has_text='تسجيل الخروج').click()
    B.page.wait_for_selector('.ov-panel')
    txt = B.page.locator('.ov-panel').inner_text()
    ok('T25 sign-out warns about unsynchronised changes and offers to keep them', 'لم تُزامن' in txt and 'الخروج مع إبقائها' in txt, txt[:120])
    B.page.keyboard.press('Escape')
    B.ctx.set_offline(False)
    B.page.evaluate('() => MF.net.check()')
    B.page.wait_for_function('() => MF.sync.status().pending === 0', timeout=15000)
    ok('T25 the queued change then synchronises', one('select vasc_ou from visual_acuity where participant_id=$1::uuid', [pid])['vasc_ou'] == '6/9')

    # ---------- TEST 28 — screen sizes ----------
    for label, vp in [('phone', (390, 844)), ('ipad-portrait', (820, 1180)), ('ipad-landscape', (1180, 820)), ('laptop', (1440, 900))]:
        D = Device(browser, label, vp, has_touch=label != 'laptop', is_mobile=label == 'phone')
        login(D.page, ADMIN[0], ADMIN[1])
        good = no_hscroll(D.page)
        D.page.screenshot(path=os.path.join(OUT, 'home_%s.png' % label))
        school_page(D.page, st['s1'])
        good = good and no_hscroll(D.page)
        D.page.screenshot(path=os.path.join(OUT, 'school_%s.png' % label))
        open_participant(D.page, pid, 'autoref')
        good = good and no_hscroll(D.page)
        D.page.screenshot(path=os.path.join(OUT, 'autoref_%s.png' % label))
        D.page.goto(h.ORIGIN + '/#/admin/users')
        D.page.wait_for_selector('.tbl')
        good = good and no_hscroll(D.page)
        D.page.screenshot(path=os.path.join(OUT, 'admin_%s.png' % label))
        ok('T28 %s: no horizontal page scroll on home, school, station, admin' % label, good)
        D.close()

    # ---------- TEST 35 — full field flow ----------
    F = Device(browser, 'F')
    login(F.page, EXAM[0], 'FinalPass321')
    school_page(F.page, st['s2'])
    code_f, pf = add_participant(F.page)
    F.page.locator('input[data-b="n"]').fill('مشاركة تجريبية كاملة')
    F.page.locator('input[data-b="s|registration|age"]').fill('14')
    click_opt(F.page.locator('[data-b="s|registration|class_level"]'), 'الثالث متوسط')
    open_participant(F.page, pf, 'registration', 'h')
    complete_station(F.page)
    open_participant(F.page, pf, 'autoref')
    for fld, v in [('od_sph', '-0.50'), ('od_cyl', '-0.25'), ('od_axis', '180'), ('os_sph', '-0.75'), ('os_cyl', '0.00'), ('os_axis', '0')]:
        type_picker(F.page, fld, v)
    complete_station(F.page)
    open_participant(F.page, pf, 'strabismus')
    for card in [0, 1]:
        click_opt(F.page.locator('.ct-card').nth(card), 'Ortho')
    click_opt(F.page.locator('[data-b="s|strabismus|eom_status"]'), 'Full')
    complete_station(F.page)
    open_participant(F.page, pf, 'va')
    for fld, v in [('vasc_od', '6/6'), ('vasc_os', '6/6'), ('vasc_ou', '6/6')]:
        type_picker(F.page, fld, v)
    complete_station(F.page)
    open_participant(F.page, pf, 'questionnaire', 'G')
    complete_station(F.page)
    wait_synced(F.page)
    summ = one('select status, current_station::text as cs from participant_summary where participant_id=$1::uuid', [pf])
    stations = [r['status'] for r in h.sql('select status::text from station_status where participant_id=$1::uuid order by station', [pf])]
    ok('T35 all five stations completed on the server', stations == ['completed'] * 5, stations)
    ok('T35 participant status Completed (server summary)', summ['status'] == 'completed', summ)
    school_page(F.page, st['s2'])
    with F.page.expect_download(timeout=20000) as d3:
        F.page.locator('[data-act="export"]').click()
    x3 = os.path.join(OUT, 'school2.xlsx')
    d3.value.save_as(x3)
    P3 = openpyxl.load_workbook(x3)['Participants']
    hdr3 = [c.value for c in P3[1]]
    rowf = {hdr3[i]: P3.cell(3, i + 1).value for i in range(len(hdr3))}
    ok('T35 export row complete (ID, values, Completed)', rowf['Participant_ID'] == code_f and rowf['Completion_Status'] == 'Completed' and rowf['Autoref_OD_Sphere'] == -0.5 and rowf['VAsc_OU'] == '6/6',
       {k: rowf.get(k) for k in ['Participant_ID', 'Completion_Status', 'Autoref_OD_Sphere', 'VAsc_OU']})
    F.close()

    for d in [A, B]:
        ok('no unexpected page errors on device ' + d.name, not d.errors, d.errors[:5])
        d.close()


def main():
    h.create_db()
    server = h.Server().start()
    try:
        h.reset()
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                run(browser)
            except Exception as e:
                import traceback
                traceback.print_exc()
                R.check('suite ran to the end', False, repr(e))
            browser.close()
        # TEST 31 — the RLS suite on the same database
        r = h.psql(h.DB, '-f', os.path.join(h.ROOT, 'supabase/tests/rls_tests.sql'), check=False)
        R.check('T31 RLS/security SQL suite: ALL PASSED', 'ALL PASSED' in r.stdout, r.stdout[-400:])
    finally:
        server.stop()
    sys.exit(0 if R.summary() else 1)


if __name__ == '__main__':
    main()
