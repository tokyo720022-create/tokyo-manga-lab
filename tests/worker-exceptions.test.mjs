import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../worker/src/index.js', import.meta.url), 'utf8');
const EMPTY_LIST = /const REVIEWED_EXCEPTIONS = \[\s*\];/;

const LISTED = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';
const LOLI = { id: '2d1f5d56-a1e5-4d0d-a961-2193588b08ec', attributes: { name: { en: 'Loli' } } };

async function loadWorker(entries) {
  const list = `const REVIEWED_EXCEPTIONS = ${JSON.stringify(entries)};`;
  const code = SOURCE.replace(EMPTY_LIST, list);
  assert.notEqual(code, SOURCE, 'the empty exception list marker was not found');
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${Math.random()}`)).default;
}

const manga = (id, rating = 'safe', tags = [LOLI], title = 'Quiet Cafe Days') => ({
  id,
  attributes: { title: { en: title }, altTitles: [], description: { en: 'x' }, year: 2024, status: 'ongoing', contentRating: rating, originalLanguage: 'ja', tags },
  relationships: [{ id: 'c1', type: 'cover_art', attributes: { fileName: 'c.jpg' } }]
});
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
function mockFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async input => handler(new URL(typeof input === 'string' ? input : input.url));
  t.after(() => { globalThis.fetch = original; });
}
const req = (path, origin = 'https://tokyo720022-create.github.io') => new Request(`https://worker.test${path}`, { headers: origin ? { Origin: origin } : {} });

test('the shipped worker has an empty exception list, so every loli/shota tagged title stays blocked', () => {
  assert.match(SOURCE, EMPTY_LIST);
});

test('a reviewed, safe-rated title opens even though it carries a blocked tag', async t => {
  const worker = await loadWorker([{ id: LISTED, title: 'Quiet Cafe Days' }]);
  mockFetch(t, url => json({ data: manga(url.pathname.split('/').pop()) }));
  assert.equal((await worker.fetch(req(`/api/v1/manga/${LISTED}`))).status, 200);
  assert.equal((await worker.fetch(req(`/api/v1/manga/${OTHER}`))).status, 404, 'an unlisted title with the tag stays blocked');
});

test('a listed title that is not rated safe stays blocked, in every mode', async t => {
  const worker = await loadWorker([{ id: LISTED }]);
  for (const rating of ['suggestive', 'erotica', 'pornographic']) {
    mockFetch(t, () => json({ data: manga(LISTED, rating) }));
    assert.equal((await worker.fetch(req(`/api/v1/manga/${LISTED}`))).status, 404, `${rating} in the browser`);
    assert.equal((await worker.fetch(req(`/api/v1/manga/${LISTED}?adult=1`, ''))).status, 404, `${rating} in the app with 18+ on`);
  }
});

test('chapter pages of a reviewed title are served, and of an unlisted one are not', async t => {
  const worker = await loadWorker([{ id: LISTED }]);
  const handler = parentId => url => {
    if (url.pathname.startsWith('/chapter/')) return json({ data: { id: CHAPTER_ID, attributes: { chapter: '1', pages: 1 }, relationships: [{ id: parentId, type: 'manga', attributes: { contentRating: 'safe', tags: [LOLI] } }] } });
    return json({ baseUrl: 'https://uploads.mangadex.org', chapter: { hash: 'abcdef123456', data: ['1-a.png'], dataSaver: ['1-b.jpg'] } });
  };
  mockFetch(t, handler(LISTED));
  assert.equal((await worker.fetch(req(`/api/v1/chapters/${CHAPTER_ID}/pages`))).status, 200);
  mockFetch(t, handler(OTHER));
  assert.equal((await worker.fetch(req(`/api/v1/chapters/${CHAPTER_ID}/pages`))).status, 404);
});

test('search adds reviewed titles that match the words, on page one only, and only asks for safe ratings', async t => {
  const worker = await loadWorker([{ id: LISTED, title: 'Quiet Cafe Days' }]);
  const seen = [];
  mockFetch(t, url => {
    seen.push(url);
    if (url.searchParams.has('ids[]')) return json({ data: [manga(LISTED), manga(OTHER, 'safe', [LOLI], 'Quiet Other')], total: 2 });
    return json({ data: [manga('55555555-5555-4555-8555-555555555555', 'safe', [], 'Cafe Stories')], total: 1 });
  });
  const hit = await (await worker.fetch(req('/api/v1/search?query=quiet%20cafe'))).json();
  assert.deepEqual(hit.data.map(item => item.externalId), [LISTED, '55555555-5555-4555-8555-555555555555']);
  const idsCall = seen.find(url => url.searchParams.has('ids[]'));
  assert.deepEqual(idsCall.searchParams.getAll('ids[]'), [LISTED]);
  assert.deepEqual(idsCall.searchParams.getAll('contentRating[]'), ['safe']);
  const miss = await (await worker.fetch(req('/api/v1/search?query=zzz'))).json();
  assert.ok(!miss.data.some(item => item.externalId === LISTED), 'a title that does not match the words is not added');
  const pageTwo = await (await worker.fetch(req('/api/v1/search?query=quiet%20cafe&page=2'))).json();
  assert.ok(!pageTwo.data.some(item => item.externalId === LISTED), 'page two does not repeat it');
  const legacy = await (await worker.fetch(req('/manga?q=quiet'))).json();
  assert.equal(legacy.data[0].id, LISTED);
});

test('a failing exception lookup never breaks the normal search', async t => {
  const worker = await loadWorker([{ id: LISTED }]);
  mockFetch(t, url => (url.searchParams.has('ids[]') ? json({}, 500) : json({ data: [manga('55555555-5555-4555-8555-555555555555', 'safe', [], 'Cafe Stories')], total: 1 })));
  const result = await (await worker.fetch(req('/api/v1/search?query=cafe'))).json();
  assert.equal(result.data.length, 1);
});

test('bad entries in the list are ignored', async t => {
  const worker = await loadWorker([{ id: 'not-a-uuid' }, { title: 'no id' }, null, { id: 'DROP TABLE' }]);
  mockFetch(t, () => json({ data: manga(LISTED) }));
  assert.equal((await worker.fetch(req(`/api/v1/manga/${LISTED}`))).status, 404);
});

test('an upper-case id in the list still matches', async t => {
  const worker = await loadWorker([{ id: LISTED.toUpperCase() }]);
  mockFetch(t, url => json({ data: manga(url.pathname.split('/').pop()) }));
  assert.equal((await worker.fetch(req(`/api/v1/manga/${LISTED}`))).status, 200);
});
