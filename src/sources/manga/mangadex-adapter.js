import { apiClient } from '../../services/api-client.js';

function slug(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeStatus(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'ongoing' || status === 'releasing') return 'releasing';
  if (status === 'completed') return 'completed';
  if (status === 'hiatus') return 'hiatus';
  return 'unknown';
}

function normalizeManga(raw) {
  const externalId = String(raw.externalId || raw.id || '');
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [];
  const authors = Array.isArray(raw.authors) ? raw.authors.map(String).filter(Boolean) : [];
  const artists = Array.isArray(raw.artists) ? raw.artists.map(String).filter(Boolean) : [];
  return {
    id: `mangadex:${externalId}`,
    sourceId: 'mangadex',
    externalId,
    contentType: 'manga',
    title: String(raw.title || 'Untitled manga'),
    alternateTitles: Array.isArray(raw.alternateTitles) ? raw.alternateTitles : [],
    description: String(raw.description || ''),
    coverUrl: raw.coverUrl || null,
    authors,
    artists,
    genres: Array.isArray(raw.genres) ? raw.genres.map(slug) : tags.map(slug),
    tags: tags.slice(0, 12),
    publicationStatus: normalizeStatus(raw.status || raw.publicationStatus),
    releaseYear: raw.releaseYear ?? raw.year ?? null,
    language: raw.language || raw.originalLanguage || null,
    sourceUrl: raw.sourceUrl || raw.mangaDexUrl || `https://mangadex.org/title/${encodeURIComponent(externalId)}`,
    contentRating: raw.contentRating || 'unknown',
    lastChapter: raw.lastChapter ? String(raw.lastChapter).slice(0, 12) : null,
    latestChapter: raw.latestChapter?.number ? { number: String(raw.latestChapter.number).slice(0, 12), publishedAt: raw.latestChapter.publishedAt || null } : null,
    anilistId: /^\d{1,9}$/.test(String(raw.anilistId ?? '')) ? String(raw.anilistId) : null,
    malId: /^\d{1,9}$/.test(String(raw.malId ?? '')) ? String(raw.malId) : null
  };
}

export const mangaDexAdapter = Object.freeze({
  id: 'mangadex',
  label: 'MangaDex',
  contentTypes: ['manga'],
  capabilities: { search: true, titleDetails: true, chapters: true, chapterContent: true, offlineDownloads: true },
  async search(query = '', page = 1, { signal, genres = [], status = '', sort = '' } = {}) {
    const payload = await apiClient.mangaSearch({ query, page, genres, status, sort, signal });
    if (!payload || !Array.isArray(payload.data)) throw new Error('MangaDex returned data in an unexpected format.');
    const items = payload.data.map(normalizeManga).filter(item => item.externalId);
    const total = Math.max(0, Number(payload.total) || 0);
    const limit = Math.max(1, Number(payload.limit) || 24);
    const pageNumber = Math.max(1, Number(payload.page) || Number(page) || 1);
    return { items, pagination: { page: pageNumber, limit, total, hasNext: pageNumber * limit < total }, source: 'mangadex' };
  },
  // The newest chapters, one entry per title (each carries `latestChapter`). 100 chapters are read per page.
  async latest(page = 1, { signal } = {}) {
    const payload = await apiClient.mangaLatest({ page, signal });
    if (!Array.isArray(payload?.data) || !payload?.pagination) throw new Error('MangaDex returned the latest chapters in an unexpected format.');
    const pageNumber = Math.max(1, Number(payload.pagination.page) || Number(page) || 1);
    return { items: payload.data.map(normalizeManga).filter(item => item.externalId), pagination: { page: pageNumber, limit: Math.max(1, Number(payload.pagination.limit) || 100), total: Math.max(0, Number(payload.pagination.total) || 0), hasNext: Boolean(payload.pagination.hasNext) }, source: 'mangadex' };
  },
  // Newest chapter id of each title, in one request: Map(externalId -> chapterId | null). Returns null when the Worker is an
  // older deployment without this route, so the caller can fall back to reading chapter lists.
  async latestChapterIds(externalIds, { signal } = {}) {
    try {
      const payload = await apiClient.mangaUpdates(externalIds, { signal });
      if (!Array.isArray(payload?.data)) throw new Error('MangaDex returned the update check in an unexpected format.');
      return new Map(payload.data.filter(row => row && typeof row.externalId === 'string').map(row => [row.externalId, typeof row.latestChapterId === 'string' ? row.latestChapterId : null]));
    } catch (error) {
      if (error?.code === 'NOT_FOUND' || error?.status === 404) return null;
      throw error;
    }
  },
  // The newest chapters of one title (20), for the update check.
  async recentChapters(externalId, { language = 'en', signal } = {}) {
    return (await this.chapters(externalId, { page: 1, language, pageSize: 20, signal })).items;
  },
  // The genre list used by the Discover filter: [{id, name, group}].
  async tags({ signal } = {}) {
    const payload = await apiClient.mangaTags({ signal });
    if (!Array.isArray(payload?.data)) throw new Error('MangaDex returned the genre list in an unexpected format.');
    return payload.data.filter(tag => tag && typeof tag.id === 'string' && typeof tag.name === 'string' && tag.name)
      .map(tag => ({ id: tag.id, name: tag.name.slice(0, 40), group: String(tag.group || 'other') }));
  },
  async details(externalId, { signal } = {}) {
    const payload = await apiClient.mangaDetails(externalId, { signal });
    if (!payload?.data || payload.data.sourceId !== 'mangadex') throw new Error('MangaDex returned invalid title details.');
    return normalizeManga(payload.data);
  },
  // Returns where the page images live (never the images themselves). They load straight from MangaDex.
  async chapterPages(chapterExternalId, { signal } = {}) {
    return apiClient.chapterPages(chapterExternalId, { signal });
  },
  async chapters(externalId, { page = 1, language = 'en', pageSize, signal } = {}) {
    const payload = await apiClient.mangaChapters(externalId, { page, language, limit: pageSize, signal });
    if (!Array.isArray(payload?.data) || !payload?.pagination) throw new Error('MangaDex returned an invalid chapter list.');
    const limit = Math.max(1, Number(payload.pagination.limit) || 24);
    const pageNumber = Math.max(1, Number(payload.pagination.page) || Number(page) || 1);
    const total = Math.max(0, Number(payload.pagination.total) || payload.data.length);
    return {
      items: payload.data.map(chapter => ({
        id: `mangadex-chapter:${String(chapter.externalId || '')}`,
        sourceId: 'mangadex',
        externalId: String(chapter.externalId || ''),
        mangaExternalId: String(chapter.mangaExternalId || externalId),
        chapterNumber: chapter.chapterNumber ?? null,
        volumeNumber: chapter.volumeNumber ?? null,
        title: chapter.title || '',
        language: chapter.language || language,
        pages: Math.max(0, Number(chapter.pages) || 0),
        publishedAt: chapter.publishedAt || null,
        scanlationGroups: Array.isArray(chapter.scanlationGroups) ? chapter.scanlationGroups : [],
        sourceUrl: chapter.sourceUrl || `https://mangadex.org/chapter/${encodeURIComponent(String(chapter.externalId || ''))}`
      })).filter(chapter => chapter.externalId),
      pagination: payload.pagination || { page: pageNumber, limit, total, hasNext: pageNumber * limit < total },
      source: 'mangadex'
    };
  },
  // Loads a title's chapter list page after page (100 at a time when the Worker allows it), so the app can sort and
  // filter the whole list. Stops after `maxPages` and says whether anything is left (`nextPage`).
  async allChapters(externalId, { language = 'en', signal, startPage = 1, maxPages = 12, onPage } = {}) {
    const items = [];
    let page = startPage;
    let total = 0;
    for (let loaded = 0; loaded < maxPages; loaded += 1) {
      const result = await this.chapters(externalId, { page, language, pageSize: 100, signal });
      items.push(...result.items);
      total = Math.max(total, Number(result.pagination?.total) || 0);
      if (onPage) onPage({ items: [...items], total });
      if (!result.pagination?.hasNext || !result.items.length) return { items, total: Math.max(total, items.length), nextPage: null };
      page += 1;
    }
    return { items, total, nextPage: page };
  }
});
