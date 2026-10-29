// Links an AniList-only title to a MangaDex title so the existing MangaDex chapter list and reader can be used.
//
// Rules (see docs/LINKING.md):
//  - An automatic link is made only when MangaDex says the candidate belongs to this exact AniList numeric ID.
//  - Otherwise the person picks a candidate. Similar-looking titles are never linked automatically.
//  - The link is a separate record. The AniList item keeps its own description and artwork; MangaDex only fills blanks.
//
// Everything here is pure (no network, no storage) so it can be tested directly. The caller supplies `search`.
export const LINK_ROLE = 'chapter-source';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_QUERIES = 3;
export const MAX_CANDIDATES = 12;

export const isMangaDexId = value => UUID.test(String(value || ''));
export const isAniListNumericId = value => /^\d{1,9}$/.test(String(value ?? ''));

// An AniList title that has no MangaDex record of its own and so cannot list chapters.
export function isLinkableAniListItem(item) {
  return Boolean(item) && item.sourceId === 'anilist' && isAniListNumericId(item.externalId);
}

// An AniList or MyAnimeList title that has no MangaDex record of its own and so cannot list chapters.
export function isLinkableTrackerItem(item) {
  return Boolean(item) && (item.sourceId === 'anilist' || item.sourceId === 'mal') && isAniListNumericId(item.externalId);
}
// Which id on a MangaDex candidate says "this is that title" for the given tracker title.
export const trackerIdKey = item => (item?.sourceId === 'mal' ? 'malId' : 'anilistId');

export const linkRowId = contentItemId => `${LINK_ROLE}:${contentItemId}`;

// Distinct, trimmed search texts: the main title first, then up to two alternates (romaji / native).
export function searchQueriesFor(item) {
  const seen = new Set();
  const queries = [];
  for (const raw of [item?.title, ...(Array.isArray(item?.alternateTitles) ? item.alternateTitles : [])]) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const key = text.toLowerCase();
    if (text.length < 2 || seen.has(key)) continue;
    seen.add(key);
    queries.push(text);
    if (queries.length >= MAX_QUERIES) break;
  }
  return queries;
}

// 'exact'  = MangaDex lists this very AniList ID for the candidate.
// 'other'  = MangaDex lists a different AniList ID, so it is probably another work (flagged, never auto-linked).
// 'none'   = MangaDex lists no AniList ID, so only a person can decide.
export function idStatus(candidate, anilistId, key = 'anilistId') {
  const theirs = candidate?.[key] == null ? '' : String(candidate[key]);
  if (!isAniListNumericId(theirs)) return 'none';
  return theirs === String(anilistId) ? 'exact' : 'other';
}

export function annotateCandidates(candidates, anilistId, key = 'anilistId') {
  return candidates.map(candidate => ({ ...candidate, idStatus: idStatus(candidate, anilistId, key) }));
}

const RANK = { exact: 0, none: 1, other: 2 };
// Stable order: exact ID matches first, then unknown, then those tied to another AniList entry.
export function rankCandidates(annotated) {
  return annotated.map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => (RANK[a.candidate.idStatus] - RANK[b.candidate.idStatus]) || (a.index - b.index))
    .map(row => row.candidate);
}

function mergeUnique(into, items) {
  for (const candidate of items) {
    if (!candidate?.externalId || !isMangaDexId(candidate.externalId)) continue;
    if (into.some(existing => existing.externalId === candidate.externalId)) continue;
    into.push(candidate);
  }
}

// Looks for an exact AniList-ID match, trying each title until one is found.
// Returns { status: 'exact', candidate } when exactly one candidate carries this AniList ID,
// otherwise { status: 'candidates', candidates, queries } for the picker (possibly empty).
export async function findMangaDexMatch(item, { search, filter = () => true } = {}) {
  if (!isLinkableTrackerItem(item)) throw new TypeError('Only AniList-only or MyAnimeList-only titles can be linked.');
  if (typeof search !== 'function') throw new TypeError('A search function is required.');
  const anilistId = String(item.externalId);
  const idKey = trackerIdKey(item);
  const queries = searchQueriesFor(item);
  const pool = [];
  const tried = [];
  let failures = 0;
  let lastError = null;
  for (const query of queries) {
    let found = [];
    try {
      found = (await search(query)) || [];
      tried.push(query);
    } catch (error) {
      failures += 1;
      lastError = error;
      continue;
    }
    mergeUnique(pool, found.filter(filter));
    const exact = pool.filter(candidate => idStatus(candidate, anilistId, idKey) === 'exact');
    if (exact.length === 1) return { status: 'exact', candidate: exact[0], queries: tried };
    if (exact.length > 1) break; // ambiguous exact matches are shown to the person instead of picking one
  }
  if (failures && !tried.length) throw lastError;
  const ranked = rankCandidates(annotateCandidates(pool, anilistId, idKey)).slice(0, MAX_CANDIDATES);
  return { status: 'candidates', candidates: ranked, queries: tried, partialFailure: failures > 0 };
}

// A manual search from the picker. Still never links anything by itself.
export async function searchCandidates(item, query, { search, filter = () => true } = {}) {
  const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (text.length < 2) return { candidates: [], query: text };
  const found = ((await search(text)) || []).filter(filter);
  const pool = [];
  mergeUnique(pool, found);
  const ranked = rankCandidates(annotateCandidates(pool, item?.externalId, trackerIdKey(item))).slice(0, MAX_CANDIDATES);
  return { candidates: ranked, query: text };
}

// The stored link. Metadata from MangaDex is kept only as a snapshot to fill blanks.
export function buildLinkRow(item, candidate, kind, now = new Date().toISOString()) {
  if (!isLinkableTrackerItem(item)) throw new TypeError('Only AniList-only or MyAnimeList-only titles can be linked.');
  if (!isMangaDexId(candidate?.externalId)) throw new TypeError('That is not a MangaDex title ID.');
  if (!['anilist-id', 'mal-id', 'user-selected'].includes(kind)) throw new TypeError('Unknown link kind.');
  const externalId = String(candidate.externalId).toLowerCase();
  return {
    id: linkRowId(item.id),
    linkRole: LINK_ROLE,
    contentItemId: item.id,
    sourceId: 'mangadex',
    externalId,
    sourceUrl: `https://mangadex.org/title/${externalId}`,
    sourceTitle: String(candidate.title || '').slice(0, 300),
    language: null,
    availabilityStatus: 'available',
    lastCheckedAt: now,
    linkKind: kind,
    ...(item.sourceId === 'mal' ? { linkedMalId: String(item.externalId) } : { linkedAnilistId: String(item.externalId) }),
    linkedAt: now,
    fallback: {
      description: String(candidate.description || '').slice(0, 4000),
      coverUrl: candidate.coverUrl || null,
      authors: Array.isArray(candidate.authors) ? candidate.authors.slice(0, 10) : [],
      tags: Array.isArray(candidate.tags) ? candidate.tags.slice(0, 12) : []
    }
  };
}

export const isLinkRow = row => Boolean(row) && row.linkRole === LINK_ROLE && isMangaDexId(row.externalId);

// Which MangaDex ID provides the chapters for this item? Native MangaDex titles use their own ID.
export function chapterSourceId(item, linkRow = null) {
  if (item?.sourceId === 'mangadex' && isMangaDexId(item.externalId)) return String(item.externalId);
  if (isLinkRow(linkRow) && linkRow.contentItemId === item?.id) return linkRow.externalId;
  return null;
}

// AniList stays the primary record. MangaDex fills only what AniList left empty. Returns a new object.
export function withFallbackMetadata(item, linkRow) {
  if (!item || !isLinkRow(linkRow) || linkRow.contentItemId !== item.id) return item;
  const fallback = linkRow.fallback || {};
  const merged = { ...item };
  const usedFallback = [];
  if (!String(item.description || '').trim() && fallback.description) { merged.description = fallback.description; usedFallback.push('description'); }
  if (!item.coverUrl && fallback.coverUrl) { merged.coverUrl = fallback.coverUrl; usedFallback.push('cover'); }
  if (!(item.authors || []).length && (fallback.authors || []).length) { merged.authors = fallback.authors; usedFallback.push('authors'); }
  if (!(item.tags || []).length && (fallback.tags || []).length) { merged.tags = fallback.tags; usedFallback.push('tags'); }
  Object.defineProperty(merged, 'usedFallback', { value: usedFallback, enumerable: false });
  return merged;
}
