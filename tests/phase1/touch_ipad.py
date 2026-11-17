#!/usr/bin/env python3
"""Touch behaviour of the measurement wheels on iPad portrait/landscape and a phone (spec tests 10, 24, 25).
Usage: python3 tests/touch_ipad.py [base_url] [backup.json]"""
import json, sys, time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/index.html'
BK = sys.argv[2] if len(sys.argv) > 2 else '/tmp/mfs-qa/backup.json'
RES = []


def ok(n, c, d=''):
    RES.append((n, bool(c)))
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(d)))


def swipe(cdp, x, y0, y1, ms=220, hold=0.25):
    steps = max(6, int(ms / 16))
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y0}]})
    for i in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y0 + (y1 - y0) * i / steps}]})
        time.sleep(ms / 1000 / steps)
    if hold: time.sleep(hold)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def tap(cdp, x, y):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    time.sleep(0.04)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def center(loc):
    loc.scroll_into_view_if_needed()
    b = loc.bounding_box()
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


def main():
    bk = open(BK, encoding='utf-8').read()
    data = json.loads(bk)['data']
    p12 = [p for p in data['participants'] if p['code'] == '1-2'][0]['id']
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, vp, mobile in [('iPad portrait', (768, 1024), True), ('iPad landscape', (1024, 768), True), ('phone 430', (430, 932), True)]:
            c = b.new_context(viewport={'width': vp[0], 'height': vp[1]}, has_touch=True, is_mobile=mobile)
            pg = c.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector('#app > *')
            pg.evaluate("t => MF.BackupService.applyReplace(MF.BackupService.validate(JSON.parse(t)))", bk)
            pg.goto(BASE + '#/p/%s/autoref' % p12); pg.wait_for_selector('.mp-wheel')
            cdp = c.new_cdp_session(pg)
            get = lambda f: (pg.evaluate("pid => MF.repos.db().get('autorefraction', pid)", p12) or {}).get(f)
            os_sph = pg.locator('[data-picker="os_sph"] .mp-wheel')
            x, y = center(os_sph)
            pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(100)
            x, y = center(os_sph)
            s0 = pg.evaluate('window.scrollY')
            swipe(cdp, x, y + 60, y - 120, ms=180, hold=0)
            pg.wait_for_timeout(700)
            s1 = pg.evaluate('window.scrollY')
            scrollable = pg.evaluate('document.documentElement.scrollHeight > innerHeight + 4')
            ok(name + ': swipe on an unarmed wheel scrolls the page' + ('' if scrollable else ' (page fits the screen: nothing to scroll)'), s1 != s0 or not scrollable, (s0, s1))
            ok(name + ': ...and never sets a value', get('os_sph') is None, get('os_sph'))
            x, y = center(os_sph)
            tap(cdp, x, y); pg.wait_for_timeout(120)
            rh = pg.evaluate("() => parseFloat(getComputedStyle(document.querySelector('.mp-wheel')).getPropertyValue('--rh'))")
            s0 = pg.evaluate('window.scrollY')
            swipe(cdp, x, y - rh, y + rh * 2, ms=300, hold=0.25)          # finger down 3 rows, slow
            pg.wait_for_timeout(600)
            ok(name + ': finger down 3 rows -> +0.75 (towards plus, follows the finger)', get('os_sph') == 0.75, get('os_sph'))
            ok(name + ': page did not move while the armed wheel was dragged', abs(pg.evaluate('window.scrollY') - s0) < 2)
            swipe(cdp, x, y + rh, y - rh * 2.2, ms=90, hold=0)              # quick flick up
            pg.wait_for_timeout(1600)
            v = get('os_sph')
            ok(name + ': flick has momentum (travels further than the finger)', v is not None and v < 0.75 - 0.75, v)
            ok(name + ': settles exactly on a 0.25 step', v is not None and abs(v * 4 - round(v * 4)) < 1e-9, v)
            txt = os_sph.get_attribute('aria-valuetext')
            ok(name + ': display equals stored value', txt == ('+%.2f' % v if v > 0 else ('0.00' if v == 0 else '−%.2f' % abs(v))), (txt, v))
            # station navigation by touch
            nav = pg.locator('.sn-item').nth(3)
            nav.scroll_into_view_if_needed(); bb = nav.bounding_box()
            tap(cdp, bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); pg.wait_for_timeout(500)
            ok(name + ': station navigation by tap', '/va' in pg.url, pg.url)
            vw = pg.locator('[data-picker="vasc_os"] .mp-wheel')
            x, y = center(vw)
            tap(cdp, x, y); pg.wait_for_timeout(120)
            swipe(cdp, x, y + rh, y - rh, ms=260, hold=0.25)               # finger up 2 rows: 6/6 -> 6/9
            pg.wait_for_timeout(600)
            va = pg.evaluate("pid => MF.repos.db().get('visual_acuity', pid)", p12) or {}
            ok(name + ': VA wheel 6/6 -> 6/9 by finger up 2 rows', va.get('vasc_os') == '6/9', va.get('vasc_os'))
            x, y = center(vw)
            tap(cdp, x, y); pg.wait_for_timeout(450)
            ok(name + ': tapping the current value opens the list', pg.locator('.pl-list').count() == 1)
            it = pg.locator('.pl-item', has_text='CF')
            it.scroll_into_view_if_needed(); bb = it.bounding_box()
            ok(name + ': list rows are large (>= 44 px)', bb['height'] >= 44, bb['height'])
            tap(cdp, bb['x'] + 30, bb['y'] + bb['height'] / 2); pg.wait_for_timeout(600)
            va = pg.evaluate("pid => MF.repos.db().get('visual_acuity', pid)", p12) or {}
            ok(name + ': list choice by tap', va.get('vasc_os') == 'CF', va.get('vasc_os'))
            ok(name + ': no JS errors', not errs, errs[:3])
            c.close()
        b.close()
    bad = [r for r in RES if not r[1]]
    print('\n%d checks, %d failed' % (len(RES), len(bad)))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
