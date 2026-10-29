import json, os, urllib.parse
from playwright.sync_api import sync_playwright
S = os.path.dirname(os.path.abspath(__file__))
os.makedirs(S + '/shots', exist_ok=True)
U = 'http://127.0.0.1:8011/index.html'
H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}
NATIVE = """window.__opened=null;window.Capacitor={isNativePlatform:()=>true,Plugins:{App:{addListener:async()=>{},getLaunchUrl:async()=>null},Browser:{open:async({url})=>{window.__opened=url},close:async()=>{}}}};"""
def worker(route):
    pu = urllib.parse.urlparse(route.request.url)
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=H)
    if pu.path.endswith('/health'): return route.fulfill(status=200, content_type='application/json', headers=H, body='{"ok":true}')
    return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': [], 'total': 0, 'limit': 24, 'page': 1}))
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: raise SystemExit(1)
with sync_playwright() as p:
    b = p.chromium.launch()

    # 1. Web build: AniList is offered, clearly optional, and the rest of the app is not gated.
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    ctx.route('**/*.workers.dev/**', worker)
    ctx.route('https://anilist.co/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<title>AniList</title>'))
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '#profile'); pg.wait_for_selector('.login-card')
    card = pg.inner_text('.login-card')
    ok('Optional' in card and 'works fully without it' in card, 'card says AniList is optional')
    ok('anilist.co' in card and 'before typing your password' in card, 'card tells you to check the anilist.co address')
    ok(pg.query_selector('[data-action="anilist-connect"]') is None and pg.query_selector('[data-action="anilist-paste-token"]') is not None, 'browser: offers a token paste instead of one-tap login')
    pg.screenshot(path=S + '/shots/login-card-web.png')
    with ctx.expect_page() as popup:
        pg.click('.login-card [data-action="anilist-register"]')
    ok('anilist.co/signup' in popup.value.url, 'Register opens anilist.co/signup in a new tab')
    popup.value.close()
    pg.click('[data-action="anilist-card-hide"]'); pg.wait_for_timeout(400)
    ok(pg.query_selector('#anilistCardTitle') is None and 'Connect AniList' in pg.inner_text('#appView'), 'Not now collapses the card to a small link')
    pg.goto(U + '#library'); pg.wait_for_timeout(500)
    ok(pg.query_selector('#appView h1') is not None, 'library opens without signing in')
    pg.goto(U + '#profile'); pg.wait_for_timeout(500)
    ok(pg.query_selector('#anilistCardTitle') is None, 'the choice is remembered')
    pg.click('[data-action="anilist-card-show"]'); pg.wait_for_selector('#anilistCardTitle')
    ok(True, 'the card can be brought back')
    ok(errs == [], 'no page errors (web)')
    ctx.close()

    # 2. Android shell: the built-in app ID makes it one tap.
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    ctx.add_init_script(NATIVE); ctx.route('**/*.workers.dev/**', worker)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(U + '#profile'); pg.wait_for_selector('.login-card [data-action="anilist-connect"]')
    pg.screenshot(path=S + '/shots/login-card-native.png')
    pg.click('.login-card [data-action="anilist-connect"]'); pg.wait_for_timeout(600)
    opened = pg.evaluate('window.__opened')
    ok(opened and 'client_id=44302' in opened and 'response_type=token' in opened and 'redirect_uri' not in opened, 'one tap opens AniList with the built-in app ID')

    # 3. An ID typed in Settings (advanced) wins over the built-in one.
    pg.goto(U + '#settings/account'); pg.wait_for_selector('[data-setting="anilistClientId"]', state='attached')
    pg.evaluate("document.querySelectorAll('details.fold').forEach(d => { d.open = true; })")
    pg.fill('[data-setting="anilistClientId"]', '54060'); pg.keyboard.press('Tab'); pg.wait_for_timeout(500)
    pg.goto(U + '#profile'); pg.wait_for_selector('.login-card [data-action="anilist-connect"]')
    pg.evaluate('window.__opened = null')
    pg.click('.login-card [data-action="anilist-connect"]'); pg.wait_for_timeout(600)
    ok('client_id=54060' in (pg.evaluate('window.__opened') or ''), 'a typed app ID wins over the built-in one')
    ok(not errs, 'no page errors (app)')
    b.close()
print('ALL LOGIN CARD E2E CHECKS PASSED')
