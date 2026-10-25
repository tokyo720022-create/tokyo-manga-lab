"""Themes: the picker lists every theme, choosing one applies and saves it, the moon button cycles, and a light theme sets the light colour scheme."""
import json, os, sys, urllib.parse
from playwright.sync_api import sync_playwright
S = os.path.dirname(os.path.abspath(__file__)); U = os.environ.get('E2E_URL', 'http://127.0.0.1:8011/index.html')
H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}
fails = []
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
def worker(r):
    if r.request.method == 'OPTIONS': return r.fulfill(status=204, headers=H)
    if urllib.parse.urlparse(r.request.url).path.endswith('/health'): return r.fulfill(status=200, content_type='application/json', headers=H, body='{"ok":true}')
    return r.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': [], 'total': 0, 'limit': 24, 'page': 1}))
def saved(pg):
    return pg.evaluate("""() => new Promise(res=>{const r=indexedDB.open('tokyo-manga-lab');r.onsuccess=()=>{const g=r.result.transaction('appSettings').objectStore('appSettings').get('theme');g.onsuccess=()=>{res(g.result&&g.result.value);r.result.close()}}})""")
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    c.route('**/*.workers.dev/**', worker); pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '#settings/appearance'); pg.wait_for_selector('.theme-grid')
    ok(pg.locator('.theme-card').count() == 10, 'picker lists all 10 themes')
    ok('Special' in pg.inner_text('.theme-grid'), 'Gintama is tagged Special')
    ok(pg.evaluate("document.documentElement.dataset.theme") == 'sakura', 'default theme is Sakura Night')
    pg.click('.theme-card:has-text("Gintama")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("document.documentElement.dataset.theme") == 'gintama', 'choosing Gintama applies it')
    ok(saved(pg) == 'gintama', 'the choice is saved')
    ok(pg.get_attribute('meta[name="theme-color"]', 'content') == '#0b0f1d', 'browser bar colour follows the theme')
    pg.click('.theme-card:has-text("Sakura Flowers")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.documentElement.style.colorScheme") == 'light', 'a light theme sets the light colour scheme')
    bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    ok(bg == 'rgb(255, 244, 247)', 'light theme background is applied: ' + bg)
    pg.reload(); pg.wait_for_selector('.theme-grid'); pg.wait_for_timeout(300)
    ok(pg.evaluate("document.documentElement.dataset.theme") == 'sakura-flowers' and pg.is_checked('.theme-card:has-text("Sakura Flowers") input'), 'the theme is still applied and selected after a reload')
    pg.click('[data-action="toggle-theme"]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.documentElement.dataset.theme") == 'one-piece', 'the moon button moves to the next theme')
    for _ in range(9): pg.click('[data-action="toggle-theme"]'); pg.wait_for_timeout(120)
    ok(pg.evaluate("document.documentElement.dataset.theme") == 'sakura-flowers', 'ten taps in all cycle through every theme and come back')
    ok(pg.evaluate("document.querySelectorAll('.theme-card input:checked').length") == 1, 'exactly one card is selected')
    pg.screenshot(path=S + '/shots/themes-picker.png', full_page=True)
    ok(not errs, 'no page errors: %s' % errs)
    b.close()
if fails: sys.exit('FAILED: ' + '; '.join(fails))
print('THEMES E2E PASSED')
