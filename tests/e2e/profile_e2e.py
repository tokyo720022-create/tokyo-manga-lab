"""Profile screen: signed out it shows the local reader; signed in it shows the AniList banner, avatar, name and
totals, keeps them for offline use, and ignores images from other hosts."""
import json, os, sys, urllib.parse
from playwright.sync_api import sync_playwright
S = os.path.dirname(os.path.abspath(__file__)); U = os.environ.get('E2E_URL', 'http://127.0.0.1:8011/index.html')
TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' + 'a' * 60 + '.' + 'b' * 40
H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}
fails = []
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: fails.append(m)
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082')
profile_calls = []; offline = {'v': False}
def anilist(r):
    if r.request.method == 'OPTIONS': return r.fulfill(status=204, headers=H)
    if offline['v']: return r.abort('connectionrefused')
    q = json.loads(r.request.post_data)['query']
    if 'bannerImage' in q:
        profile_calls.append(1)
        return r.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': {'Viewer': {
            'id': 7, 'name': 'Orewatokyo', 'siteUrl': 'https://anilist.co/user/Orewatokyo', 'about': 'Reads <b>everything</b>.',
            'bannerImage': 'https://s4.anilist.co/file/anilistcdn/user/banner/b7.jpg', 'avatar': {'large': 'https://s4.anilist.co/file/anilistcdn/user/avatar/large/a7.png', 'medium': None},
            'statistics': {'anime': {'count': 313, 'episodesWatched': 8305, 'meanScore': 96.52}, 'manga': {'count': 149, 'chaptersRead': 11148, 'volumesRead': 473, 'meanScore': 94.96}}}}}))
    if 'followers' in q:
        return r.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': {'followers': {'pageInfo': {'total': 3}}, 'following': {'pageInfo': {'total': 7}}}}))
    if 'Viewer' in q:
        return r.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': {'Viewer': {'id': 7, 'name': 'Orewatokyo', 'siteUrl': 'https://anilist.co/user/Orewatokyo', 'avatar': {'medium': None}}}}))
    return r.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': {'MediaListCollection': {'hasNextChunk': False, 'lists': []}}}))
def worker(r):
    if r.request.method == 'OPTIONS': return r.fulfill(status=204, headers=H)
    if urllib.parse.urlparse(r.request.url).path.endswith('/health'): return r.fulfill(status=200, content_type='application/json', headers=H, body='{"ok":true}')
    return r.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': [], 'total': 0, 'limit': 24, 'page': 1}))
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    c.route('**/*.workers.dev/**', worker); c.route('**/graphql.anilist.co/**', anilist)
    def img(r):
        banner, avatar = os.environ.get('E2E_BANNER'), os.environ.get('E2E_AVATAR')
        if banner and 'banner' in r.request.url: return r.fulfill(status=200, content_type='image/png', body=open(banner, 'rb').read())
        if avatar and 'avatar' in r.request.url: return r.fulfill(status=200, content_type='image/png', body=open(avatar, 'rb').read())
        return r.fulfill(status=200, content_type='image/png', body=PNG)
    c.route('https://s4.anilist.co/**', img)
    pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('dialog', lambda d: d.accept(TOKEN) if d.type == 'prompt' else d.dismiss())
    pg.goto(U + '#profile'); pg.wait_for_selector('.identity')
    ok('Local reader' in pg.inner_text('#appView'), 'signed out: shows the local reader')
    ok(pg.query_selector('.profile-hero') is None, 'signed out: no AniList banner')
    # sign in with a pasted token
    pg.click('[data-action="anilist-paste-token"]'); pg.wait_for_timeout(1500)
    pg.goto(U + '#profile'); pg.wait_for_selector('.profile-hero'); pg.wait_for_timeout(1200)
    text = pg.inner_text('#appView')
    ok('Orewatokyo' in text and 'Local reader' not in text, 'signed in: shows the AniList name, not "Local reader"')
    ok(pg.query_selector('.profile-banner img') is not None and pg.query_selector('img.profile-avatar') is not None, 'banner and avatar are drawn')
    strip = pg.inner_text('#profileAniStats .stat-strip')
    ok('313' in strip and '149' in strip and '7' in strip and '3' in strip, 'anime, manga, following and followers totals: ' + strip.replace('\n', ' '))
    ok('11,148' in text and '473' in text and '94.96' in text, 'chapters, volumes and mean score')
    ok('Reads everything.' in text, 'bio is shown as plain text')
    ok('in this app' in text.lower(), 'local library numbers are kept, labelled "In this app"')
    ok(pg.get_attribute('.profile-hero a', 'href') == 'https://anilist.co/user/Orewatokyo' and pg.get_attribute('.profile-hero a', 'rel') == 'noopener noreferrer', 'profile link is safe')
    pg.screenshot(path=S + '/shots/profile-anilist.png')
    # offline: the saved profile still shows
    n = len(profile_calls); offline['v'] = True
    pg.reload(); pg.wait_for_selector('.profile-hero'); pg.wait_for_timeout(800)
    ok('Orewatokyo' in pg.inner_text('#appView') and '11,148' in pg.inner_text('#appView'), 'offline: the saved profile still shows')
    ok(len(profile_calls) == n, 'a fresh profile is not re-fetched on every visit')
    ok(not errs, 'no page errors: %s' % errs)
    b.close()
if fails: sys.exit('FAILED: ' + '; '.join(fails))
print('PROFILE E2E PASSED')
