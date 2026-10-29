"""MyAnimeList: sign-in (PKCE redirect), list import, sending changes back, tracking panel, profile source switch.
Everything is mocked: the Worker (including its /api/v1/mal routes) and AniList. Nothing leaves the machine."""
import json, os, urllib.parse
from playwright.sync_api import sync_playwright
S = os.path.dirname(os.path.abspath(__file__))
U = 'http://127.0.0.1:8011/index.html'
H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
CLIENT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
ATOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' + 'a' * 60 + '.' + 'b' * 40

mal = {'token_calls': [], 'patches': [], 'lists': 0, 'details': [], 'searches': [], 'status': {}, 'refresh_fail': False}
LIST = [
  {'node': {'id': 13, 'title': 'Monster', 'main_picture': {'large': 'https://cdn.myanimelist.net/images/manga/3/l.jpg'}, 'alternative_titles': {'en': 'Monster', 'ja': 'MONSTER', 'synonyms': []}, 'start_date': '1994-12-05', 'synopsis': 'x', 'genres': [{'id': 1, 'name': 'Mystery'}], 'num_chapters': 162, 'nsfw': 'white', 'media_type': 'manga'},
   'list_status': {'status': 'reading', 'score': 8, 'num_volumes_read': 3, 'num_chapters_read': 40, 'is_rereading': False, 'updated_at': '2026-10-20T10:00:00+00:00'}},
  {'node': {'id': 2, 'title': 'Berserk', 'main_picture': {'large': 'https://cdn.myanimelist.net/images/manga/1/b.jpg'}, 'alternative_titles': {'en': 'Berserk', 'ja': '', 'synonyms': []}, 'start_date': '1989-08-25', 'synopsis': '', 'genres': [], 'num_chapters': 0, 'nsfw': 'white', 'media_type': 'manga'},
   'list_status': {'status': 'plan_to_read', 'score': 0, 'num_volumes_read': 0, 'num_chapters_read': 0, 'is_rereading': False, 'updated_at': '2026-10-21T10:00:00+00:00'}},
]
for row in LIST: mal['status'][row['node']['id']] = dict(row['list_status'])

def worker(route):
    url = route.request.url; pu = urllib.parse.urlparse(url); q = urllib.parse.parse_qs(pu.query)
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=H)
    def ok(data, **extra): return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': data, **extra}))
    path = pu.path
    if path.endswith('/health'): return route.fulfill(status=200, content_type='application/json', headers=H, body='{"ok":true}')
    if path == '/api/v1/mal/token':
        body = json.loads(route.request.post_data); mal['token_calls'].append(body)
        if body['grant_type'] == 'refresh_token' and mal['refresh_fail']:
            return route.fulfill(status=400, content_type='application/json', headers=H, body=json.dumps({'error': {'code': 'MAL_AUTH_FAILED', 'message': 'no'}}))
        return ok({'access_token': 'AT' + str(len(mal['token_calls'])) + 'x' * 30, 'refresh_token': 'RT' + str(len(mal['token_calls'])) + 'y' * 30, 'expires_in': 3600, 'token_type': 'Bearer'})
    if path.startswith('/api/v1/mal/'):
        if not route.request.headers.get('authorization', '').startswith('Bearer AT'):
            return route.fulfill(status=401, content_type='application/json', headers=H, body=json.dumps({'error': {'code': 'UNAUTHORIZED', 'message': 'x'}}))
        if path == '/api/v1/mal/me':
            return ok({'id': 9, 'name': 'Kai Tanaka', 'picture': 'https://cdn.myanimelist.net/images/userimages/9.jpg', 'location': 'Tokyo', 'joined_at': '2015-03-02T10:00:00+00:00', 'anime_statistics': {'num_items': 120, 'num_episodes': 2000, 'mean_score': 7.9}})
        if path == '/api/v1/mal/list':
            mal['lists'] += 1
            return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': LIST, 'hasNext': False, 'hidden': 0, 'nextOffset': 100}))
        if path == '/api/v1/mal/search':
            mal['searches'].append(q.get('q', [''])[0])
            return ok([{'id': 77, 'title': 'Found On MAL', 'alternative_titles': {'en': 'Found On MAL'}, 'media_type': 'manga', 'start_date': '2020-01-01', 'num_chapters': 40, 'nsfw': 'white'}])
        parts = path.split('/')
        if len(parts) >= 6 and parts[4] == 'manga':
            mid = int(parts[5])
            if route.request.method == 'PATCH':
                body = json.loads(route.request.post_data); mal['patches'].append((mid, body))
                st = mal['status'].setdefault(mid, {'status': 'reading', 'score': 0, 'num_volumes_read': 0, 'num_chapters_read': 0, 'is_rereading': False})
                for k, v in body.items(): st[k] = v
                st['updated_at'] = '2026-10-28T10:00:00+00:00'
                return ok(st)
            mal['details'].append(mid)
            node = next((r['node'] for r in LIST if r['node']['id'] == mid), {'id': mid, 'title': 'Other', 'num_chapters': 40})
            return ok({**node, 'my_list_status': mal['status'].get(mid)} if mid in mal['status'] else node)
    return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': [], 'total': 0, 'limit': 24, 'page': 1}))

ani = {'viewer': 0}
def anilist(route):
    h = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=h)
    q = json.loads(route.request.post_data)['query']
    def ok(data): return route.fulfill(status=200, content_type='application/json', headers=h, body=json.dumps({'data': data}))
    if 'MediaListCollection' in q: return ok({'MediaListCollection': {'hasNextChunk': False, 'lists': []}})
    if 'statistics' in q: return ok({'Viewer': {'id': 7, 'name': 'AniKai', 'siteUrl': 'https://anilist.co/user/AniKai', 'about': 'hello', 'bannerImage': None, 'avatar': {'large': None, 'medium': None}, 'statistics': {'anime': {'count': 5, 'episodesWatched': 50, 'meanScore': 70}, 'manga': {'count': 3, 'chaptersRead': 30, 'volumesRead': 2, 'meanScore': 75}}}})
    if 'followers' in q: return ok({'followers': {'pageInfo': {'total': 4}}, 'following': {'pageInfo': {'total': 6}}})
    if 'Viewer' in q: return ok({'Viewer': {'id': 7, 'name': 'AniKai', 'siteUrl': 'https://anilist.co/user/AniKai', 'avatar': {'medium': None}}})
    return ok({})

def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: raise SystemExit(1)

def wait_for(pg, fn, timeout=8000):
    pg.wait_for_function(fn, timeout=timeout)

INIT = """
window.__opened = [];
window.__links = [];
window.Capacitor = { isNativePlatform: () => true, Plugins: {
  Browser: { open: async o => { window.__opened.push(o.url); }, close: async () => {} },
  App: { addListener: async (name, cb) => { window.__links.push(cb); return { remove() {} }; }, getLaunchUrl: async () => null }
} };
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    ctx.add_init_script(INIT)
    ctx.route('**/*', lambda r: worker(r) if 'workers.dev' in r.request.url else anilist(r) if 'graphql.anilist.co' in r.request.url else r.abort() if 'myanimelist.net' in r.request.url or 'anilist.co' in r.request.url else r.continue_())
    dialogs = []
    def on_dialog(d):
        dialogs.append((d.type, d.message)); d.accept('eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' + 'a' * 60 + '.' + 'b' * 40 if d.type == 'prompt' else None)
    pg.on('dialog', on_dialog)

    pg.goto(U + '#profile'); pg.wait_for_selector('.profile-page')
    ok('Connect MyAnimeList' in pg.inner_text('.profile-page'), 'the Profile offers MyAnimeList, optional')
    ok(pg.locator('[data-action="mal-connect"]').count() == 1, 'the sign-in button is there with the built-in client ID')
    ok(pg.locator('a:has-text("Add client ID")').count() == 0, 'nothing asks the person to create a client ID')

    # a client ID typed in Settings (advanced) wins over the built-in one
    pg.goto(U + '#settings/account'); pg.wait_for_selector('#set-malClientId', state='attached')
    pg.evaluate("() => document.querySelectorAll('details').forEach(d => { d.open = true; })")
    pg.fill('#set-malClientId', 'not valid!'); pg.dispatch_event('#set-malClientId', 'change'); pg.wait_for_timeout(300)
    pg.fill('#set-malClientId', CLIENT); pg.dispatch_event('#set-malClientId', 'change'); pg.wait_for_timeout(400)

    # a redirect that did not come from our own sign-in is ignored
    pg.goto(U + '#profile'); pg.wait_for_selector('[data-action="mal-connect"]')
    pg.evaluate("() => window.__links.forEach(cb => cb({ url: 'tokyomangalab://mal-auth?code=' + 'c'.repeat(30) + '&state=forged' }))")
    pg.wait_for_timeout(500)
    ok(len(mal['token_calls']) == 0, 'a sign-in link we never asked for is ignored')

    # real attempt, wrong state first
    pg.click('[data-action="mal-connect"]'); wait_for(pg, "() => window.__opened.length === 1")
    url = urllib.parse.urlparse(pg.evaluate("() => window.__opened[0]")); qs = urllib.parse.parse_qs(url.query)
    ok(url.netloc == 'myanimelist.net' and url.path == '/v1/oauth2/authorize', 'the sign-in page is myanimelist.net')
    ok(qs['code_challenge_method'] == ['plain'] and qs['response_type'] == ['code'] and qs['client_id'] == [CLIENT], 'code flow, plain PKCE, our client ID')
    ok(len(qs['code_challenge'][0]) == 64 and qs['redirect_uri'] == ['tokyomangalab://mal-auth'], 'verifier length and fixed redirect')
    pg.evaluate("() => window.__links.forEach(cb => cb({ url: 'tokyomangalab://mal-auth?code=' + 'c'.repeat(30) + '&state=WRONG' }))"); pg.wait_for_timeout(500)
    ok(len(mal['token_calls']) == 0, 'a wrong state never reaches the token exchange')

    # the real redirect
    pg.click('[data-action="mal-connect"]'); wait_for(pg, "() => window.__opened.length === 2")
    st = urllib.parse.parse_qs(urllib.parse.urlparse(pg.evaluate("() => window.__opened[1]")).query)
    pg.evaluate("(s) => window.__links.forEach(cb => cb({ url: 'tokyomangalab://mal-auth?code=' + 'c'.repeat(30) + '&state=' + s }))", st['state'][0])
    pg.wait_for_timeout(2000)
    ok(len(mal['token_calls']) == 1, 'one token exchange')
    call = mal['token_calls'][0]
    ok(call['grant_type'] == 'authorization_code' and call['code_verifier'] == st['code_challenge'][0] and call['client_id'] == CLIENT, 'the exchange carries the verifier that matches the challenge')
    ok(any('save the status changes' in m for t, m in dialogs), 'asks before sending changes back')
    ok(mal['lists'] == 1, 'the list was read once (first sign-in import)')
    ok(len(mal['patches']) == 0, 'the first import never changes anything on MyAnimeList')

    # library
    pg.goto(U + '#library'); pg.wait_for_selector('.library-card')
    text = pg.inner_text('#appView')
    ok('Monster' in text and 'Berserk' in text, 'both MyAnimeList titles were imported')
    ok('MAL · ch. 40' in text, 'the library shows the MyAnimeList badge and chapter')

    # profile: MAL only
    pg.goto(U + '#profile'); pg.wait_for_selector('#profileHero')
    ok(pg.get_attribute('#profileHero', 'data-provider') == 'mal', 'with only MyAnimeList connected, it supplies the Profile')
    hero = pg.inner_text('#profileHero')
    ok('Kai Tanaka' in hero and 'View on MyAnimeList' in hero, 'name and link')
    stats = pg.inner_text('#profileAniStats')
    ok('120' in stats and 'Anime' in stats, 'anime total from MyAnimeList')
    ok('Chapters read' in stats and '40' in stats, 'manga numbers come from the synced list')
    ok('Followers' not in stats, 'no follower counts (MyAnimeList has none)')
    ok(pg.locator('.profile-banner img').count() == 0, 'no banner image (MyAnimeList has none)')

    # sending a status change back
    pg.goto(U + '#library'); pg.wait_for_selector('.library-card')
    card = pg.locator('.library-card', has_text='Berserk')
    card.locator('select').select_option('reading'); pg.wait_for_timeout(1500)
    ok(any(mid == 2 and body.get('status') == 'reading' for mid, body in mal['patches']), 'a status change is sent to MyAnimeList')

    # tracking panel on a MAL-only title
    pg.goto(U + '#library'); pg.wait_for_selector('.library-card')
    pg.locator('.library-card', has_text='Monster').locator('[data-action="details"]').click()
    pg.wait_for_selector('[data-action="track-toggle"]')
    pg.click('[data-action="track-toggle"]'); pg.wait_for_selector('.track-card')
    panel = pg.inner_text('.track-panel')
    ok('MyAnimeList' in panel and 'chapters' in panel.lower(), 'the panel is for MyAnimeList')
    ok(pg.input_value('[data-track-field="progress"]') == '40', 'it shows your current progress')
    pg.click('[data-action="track-step"][data-delta="1"]'); pg.wait_for_timeout(1200)
    ok(any(mid == 13 and body.get('num_chapters_read') == 41 for mid, body in mal['patches']), 'chapters read are sent as num_chapters_read')
    pg.fill('[data-track-field="score"]', '9'); pg.dispatch_event('[data-track-field="score"]', 'change'); pg.wait_for_timeout(1200)
    ok(any(mid == 13 and body.get('score') == 9 for mid, body in mal['patches']), 'score goes out on the 0-10 scale')
    ok(pg.locator('a:has-text("Open on MyAnimeList")').count() == 1, 'link to the title on MyAnimeList')
    ok(pg.locator('.track-tabs').count() == 0, 'no tracker tabs with one account')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # both accounts: AniList by default, switchable
    pg.goto(U + '#settings/account'); pg.wait_for_selector('[data-action="anilist-paste-token"]', state='attached')
    pg.evaluate("() => document.querySelectorAll('details').forEach(d => { d.open = true; })")
    pg.click('[data-action="anilist-paste-token"]'); pg.wait_for_timeout(2500)
    pg.goto(U + '#profile'); pg.wait_for_selector('#profileHero')
    ok(pg.get_attribute('#profileHero', 'data-provider') == 'anilist', 'with both connected, AniList is the default Profile')
    ok('AniKai' in pg.inner_text('#profileHero'), 'AniList name')
    ok('MyAnimeList sync' in pg.inner_text('.profile-page'), 'both sync cards show')
    pg.goto(U + '#settings/account'); pg.wait_for_selector('#set-profileSource')
    pg.select_option('#set-profileSource', 'mal'); pg.wait_for_timeout(500)
    pg.goto(U + '#profile'); pg.wait_for_selector('#profileHero')
    ok(pg.get_attribute('#profileHero', 'data-provider') == 'mal', 'the setting switches the Profile to MyAnimeList')
    ok('Kai Tanaka' in pg.inner_text('#profileHero'), 'MyAnimeList name after switching')
    # tracker tabs on a title
    pg.goto(U + '#library'); pg.wait_for_selector('.library-card')
    pg.locator('.library-card', has_text='Monster').locator('[data-action="details"]').click()
    pg.wait_for_selector('[data-action="track-toggle"]'); pg.click('[data-action="track-toggle"]'); pg.wait_for_selector('.track-tabs')
    ok(pg.locator('.track-tabs button').count() == 2, 'two tracker tabs when both are connected')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # token refresh: expire the stored token, next call refreshes first
    pg.evaluate("""() => new Promise((res, rej) => { const r = indexedDB.open('tokyo-manga-lab'); r.onsuccess = () => { const db = r.result; const tx = db.transaction('accountLinks', 'readwrite'); const s = tx.objectStore('accountLinks'); const g = s.get('mal'); g.onsuccess = () => { const a = g.result; a.expiresAt = Date.now() - 1000; s.put(a); }; tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; })""")
    before = len(mal['token_calls'])
    pg.goto(U + '#settings/account'); pg.wait_for_selector('[data-action="mal-sync"]')
    pg.click('[data-action="mal-sync"]'); pg.wait_for_timeout(2500)
    ok(len(mal['token_calls']) == before + 1 and mal['token_calls'][-1]['grant_type'] == 'refresh_token', 'an expired access token is refreshed before the list is read')
    ok(mal['token_calls'][-1]['refresh_token'].startswith('RT1'), 'with the saved refresh token')

    # sign out
    pg.click('[data-action="mal-disconnect"]'); pg.wait_for_timeout(1000)
    ok(pg.locator('[data-action="mal-disconnect"]').count() == 0, 'signed out')
    stored = pg.evaluate("""() => new Promise(res => { const r = indexedDB.open('tokyo-manga-lab'); r.onsuccess = () => { const g = r.result.transaction('accountLinks').objectStore('accountLinks').get('mal'); g.onsuccess = () => { r.result.close(); res(g.result || null); }; }; })""")
    ok(stored is None, 'the tokens are removed from this device')
    pg.goto(U + '#library'); pg.wait_for_selector('.library-card')
    ok('Monster' in pg.inner_text('#appView'), 'the library stays after signing out')
    ok(not errs, f'no page errors {errs}')
    b.close()
print('mal e2e ok')
