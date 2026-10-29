import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay, withRetry } from '../src/shared/retry.js';
import { createAniListClient, AniListError } from '../src/features/anilist/anilist-client.js';
import { MalError, createMalClient, refreshTokens } from '../src/features/mal/mal-client.js';

const noWait = [];
const sleep = async ms => { noWait.push(ms); };
const err = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

test('only failures that clear by themselves are retried', async () => {
  for (const code of ['NETWORK_ERROR', 'TIMEOUT', 'UNAVAILABLE']) assert.ok(retryDelay(err(code), 0) > 0, code);
  for (const code of ['UNAUTHORIZED', 'NOT_FOUND', 'GRAPHQL', 'MAL_ERROR', 'INVALID_RESPONSE']) assert.equal(retryDelay(err(code), 0), null, code);
  assert.equal(retryDelay(err('RATE_LIMITED', { retryAfter: 5 }), 0), 5000, 'a short rate limit waits as long as asked');
  assert.equal(retryDelay(err('RATE_LIMITED', { retryAfter: 90 }), 0), null, 'a long one is left to the caller');
});

test('a call is tried again after a drop, then given up on', async () => {
  let calls = 0;
  const slept = [];
  const result = await withRetry(async () => { calls += 1; if (calls < 3) throw err('NETWORK_ERROR'); return 'ok'; }, { sleep: async ms => slept.push(ms) });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(slept, [800, 2500]);
  let again = 0;
  await assert.rejects(withRetry(async () => { again += 1; throw err('TIMEOUT'); }, { sleep }), error => error.code === 'TIMEOUT');
  assert.equal(again, 3, 'one try plus two retries');
  let once = 0;
  await assert.rejects(withRetry(async () => { once += 1; throw err('UNAUTHORIZED'); }, { sleep }), error => error.code === 'UNAUTHORIZED');
  assert.equal(once, 1, 'a sign-in problem is not retried');
});

const response = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: name => headers[name] ?? null }, json: async () => body });

test('AniList: a dropped connection and a 503 are retried quietly, a bad token is not', async () => {
  let n = 0;
  const flaky = createAniListClient({ token: 'T'.repeat(50), sleep, fetchImpl: async () => { n += 1; if (n === 1) throw new TypeError('offline'); if (n === 2) return response(503, {}); return response(200, { data: { Viewer: { id: 7, name: 'Kai', avatar: {} } } }); } });
  assert.equal((await flaky.viewer()).name, 'Kai');
  assert.equal(n, 3);
  let bad = 0;
  const expired = createAniListClient({ token: 'T'.repeat(50), sleep, fetchImpl: async () => { bad += 1; return response(401, { errors: [{ message: 'Invalid token', status: 401 }] }); } });
  await assert.rejects(expired.viewer(), error => error instanceof AniListError && error.code === 'UNAUTHORIZED');
  assert.equal(bad, 1);
});

test('AniList: a short rate limit waits and goes again', async () => {
  let n = 0;
  const waits = [];
  const client = createAniListClient({ token: 'T'.repeat(50), sleep: async ms => waits.push(ms), fetchImpl: async () => { n += 1; return n === 1 ? response(429, {}, { 'Retry-After': '3' }) : response(200, { data: { Viewer: { id: 1, name: 'x', avatar: {} } } }); } });
  await client.viewer();
  assert.deepEqual(waits, [3000]);
});

test('MyAnimeList: reads and saves retry on a dropped connection, a bad token refreshes once', async () => {
  const auth = { getToken: async () => 't', refresh: async () => 't2' };
  let n = 0;
  const flaky = createMalClient({ apiBase: 'https://api.example', auth, sleep, fetchImpl: async () => { n += 1; if (n === 1) throw new TypeError('offline'); if (n === 2) return response(502, {}); return response(200, { data: { id: 9, name: 'Kai' } }); } });
  assert.equal((await flaky.viewer()).name, 'Kai');
  assert.equal(n, 3);
  let saves = 0;
  const saver = createMalClient({ apiBase: 'https://api.example', auth, sleep, fetchImpl: async () => { saves += 1; return saves === 1 ? response(503, {}) : response(200, { data: { status: 'reading', num_chapters_read: 5 } }); } });
  assert.equal((await saver.saveEntry({ mediaId: 13, num_chapters_read: 5 })).num_chapters_read, 5);
  assert.equal(saves, 2);
});

test('MyAnimeList: a token refresh is never repeated after an answer that may have been lost', async () => {
  let calls = 0;
  const lost = async () => { calls += 1; return response(502, {}); };
  await assert.rejects(refreshTokens({ apiBase: 'https://api.example', clientId: 'c'.repeat(32), refreshToken: 'r'.repeat(40), fetchImpl: lost, sleep }), error => error.code === 'UNAVAILABLE');
  assert.equal(calls, 1);
  let tries = 0;
  const tokens = await refreshTokens({ apiBase: 'https://api.example', clientId: 'c'.repeat(32), refreshToken: 'r'.repeat(40), sleep, fetchImpl: async () => { tries += 1; if (tries === 1) throw new TypeError('offline'); return response(200, { data: { access_token: 'A', refresh_token: 'R', expires_in: 3600 } }); } });
  assert.equal(tokens.accessToken, 'A');
  assert.equal(tries, 2, 'a connection that never opened is tried once more');
});
