import { ANILIST_API_URL, LIST_CHUNK_SIZE, MAX_LIST_CHUNKS } from './anilist-config.js';
import { withRetry } from '../../shared/retry.js';

export class AniListError extends Error {
  constructor(message, { status = 0, code = 'ANILIST_ERROR', retryAfter = 0 } = {}) {
    super(message);
    this.name = 'AniListError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const VIEWER_QUERY = `query { Viewer { id name siteUrl avatar { medium } } }`;

const PROFILE_QUERY = `query { Viewer { id name siteUrl about bannerImage avatar { large medium }
  statistics { anime { count episodesWatched meanScore } manga { count chaptersRead volumesRead meanScore } } } }`;

const SOCIAL_QUERY = `query ($userId: Int!) {
  followers: Page(page: 1, perPage: 1) { pageInfo { total } followers(userId: $userId) { id } }
  following: Page(page: 1, perPage: 1) { pageInfo { total } following(userId: $userId) { id } }
}`;

const LIST_QUERY = `query ($userId: Int, $chunk: Int, $perChunk: Int) {
  MediaListCollection(userId: $userId, type: MANGA, chunk: $chunk, perChunk: $perChunk, forceSingleCompletedList: true) {
    hasNextChunk
    lists { entries {
      id mediaId status progress updatedAt
      media { id siteUrl isAdult genres startDate { year } title { romaji english native } coverImage { large } description(asHtml: false) externalLinks { site url } }
    } }
  }
}`;

const ENTRY_FIELDS = `id mediaId status progress score(format: POINT_100) startedAt { year month day } completedAt { year month day } updatedAt`;

const SAVE_MUTATION = `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $scoreRaw: Int, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, scoreRaw: $scoreRaw, startedAt: $startedAt, completedAt: $completedAt) { ${ENTRY_FIELDS} }
}`;

const MEDIA_QUERY = `query ($id: Int) {
  Media(id: $id, type: MANGA) {
    id chapters status isAdult siteUrl title { romaji english native } coverImage { medium }
    mediaListEntry { ${ENTRY_FIELDS} }
  }
}`;

const SEARCH_QUERY = `query ($search: String, $isAdult: Boolean) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: MANGA, isAdult: $isAdult, sort: SEARCH_MATCH) {
      id chapters isAdult format startDate { year } title { romaji english native } coverImage { medium }
    }
  }
}`;

export function createAniListClient({ token, fetchImpl = (...args) => fetch(...args), apiUrl = ANILIST_API_URL, timeoutMs = 25000, retryDelays, sleep } = {}) {
  if (!token) throw new AniListError('Not signed in to AniList.', { code: 'UNAUTHORIZED' });

  // Every AniList call (reads and the idempotent "set this entry" save) retries quietly on connection drops, 5xx and short rate limits.
  const request = (query, variables = {}) => withRetry(() => requestOnce(query, variables), { delays: retryDelays, sleep });

  async function requestOnce(query, variables = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new AniListError('AniList took too long to respond.', { code: 'TIMEOUT' });
      throw new AniListError('Could not reach AniList. Check your connection.', { code: 'NETWORK_ERROR' });
    } finally { clearTimeout(timer); }

    if (response.status >= 500) {
      throw new AniListError('AniList is not available right now. It may be down for maintenance. Nothing was lost; try again later.', { status: response.status, code: 'UNAVAILABLE' });
    }
    if (response.status === 429) {
      const wait = Number(response.headers?.get?.('Retry-After')) || 60;
      throw new AniListError(`AniList is rate limiting requests. Try again in ${wait} seconds.`, { status: 429, code: 'RATE_LIMITED', retryAfter: wait });
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* handled below */ }
    const first = payload?.errors?.[0];
    const status = response.status === 200 ? Number(first?.status) || 0 : response.status;
    if (status === 401 || /invalid token/i.test(first?.message || '')) throw new AniListError('AniList sign-in expired or was revoked. Connect again.', { status: 401, code: 'UNAUTHORIZED' });
    if (!response.ok || first) throw new AniListError(first?.message || `AniList returned HTTP ${response.status}.`, { status: status || response.status, code: 'GRAPHQL' });
    if (!payload?.data) throw new AniListError('AniList returned an unreadable response.', { code: 'INVALID_RESPONSE' });
    return payload.data;
  }

  return {
    async viewer() {
      const viewer = (await request(VIEWER_QUERY)).Viewer;
      if (!viewer?.id) throw new AniListError('AniList did not return your account.', { code: 'INVALID_RESPONSE' });
      return { id: viewer.id, name: viewer.name, siteUrl: viewer.siteUrl || '', avatarUrl: viewer.avatar?.medium || '' };
    },
    // Banner, avatar, bio and counts for the Profile screen.
    async profile() {
      const viewer = (await request(PROFILE_QUERY)).Viewer;
      if (!viewer?.id) throw new AniListError('AniList did not return your profile.', { code: 'INVALID_RESPONSE' });
      return viewer;
    },
    // Follower and following totals. Best effort: the Profile still works without them.
    async socialCounts(userId) {
      const data = await request(SOCIAL_QUERY, { userId: Number(userId) });
      return { followers: data.followers?.pageInfo?.total, following: data.following?.pageInfo?.total };
    },
    // Returns every manga entry once, even if it appears in several custom lists.
    async mangaList(userId) {
      const byMedia = new Map();
      for (let chunk = 1; chunk <= MAX_LIST_CHUNKS; chunk += 1) {
        const collection = (await request(LIST_QUERY, { userId, chunk, perChunk: LIST_CHUNK_SIZE })).MediaListCollection;
        for (const list of collection?.lists || []) for (const entry of list?.entries || []) if (entry?.mediaId != null && !byMedia.has(entry.mediaId)) byMedia.set(entry.mediaId, entry);
        if (!collection?.hasNextChunk) break;
      }
      return [...byMedia.values()];
    },
    // Saves only the fields given. Leaving a field out keeps its value on AniList.
    async saveEntry({ mediaId, ...fields }) {
      const variables = { mediaId: Number(mediaId) };
      for (const key of ['status', 'progress', 'scoreRaw', 'startedAt', 'completedAt']) if (fields[key] !== undefined) variables[key] = fields[key];
      const saved = (await request(SAVE_MUTATION, variables)).SaveMediaListEntry;
      if (!saved?.id) throw new AniListError('AniList did not confirm the change.', { code: 'INVALID_RESPONSE' });
      return saved;
    },
    // One title with the signed-in person's own list entry (null when it is not on their list).
    async mediaEntry(mediaId) {
      const media = (await request(MEDIA_QUERY, { id: Number(mediaId) })).Media;
      if (!media?.id) throw new AniListError('AniList does not know that title.', { code: 'NOT_FOUND' });
      return media;
    },
    // A title search for the person to choose from. Adult titles only when asked for.
    async searchManga(query, { allowAdult = false } = {}) {
      const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (text.length < 2) return [];
      const page = (await request(SEARCH_QUERY, { search: text, isAdult: allowAdult ? undefined : false })).Page;
      return page?.media || [];
    }
  };
}
