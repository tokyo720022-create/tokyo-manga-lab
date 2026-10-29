// Tracking a title on MyAnimeList: the same job and the same function names as tracking/tracking-service.js (AniList),
// so the Tracking panel can use either one.
import { deleteRecord, getAllRecords, putRecord } from '../../data/database.js';
import { cleanPatch, describePatch } from '../tracking/tracking.js';
import { MAL_TITLE_URL } from './mal-config.js';
import { entryFromListStatus, normalizeSearchNode } from './mal-mapper.js';
import { activeClient, describeAccount, flushOutbox, loadMappings, queueTrackingPatch, trackingRowFromEntry } from './mal-sync.js';
import { deleteTracking, getAccount, getOutbox, getTracking, putTracking, syncLinkId } from './mal-store.js';

const isMalNumeric = value => /^\d{1,9}$/.test(String(value ?? ''));

// Which MyAnimeList title is this? Exact matches only: the title is a MyAnimeList title itself, a link we already
// stored (from sync or chosen by the person), or the MyAnimeList id MangaDex lists for it. Names are never guessed.
export async function resolveMediaId(item) {
  if (!item) return null;
  if (item.sourceId === 'mal' && isMalNumeric(item.externalId)) return String(item.externalId);
  const { mediaByContent } = await loadMappings();
  if (mediaByContent.has(item.id)) return mediaByContent.get(item.id);
  if (isMalNumeric(item.malId)) return String(item.malId);
  return null;
}

export async function trackingStatus() { return describeAccount(await getAccount()); }

export async function getTrackingState(item) {
  const status = await trackingStatus();
  if (!status.connected) return { connected: false, mediaId: null, row: null, pending: false };
  const mediaId = await resolveMediaId(item);
  const row = mediaId ? await getTracking(item.id) : null;
  const pending = mediaId ? (await getOutbox()).some(entry => entry.id === syncLinkId(mediaId)) : false;
  return { connected: true, mediaId, row: row && String(row.mediaId) === String(mediaId) ? row : null, pending };
}

// Reads the person's entry from MyAnimeList and keeps a copy. Skipped while changes for the title are still waiting.
export async function pullTracking(item, { fetchImpl } = {}) {
  const state = await getTrackingState(item);
  if (!state.connected || !state.mediaId || state.pending) return state;
  const { account, client } = await activeClient(fetchImpl);
  const node = await client.mediaEntry(state.mediaId);
  const entry = entryFromListStatus(node.my_list_status, node);
  const row = trackingRowFromEntry({ mediaId: state.mediaId, contentItemId: item.id, userId: account.viewer.id, entry, node, previous: state.row });
  await putTracking(row);
  return { ...state, row };
}

// Results come back in the shape the "Find this title" list already shows.
export async function searchTitles(query, { fetchImpl } = {}) {
  const { client } = await activeClient(fetchImpl);
  return (await client.searchManga(query)).map(normalizeSearchNode).filter(Boolean);
}

// The person picked a MyAnimeList title for this one. Stored as the same kind of record the library sync already uses.
export async function linkTitle(item, media) {
  if (!item || item.sourceId === 'mal') throw new TypeError('This title is already a MyAnimeList title.');
  if (!isMalNumeric(media?.id)) throw new TypeError('That is not a MyAnimeList title.');
  await unlinkTitle(item);
  await putRecord('sourceEntries', {
    id: `mal:${media.id}`, contentItemId: item.id, sourceId: 'mal', externalId: String(media.id),
    sourceUrl: MAL_TITLE_URL(media.id), sourceTitle: media.title?.english || media.title?.romaji || media.title?.native || '',
    language: null, availabilityStatus: 'available', lastCheckedAt: new Date().toISOString(), linkKind: 'user-selected'
  });
  return String(media.id);
}

export async function unlinkTitle(item) {
  if (!item || item.sourceId === 'mal') return false;
  let removed = false;
  for (const row of await getAllRecords('sourceEntries')) {
    if (row.contentItemId === item.id && row.sourceId === 'mal' && !row.linkRole) { await deleteRecord('sourceEntries', row.id); removed = true; }
  }
  const tracking = await getTracking(item.id);
  if (tracking) await deleteTracking(tracking.mediaId);
  return removed;
}

// Saves the person's edits: shown at once on this device, then sent to MyAnimeList straight away.
export async function saveTracking(item, rawPatch, { fetchImpl } = {}) {
  const mediaId = await resolveMediaId(item);
  if (!mediaId) throw new Error('This title is not linked to MyAnimeList yet.');
  const patch = cleanPatch(rawPatch);
  const current = await getTracking(item.id);
  if (!current?.onList && patch.status === undefined) patch.status = (patch.progress || 0) > 0 ? 'CURRENT' : 'PLANNING';
  const base = { mediaId, contentItemId: item.id, status: null, progress: 0, score: 0, startedAt: null, completedAt: null, totalChapters: 0, title: item.title || '', entryId: null, siteUrl: MAL_TITLE_URL(mediaId) };
  const account = await getAccount();
  await putTracking({ ...(current || base), ...patch, onList: true, userId: account?.viewer?.id });
  await queueTrackingPatch({ mediaId, contentItemId: item.id, patch });
  const result = await flushOutbox({ fetchImpl, sleepMs: 0 });
  const stillWaiting = (await getOutbox()).some(entry => entry.id === syncLinkId(mediaId));
  return { outcome: stillWaiting ? 'queued' : 'sent', mediaId, patch, summary: describePatch(patch), flushed: result.sent };
}

// A chapter was read (or marked read). The outbox row resolves it against MyAnimeList's live entry when it is sent.
export async function trackChapterRead(item, chapterNumber, { fetchImpl } = {}) {
  const mediaId = await resolveMediaId(item);
  if (!mediaId) return { outcome: 'skipped', reason: 'not-linked' };
  const status = await trackingStatus();
  if (!status.connected) return { outcome: 'skipped', reason: 'not-connected' };
  const number = Number(chapterNumber);
  if (!Number.isFinite(number) || number < 1) return { outcome: 'skipped', reason: 'no-number' };
  await queueTrackingPatch({ mediaId, contentItemId: item.id, autoReadChapter: Math.floor(number) });
  const result = await flushOutbox({ fetchImpl, sleepMs: 0 });
  const stillWaiting = (await getOutbox()).some(entry => entry.id === syncLinkId(mediaId));
  const applied = result.applied.find(entry => entry.mediaId === String(mediaId));
  return { outcome: stillWaiting ? 'queued' : applied ? 'sent' : 'unchanged', mediaId, summary: applied ? describePatch(applied.patch) : '' };
}
