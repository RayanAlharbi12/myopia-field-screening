#!/usr/bin/env python3
"""Screenshots of every main screen at 390/430/768/1024/1280/1440 px, light and dark.
Loads the QA backup (tests/qa_flow.py output) so screens show realistic test data.
Usage: python3 tests/screens.py [base_url] [backup.json] [out_dir]"""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
BK = sys.argv[2] if len(sys.argv) > 2 else '/tmp/mfs-qa/backup.json'
OUT = sys.argv[3] if len(sys.argv) > 3 else '/tmp/mfs-shots'
os.makedirs(OUT, exist_ok=True)
WIDTHS = [(390, 844), (430, 932), (768, 1024), (1024, 768), (1280, 800), (1440, 900)]


def main():
    backup = open(BK, encoding='utf-8').read()
    data = json.loads(backup)['data']
    p11 = [p for p in data['participants'] if p['code'] == '1-1'][0]
    p12 = [p for p in data['participants'] if p['code'] == '1-2'][0]
    s1 = [s for s in data['schools'] if s['number'] == 1][0]
    routes = [
        ('home', '#/'),
        ('school', '#/school/' + s1['id']),
        ('reg-a', '#/p/%s/registration/a' % p11['id']),
        ('reg-c', '#/p/%s/registration/c' % p11['id']),
        ('reg-d', '#/p/%s/registration/d' % p11['id']),
        ('reg-e', '#/p/%s/registration/e' % p11['id']),
        ('reg-h', '#/p/%s/registration/h' % p11['id']),
        ('autoref', '#/p/%s/autoref' % p11['id']),
        ('autoref-nt', '#/p/%s/autoref' % p12['id']),
        ('strab', '#/p/%s/strabismus' % p11['id']),
        ('va', '#/p/%s/va' % p11['id']),
        ('q-a', '#/p/%s/questionnaire/A' % p11['id']),
        ('q-c', '#/p/%s/questionnaire/C' % p11['id']),
        ('q-g', '#/p/%s/questionnaire/G' % p11['id']),
    ]
    with sync_playwright() as p:
        b = p.chromium.launch()
        for theme in ['light', 'dark']:
            for (w, h) in WIDTHS:
                touch = w < 1100
                c = b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, has_touch=touch, is_mobile=w < 700, color_scheme=theme)
                pg = c.new_page()
                pg.goto(BASE); pg.wait_for_selector('#app > *')
                pg.evaluate("t => MF.BackupService.applyReplace(MF.BackupService.validate(JSON.parse(t)))", backup)
                for name, r in routes:
                    pg.goto(BASE + r); pg.wait_for_timeout(450)
                    over = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
                    if over > 0:
                        print('HORIZONTAL OVERFLOW', theme, w, name, over)
                    pg.screenshot(path='%s/%s-%d-%s.png' % (OUT, theme, w, name), full_page=False)
                    if name in ('reg-e', 'strab', 'va', 'q-c', 'autoref'):
                        pg.screenshot(path='%s/%s-%d-%s-full.png' % (OUT, theme, w, name), full_page=True)
                # dialogs
                pg.goto(BASE + '#/school/' + s1['id']); pg.wait_for_selector('.school-head')
                pg.locator('[data-act="counter"]').click(); pg.wait_for_timeout(300)
                pg.screenshot(path='%s/%s-%d-dlg-counter.png' % (OUT, theme, w))
                pg.keyboard.press('Escape'); pg.wait_for_timeout(250)
                pg.goto(BASE + '#/p/%s/autoref' % p11['id']); pg.wait_for_selector('.mp-wheel')
                pg.evaluate("() => MF.Picker.all()[0].openList()"); pg.wait_for_timeout(350)
                pg.screenshot(path='%s/%s-%d-dlg-list.png' % (OUT, theme, w))
                c.close()
        b.close()
    print('done')


if __name__ == '__main__':
    main()
