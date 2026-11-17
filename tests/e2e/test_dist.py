#!/usr/bin/env python3
"""Production-build tests (spec tests 15 offline reload, 30 PWA update, 32, 33, 34).

Builds dist with the TEST stand-in client into tests/.dist-test (never deployed),
serves it with its Content-Security-Policy, and checks: the bundle runs under the
CSP, deep links and refresh work, the service worker serves the app offline, the
offline queue survives a real offline reload, a new build is offered and taken,
and no secret key is present in the output. Fictional data only.
"""
import os
import re
import subprocess
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import harness as h  # noqa: E402
from test_phase2 import Device, login, open_participant, type_picker, wait_synced, school_page, add_participant, one, save_state  # noqa: E402

R = h.Results()
ok = R.check
DIST = os.path.join(h.ROOT, 'tests', '.dist-test')
ENV = dict(os.environ, SUPABASE_URL=h.ORIGIN, SUPABASE_PUBLISHABLE_KEY='sb_publishable_localtest')


def build(label):
    r = subprocess.run(['node', 'build/build.mjs', '--out=tests/.dist-test', '--test-supabase-client=tests/harness/fake-supabase.js', '--build-label=' + label],
                       cwd=h.ROOT, env=ENV, capture_output=True, text=True)
    return r


def main():
    r = build('test-1')
    ok('T33 production build completes', r.returncode == 0 and 'secret scan: clean' in r.stdout, r.stdout + r.stderr)
    # T33: missing assets / unresolved references
    html = open(os.path.join(DIST, 'index.html'), encoding='utf-8').read()
    refs = re.findall(r'(?:src|href)="([^"#:]+)"', html)
    ok('T33 every file referenced by index.html exists', all(os.path.exists(os.path.join(DIST, x)) for x in refs), [x for x in refs if not os.path.exists(os.path.join(DIST, x))])
    sw = open(os.path.join(DIST, 'sw.js'), encoding='utf-8').read()
    pre = re.search(r'const PRECACHE = (\[.*?\]);', sw).group(1)
    import json
    ok('T33 every precached file exists', all(x == './' or os.path.exists(os.path.join(DIST, x)) for x in json.loads(pre)))
    # T32: no secret / service role material in the output or the frontend sources
    scan = subprocess.run(['grep', '-rEl', r'sb_secret_[A-Za-z0-9]|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["\x27][^"\x27]+', DIST], capture_output=True, text=True)
    ok('T32 no secret key strings in the build output', scan.stdout.strip() == '', scan.stdout)
    src = subprocess.run(['grep', '-rEl', r'sb_secret_[A-Za-z0-9]{6,}|service_role.{0,3}key\s*[:=]', os.path.join(h.ROOT, 'js'), os.path.join(h.ROOT, 'index.html'), os.path.join(h.ROOT, 'config.js')], capture_output=True, text=True)
    ok('T32 no secret key in frontend sources or config.js', src.stdout.strip() == '', src.stdout)
    todo = subprocess.run(['grep', '-rEn', r'\bTODO\b|FIXME|XXX', os.path.join(h.ROOT, 'js'), os.path.join(h.ROOT, 'css'), os.path.join(h.ROOT, 'supabase'), os.path.join(h.ROOT, 'build'), os.path.join(h.ROOT, 'index.html')], capture_output=True, text=True)
    ok('T33 no TODO / FIXME left', todo.stdout.strip() == '', todo.stdout[:300])

    h.create_db()
    server = h.Server(root=DIST).start()
    try:
        h.reset()
        h.make_user('admin@test.invalid', 'AdminPass123', 'مدير', 'admin')
        h.make_user('examiner@test.invalid', 'ExamPass123', 'فاحص', 'examiner')
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            A = Device(browser, 'A')
            csp_errors = []
            A.page.on('console', lambda m: csp_errors.append(m.text) if 'Content Security Policy' in m.text or 'Refused to' in m.text else None)
            login(A.page, 'admin@test.invalid', 'AdminPass123')
            ok('T34 login works on the production build (served with its CSP)', A.page.locator('.home-head').is_visible())
            # create a school and a participant through the UI
            A.page.locator('[data-act="create"]:visible').first.click()
            A.page.fill('#sc-name', 'مدرسة البناء')
            A.page.fill('#sc-city', 'الدمام')
            A.page.locator('.ov [data-type]', has_text='بنات').click()
            A.page.locator('.ov-actions .btn-primary').click()
            A.page.wait_for_selector('.school-head')
            sid = A.page.evaluate('() => MF.app.current.route.schoolId')
            code, pid = add_participant(A.page)
            ok('T33 production bundle: participant created (1-1)', code == '1-1', code)
            A.page.locator('input[data-b="s|registration|age"]').fill('12')
            wait_synced(A.page)
            ok('T34 no Content-Security-Policy violations', not csp_errors, csp_errors[:3])
            # direct refresh on deep links
            A.page.reload()
            A.page.wait_for_selector('.ctx .pid-lg')
            ok('T34 refresh on a deep link (#/p/…) works', A.page.locator('.ctx .pid-lg').inner_text().strip() == '1-1')
            A.page.goto(h.ORIGIN + '/some/unknown/path')
            A.page.wait_for_selector('.home-head', timeout=10000)
            ok('T34 unknown paths serve the application (SPA fallback)', True)
            # service worker active
            A.page.wait_for_function('() => navigator.serviceWorker && navigator.serviceWorker.controller', timeout=10000)
            ok('PWA service worker installed and controlling the page', True)
            # ---- T15 full: real offline reload through the service worker ----
            school_page(A.page, sid)
            A.page.locator('[data-act="menu"]').click()
            A.page.locator('.menu-item', has_text='تجهيز المدرسة').click()
            A.page.wait_for_selector('[data-ready]:has-text("مجهزة")', timeout=10000)
            ok('offline preparation of a school', True)
            open_participant(A.page, pid, 'va')
            A.ctx.set_offline(True)
            A.page.reload()
            A.page.wait_for_selector('.ctx .pid-lg', timeout=15000)
            ok('T15 app and participant open with no network at all (service worker + cache)', A.page.locator('.ctx .pid-lg').inner_text().strip() == '1-1')
            type_picker(A.page, 'vasc_od', '6/12')
            A.page.wait_for_timeout(600)
            ok('T15 offline edit saved locally (indicator)', 'غير متصل' in save_state(A.page), save_state(A.page))
            A.page.reload()
            A.page.wait_for_selector('.ctx .pid-lg', timeout=15000)
            A.page.wait_for_timeout(600)
            ok('T15 queued change survives a full offline reload', A.page.evaluate('() => MF.sync.outbox().then(l => l.length)') >= 1 and A.page.locator('[data-picker="vasc_od"] .mp-wheel').get_attribute('aria-valuetext') == '6/12')
            with A.page.expect_download(timeout=15000) as d:
                school_page(A.page, sid)
                A.page.locator('[data-act="export"]').click()
                A.page.wait_for_selector('.ov-panel:has-text("نسخة هذا الجهاز")', timeout=15000)
            ok('offline school export from a fully prepared school (labelled as device copy)', d.value.suggested_filename.endswith('.xlsx'))
            A.page.keyboard.press('Escape')
            A.ctx.set_offline(False)
            A.page.evaluate('() => MF.net.check()')
            A.page.wait_for_function('() => MF.sync.status().pending === 0', timeout=15000)
            ok('T16 after reconnecting the queued VA reaches the database', one('select vasc_od from visual_acuity where participant_id=$1::uuid', [pid])['vasc_od'] == '6/12')
            # ---- T30: a new deployment is offered and taken ----
            ok('running build test-1', A.page.evaluate('() => MF.BUILD') == 'test-1')
            r2 = build('test-2')
            ok('second build', r2.returncode == 0, r2.stderr)
            A.page.evaluate('() => navigator.serviceWorker.getRegistration().then(r => r.update())')
            A.page.wait_for_selector('.toast:has-text("يتوفر إصدار جديد")', timeout=20000)
            ok('T30 update offered to the open client', True)
            with A.page.expect_navigation(timeout=20000):
                A.page.locator('.toast-act', has_text='تحديث الآن').click()
            A.page.wait_for_function("() => window.MF && MF.BUILD === 'test-2'", timeout=20000)
            ok('T30 client now runs the new build (not stuck on stale assets)', True)
            keys = A.page.evaluate("() => caches.keys()")
            ok('T30 old caches removed', len([k for k in keys if k.startswith('mfs-')]) == 1, keys)
            ok('no unexpected page errors', not A.errors, A.errors[:5])
            browser.close()
    finally:
        server.stop()
    sys.exit(0 if R.summary() else 1)


if __name__ == '__main__':
    main()
