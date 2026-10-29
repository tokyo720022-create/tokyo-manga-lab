// Pure helpers: translate between MyAnimeList data and this app's vocabulary.
import { safeCoverUrl } from '../../shared/covers.js';
import { MAL_TITLE_URL } from './mal-config.js';

const REMOTE_TO_LOCAL = Object.freeze({ reading: 'reading', plan_to_read: 'planned', completed: 'completed', on_hold: 'paused', dropped: 'dropped' });
const LOCAL_TO_REMOTE = Object.freeze({ reading: 'reading', planned: 'plan_to_read', completed: 'completed', paused: 'on_hold', dropped: 'dropped' });

export const toLocalStatus = remote => REMOTE_TO_LOCAL[remote] || null;
export const toRemoteStatus = local => LOCAL_TO_REMOTE[local] || null;

// The tracking panel shares one vocabulary between AniList and MyAnimeList (the AniList words). These two functions
// convert at the edge, so the rest of the tracking code does not care which service it is talking to.
const TRACK_TO_MAL = Object.freeze({ CURRENT: 'reading', REPEATING: 'reading', PLANNING: 'plan_to_read', COMPLETED: 'completed', PAUSED: 'on_hold', DROPPED: 'dropped' });
const MAL_TO_TRACK = Object.freeze({ reading: 'CURRENT', plan_to_read: 'PLANNING', completed: 'COMPLETED', on_hold: 'PAUSED', dropped: 'DROPPED' });
export const trackToMalStatus = status => TRACK_TO_MAL[status] || null;
export const malToTrackStatus = (status, isRereading = false) => (status === 'reading' && isRereading ? 'REPEATING' : MAL_TO_TRACK[status] || null);

const dateText = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null);
const year = value => { const match = /^(\d{4})/.exec(String(value || '')); return match ? Number(match[1]) : null; };
const coverOf = node => safeCoverUrl(node?.main_picture?.large || node?.main_picture?.medium);

// MyAnimeList list_status -> the entry shape the tracking code uses (progress, score 0-100, text dates).
export function entryFromListStatus(listStatus, node = null) {
  if (!listStatus || !toLocalStatus(listStatus.status)) return null;
  return {
    status: malToTrackStatus(listStatus.status, Boolean(listStatus.is_rereading)),
    progress: Number(listStatus.num_chapters_read) || 0,
    volumes: Number(listStatus.num_volumes_read) || 0,
    score: (Number(listStatus.score) || 0) * 10,
    startedAt: dateText(listStatus.start_date),
    completedAt: dateText(listStatus.finish_date),
    updatedAtMs: Date.parse(listStatus.updated_at || '') || 0,
    totalChapters: Number(node?.num_chapters) || 0
  };
}

export function normalizeRemoteEntry(row) {
  const node = row?.node;
  const list = row?.list_status;
  const status = toLocalStatus(list?.status);
  if (!node?.id || !status) return null;
  const alt = node.alternative_titles || {};
  const title = node.title || alt.en || 'Untitled';
  const alternateTitles = [alt.en, alt.ja, ...(Array.isArray(alt.synonyms) ? alt.synonyms : [])].filter(text => text && text !== title).slice(0, 6);
  const genres = Array.isArray(node.genres) ? node.genres.map(genre => genre?.name).filter(Boolean) : [];
  const mediaId = String(node.id);
  return {
    mediaId,
    status,
    remoteStatus: list.status,
    progress: Number(list.num_chapters_read) || 0,
    updatedAtMs: Date.parse(list.updated_at || '') || 0,
    isAdult: Boolean(node.nsfw) && node.nsfw !== 'white',
    entry: entryFromListStatus(list, node),
    item: {
      title, alternateTitles, description: String(node.synopsis || ''), coverUrl: coverOf(node), genres, tags: genres,
      releaseYear: year(node.start_date), contentType: 'manga', contentRating: 'unknown',
      sourceId: 'mal', externalId: mediaId, sourceUrl: MAL_TITLE_URL(mediaId)
    }
  };
}

// A search result or title record -> what the "Find this title" list shows (same shape as the AniList one).
export function normalizeSearchNode(node) {
  if (!node?.id) return null;
  const alt = node.alternative_titles || {};
  return {
    id: String(node.id),
    title: { english: alt.en || node.title || '', romaji: node.title || '', native: alt.ja || '' },
    format: node.media_type || '',
    startDate: { year: year(node.start_date) },
    chapters: Number(node.num_chapters) || 0,
    coverImage: { medium: coverOf(node) },
    isAdult: Boolean(node.nsfw) && node.nsfw !== 'white'
  };
}

// The fields the tracking patch (AniList vocabulary) maps to on MyAnimeList. Score is 0-100 in the patch, 0-10 here.
export function patchToMalBody(patch = {}) {
  const body = {};
  if (patch.status !== undefined) {
    body.status = trackToMalStatus(patch.status);
    body.is_rereading = patch.status === 'REPEATING';
  }
  if (patch.progress !== undefined) body.num_chapters_read = patch.progress;
  if (patch.score !== undefined) body.score = Math.min(10, Math.max(0, Math.round(Number(patch.score) / 10)));
  if (patch.startedAt !== undefined) body.start_date = patch.startedAt || '';
  if (patch.completedAt !== undefined) body.finish_date = patch.completedAt || '';
  return body;
}

// Chapters, score and dates that sync saves with a status change need nothing special: the status alone is enough.
export const libraryStatusBody = local => {
  const status = toRemoteStatus(local);
  return status ? { status, is_rereading: false } : null;
};
