"""Privacy screen: choosing a PIN, locking when the app is left, wrong tries and waiting, cold start, changing and removing
the PIN, the PIN staying out of backups, and the Android 'hide in recent apps' hook."""
import json, os
from playwright.sync_api import sync_playwright
U = 'http://127.0.0.1:8011/index.html'
H = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}

def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond: raise SystemExit(1)

def worker(route):
    if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=H)
    if route.request.url.split('?')[0].endswith('/health'): return route.fulfill(status=200, content_type='application/json', headers=H, body='{"ok":true}')
    return route.fulfill(status=200, content_type='application/json', headers=H, body=json.dumps({'data': [], 'total': 0, 'limit': 24, 'page': 1}))

def keys(pg, digits):
    for d in digits: pg.click(f'#privacyDialog [data-pin="{d}"]')
def submit(pg): pg.click('#privacyDialog [data-pin="ok"]'); pg.wait_for_timeout(500)   # PBKDF2 takes a moment
is_open = lambda pg: bool(pg.evaluate("() => document.getElementById('privacyDialog')?.open === true"))
title = lambda pg: pg.inner_text('#privacyDialog h2') if pg.locator('#privacyDialog h2').count() else ''
message = lambda pg: pg.inner_text('#privacyDialog .privacy-message')
def set_hidden(pg, hidden):
    pg.evaluate("(h) => { window.__vis = h ? 'hidden' : 'visible'; document.dispatchEvent(new Event('visibilitychange')); }", hidden)
    pg.wait_for_timeout(300)
def idb_get(pg, store, key):
    return pg.evaluate("""([store, key]) => new Promise(res => { const r = indexedDB.open('tokyo-manga-lab'); r.onsuccess = () => { const g = r.result.transaction(store).objectStore(store).get(key); g.onsuccess = () => { res(g.result || null); r.result.close(); }; }; })""", [store, key])
def idb_patch(pg, store, key, patch):
    pg.evaluate("""([store, key, patch]) => new Promise(res => { const r = indexedDB.open('tokyo-manga-lab'); r.onsuccess = () => { const tx = r.result.transaction(store, 'readwrite'); const o = tx.objectStore(store); const g = o.get(key); g.onsuccess = () => { o.put({ ...g.result, ...patch }); }; tx.oncomplete = () => { r.result.close(); res(); }; }; })""", [store, key, patch])
VIS = "Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis || 'visible' });"

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', accept_downloads=True)
    ctx.add_init_script(VIS)
    ctx.route('**/*.workers.dev/**', worker)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))

    # ---- choosing a PIN
    pg.goto(U + '#settings/privacy'); pg.wait_for_selector('[data-action="privacy-pin-set"]')
    ok(pg.locator('[data-action="privacy-pin-change"]').count() == 0 and pg.locator('#set-privacyLockDelay').count() == 0, 'before a PIN exists only "Set PIN" is offered')
    ok(pg.locator('[data-setting="privacyHideRecents"]').count() == 0, 'the recent-apps switch is hidden outside the Android app')
    pg.click('[data-action="privacy-pin-set"]'); pg.wait_for_selector('#privacyDialog[open]')
    ok(title(pg) == 'Choose a PIN', 'setting a PIN opens the keypad')
    keys(pg, '12'); submit(pg)
    ok('4 to 8 digits' in message(pg), 'a PIN that is too short is refused')
    keys(pg, '34'); submit(pg)
    ok(title(pg) == 'Repeat the PIN', 'asks to repeat it')
    keys(pg, '1235'); submit(pg)
    ok(title(pg) == 'Choose a PIN' and 'did not match' in message(pg), 'two different PINs start over')
    keys(pg, '1234'); submit(pg); keys(pg, '1234'); submit(pg)
    pg.wait_for_selector('[data-action="privacy-pin-change"]', timeout=5000)
    ok(not is_open(pg), 'the keypad closes when the PIN is saved')
    ok(pg.locator('#set-privacyLockDelay').count() == 1 and pg.locator('[data-action="privacy-pin-remove"]').count() == 1, 'delay, change and turn-off are offered once a PIN exists')
    rec = idb_get(pg, 'accountLinks', 'privacy-lock')
    ok(rec and rec['hash'] and rec['salt'] and '1234' not in json.dumps(rec), 'the PIN is stored as a salted hash, never as the PIN')
    ok(idb_get(pg, 'appSettings', 'privacy-lock') is None, 'it is not stored with the normal settings')
    pg.goto(U + '#settings/library'); pg.wait_for_selector('[data-action="export-backup"]')
    with pg.expect_download() as dl: pg.click('[data-action="export-backup"]')
    text = open(dl.value.path(), encoding='utf-8').read()
    ok(rec['hash'] not in text and 'privacy-lock' not in text, 'backups never contain the PIN record')

    # ---- locking after being away
    pg.goto(U + '#settings/privacy'); pg.wait_for_selector('#set-privacyLockDelay', state='attached')
    pg.select_option('#set-privacyLockDelay', '0'); pg.wait_for_timeout(300)
    set_hidden(pg, True)
    ok(is_open(pg) and pg.locator('#privacyDialog .privacy-pad').count() == 0, 'leaving the app covers it with a blank screen at once')
    set_hidden(pg, False)
    ok(is_open(pg) and title(pg) == 'Tokyo Manga Lab is locked', 'with "Immediately" coming back asks for the PIN')
    keys(pg, '9999'); submit(pg)
    ok(is_open(pg) and message(pg) == 'Wrong PIN.', 'a wrong PIN stays locked')
    keys(pg, '1234'); submit(pg)
    ok(not is_open(pg), 'the right PIN opens the app')
    pg.select_option('#set-privacyLockDelay', '60'); pg.wait_for_timeout(300)
    set_hidden(pg, True); set_hidden(pg, False)
    ok(not is_open(pg), 'with "After 1 minute" a quick return does not ask again')

    # ---- too many wrong tries
    pg.select_option('#set-privacyLockDelay', '0'); pg.wait_for_timeout(300)
    set_hidden(pg, True); set_hidden(pg, False)
    for _ in range(5):
        keys(pg, '0000'); submit(pg)
    ok('Try again in' in message(pg), 'after five wrong tries the app makes you wait')
    keys(pg, '1234'); submit(pg)
    ok(is_open(pg) and 'Try again in' in message(pg), 'even the right PIN is refused during the wait')
    idb_patch(pg, 'accountLinks', 'privacy-lock', {'lockedUntil': 0})
    pg.reload(); pg.wait_for_selector('#privacyDialog[open]')
    ok(title(pg) == 'Tokyo Manga Lab is locked', 'opening the app fresh asks for the PIN before showing anything')
    keys(pg, '1234'); submit(pg)
    ok(not is_open(pg), 'the right PIN opens it after the wait is over')
    ok(idb_get(pg, 'accountLinks', 'privacy-lock')['failures'] == 0, 'a right PIN clears the failure count')

    # ---- change and remove
    pg.goto(U + '#settings/privacy'); pg.wait_for_selector('[data-action="privacy-pin-change"]')
    pg.click('[data-action="privacy-pin-change"]'); pg.wait_for_selector('#privacyDialog[open]')
    ok(title(pg) == 'Enter your current PIN', 'changing the PIN asks for the current one first')
    keys(pg, '4444'); submit(pg)
    ok(title(pg) == 'Enter your current PIN' and message(pg) == 'Wrong PIN.', 'a wrong current PIN cannot change it')
    keys(pg, '1234'); submit(pg); keys(pg, '5678'); submit(pg); keys(pg, '5678'); submit(pg)
    pg.wait_for_function("() => !document.getElementById('privacyDialog').open")
    pg.reload(); pg.wait_for_selector('#privacyDialog[open]')
    keys(pg, '1234'); submit(pg)
    ok(is_open(pg), 'the old PIN no longer works')
    keys(pg, '5678'); submit(pg)
    ok(not is_open(pg), 'the new PIN works')
    pg.goto(U + '#settings/privacy'); pg.wait_for_selector('[data-action="privacy-pin-remove"]')
    pg.click('[data-action="privacy-pin-remove"]'); pg.wait_for_selector('#privacyDialog[open]')
    keys(pg, '5678'); submit(pg)
    pg.wait_for_selector('[data-action="privacy-pin-set"]', timeout=5000)
    ok(idb_get(pg, 'accountLinks', 'privacy-lock') is None, 'turning the lock off deletes the PIN record')
    pg.reload(); pg.wait_for_selector('#appView')
    pg.wait_for_timeout(800)
    ok(not is_open(pg), 'with no PIN the app opens straight away')
    cancel_ok = True
    pg.goto(U + '#settings/privacy'); pg.wait_for_selector('[data-action="privacy-pin-set"]')
    pg.click('[data-action="privacy-pin-set"]'); pg.wait_for_selector('#privacyDialog[open]'); pg.click('#privacyDialog [data-pin="cancel"]')
    ok(not is_open(pg) and idb_get(pg, 'accountLinks', 'privacy-lock') is None, 'Cancel leaves everything as it was')
    ok(not errs, 'no page errors: ' + str(errs))

    # ---- the Android "hide in recent apps" hook (a stand-in for the native bridge)
    ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
    ctx2.add_init_script("window.__secure = []; window.TmlPrivacy = { setSecure: v => window.__secure.push(v) }; window.Capacitor = { isNativePlatform: () => true, Plugins: { App: { addListener: async () => ({ remove() {} }), getLaunchUrl: async () => null }, Browser: {} } };")
    ctx2.route('**/*.workers.dev/**', worker)
    pg2 = ctx2.new_page(); errs2 = []
    pg2.on('pageerror', lambda e: errs2.append(str(e)))
    pg2.goto(U + '#settings/privacy'); pg2.wait_for_selector('[data-setting="privacyHideRecents"]', state='attached')
    ok(pg2.evaluate("() => window.__secure") == [False], 'at start the app tells Android the preview is normal')
    pg2.locator('[data-setting="privacyHideRecents"]').evaluate("el => { el.click(); }"); pg2.wait_for_timeout(500)
    ok(pg2.evaluate("() => window.__secure.at(-1)") is True, 'switching it on asks Android to blank the preview')
    pg2.reload(); pg2.wait_for_selector('#appView'); pg2.wait_for_timeout(600)
    ok(pg2.evaluate("() => window.__secure.at(-1)") is True, 'the choice is applied again every time the app starts')
    ok(not errs2, 'no page errors in the app build: ' + str(errs2))
    b.close()
print('privacy e2e ok')
