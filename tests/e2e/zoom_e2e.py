"""Reader zoom: buttons, pinch, double tap, panning to every edge, reset, and no accidental page turns while zoomed in."""
import json, re
from playwright.sync_api import sync_playwright
import os
S = os.path.dirname(os.path.abspath(__file__))
os.makedirs(S + '/shots', exist_ok=True)
U = 'http://127.0.0.1:8011/index.html'
MID = '00000000-0000-4000-8000-000000000000'
C1 = '22222222-2222-4222-8222-222222222222'   # newest
C2 = '33333333-3333-4333-8333-333333333333'   # older
IMG = {n: open(f'{S}/pages/p{n}.png', 'rb').read() for n in (1, 2, 3)}
H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}

state = {'pages_calls': [], 'reports': [], 'img_hits': [], 'fail_first_image': False, 'node': 'node-a', 'blocked': set()}

def manga():
    return {'id': MID, 'title': 'Reader Test', 'description': 'x', 'year': 2024, 'status': 'ongoing', 'contentRating': 'safe',
            'authors': ['A'], 'tags': ['Action'], 'coverUrl': None, 'mangaDexUrl': 'https://mangadex.org/title/x'}

def chapter(cid, num, pages=3):
    return {'sourceId': 'mangadex', 'externalId': cid, 'mangaExternalId': MID, 'chapterNumber': num, 'volumeNumber': None,
            'title': '', 'language': 'en', 'pages': pages, 'publishedAt': '2025-01-01T00:00:00Z', 'scanlationGroups': ['Test Group'],
            'sourceUrl': f'https://mangadex.org/chapter/{cid}'}

def worker(route):
    url = route.request.url
    if route.request.method == 'OPTIONS':
        return route.fulfill(status=204, headers=H)
    if url.endswith('/health'):
        return route.fulfill(status=200, content_type='application/json', headers=H, body='{"ok":true}')
    if '/pages' in url:
        state['pages_calls'].append(url)
        base = f"https://{state['node']}.example.network"
        n = len(state['pages_calls'])
        body = {'data': {'chapterId': C1 if C1 in url else C2, 'mangaExternalId': MID, 'baseUrl': base, 'hash': 'abc123def456',
                         'data': ['1.png', '2.png', '3.png'], 'dataSaver': ['1.jpg', '2.jpg', '3.jpg'], 'validForSeconds': 900}}
        return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps(body))
    if '/chapters' in url:
        return route.fulfill(status=200, content_type='application/json', headers=H,
                             body=json.dumps({'data': [chapter(C1, '2'), chapter(C2, '1')], 'pagination': {'page': 1, 'limit': 24, 'total': 2, 'hasNext': False}}))
    if '/api/v1/manga/' in url:
        m = manga(); m.update({'sourceId': 'mangadex', 'externalId': MID, 'contentType': 'manga'})
        return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': m}))
    return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': [manga()], 'total': 1, 'limit': 24, 'page': 1}))

def images(route):
    url = route.request.url
    state['img_hits'].append(url)
    name = url.rsplit('/', 1)[1]
    n = int(name.split('.')[0])
    if state['node'] == 'node-b' and 'node-a' in url:
        return route.fulfill(status=403, body='expired')
    if 'node-a' in url and state['fail_first_image']:
        return route.fulfill(status=403, body='expired')
    return route.fulfill(status=200, content_type='image/png', headers={'access-control-allow-origin': '*'}, body=IMG[n])

def report(route):
    if route.request.method == 'OPTIONS':
        return route.fulfill(status=204, headers=H)
    state['reports'].append({'body': json.loads(route.request.post_data), 'ctype': route.request.headers.get('content-type'),
                             'auth': route.request.headers.get('authorization')})
    return route.fulfill(status=200, headers=H, body='')

def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        raise SystemExit(1)


def zoom_percent(pg):
    return int(re.sub(r'[^0-9]', '', pg.inner_text('.reader-zoom-label') or '0') or 0)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, service_workers='block')
    ctx.add_init_script("localStorage.setItem('tml-reader-tips-seen','1')")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    ctx.route('**/*.workers.dev/**', worker)
    ctx.route('**/*.example.network/**', images)
    ctx.route('https://api.mangadex.network/**', report)
    cdp = ctx.new_cdp_session(pg)

    pg.goto(U + '#discover'); pg.wait_for_selector('[data-action="details"]', timeout=8000)
    pg.click('[data-action="details"]'); pg.wait_for_selector('.chapter-row', timeout=8000)
    pg.click(f'[data-action="read-chapter"][data-chapter-id="{C1}"]')
    pg.wait_for_selector('.reader-img', timeout=8000)
    pg.wait_for_function("() => document.querySelectorAll('.reader-img[data-state=done]').length >= 1", timeout=8000)
    width = lambda: pg.evaluate("() => document.querySelector('.reader-img').getBoundingClientRect().width")
    base = width()
    ok(pg.get_attribute('.reader-stage', 'data-zoomed') == 'false' and pg.locator('.reader-zoom-pill').count() == 0, 'starts fit to screen with no zoom pill')

    # ---- buttons (vertical scroll mode)
    pg.click('[data-reader="sheet-open"]')
    pg.click('[data-reader="zoom-in"]'); pg.click('[data-reader="zoom-in"]')
    ok(zoom_percent(pg) == 156, 'two taps on + give 156%')
    pg.click('.reader-sheet [data-reader="sheet-close"]'); pg.wait_for_selector('.reader-sheet', state='detached')
    ok(abs(width() / base - 1.56) < 0.03, 'the page is 1.56 times wider')
    ok(pg.evaluate("() => { const s = document.querySelector('.reader-stage'); return s.scrollWidth > s.clientWidth + 100; }"), 'the zoomed page can be panned sideways')
    ok(pg.locator('.reader-zoom-pill').is_visible(), 'a zoom pill with Reset is shown')
    pg.evaluate("() => { document.querySelector('.reader-stage').scrollLeft = 0; }")
    ok(pg.evaluate("() => document.querySelector('.reader-img').getBoundingClientRect().left >= -1"), 'the left edge of the page is reachable')
    pg.evaluate("() => { const s = document.querySelector('.reader-stage'); s.scrollLeft = s.scrollWidth; }")
    ok(pg.evaluate("() => document.querySelector('.reader-img').getBoundingClientRect().right <= window.innerWidth + 1"), 'the right edge of the page is reachable')
    pg.click('[data-reader="zoom-reset"]')
    ok(pg.get_attribute('.reader-stage', 'data-zoomed') == 'false' and abs(width() - base) < 2, 'Reset brings the page back to fit')
    ok(pg.evaluate("() => { const s = document.querySelector('.reader-stage'); return s.scrollWidth <= s.clientWidth + 1; }"), 'no sideways scrolling left after reset')

    # ---- pinch (two real touch points)
    def touch(kind, points):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i + 1} for i, (x, y) in enumerate(points)]})
    touch('touchStart', [(150, 400), (240, 400)])
    for step in range(1, 6):
        touch('touchMove', [(150 - step * 10, 400), (240 + step * 20, 400)])
    touch('touchEnd', [])
    pg.wait_for_timeout(200)
    ok(pg.get_attribute('.reader-stage', 'data-zoomed') == 'true', 'pinching out zooms in')
    pct = int(re.sub(r'[^0-9]', '', pg.inner_text('.reader-zoom-pill span')))
    ok(255 <= pct <= 280, f'the pinch zoom follows the fingers: gap 90 -> 240 is about 267% (got {pct}%)')
    touch('touchStart', [(100, 400), (300, 400)])
    for step in range(1, 6):
        touch('touchMove', [(100 + step * 16, 400), (300 - step * 16, 400)])
    touch('touchEnd', [])
    pg.wait_for_timeout(200)
    ok(pg.get_attribute('.reader-stage', 'data-zoomed') == 'false', 'pinching in goes back to fit')

    # ---- double tap (the bars end up as they were)
    bars_before = pg.evaluate("() => !document.querySelector('.reader-bar').hidden")
    pg.mouse.click(195, 420, click_count=2)
    pg.wait_for_timeout(300)
    ok(zoom_percent_pill := int(re.sub(r'[^0-9]', '', pg.inner_text('.reader-zoom-pill span'))) == 250, 'double tap zooms to 250%')
    ok(pg.evaluate("() => !document.querySelector('.reader-bar').hidden") == bars_before, 'a double tap does not leave the bars toggled')
    pg.mouse.click(195, 420, click_count=2); pg.wait_for_timeout(300)
    ok(pg.get_attribute('.reader-stage', 'data-zoomed') == 'false', 'double tap again goes back to fit')

    # ---- keyboard
    pg.keyboard.press('+'); pg.keyboard.press('+')
    ok(pg.get_attribute('.reader-stage', 'data-zoomed') == 'true', '+ zooms in')
    pg.keyboard.press('0')
    ok(pg.get_attribute('.reader-stage', 'data-zoomed') == 'false', '0 resets')

    # ---- paged mode: no accidental page turns while zoomed
    pg.click('[data-reader="sheet-open"]'); pg.click('[data-reader="set-mode"][data-value="rtl"]'); pg.wait_for_selector('.reader-stage[data-mode="rtl"]')
    pg.click('.reader-sheet [data-reader="zoom-in"]'); pg.click('.reader-sheet [data-reader="zoom-in"]')
    pg.click('.reader-sheet [data-reader="sheet-close"]'); pg.wait_for_selector('.reader-sheet', state='detached')
    pg.wait_for_function("() => document.querySelector('.reader-img').dataset.state === 'done'")
    ok(pg.evaluate("() => { const s = document.querySelector('.reader-stage'); return s.scrollWidth > s.clientWidth + 100; }"), 'a zoomed single page can be panned too')
    before = pg.evaluate("document.getElementById('readerCount').textContent")
    pg.mouse.click(20, 420); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.getElementById('readerCount').textContent") == before, 'tapping the edge while zoomed does not turn the page')
    pg.click('[data-reader="zoom-reset"]')
    pg.mouse.click(20, 420); pg.wait_for_timeout(500)
    ok(pg.evaluate("document.getElementById('readerCount').textContent") != before, 'after Reset the edge tap turns the page again')
    pg.keyboard.press('+'); pg.keyboard.press('ArrowLeft'); pg.wait_for_timeout(400)
    ok(pg.evaluate("() => { const s = document.querySelector('.reader-stage'); return s.scrollLeft === 0 && s.scrollTop === 0; }"), 'a new page starts at its top-left corner while zoomed')
    ok(not errs, 'no page errors: ' + str(errs))
    b.close()
print('zoom e2e ok')
