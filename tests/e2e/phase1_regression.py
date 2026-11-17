#!/usr/bin/env python3
"""Phase 1 regression on the Phase 2 application.

Runs the APPROVED Phase 1 end-to-end test (tests/phase1/qa_flow.py: schools, IDs,
counter, registration A–H, family builder, pickers on a touch phone, cover
test logic, EOM, VA rules, questionnaire, Excel format) against Phase 2,
signed in as an Administrator, with only these test-harness adaptations:
  - checks read this device's cache (same field names) instead of the
    Phase 1 local database
  - the touch-phone context signs in instead of copying a backup file
    (data is shared through the server)
  - Phase 1 TEST 22 (local backup / clear / restore) is replaced in Phase 2
    by the Administrator full backup / restore test (test_sync_import.py)
Then the approved 4th glasses option test (tests/phase1/glasses_previously.py) is
repeated against the server.
Fictional data only.
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import harness as h  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

SHIM = "(function(){ setInterval(function(){ if (window.MF && MF.cache && MF.cache.db && MF.repos) MF.repos.adapter = MF.cache.db; }, 25); })();"


def load_qa():
    src = open(os.path.join(h.ROOT, 'tests', 'phase1', 'qa_flow.py'), encoding='utf-8').read()
    reps = [
        ("page2.wait_for_selector('.empty')", "page2.wait_for_selector('.empty, .school-list')"),
        ('snap = page.evaluate("() => MF.BackupService.exportBackup().then(r => r.blob.text())")', 'snap = None'),
        ('page2.evaluate("t => MF.BackupService.applyReplace(MF.BackupService.validate(JSON.parse(t)))", snap)', 'None'),
        ('snap2 = page2.evaluate("() => MF.BackupService.exportBackup().then(r => r.blob.text())")', 'snap2 = None'),
        ('page.evaluate("t => MF.BackupService.applyReplace(MF.BackupService.validate(JSON.parse(t)))", snap2)', 'None'),
    ]
    for a, b in reps:
        assert a in src, a
        src = src.replace(a, b)
    i, j = src.index('        # ---------- TEST 22 — backup round trip ----------'), src.index("        ok('no JavaScript errors'")
    src = src[:i] + src[j:]
    mod = types.ModuleType('qa_flow_p2')
    mod.__file__ = 'qa_flow (Phase 2 adaptation)'
    exec(compile(src, 'qa_flow.py', 'exec'), mod.__dict__)
    return mod


PREV = 'كنت ألبس نظارة سابقًا ولم أعد ألبسها'


def glasses_previously(browser, state, ok):
    """Port of the approved tests/glasses_previously.py (4th glasses option) to Phase 2."""
    import openpyxl
    ctx = browser.new_context(viewport={'width': 1024, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(h.ORIGIN + '/')
    pg.wait_for_selector('.home-head')
    ids = pg.evaluate("""async () => { const s = await MF.SchoolRepository.create({name:'S-glasses', city:'C', type:'boys'});
      const a = await MF.ParticipantRepository.create(s.id); const n = await MF.ParticipantRepository.create(s.id);
      return [s.id, a.id, n.id, s.number]; }""")
    h.sql("update public.registration set glasses = 'no' where participant_id = $1::uuid", [ids[2]])
    pg.goto(h.ORIGIN + '/#/p/%s/registration/b' % ids[1])
    pg.wait_for_selector('[data-b="s|registration|glasses"]')
    opts = [t.strip() for t in pg.locator('[data-b="s|registration|glasses"] .opt').all_inner_texts()]
    ok('G four glasses options in order', opts == ['نعم', 'لا', 'نعم، ولكن لا أرتديها حاليًا', PREV], opts)
    grp = pg.locator('[data-b="s|registration|glasses"]')
    grp.get_by_role('radio', name='نعم، ولكن لا أرتديها حاليًا').click()
    pg.wait_for_timeout(150)
    ok('G «نعم، ولكن…» still shows السبب؟', pg.locator('[data-when="glassesReasons"]').is_visible())
    pg.locator('[data-b="s|registration|glasses_reasons"] .opt', has_text='نسيتها بالمنزل').click()
    pg.wait_for_timeout(150)
    grp.get_by_role('radio', name=PREV).click()
    pg.wait_for_timeout(200)
    ok('G new option: reasons NOT shown', not pg.locator('[data-when="glassesReasons"]').is_visible())
    ok('G new option: earlier reasons kept (hidden), not deleted', pg.locator('[data-kept="glassesReasons"]').is_visible())
    pg.wait_for_function("() => document.querySelector('[data-save]').classList.contains('is-saved') && MF.sync.status().pending === 0", timeout=10000)
    reg = h.sql("select glasses, glasses_reasons from public.registration where participant_id = $1::uuid", [ids[1]])[0]
    ok('G stored on the server as a distinct value', reg['glasses'] == 'previously' and reg['glasses_reasons'] == ['forgot'], reg)
    pg.goto(h.ORIGIN + '/#/p/%s/va' % ids[1])
    pg.wait_for_selector('.mp-wheel')
    ok('G VAsc available', pg.locator('[data-picker="vasc_od"]').is_visible())
    ok('G VAcc available as optional', pg.locator('[data-when="vacc"]').is_visible() and pg.locator('[data-when="vaccOptional"]').is_visible())
    ok('G VAcc starts Not tested', pg.locator('[data-picker="vacc_od"] .mp-wheel').get_attribute('aria-valuetext') == 'Not tested')
    nt = pg.locator('.nt-line').inner_text()
    ok('G optional VAcc not listed as pending Not tested', 'VAcc' not in nt and 'VAsc OD' in nt, nt)
    out = os.path.join(os.environ.get('MFS_E2E_OUT', '/tmp/mfs-e2e'), 'glasses.xlsx')

    def export():
        with pg.expect_download(timeout=20000) as d:
            pg.evaluate("id => MF.actions.exportExcel(id)", ids[0])
        d.value.save_as(out)
        ws = openpyxl.load_workbook(out)['Participants']
        hh = [c.value for c in ws[1]]
        return hh, {ws.cell(r, hh.index('Participant_ID') + 1).value: {hh[i]: ws.cell(r, i + 1).value for i in range(len(hh))} for r in range(2, ws.max_row + 1)}
    hh, rows = export()
    a, n = rows['%d-1' % ids[3]], rows['%d-2' % ids[3]]
    ok('G export: distinct status', a['Glasses_Status'] == 'Previously wore glasses but no longer wears them', a['Glasses_Status'])
    ok('G export: not merged with No', n['Glasses_Status'] == 'No')
    ok('G export: reasons Not applicable for the new option', a['Glasses_Not_Currently_Worn_Reasons'] == 'Not applicable')
    ok('G export: VAcc Not tested (optional, not measured)', (a['VAcc_OD'], a['VAcc_OS'], a['VAcc_OU']) == ('Not tested',) * 3)
    ok('G export: "No" participant VAcc Not applicable', n['VAcc_OD'] == 'Not applicable')
    w = pg.locator('[data-picker="vacc_od"] .mp-wheel')
    w.focus()
    pg.keyboard.type('6/9')
    pg.wait_for_selector('.pl-input')
    pg.keyboard.press('Enter')
    pg.wait_for_function("() => MF.sync.status().pending === 0 && document.querySelector('[data-save]').classList.contains('is-saved')", timeout=10000)
    hh, rows = export()
    ok('G export: VAcc exported when actually measured', rows['%d-1' % ids[3]]['VAcc_OD'] == '6/9')
    ok('G no JS errors', not errs, errs)
    ctx.close()


def main():
    qa = load_qa()
    qa.BASE = h.ORIGIN + '/'
    qa.OUT = os.environ.get('MFS_E2E_OUT', '/tmp/mfs-e2e') + '/phase1'
    os.makedirs(qa.OUT, exist_ok=True)
    h.create_db()
    server = h.Server().start()
    try:
        h.reset()
        h.make_user('admin@test.invalid', 'AdminPass123', 'مدير', 'admin')
        with sync_playwright() as p:
            browser = p.chromium.launch()
            login_ctx = browser.new_context()
            lp = login_ctx.new_page()
            lp.goto(h.ORIGIN + '/')
            lp.wait_for_selector('#li-email')
            lp.fill('#li-email', 'admin@test.invalid')
            lp.fill('#li-pw', 'AdminPass123')
            lp.click('[data-submit]')
            lp.wait_for_selector('.home-head')
            state = login_ctx.storage_state()
            login_ctx.close()
            orig = browser.new_context

            def new_context(**kw):
                kw.setdefault('storage_state', state)
                c = orig(**kw)
                c.add_init_script(SHIM)
                return c
            browser.new_context = new_context
            ctx = browser.new_context(viewport={'width': 1024, 'height': 900}, accept_downloads=True)
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.goto(qa.BASE)
            page.wait_for_selector('.empty, .school-list')
            try:
                qa.run(page, ctx, browser, errors)
            except Exception as e:
                page.screenshot(path=qa.OUT + '/failure.png', full_page=True)
                qa.ok('suite ran to the end', False, repr(e)[:300])
            try:
                glasses_previously(browser, state, qa.ok)
            except Exception as e:
                qa.ok('glasses test ran to the end', False, repr(e)[:300])
            browser.close()
    finally:
        server.stop()
    failed = [r for r in qa.RESULTS if not r[1]]
    print('\n%d Phase 1 checks on Phase 2, %d failed' % (len(qa.RESULTS), len(failed)))
    for f in failed:
        print('  FAILED:', f[0], f[2])
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
