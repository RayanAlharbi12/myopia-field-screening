#!/usr/bin/env python3
"""Glasses option «كنت ألبس نظارة سابقًا ولم أعد ألبسها»: distinct stored/exported value, no reasons,
VAsc always available, VAcc optional and Not tested unless measured."""
import sys
import openpyxl
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
OUT = '/tmp/mfs-glasses.xlsx'
PREV = 'كنت ألبس نظارة سابقًا ولم أعد ألبسها'
RES = []


def ok(n, c, d=''):
    RES.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(d)))


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1024, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('.empty')
    ids = pg.evaluate("""async () => { const s = await MF.SchoolRepository.create({name:'S', city:'C', type:'boys'});
      const a = await MF.ParticipantRepository.create(s.id); const n = await MF.ParticipantRepository.create(s.id);
      await MF.RegistrationRepository.registration.save(Object.assign(await MF.RegistrationRepository.registration.get(n.id), {glasses: 'no'}));
      return [s.id, a.id, n.id]; }""")
    pg.goto(BASE + '#/p/%s/registration/b' % ids[1]); pg.wait_for_selector('[data-b="s|registration|glasses"]')
    opts = [t.strip() for t in pg.locator('[data-b="s|registration|glasses"] .opt').all_inner_texts()]
    ok('four options in order', opts == ['نعم', 'لا', 'نعم، ولكن لا أرتديها حاليًا', PREV], opts)
    grp = pg.locator('[data-b="s|registration|glasses"]')
    grp.get_by_role('radio', name='نعم، ولكن لا أرتديها حاليًا').click(); pg.wait_for_timeout(150)
    ok('«نعم، ولكن…» still shows السبب؟', pg.locator('[data-when="glassesReasons"]').is_visible())
    pg.locator('[data-b="s|registration|glasses_reasons"] .opt', has_text='نسيتها بالمنزل').click(); pg.wait_for_timeout(150)
    grp.get_by_role('radio', name=PREV).click(); pg.wait_for_timeout(200)
    ok('new option: reasons NOT shown', not pg.locator('[data-when="glassesReasons"]').is_visible())
    ok('new option: earlier reasons kept (hidden), not deleted', pg.locator('[data-kept="glassesReasons"]').is_visible())
    pg.wait_for_function("() => document.querySelector('[data-save]').classList.contains('is-saved')")
    reg = pg.evaluate("id => MF.repos.db().get('registration', id)", ids[1])
    ok('stored as a distinct value', reg['glasses'] == 'previously', reg['glasses'])
    pg.goto(BASE + '#/p/%s/va' % ids[1]); pg.wait_for_selector('.mp-wheel')
    ok('VAsc available', pg.locator('[data-picker="vasc_od"]').is_visible())
    ok('VAcc available as optional', pg.locator('[data-when="vacc"]').is_visible() and pg.locator('[data-when="vaccOptional"]').is_visible())
    ok('VAcc starts Not tested (no assumed correction)', pg.locator('[data-picker="vacc_od"] .mp-wheel').get_attribute('aria-valuetext') == 'Not tested')
    nt = pg.locator('.nt-line').inner_text()
    ok('optional VAcc not listed as pending Not tested', 'VAcc' not in nt and 'VAsc OD' in nt, nt)
    with pg.expect_download() as d:
        pg.evaluate("id => MF.actions.exportExcel(id)", ids[0])
    d.value.save_as(OUT)
    ws = openpyxl.load_workbook(OUT)['Participants']
    h = [c.value for c in ws[1]]
    rows = {ws.cell(r, h.index('Participant_ID') + 1).value: {h[i]: ws.cell(r, i + 1).value for i in range(len(h))} for r in range(2, ws.max_row + 1)}
    a, n = rows['1-1'], rows['1-2']
    ok('export: distinct status', a['Glasses_Status'] == 'Previously wore glasses but no longer wears them', a['Glasses_Status'])
    ok('export: not merged with No', n['Glasses_Status'] == 'No' and a['Glasses_Status'] != n['Glasses_Status'])
    ok('export: reasons Not applicable for the new option', a['Glasses_Not_Currently_Worn_Reasons'] == 'Not applicable')
    ok('export: VAcc Not tested (optional, not measured)', (a['VAcc_OD'], a['VAcc_OS'], a['VAcc_OU']) == ('Not tested',) * 3)
    ok('export: VAsc Not tested', a['VAsc_OD'] == 'Not tested')
    ok('export: "No" participant unchanged (VAcc Not applicable)', n['VAcc_OD'] == 'Not applicable')
    pg.evaluate("id => MF.ClinicalRepository.visualAcuity.save({participant_id: id, vacc_od: '6/9'})", ids[1])
    with pg.expect_download() as d:
        pg.evaluate("id => MF.actions.exportExcel(id)", ids[0])
    d.value.save_as(OUT)
    ws = openpyxl.load_workbook(OUT)['Participants']
    ok('export: VAcc exported when actually measured', ws.cell(2, h.index('VAcc_OD') + 1).value == '6/9')
    ok('no JS errors', not errs, errs)
    b.close()
print('\n%d checks, %d failed' % (len(RES), RES.count(False)))
sys.exit(0 if all(RES) else 1)
