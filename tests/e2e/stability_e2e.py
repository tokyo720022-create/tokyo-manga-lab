"""Stability: "Test all connections" tells MangaDex, AniList and MyAnimeList apart and explains problems in plain words."""
import json, os, urllib.parse
from playwright.sync_api import sync_playwright
U = 'http://127.0.0.1:8011/index.html'
H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' + 'a' * 60 + '.' + 'b' * 40
state = {'md': 'up', 'ani': 'up'}
saves = []
urls = []
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: raise SystemExit(1)
def worker(r):
    if r.request.method == 'OPTIONS': return r.fulfill(status=204, headers=H)
    urls.append(r.request.url)
    if state['md'] == 'down': return r.fulfill(status=503, content_type='application/json', headers=H, body=json.dumps({'error': {'code': 'UPSTREAM_UNAVAILABLE', 'message': 'down'}}))
    if r.request.url.split('?')[0].endswith('/health'): return r.fulfill(status=200, content_type='application/json', headers=H, body='{"ok":true,"service":"x"}')
    return r.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': [], 'total': 0, 'limit': 24, 'page': 1}))
def anilist(r):
    h = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}
    if r.request.method == 'OPTIONS': return r.fulfill(status=204, headers=h)
    if state['ani'] == 'down': return r.fulfill(status=401, content_type='application/json', headers=h, body=json.dumps({'errors': [{'message': 'Invalid token'}]}))
    q = json.loads(r.request.post_data)['query']
    def reply(data): return r.fulfill(status=200, content_type='application/json', headers=h, body=json.dumps({'data': data}))
    if 'SaveMediaListEntry' in q:
        v = json.loads(r.request.post_data)['variables']; saves.append(v)
        return reply({'SaveMediaListEntry': {'id': 99, 'status': 'CURRENT', 'progress': v.get('progress') or 0, 'score': 0, 'updatedAt': 1790000000, 'startedAt': {'year': None, 'month': None, 'day': None}, 'completedAt': {'year': None, 'month': None, 'day': None}}})
    if 'MediaListCollection' in q: return reply({'MediaListCollection': {'hasNextChunk': False, 'lists': []}})
    if 'statistics' in q: return reply({'Viewer': {'id': 7, 'name': 'AniKai', 'siteUrl': 'https://anilist.co/user/AniKai', 'about': '', 'bannerImage': None, 'avatar': {'large': None, 'medium': None}, 'statistics': {'anime': {'count': 0, 'episodesWatched': 0, 'meanScore': 0}, 'manga': {'count': 0, 'chaptersRead': 0, 'volumesRead': 0, 'meanScore': 0}}}})
    if 'followers' in q: return reply({'followers': {'pageInfo': {'total': 0}}, 'following': {'pageInfo': {'total': 0}}})
    return reply({'Viewer': {'id': 7, 'name': 'AniKai', 'siteUrl': 'https://anilist.co/user/AniKai', 'avatar': {'medium': None}}})
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    ctx.route('**/*', lambda r: worker(r) if 'workers.dev' in r.request.url else anilist(r) if 'graphql.anilist.co' in r.request.url else r.abort() if 'anilist.co' in r.request.url else r.continue_())
    pg.on('dialog', lambda d: d.accept(TOKEN if d.type == 'prompt' else None))
    pg.goto(U + '#settings/data'); pg.wait_for_timeout(800)
    pg.goto(U + '#settings/sources'); pg.wait_for_selector('[data-action="check-connections"]', state='attached')
    pg.click('[data-action="check-connections"]'); pg.wait_for_function("() => /MangaDex: working/.test(document.getElementById('connectionsResult').textContent)", timeout=15000)
    text = pg.inner_text('#connectionsResult')
    ok('AniList: not connected' in text and 'MyAnimeList: not connected' in text, 'accounts that are not connected are not reported as broken')
    # titles with no chapters: hidden by default (MangaDex is asked to skip them), one tap shows them
    pg.goto(U + '#discover'); pg.wait_for_selector('[data-action="toggle-empty-titles"]', timeout=15000)
    pg.wait_for_function("() => !document.querySelector('.spinner')", timeout=15000); pg.wait_for_timeout(500)
    urls.clear(); pg.click('[data-action="retry-search"]'); pg.wait_for_timeout(1500)
    ok(any('hasChapters=1' in u and 'lang=en' in u for u in urls if '/manga?' in u), 'search asks for titles that have chapters in the chapter language')
    ok('hidden' in pg.inner_text('[data-action="toggle-empty-titles"]'), 'the page says titles with no chapters are hidden')
    urls.clear(); pg.click('[data-action="toggle-empty-titles"]'); pg.wait_for_function("() => /Showing titles with no chapters/.test(document.querySelector('[data-action=\"toggle-empty-titles\"]')?.textContent || '')", timeout=15000)
    ok(any('/manga?' in u for u in urls) and not any('hasChapters' in u for u in urls if '/manga?' in u), 'after "Show them" the filter is not sent')
    pg.click('[data-action="toggle-empty-titles"]'); pg.wait_for_function("() => /hidden/.test(document.querySelector('[data-action=\"toggle-empty-titles\"]')?.textContent || '')", timeout=15000)
    # connect AniList through the paste-token path used by the other tests
    pg.goto(U + '#settings/account'); pg.wait_for_selector('[data-action="anilist-paste-token"]', state='attached')
    pg.evaluate("() => document.querySelectorAll('details.fold').forEach(d => { d.open = true; })")
    pg.click('[data-action="anilist-paste-token"]'); pg.wait_for_timeout(1500)
    pg.goto(U + '#settings/sources'); pg.wait_for_selector('[data-action="check-connections"]', state='attached')
    pg.click('[data-action="check-connections"]'); pg.wait_for_function("() => /AniList: working/.test(document.getElementById('connectionsResult').textContent)", timeout=15000)
    ok('AniKai' in pg.inner_text('#connectionsResult'), 'AniList is checked with the real viewer call and names the account')
    # queued changes: a row that is due goes out by itself when the phone is back online; a row told to wait stays put
    add = """(rows) => new Promise((res, rej) => { const r = indexedDB.open('tokyo-manga-lab'); r.onsuccess = () => { const tx = r.result.transaction('syncOutbox', 'readwrite'); rows.forEach(x => tx.objectStore('syncOutbox').put(x)); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); }; })"""
    pg.evaluate(add, [
      {'id': 'anilist:555', 'provider': 'anilist', 'mediaId': '555', 'contentItemId': 'c-due', 'patch': {'progress': 5}, 'status': 'pending', 'createdAt': 1, 'attempts': 0},
      {'id': 'anilist:556', 'provider': 'anilist', 'mediaId': '556', 'contentItemId': 'c-wait', 'patch': {'progress': 9}, 'status': 'pending', 'createdAt': 2, 'attempts': 0, 'retryAfter': 4102444800000}])
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    pg.wait_for_timeout(3000)
    ok(any(v.get('mediaId') == 555 and v.get('progress') == 5 for v in saves), 'a due change is sent when the app comes to the front')
    ok(not any(v.get('mediaId') == 556 for v in saves), 'a change told to wait is not sent early')
    pg.evaluate("window.dispatchEvent(new Event('online'))")
    pg.wait_for_timeout(3000)
    ok(any(v.get('mediaId') == 556 and v.get('progress') == 9 for v in saves), 'coming back online clears the wait and sends it')
    state['md'] = 'down'; state['ani'] = 'down'
    pg.click('[data-action="check-connections"]'); pg.wait_for_function("() => /MangaDex: problem/.test(document.getElementById('connectionsResult').textContent)", timeout=30000)
    text = pg.inner_text('#connectionsResult')
    ok('AniList: problem' in text and 'Sign in again' in text, 'an expired AniList sign-in says to sign in again')
    ok(pg.get_attribute('#connectionStatus', 'data-state') == 'offline', 'the status pill follows the MangaDex result')
    ok(not errs, 'no page errors')
    b.close()
