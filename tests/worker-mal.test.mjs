import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8');
async function loadWorker() {
  return (await import(`data:text/javascript;base64,${Buffer.from(SOURCE).toString('base64')}#${Math.random()}`)).default;
}
const TOKEN = 'a'.repeat(64);
const CLIENT = 'b'.repeat(32);
const VERIFIER = 'c'.repeat(64);
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function mockFetch(t, handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => { const call = { url: new URL(typeof input === 'string' ? input : input.url), init }; calls.push(call); return handler(call); };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}
const call = (worker, path, { method = 'GET', body, token = TOKEN, origin = '' } = {}) => worker.fetch(new Request(`https://worker.test${path}`, {
  method, headers: { ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
}));

test('the sign-in code is exchanged with the fixed redirect and nothing is kept', async t => {
  const worker = await loadWorker();
  const calls = mockFetch(t, () => reply(200, { access_token: 'AT'.repeat(20), refresh_token: 'RT'.repeat(20), expires_in: 3600, token_type: 'Bearer' }));
  const response = await call(worker, '/api/v1/mal/token', { method: 'POST', token: '', body: { grant_type: 'authorization_code', client_id: CLIENT, code: 'code'.repeat(8), code_verifier: VERIFIER, redirect_uri: 'https://evil.example/' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.access_token, 'AT'.repeat(20));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.href, 'https://myanimelist.net/v1/oauth2/token');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('redirect_uri'), 'tokyomangalab://mal-auth', 'the redirect is fixed, never taken from the request');
  assert.equal(form.get('code_verifier'), VERIFIER);
  assert.equal(form.get('client_id'), CLIENT);
  assert.ok(!form.has('client_secret'));
});

test('token requests are validated before anything is sent to MyAnimeList', async t => {
  const worker = await loadWorker();
  const calls = mockFetch(t, () => reply(200, {}));
  const bad = [
    { grant_type: 'password', client_id: CLIENT },
    { grant_type: 'authorization_code', client_id: 'short', code: 'x'.repeat(20), code_verifier: VERIFIER },
    { grant_type: 'authorization_code', client_id: CLIENT, code: 'x y', code_verifier: VERIFIER },
    { grant_type: 'authorization_code', client_id: CLIENT, code: 'x'.repeat(20), code_verifier: 'tooshort' },
    { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: 'no spaces allowed here' }
  ];
  for (const body of bad) assert.equal((await call(worker, '/api/v1/mal/token', { method: 'POST', token: '', body })).status, 400);
  assert.equal((await call(worker, '/api/v1/mal/token', { token: '' })).status, 405);
  assert.equal(calls.length, 0);
});

test('a refused sign-in is reported as a sign-in problem, not a server error', async t => {
  const worker = await loadWorker();
  mockFetch(t, () => reply(400, { error: 'invalid_grant' }));
  const response = await call(worker, '/api/v1/mal/token', { method: 'POST', token: '', body: { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: 'r'.repeat(40) } });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'MAL_AUTH_FAILED');
});

test('the list route forwards the person\'s own token to MyAnimeList only, and hides adult titles unless the app asks', async t => {
  const worker = await loadWorker();
  const rows = [{ node: { id: 1, title: 'Safe', nsfw: 'white' }, list_status: { status: 'reading' } }, { node: { id: 2, title: 'Adult', nsfw: 'black' }, list_status: { status: 'completed' } }];
  const calls = mockFetch(t, () => reply(200, { data: rows, paging: { next: 'x' } }));
  const web = await (await call(worker, '/api/v1/mal/list?adult=1', { origin: 'https://tokyo720022-create.github.io' })).json();
  assert.deepEqual(web.data.map(row => row.node.id), [1]);
  assert.equal(web.hidden, 1);
  assert.equal(web.hasNext, true);
  assert.equal(calls[0].url.origin, 'https://api.myanimelist.net');
  assert.equal(calls[0].url.searchParams.get('nsfw'), 'false');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  const app = await (await call(worker, '/api/v1/mal/list?adult=1&offset=100')).json();
  assert.deepEqual(app.data.map(row => row.node.id), [1, 2]);
  assert.equal(calls[1].url.searchParams.get('nsfw'), 'true');
  assert.equal(calls[1].url.searchParams.get('offset'), '100');
});

test('routes need a token and nothing outside the fixed list is reachable', async t => {
  const worker = await loadWorker();
  const calls = mockFetch(t, () => reply(200, {}));
  assert.equal((await call(worker, '/api/v1/mal/list', { token: '' })).status, 401);
  assert.equal((await call(worker, '/api/v1/mal/list', { token: 'bad token!' })).status, 401);
  for (const path of ['/api/v1/mal/users/@me/animelist', '/api/v1/mal/manga/12/other', '/api/v1/mal/manga/abc', '/api/v1/mal/forum']) assert.equal((await call(worker, path)).status, 404, path);
  assert.equal((await call(worker, '/api/v1/mal/me', { method: 'DELETE' })).status, 404);
  assert.equal(calls.length, 0);
});

test('saving a list entry sends only valid fields and uses PATCH on the fixed path', async t => {
  const worker = await loadWorker();
  const calls = mockFetch(t, () => reply(200, { status: 'reading', num_chapters_read: 12, score: 8 }));
  const ok = await call(worker, '/api/v1/mal/manga/13/status', { method: 'PATCH', body: { status: 'reading', num_chapters_read: 12, score: 8, is_rereading: false, start_date: '2026-10-24', evil: 'x' } });
  assert.equal(ok.status, 200);
  assert.equal(calls[0].url.href, 'https://api.myanimelist.net/v2/manga/13/my_list_status');
  assert.equal(calls[0].init.method, 'PATCH');
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('status'), 'reading');
  assert.equal(form.get('num_chapters_read'), '12');
  assert.equal(form.get('is_rereading'), 'false');
  assert.equal(form.get('start_date'), '2026-10-24');
  assert.ok(!form.has('evil'));
  for (const body of [{ status: 'weird' }, { score: 11 }, { score: 1.5 }, { num_chapters_read: -1 }, { start_date: '24/10/2026' }, {}]) {
    assert.equal((await call(worker, '/api/v1/mal/manga/13/status', { method: 'PATCH', body })).status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 1);
});

test('search needs three letters and an expired token says so', async t => {
  const worker = await loadWorker();
  let status = 200;
  const calls = mockFetch(t, () => status === 200 ? reply(200, { data: [{ node: { id: 5, title: 'Found', nsfw: 'white' } }, { node: { id: 6, title: 'Hidden', nsfw: 'gray' } }] }) : reply(401, {}));
  assert.deepEqual((await (await call(worker, '/api/v1/mal/search?q=ab')).json()).data, []);
  assert.equal(calls.length, 0);
  const found = await (await call(worker, '/api/v1/mal/search?q=one%20piece')).json();
  assert.deepEqual(found.data.map(node => node.id), [5]);
  status = 401;
  const expired = await call(worker, '/api/v1/mal/me');
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).error.code, 'UNAUTHORIZED');
});

test('only the MyAnimeList routes accept more than GET', async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(new Request('https://worker.test/api/v1/search?query=x', { method: 'POST' }));
  assert.equal(response.status, 405);
  const preflight = await worker.fetch(new Request('https://worker.test/api/v1/mal/list', { method: 'OPTIONS', headers: { Origin: 'https://tokyo720022-create.github.io' } }));
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('a MyAnimeList read is repeated once after a gateway error, but a save is not', async t => {
  const worker = await loadWorker();
  let reads = 0;
  mockFetch(t, ({ init }) => {
    if (init.method === 'PATCH') return reply(503, { error: 'busy' });
    reads += 1;
    return reads === 1 ? reply(503, { error: 'busy' }) : reply(200, { name: 'reader', id: 1 });
  });
  const me = await call(worker, '/api/v1/mal/me');
  assert.equal(me.status, 200);
  assert.equal(reads, 2);
  const calls = mockFetch(t, () => reply(503, { error: 'busy' }));
  await call(worker, '/api/v1/mal/manga/13/status', { method: 'PATCH', body: { status: 'reading' } });
  assert.equal(calls.length, 1, 'writes are queued by the app instead of being repeated here');
});
