#!/usr/bin/env python3
"""Backup edge cases: invalid files never change data; merge never overwrites a different school/participant number."""
import json, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
RES = []


def ok(n, c, d=''):
    RES.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(d)))


with sync_playwright() as p:
    b = p.chromium.launch()
    A = b.new_context().new_page(); A.goto(BASE); A.wait_for_selector('.empty')
    Bp = b.new_context().new_page(); Bp.goto(BASE); Bp.wait_for_selector('.empty')
    # device A: school 1 with 1-1 (answered), device B: a different school 1 with 1-1
    A.evaluate("""async () => { const s = await MF.SchoolRepository.create({name:'A school', city:'X', type:'girls'});
      const p = await MF.ParticipantRepository.create(s.id); await MF.ClinicalRepository.autorefraction.save({participant_id: p.id, od_sph: -0.5}); }""")
    Bp.evaluate("""async () => { const s = await MF.SchoolRepository.create({name:'B school', city:'Y', type:'boys'}); await MF.ParticipantRepository.create(s.id); }""")
    backup = A.evaluate("() => MF.BackupService.exportBackup().then(r => r.blob.text())")
    before = Bp.evaluate("() => MF.repos.db().snapshot()")
    # invalid inputs
    for label, payload in [('not JSON', '{oops'), ('wrong format', json.dumps({'format': 'x', 'version': 1, 'data': {}})),
                           ('orphan record', json.dumps({'format': 'myopia-field-screening-backup', 'version': 1, 'data': {'registration': [{'participant_id': 'nope'}]}}))]:
        r = Bp.evaluate("t => { let o; try { o = JSON.parse(t); } catch (e) { return {ok:false, errors:['json']}; } return MF.BackupService.validate(o); }", payload)
        ok('invalid backup rejected: ' + label, not r['ok'], r)
    after_invalid = Bp.evaluate("() => MF.repos.db().snapshot()")
    ok('invalid backups changed nothing', json.dumps(before, sort_keys=True) == json.dumps(after_invalid, sort_keys=True))
    plan = Bp.evaluate("t => MF.BackupService.applyMerge(MF.BackupService.validate(JSON.parse(t)))", backup)
    ok('merge reports the school-number conflict', any('رقم 1' in c for c in plan['conflicts']), plan['conflicts'])
    snap = Bp.evaluate("() => MF.repos.db().snapshot()")
    ok('merge kept the local school 1 untouched', [s['name'] for s in snap['schools']] == ['B school'], [s['name'] for s in snap['schools']])
    ok('merge did not import the conflicting participants', len(snap['participants']) == 1 and not snap['autorefraction'])
    # replace is all-or-nothing and restores exactly
    Bp.evaluate("t => MF.BackupService.applyReplace(MF.BackupService.validate(JSON.parse(t)))", backup)
    snap = Bp.evaluate("() => MF.repos.db().snapshot()")
    ok('replace restores the backup exactly', [s['name'] for s in snap['schools']] == ['A school'] and snap['autorefraction'][0]['od_sph'] == -0.5)
    nxt = Bp.evaluate("() => MF.SchoolRepository.nextNumber()")
    ok('school counter continues after restore (next = 2)', nxt == 2, nxt)
    b.close()
print('\n%d checks, %d failed' % (len(RES), RES.count(False)))
sys.exit(0 if all(RES) else 1)
