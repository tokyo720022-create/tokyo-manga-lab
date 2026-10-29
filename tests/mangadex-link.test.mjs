import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLinkRow, chapterSourceId, findMangaDexMatch, idStatus, isLinkableAniListItem, linkRowId,
  rankCandidates, searchCandidates, searchQueriesFor, withFallbackMetadata
} from '../src/features/linking/mangadex-link.js';

const U1 = '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0';
const U2 = '4d5e6f70-1a2b-4c3d-8e9f-a0b1c2d3e4f5';
const U3 = '5e6f7081-2b3c-4d4e-9fa0-b1c2d3e4f506';
const aniItem = { id: 'item-1', sourceId: 'anilist', externalId: '30013', title: 'One Piece', alternateTitles: ['ONE PIECE', 'one piece', 'ワンピース', 'Extra'], description: 'AniList synopsis', coverUrl: 'https://s4.anilist.co/c.jpg', authors: [], tags: [] };
const md = (externalId, title, anilistId = null, extra = {}) => ({ externalId, title, anilistId, ...extra });

test('only AniList-only titles with a numeric ID can be linked', () => {
  assert.equal(isLinkableAniListItem(aniItem), true);
  assert.equal(isLinkableAniListItem({ ...aniItem, sourceId: 'mangadex' }), false);
  assert.equal(isLinkableAniListItem({ ...aniItem, externalId: 'abc' }), false);
  assert.equal(isLinkableAniListItem(null), false);
});

test('search texts are distinct, trimmed and capped at three', () => {
  assert.deepEqual(searchQueriesFor(aniItem), ['One Piece', 'ワンピース', 'Extra']);
  assert.deepEqual(searchQueriesFor({ title: ' a ', alternateTitles: ['  '] }), []);
});

test('idStatus separates exact, different and missing AniList IDs', () => {
  assert.equal(idStatus(md(U1, 'x', '30013'), 30013), 'exact');
  assert.equal(idStatus(md(U1, 'x', '99'), '30013'), 'other');
  assert.equal(idStatus(md(U1, 'x', null), '30013'), 'none');
  assert.equal(idStatus(md(U1, 'x', 'abc'), '30013'), 'none');
});

test('an exact AniList-ID match on the first search is linked without asking', async () => {
  const calls = [];
  const result = await findMangaDexMatch(aniItem, { search: async q => { calls.push(q); return [md(U2, 'One Pace', null), md(U1, 'One Piece', '30013')]; } });
  assert.equal(result.status, 'exact');
  assert.equal(result.candidate.externalId, U1);
  assert.deepEqual(calls, ['One Piece']);
});

test('later titles are tried when the first search has no exact ID', async () => {
  const calls = [];
  const result = await findMangaDexMatch(aniItem, {
    search: async q => { calls.push(q); return q === 'ワンピース' ? [md(U1, 'ONE PIECE', '30013')] : [md(U2, 'One Piece (fan)', null)]; }
  });
  assert.equal(result.status, 'exact');
  assert.deepEqual(calls, ['One Piece', 'ワンピース']);
});

test('identical titles never link on their own: no exact ID means candidates only', async () => {
  const result = await findMangaDexMatch(aniItem, { search: async () => [md(U1, 'One Piece', null), md(U2, 'One Piece', '77777')] });
  assert.equal(result.status, 'candidates');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].externalId, U1, 'unknown-ID candidate ranks above one tied to another AniList entry');
  assert.equal(result.candidates[1].idStatus, 'other');
});

test('two exact matches are shown to the person instead of picking one', async () => {
  const result = await findMangaDexMatch(aniItem, { search: async () => [md(U1, 'A', '30013'), md(U2, 'B', '30013')] });
  assert.equal(result.status, 'candidates');
  assert.equal(result.candidates.every(c => c.idStatus === 'exact'), true);
});

test('invalid IDs, duplicates and filtered ratings are dropped', async () => {
  const result = await findMangaDexMatch(aniItem, {
    search: async () => [md('not-a-uuid', 'bad'), md(U1, 'A'), md(U1, 'A again'), md(U2, 'Hidden', null, { contentRating: 'erotica' })],
    filter: c => c.contentRating !== 'erotica'
  });
  assert.deepEqual(result.candidates.map(c => c.externalId), [U1]);
});

test('a failing search is skipped; all failing raises the error', async () => {
  const partial = await findMangaDexMatch(aniItem, { search: async q => { if (q === 'One Piece') throw new Error('boom'); return [md(U1, 'X')]; } });
  assert.equal(partial.status, 'candidates');
  assert.equal(partial.partialFailure, true);
  await assert.rejects(findMangaDexMatch(aniItem, { search: async () => { throw new Error('down'); } }), /down/);
});

test('manual search ranks but never links', async () => {
  const out = await searchCandidates(aniItem, '  one   piece ', { search: async q => { assert.equal(q, 'one piece'); return [md(U2, 'B', null), md(U1, 'A', '30013')]; } });
  assert.equal(out.candidates[0].externalId, U1);
  assert.deepEqual(await searchCandidates(aniItem, ' ', { search: async () => { throw new Error('should not run'); } }), { candidates: [], query: '' });
});

test('rankCandidates is stable inside each group', () => {
  const ranked = rankCandidates([{ externalId: 'a', idStatus: 'none' }, { externalId: 'b', idStatus: 'exact' }, { externalId: 'c', idStatus: 'none' }, { externalId: 'd', idStatus: 'other' }]);
  assert.deepEqual(ranked.map(c => c.externalId), ['b', 'a', 'c', 'd']);
});

test('link rows keep the AniList ID, a snapshot for blanks, and a safe MangaDex URL', () => {
  const row = buildLinkRow(aniItem, md(U1.toUpperCase(), 'One Piece', '30013', { description: 'MD synopsis', coverUrl: 'https://uploads.mangadex.org/c.jpg', authors: ['Oda'], tags: ['Action'] }), 'anilist-id', '2026-01-01T00:00:00Z');
  assert.equal(row.id, linkRowId('item-1'));
  assert.equal(row.externalId, U1);
  assert.equal(row.sourceUrl, `https://mangadex.org/title/${U1}`);
  assert.equal(row.linkedAnilistId, '30013');
  assert.equal(row.linkKind, 'anilist-id');
  assert.throws(() => buildLinkRow(aniItem, md('nope', 'x'), 'user-selected'), /MangaDex title ID/);
  assert.throws(() => buildLinkRow(aniItem, md(U1, 'x'), 'guess'), /link kind/);
  assert.throws(() => buildLinkRow({ ...aniItem, sourceId: 'mangadex' }, md(U1, 'x'), 'user-selected'), /AniList-only/);
});

test('chapters come from the item itself or from its own link row only', () => {
  const row = buildLinkRow(aniItem, md(U1, 'One Piece'), 'user-selected');
  assert.equal(chapterSourceId({ id: 'm', sourceId: 'mangadex', externalId: U2 }), U2);
  assert.equal(chapterSourceId(aniItem, row), U1);
  assert.equal(chapterSourceId(aniItem, null), null);
  assert.equal(chapterSourceId({ ...aniItem, id: 'other-item' }, row), null, 'a link row never applies to a different item');
});

test('AniList metadata is preserved; MangaDex only fills blanks', () => {
  const row = buildLinkRow(aniItem, md(U1, 'One Piece', null, { description: 'MD synopsis', coverUrl: 'https://uploads.mangadex.org/c.jpg', authors: ['Oda'], tags: ['Action'] }), 'user-selected');
  const full = withFallbackMetadata(aniItem, row);
  assert.equal(full.description, 'AniList synopsis');
  assert.equal(full.coverUrl, 'https://s4.anilist.co/c.jpg');
  assert.deepEqual(full.authors, ['Oda'], 'empty authors are filled');
  assert.deepEqual(full.usedFallback, ['authors', 'tags']);
  const bare = withFallbackMetadata({ ...aniItem, description: '', coverUrl: null }, row);
  assert.equal(bare.description, 'MD synopsis');
  assert.equal(bare.coverUrl, 'https://uploads.mangadex.org/c.jpg');
  assert.equal(aniItem.description, 'AniList synopsis', 'the stored item is not mutated');
  assert.equal(withFallbackMetadata(aniItem, null), aniItem);
});

// ---- MyAnimeList-only titles link to MangaDex the same way, by the MyAnimeList id MangaDex lists ----
import { isLinkableTrackerItem, trackerIdKey } from '../src/features/linking/mangadex-link.js';

test('MyAnimeList-only titles can be linked, matched only by MangaDex\'s own MyAnimeList id', async () => {
  const malItem = { id: 'c1', sourceId: 'mal', externalId: '13', title: 'Monster', alternateTitles: [] };
  assert.ok(isLinkableTrackerItem(malItem));
  assert.ok(isLinkableTrackerItem({ id: 'c2', sourceId: 'anilist', externalId: '5' }));
  assert.ok(!isLinkableTrackerItem({ id: 'c3', sourceId: 'mangadex', externalId: '5' }));
  assert.equal(trackerIdKey(malItem), 'malId');
  assert.equal(trackerIdKey({ sourceId: 'anilist' }), 'anilistId');
  const uuid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
  const search = async () => [{ externalId: uuid(1), title: 'Monster', anilistId: '13', malId: null }, { externalId: uuid(2), title: 'Monster (other)', anilistId: null, malId: '13' }];
  const result = await findMangaDexMatch(malItem, { search });
  assert.equal(result.status, 'exact', 'the candidate that lists MyAnimeList #13 is the exact match');
  assert.equal(result.candidate.externalId, uuid(2), 'an AniList id equal to the MyAnimeList number is not a match');
  const none = await findMangaDexMatch({ ...malItem, externalId: '99' }, { search });
  assert.equal(none.status, 'candidates');
  assert.deepEqual(none.candidates.map(candidate => candidate.idStatus).sort(), ['none', 'other']);
  const row = buildLinkRow(malItem, result.candidate, 'mal-id');
  assert.equal(row.linkedMalId, '13');
  assert.equal(row.linkedAnilistId, undefined);
  assert.throws(() => buildLinkRow(malItem, result.candidate, 'nonsense'), /Unknown link kind/);
});
