#!/usr/bin/env python3
"""Render home-screen PNG icons from the official logo (unaltered SVG on a light tile)."""
import base64, os
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svg = open(os.path.join(ROOT, 'assets', 'logo.svg'), 'rb').read()
uri = 'data:image/svg+xml;base64,' + base64.b64encode(svg).decode()
with sync_playwright() as p:
    b = p.chromium.launch()
    for size in (180, 192, 512):
        pg = b.new_page(viewport={'width': size, 'height': size}, device_scale_factor=1)
        pad = round(size * 0.08)
        pg.set_content('<html><body style="margin:0;background:#EFF2EF;display:flex;align-items:center;justify-content:center;width:%dpx;height:%dpx"><img src="%s" style="width:%dpx;height:%dpx"></body></html>' % (size, size, uri, size - 2 * pad, size - 2 * pad))
        pg.wait_for_timeout(100)
        pg.screenshot(path=os.path.join(ROOT, 'assets', 'icon-%d.png' % size))
        pg.close()
    b.close()
print('icons written')
