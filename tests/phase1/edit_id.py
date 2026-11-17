#!/usr/bin/env python3
"""تعديل رقم المشارك: duplicates blocked, confirmation required, same school, data kept; archive keeps the number."""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
RES = []


def ok(n, c, d=''):
    RES.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(d)))


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1024, 'height': 800})
    pg.goto(BASE); pg.wait_for_selector('.empty')
    ids = pg.evaluate("""async () => { const s = await MF.SchoolRepository.create({name:'S', city:'C', type:'boys'});
      const a = await MF.ParticipantRepository.create(s.id); const b = await MF.ParticipantRepository.create(s.id);
      await MF.ClinicalRepository.autorefraction.save({participant_id: a.id, od_sph: -1.5}); return [s.id, a.id, b.id]; }""")
    pg.goto(BASE + '#/p/%s/autoref' % ids[1]); pg.wait_for_selector('.ctx .pid-lg')
    pg.locator('[data-act="pmenu"]').click(); pg.locator('.menu-item', has_text='تعديل رقم المشارك').click()
    pg.fill('#eid-in', '2'); pg.wait_for_timeout(100)
    ok('duplicate 1-2 refused', pg.locator('.eid-err').is_visible() and pg.locator('.ov-actions .btn-primary').is_disabled())
    pg.fill('#eid-in', '12'); pg.wait_for_timeout(100)
    pg.locator('.ov-actions .btn-primary').click(); pg.wait_for_timeout(300)
    ok('confirmation step shown', 'تأكيد تعديل رقم المشارك' in pg.locator('.ov-title').last.inner_text())
    pg.locator('.ov-actions .btn-primary').last.click(); pg.wait_for_timeout(600)
    ok('context bar shows 1-12', pg.locator('.ctx .pid-lg').inner_text().strip() == '1-12')
    rec = pg.evaluate("id => MF.repos.db().get('participants', id)", ids[1])
    ar = pg.evaluate("id => MF.repos.db().get('autorefraction', id)", ids[1])
    ok('stored as 1-12, same school, data kept', rec['code'] == '1-12' and rec['school_id'] == ids[0] and ar['od_sph'] == -1.5, rec['code'])
    audit = [a for a in pg.evaluate("() => MF.repos.db().getAll('audit_metadata')") if a['action'] == 'change_id']
    ok('ID change recorded in audit_metadata', audit and audit[0]['detail'] == {'from': '1-1', 'to': '1-12'}, audit)
    # archive 1-2, then counter at 2 must still be blocked
    pg.evaluate("id => MF.ParticipantRepository.setArchived(id, true)", ids[2])
    pg.evaluate("id => MF.SettingsRepository.setNextParticipantNumber(id, 2)", ids[0])
    res = pg.evaluate("id => MF.ParticipantRepository.create(id).then(() => 'created', e => e.code)", ids[0])
    ok('archived ID 1-2 is not reused', res == 'DUPLICATE_ID', res)
    b.close()
print('\n%d checks, %d failed' % (len(RES), RES.count(False)))
sys.exit(0 if all(RES) else 1)
