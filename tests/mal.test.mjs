import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthorizeUrl, createAuthAttempt, isValidClientId, parseAuthRedirect } from '../src/features/mal/mal-auth.js';
import { entryFromListStatus, malToTrackStatus, normalizeRemoteEntry, normalizeSearchNode, patchToMalBody, toLocalStatus, toRemoteStatus, trackToMalStatus } from '../src/features/mal/mal-mapper.js';
import { MalError, createMalClient, exchangeCode, refreshTokens } from '../src/features/mal/mal-client.js';
import { mangaTotals, normalizeProfile, profileIsStale } from '../src/features/mal/mal-profile.js';
import { planAfterRead } from '../src/features/tracking/tracking.js';
import { safeCoverUrl } from '../src/shared/covers.js';

const CLIENT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

test('a sign-in attempt makes a long random verifier and state', () => {
  const one = createAuthAttempt();
  const two = createAuthAttempt();
  assert.match(one.verifier, /^[A-Za-z0-9._~-]{64}$/);
  assert.match(one.state, /^[A-Za-z0-9._~-]{24}$/);
  assert.notEqual(one.verifier, two.verifier);
});

test('the authorize link uses the code flow with the plain PKCE method and our redirect', () => {
  const attempt = { verifier: 'v'.repeat(64), state: 's'.repeat(24) };
  const url = new URL(buildAuthorizeUrl(CLIENT, attempt));
  assert.equal(url.origin + url.pathname, 'https://myanimelist.net/v1/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CLIENT);
  assert.equal(url.searchParams.get('code_challenge'), attempt.verifier);
  assert.equal(url.searchParams.get('code_challenge_method'), 'plain');
  assert.equal(url.searchParams.get('state'), attempt.state);
  assert.equal(url.searchParams.get('redirect_uri'), 'tokyomangalab://mal-auth');
  assert.throws(() => buildAuthorizeUrl('12', attempt), /client ID/);
  assert.ok(isValidClientId(CLIENT));
  assert.ok(!isValidClientId('has space in the id 12345'));
});

test('the redirect is read only when it is ours and carries a code', () => {
  const ok = parseAuthRedirect('tokyomangalab://mal-auth?code=' + 'c'.repeat(40) + '&state=abc');
  assert.deepEqual(ok, { ok: true, code: 'c'.repeat(40), state: 'abc' });
  assert.equal(parseAuthRedirect('tokyomangalab://anilist-auth#access_token=x').reason, 'not-ours');
  assert.equal(parseAuthRedirect('https://evil.example/?code=' + 'c'.repeat(40)).reason, 'not-ours');
  assert.equal(parseAuthRedirect('tokyomangalab://mal-auth?error=access_denied').reason, 'denied');
  assert.equal(parseAuthRedirect('tokyomangalab://mal-auth?code=x').reason, 'no-code');
  assert.equal(parseAuthRedirect('nonsense').reason, 'not-a-url');
});

test('statuses round-trip between MyAnimeList, the library and the tracking panel', () => {
  for (const local of ['reading', 'planned', 'completed', 'paused', 'dropped']) assert.equal(toLocalStatus(toRemoteStatus(local)), local);
  assert.equal(toRemoteStatus('planned'), 'plan_to_read');
  assert.equal(toRemoteStatus('paused'), 'on_hold');
  assert.equal(toLocalStatus('nope'), null);
  assert.equal(malToTrackStatus('reading', true), 'REPEATING');
  assert.equal(malToTrackStatus('on_hold'), 'PAUSED');
  assert.equal(trackToMalStatus('REPEATING'), 'reading');
  assert.equal(trackToMalStatus('PLANNING'), 'plan_to_read');
});

const row = (extra = {}) => ({
  node: { id: 13, title: 'Monster', main_picture: { medium: 'https://cdn.myanimelist.net/images/manga/3/m.jpg', large: 'https://cdn.myanimelist.net/images/manga/3/l.jpg' }, alternative_titles: { en: 'Monster', ja: 'MONSTER', synonyms: ['Naoki Urasawa Monster'] }, start_date: '1994-12-05', synopsis: 'x', genres: [{ id: 1, name: 'Mystery' }], num_chapters: 162, nsfw: 'white', ...extra.node },
  list_status: { status: 'reading', score: 8, num_volumes_read: 3, num_chapters_read: 40, is_rereading: false, updated_at: '2026-10-20T10:00:00+00:00', start_date: '2026-01-02', ...extra.list_status }
});

test('a list row becomes a MyAnimeList-only library item with an exact id', () => {
  const entry = normalizeRemoteEntry(row());
  assert.equal(entry.mediaId, '13');
  assert.equal(entry.status, 'reading');
  assert.equal(entry.progress, 40);
  assert.equal(entry.updatedAtMs, Date.parse('2026-10-20T10:00:00+00:00'));
  assert.equal(entry.item.sourceId, 'mal');
  assert.equal(entry.item.externalId, '13');
  assert.equal(entry.item.sourceUrl, 'https://myanimelist.net/manga/13');
  assert.equal(entry.item.coverUrl, 'https://cdn.myanimelist.net/images/manga/3/l.jpg');
  assert.equal(entry.item.releaseYear, 1994);
  assert.deepEqual(entry.item.genres, ['Mystery']);
  assert.ok(entry.item.alternateTitles.includes('MONSTER'));
  assert.equal(entry.entry.score, 80, 'scores are kept on the 0-100 scale the tracking panel uses');
  assert.equal(entry.entry.startedAt, '2026-01-02');
  assert.equal(entry.isAdult, false);
  assert.equal(normalizeRemoteEntry(row({ node: { nsfw: 'black' } })).isAdult, true);
  assert.equal(normalizeRemoteEntry({ node: { id: 1 }, list_status: { status: 'weird' } }), null);
  assert.equal(normalizeRemoteEntry({ list_status: { status: 'reading' } }), null);
});

test('covers only load from MyAnimeList\'s own image host', () => {
  assert.equal(safeCoverUrl('https://cdn.myanimelist.net/images/manga/3/l.jpg'), 'https://cdn.myanimelist.net/images/manga/3/l.jpg');
  assert.equal(safeCoverUrl('https://evil.example/cdn.myanimelist.net/x.jpg'), null);
  assert.equal(normalizeRemoteEntry(row({ node: { main_picture: { large: 'https://evil.example/x.jpg' } } })).item.coverUrl, null);
});

test('search results look like the AniList ones so the same list can show them', () => {
  const result = normalizeSearchNode({ id: 5, title: 'Berserk', alternative_titles: { en: 'Berserk', ja: 'ベルセルク' }, media_type: 'manga', start_date: '1989-08-25', num_chapters: 0, main_picture: { medium: 'https://cdn.myanimelist.net/images/manga/1/b.jpg' } });
  assert.equal(result.id, '5');
  assert.equal(result.title.english, 'Berserk');
  assert.equal(result.startDate.year, 1989);
  assert.equal(result.coverImage.medium, 'https://cdn.myanimelist.net/images/manga/1/b.jpg');
  assert.equal(normalizeSearchNode(null), null);
});

test('tracking patches become the fields MyAnimeList takes', () => {
  assert.deepEqual(patchToMalBody({ status: 'CURRENT', progress: 12, score: 85, startedAt: '2026-10-24', completedAt: null }), { status: 'reading', is_rereading: false, num_chapters_read: 12, score: 9, start_date: '2026-10-24', finish_date: '' });
  assert.equal(patchToMalBody({ status: 'REPEATING' }).is_rereading, true);
  assert.deepEqual(patchToMalBody({}), {});
  assert.equal(patchToMalBody({ score: 0 }).score, 0);
  assert.equal(patchToMalBody({ score: 100 }).score, 10);
});

test('reading a chapter uses the same progress rules as AniList (up only, completes at the last chapter)', () => {
  const entry = entryFromListStatus({ status: 'plan_to_read', num_chapters_read: 0 }, { num_chapters: 10 });
  assert.deepEqual(planAfterRead({ entry, chapterNumber: 3, totalChapters: 10, today: '2026-10-24' }), { progress: 3, status: 'CURRENT', startedAt: '2026-10-24' });
  assert.equal(planAfterRead({ entry: { status: 'CURRENT', progress: 5 }, chapterNumber: 4, totalChapters: 10 }), null);
  assert.equal(planAfterRead({ entry: { status: 'CURRENT', progress: 5, startedAt: '2026-01-01' }, chapterNumber: 10, totalChapters: 10, today: '2026-10-24' }).status, 'COMPLETED');
});

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: new URL(url), init });
    const [status, body, headers = {}] = await handler(calls[calls.length - 1], calls.length);
    return { ok: status >= 200 && status < 300, status, headers: { get: name => headers[name] ?? null }, json: async () => body };
  };
  return { impl, calls };
}

test('the sign-in code is exchanged through the Worker with the verifier', async () => {
  const { impl, calls } = fakeFetch(() => [200, { data: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } }]);
  const tokens = await exchangeCode({ apiBase: 'https://api.example', clientId: CLIENT, code: 'c'.repeat(20), verifier: 'v'.repeat(64), fetchImpl: impl });
  assert.equal(tokens.accessToken, 'AT');
  assert.equal(tokens.refreshToken, 'RT');
  assert.ok(tokens.expiresAt > Date.now() + 3000 * 1000);
  assert.equal(calls[0].url.href, 'https://api.example/api/v1/mal/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { grant_type: 'authorization_code', client_id: CLIENT, code: 'c'.repeat(20), code_verifier: 'v'.repeat(64) });
  const refused = fakeFetch(() => [400, { error: { code: 'MAL_AUTH_FAILED', message: 'no' } }]);
  await assert.rejects(refreshTokens({ apiBase: 'https://api.example', clientId: CLIENT, refreshToken: 'r', fetchImpl: refused.impl }), error => error.code === 'AUTH_FAILED');
});

test('a 401 triggers one token refresh and one retry', async () => {
  let refreshes = 0;
  const auth = { getToken: async () => 'old', refresh: async () => { refreshes += 1; return 'new'; } };
  const { impl, calls } = fakeFetch((call, n) => n === 1 ? [401, { error: { code: 'UNAUTHORIZED' } }] : [200, { data: { id: 7, name: 'Kai' } }]);
  const client = createMalClient({ apiBase: 'https://api.example', auth, fetchImpl: impl });
  assert.equal((await client.viewer()).name, 'Kai');
  assert.equal(refreshes, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer old');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer new');
  const never = fakeFetch(() => [401, { error: { code: 'UNAUTHORIZED' } }]);
  const stuck = createMalClient({ apiBase: 'https://api.example', auth, fetchImpl: never.impl });
  await assert.rejects(stuck.viewer(), error => error.code === 'UNAUTHORIZED');
  assert.equal(never.calls.length, 2, 'it retries once, not forever');
});

test('the manga list is read page by page, each title once, and adult is asked for only when allowed', async () => {
  const pages = [
    { data: [row(), row({ node: { id: 14 } })], hasNext: true, nextOffset: 100, hidden: 1 },
    { data: [row({ node: { id: 14 } }), row({ node: { id: 15 } })], hasNext: false, hidden: 0 }
  ];
  const { impl, calls } = fakeFetch((call, n) => [200, pages[n - 1]]);
  const client = createMalClient({ apiBase: 'https://api.example', auth: { getToken: async () => 't', refresh: async () => 't' }, adult: () => true, fetchImpl: impl });
  const list = await client.mangaList();
  assert.deepEqual(list.rows.map(entry => entry.node.id), [13, 14, 15]);
  assert.equal(list.hidden, 1);
  assert.equal(calls[0].url.searchParams.get('offset'), '0');
  assert.equal(calls[1].url.searchParams.get('offset'), '100');
  assert.equal(calls[0].url.searchParams.get('adult'), '1');
  const plain = fakeFetch(() => [200, { data: [], hasNext: false }]);
  await createMalClient({ apiBase: 'https://api.example', auth: { getToken: async () => 't', refresh: async () => 't' }, fetchImpl: plain.impl }).mangaList();
  assert.ok(!plain.calls[0].url.searchParams.has('adult'));
});

test('errors say what happened', async () => {
  const auth = { getToken: async () => 't', refresh: async () => 't' };
  const run = async (status, body, headers) => {
    const { impl } = fakeFetch(() => [status, body, headers]);
    try { await createMalClient({ apiBase: 'https://api.example', auth, fetchImpl: impl }).mediaEntry(1); } catch (error) { return error; }
    return null;
  };
  assert.equal((await run(429, {}, { 'Retry-After': '30' })).retryAfter, 30);
  assert.equal((await run(502, {})).code, 'UNAVAILABLE');
  assert.equal((await run(404, { error: { code: 'NOT_FOUND' } })).code, 'NOT_FOUND');
  assert.equal((await run(200, null)).code, 'INVALID_RESPONSE', 'an unreadable answer is reported, not trusted');
  assert.equal((await run(200, { data: {} })).code, 'NOT_FOUND', 'an answer with no title in it is not trusted either');
  const offline = createMalClient({ apiBase: 'https://api.example', auth, fetchImpl: async () => { throw new TypeError('fail'); } });
  await assert.rejects(offline.viewer(), error => error instanceof MalError && error.code === 'NETWORK_ERROR');
  assert.throws(() => createMalClient({ apiBase: 'x' }), error => error.code === 'UNAUTHORIZED');
});

test('the profile is built from the account and the list, with no banner or follower counts', () => {
  const totals = mangaTotals([row(), row({ node: { id: 14 }, list_status: { num_chapters_read: 10, num_volumes_read: 1, score: 0 } })]);
  assert.deepEqual(totals, { count: 2, chaptersRead: 50, volumesRead: 4, meanScore: 8 });
  const profile = normalizeProfile({ id: 9, name: 'Kai Tanaka', picture: 'https://cdn.myanimelist.net/images/userimages/9.jpg', location: 'Tokyo', joined_at: '2015-03-02T10:00:00+00:00', anime_statistics: { num_items: 120, num_episodes: 2000, mean_score: 7.9 } }, totals, null, 1000);
  assert.equal(profile.name, 'Kai Tanaka');
  assert.equal(profile.siteUrl, 'https://myanimelist.net/profile/Kai%20Tanaka');
  assert.equal(profile.avatarUrl, 'https://cdn.myanimelist.net/images/userimages/9.jpg');
  assert.equal(profile.bannerUrl, null);
  assert.equal(profile.followers, null);
  assert.equal(profile.joinedAt, '2015-03-02');
  assert.equal(profile.anime.count, 120);
  assert.equal(profile.manga.chaptersRead, 50);
  assert.equal(normalizeProfile({ id: 9, name: 'x' }, null, profile).manga.chaptersRead, 50, 'a refresh keeps the manga numbers worked out from the list');
  assert.equal(normalizeProfile(null), null);
  assert.equal(profileIsStale(profile, 1000 + 60000), false);
  assert.equal(profileIsStale(profile, 1000 + 60 * 60 * 1000), true);
});

test('the app ships with a valid built-in client ID and the fixed redirect', async () => {
  const { DEFAULT_MAL_CLIENT_ID, MAL_REDIRECT_URI } = await import('../src/features/mal/mal-config.js');
  const { isValidClientId } = await import('../src/features/mal/mal-auth.js');
  assert.ok(isValidClientId(DEFAULT_MAL_CLIENT_ID), 'built-in client ID has the shape MyAnimeList issues');
  assert.equal(MAL_REDIRECT_URI, 'tokyomangalab://mal-auth');
});
