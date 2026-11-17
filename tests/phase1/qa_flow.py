#!/usr/bin/env python3
"""End-to-end QA for the Phase 1 offline app (spec tests 1-22).

Usage:  python3 tests/qa_flow.py [base_url]
        base_url defaults to http://localhost:8765/index.html (serve the project folder),
        or pass file:///…/dist/standalone.html to test the standalone build.
All data typed here is fictional test data; it lives only in a throw-away browser profile.
"""
import json, os, re, sys, time, zipfile
from playwright.sync_api import sync_playwright, expect
import openpyxl

UNI = '\u0627\u0644\u062c\u0627\u0645\u0639\u0629'   # the removed questionnaire word, escaped so the project itself never contains it

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
OUT = os.environ.get('QA_OUT', '/tmp/mfs-qa')
os.makedirs(OUT, exist_ok=True)
RESULTS = []


def ok(name, cond, detail=''):
    RESULTS.append((name, bool(cond), detail))
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(detail) if detail and not cond else ''))


def db(page, store):
    return page.evaluate("s => MF.repos.db().getAll(s)", store)


def wait_saved(page):
    page.wait_for_function("() => { const e = document.querySelector('[data-save]'); return !e || e.classList.contains('is-saved'); }", timeout=5000)


def click_opt(scope, text, exact=True):
    scope.get_by_role('radio', name=text, exact=exact).first.click()
    scope.page.wait_for_timeout(60)


def go_part(page, code):
    page.locator('.parts .part', has=page.locator('.part-code', has_text=re.compile('^' + code + '$'))).first.click()
    page.wait_for_timeout(150)


def touch_swipe(page, cdp, x, y0, y1, steps=12, pause=0.25):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y0}]})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y0 + (y1 - y0) * i / steps}]})
        time.sleep(0.016)
    time.sleep(pause)   # hold still before lifting: no momentum
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def touch_tap(cdp, x, y):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    time.sleep(0.05)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={'width': 1024, 'height': 900}, accept_downloads=True)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(BASE)
        page.wait_for_selector('.empty, .school-list')
        try:
            run(page, ctx, browser, errors)
        except Exception:
            page.screenshot(path=OUT + '/failure.png', full_page=True)
            raise
        browser.close()
    failed = [r for r in RESULTS if not r[1]]
    print('\n%d checks, %d failed' % (len(RESULTS), len(failed)))
    for f in failed:
        print('  FAILED:', f[0], f[2])
    sys.exit(1 if failed else 0)


def run(page, ctx, browser, errors):
    if True:

        # ---------- TEST 1 — first open ----------
        ok('T1 empty state text', page.get_by_text('لا توجد مدارس حتى الآن').is_visible())
        counts = {s: len(db(page, s)) for s in ['schools', 'participants', 'registration', 'questionnaire_responses']}
        ok('T1 no demo data', sum(counts.values()) == 0, counts)

        # ---------- TEST 2 — schools 1 and 2 ----------
        def create_school(name, city, typ):
            page.locator('[data-act="create"]:visible').first.click()
            page.fill('#sc-name', name); page.fill('#sc-city', city)
            page.locator('.ov [data-type]', has_text=typ).click()
            page.locator('.ov-actions .btn-primary').click()
            page.wait_for_selector('.school-head')
        create_school('مدرسة الاختبار الأولى', 'الرياض', 'بنين')
        ok('T2 school 1 number', page.locator('.sh-no .num').inner_text().strip() == '1')
        school1 = page.url
        page.goto(BASE + '#/'); page.wait_for_selector('.school-list')
        create_school('مدرسة الاختبار الثانية', 'جدة', 'بنات')
        ok('T2 school 2 number', page.locator('.sh-no .num').inner_text().strip() == '2')

        # ---------- TEST 3 — participant numbers ----------
        page.goto(school1); page.wait_for_selector('.school-head')
        codes = []
        def add_participant():
            page.locator('[data-act="add"]').click()
            page.wait_for_selector('.ctx .pid-lg')
            c = page.locator('.ctx .pid-lg').inner_text().strip()
            page.goto(school1); page.wait_for_selector('.school-head')
            return c
        for _ in range(3):
            codes.append(add_participant())
        ok('T3 sequential IDs 1-1,1-2,1-3', codes == ['1-1', '1-2', '1-3'], codes)
        def set_counter(n):
            page.locator('[data-act="counter"]').click()
            page.fill('#cn-in', str(n))
            page.locator('.ov-actions .btn-primary').click()
            page.wait_for_timeout(250)
        set_counter(10)
        c10 = add_participant()
        ok('T3 counter 10 -> 1-10', c10 == '1-10', c10)
        set_counter(2)
        page.locator('[data-act="add"]').click()
        dup = page.locator('.ov-panel')
        dup.wait_for()
        ok('T3 duplicate blocked with message', 'رقم المشارك موجود مسبقًا. يرجى تعديل العداد.' in dup.inner_text())
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        parts = db(page, 'participants')
        ok('T3 nothing overwritten (4 participants)', len(parts) == 4, [x['code'] for x in parts])

        # open 1-1
        page.locator('.p-row', has=page.locator('.pid', has_text=re.compile('^1-1$'))).click()
        page.wait_for_selector('.ctx .pid-lg')
        pid = page.evaluate("() => MF.app.current.route.pid")
        go_part(page, 'A')

        # ---------- TEST 4 — name ----------
        page.locator('input[data-b="n"]').fill('طالب تجريبي')
        page.locator('input[data-b="s|registration|age"]').fill('13')
        click_opt(page.locator('[data-b="s|registration|class_level"]'), 'الثاني متوسط')
        wait_saved(page)
        ok('T4 gender preselected male (boys school)', page.locator('[data-b="s|registration|gender"] [aria-checked="true"]').inner_text().strip() == 'ذكر')
        ok('T4 name in context bar', 'طالب تجريبي' in page.locator('.ctx-name').inner_text())

        # ---------- TEST 5 — glasses ----------
        go_part(page, 'B')
        click_opt(page.locator('[data-b="s|registration|glasses"]'), 'نعم، ولكن لا أرتديها حاليًا')
        ok('T5 reasons appear', page.locator('[data-when="glassesReasons"]').is_visible())
        page.locator('[data-b="s|registration|glasses_reasons"] .opt', has_text='نسيتها بالمنزل').click()
        page.locator('[data-b="s|registration|glasses_reasons"] .opt', has_text='غير مرتاح').click()
        wait_saved(page)
        reg = [r for r in db(page, 'registration') if r['participant_id'] == pid][0]
        ok('T5 both reasons saved', sorted(reg.get('glasses_reasons', [])) == ['forgot', 'uncomfortable'], reg.get('glasses_reasons'))

        # ---------- TEST 6 — ocular history ----------
        go_part(page, 'C')
        blocks = page.locator('.block')
        click_opt(blocks.nth(0), 'نعم')
        page.locator('[data-sa="add-oc"][data-kind="disease_injury"]').click(); page.wait_for_timeout(150)
        e = page.locator('[data-list="disease_injury"] .entry').first
        click_opt(e, 'إصابة')
        e.locator('input[data-b$="|name"]').fill('رضّ في العين')
        click_opt(e, 'OD')
        e.locator('input.when-v').fill('2023')
        click_opt(blocks.nth(1), 'نعم')
        page.locator('[data-sa="add-oc"][data-kind="surgery"]').click(); page.wait_for_timeout(150)
        s = page.locator('[data-list="surgery"] .entry').first
        s.locator('input[data-b$="|name"]').fill('تصحيح الحول')
        click_opt(s, 'OS')
        click_opt(blocks.nth(2), 'نعم')
        for i, (name, ongoing) in enumerate([('أتروبين 0.01%', 'نعم، ما زلت أستخدمه'), ('قطرة مضاد حيوي', 'لا، توقفت عنه')]):
            page.locator('[data-sa="add-oc"][data-kind="medication"]').click(); page.wait_for_timeout(150)
            m = page.locator('[data-list="medication"] .entry').nth(i)
            m.locator('input[data-b$="|name"]').fill(name)
            click_opt(m, 'OU')
            click_opt(m, ongoing)
        m2 = page.locator('[data-list="medication"] .entry').nth(1)
        ok('T6 stop-date field appears for stopped medication', m2.locator('[data-when^="med_stop_"]').is_visible())
        m2.locator('[data-when^="med_stop_"] input.when-v').fill('2024')
        wait_saved(page)
        page.reload(); page.wait_for_selector('[data-list="medication"] .entry')
        oc = [x for x in db(page, 'ocular_history_entries') if x['participant_id'] == pid]
        kinds = sorted(x['kind'] for x in oc)
        ok('T6 entries survive refresh (1 injury, 1 surgery, 2 meds)', kinds == ['disease_injury', 'medication', 'medication', 'surgery'], kinds)
        meds = sorted([(x['name'], x.get('ongoing'), x.get('stop_when')) for x in oc if x['kind'] == 'medication'])
        ok('T6 one active, one stopped', [mm[1] for mm in meds] == ['yes', 'no'] or sorted(mm[1] for mm in meds) == ['no', 'yes'], meds)
        ok('T6 entries visible after reload', page.locator('[data-list="medication"] .entry').count() == 2)

        # ---------- TEST 7 — family ----------
        go_part(page, 'D')
        page.locator('input[data-b="s|registration|family_size"]').fill('5')
        page.locator('input[data-b="s|registration|family_size"]').blur()
        page.wait_for_timeout(1000)
        sibs = page.locator('[data-list="sibs"] .entry')
        ok('T7 two sibling rows created for family of 5', sibs.count() == 2, sibs.count())
        click_opt(page.locator('[data-list="birth-order"]'), '2')
        s1, s2 = sibs.nth(0), sibs.nth(1)
        click_opt(s1, 'أخ'); click_opt(s1.locator('.order-choices'), '1')
        click_opt(s2, 'أخت'); click_opt(s2.locator('.order-choices'), '3')
        page.wait_for_timeout(300)
        ok('T7 older/younger auto-filled from birth order', s1.locator('[aria-checked="true"]', has_text='أكبر من المشارك').count() == 1 and s2.locator('[aria-checked="true"]', has_text='أصغر من المشارك').count() == 1)
        lab = s1.locator('.entry-t').inner_text()
        ok('T7 member label format', lab == 'الأخ — الأول بين الأبناء — أكبر من المشارك', lab)
        ok('T7 no family issues', 'متّسق' in page.locator('[data-fam-issues]').inner_text())
        go_part(page, 'E')
        eb = page.locator('.block')
        click_opt(eb.nth(0), 'نعم')
        fg = page.locator('[data-list="fam-glasses"] .mem')
        fg.filter(has_text='الأب').locator('.opt').first.click()
        fg.filter(has_text='الأخ —').locator('.opt').first.click()
        click_opt(fg.filter(has_text='الأب'), 'للبعيد')
        click_opt(fg.filter(has_text='الأخ —'), 'للبعيد والقريب')
        click_opt(eb.nth(1), 'نعم')
        page.locator('[data-list="fam-disease"] .mem', has_text='الأم').locator('.opt').first.click(); page.wait_for_timeout(200)
        page.locator('[data-list="fam-disease"] .mem', has_text='الأم').locator('.fh-entry input').first.fill('زرق (Glaucoma)')
        click_opt(eb.nth(2), 'نعم')
        page.locator('[data-list="fam-surgery"] .mem', has_text='الأب').locator('.opt').first.click(); page.wait_for_timeout(200)
        page.locator('[data-list="fam-surgery"] .mem', has_text='الأب').locator('.fh-entry input').first.fill('LASIK')
        go_part(page, 'F')
        fb = page.locator('.block')
        click_opt(fb.nth(0), 'لا')
        click_opt(fb.nth(1), 'نعم')
        page.locator('[data-list="fam-systemic"] .mem', has_text='الأخت').locator('.opt').first.click(); page.wait_for_timeout(200)
        page.locator('[data-list="fam-systemic"] .mem', has_text='الأخت').locator('.fh-entry input').first.fill('ربو')
        wait_saved(page)
        fam = [x for x in db(page, 'family_members') if x['participant_id'] == pid]
        fh = [x for x in db(page, 'family_history_entries') if x['participant_id'] == pid]
        rels = sorted(x['relation'] for x in fam)
        ok('T7 structure father/mother/participant/2 siblings', rels == ['father', 'mother', 'participant', 'sibling', 'sibling'], rels)
        glasses = sorted((x['relation'], x.get('sex'), x.get('glasses_type')) for x in fam if x.get('glasses'))
        ok('T7 glasses per member with type', glasses == [('father', 'male', 'distance'), ('sibling', 'male', 'both')], glasses)
        ok('T7 family disease/surgery/systemic stored per member', sorted((x['kind'], x['name']) for x in fh if x['name']) == [('eye_disease', 'زرق (Glaucoma)'), ('eye_surgery', 'LASIK'), ('systemic', 'ربو')], [(x['kind'], x['name']) for x in fh])

        # ---------- TEST 8 — symptoms ----------
        go_part(page, 'G')
        click_opt(page.locator('[data-b="s|registration|symptoms_gate"]'), 'نعم')
        page.locator('[data-b="s|registration|symptoms"] .opt', has_text='Blurry Vision').click(); page.wait_for_timeout(120)
        ok('T8 near/distance appears', page.locator('[data-when="blurry"]').is_visible())
        page.locator('[data-b="s|registration|blurry_loc"] .opt', has_text='البعيد').click()
        page.locator('[data-b="s|registration|symptoms"] .opt', has_text='Headache').click()
        wait_saved(page)
        reg = [r for r in db(page, 'registration') if r['participant_id'] == pid][0]
        ok('T8 stored', reg.get('symptoms') == ['blurry', 'headache'] and reg.get('blurry_loc') == ['distance'], (reg.get('symptoms'), reg.get('blurry_loc')))

        # ---------- TEST 9 — anterior segment ----------
        go_part(page, 'H')
        ant = page.locator('[data-b="s|registration|ant_status"]')
        ok('T9 initial Not tested', ant.locator('[aria-checked="true"]').inner_text().strip() == 'Not tested')
        click_opt(ant, 'NAD')
        ok('T9 NAD shows no detail fields', not page.locator('[data-when="antAbnormal"]').is_visible())
        click_opt(ant, 'Abnormal')
        ok('T9 Abnormal shows OD/OS fields', page.locator('[data-when="antAbnormal"] input').count() == 6 and page.locator('[data-when="antAbnormal"]').is_visible())
        page.locator('input[data-b="s|registration|ant_cornea_od"]').fill('Mild SPK')
        wait_saved(page)
        page.screenshot(path=OUT + '/reg_h.png', full_page=True)

        state = {'pid': pid, 'school1': school1}
        json.dump(state, open(OUT + '/state.json', 'w'))
        ctx.storage_state(path=OUT + '/storage.json')

        # ---------- TESTS 10-12 on a phone-size touch viewport ----------
        page2 = None
        tctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2, accept_downloads=True)
        # copy IndexedDB by exporting/importing a backup through the app API
        snap = page.evaluate("() => MF.BackupService.exportBackup().then(r => r.blob.text())")
        page2 = tctx.new_page()
        page2.on('pageerror', lambda e: errors.append('touch: ' + str(e)))
        page2.goto(BASE)
        page2.wait_for_selector('.empty')
        page2.evaluate("t => MF.BackupService.applyReplace(MF.BackupService.validate(JSON.parse(t)))", snap)
        page2.goto(BASE + '#/p/' + pid + '/autoref'); page2.wait_for_selector('.mp-wheel')
        cdp = tctx.new_cdp_session(page2)
        wheel = page2.locator('[data-picker="od_sph"] .mp-wheel')
        wheel.scroll_into_view_if_needed()
        bb = wheel.bounding_box()
        cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        y_before = page2.evaluate('window.scrollY')
        touch_swipe(page2, cdp, cx, cy, cy - 160)                  # unarmed: must not change the value
        page2.wait_for_timeout(400)
        v0 = page2.evaluate("pid => MF.repos.db().get('autorefraction', pid)", pid)
        ok('T10 unarmed swipe never changes a value', not v0 or v0.get('od_sph') is None, v0)
        wheel.scroll_into_view_if_needed(); bb = wheel.bounding_box(); cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        touch_tap(cdp, cx, cy); page2.wait_for_timeout(150)
        ok('T10 tap arms the wheel', 'is-armed' in wheel.get_attribute('class'))
        rh = page2.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.mp-wheel')).getPropertyValue('--rh'))")
        y_before = page2.evaluate('window.scrollY')
        tr0 = page2.evaluate("() => new DOMMatrix(getComputedStyle(document.querySelector('[data-picker=od_sph] .mp-track')).transform).m42")
        touch_swipe(page2, cdp, cx, cy, cy - rh * 5)               # finger up 5 rows
        page2.wait_for_timeout(700)
        tr1 = page2.evaluate("() => new DOMMatrix(getComputedStyle(document.querySelector('[data-picker=od_sph] .mp-track')).transform).m42")
        y_after = page2.evaluate('window.scrollY')
        ar = page2.evaluate("pid => MF.repos.db().get('autorefraction', pid)", pid) or {}
        ok('T10 content moved with the finger (track moved up)', tr1 < tr0, (tr0, tr1))
        ok('T10 no page movement while dragging the armed wheel', abs(y_after - y_before) < 2, (y_before, y_after))
        ok('T10 OD sphere = -1.25 after swiping', ar.get('od_sph') == -1.25, ar.get('od_sph'))
        ok('T10 Referral_Refractive_Error alert shown', page2.locator('[data-ref-alert] .notice-warn').count() == 1)
        ok('T10 referral marker in context bar', page2.locator('.ctx .ref-btn').count() == 1)
        page2.screenshot(path=OUT + '/autoref_phone.png', full_page=True)

        # TEST 11 — typed entry (tap the centre of the armed wheel -> list with typing)
        cs_wheel = page2.locator('[data-picker="od_cyl"] .mp-wheel'); cs_wheel.scroll_into_view_if_needed()
        bb = cs_wheel.bounding_box(); cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        touch_tap(cdp, cx, cy); page2.wait_for_timeout(120)
        touch_tap(cdp, cx, cy); page2.wait_for_selector('.pl-input')
        page2.fill('.pl-input', '-2.00'); page2.locator('.pl-apply').click(); page2.wait_for_timeout(700)
        ar = page2.evaluate("pid => MF.repos.db().get('autorefraction', pid)", pid)
        ok('T11 typed -2.00 stored', ar.get('od_cyl') == -2.0, ar.get('od_cyl'))
        ok('T11 wheel synchronised to -2.00', cs_wheel.get_attribute('aria-valuetext') == '−2.00', cs_wheel.get_attribute('aria-valuetext'))
        cs_wheel.scroll_into_view_if_needed(); bb = cs_wheel.bounding_box(); cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        touch_tap(cdp, cx, cy); page2.wait_for_timeout(100)
        if not page2.locator('.pl-input').count():
            touch_tap(cdp, cx, cy)
        page2.wait_for_selector('.pl-input')
        page2.fill('.pl-input', '-1.32'); page2.keyboard.press('Enter'); page2.wait_for_timeout(700)
        ar = page2.evaluate("pid => MF.repos.db().get('autorefraction', pid)", pid)
        note = page2.locator('[data-picker="od_cyl"] .mp-note')
        ok('T11 -1.32 snapped to -1.25 and stored', ar.get('od_cyl') == -1.25, ar.get('od_cyl'))
        ok('T11 snapping shown visibly', note.is_visible() and '1.25' in note.inner_text(), note.inner_text() if note.count() else '')
        ok('T11 displayed equals stored', cs_wheel.get_attribute('aria-valuetext') == '−1.25')

        # TEST 12 — tap list
        ax = page2.locator('[data-picker="od_axis"] .mp-wheel'); ax.scroll_into_view_if_needed()
        bb = ax.bounding_box(); cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
        touch_tap(cdp, cx, cy); page2.wait_for_timeout(100); touch_tap(cdp, cx, cy)
        page2.wait_for_selector('.pl-list')
        ok('T12 value list opens', page2.locator('.pl-item').count() == 38)
        page2.locator('.pl-item', has_text=re.compile(r'^\s*180°\s*$')).click(); page2.wait_for_timeout(600)
        ar = page2.evaluate("pid => MF.repos.db().get('autorefraction', pid)", pid)
        ok('T12 list choice changes the same value', ar.get('od_axis') == 180 and ax.get_attribute('aria-valuetext') == '180°', (ar.get('od_axis'), ax.get_attribute('aria-valuetext')))
        page2.screenshot(path=OUT + '/autoref_phone_after.png', full_page=True)
        # carry the touch-made values back to the desktop context
        snap2 = page2.evaluate("() => MF.BackupService.exportBackup().then(r => r.blob.text())")
        tctx.close()
        page.evaluate("t => MF.BackupService.applyReplace(MF.BackupService.validate(JSON.parse(t)))", snap2)

        # ---------- TESTS 13-15 — strabismus & EOM ----------
        page.goto(BASE + '#/p/' + pid + '/strabismus'); page.wait_for_selector('.ct-card')
        dist = page.locator('.ct-card').nth(0); near = page.locator('.ct-card').nth(1)
        click_opt(dist, 'Tropia'); click_opt(dist, 'Alternating')
        ok('T13 alternating: eye NOT asked', not dist.locator('[data-when="dist_eye"]').is_visible())
        ok('T13 alternating: frequency asked', dist.locator('[data-when="dist_freq"]').is_visible())
        click_opt(dist, 'Constant')
        ok('T13 then tropia type', dist.locator('[data-when="dist_type"]').is_visible())
        click_opt(dist, 'Esotropia')
        click_opt(near, 'Tropia'); click_opt(near, 'Unilateral')
        ok('T14 unilateral: OD/OS appears', near.locator('[data-when="near_eye"]').is_visible())
        ok('T14 frequency waits for the eye', not near.locator('[data-when="near_freq"]').is_visible())
        click_opt(near.locator('[data-when="near_eye"]'), 'OD')
        ok('T14 then frequency', near.locator('[data-when="near_freq"]').is_visible())
        click_opt(near, 'Intermittent'); click_opt(near, 'Exotropia')
        st = page.evaluate("pid => MF.repos.db().get('strabismus', pid)", pid)
        wait_saved(page)
        st = page.evaluate("pid => MF.repos.db().get('strabismus', pid)", pid)
        ok('T13/14 stored independently', (st.get('dist_test'), st.get('dist_pattern'), st.get('dist_freq'), st.get('dist_type'), st.get('near_pattern'), st.get('near_eye'), st.get('near_freq'), st.get('near_type')) ==
           ('tropia', 'alternating', 'constant', 'eso', 'unilateral', 'OD', 'intermittent', 'exo'), st)
        click_opt(page.locator('[data-b="s|strabismus|eom_status"]'), 'Abnormal')
        page.locator('[data-sa="muscle"][data-eye="OD"][data-muscle="LR"]').click(); page.wait_for_timeout(200)
        page.locator('[data-mus="OD-LR"] .grade-row .opt', has_text=re.compile(r'^\s*-2\s*$')).click()
        page.locator('[data-sa="muscle"][data-eye="OS"][data-muscle="IO"]').click(); page.wait_for_timeout(200)
        page.locator('[data-mus="OS-IO"] .grade-row .opt', has_text=re.compile(r'^\s*\+1\s*$')).click()
        ok('T15 muscle action helper shown', 'Abduction' in page.locator('[data-mus="OD-LR"] .mus-help').inner_text())
        wait_saved(page)
        eom = sorted((x['eye'], x['muscle'], x['grade'], x['selected']) for x in db(page, 'eom_findings') if x['participant_id'] == pid)
        ok('T15 both findings saved', eom == [('OD', 'LR', -2, True), ('OS', 'IO', 1, True)], eom)
        page.screenshot(path=OUT + '/strabismus.png', full_page=True)

        # ---------- TESTS 16-17 — VA ----------
        page.goto(BASE + '#/p/' + pid + '/va'); page.wait_for_selector('.mp-wheel')
        w = page.locator('[data-picker="vasc_od"] .mp-wheel')
        w.focus(); page.keyboard.type('6/12'); page.wait_for_selector('.pl-input'); page.keyboard.press('Enter'); page.wait_for_timeout(600)
        ok('T16 VAsc OD 6/12 -> Referral_VA alert', page.locator('[data-va-alert] .notice-warn').count() == 1)
        ok('T16 VAcc visible because glasses = yes, not now', page.locator('[data-when="vacc"]').is_visible())
        phw = page.locator('[data-picker="ph_od"] .mp-wheel')
        phw.focus(); page.keyboard.press('Enter'); page.wait_for_selector('.pl-list')
        page.locator('.pl-item', has_text=re.compile(r'^\s*6/6\s*$')).click(); page.wait_for_timeout(500)
        wait_saved(page)
        va = page.evaluate("pid => MF.repos.db().get('visual_acuity', pid)", pid)
        ok('T16 values saved (VAsc OD 6/12, Pinhole OD 6/6)', va.get('vasc_od') == '6/12' and va.get('ph_od') == '6/6', va)
        w2 = page.locator('[data-picker="vasc_os"] .mp-wheel')
        w2.focus(); page.keyboard.type('6/10'); page.keyboard.press('Enter'); page.wait_for_timeout(200)
        sug = page.locator('.pl-sug .opt').all_inner_texts()
        ok('T16 invalid VA not invented; closest choices offered', sorted(x.strip() for x in sug) == ['6/12', '6/9'], sug)
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        cause = page.locator('[data-b="s|visual_acuity|cause"]')
        click_opt(cause, 'كسل بالعين')
        ok('T17 one eye / both appears', page.locator('[data-when="ambly"]').is_visible())
        click_opt(page.locator('[data-b="s|visual_acuity|ambly_lat"]'), 'عين واحدة')
        ok('T17 OD/OS appears', page.locator('[data-when="amblyEye"]').is_visible())
        click_opt(page.locator('[data-b="s|visual_acuity|ambly_eye"]'), 'OS')
        wait_saved(page)
        page.screenshot(path=OUT + '/va.png', full_page=True)

        # ---------- TESTS 18-20 — questionnaire ----------
        page.goto(BASE + '#/p/' + pid + '/questionnaire/A'); page.wait_for_selector('.qq')
        txt = page.locator('.station').inner_text()
        autos = page.locator('[data-auto-v]').all_inner_texts()
        ok('T18 demographic section visible and populated', autos[:4] == ['1-1', 'ذكر', '13 سنة', 'الثاني'], autos)
        ok('T18 parent glasses derived (father only = one parent)', autos[4:6] == ['نعم', 'لا'], autos[4:6])
        all_q = []
        for sid in ['A', 'B1', 'B2', 'C', 'D', 'E', 'F', 'G']:
            page.goto(BASE + '#/p/' + pid + '/questionnaire/' + sid); page.wait_for_selector('.qq')
            t = page.locator('.station').inner_text()
            all_q.append(t)
            nums = [int(x) for x in page.locator('.qq .q-num').all_inner_texts()]
            ok('T18 numbering 1..n in section ' + sid, nums == list(range(1, len(nums) + 1)), nums)
        joined = '\n'.join(all_q)
        bad = re.findall(r'\b(15a|23c|25b|15ب|23ج|25ب|15أ)\b|\d+[أبجدهـوز]\)', joined)
        ok('T18 original labels (15a, 23c, 25b …) not displayed', not bad, bad[:5])
        ok('T18 Arabic only (no English question text)', not re.search(r'How |What |Do you|Before and after', joined))
        ok('T19 university word absent from the whole questionnaire', UNI not in joined)
        page.goto(BASE + '#/p/' + pid + '/questionnaire/C'); page.wait_for_selector('.qq')
        first = page.locator('.qq').first
        first.locator('.opt', has_text='أكثر من ساعة').click(); page.wait_for_timeout(150)
        ok('T20 duration input appears', first.locator('.dur-h').is_visible())
        first.locator('.dur-h input').fill('2.5')
        q2 = page.locator('.qq').nth(1)
        q2.locator('.opt', has_text='أكثر من ساعة').click(); page.wait_for_timeout(150)
        ok('T20 missing duration flagged inline', q2.locator('[data-qerr]').is_visible())
        q2.locator('.opt', has_text='أقل من ساعة').click()
        wait_saved(page)

        # ---------- TEST 21 — Excel ----------
        page.goto(school1); page.wait_for_selector('.school-head')
        with page.expect_download() as d:
            page.locator('[data-act="export"]').click()
        x1 = OUT + '/school1.xlsx'; d.value.save_as(x1)
        wb = openpyxl.load_workbook(x1)
        ok('T21 three sheets', wb.sheetnames == ['Participants', 'Family', 'Questionnaire'], wb.sheetnames)
        P, Fm, Qs = wb['Participants'], wb['Family'], wb['Questionnaire']
        allv = [str(c.value) for ws in wb for row in ws.iter_rows() for c in row if c.value is not None]
        ok('T21 no participant names', not any('طالب تجريبي' in v for v in allv))
        hdr = [c.value for c in P[1]]
        ids = [P.cell(r, hdr.index('Participant_ID') + 1).value for r in range(2, P.max_row + 1)]
        ok('T21 IDs correct (strings 1-1,1-2,1-3,1-10)', ids == ['1-1', '1-2', '1-3', '1-10'], ids)
        row = {hdr[i]: P.cell(2, i + 1).value for i in range(len(hdr))}
        row2 = {hdr[i]: P.cell(3, i + 1).value for i in range(len(hdr))}
        ok('T21 Not tested exported (untested participant)', row2['Autoref_OD_Sphere'] == 'Not tested' and row2['VAsc_OD'] == 'Not tested' and row2['Distance_Cover_Test'] == 'Not tested', (row2['Autoref_OD_Sphere'], row2['VAsc_OD']))
        ok('T21 clinical values', row['Autoref_OD_Sphere'] == -1.25 and row['Autoref_OD_Cylinder'] == -1.25 and row['Autoref_OD_Axis'] == 180 and row['Autoref_OS_Sphere'] == 'Not tested', (row['Autoref_OD_Sphere'], row['Autoref_OD_Cylinder'], row['Autoref_OD_Axis']))
        ok('T21 referral flags', (row['Referral_VA'], row['Referral_Refractive_Error'], row['Referral_Alert']) == ('Yes', 'Yes', 'Yes'))
        ok('T21 symptoms format', row['Symptoms'] == 'Blurry Vision | Headache' and row['Blurry_Vision_Location'] == 'Distance', (row['Symptoms'], row['Blurry_Vision_Location']))
        ok('T21 EOM format', row['EOM_Findings'] == 'OD Lateral Rectus -2 | OS Inferior Oblique +1', row['EOM_Findings'])
        ok('T21 history format', row['Ocular_Disease_Injury_History'] == 'Injury: رضّ في العين — OD — 2023', row['Ocular_Disease_Injury_History'])
        ok('T21 glasses reasons', row['Glasses_Not_Currently_Worn_Reasons'] == 'Uncomfortable | Left at home', row['Glasses_Not_Currently_Worn_Reasons'])
        ok('T21 tropia columns', (row['Distance_Tropia_Pattern'], row['Distance_Tropia_Eye'], row['Near_Tropia_Eye'], row['Near_Tropia_Type']) == ('Alternating', 'Not applicable', 'OD', 'Exotropia'))
        q1 = [c.value for c in Qs[1]]; q2h = [c.value for c in Qs[2]]
        ok('T21 questionnaire section row exists', q1[2] == 'القسم أ: المعلومات الديموغرافية' and 'القسم ج: يوم دراسي اعتيادي - الأنشطة داخل الأماكن المغلقة' in q1)
        ok('T21 question text preserved, no numbers', 'قراءة مواد مطبوعة للمتعة، مثل مجلة أو رواية؟' in q2h and not any(re.match(r'^\s*\d+[\.\)]', str(h or '')) for h in q2h))
        col = [i for i, (a, b) in enumerate(zip(q1, q2h)) if a and a.startswith('القسم ج') and b == 'قراءة مواد مطبوعة للمتعة، مثل مجلة أو رواية؟'][0]
        ok('T20 export "2.5 ساعة" in the same question cell', Qs.cell(3, col + 1).value == '2.5 ساعة', Qs.cell(3, col + 1).value)
        ok('T21 Arabic readable', any('الرقم التعريفي' in str(h) for h in q2h))
        fam_rows = [[c.value for c in r] for r in Fm.iter_rows(min_row=2) if r[0].value == '1-1']
        ok('T21 family rows (5) for 1-1', len(fam_rows) == 5, len(fam_rows))
        ok('T21 university word absent from the workbook', not any(UNI in v for v in allv))

        # ---------- TEST 22 — backup round trip ----------
        page.goto(BASE + '#/'); page.wait_for_selector('.school-list')
        before = page.evaluate("() => MF.repos.db().snapshot()")
        page.locator('[data-act="backup"]').click()
        with page.expect_download() as d:
            page.locator('.action-row[data-a="export"]').click()
        bk = OUT + '/backup.json'; d.value.save_as(bk)
        page.wait_for_timeout(300)
        page.locator('[data-act="settings"]').click()
        page.locator('.set-adv summary').click()
        page.locator('[data-a="clear"]').click()
        page.wait_for_selector('.cd-check')
        dl = page.locator('.ov-actions .btn-danger')
        ok('T22 clear button disabled until confirmed', dl.is_disabled())
        page.locator('.cd-check').check()
        dl.click(); page.wait_for_selector('.empty')
        ok('T22 database cleared', len(db(page, 'participants')) == 0 and len(db(page, 'schools')) == 0)
        page.locator('[data-act="backup"]').click()
        with page.expect_file_chooser() as fc:
            page.locator('.action-row[data-a="import"]').click()
        fc.value.set_files(bk)
        page.wait_for_selector('.import-modes')
        ok('T22 import shows a summary before changing anything', '5' not in '' and len(db(page, 'schools')) == 0)
        page.locator('.ov-actions .btn-primary').click()
        page.wait_for_selector('.school-list')
        after = page.evaluate("() => MF.repos.db().snapshot()")
        def norm(s):
            return {k: sorted(json.dumps(r, sort_keys=True) for r in v) for k, v in s.items() if k != 'audit_metadata'}
        ok('T22 schools, participants, clinical, questionnaire, counters restored', norm(before) == norm(after), [k for k in before if norm(before).get(k) != norm(after).get(k)])
        cnt = page.evaluate("id => MF.SettingsRepository.participantCounter(id)", before['schools'][0]['id'] if before['schools'][0]['number'] == 1 else before['schools'][1]['id'])
        ok('T22 counter restored (next = 2)', cnt['next'] == 2, cnt)

        ok('no JavaScript errors', not errors, errors[:5])


if __name__ == '__main__':
    main()
