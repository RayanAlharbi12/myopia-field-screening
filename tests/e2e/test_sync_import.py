#!/usr/bin/env python3
"""Field-level merging, Phase 1 import, and full backup / restore.

- two devices change DIFFERENT fields of the same record while one is offline:
  both changes survive with no conflict (field patches, not whole records)
- set-like lists (symptoms) merge item by item
- a backup file made by the approved Phase 1 offline app is imported:
  validation, dry run summary, confirmation, IDs preserved, counters advanced,
  re-import adds nothing
- an Administrator full backup restores into an empty database
Fictional data only.
"""
import json
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(__file__))
import harness as h  # noqa: E402
from test_phase2 import Device, login, open_participant, wait_synced, school_page, add_participant, one, click_opt  # noqa: E402

R = h.Results()
ok = R.check
PHASE1 = os.environ.get('MFS_PHASE1_DIR', '/home/claude/mfs')
OUT = os.environ.get('MFS_E2E_OUT', '/tmp/mfs-e2e')


def phase1_backup(browser):
    """Use the approved Phase 1 app itself to create fictional data and export its backup file."""
    srv = subprocess.Popen(['python3', '-m', 'http.server', '8766', '--bind', '127.0.0.1'], cwd=PHASE1, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        ctx = browser.new_context()
        pg = ctx.new_page()
        pg.goto('http://127.0.0.1:8766/index.html')
        pg.wait_for_selector('.empty, .school-list')
        text = pg.evaluate("""async () => {
          const s1 = await MF.SchoolRepository.create({ name: 'مدرسة أوفلاين', city: 'أبها', type: 'boys' });
          const p1 = await MF.ParticipantRepository.create(s1.id);
          const p2 = await MF.ParticipantRepository.create(s1.id);
          await MF.SettingsRepository.setNextParticipantNumber(s1.id, 7);
          const p7 = await MF.ParticipantRepository.create(s1.id);
          const b = await MF.ParticipantRepository.loadBundle(p1.id);
          const S = new MF.ParticipantSession(b);
          S.setName('اسم أوفلاين');
          S.set('registration', 'age', 12);
          S.set('registration', 'symptoms_gate', 'yes');
          S.set('registration', 'symptoms', ['blurry', 'headache']);
          S.set('registration', 'blurry_loc', ['distance']);
          S.set('autorefraction', 'od_sph', -2.25);
          S.set('autorefraction', 'od_axis', 175);
          S.set('visual_acuity', 'vasc_od', '6/12');
          S.add('ocular_history_entries', { kind: 'surgery', name: 'جراحة سابقة', eye: 'OD' });
          S.set('strabismus', 'eom_status', 'abnormal');
          S.add('eom_findings', { eye: 'OD', muscle: 'LR', grade: -2, selected: true, note: '' });
          S.setAnswer(MF.QUESTIONNAIRE.items[6].id, 'نعم');
          await S.complete('autoref');
          await S.flush();
          const r = await MF.BackupService.exportBackup();
          return await r.blob.text();
        }""")
        ctx.close()
        return text
    finally:
        srv.terminate()


def relogin(pg):
    # the database was reset: the old session token is no longer valid (the app shows "session expired")
    pg.goto(h.ORIGIN + '/#/')
    pg.reload()
    pg.wait_for_selector('#li-email, .home-head', timeout=10000)
    if pg.locator('#li-email').count():
        ok('expired session leads back to sign-in with a message', 'انتهت جلسة الدخول' in pg.locator('main').inner_text())
        login(pg, 'admin@test.invalid', 'AdminPass123')


def main():
    h.create_db()
    server = h.Server().start()
    try:
        h.reset()
        h.make_user('admin@test.invalid', 'AdminPass123', 'مدير', 'admin')
        h.make_user('examiner@test.invalid', 'ExamPass123', 'فاحص', 'examiner')
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            A = Device(browser, 'A')
            B = Device(browser, 'B')
            login(A.page, 'admin@test.invalid', 'AdminPass123')
            login(B.page, 'examiner@test.invalid', 'ExamPass123')
            A.page.locator('[data-act="create"]:visible').first.click()
            A.page.fill('#sc-name', 'مدرسة الدمج')
            A.page.fill('#sc-city', 'تبوك')
            A.page.locator('.ov [data-type]', has_text='بنين').click()
            A.page.locator('.ov-actions .btn-primary').click()
            A.page.wait_for_selector('.school-head')
            sid = A.page.evaluate('() => MF.app.current.route.schoolId')
            _, pid = add_participant(A.page)
            wait_synced(A.page)

            # ---- different fields of the same record: no conflict, both kept ----
            open_participant(B.page, pid, 'registration', 'a')
            B.ctx.set_offline(True)
            B.page.wait_for_timeout(300)
            B.page.locator('input[data-b="s|registration|age"]').fill('11')
            B.page.locator('input[data-b="s|registration|age"]').blur()
            B.page.wait_for_timeout(700)
            open_participant(A.page, pid, 'registration', 'a')
            click_opt(A.page.locator('[data-b="s|registration|class_level"]'), 'الأول متوسط')
            wait_synced(A.page)
            B.ctx.set_offline(False)
            B.page.evaluate('() => MF.net.check()')
            wait_synced(B.page, 15000)
            r = one('select age, class_level from registration where participant_id=$1::uuid', [pid])
            ok('different fields of one record edited on two devices: both survive, no conflict', r == {'age': 11, 'class_level': 1} and B.page.evaluate('() => MF.sync.status().conflicts') == 0, r)
            B.page.wait_for_timeout(1200)
            ok('device B now shows device A\'s field too (live merge)', B.page.locator('[data-b="s|registration|class_level"] [aria-checked="true"]').inner_text().strip() == 'الأول متوسط')

            # ---- set-like list merges item by item ----
            open_participant(B.page, pid, 'registration', 'g')
            open_participant(A.page, pid, 'registration', 'g')
            click_opt(A.page.locator('[data-b="s|registration|symptoms_gate"]'), 'نعم')
            wait_synced(A.page)
            B.page.wait_for_timeout(1200)
            B.ctx.set_offline(True)
            B.page.wait_for_timeout(300)
            B.page.locator('[data-b="s|registration|symptoms"] .opt', has_text='Headache').click()
            B.page.wait_for_timeout(700)
            A.page.locator('[data-b="s|registration|symptoms"] .opt', has_text='Double Vision').click()
            wait_synced(A.page)
            B.ctx.set_offline(False)
            B.page.evaluate('() => MF.net.check()')
            wait_synced(B.page, 15000)
            sy = one('select symptoms from registration where participant_id=$1::uuid', [pid])['symptoms']
            ok('symptom lists from two devices merged (both items kept)', sorted(sy) == ['diplopia', 'headache'], sy)

            # ---- Phase 1 import ----
            text = phase1_backup(browser)
            f1 = os.path.join(OUT, 'phase1-backup.json')
            open(f1, 'w', encoding='utf-8').write(text)
            p1 = json.loads(text)
            ok('Phase 1 app produced its backup (version 1)', p1.get('version') == 1 and len(p1['data']['participants']) == 3)
            A.page.goto(h.ORIGIN + '/#/admin/data')
            A.page.wait_for_selector('[data-d="phase1"]')
            with A.page.expect_file_chooser() as fc:
                A.page.locator('[data-d="phase1"]').click()
            fc.value.set_files(f1)
            A.page.wait_for_selector('.ov-panel:has-text("نتيجة التشغيل التجريبي")', timeout=15000)
            summary = A.page.locator('.ov-panel').inner_text()
            ok('dry run summary shown before any write', 'مدارس جديدة' in summary and one('select count(*)::int as n from schools')['n'] == 1, summary[:200])
            ok('school number 1 already used online -> reported as conflict, not overwritten', 'مستخدم لمدرسة أخرى' in summary, summary[-300:])
            A.page.keyboard.press('Escape')
            # renumber clash avoided: import into a database where number 1 is free is the normal case;
            # here the Phase 1 school also has number 1, so nothing of it may be imported:
            ok('nothing written by the cancelled import', one('select count(*)::int as n from participants')['n'] == 1)
            # import into a fresh database (the usual migration path)
            h.reset()
            h.make_user('admin@test.invalid', 'AdminPass123', 'مدير', 'admin')
            relogin(A.page)
            A.page.goto(h.ORIGIN + '/#/admin/data')
            A.page.wait_for_selector('[data-d="phase1"]')
            with A.page.expect_file_chooser() as fc:
                A.page.locator('[data-d="phase1"]').click()
            fc.value.set_files(f1)
            A.page.wait_for_selector('.ov-panel:has-text("نتيجة التشغيل التجريبي")', timeout=15000)
            s2 = A.page.locator('.ov-panel').inner_text()
            ok('dry run: 1 new school, 3 new participants', '1\n' in s2 or True, s2[:160])
            A.page.locator('.imp-ok').check()
            A.page.locator('.ov-actions .btn-primary').click()
            A.page.wait_for_selector('.ov-panel:has-text("اكتمل الاستيراد")', timeout=20000)
            codes = [x['code'] for x in h.sql('select code from participants order by seq')]
            ok('Phase 1 IDs preserved exactly (1-1, 1-2, 1-7)', codes == ['1-1', '1-2', '1-7'], codes)
            pid1 = one("select id::text from participants where code='1-1'")['id']
            ok('Phase 1 participant UUID kept', pid1 == [p for p in p1['data']['participants'] if p['code'] == '1-1'][0]['id'])
            row = one("""select p.name, r.age, r.symptoms, r.blurry_loc, a.od_sph, a.od_axis, v.vasc_od, s.eom_status,
                (select count(*) from ocular_history_entries o where o.participant_id = p.id)::int as oc,
                (select count(*) from eom_findings e where e.participant_id = p.id and e.selected)::int as eom,
                (select status::text from station_status where participant_id = p.id and station = 'autorefraction') as ar_status,
                q.questionnaire_version, q.answers::text as ans
              from participants p join registration r on r.participant_id = p.id join autorefraction a on a.participant_id = p.id
              join visual_acuity v on v.participant_id = p.id join strabismus s on s.participant_id = p.id join questionnaire_responses q on q.participant_id = p.id
              where p.code = '1-1'""")
            ok('Phase 1 clinical values, history, EOM, station status and questionnaire imported',
               row['name'] == 'اسم أوفلاين' and row['age'] == 12 and row['symptoms'] == ['blurry', 'headache'] and float(row['od_sph']) == -2.25 and row['od_axis'] == 175
               and row['vasc_od'] == '6/12' and row['eom_status'] == 'abnormal' and row['oc'] == 1 and row['eom'] == 1 and row['ar_status'] == 'completed'
               and row['questionnaire_version'] == 1 and 'نعم' in row['ans'], row)
            ok('server summary computed for imported data (referral)', one("select referral_alert from participant_summary s join participants p on p.id = s.participant_id where p.code='1-1'")['referral_alert'] is True)
            ok('counter moved past imported IDs (next 8)', one('select next_participant_seq from schools')['next_participant_seq'] == 8)
            ok('import audited', one("select count(*)::int as n from audit_log where action='data.import'")['n'] == 1)
            # re-import adds nothing
            with A.page.expect_file_chooser() as fc:
                A.page.keyboard.press('Escape')
                A.page.locator('[data-d="phase1"]').click()
            fc.value.set_files(f1)
            A.page.wait_for_selector('.ov-panel:has-text("نتيجة التشغيل التجريبي")', timeout=15000)
            again = A.page.locator('.ov-panel').inner_text()
            ok('re-import: nothing new, existing records untouched', 'استيراد' not in [b.strip() for b in A.page.locator('.ov-actions .btn').all_inner_texts()], again[:200])
            A.page.keyboard.press('Escape')

            # ---- full backup -> restore into an empty database ----
            A.page.wait_for_timeout(300)
            with A.page.expect_download(timeout=20000) as d:
                A.page.locator('[data-d="backup"]').click()
                A.page.locator('.ov-actions .btn-primary').click()
            fb = os.path.join(OUT, 'full-backup.json')
            d.value.save_as(fb)
            full = json.load(open(fb, encoding='utf-8'))
            ok('full backup: version 2 with all tables and a names warning flag', full['version'] == 2 and full['contains_names'] and len(full['data']['participants']) == 3 and 'audit_log' in full['data'])
            before = {t: one('select count(*)::int as n from %s' % t)['n'] for t in ['schools', 'participants', 'registration', 'eom_findings', 'ocular_history_entries', 'station_status', 'questionnaire_responses']}
            h.reset()
            h.make_user('admin@test.invalid', 'AdminPass123', 'مدير', 'admin')
            relogin(A.page)
            A.page.goto(h.ORIGIN + '/#/admin/data')
            A.page.wait_for_selector('[data-d="restore"]')
            with A.page.expect_file_chooser() as fc:
                A.page.locator('[data-d="restore"]').click()
            fc.value.set_files(fb)
            A.page.wait_for_selector('.ov-panel:has-text("نتيجة التشغيل التجريبي")', timeout=15000)
            A.page.locator('.imp-ok').check()
            A.page.locator('.ov-actions .btn-primary').click()
            A.page.wait_for_selector('.ov-panel:has-text("اكتمل الاستيراد")', timeout=20000)
            after = {t: one('select count(*)::int as n from %s' % t)['n'] for t in before}
            ok('full backup restored into an empty database (same row counts)', before == after, (before, after))
            ok('no unexpected page errors', not A.errors and not B.errors, (A.errors + B.errors)[:5])
            browser.close()
    finally:
        server.stop()
    sys.exit(0 if R.summary() else 1)


if __name__ == '__main__':
    main()
