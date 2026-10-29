import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

const MANGA_ID = '11111111-1111-4111-8111-111111111111';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';

function sampleManga(rating = 'safe') {
  return {
    id: MANGA_ID,
    attributes: {
      title: { en: 'Example Manga' },
      altTitles: [{ ja: '例の漫画' }],
      description: { en: 'A test synopsis.' },
      year: 2024,
      status: 'ongoing',
      contentRating: rating,
      originalLanguage: 'ja',
      tags: [{ attributes: { name: { en: 'Adventure' } } }]
    },
    relationships: [
      { id: 'author-1', type: 'author', attributes: { name: 'Example Author' } },
      { id: 'artist-1', type: 'artist', attributes: { name: 'Example Artist' } },
      { id: 'cover-1', type: 'cover_art', attributes: { fileName: 'cover.jpg' } }
    ]
  };
}

function sampleChapter() {
  return {
    id: CHAPTER_ID,
    attributes: {
      chapter: '12.5', volume: '3', title: 'The Next Step',
      translatedLanguage: 'en', pages: 21, publishAt: '2025-03-01T12:00:00+00:00'
    },
    relationships: [{ id: 'group-1', type: 'scanlation_group', attributes: { name: 'Example Group' } }]
  };
}

function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => handler(new URL(typeof input === 'string' ? input : input.url), init);
  t.after(() => { globalThis.fetch = original; });
}

function apiRequest(path, { origin = 'https://tokyo720022-create.github.io', method = 'GET' } = {}) {
  return new Request(`https://worker.test${path}`, { method, headers: origin ? { Origin: origin } : {} });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('legacy /health route remains available', async () => {
  const response = await worker.fetch(apiRequest('/health'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.ok(body.contentRatings.includes('safe'));
});

test('source registry exposes search, chapters and reader capabilities', async () => {
  const response = await worker.fetch(apiRequest('/api/v1/sources'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data[0].id, 'mangadex');
  assert.equal(body.data[0].capabilities.titleDetails, true);
  assert.equal(body.data[0].capabilities.chapterContent, true);
  assert.equal(body.data[0].capabilities.offlineDownloads, false);
});

test('versioned search returns normalized source entries and pagination', async t => {
  mockFetch(t, async url => {
    assert.equal(url.pathname, '/manga');
    assert.equal(url.searchParams.get('title'), 'Example');
    assert.deepEqual(url.searchParams.getAll('contentRating[]'), ['safe', 'suggestive']);
    return jsonResponse({ data: [sampleManga()], total: 25, limit: 24, offset: 0 });
  });
  const response = await worker.fetch(apiRequest('/api/v1/search?query=Example&type=manga&page=1'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data[0].sourceId, 'mangadex');
  assert.equal(body.data[0].externalId, MANGA_ID);
  assert.equal(body.data[0].title, 'Example Manga');
  assert.equal(body.data[0].publicationStatus, 'releasing');
  assert.equal(body.data[0].coverUrl, `https://uploads.mangadex.org/covers/${MANGA_ID}/cover.jpg.256.jpg`);
  assert.equal(body.pagination.hasNext, true);
  assert.equal(body.meta.apiVersion, '1');
});

test('versioned details returns metadata and filters explicit ratings', async t => {
  mockFetch(t, async url => {
    assert.equal(url.pathname, `/manga/${MANGA_ID}`);
    return jsonResponse({ data: sampleManga() });
  });
  const response = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}`));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.title, 'Example Manga');
  assert.deepEqual(body.data.authors, ['Example Author']);
  assert.deepEqual(body.data.artists, ['Example Artist']);
});

test('versioned details excludes explicit-rated title records', async t => {
  mockFetch(t, async () => jsonResponse({ data: sampleManga('pornographic') }));
  const response = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}`));
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'TITLE_UNAVAILABLE');
});

test('chapter route returns paginated metadata and canonical source links, not chapter content', async t => {
  let calls = 0;
  mockFetch(t, async url => {
    calls += 1;
    if (url.pathname === `/manga/${MANGA_ID}`) return jsonResponse({ data: sampleManga() });
    assert.equal(url.pathname, `/manga/${MANGA_ID}/feed`);
    assert.equal(url.searchParams.get('translatedLanguage[]'), 'en');
    assert.equal(url.searchParams.get('includeExternalUrl'), '0', 'chapters hosted on other sites are not listed');
    assert.equal(url.searchParams.get('includeEmptyPages'), '0', 'chapters with no pages are not listed');
    return jsonResponse({ data: [sampleChapter()], total: 1, limit: 24, offset: 0 });
  });
  const response = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}/chapters?page=1&language=en`));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(body.data[0].chapterNumber, '12.5');
  assert.equal(body.data[0].scanlationGroups[0], 'Example Group');
  assert.equal(body.data[0].sourceUrl, `https://mangadex.org/chapter/${CHAPTER_ID}`);
  assert.equal('content' in body.data[0], false);
  assert.equal(body.pagination.hasNext, false);
});

test('chapter pages can be asked for in bigger sizes, up to a cap', async t => {
  const limits = [];
  mockFetch(t, async url => {
    if (url.pathname === `/manga/${MANGA_ID}`) return jsonResponse({ data: sampleManga() });
    limits.push([url.searchParams.get('limit'), url.searchParams.get('offset')]);
    return jsonResponse({ data: [sampleChapter()], total: 250, limit: 100, offset: 0 });
  });
  const big = await (await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}/chapters?page=2&limit=100`))).json();
  assert.deepEqual(limits.at(-1), ['100', '100'], 'page 2 of 100 starts at offset 100');
  assert.equal(big.pagination.limit, 100);
  assert.equal(big.pagination.hasNext, true);
  await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}/chapters?limit=9999`));
  assert.equal(limits.at(-1)[0], '100', 'the size is capped');
  await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}/chapters?limit=abc`));
  assert.equal(limits.at(-1)[0], '24', 'nonsense falls back to the default');
  await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}/chapters`));
  assert.equal(limits.at(-1)[0], '24', 'older clients still get 24');
});

test('invalid MangaDex IDs and language filters are rejected', async () => {
  const invalidId = await worker.fetch(apiRequest('/api/v1/manga/not-a-uuid'));
  assert.equal(invalidId.status, 400);
  assert.equal((await invalidId.json()).error.code, 'INVALID_MANGA_ID');

  const invalidLanguage = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}/chapters?language=english`));
  assert.equal(invalidLanguage.status, 400);
  assert.equal((await invalidLanguage.json()).error.code, 'INVALID_LANGUAGE');
});

test('legacy /manga response shape remains compatible', async t => {
  mockFetch(t, async () => jsonResponse({ data: [sampleManga()], total: 1, limit: 24, offset: 0 }));
  const response = await worker.fetch(apiRequest('/manga?q=Example&page=1'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data[0].id, MANGA_ID);
  assert.equal(body.data[0].title, 'Example Manga');
  assert.equal(body.data[0].status, 'ongoing');
  assert.equal(body.data[0].mangaDexUrl, `https://mangadex.org/title/${MANGA_ID}`);
});

test('unapproved browser origins are rejected', async () => {
  const response = await worker.fetch(apiRequest('/health', { origin: 'https://evil.example' }));
  assert.equal(response.status, 403);
});

test('local preview origin is allowed by CORS preflight', async () => {
  const response = await worker.fetch(apiRequest('/api/v1/sources', { origin: 'http://127.0.0.1:8000', method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8000');
});

test('search results pass on exact AniList and MyAnimeList ids when MangaDex has them', async t => {
  const withLinks = sampleManga();
  withLinks.attributes.links = { al: '30013', mal: '13', raw: 'https://example.com' };
  const noLinks = { ...sampleManga(), id: '33333333-3333-4333-8333-333333333333' };
  noLinks.attributes = { ...sampleManga().attributes, links: { al: 'https://anilist.co/manga/1' } };
  mockFetch(t, url => url.pathname === '/manga'
    ? jsonResponse({ data: [withLinks, noLinks], total: 2 })
    : new Response('unexpected', { status: 500 }));
  const response = await worker.fetch(apiRequest('/manga?q=example'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data[0].anilistId, '30013');
  assert.equal(body.data[0].malId, '13');
  assert.equal(body.data[1].anilistId, null, 'non-numeric link values are dropped');
  assert.equal(body.data[1].malId, null);
});

// ---- chapter pages -------------------------------------------------------------------
function chapterWithManga(rating = 'safe', extra = {}) {
  return {
    data: {
      id: CHAPTER_ID,
      attributes: { chapter: '1', translatedLanguage: 'en', pages: 2, ...extra },
      relationships: [{ id: MANGA_ID, type: 'manga', attributes: { contentRating: rating } }]
    }
  };
}

function atHomeBody(overrides = {}) {
  return {
    baseUrl: 'https://node.example.network',
    chapter: { hash: 'abc123def456', data: ['1-aaa.png', '2-bbb.png'], dataSaver: ['1-aaa.jpg', '2-bbb.jpg'] },
    ...overrides
  };
}

test('pages endpoint returns URL parts only, uncached, from the two fixed upstream paths', async t => {
  const seen = [];
  mockFetch(t, url => {
    seen.push(url.pathname);
    if (url.pathname === `/chapter/${CHAPTER_ID}`) return jsonResponse(chapterWithManga());
    if (url.pathname === `/at-home/server/${CHAPTER_ID}`) return jsonResponse(atHomeBody());
    return jsonResponse({}, 404);
  });
  const response = await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(seen, [`/chapter/${CHAPTER_ID}`, `/at-home/server/${CHAPTER_ID}`]);
  assert.equal(body.data.baseUrl, 'https://node.example.network');
  assert.equal(body.data.hash, 'abc123def456');
  assert.deepEqual(body.data.data, ['1-aaa.png', '2-bbb.png']);
  assert.equal(body.data.mangaExternalId, MANGA_ID);
});

test('pages endpoint rejects bad ids without calling upstream', async t => {
  let called = false;
  mockFetch(t, () => { called = true; return jsonResponse({}); });
  const response = await worker.fetch(apiRequest('/api/v1/chapters/not-a-uuid/pages'));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test('pages endpoint fails closed for adult titles and unreadable ratings', async t => {
  for (const rating of ['erotica', 'pornographic', null]) {
    mockFetch(t, url => url.pathname.startsWith('/at-home')
      ? jsonResponse(atHomeBody())
      : jsonResponse(chapterWithManga(rating)));
    const response = await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`));
    assert.equal(response.status, 404, `rating ${rating}`);
  }
});

test('pages endpoint sends externally hosted chapters back to the source link', async t => {
  mockFetch(t, () => jsonResponse(chapterWithManga('safe', { externalUrl: 'https://example.com/read' })));
  const response = await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`));
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'CHAPTER_EXTERNAL');
});

test('pages endpoint drops unsafe filenames and rejects non-https node URLs', async t => {
  mockFetch(t, url => url.pathname.startsWith('/at-home')
    ? jsonResponse(atHomeBody({ chapter: { hash: 'abc123def456', data: ['ok.png', '../evil', 'a/b.png'], dataSaver: [] } }))
    : jsonResponse(chapterWithManga()));
  const ok = await (await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`))).json();
  assert.deepEqual(ok.data.data, ['ok.png']);

  mockFetch(t, url => url.pathname.startsWith('/at-home')
    ? jsonResponse(atHomeBody({ baseUrl: 'http://insecure.example' }))
    : jsonResponse(chapterWithManga()));
  const bad = await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`));
  assert.equal(bad.status, 502);
});

test('pages endpoint maps upstream 429 and enforces the origin allowlist', async t => {
  mockFetch(t, () => jsonResponse({}, 429));
  const limited = await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`));
  assert.equal(limited.status, 429);
  const blocked = await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`, { origin: 'https://evil.example' }));
  assert.equal(blocked.status, 403);
});

// ---- adult ratings gate --------------------------------------------------------------
const LOLI_TAG = { id: '2d1f5d56-a1e5-4d0d-a961-2193588b08ec', attributes: { name: { en: 'Loli' } } };

function mangaPayload(rating, tags = []) {
  const m = sampleManga(rating);
  m.attributes.tags = [...m.attributes.tags, ...tags];
  return { data: m };
}

test('adult ratings are never served to browser origins, even with adult=1', async t => {
  mockFetch(t, () => jsonResponse(mangaPayload('erotica')));
  const response = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}?adult=1`));
  assert.equal(response.status, 404);
});

test('adult ratings need both no browser origin and adult=1', async t => {
  mockFetch(t, () => jsonResponse(mangaPayload('pornographic')));
  const withoutFlag = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}`, { origin: '' }));
  assert.equal(withoutFlag.status, 404);
  const allowed = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}?adult=1`, { origin: '' }));
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).data.contentRating, 'pornographic');
});

test('loli/shota tagged titles are shown only when rated safe with no sexual-content tag', async t => {
  const SEXUAL_TAG = { id: 'sexual-tag-id', attributes: { name: { en: 'Sexual Violence' } } };
  const status = async (rating, tags, path = `/api/v1/manga/${MANGA_ID}`, origin) => {
    mockFetch(t, () => jsonResponse(mangaPayload(rating, tags)));
    return (await worker.fetch(apiRequest(path, origin === undefined ? {} : { origin }))).status;
  };
  assert.equal(await status('safe', [LOLI_TAG]), 200, 'safe + tag, browser');
  assert.equal(await status('safe', [LOLI_TAG], `/api/v1/manga/${MANGA_ID}?adult=1`, ''), 200, 'safe + tag, app with 18+ on');
  for (const rating of ['suggestive', 'erotica', 'pornographic']) {
    assert.equal(await status(rating, [LOLI_TAG]), 404, `${rating} + tag, browser`);
    assert.equal(await status(rating, [LOLI_TAG], `/api/v1/manga/${MANGA_ID}?adult=1`, ''), 404, `${rating} + tag, app with 18+ on`);
  }
  assert.equal(await status('safe', [LOLI_TAG, SEXUAL_TAG]), 404, 'a sexual-content tag next to the block tag means the rating is not trusted');
  // Name-based check still applies if the id ever changes upstream.
  const SHOTA_BY_NAME = { id: 'other-id', attributes: { name: { en: 'Shota' } } };
  assert.equal(await status('erotica', [SHOTA_BY_NAME], `/api/v1/manga/${MANGA_ID}?adult=1`, ''), 404);
  assert.equal(await status('suggestive', [SHOTA_BY_NAME]), 404);
  assert.equal(await status('safe', [SHOTA_BY_NAME]), 200);
});

test('search asks upstream for adult ratings only in the gated case, and always excludes blocked tags in the main request', async t => {
  const seen = [];
  mockFetch(t, url => { seen.push(url); return jsonResponse({ data: [sampleManga('pornographic')], total: 1 }); });
  const browser = await (await worker.fetch(apiRequest('/api/v1/search?query=x&adult=1'))).json();
  assert.equal(browser.data.length, 0);
  const mainCalls = () => seen.filter(entry => !entry.searchParams.has('includedTags[]'));
  assert.ok(!mainCalls()[0].searchParams.getAll('contentRating[]').includes('pornographic'));
  const app = await (await worker.fetch(apiRequest('/api/v1/search?query=x&adult=1', { origin: '' }))).json();
  assert.equal(app.data.length, 1);
  assert.ok(mainCalls()[1].searchParams.getAll('contentRating[]').includes('pornographic'));
  for (const url of seen.filter(entry => !entry.searchParams.has('includedTags[]'))) {
    assert.ok(url.searchParams.getAll('excludedTags[]').includes(LOLI_TAG.id));
    assert.equal(url.searchParams.get('excludedTagsMode'), 'OR');
  }
  // The separate request for safe-rated tagged titles asks for safe only, never for adult ratings.
  for (const url of seen.filter(entry => entry.searchParams.has('includedTags[]'))) assert.deepEqual(url.searchParams.getAll('contentRating[]'), ['safe']);
});

test('legacy /manga route follows the same gate', async t => {
  mockFetch(t, () => jsonResponse({ data: [sampleManga('erotica')], total: 1 }));
  assert.equal((await (await worker.fetch(apiRequest('/manga?q=x&adult=1'))).json()).data.length, 0);
  assert.equal((await (await worker.fetch(apiRequest('/manga?q=x&adult=1', { origin: '' }))).json()).data.length, 1);
});

test('chapter pages follow the gate and the blocked-tag rule', async t => {
  const withParent = (rating, tags = []) => ({
    data: { id: CHAPTER_ID, attributes: { chapter: '1', pages: 2 }, relationships: [{ id: MANGA_ID, type: 'manga', attributes: { contentRating: rating, tags } }] }
  });
  mockFetch(t, url => url.pathname.startsWith('/at-home') ? jsonResponse(atHomeBody()) : jsonResponse(withParent('erotica')));
  assert.equal((await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages?adult=1`))).status, 404);
  assert.equal((await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages?adult=1`, { origin: '' }))).status, 200);
  mockFetch(t, url => url.pathname.startsWith('/at-home') ? jsonResponse(atHomeBody()) : jsonResponse(withParent('erotica', [LOLI_TAG])));
  assert.equal((await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages?adult=1`, { origin: '' }))).status, 404);
  mockFetch(t, url => url.pathname.startsWith('/at-home') ? jsonResponse(atHomeBody()) : jsonResponse(withParent('suggestive', [LOLI_TAG])));
  assert.equal((await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`))).status, 404);
  mockFetch(t, url => url.pathname.startsWith('/at-home') ? jsonResponse(atHomeBody()) : jsonResponse(withParent('safe', [LOLI_TAG])));
  assert.equal((await worker.fetch(apiRequest(`/api/v1/chapters/${CHAPTER_ID}/pages`))).status, 200);
});

test('a client that sends too many requests is told to wait, other clients are unaffected, health stays open', async t => {
  mockFetch(t, async () => jsonResponse({ data: [], total: 0 }));
  const from = ip => new Request('https://worker.test/manga?q=a', { headers: { Origin: 'https://tokyo720022-create.github.io', 'CF-Connecting-IP': ip } });
  let last;
  for (let i = 0; i < 121; i += 1) last = await worker.fetch(from('203.0.113.7'));
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get('Retry-After')) >= 1);
  assert.equal((await last.json()).error.code, 'RATE_LIMITED');
  assert.equal((await worker.fetch(from('203.0.113.8'))).status, 200);
  const health = await worker.fetch(new Request('https://worker.test/health', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }));
  assert.equal(health.status, 200);
});

function fakeEdgeCache(t) {
  const store = new Map();
  const original = globalThis.caches;
  globalThis.caches = { default: {
    put: async (request, response) => { store.set(request.url, await response.text()); },
    match: async request => store.has(request.url) ? new Response(store.get(request.url), { headers: { 'Content-Type': 'application/json' } }) : undefined
  } };
  t.after(() => { if (original === undefined) delete globalThis.caches; else globalThis.caches = original; });
  return store;
}

test('when MangaDex is down the last good answer for the same request is served', async t => {
  fakeEdgeCache(t);
  let down = false;
  mockFetch(t, () => down ? jsonResponse({ result: 'error' }, 503) : jsonResponse({ data: [sampleManga()], total: 1 }));
  const first = await worker.fetch(apiRequest('/api/v1/search?query=example'));
  assert.equal(first.status, 200);
  const good = await first.json();
  down = true;
  const second = await worker.fetch(apiRequest('/api/v1/search?query=example'));
  assert.equal(second.status, 200, 'the app still gets its results');
  assert.deepEqual((await second.json()).data.map(item => item.title), good.data.map(item => item.title));
});

test('rate limits also fall back to the last good answer, but never-seen requests still fail honestly', async t => {
  fakeEdgeCache(t);
  let limited = false;
  mockFetch(t, () => limited ? jsonResponse({ result: 'error' }, 429) : jsonResponse({ data: [sampleManga()], total: 1 }));
  await worker.fetch(apiRequest('/api/v1/search?query=example'));
  limited = true;
  assert.equal((await worker.fetch(apiRequest('/api/v1/search?query=example'))).status, 200);
  const unseen = await worker.fetch(apiRequest('/api/v1/search?query=something-new'));
  assert.notEqual(unseen.status, 200, 'nothing was remembered for this request, so the failure is shown');
});

test('"not found" is never replaced by an old answer', async t => {
  fakeEdgeCache(t);
  let missing = false;
  mockFetch(t, () => missing ? jsonResponse({ result: 'error' }, 404) : jsonResponse({ data: sampleManga() }));
  await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}`));
  missing = true;
  const after = await worker.fetch(apiRequest(`/api/v1/manga/${MANGA_ID}`));
  assert.equal(after.status, 404);
});

test('the Worker still works where no edge cache exists', async t => {
  const original = globalThis.caches;
  delete globalThis.caches;
  t.after(() => { if (original !== undefined) globalThis.caches = original; });
  mockFetch(t, () => jsonResponse({ data: [sampleManga()], total: 1 }));
  assert.equal((await worker.fetch(apiRequest('/api/v1/search?query=example'))).status, 200);
});

test('hasChapters=1 asks MangaDex to skip titles with no chapters, in the chosen language', async t => {
  const seen = [];
  mockFetch(t, url => { seen.push(url); return jsonResponse({ data: [sampleManga()], total: 1 }); });
  const response = await worker.fetch(apiRequest('/api/v1/search?query=example&hasChapters=1&lang=es'));
  assert.equal(response.status, 200);
  const main = seen.find(url => url.pathname === '/manga' && url.searchParams.get('title') === 'example' && !url.searchParams.has('includedTags[]'));
  assert.equal(main.searchParams.get('hasAvailableChapters'), 'true');
  assert.deepEqual(main.searchParams.getAll('availableTranslatedLanguage[]'), ['es']);
  assert.ok(seen.filter(url => url.searchParams.has('includedTags[]')).every(url => url.searchParams.get('hasAvailableChapters') === 'true'), 'the tagged-titles lookup is filtered the same way');
});

test('without hasChapters nothing is filtered, and a bad language is dropped', async t => {
  const seen = [];
  mockFetch(t, url => { seen.push(url); return jsonResponse({ data: [], total: 0 }); });
  await worker.fetch(apiRequest('/api/v1/search?query=example'));
  assert.ok(seen.every(url => !url.searchParams.has('hasAvailableChapters')), 'older apps get the same results as before');
  seen.length = 0;
  await worker.fetch(apiRequest('/manga?q=example&hasChapters=1&lang=%3Cscript%3E'));
  const main = seen.find(url => url.searchParams.get('title') === 'example');
  assert.equal(main.searchParams.get('hasAvailableChapters'), 'true');
  assert.equal(main.searchParams.has('availableTranslatedLanguage[]'), false, 'an invalid language code is ignored');
});
