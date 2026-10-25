import { AppController } from './core/app-controller.js';
import { bindNavigation, getCurrentRoute, getRouteParam } from './core/router.js';
import { getAllRecords, openDatabase } from './data/database.js';
import {
  addItemToCollection, addToLibrary, cacheCatalogueItems, createCollection,
  exportBackup, getCatalogueItems, getCollections, getLibraryItems,
  getCollectionLibraryItems, importBackup, removeFromLibrary, setLibraryStatus, toggleFavorite
} from './data/repositories/library-repository.js';
import { getMangaDexLink, findOtherItemsForMangaDex, removeMangaDexLink, saveMangaDexLink } from './data/repositories/link-repository.js';
import { chapterSourceId, findMangaDexMatch, isLinkableAniListItem, searchCandidates, searchQueriesFor, withFallbackMetadata } from './features/linking/mangadex-link.js';
import { saveBackupFile } from './features/backup/backup-export.js';
import { sourceRegistry } from './sources/source-registry.js';
import { adultActive, configureAdult } from './services/api-client.js';
import { isNativeApp as runningInApp } from './features/anilist/anilist-native.js';
import { loadSettings, saveSetting } from './features/settings/settings-service.js';
import { migrateLegacyLocalStorage } from './features/settings/legacy-migration.js';
import { getDashboardStatistics } from './features/statistics/statistics-service.js';
import { escapeHtml, formatDate, slug, truncate } from './shared/utils.js';
import { hydrateIcons, icon } from './shared/icons.js';
import { APP_VERSION } from './shared/app-info.js';
import { coverVariants, retryUrl, safeCoverUrl } from './shared/covers.js';
import { CHAPTER_LANGUAGES, SETTINGS_CATEGORIES, SETTINGS_SECTIONS, findCategory } from './features/settings/settings-schema.js';
import { PROFILE_GROUPS, plannedProfileRows } from './features/profile/profile-sections.js';
import { featuresFor } from './features/feature-registry.js';
import { mountReader, renderReaderShell } from './features/reader/reader-view.js';
import { isChapterId, normalizePagesPayload } from './features/reader/reader-pages.js';
import { resetTips } from './features/reader/reader-features.js';
import { chaptersBefore, filterChapters, normalizeChapterView, scanlatorsOf, sortChapters } from './features/chapters/chapter-view.js';
import { renderChapterOptions, renderChapterRow, renderChapterToolbar } from './features/chapters/chapter-ui.js';
import { listBookmarkedChapterIds, listChapterPages, listReadChapterIds, setBookmark, setChaptersRead } from './data/repositories/chapter-marks-repository.js';
import { renderTrackingPanel } from './features/tracking/tracking-ui.js';
import { getTrackingState, linkTitle, pullTracking, saveTracking, searchTitles, trackChapterRead, unlinkTitle } from './features/tracking/tracking-service.js';
import { progressNumber, scoreToRaw, trackStatusLabel } from './features/tracking/tracking.js';
import { ANILIST_TOKEN_DEFAULT_TTL_SECONDS, AUTH_ATTEMPT_MAX_AGE_MS, DEFAULT_ANILIST_CLIENT_ID } from './features/anilist/anilist-config.js';
import { buildAuthorizeUrl, looksLikeToken, parseAuthRedirect } from './features/anilist/anilist-auth.js';
import { ANILIST_APPS_URL, ANILIST_REGISTER_URL, loginAvailability, resolveClientId } from './features/anilist/anilist-login.js';
import { clearAuthAttempt, getAccount, getAuthAttempt, markAuthAttempt } from './features/anilist/anilist-store.js';
import { closeAuthPage, isNativeApp, listenForAppLinks, openAuthPage } from './features/anilist/anilist-native.js';
import { connectWithToken, describeAccount, describeSummary, disconnect as disconnectAniList, flushOutbox, notifyLocalChange, refreshProfile, runSync } from './features/anilist/anilist-sync.js';
import { THEMES, findTheme, nextTheme } from './features/theme/themes.js';
import { profileIsStale } from './features/anilist/anilist-profile.js';

const root = document.getElementById('appView');
const state = {
  route: 'home', settings: null, results: [], pagination: { page: 1, limit: 24, total: 0, hasNext: false },
  query: '', page: 1, genre: 'all', searchLoading: true, apiError: '', offlineResults: false,
  library: [], libraryById: new Map(), libraryStatusFilter: 'all', collections: [], selectedCollectionId: '',
  anilist: { account: null, status: { connected: false, expired: false, label: 'Not connected' }, busy: false },
  readerContext: null, readerHandle: null, readerReturnHash: '#library',
  libraryHiddenCount: 0, detailsItemId: null, detailsHistory: false, sheetItemId: null, detailsSequence: 0, chapterSequence: 0, detailsLoading: false, detailsLoadingChapters: false, detailsMetadataError: '', detailsError: '', detailsChapters: [], detailsChapterPage: 1, detailsChapterLanguage: 'en', detailsChapterPagination: { page: 1, limit: 24, total: 0, hasNext: false }, detailsChapterNext: null, detailsChapterTotal: 0, chapterShown: 60, chapterOptionsOpen: false, chapterOptionsTab: 'filter', chapterMenuId: null, chapterScanlator: '', detailsRead: new Set(), detailsBookmarks: new Set(), detailsPages: new Map(), track: null, detailsLink: null, link: { status: 'idle', candidates: [], query: '', message: '', changing: false }, searchSequence: 0, searchTimer: null, searchController: null, lastSearchTime: null
};

const app = new AppController({
  root,
  renderers: {
    home: renderHome,
    discover: renderDiscover,
    library: renderLibrary,
    downloads: renderDownloads,
    profile: renderProfile,
    settings: renderSettings,
    read: renderReader
  },
  afterRender: { read: mountCurrentReader },
  beforeLeave: { read: unmountReader }
});

// ---- Reader -----------------------------------------------------------------------------
const READER_CONTEXT_KEY = 'tml-reader-context';

function renderReader() { return renderReaderShell(); }

function readStoredReaderContext(chapterId) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(READER_CONTEXT_KEY) || 'null');
    return stored && Array.isArray(stored.chapters) && stored.chapters.some(chapter => chapter.id === chapterId) ? stored : null;
  } catch { return null; }
}

function storeReaderContext(context) {
  try { sessionStorage.setItem(READER_CONTEXT_KEY, JSON.stringify(context)); } catch { /* optional convenience only */ }
}

function unmountReader() {
  state.readerHandle?.destroy();
  state.readerHandle = null;
}

function mountCurrentReader() {
  unmountReader();
  const host = document.getElementById('readerRoot');
  const chapterId = getRouteParam();
  if (!host) return;
  if (!isChapterId(chapterId)) {
    host.innerHTML = '<div class="reader-status"><h2>Chapter not found</h2><p>That reader link is not valid.</p><div class="reader-status-actions"><a class="button" href="#library">Back to library</a></div></div>';
    return;
  }
  const context = state.readerContext?.chapters?.some(chapter => chapter.id === chapterId) ? state.readerContext : readStoredReaderContext(chapterId);
  state.readerContext = context;
  state.readerHandle = mountReader(host, {
    chapterId,
    context,
    settings: state.settings,
    loadPages: async (id, { signal } = {}) => {
      const adapter = sourceRegistry.get('mangadex');
      if (!adapter?.chapterPages) throw new Error('This source cannot provide chapter pages.');
      return normalizePagesPayload(await adapter.chapterPages(id, { signal }));
    },
    onClose: closeReader,
    onOpenSettings: () => { window.location.hash = '#settings/reading'; },
    onOpenChapter: id => { window.location.replace(`#read/${id}`); },
    onSetting: async (key, value) => {
      try { await saveSetting(key, value); state.settings = { ...state.settings, [key]: value }; }
      catch (error) { console.warn('Reader setting not saved:', error); }
    }
  });
}

function closeReader() {
  const returnTo = state.readerReturnHash || '#library';
  const itemId = state.readerContext?.contentItemId || null;
  unmountReader();
  window.location.hash = returnTo === '#read' || returnTo.startsWith('#read/') ? '#library' : returnTo;
  // Reopen the title sheet the reader was started from, after the screen behind it has rendered.
  if (itemId) window.setTimeout(() => openDetails(itemId), 80);
}

function startReading(chapterId) {
  if (!isChapterId(chapterId)) return;
  const item = currentDetailsItem();
  const chapters = state.detailsChapters
    .filter(chapter => chapter.externalId && isChapterId(chapter.externalId))
    .map(chapter => {
      const volume = chapter.volumeNumber ? `Vol. ${chapter.volumeNumber} · ` : '';
      const number = chapter.chapterNumber !== null && chapter.chapterNumber !== '' ? `Chapter ${chapter.chapterNumber}` : 'Extra / oneshot';
      return { id: chapter.externalId, number: chapter.chapterNumber ?? null, label: `${volume}${number}${chapter.title ? ` — ${chapter.title}` : ''}`, pages: chapter.pages, groups: chapter.scanlationGroups || [] };
    });
  state.readerContext = { contentItemId: item?.id || null, title: item?.title || 'Reading', chapters };
  storeReaderContext(state.readerContext);
  state.readerReturnHash = window.location.hash && !window.location.hash.startsWith('#read') ? window.location.hash : '#library';
  const hadSheetEntry = state.detailsHistory;
  closeDetails({ leaving: true });
  // Replace the sheet's own history entry, so Back from the reader returns to the page the sheet was opened on.
  if (hadSheetEntry) window.location.replace(`#read/${chapterId}`);
  else window.location.hash = `#read/${chapterId}`;
}

function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function setConnectionStatus(status, label) {
  const el = document.getElementById('connectionStatus');
  el.dataset.state = status;
  el.title = label;
  el.setAttribute('aria-label', label);
  el.innerHTML = `<span class="status-dot"></span><span class="status-text">${escapeHtml(label)}</span>`;
}

// Keeps the status pill honest and brings the catalogue back by itself: while offline it re-checks every 20 seconds
// (only while the app is visible), and straight away when the phone reports it is back online or the app returns to the front.
let reconnectTimer = null;
async function checkConnection() {
  try {
    const { apiClient } = await import('./services/api-client.js');
    await apiClient.health();
    return true;
  } catch { return false; }
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (document.visibilityState === 'hidden') { scheduleReconnect(); return; }
    if (await checkConnection()) return;
    scheduleReconnect();
  }, 20000);
}
function handleApiStatus(status) {
  if (status === 'online') {
    const wasOffline = document.getElementById('connectionStatus')?.dataset.state === 'offline';
    setConnectionStatus('online', 'MangaDex online');
    if (wasOffline) recoverCatalogue();
  } else {
    setConnectionStatus('offline', 'Catalogue offline');
    scheduleReconnect();
  }
}
// After the connection comes back, reload the search that failed so the screen fills in without a manual retry.
function recoverCatalogue() {
  if (state.apiError && ['home', 'discover'].includes(app.currentRoute()) && !state.searchLoading) loadSearch(state.query, state.page);
}

// A cover that fails gets one more try (a changed address, in case the network blinked), then the other known cover
// (for a linked title: the MangaDex/AniList one), and only then the local placeholder.
document.addEventListener('load', event => {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.hasAttribute('data-cover-fallback')) img.removeAttribute('data-cover-loading');
}, true);

document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-cover-fallback') || img.dataset.fallbackDone === '1') return;
  const stage = Number(img.dataset.coverStage || 0);
  if (stage === 0) {
    img.dataset.coverStage = '1';
    img.removeAttribute('srcset');
    try { img.src = retryUrl(img.currentSrc || img.src); return; } catch { /* fall through to the next step */ }
  }
  if (stage <= 1) {
    const alt = safeCoverUrl(img.dataset.coverAlt);
    if (alt && img.dataset.coverAltTried !== '1') {
      img.dataset.coverAltTried = '1';
      img.dataset.coverStage = '2';
      img.src = alt;
      return;
    }
  }
  img.dataset.fallbackDone = '1';
  const title = img.dataset.coverFallback || 'Cover unavailable';
  const fallback = document.createElement('div');
  fallback.className = img.classList.contains('library-cover') ? 'library-cover library-cover-fallback' : 'cover-placeholder';
  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.textContent = Array.from(title)[0] || '漫';
  const label = document.createElement('strong');
  label.textContent = truncate(title, 56);
  const note = document.createElement('small');
  note.textContent = 'Cover unavailable';
  fallback.append(glyph, label, note);
  img.replaceWith(fallback);
}, true);

function titleAuthor(item) {
  return (item.authors || []).join(', ') || 'Unknown creator';
}

function coverMarkup(item, compact = false, altCover = null) {
  const variants = coverVariants(item.coverUrl);
  if (variants) {
    const alt = safeCoverUrl(altCover);
    const altAttr = alt && alt !== variants.src ? ` data-cover-alt="${escapeHtml(alt)}"` : '';
    const sizes = variants.srcset && !compact ? ` srcset="${escapeHtml(variants.srcset)}" sizes="(min-width: 820px) 180px, (min-width: 560px) 30vw, 46vw"` : '';
    return `<img ${compact ? 'class="library-cover"' : ''} loading="lazy" decoding="async" alt="Cover of ${escapeHtml(item.title)}" src="${escapeHtml(variants.src)}"${sizes}${altAttr} data-cover-loading data-cover-fallback="${escapeHtml(item.title)}">`;
  }
  if (compact) return `<div class="library-cover library-cover-fallback">漫</div>`;
  const titleInitial = Array.from(item.title || '漫')[0];
  return `<div class="cover-placeholder" aria-label="Cover placeholder for ${escapeHtml(item.title)}"><span class="glyph">${escapeHtml(titleInitial)}</span><strong>${escapeHtml(truncate(item.title, 56))}</strong><small>${item.sourceId === 'mangadex' ? 'MANGADEX' : 'LOCAL LIBRARY'}</small></div>`;
}

function getLibraryEntry(itemId) {
  return state.libraryById.get(itemId) || null;
}

function renderMangaCard(item) {
  const entry = getLibraryEntry(item.id);
  const saved = Boolean(entry);
  const title = escapeHtml(item.title);
  const id = escapeHtml(item.id);
  const status = entry && entry.personalStatus !== 'planned' ? `<span class="card-status">${escapeHtml(entry.personalStatus)}</span>` : '';
  return `<article class="manga-card" data-content-id="${id}">
    <div class="poster-wrap">
      <button class="poster" type="button" data-action="details" data-id="${id}" aria-label="Open details for ${title}">${coverMarkup(item)}</button>
      <button class="card-save ${saved ? 'saved' : ''}" type="button" data-action="save" data-id="${id}" aria-pressed="${saved}" aria-label="${saved ? 'Remove from library' : 'Add to library'}: ${title}">${icon(saved ? 'bookmarkFill' : 'bookmark')}</button>
      ${status}
    </div>
    <div class="card-body"><h3 class="card-title">${title}</h3><p class="card-meta">${escapeHtml(titleAuthor(item))}</p></div>
  </article>`;
}

// One row in a grouped list. Used by Profile, Settings and the planned-feature lists.
function listRow({ icon: iconName = '', title, description = '', href = '', action = '', attrs = '', planned = false, badge = '', trail = '', external = false }) {
  const tile = iconName ? `<span class="row-icon">${icon(iconName)}</span>` : '';
  const label = badge || (planned ? 'Planned' : '');
  const inner = `${tile}<span class="row-copy"><strong>${escapeHtml(title)}${label ? `<span class="badge-planned">${escapeHtml(label)}</span>` : ''}</strong>${description ? `<small>${escapeHtml(description)}</small>` : ''}</span>${trail ? `<span class="row-trail">${trail}</span>` : ''}`;
  const cls = `row${planned ? ' is-planned' : ''}`;
  if (href) return `<a class="${cls}" href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
  if (action) return `<button class="${cls}" type="button" data-action="${escapeHtml(action)}" ${attrs}>${inner}</button>`;
  return `<div class="${cls}"${planned ? ' aria-disabled="true"' : ''}>${inner}</div>`;
}

function renderRoadmap(screen) {
  const list = featuresFor(screen);
  if (!list.length) return '';
  return `<details class="roadmap"><summary>${icon('sparkle')}<span>Planned for this screen</span>${icon('chevronRight')}</summary><div class="group">${list.map(feature => listRow({ icon: feature.icon, title: feature.title, description: feature.description, planned: true })).join('')}</div></details>`;
}

function renderEmpty(title, message, action = '') {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
}

function renderStats(stats) {
  const cells = [[stats.totalTitles, 'In library'], [stats.reading, 'Reading'], [stats.completed, 'Completed'], [stats.favorites, 'Favourites']];
  return `<div class="stat-strip" role="list">${cells.map(([value, label]) => `<div role="listitem"><strong>${Number(value) || 0}</strong><span>${label}</span></div>`).join('')}</div>`;
}

function searchControls() {
  const genres = [
    ['all', 'All'], ['action', 'Action'], ['adventure', 'Adventure'], ['fantasy', 'Fantasy'],
    ['romance', 'Romance'], ['mystery', 'Mystery'], ['sci-fi', 'Sci-fi'], ['slice-of-life', 'Slice of life']
  ];
  return `<div class="chip-row" role="group" aria-label="Filter results by genre">${genres.map(([id, label]) => `<button class="filter-chip ${state.genre === id ? 'active' : ''}" type="button" data-action="genre-filter" data-genre="${id}" aria-pressed="${state.genre === id}">${label}</button>`).join('')}</div>`;
}

function filteredResults() {
  if (state.genre === 'all') return state.results;
  return state.results.filter(item => (item.genres || []).includes(state.genre) || (item.tags || []).some(tag => slug(tag) === state.genre));
}

function resultsGrid() {
  const items = filteredResults();
  if (state.searchLoading && !state.results.length) return `<div class="empty-state"><span class="spinner"></span><strong style="margin-top:14px">Searching MangaDex…</strong><span>Getting the catalogue ready.</span></div>`;
  if (!items.length && state.offlineResults) return renderEmpty('No cached matches', 'The catalogue is offline and no locally cached titles match this search. Your saved library is still available.', '<button class="button" data-action="retry-search">Retry online search</button>');
  if (!items.length) return renderEmpty('No matching manga', 'Try a shorter search or another tag.', '<button class="button" data-action="clear-search">Clear search</button>');
  return `<div class="content-grid">${items.map(item => renderMangaCard(item)).join('')}</div>`;
}

function paginationMarkup() {
  if (state.offlineResults || state.pagination.total <= state.pagination.limit || !state.results.length) return '';
  const totalPages = Math.max(1, Math.min(20, Math.ceil(state.pagination.total / state.pagination.limit)));
  return `<div class="page-controls"><button class="button" data-action="page-back" ${state.page <= 1 ? 'disabled' : ''}>‹ Previous</button><div class="page-count"><strong>Page ${state.page} of ${totalPages}</strong>${Number(state.pagination.total).toLocaleString()} results</div><button class="button" data-action="page-next" ${!state.pagination.hasNext ? 'disabled' : ''}>Next ›</button></div>`;
}

function renderStatusBanner() {
  if (!state.apiError) return '';
  return `<div class="notice ${state.offlineResults ? '' : 'warning'}" role="status"><strong>${state.offlineResults ? 'Offline catalogue mode.' : 'Catalogue note.'}</strong> ${escapeHtml(state.apiError)} <button class="mini-link" data-action="retry-search">Retry</button></div>`;
}

function homeFreshMarkup() {
  return `<div class="section-head"><h2>From MangaDex</h2><a class="more" href="#discover">See all${icon('chevronRight', 'icon-sm')}</a></div>${freshBlockMarkup()}${renderStatusBanner()}`;
}

function freshBlockMarkup() {
  const fresh = state.results.slice(0, 12);
  return state.searchLoading && !fresh.length
    ? '<div class="empty-state"><span class="spinner"></span><strong>Loading catalogue</strong></div>'
    : fresh.length ? `<div class="rail">${fresh.map(item => renderMangaCard(item)).join('')}</div>` : renderEmpty('Catalogue not loaded', 'Open Discover to try again.');
}

async function renderHome() {
  await refreshLibraryIndex();
  const stats = await getDashboardStatistics();
  const continuing = state.library.filter(row => row.personalStatus === 'reading').slice(0, 12).map(row => row.item);
  const continueBlock = continuing.length
    ? `<div class="rail">${continuing.map(item => renderMangaCard(item)).join('')}</div>`
    : `<div class="shelf-empty">${icon('bookmark')}<p><strong>Nothing in progress</strong>Add a title and mark it as reading to find it here.</p><a class="button-subtle" href="#discover">Discover</a></div>`;
  return `<section>
    <div class="page-head"><div><h1>Home</h1><p>Pick up where you left off.</p></div></div>
    <form class="search-bar" data-form="search"><label class="sr-only" for="homeSearch">Search manga titles</label><input class="field" id="homeSearch" name="query" type="search" autocomplete="off" maxlength="100" placeholder="Search manga" value="${escapeHtml(state.query)}"><button class="button-primary" type="submit">Search</button></form>
    <div class="section-head"><h2>Continue reading</h2><a class="more" href="#library">Library${icon('chevronRight', 'icon-sm')}</a></div>${continueBlock}
    <div id="homeFresh">${homeFreshMarkup()}</div>
    ${renderStats(stats)}
    ${renderRoadmap('home')}
    <p class="footer-note">Tokyo Manga Lab ${escapeHtml(APP_VERSION)} · Tokyo Brotherhood</p>
  </section>`;
}

function discoverResultsMarkup() {
  return `<div class="section-head"><div><h2>${state.query ? `Results for “${escapeHtml(state.query)}”` : 'Latest from MangaDex'}</h2><p>${state.offlineResults ? 'Showing cached titles saved on this device.' : `${Number(state.pagination.total).toLocaleString()} titles found`}</p></div><button class="button button-small" data-action="retry-search">Refresh</button></div>
    ${renderStatusBanner()}${resultsGrid()}${paginationMarkup()}`;
}

async function renderDiscover() {
  await refreshLibraryIndex();
  return `<section>
    <div class="page-head"><div><h1>Discover</h1><p>Search the MangaDex catalogue.</p></div></div>
    <div class="search-panel"><form class="search-bar" data-form="search"><label class="sr-only" for="discoverSearch">Search manga titles</label><input class="field" id="discoverSearch" name="query" type="search" autocomplete="off" maxlength="100" placeholder="Title, series or keyword" value="${escapeHtml(state.query)}"><button class="button-primary" type="submit">Search</button></form>${searchControls()}<p class="search-note">Genre chips filter the results already loaded on this page.</p></div>
    <div id="discoverResults">${discoverResultsMarkup()}</div>
    ${renderRoadmap('discover')}
    <p class="footer-note">Metadata, covers and chapter pages belong to their sources and creators.</p>
  </section>`;
}

async function renderLibrary() {
  await refreshLibraryIndex();
  const syncLinks = new Map((await getAllRecords('syncLinks')).filter(row => row.provider === 'anilist').map(row => [row.contentItemId, row]));
  state.collections = await getCollections();
  let entries = state.library;
  if (state.libraryStatusFilter !== 'all') entries = entries.filter(row => row.personalStatus === state.libraryStatusFilter);
  if (state.selectedCollectionId) {
    const collectionRows = await getCollectionLibraryItems(state.selectedCollectionId);
    const ids = new Set(collectionRows.map(row => row.contentItemId));
    entries = entries.filter(row => ids.has(row.contentItemId));
  }
  const sort = state.settings?.defaultLibrarySort || 'recently-updated';
  if (sort === 'recently-added') entries = [...entries].sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  else if (sort === 'title') entries = [...entries].sort((a, b) => String(a.item.title).localeCompare(String(b.item.title)));
  const statuses = [['all', 'All statuses'], ['reading', 'Reading'], ['planned', 'Planned'], ['completed', 'Completed'], ['paused', 'Paused'], ['dropped', 'Dropped']];
  const collectionChips = `<div class="chip-row" role="group" aria-label="Collections"><button class="collection-chip ${!state.selectedCollectionId ? 'active' : ''}" data-action="select-collection" data-id="">All titles</button>${state.collections.map(c => `<button class="collection-chip ${state.selectedCollectionId === c.id ? 'active' : ''}" data-action="select-collection" data-id="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>`).join('')}</div>`;
  const listMarkup = entries.length ? `<div class="library-list">${entries.map(row => {
    const item = row.item;
    const id = escapeHtml(item.id);
    const options = ['planned', 'reading', 'completed', 'paused', 'dropped'].map(s => `<option value="${s}" ${row.personalStatus === s ? 'selected' : ''}>${s.charAt(0).toUpperCase()}${s.slice(1)}</option>`).join('');
    return `<article class="library-card"><button class="poster-link" type="button" data-action="details" data-id="${id}" aria-label="Open details for ${escapeHtml(item.title)}">${coverMarkup(item, true)}</button><div class="library-info"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(titleAuthor(item))} · Added ${escapeHtml(formatDate(row.addedAt))}</p>${row.isFavorite ? '<span class="pill-label accent">Favourite</span> ' : ''}${syncLinks.has(item.id) ? `<span class="pill-label">AniList${syncLinks.get(item.id).remoteProgress ? ` · ch. ${Number(syncLinks.get(item.id).remoteProgress)}` : ''}</span>` : ''}</div><div class="library-actions"><label class="sr-only" for="status-${id}">Status for ${escapeHtml(item.title)}</label><select class="select-field" id="status-${id}" data-library-status="${id}">${options}</select><button class="button button-small" data-action="favorite" data-id="${id}">${row.isFavorite ? 'Unfavourite' : 'Favourite'}</button><button class="button button-small" data-action="add-collection" data-id="${id}">Collection</button><button class="button button-small button-danger" data-action="remove" data-id="${id}">Remove</button></div></article>`;
  }).join('')}</div>` : renderEmpty('Your library is empty', 'Search MangaDex and save titles to build your shelf.', '<a class="button-primary" href="#discover">Discover manga</a>');
  const collectionName = state.selectedCollectionId ? escapeHtml(state.collections.find(c => c.id === state.selectedCollectionId)?.name || 'Collection') : 'All titles';
  return `<section>
    <div class="page-head"><div><h1>Library</h1><p>${collectionName} · saved on this device</p></div><button class="button-primary button-small" data-action="create-collection">${icon('plus', 'icon-sm')}Collection</button></div>
    ${collectionChips}
    <div class="toolbar"><label class="sr-only" for="statusFilter">Filter by status</label><select class="select-field" id="statusFilter" data-action="status-filter">${statuses.map(([value, label]) => `<option value="${value}" ${state.libraryStatusFilter === value ? 'selected' : ''}>${label}</option>`).join('')}</select><span class="count">${entries.length} title${entries.length === 1 ? '' : 's'}</span></div>
    ${listMarkup}
    ${renderRoadmap('library')}
    ${state.libraryHiddenCount ? `<p class="footer-note">${state.libraryHiddenCount} saved title${state.libraryHiddenCount === 1 ? ' is' : 's are'} hidden by your content preference. ${state.libraryHiddenCount === 1 ? 'It stays' : 'They stay'} saved on this device.</p>` : ''}
    <p class="footer-note">Removing a title keeps its cached metadata, bookmarks and imported files.</p>
  </section>`;
}

async function renderDownloads() {
  const rows = await (await import('./data/database.js')).getAllRecords('downloadJobs');
  const info = [
    { icon: 'database', title: 'Local storage', description: 'Library, progress and settings live on this device. Covers are cached so they load faster.' },
    { icon: 'clock', title: 'Download queue', description: `${rows.length} task${rows.length === 1 ? '' : 's'} recorded on this device.` }
  ];
  return `<section>
    <div class="page-head"><div><h1>Downloads</h1><p>Chapters are read online. Offline reading is planned.</p></div></div>
    <div class="group">${info.map(row => listRow(row)).join('')}</div>
    ${rows.length ? `<h2 class="group-title">Tasks</h2><div class="library-list">${rows.map(job => `<div class="library-card"><div class="library-cover library-cover-fallback">${icon('download')}</div><div class="library-info"><h3>${escapeHtml(job.status || 'Task')}</h3><p>${escapeHtml(job.lastError || 'Download task')}</p><span class="pill-label">${Number(job.bytesDownloaded || 0).toLocaleString()} bytes</span></div></div>`).join('')}</div>` : renderEmpty('Nothing downloaded yet', 'Download status and storage use will show here.')}
    ${renderRoadmap('downloads')}
  </section>`;
}

function chartMarkup(stats) {
  if (!stats.hasReadingSessions) return `<div class="chart-empty">Your last seven days of reading will show up here once you read a chapter. Library changes are not counted as reading time.</div>`;
  const max = Math.max(1, ...stats.daily.map(day => day.sessions));
  return `<div class="chart" role="img" aria-label="Reading sessions over the last seven days">${stats.daily.map(day => `<div class="chart-column"><span class="bar-value">${day.sessions}</span><div class="bar" style="height:${Math.max(3, day.sessions / max * 88)}px"></div><small>${escapeHtml(day.label)}</small></div>`).join('')}</div>`;
}

const formatCount = value => (Number(value) || 0).toLocaleString();

// The signed-in person's AniList profile: banner, avatar, name, and AniList's own counts. Shown instead of "Local reader".
function profileHeroMarkup() {
  const account = state.anilist.account;
  const profile = account?.profile;
  const name = profile?.name || account?.viewer?.name || 'AniList user';
  const avatar = profile?.avatarUrl || safeCoverUrl(account?.viewer?.avatarUrl);
  const banner = profile?.bannerUrl;
  const link = profile?.siteUrl || account?.viewer?.siteUrl || '';
  const safeLink = /^https:\/\/anilist\.co\//.test(link) ? link : '';
  const avatarMarkup = avatar ? `<img class="profile-avatar" src="${escapeHtml(avatar)}" alt="" width="84" height="84" decoding="async" referrerpolicy="no-referrer">` : `<span class="profile-avatar profile-avatar-fallback" aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
  return `<div class="profile-hero" id="profileHero">
    <div class="profile-banner">${banner ? `<img src="${escapeHtml(banner)}" alt="" decoding="async" referrerpolicy="no-referrer">` : ''}</div>
    <div class="profile-hero-body">${avatarMarkup}<div class="profile-hero-text"><h1>${escapeHtml(name)}</h1>${safeLink ? `<a class="pill-label accent" href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer">View on AniList ${icon('external', 'icon-sm')}</a>` : '<span class="pill-label accent">AniList</span>'}</div></div>
  </div>`;
}

function profileAniListMarkup() {
  const profile = state.anilist.account?.profile;
  if (!profile) return '<div id="profileAniStats"></div>';
  const cells = [[profile.anime.count, 'Anime'], [profile.manga.count, 'Manga']];
  if (profile.following !== null) cells.push([profile.following, 'Following']);
  if (profile.followers !== null) cells.push([profile.followers, 'Followers']);
  if (cells.length < 4) cells.push([profile.manga.chaptersRead, 'Chapters read']);
  const rows = [['Chapters read', formatCount(profile.manga.chaptersRead)], ['Volumes read', formatCount(profile.manga.volumesRead)], ['Manga mean score', profile.manga.meanScore ? String(profile.manga.meanScore) : '—']];
  return `<div id="profileAniStats">
    <div class="stat-strip" role="list" aria-label="AniList totals">${cells.slice(0, 4).map(([value, label]) => `<div role="listitem"><strong>${formatCount(value)}</strong><span>${label}</span></div>`).join('')}</div>
    <h2 class="group-title">Manga on AniList</h2>
    <div class="group">${rows.map(([label, value]) => `<div class="row is-info"><span class="row-copy"><strong>${label}</strong></span><span class="row-trail"><span class="row-value">${escapeHtml(value)}</span></span></div>`).join('')}</div>
    ${profile.about ? `<h2 class="group-title">Bio</h2><div class="group"><p class="profile-bio">${escapeHtml(profile.about)}</p></div>` : ''}
  </div>`;
}

// Fetch a fresh profile in the background; the screen shows the saved one right away and updates in place.
async function refreshProfileInBackground() {
  if (!state.anilist.status.connected || !profileIsStale(state.anilist.account?.profile)) return;
  try {
    const profile = await refreshProfile();
    if (!profile) return;
    state.anilist.account = await getAccount();
    if (app.currentRoute() !== 'profile') return;
    const hero = document.getElementById('profileHero');
    const stats = document.getElementById('profileAniStats');
    if (hero) hero.outerHTML = profileHeroMarkup();
    if (stats) stats.outerHTML = profileAniListMarkup();
  } catch (error) { console.warn('AniList profile not refreshed:', error?.message || error); }
}

async function renderProfile() {
  const stats = await getDashboardStatistics();
  await refreshAniList();
  const chevron = icon('chevronRight');
  const groups = PROFILE_GROUPS.map(group => `<div class="group">${group.rows.map(row => listRow({ icon: row.icon, title: row.title, description: row.description, href: row.href, trail: chevron })).join('')}</div>`).join('');
  const connected = state.anilist.status.connected;
  const activity = stats.hasReadingSessions
    ? `<h2 class="group-title">Last seven days</h2><div class="group"><div class="surface-pad">${chartMarkup(stats)}<p class="chart-note">${stats.completedChapters} chapters completed · ${Math.round(stats.activeSessionSeconds / 60)} minutes of reading</p></div></div>`
    : '';
  const head = connected
    ? `${profileHeroMarkup()}${profileAniListMarkup()}${renderAniListCard()}<h2 class="group-title">In this app</h2>${renderStats(stats)}`
    : `<div class="identity"><div class="identity-avatar" aria-hidden="true">東</div><div><h1>Local reader</h1><p>Your library lives on this device.</p><span class="pill-label">No account needed</span></div></div>${renderStats(stats)}${renderAniListCard()}`;
  setTimeout(() => { refreshProfileInBackground(); }, 0);
  return `<section class="narrow profile-page">
    ${head}
    ${activity}
    ${groups}
    <p class="footer-note">Tokyo Manga Lab ${escapeHtml(APP_VERSION)}</p>
  </section>`;
}


// ---------- AniList ----------
async function refreshAniList() {
  state.anilist.account = await getAccount();
  state.anilist.status = describeAccount(state.anilist.account);
}

const anilistClientId = () => resolveClientId({ saved: state.settings?.anilistClientId, builtIn: DEFAULT_ANILIST_CLIENT_ID });

// AniList is optional. Nothing in the app waits for it; this card only offers it and explains what it does.
const CARD_HIDDEN_KEY = 'tml-anilist-card-hidden';
const anilistCardHidden = () => { try { return localStorage.getItem(CARD_HIDDEN_KEY) === '1'; } catch { return false; } };
const setAnilistCardHidden = hidden => { try { if (hidden) localStorage.setItem(CARD_HIDDEN_KEY, '1'); else localStorage.removeItem(CARD_HIDDEN_KEY); } catch { /* the choice just is not remembered */ } };

function renderAniListCard() {
  const status = state.anilist.status;
  if (status.connected) {
    return `<section class="login-card is-connected" aria-labelledby="anilistCardTitle"><div class="login-card-head"><span class="login-card-icon" aria-hidden="true">${icon('cloud')}</span><div><h2 id="anilistCardTitle">AniList sync</h2><p>${escapeHtml(dynamicValue('anilistLastSync') === 'Not synced yet' ? 'Not synced yet.' : `Last synced ${dynamicValue('anilistLastSync')}.`)}</p></div></div><div class="login-card-actions"><button class="button-primary" type="button" data-action="anilist-sync">Sync now</button><a class="button" href="#settings/account">AniList settings</a></div></section>`;
  }
  if (anilistCardHidden()) return `<p class="login-card-collapsed"><button class="link-button" type="button" data-action="anilist-card-show">Connect AniList (optional)</button></p>`;
  const availability = loginAvailability({ native: isNativeApp(), clientId: anilistClientId() });
  const note = availability.message ? `<p class="login-note" role="note">${escapeHtml(availability.message)}</p>` : '';
  const signIn = availability.state === 'ready'
    ? '<button class="button-primary" type="button" data-action="anilist-connect">Log in with AniList</button>'
    : availability.state === 'needs-id'
      ? '<a class="button-primary" href="#settings/account">Add an app ID</a>'
      : '<button class="button-primary" type="button" data-action="anilist-paste-token">Paste a token</button>';
  return `<section class="login-card" aria-labelledby="anilistCardTitle">
    <div class="login-card-head"><span class="login-card-icon" aria-hidden="true">${icon('cloud')}</span><div><h2 id="anilistCardTitle">Connect AniList <span class="pill-label">Optional</span></h2><p>Bring in your AniList manga list and keep progress there. The app works fully without it.</p></div></div>
    <p class="login-safety">You will go to <strong>anilist.co</strong>. Check the address before typing your password.</p>
    ${note}
    <div class="login-card-actions">${signIn}<button class="button" type="button" data-action="anilist-register">Register</button><button class="button-subtle" type="button" data-action="anilist-card-hide">Not now</button></div>
  </section>`;
}

async function startAniListSignIn() {
  const availability = loginAvailability({ native: isNativeApp(), clientId: anilistClientId() });
  if (availability.state !== 'ready') { toast(availability.message); return; }
  const url = buildAuthorizeUrl(anilistClientId());
  await markAuthAttempt();
  await openAuthPage(url);
}

function openAniListPage(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function finishAniListConnect(tokenInfo) {
  const account = await connectWithToken(tokenInfo);
  await refreshAniList();
  toast(`Connected to AniList as ${account.viewer.name}.`);
  if (!state.settings.anilistPushEnabled && window.confirm('Also save the status changes you make here on AniList? Sync never deletes anything. You can change this in Settings.')) {
    await saveSetting('anilistPushEnabled', true);
    state.settings = { ...state.settings, anilistPushEnabled: true };
  }
  if (window.location.hash === '#settings/account') await app.navigate('settings');
  else window.location.hash = '#settings/account';
}

// Android hands tokyomangalab://anilist-auth#access_token=... back to the app. Accept it only right after we started sign-in.
async function handleAniListRedirect(urlString) {
  const parsed = parseAuthRedirect(urlString);
  if (!parsed.ok && parsed.reason === 'not-ours') return;
  await closeAuthPage();
  const attempt = await getAuthAttempt();
  await clearAuthAttempt();
  if (!attempt || Date.now() - attempt.startedAt > AUTH_ATTEMPT_MAX_AGE_MS) { toast('That sign-in link was not expected. Start sign-in from Settings.'); return; }
  if (!parsed.ok) { toast(parsed.reason === 'denied' ? 'AniList sign-in was cancelled.' : 'AniList did not send a sign-in token. Try again.'); return; }
  try { await finishAniListConnect(parsed); }
  catch (error) { console.error(error); toast(error?.message || 'Could not finish AniList sign-in.'); }
}

async function pasteAniListToken() {
  const raw = window.prompt('Paste your AniList access token:');
  if (raw === null) return;
  const token = raw.trim();
  if (!looksLikeToken(token)) { toast('That does not look like an AniList token.'); return; }
  await finishAniListConnect({ accessToken: token, expiresAt: Date.now() + ANILIST_TOKEN_DEFAULT_TTL_SECONDS * 1000 });
}

async function signOutAniList() {
  if (!window.confirm('Sign out of AniList on this device? Your library stays as it is.')) return;
  await disconnectAniList();
  await refreshAniList();
  await app.navigate('settings');
  toast('Signed out of AniList.');
}

async function syncAniList() {
  if (state.anilist.busy) return;
  state.anilist.busy = true;
  const say = text => { const out = document.getElementById('anilistResult'); if (out) out.textContent = text; };
  try {
    say('Starting sync');
    const summary = await runSync({
      pushEnabled: Boolean(state.settings.anilistPushEnabled),
      allowAdult: Boolean(state.settings.adultContentEnabled),
      confirmPush: count => window.confirm(`Add or update ${count} title${count === 1 ? '' : 's'} on your AniList account from this app? Nothing is deleted.`),
      onProgress: say
    });
    await refreshAniList();
    await refreshLibraryIndex();
    await app.navigate('settings');
    say(describeSummary(summary));
    toast('AniList sync finished.');
  } catch (error) {
    console.error(error);
    await refreshAniList();
    await app.navigate('settings');
    say(error?.message || 'AniList sync failed.');
  } finally { state.anilist.busy = false; }
}

// After a status change here: queue it for AniList when push is on and the title has an exact AniList id.
function queueAniListPush(contentItemId) {
  if (!state.settings?.anilistPushEnabled || !state.anilist.status.connected) return;
  notifyLocalChange(contentItemId).catch(error => { console.warn('AniList push not queued:', error); });
}

function dynamicValue(name) {
  if (name === 'anilistStatus') return state.anilist.status.label;
  if (name === 'ratings') return adultActive() ? 'Includes adult (Android app only)' : 'Safe and suggestive';
  if (name === 'anilistLastSync') {
    const last = state.anilist.account?.lastSync;
    return last ? `${new Date(last.at).toLocaleString()}` : 'Not synced yet';
  }
  return '';
}

function itemVisible(item) {
  if (item.when === 'anilistConnected') return state.anilist.status.connected;
  if (item.when === 'anilistDisconnected') return !state.anilist.status.connected;
  return true;
}

function settingRow(item) {
  const s = state.settings;
  if (item.type === 'planned') return listRow({ title: item.title, description: item.description, planned: true });
  if (item.type === 'link') return listRow({ title: item.title, description: item.description, href: item.href, external: true, trail: icon('external', 'icon-sm') });
  const tag = item.badge ? `<span class="badge-note">${escapeHtml(item.badge)}</span> ` : '';
  const copy = `<span class="row-copy"><strong>${escapeHtml(item.title)}</strong>${item.description || tag ? `<small>${tag}${escapeHtml(item.description || '')}</small>` : ''}</span>`;
  if (item.type === 'toggle') {
    return `<label class="row">${copy}<span class="row-trail"><span class="switch"><input type="checkbox" data-setting="${item.key}" ${s[item.key] ? 'checked' : ''}><span class="switch-track"></span></span></span></label>`;
  }
  if (item.type === 'themes') {
    const cards = THEMES.map(theme => `<label class="theme-card"><input type="radio" name="theme" value="${escapeHtml(theme.id)}" data-setting="theme" ${s.theme === theme.id ? 'checked' : ''}><span class="theme-card-body"><span class="theme-swatch" style="--s1:${theme.swatch[0]};--s2:${theme.swatch[1]};--s3:${theme.swatch[2]}" aria-hidden="true"></span><span class="theme-name">${escapeHtml(theme.name)}${theme.special ? '<span class="badge-note">Special</span>' : ''}</span><small>${escapeHtml(theme.note)}</small></span></label>`).join('');
    return `<div class="row row-stack">${copy}<div class="theme-grid" role="radiogroup" aria-label="${escapeHtml(item.title)}">${cards}</div></div>`;
  }
  if (item.type === 'select') {
    const options = item.options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${s[item.key] === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
    return `<div class="row">${copy}<span class="row-trail"><label class="sr-only" for="set-${item.key}">${escapeHtml(item.title)}</label><select class="select-field" id="set-${item.key}" data-setting="${item.key}">${options}</select></span></div>`;
  }
  if (item.type === 'text') {
    return `<div class="row row-stack">${copy}<label class="sr-only" for="set-${item.key}">${escapeHtml(item.title)}</label><input class="field text-field" id="set-${item.key}" type="text" inputmode="${escapeHtml(item.inputMode || 'text')}" autocomplete="off" placeholder="${escapeHtml(item.placeholder || '')}" value="${escapeHtml(s[item.key] || '')}" data-setting="${item.key}"></div>`;
  }
  if (item.type === 'action') {
    return `<div class="row">${copy}<span class="row-trail"><button class="button button-small ${item.danger ? 'button-danger' : ''}" type="button" data-action="${escapeHtml(item.action)}">${escapeHtml(item.button)}</button></span></div>${item.resultId ? `<p class="row-result" id="${escapeHtml(item.resultId)}" aria-live="polite"></p>` : ''}`;
  }
  const value = item.valueFrom ? dynamicValue(item.valueFrom) : item.value;
  return `<div class="row is-info">${copy}<span class="row-trail"><span class="row-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span></span></div>`;
}

// The label of the option a select setting is currently on (used for the live values on Settings home).
function optionLabel(key) {
  for (const category of SETTINGS_CATEGORIES) for (const group of category.groups) for (const item of group.items) {
    if (item.key === key && item.options) return (item.options.find(([value]) => value === state.settings?.[key]) || [])[1] || '';
  }
  return '';
}

function categoryValue(category) {
  switch (category.valueFrom) {
    case 'theme': return optionLabel('theme');
    case 'readerMode': return optionLabel('readerMode');
    case 'language': return optionLabel('preferredLanguage');
    case 'anilistStatus': return state.anilist.status.connected ? 'Connected' : 'Not connected';
    default: return '';
  }
}

function settingsCategoryRow(category) {
  const value = categoryValue(category);
  const trail = `${value ? `<span class="row-value">${escapeHtml(value)}</span>` : ''}${icon('chevronRight')}`;
  return listRow({ icon: category.icon, title: category.title, description: category.summary, href: `#settings/${category.id}`, badge: category.planned ? 'Planned' : '', trail });
}

const foldMarkup = (title, body, { open = false } = {}) => `<details class="fold"${open ? ' open' : ''}><summary><span>${escapeHtml(title)}</span>${icon('chevronRight')}</summary>${body}</details>`;
const plannedFold = rows => `<details class="roadmap"><summary>${icon('sparkle')}<span>Coming later</span><span class="count-pill">${rows.length}</span>${icon('chevronRight')}</summary><div class="group">${rows.join('')}</div></details>`;

function renderSettingsHome() {
  const sections = SETTINGS_SECTIONS.filter(section => section.id !== 'later').map(section => {
    const rows = SETTINGS_CATEGORIES.filter(category => category.section === section.id).map(settingsCategoryRow);
    return rows.length ? `<h2 class="group-title">${escapeHtml(section.title)}</h2><div class="group">${rows.join('')}</div>` : '';
  }).join('');
  const later = [
    ...SETTINGS_CATEGORIES.filter(category => category.section === 'later').map(settingsCategoryRow),
    ...plannedProfileRows().map(row => listRow({ icon: row.icon, title: row.title, description: row.description, planned: true }))
  ];
  return `<section class="narrow">
    <a class="back-link" href="#profile">${icon('chevronLeft')}Profile</a>
    <div class="page-head"><div><h1>Settings</h1><p>Saved on this device.</p></div></div>
    <div class="settings-search"><label class="sr-only" for="settingsSearch">Search settings</label><span class="settings-search-icon" aria-hidden="true">${icon('search')}</span><input class="field" id="settingsSearch" type="search" placeholder="Search settings" autocomplete="off" enterkeyhint="search"></div>
    <div id="settingsResults" aria-live="polite" hidden></div>
    <div id="settingsCategories">${sections}${later.length ? plannedFold(later) : ''}</div>
  </section>`;
}

// Search every setting that is available now (not the planned ones) by title, description, group and category.
function settingsSearchMarkup(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const blocks = [];
  for (const category of SETTINGS_CATEGORIES) {
    if (category.planned) continue;
    for (const group of category.groups) {
      const hits = group.items.filter(item => item.type !== 'planned' && itemVisible(item)).filter(item => {
        const text = `${item.title} ${item.description || ''} ${item.badge || ''} ${group.title} ${category.title}`.toLowerCase();
        return words.every(word => text.includes(word));
      });
      if (hits.length) blocks.push(`<h2 class="group-title"><a href="#settings/${category.id}">${escapeHtml(category.title)}</a> · ${escapeHtml(group.title)}</h2><div class="group">${hits.map(settingRow).join('')}</div>`);
    }
  }
  return blocks.length ? blocks.join('') : renderEmpty('No settings found', 'Try a shorter word, such as “theme” or “sync”.');
}

function runSettingsSearch(query) {
  const results = document.getElementById('settingsResults');
  const categories = document.getElementById('settingsCategories');
  if (!results || !categories) return;
  const markup = settingsSearchMarkup(query);
  results.innerHTML = markup;
  results.hidden = !markup;
  categories.hidden = Boolean(markup);
}

function renderSettingsCategory(category) {
  const planned = [];
  const groups = category.groups.map(group => {
    const visible = group.items.filter(itemVisible);
    if (category.planned) return { group, items: visible };
    planned.push(...visible.filter(item => item.type === 'planned'));
    return { group, items: visible.filter(item => item.type !== 'planned') };
  }).filter(({ items }) => items.length).map(({ group, items }) => {
    const body = `<div class="group">${items.map(settingRow).join('')}</div>`;
    return group.collapsed ? foldMarkup(group.title, body) : `<h2 class="group-title">${escapeHtml(group.title)}</h2>${body}`;
  }).join('');
  return `<section class="narrow">
    <a class="back-link" href="#settings">${icon('chevronLeft')}Settings</a>
    <div class="page-head with-icon"><span class="head-icon" aria-hidden="true">${icon(category.icon)}</span><div><h1>${escapeHtml(category.title)}</h1><p>${escapeHtml(category.summary)}</p></div></div>
    ${category.planned ? '<div class="notice"><strong>Planned.</strong> These options are not available yet. They are listed so you can see what is coming.</div>' : ''}
    ${groups}
    ${planned.length ? plannedFold(planned.map(item => settingRow(item))) : ''}
  </section>`;
}

async function renderSettings() {
  if (!state.settings) state.settings = await loadSettings();
  await refreshAniList();
  const category = findCategory(getRouteParam());
  return category ? renderSettingsCategory(category) : renderSettingsHome();
}

// Redraw only the results area so the search box keeps focus (and the keyboard stays open) while typing.
async function refreshSearchViews() {
  const route = app.currentRoute();
  const discover = route === 'discover' && document.getElementById('discoverResults');
  const home = route === 'home' && document.getElementById('homeFresh');
  if (discover) { await refreshLibraryIndex(); discover.innerHTML = discoverResultsMarkup(); }
  else if (home) { await refreshLibraryIndex(); home.innerHTML = homeFreshMarkup(); }
  else if (['home', 'discover'].includes(route)) await app.navigate(route);
}

async function loadSearch(query = state.query, page = 1) {
  const sequence = ++state.searchSequence;
  if (state.searchController) state.searchController.abort();
  state.searchController = new AbortController();
  state.query = String(query || '').trim().slice(0, 100);
  state.page = Math.max(1, Math.min(20, Number(page) || 1));
  state.searchLoading = true;
  state.results = [];
  state.apiError = '';
  state.offlineResults = false;
  state.genre = state.genre || 'all';
  await refreshSearchViews();
  try {
    if (state.settings && !state.settings.enableOnlineSearch) throw new Error('Online search is disabled in Settings. Turn it on to search MangaDex.');
    const result = await sourceRegistry.search('mangadex', state.query, state.page, { signal: state.searchController.signal });
    if (sequence !== state.searchSequence) return;
    state.results = await cacheCatalogueItems(result.items);
    state.pagination = result.pagination;
    state.lastSearchTime = new Date().toISOString();
    setConnectionStatus('online', 'MangaDex online');
  } catch (error) {
    if (sequence !== state.searchSequence) return;
    state.apiError = error?.message || 'The catalogue is unavailable.';
    try {
      const local = (await getCatalogueItems()).filter(isRatingVisible);
      const queryLower = state.query.toLowerCase();
      const matched = local.filter(item => `${item.title} ${(item.authors || []).join(' ')} ${(item.tags || []).join(' ')} ${item.description || ''}`.toLowerCase().includes(queryLower));
      state.results = matched.slice(0, 24);
      state.pagination = { page: 1, limit: 24, total: matched.length, hasNext: false };
      state.offlineResults = true;
    } catch {
      state.results = [];
      state.pagination = { page: 1, limit: 24, total: 0, hasNext: false };
    }
    setConnectionStatus('offline', 'Catalogue offline');
  } finally {
    if (sequence === state.searchSequence) {
      state.searchLoading = false;
      await refreshLibraryIndex();
      await refreshSearchViews();
    }
  }
}

// Titles with an adult rating are hidden everywhere while the adult preference is off (or in the web build).
// They stay saved on this device; they reappear when the preference is turned back on.
async function refreshLibraryIndex() {
  const all = await getLibraryItems();
  state.library = all.filter(row => isRatingVisible(row.item));
  state.libraryHiddenCount = all.length - state.library.length;
  state.libraryById = new Map(state.library.map(row => [row.contentItemId, row]));
}

function runSearchFromForm(form) {
  const input = form.querySelector('input[name="query"]');
  const query = input?.value || '';
  state.genre = 'all';
  if (app.currentRoute() !== 'discover') window.location.hash = '#discover';
  loadSearch(query, 1);
}

function currentDetailsItem() {
  return [...state.results, ...state.library.map(row => row.item)].find(row => row?.id === state.detailsItemId) || null;
}

function safeMangaDexChapterUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://mangadex.org' && url.pathname.startsWith('/chapter/') ? url.href : '';
  } catch { return ''; }
}

function safeMangaDexTitleUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://mangadex.org' && url.pathname.startsWith('/title/') ? url.href : '';
  } catch { return ''; }
}

function safeAniListUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://anilist.co' && /^\/manga\/\d+/.test(url.pathname) ? url.href : '';
  } catch { return ''; }
}

function chapterApiUnavailableMessage(error) {
  if (error?.status === 404) return 'The deployed Worker needs the new details/chapters API routes from the V1.1 package.';
  if (error?.code === 'NETWORK_ERROR' && ['localhost', '127.0.0.1'].includes(location.hostname)) {
    return 'The local preview may be blocked by the deployed Worker CORS settings. Deploy the reviewed Worker patch and verify its URL as described in DEPLOY-ON-ANDROID.md.';
  }
  return error?.message || 'The chapter metadata API is unavailable.';
}

function chapterLanguageOptions() {
  const current = state.detailsChapterLanguage;
  const all = `<option value="all" ${current === 'all' ? 'selected' : ''}>All languages</option>`;
  return all + CHAPTER_LANGUAGES.map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('');
}

// ---- chapter list view (sort, filter, display) and marks ---------------------------------------
function currentChapterView() {
  const settings = state.settings || {};
  return normalizeChapterView({ sortKey: settings.chapterSortKey, sortDir: settings.chapterSortDir, display: settings.chapterDisplay, unread: settings.chapterFilterUnread, bookmarked: settings.chapterFilterBookmarked, scanlator: state.chapterScanlator });
}

function visibleChapters() {
  const view = currentChapterView();
  return sortChapters(filterChapters(state.detailsChapters, view, { readIds: state.detailsRead, bookmarkIds: state.detailsBookmarks }), view);
}

async function refreshChapterMarks(itemId = state.detailsItemId) {
  state.detailsRead = await listReadChapterIds(itemId);
  state.detailsBookmarks = await listBookmarkedChapterIds(itemId);
  state.detailsPages = await listChapterPages(itemId);
}

async function saveChapterViewSetting(key, value) {
  await saveSetting(key, value);
  state.settings = { ...state.settings, [key]: value };
}

const idleTrack = () => ({ open: false, loading: false, connected: false, mediaId: null, row: null, pending: false, note: '', noteKind: '', search: { query: '', status: 'idle', results: [], message: '' } });

function renderDetailsContent(rawItem) {
  if (!rawItem) return;
  const item = withFallbackMetadata(rawItem, state.detailsLink);
  const linkable = isLinkableAniListItem(rawItem);
  const entry = getLibraryEntry(item.id);
  const safeSourceUrl = item.sourceId === 'mangadex' ? safeMangaDexTitleUrl(item.sourceUrl) : item.sourceId === 'anilist' ? safeAniListUrl(item.sourceUrl) : '';
  const sourceName = item.sourceId === 'anilist' ? 'AniList' : 'MangaDex';
  const sourceLink = safeSourceUrl ? `<a class="button-primary" href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer">Open ${sourceName} ↗</a>` : '';
  const fallbackNote = item.usedFallback?.length ? `<p class="muted">Filled in from MangaDex because AniList has none: ${escapeHtml(item.usedFallback.join(', '))}.</p>` : '';
  const metadataNotice = state.detailsMetadataError ? `<div class="notice warning"><strong>Using cached metadata.</strong> ${escapeHtml(state.detailsMetadataError)}</div>` : '';
  const canRead = Boolean(sourceRegistry.get('mangadex')?.capabilities?.chapterContent);
  const view = currentChapterView();
  const listed = visibleChapters();
  const shownRows = listed.slice(0, state.chapterShown);
  const chapterRows = shownRows.map(chapter => renderChapterRow({
    chapter, display: view.display, read: state.detailsRead.has(chapter.externalId), bookmarked: state.detailsBookmarks.has(chapter.externalId),
    menuOpen: state.chapterMenuId === chapter.externalId, canRead, sourceUrl: safeMangaDexChapterUrl(chapter.sourceUrl), progressPage: state.detailsPages.get(chapter.externalId) || 0
  })).join('');
  let chapterNotice = '';
  if (state.detailsLoadingChapters) chapterNotice = '<div class="empty-state chapter-empty"><span class="spinner"></span><strong>Loading chapter list…</strong><span>Fetching chapter metadata only.</span></div>';
  else if (state.detailsError) chapterNotice = `<div class="notice warning"><strong>${state.detailsChapters.length ? 'Some chapters could not be loaded.' : 'Chapter list unavailable.'}</strong> ${escapeHtml(state.detailsError)} <span>Use the MangaDex source link for the latest chapter list.</span></div>`;
  else if (!state.detailsChapters.length) chapterNotice = '<div class="empty-state chapter-empty"><strong>No chapters in this result.</strong><span>Try another language or open the source page.</span></div>';
  else if (!listed.length) chapterNotice = '<div class="empty-state chapter-empty"><strong>No chapters match your filters.</strong><button class="button button-small" type="button" data-action="chapter-filters-clear">Clear filters</button></div>';
  const hasChapters = state.detailsChapters.length > 0;
  const toolbar = hasChapters ? renderChapterToolbar({ view, open: state.chapterOptionsOpen, shown: listed.length, total: state.detailsChapterTotal, loaded: state.detailsChapters.length }) : '';
  const options = hasChapters && state.chapterOptionsOpen ? renderChapterOptions({ view, tab: state.chapterOptionsTab, scanlators: scanlatorsOf(state.detailsChapters) }) : '';
  const more = [
    listed.length > shownRows.length ? `<button class="button chapter-more-btn" type="button" data-action="chapter-show-more">Show ${Math.min(60, listed.length - shownRows.length)} more</button>` : '',
    state.detailsChapterNext && !state.detailsLoadingChapters ? '<button class="button chapter-more-btn" type="button" data-action="chapter-load-rest">Load the remaining chapters</button>' : ''
  ].join('');
  const trackLabel = state.track?.row?.onList ? `Tracking · ${trackStatusLabel(state.track.row.status)}${state.track.row.progress ? ` · ch. ${state.track.row.progress}` : ''}` : 'Tracking';
  const trackButton = `<button class="button-subtle" type="button" data-action="track-toggle" aria-expanded="${Boolean(state.track?.open)}">${escapeHtml(trackLabel)}</button>`;
  const trackingPanel = state.track?.open ? renderTrackingPanel({ track: state.track, item, coverHtml: media => coverMarkup(media, true) }) : '';
  document.getElementById('detailsContent').innerHTML = `<div class="details-layout"><div class="details-cover">${coverMarkup(item, false, state.detailsLink?.fallback?.coverUrl)}</div><div><span class="eyebrow">${escapeHtml(item.sourceId === 'mangadex' ? 'MangaDex title' : item.sourceId === 'anilist' ? (state.detailsLink ? 'AniList title · chapters from MangaDex' : 'AniList title') : 'Local library item')}</span><h2 id="detailsTitle">${escapeHtml(item.title)}</h2><p>${escapeHtml(titleAuthor(item))}${item.releaseYear ? ` · ${escapeHtml(item.releaseYear)}` : ''}</p><div class="tag-row">${(item.tags || []).slice(0, 8).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div><p>${escapeHtml(item.description || 'No synopsis is available in the catalogue response.')}</p><p class="muted">Catalogue status: ${escapeHtml(item.publicationStatus || 'unknown')} · Rating: ${escapeHtml(item.contentRating || 'unknown')}</p>${fallbackNote}${metadataNotice}</div></div><div class="details-actions">${entry ? `<button class="button-subtle" data-action="mark-reading" data-id="${escapeHtml(item.id)}">${entry.personalStatus === 'reading' ? 'Currently reading' : 'Mark as reading'}</button>` : `<button class="button-subtle" data-action="save" data-id="${escapeHtml(item.id)}">Add to library</button>`}${sourceLink}${trackButton}</div>${trackingPanel}${linkable && (!state.detailsLink || state.link.changing) ? renderLinkPanel(rawItem) : ''}<section class="chapter-panel" ${linkable && (!state.detailsLink || state.link.changing) ? 'hidden' : ''}>${linkable && state.detailsLink ? renderLinkBanner(state.detailsLink) : ''}<div class="section-topline chapter-heading"><div><h3>Chapters</h3><p>Tap Read to open a chapter here. The ↗ button opens it on MangaDex.</p></div><label class="chapter-language-label">Language <select class="select-field" data-action="chapter-language" aria-label="Chapter language">${chapterLanguageOptions()}</select></label></div>${toolbar}${options}${state.detailsLoading ? '<p class="muted">Refreshing title metadata…</p>' : ''}${chapterNotice}${chapterRows ? `<div class="chapter-list">${chapterRows}</div>` : ''}${more ? `<div class="chapter-more-row">${more}</div>` : ''}</section><p class="footer-note">Chapter pages load directly from MangaDex. Tokyo Manga Lab does not download, store or re-host them.</p>`;
}



// ---- chapter marks and AniList tracking on a title ---------------------------------------------
const redrawDetails = () => renderDetailsContent(currentDetailsItem());

async function setChapterView(change) {
  for (const [key, value] of Object.entries(change)) {
    if (key === 'scanlator') state.chapterScanlator = String(value || '');
    else await saveChapterViewSetting({ sortKey: 'chapterSortKey', sortDir: 'chapterSortDir', display: 'chapterDisplay', unread: 'chapterFilterUnread', bookmarked: 'chapterFilterBookmarked' }[key], value);
  }
  state.chapterShown = 60;
  redrawDetails();
}

function trackerNote(result) {
  if (result.outcome === 'sent') return `AniList updated: ${result.summary || 'saved'}.`;
  if (result.outcome === 'queued') return 'AniList could not be reached. The update is saved on this device and will be sent later.';
  return '';
}

// A chapter was read, or marked read. The update is decided against AniList's current entry when it is sent.
async function trackAndReport(item, chapterNumber) {
  try {
    const result = await trackChapterRead(item, chapterNumber);
    const text = trackerNote(result);
    if (text) toast(text);
    if (document.getElementById('detailsDialog')?.open && state.detailsItemId === item.id) { await loadTrackSummary(item, state.detailsSequence); }
  } catch (error) {
    console.warn('AniList progress not sent:', error);
    toast(error?.code === 'UNAUTHORIZED' ? 'AniList sign-in expired. Connect again in Settings.' : 'Could not update AniList. Try again later.');
  }
}

async function onChapterRead({ chapterId, contentItemId } = {}) {
  if (!state.settings?.trackerAutoUpdate || !state.anilist.status.connected) return;
  const context = state.readerContext;
  const chapter = context?.chapters?.find(entry => entry.id === chapterId);
  if (!chapter || chapter.number === null || chapter.number === undefined || chapter.number === '') return; // extras do not count
  const item = [...state.results, ...state.library.map(row => row.item)].find(row => row?.id === contentItemId)
    || await (await import('./data/database.js')).getRecord('contentItems', contentItemId);
  if (!item) return;
  await trackAndReport(item, chapter.number);
}

async function markChaptersRead(chapterIds, read) {
  const item = currentDetailsItem();
  if (!item) return;
  const chapters = state.detailsChapters.filter(chapter => chapterIds.includes(chapter.externalId));
  if (!chapters.length) return;
  await setChaptersRead(item.id, chapters, read);
  await refreshChapterMarks();
  state.chapterMenuId = null;
  redrawDetails();
  toast(read ? (chapters.length === 1 ? 'Marked as read.' : `${chapters.length} chapters marked as read.`) : 'Marked as unread.');
  if (!read) return;
  const mode = state.settings?.trackerMarkRead || 'always';
  const top = Math.max(...chapters.map(chapter => progressNumber(chapter.chapterNumber) ?? -1));
  if (mode === 'never' || top < 1) return;
  if (mode === 'ask' && !window.confirm(`Update AniList to chapter ${top}?`)) return;
  await trackAndReport(item, top);
}

async function loadTrackSummary(item, sequence) {
  try {
    const summary = await getTrackingState(item);
    if (sequence !== state.detailsSequence) return;
    state.track = { ...(state.track || idleTrack()), connected: summary.connected, mediaId: summary.mediaId, row: summary.row, pending: summary.pending };
    redrawDetails();
  } catch (error) { console.warn('Tracking state not loaded:', error); }
}

async function toggleTracking() {
  const item = currentDetailsItem();
  if (!item) return;
  if (state.track?.open) { state.track = { ...state.track, open: false }; redrawDetails(); return; }
  const sequence = state.detailsSequence;
  state.track = { ...(state.track || idleTrack()), open: true, loading: true, note: '', noteKind: '' };
  redrawDetails();
  try {
    let summary = await getTrackingState(item);
    state.track = { ...state.track, connected: summary.connected, mediaId: summary.mediaId, row: summary.row, pending: summary.pending };
    if (summary.connected && summary.mediaId) {
      try { summary = await pullTracking(item); state.track = { ...state.track, row: summary.row, pending: summary.pending }; }
      catch (error) { state.track = { ...state.track, note: 'Could not reach AniList, so this shows the last saved copy.', noteKind: 'warn' }; }
    } else if (summary.connected) {
      state.track = { ...state.track, search: { query: item.title || '', status: 'idle', results: [], message: '' } };
    }
  } catch (error) {
    state.track = { ...state.track, note: error?.message || 'Could not load tracking.', noteKind: 'error' };
  } finally {
    if (sequence === state.detailsSequence) { state.track = { ...state.track, loading: false }; redrawDetails(); }
  }
}

async function runTrackSearch(query) {
  const text = String(query || '').trim();
  state.track = { ...state.track, search: { query: text, status: 'loading', results: [], message: '' } };
  redrawDetails();
  try {
    const results = await searchTitles(text, { allowAdult: adultActive() });
    state.track = { ...state.track, search: { query: text, status: 'done', results, message: '' } };
  } catch (error) {
    state.track = { ...state.track, search: { query: text, status: 'error', results: [], message: error?.message || 'AniList search failed.' } };
  }
  redrawDetails();
}

async function linkTrackTitle(mediaId) {
  const item = currentDetailsItem();
  const media = (state.track?.search?.results || []).find(entry => String(entry.id) === String(mediaId));
  if (!item || !media) return;
  await linkTitle(item, media);
  state.track = { ...state.track, mediaId: String(media.id), row: null, loading: true, note: '', noteKind: '' };
  redrawDetails();
  try { const summary = await pullTracking(item); state.track = { ...state.track, row: summary.row, pending: summary.pending }; }
  catch (error) { state.track = { ...state.track, note: 'Linked. AniList could not be reached for your entry just now.', noteKind: 'warn' }; }
  state.track = { ...state.track, loading: false };
  redrawDetails();
}

async function unlinkTrackTitle() {
  const item = currentDetailsItem();
  if (!item || !window.confirm('Track a different AniList title? This only changes the link on this device. Nothing is deleted on AniList.')) return;
  await unlinkTitle(item);
  state.track = { ...state.track, mediaId: null, row: null, pending: false, note: '', noteKind: '', search: { query: item.title || '', status: 'idle', results: [], message: '' } };
  redrawDetails();
}

async function commitTracking(patch) {
  const item = currentDetailsItem();
  if (!item) return;
  try {
    const result = await saveTracking(item, patch);
    const summary = await getTrackingState(item);
    state.track = { ...state.track, row: summary.row, pending: summary.pending, note: result.outcome === 'sent' ? `Saved to AniList: ${result.summary}.` : 'Saved on this device. It will be sent to AniList when it can be reached.', noteKind: result.outcome === 'sent' ? 'ok' : 'queued' };
  } catch (error) {
    state.track = { ...state.track, note: error?.code === 'UNAUTHORIZED' ? 'AniList sign-in expired. Connect again in Settings.' : (error?.message || 'Could not save that.'), noteKind: 'error' };
  }
  redrawDetails();
}

async function onTrackField(input) {
  const field = input.dataset.trackField;
  let patch;
  try {
    if (field === 'status') patch = { status: input.value };
    else if (field === 'progress') patch = { progress: Number(input.value) };
    else if (field === 'score') patch = { score: scoreToRaw(input.value) };
    else patch = { [field]: input.value ? input.value : null };
  } catch (error) {
    state.track = { ...state.track, note: error.message, noteKind: 'error' };
    redrawDetails();
    return;
  }
  await commitTracking(patch);
}

// ---- AniList -> MangaDex linking -------------------------------------------------------------
const idleLink = () => ({ status: 'idle', candidates: [], query: '', message: '', changing: false });
const mangaDexSearch = async query => (await sourceRegistry.search('mangadex', query, 1)).items;
const chapterSourceFor = item => chapterSourceId(item, state.detailsLink);

function linkSearchDisabled() {
  return state.settings && !state.settings.enableOnlineSearch ? 'Online search is turned off in Settings, so MangaDex cannot be searched.' : '';
}

function rerenderDetails(item) { renderDetailsContent(currentDetailsItem() || item); }

async function selectLinkCandidate(mangadexId) {
  const item = currentDetailsItem();
  const candidate = state.link.candidates.find(row => row.externalId === mangadexId);
  if (!isLinkableAniListItem(item) || !candidate) return;
  if (candidate.idStatus === 'other' && !window.confirm(`MangaDex lists AniList #${candidate.anilistId} for "${candidate.title}", not #${item.externalId}. Link it anyway?`)) return;
  await applyLink(item, candidate, candidate.idStatus === 'exact' ? 'anilist-id' : 'user-selected', state.detailsSequence);
}

async function unlinkMangaDex() {
  const item = currentDetailsItem();
  if (!isLinkableAniListItem(item) || !state.detailsLink) return;
  if (!window.confirm('Unlink this title from MangaDex? Your library entry and reading history stay.')) return;
  await removeMangaDexLink(item.id);
  state.detailsLink = null;
  state.detailsChapters = [];
  state.detailsError = '';
  state.detailsChapterPagination = { page: 1, limit: 24, total: 0, hasNext: false };
  toast('Unlinked from MangaDex.');
  await runLinkSearch(item, item.title);
}

async function loadLinkedChapters(row, sequence) {
  state.detailsChapters = [];
  state.detailsChapterPagination = { page: 1, limit: 24, total: 0, hasNext: false };
  await loadDetailsChapters(row.externalId, 1, state.detailsChapterLanguage, sequence);
}

async function applyLink(item, candidate, kind, sequence) {
  const row = await saveMangaDexLink(item, candidate, kind);
  const duplicate = await findOtherItemsForMangaDex(row.externalId, item.id);
  if (sequence !== state.detailsSequence) return row;
  state.detailsLink = row;
  state.link = idleLink();
  rerenderDetails(item);
  toast(kind === 'anilist-id' ? 'Linked to MangaDex by its AniList ID.' : duplicate ? 'Linked. This MangaDex title is also saved separately in your library.' : 'Linked to MangaDex.');
  await loadLinkedChapters(row, sequence);
  return row;
}

// Step 1: exact AniList ID. Step 2 (no exact match): show candidates and wait for the person to choose.
async function runLinkMatching(item, sequence) {
  const blocked = linkSearchDisabled();
  if (blocked) { state.link = { ...idleLink(), status: 'error', message: blocked }; rerenderDetails(item); return; }
  state.link = { ...idleLink(), status: 'searching', query: searchQueriesFor(item)[0] || item.title };
  rerenderDetails(item);
  try {
    const result = await findMangaDexMatch(item, { search: mangaDexSearch, filter: isRatingVisible });
    if (sequence !== state.detailsSequence) return;
    if (result.status === 'exact') { await applyLink(item, result.candidate, 'anilist-id', sequence); return; }
    state.link = { ...idleLink(), status: 'candidates', candidates: result.candidates, query: state.link.query, message: result.partialFailure ? 'Some searches failed, so this list may be incomplete.' : '' };
  } catch (error) {
    if (sequence !== state.detailsSequence) return;
    state.link = { ...idleLink(), status: 'error', query: state.link.query, message: chapterApiUnavailableMessage(error) };
  }
  rerenderDetails(item);
}

async function runLinkSearch(item, query, { changing = false } = {}) {
  const sequence = state.detailsSequence;
  const blocked = linkSearchDisabled();
  if (blocked) { state.link = { ...idleLink(), status: 'error', query, message: blocked, changing }; rerenderDetails(item); return; }
  state.link = { ...idleLink(), status: 'searching', query, changing };
  rerenderDetails(item);
  try {
    const result = await searchCandidates(item, query, { search: mangaDexSearch, filter: isRatingVisible });
    if (sequence !== state.detailsSequence) return;
    state.link = { ...idleLink(), status: 'candidates', candidates: result.candidates, query: result.query || query, changing };
  } catch (error) {
    if (sequence !== state.detailsSequence) return;
    state.link = { ...idleLink(), status: 'error', query, message: chapterApiUnavailableMessage(error), changing };
  }
  rerenderDetails(item);
}

function renderLinkPanel(item) {
  const link = state.link;
  const query = link.query || item.title || '';
  const form = `<form class="link-search" data-form="link-search" role="search"><label class="sr-only" for="linkQuery">Search MangaDex</label><input id="linkQuery" name="q" class="field" type="search" autocomplete="off" maxlength="100" value="${escapeHtml(query)}" placeholder="Search MangaDex by title"><button class="button" type="submit">Search</button></form>`;
  const cancel = link.changing ? '<button class="button-subtle" type="button" data-action="link-cancel">Keep current link</button>' : '';
  let body = '';
  if (link.status === 'searching') body = `<div class="empty-state chapter-empty"><span class="spinner"></span><strong>Looking for this title on MangaDex…</strong><span>Checking for a title that lists AniList ID ${escapeHtml(item.externalId)}.</span></div>`;
  else if (link.status === 'error') body = `<div class="notice warning"><strong>MangaDex search unavailable.</strong> ${escapeHtml(link.message)}</div>`;
  else if (link.status === 'idle') body = `<p class="muted">Chapters come from MangaDex. Link this AniList title to its MangaDex page to list and read them here.</p><div class="details-actions"><button class="button-primary" type="button" data-action="link-find">Find on MangaDex</button></div>`;
  else {
    const rows = link.candidates.map(candidate => {
      const url = safeMangaDexTitleUrl(candidate.sourceUrl);
      const badge = candidate.idStatus === 'exact' ? '<span class="pill-label accent">AniList ID matches</span>'
        : candidate.idStatus === 'other' ? `<span class="pill-label warn">MangaDex lists AniList #${escapeHtml(candidate.anilistId)} for this title</span>`
        : '<span class="pill-label">No AniList ID on MangaDex</span>';
      const meta = [candidate.releaseYear, candidate.publicationStatus !== 'unknown' ? candidate.publicationStatus : '', (candidate.authors || []).slice(0, 2).join(', ')].filter(Boolean).join(' · ');
      return `<article class="link-candidate"><div class="link-candidate-cover">${coverMarkup(candidate, true)}</div><div class="link-candidate-main"><strong>${escapeHtml(candidate.title)}</strong><small>${escapeHtml(meta || 'No details')}</small>${badge}${url ? `<a class="link-candidate-open" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Preview on MangaDex ↗</a>` : ''}</div><button class="button-primary button-small" type="button" data-action="link-select" data-md-id="${escapeHtml(candidate.externalId)}">${candidate.idStatus === 'other' ? 'Link anyway' : 'Link'}</button></article>`;
    }).join('');
    const intro = link.changing ? 'Choose the MangaDex title to use for chapters.' : `No MangaDex title lists AniList ID ${escapeHtml(item.externalId)}, so nothing was matched automatically. Pick the right title, or search by another name.`;
    body = `<p class="muted">${intro}</p>${link.message ? `<div class="notice warning">${escapeHtml(link.message)}</div>` : ''}${rows ? `<div class="link-candidates">${rows}</div>` : '<div class="empty-state chapter-empty"><strong>No MangaDex results.</strong><span>Try another spelling or the native title.</span></div>'}`;
  }
  return `<section class="chapter-panel link-panel"><div class="section-topline chapter-heading"><div><h3>Find chapters on MangaDex</h3><p>Chapter lists and the reader use MangaDex. Your AniList info stays as it is.</p></div></div>${form}${body}${cancel}</section>`;
}

function renderLinkBanner(row) {
  const url = safeMangaDexTitleUrl(row.sourceUrl);
  const how = row.linkKind === 'anilist-id' ? 'matched by AniList ID' : 'chosen by you';
  return `<div class="link-banner"><div><strong>Chapters from MangaDex</strong><small>${escapeHtml(row.sourceTitle || 'MangaDex title')} · ${how}</small></div><div class="link-banner-actions">${url ? `<a class="button button-small" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}<button class="button button-small" type="button" data-action="link-change">Change</button><button class="button button-small button-danger" type="button" data-action="link-remove">Unlink</button></div></div>`;
}

// Loads the whole chapter list (page after page) so it can be sorted and filtered as one list. The first page shows
// as soon as it arrives. If a title is very long, the rest waits behind a button.
async function loadDetailsChapters(externalId, startPage = 1, language = state.detailsChapterLanguage, sequence = state.detailsSequence) {
  const adapter = sourceRegistry.get('mangadex');
  if (!adapter?.allChapters || !externalId) return;
  const request = ++state.chapterSequence;
  const continuing = startPage > 1;
  const stale = () => request !== state.chapterSequence || sequence !== state.detailsSequence;
  state.detailsLoadingChapters = !continuing;
  state.detailsError = '';
  state.detailsChapterLanguage = language;
  if (!continuing) { state.detailsChapters = []; state.detailsChapterNext = null; state.chapterShown = 60; state.chapterMenuId = null; state.detailsChapterTotal = 0; }
  const base = continuing ? [...state.detailsChapters] : [];
  try { await refreshChapterMarks(); } catch (error) { console.warn('Chapter marks not loaded:', error); }
  if (stale()) return;
  renderDetailsContent(currentDetailsItem());
  try {
    const result = await adapter.allChapters(externalId, {
      language, startPage,
      onPage: ({ items, total }) => {
        if (stale()) return;
        state.detailsChapters = [...base, ...items];
        state.detailsChapterTotal = total;
        state.detailsLoadingChapters = false;
        renderDetailsContent(currentDetailsItem());
      }
    });
    if (stale()) return;
    state.detailsChapters = [...base, ...result.items];
    state.detailsChapterTotal = Math.max(result.total, state.detailsChapters.length);
    state.detailsChapterNext = result.nextPage;
  } catch (error) {
    if (stale()) return;
    state.detailsError = chapterApiUnavailableMessage(error);
  } finally {
    if (!stale()) {
      state.detailsLoadingChapters = false;
      renderDetailsContent(currentDetailsItem());
    }
  }
}

async function openDetails(contentItemId) {
  const item = [...state.results, ...state.library.map(row => row.item)].find(row => row?.id === contentItemId);
  if (!item) { toast('Title details are not cached yet. Search for it again.'); return; }
  const sequence = ++state.detailsSequence;
  state.detailsItemId = contentItemId;
  state.detailsLoading = true;
  state.detailsLoadingChapters = item.sourceId === 'mangadex';
  state.detailsLink = null;
  state.link = idleLink();
  state.detailsMetadataError = '';
  state.detailsError = '';
  state.detailsChapters = [];
  state.detailsChapterPage = 1;
  state.detailsChapterLanguage = state.settings?.preferredLanguage || 'en';
  state.detailsChapterPagination = { page: 1, limit: 24, total: 0, hasNext: false };
  state.detailsChapterNext = null; state.detailsChapterTotal = 0; state.chapterShown = 60;
  state.chapterOptionsOpen = false; state.chapterOptionsTab = 'filter'; state.chapterMenuId = null; state.chapterScanlator = '';
  state.detailsRead = new Set(); state.detailsBookmarks = new Set(); state.detailsPages = new Map();
  state.track = idleTrack();
  loadTrackSummary(item, sequence);
  renderDetailsContent(item);
  const dialog = document.getElementById('detailsDialog');
  if (!dialog.open) {
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    // The sheet gets its own history entry, so the Android Back button closes it instead of changing the page behind it.
    try { window.history.pushState({ tmlDetails: true }, '', window.location.href); state.detailsHistory = true; } catch { state.detailsHistory = false; }
  }

  // An AniList-only title borrows its chapters from a linked MangaDex record (see docs/LINKING.md).
  if (isLinkableAniListItem(item)) {
    try { state.detailsLink = await getMangaDexLink(item.id); } catch (error) { console.warn('Could not read the MangaDex link:', error); }
    if (sequence !== state.detailsSequence) return;
    state.detailsLoading = false;
    if (state.detailsLink) {
      state.detailsLoadingChapters = true;
      renderDetailsContent(item);
      await loadDetailsChapters(state.detailsLink.externalId, 1, state.detailsChapterLanguage, sequence);
    } else {
      state.detailsLoadingChapters = false;
      await runLinkMatching(item, sequence);
    }
    return;
  }

  if (item.sourceId !== 'mangadex' || !item.externalId) {
    state.detailsLoading = false;
    state.detailsLoadingChapters = false;
    state.detailsError = 'Chapter listing is available for compatible MangaDex catalogue entries only.';
    renderDetailsContent(item);
    return;
  }

  const adapter = sourceRegistry.get(item.sourceId);
  if (!adapter?.details || !adapter?.chapters) {
    state.detailsLoading = false;
    state.detailsLoadingChapters = false;
    state.detailsError = 'This source does not provide title detail and chapter-list capabilities yet.';
    renderDetailsContent(item);
    return;
  }

  // Fetch details and chapter metadata independently so a partial source failure remains useful.
  const detailsTask = (async () => {
    try {
      const freshRaw = await adapter.details(item.externalId);
      const [fresh] = await cacheCatalogueItems([freshRaw]);
      if (sequence !== state.detailsSequence) return;
      state.results = state.results.map(row => row.sourceId === fresh.sourceId && row.externalId === fresh.externalId ? fresh : row);
      state.library = state.library.map(row => row.contentItemId === fresh.id ? { ...row, item: fresh } : row);
      state.libraryById = new Map(state.library.map(row => [row.contentItemId, row]));
      renderDetailsContent(fresh);
    } catch (error) {
      if (sequence !== state.detailsSequence) return;
      state.detailsMetadataError = chapterApiUnavailableMessage(error);
    } finally {
      if (sequence === state.detailsSequence) {
        state.detailsLoading = false;
        renderDetailsContent(currentDetailsItem() || item);
      }
    }
  })();
  const chaptersTask = loadDetailsChapters(item.externalId, 1, state.detailsChapterLanguage, sequence);
  await Promise.allSettled([detailsTask, chaptersTask]);
}

function finishCloseDetails() {
  state.detailsSequence += 1;
  state.chapterSequence += 1;
  state.detailsLoading = false;
  state.detailsLoadingChapters = false;
  state.detailsHistory = false;
  const dialog = document.getElementById('detailsDialog');
  if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); } else dialog.removeAttribute('open');
}

// Close button, backdrop tap and Esc. When the sheet owns a history entry, going back removes it and the popstate handler finishes the job.
function closeDetails({ leaving = false } = {}) {
  if (!state.detailsHistory) { finishCloseDetails(); return; }
  if (leaving) { finishCloseDetails(); return; } // the caller replaces the sheet's history entry itself
  window.history.back();
}

function handleDetailsPopState() {
  const dialog = document.getElementById('detailsDialog');
  if (state.detailsHistory && dialog?.open) finishCloseDetails();
  else state.detailsHistory = false;
}

async function toggleLibrary(itemId) {
  const item = [...state.results, ...state.library.map(row => row.item)].find(row => row?.id === itemId);
  if (!item) { toast('Title unavailable. Search again to reload its metadata.'); return; }
  const existing = getLibraryEntry(itemId);
  if (existing) {
    await removeFromLibrary(itemId);
    toast('Removed from your library. Progress and cached metadata are preserved.');
  } else {
    await addToLibrary(item, 'planned');
    queueAniListPush(item.id);
    toast('Added to your local library.');
  }
  await refreshLibraryIndex();
  await app.navigate(app.currentRoute());
  if (document.getElementById('detailsDialog').open) openDetails(itemId);
}

async function markReading(itemId) {
  const item = [...state.results, ...state.library.map(row => row.item)].find(row => row?.id === itemId);
  if (!item) { toast('Title unavailable. Search again to reload its metadata.'); return; }
  await setLibraryStatus(item, 'reading');
  queueAniListPush(item.id);
  await refreshLibraryIndex();
  toast('Status saved as Reading.');
  await app.navigate(app.currentRoute());
  if (document.getElementById('detailsDialog').open) openDetails(itemId);
}

// Collections are chosen and named in a small in-app sheet (no typing numbers into a browser prompt box).
function renderCollectionSheet() {
  const itemId = state.sheetItemId;
  const picks = itemId && state.collections.length
    ? `<h3 class="sheet-label">Add to a collection</h3><div class="sheet-list">${state.collections.map(c => `<button class="row sheet-row" type="button" data-action="collection-add" data-collection-id="${escapeHtml(c.id)}"><span class="row-copy"><strong>${escapeHtml(c.name)}</strong></span></button>`).join('')}</div>`
    : '';
  document.getElementById('sheetContent').innerHTML = `<h2 id="sheetTitle">${itemId ? 'Collections' : 'New collection'}</h2>${picks}
    <form class="sheet-form" data-form="collection-new"><h3 class="sheet-label">${picks ? 'Or start a new one' : 'Name your collection'}</h3><label class="sr-only" for="collectionName">Collection name</label><input class="field" id="collectionName" name="name" type="text" maxlength="80" autocomplete="off" placeholder="For example, Weekend reads" required><p class="sheet-error" id="collectionError" role="alert"></p><button class="button-primary" type="submit">${itemId ? 'Create and add' : 'Create'}</button></form>`;
}

async function openCollectionSheet(contentItemId = null) {
  state.collections = await getCollections();
  state.sheetItemId = contentItemId;
  renderCollectionSheet();
  const dialog = document.getElementById('sheetDialog');
  if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
  document.getElementById('collectionName')?.focus();
}

function closeCollectionSheet() {
  const dialog = document.getElementById('sheetDialog');
  if (typeof dialog.close === 'function') { if (dialog.open) dialog.close(); } else dialog.removeAttribute('open');
}

async function submitNewCollection(form) {
  const name = String(new FormData(form).get('name') || '');
  const error = document.getElementById('collectionError');
  try {
    const collection = await createCollection(name);
    if (state.sheetItemId) await addItemToCollection(collection.id, state.sheetItemId);
    state.selectedCollectionId = collection.id;
    state.collections = await getCollections();
    closeCollectionSheet();
    await app.navigate('library');
    toast(state.sheetItemId ? `Created ${collection.name} and added the title.` : 'Collection created.');
  } catch (caught) { if (error) error.textContent = caught?.message || 'Could not create the collection.'; }
}

async function addToExistingCollection(collectionId) {
  const collection = state.collections.find(c => c.id === collectionId);
  if (!collection || !state.sheetItemId) return;
  await addItemToCollection(collection.id, state.sheetItemId);
  state.selectedCollectionId = collection.id;
  closeCollectionSheet();
  toast(`Added to ${collection.name}.`);
  await app.navigate('library');
}

async function downloadBackup() {
  const backup = await exportBackup();
  const result = await saveBackupFile(backup);
  toast(result === 'shared' ? 'Choose where to save your backup. Keep a copy outside this app.' : 'Backup exported. Keep a copy outside this browser.');
}

async function uploadBackupFile(file) {
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) throw new Error('Backup is larger than 25 MB. For safety, import a smaller metadata backup.');
  const data = JSON.parse(await file.text());
  if (!window.confirm('Merge this Tokyo Manga Lab backup into this device? Items that are newer here are kept.')) return;
  const summary = await importBackup(data);
  await refreshLibraryIndex();
  state.settings = await loadSettings();
  configureAdult(state.settings.adultContentEnabled);
  applyTheme();
  await app.navigate(app.currentRoute());
  toast(summary.keptNewer ? `Backup imported. ${summary.keptNewer} newer item${summary.keptNewer === 1 ? '' : 's'} on this device ${summary.keptNewer === 1 ? 'was' : 'were'} kept.` : 'Backup imported. Check your library and settings.');
}

function applyTheme() {
  const theme = findTheme(state.settings?.theme);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.coverSize = state.settings?.coverSize === 'compact' ? 'compact' : 'comfortable';
  root.style.colorScheme = theme.scheme;
  root.classList.toggle('reduce-motion', Boolean(state.settings?.reducedMotion));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bar);
}

// Adult MangaDex ratings: Android app only, off by default, and never age verification.
const ADULT_RATINGS = new Set(['erotica', 'pornographic']);
function isRatingVisible(item) { return !ADULT_RATINGS.has(item?.contentRating) || adultActive(); }

async function handleSettingChange(input) {
  const key = input.dataset.setting;
  if (!key) return;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  if (key === 'adultContentEnabled' && value) {
    if (!runningInApp()) {
      input.checked = false;
      toast('Adult titles are only available in the Android app. The web version stays family-friendly.');
      return;
    }
    if (!window.confirm('Show adult (erotica and pornographic) titles from MangaDex?\n\nThis is only a preference on this device. It is not age verification. Only continue if you are old enough under the laws where you live.')) {
      input.checked = false;
      return;
    }
  }
  await saveSetting(key, value);
  state.settings = { ...state.settings, [key]: value };
  applyTheme();
  if (key === 'adultContentEnabled') {
    configureAdult(value);
    state.results = [];
    await app.navigate(app.currentRoute());
    loadSearch(state.query, 1);
    toast(value ? 'Adult titles enabled in this app.' : 'Adult titles hidden.');
  } else toast('Setting saved on this device.');
}

async function checkApi() {
  const result = document.getElementById('apiTestResult');
  if (result) result.textContent = 'Testing connection…';
  try {
    const adapter = sourceRegistry.get('mangadex');
    if (!adapter) throw new Error('MangaDex adapter is not registered.');
    const { apiClient } = await import('./services/api-client.js');
    const health = await apiClient.health();
    setConnectionStatus('online', 'MangaDex online');
    if (result) result.textContent = `API responded: ${health.service || 'Tokyo Manga Lab catalogue API'}.`;
    toast('Catalogue API is reachable.');
  } catch (error) {
    setConnectionStatus('offline', 'Catalogue offline');
    if (result) result.textContent = error.message || 'The API could not be reached.';
    toast('Catalogue API check failed.');
  }
}

async function handleAction(action, target) {
  const id = target.dataset.id;
  switch (action) {
    case 'toggle-theme': {
      const theme = nextTheme(state.settings?.theme);
      await saveSetting('theme', theme.id);
      state.settings = { ...state.settings, theme: theme.id };
      applyTheme();
      toast(`${theme.name} theme.`);
      if (app.currentRoute() === 'settings') await app.navigate('settings');
      break;
    }
    case 'search-submit': {
      const form = target.closest('form');
      if (form) runSearchFromForm(form);
      break;
    }
    case 'save': await toggleLibrary(id); break;
    case 'mark-reading': await markReading(id); break;
    case 'details': openDetails(id); break;
    case 'close-details': closeDetails(); break;
    case 'read-chapter': startReading(target.dataset.chapterId); break;
    case 'reader-tips-reset': resetTips(); toast('The reader tips will show next time you open a chapter.'); break;
    case 'chapter-options-toggle': state.chapterOptionsOpen = !state.chapterOptionsOpen; redrawDetails(); break;
    case 'chapter-options-tab': state.chapterOptionsTab = ['filter', 'sort', 'display'].includes(target.dataset.tab) ? target.dataset.tab : 'filter'; redrawDetails(); break;
    case 'chapter-sort': {
      const view = currentChapterView();
      const key = target.dataset.sortKey;
      if (key === view.sortKey) await setChapterView({ sortDir: view.sortDir === 'asc' ? 'desc' : 'asc' });
      else await setChapterView({ sortKey: key, sortDir: 'desc' });
      break;
    }
    case 'chapter-filters-clear': await setChapterView({ unread: false, bookmarked: false, scanlator: '' }); break;
    case 'chapter-show-more': state.chapterShown += 60; redrawDetails(); break;
    case 'chapter-load-rest': { const sourceId = chapterSourceFor(currentDetailsItem()); if (sourceId && state.detailsChapterNext) await loadDetailsChapters(sourceId, state.detailsChapterNext); break; }
    case 'chapter-menu': state.chapterMenuId = state.chapterMenuId === target.dataset.chapterId ? null : target.dataset.chapterId; redrawDetails(); break;
    case 'chapter-mark': await markChaptersRead([target.dataset.chapterId], target.dataset.read === '1'); break;
    case 'chapter-mark-previous': await markChaptersRead([target.dataset.chapterId, ...chaptersBefore(state.detailsChapters, target.dataset.chapterId).map(chapter => chapter.externalId)], true); break;
    case 'chapter-bookmark': { const item = currentDetailsItem(); if (item) { await setBookmark(item.id, target.dataset.chapterId, target.dataset.on === '1'); await refreshChapterMarks(); state.chapterMenuId = null; redrawDetails(); toast(target.dataset.on === '1' ? 'Bookmarked.' : 'Bookmark removed.'); } break; }
    case 'track-toggle': await toggleTracking(); break;
    case 'track-close': state.track = { ...state.track, open: false }; redrawDetails(); break;
    case 'track-step': { const row = state.track?.row; const next = Math.max(0, (Number(row?.progress) || 0) + Number(target.dataset.delta || 0)); await commitTracking({ progress: next }); break; }
    case 'track-link': await linkTrackTitle(target.dataset.mediaId); break;
    case 'track-unlink': await unlinkTrackTitle(); break;
    case 'track-go-settings': closeDetails(); break;
    case 'link-find': { const item = currentDetailsItem(); if (isLinkableAniListItem(item)) await runLinkMatching(item, state.detailsSequence); break; }
    case 'link-select': await selectLinkCandidate(target.dataset.mdId); break;
    case 'link-change': { const item = currentDetailsItem(); if (isLinkableAniListItem(item)) await runLinkSearch(item, item.title, { changing: true }); break; }
    case 'link-cancel': { state.link = idleLink(); rerenderDetails(currentDetailsItem()); break; }
    case 'link-remove': await unlinkMangaDex(); break;
    case 'retry-search': await loadSearch(state.query, state.page); break;
    case 'clear-search': state.genre = 'all'; await loadSearch('', 1); break;
    case 'genre-filter': state.genre = target.dataset.genre || 'all'; await app.navigate('discover'); break;
    case 'page-back': if (state.page > 1) await loadSearch(state.query, state.page - 1); break;
    case 'page-next': if (state.pagination.hasNext) await loadSearch(state.query, state.page + 1); break;
    case 'create-collection': await openCollectionSheet(null); break;
    case 'sheet-close': closeCollectionSheet(); break;
    case 'collection-add': await addToExistingCollection(target.dataset.collectionId); break;
    case 'select-collection': state.selectedCollectionId = target.dataset.id || ''; await app.navigate('library'); break;
    case 'favorite': await toggleFavorite(id); await refreshLibraryIndex(); await app.navigate('library'); toast('Favourite updated.'); break;
    case 'remove': if (window.confirm('Remove this title from your library? Cached metadata, imported files and bookmarks will be preserved.')) { await removeFromLibrary(id); await refreshLibraryIndex(); await app.navigate('library'); toast('Removed from your library.'); } break;
    case 'add-collection': await openCollectionSheet(id); break;
    case 'export-backup': await downloadBackup(); break;
    case 'import-backup': document.getElementById('backupFileInput').click(); break;
    case 'open-settings': window.location.hash = '#settings'; break;
    case 'planned-feature': toast(`${target.dataset.title || 'This feature'} is planned and not available yet.`); break;
    case 'check-api': await checkApi(); break;
    case 'anilist-connect': await startAniListSignIn(); break;
    case 'anilist-register': openAniListPage(ANILIST_REGISTER_URL); break;
    case 'anilist-apps': openAniListPage(ANILIST_APPS_URL); break;
    case 'anilist-card-hide': setAnilistCardHidden(true); await app.navigate('profile'); break;
    case 'anilist-card-show': setAnilistCardHidden(false); await app.navigate('profile'); break;
    case 'anilist-paste-token': await pasteAniListToken(); break;
    case 'anilist-sync': await syncAniList(); break;
    case 'anilist-disconnect': await signOutAniList(); break;
    case 'retry-screen': await app.navigate(app.currentRoute()); break;
    default: break;
  }
}

function bindUiEvents() {
  document.addEventListener('click', async event => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    if (action === 'search-submit') event.preventDefault();
    try { await handleAction(action, actionElement); }
    catch (error) { console.error(error); toast(error?.message || 'That action could not be completed.'); }
  });

  document.addEventListener('submit', event => {
    const collectionForm = event.target.closest('form[data-form="collection-new"]');
    if (collectionForm) { event.preventDefault(); submitNewCollection(collectionForm); return; }
    const trackForm = event.target.closest('form[data-form="track-search"]');
    if (trackForm) { event.preventDefault(); runTrackSearch(new FormData(trackForm).get('q')); return; }
    const linkForm = event.target.closest('form[data-form="link-search"]');
    if (linkForm) {
      event.preventDefault();
      const item = currentDetailsItem();
      if (isLinkableAniListItem(item)) runLinkSearch(item, new FormData(linkForm).get('q'), { changing: state.link.changing });
      return;
    }
    const form = event.target.closest('form[data-form="search"]');
    if (!form) return;
    event.preventDefault();
    runSearchFromForm(form);
  });

  document.addEventListener('input', event => {
    const input = event.target;
    if (input.matches('#settingsSearch')) { runSettingsSearch(input.value); return; }
    if (!input.matches('#homeSearch, #discoverSearch')) return;
    state.query = input.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      if (app.currentRoute() !== 'discover') window.location.hash = '#discover';
      loadSearch(state.query, 1);
    }, 550);
  });

  document.addEventListener('change', async event => {
    const input = event.target;
    try {
      if (input.matches('[data-setting]')) await handleSettingChange(input);
      else if (input.matches('[data-library-status]')) {
        const itemId = input.dataset.libraryStatus;
        const row = state.library.find(entry => entry.contentItemId === itemId);
        const item = row?.item || state.results.find(entry => entry.id === itemId);
        if (item) { await setLibraryStatus(item, input.value); queueAniListPush(item.id); await refreshLibraryIndex(); await app.navigate('library'); toast('Reading status updated.'); }
      } else if (input.matches('[data-chapter-view]')) {
        const name = input.dataset.chapterView;
        if (name === 'display') await setChapterView({ display: input.value });
        else if (name === 'scanlator') await setChapterView({ scanlator: input.value });
        else await setChapterView({ [name]: input.checked });
      } else if (input.matches('[data-track-field]')) {
        await onTrackField(input);
      } else if (input.matches('[data-action="chapter-language"]')) {
        const sourceId = chapterSourceFor(currentDetailsItem());
        if (sourceId) await loadDetailsChapters(sourceId, 1, input.value);
      } else if (input.matches('[data-action="status-filter"]')) {
        state.libraryStatusFilter = input.value;
        await app.navigate('library');
      }
    } catch (error) { console.error(error); toast(error?.message || 'Could not save that change.'); }
  });

  document.getElementById('detailsDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeDetails();
  });
  // Esc closes through the same path, so the cleanup and the history entry stay in step.
  document.getElementById('detailsDialog').addEventListener('cancel', event => { event.preventDefault(); closeDetails(); });
  window.addEventListener('popstate', handleDetailsPopState);
  // Changes that were waiting for AniList go out as soon as the phone is back online.
  window.addEventListener('online', () => { checkConnection(); if (state.anilist.status.connected) flushOutbox().catch(error => console.warn('AniList outbox not sent:', error.message)); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.getElementById('connectionStatus')?.dataset.state === 'offline') checkConnection(); });
  // The reader tells us when a chapter was finished.
  document.addEventListener('tml:chapter-read', event => { onChapterRead(event.detail).catch(error => console.warn('Tracking after reading failed:', error)); });
  document.getElementById('backupFileInput').addEventListener('change', async event => {
    const input = event.currentTarget;
    try { await uploadBackupFile(input.files?.[0]); }
    catch (error) { toast(error?.message || 'Could not import backup.'); }
    finally { input.value = ''; }
  });
}

// The opening screen stays up for a moment (so it reads as a launch screen, not a flash), then fades out.
const SPLASH_MIN_MS = 1200;
const splashStart = Date.now();
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const leave = () => { splash.classList.add('is-leaving'); setTimeout(() => splash.remove(), 600); };
  // Automated browser tests skip the wait so they never click through an overlay.
  if (navigator.webdriver) { splash.remove(); return; }
  setTimeout(leave, Math.max(0, SPLASH_MIN_MS - (Date.now() - splashStart)));
}

async function initialize() {
  hydrateIcons();
  bindUiEvents();
  try {
    await openDatabase();
    const migration = await migrateLegacyLocalStorage();
    if (migration.migrated) console.info(`Migrated ${migration.count} local library entries from the previous version.`);
    state.settings = await loadSettings();
    configureAdult(state.settings.adultContentEnabled);
    applyTheme();
    await refreshLibraryIndex();
    await refreshAniList();
    await listenForAppLinks(handleAniListRedirect);
    bindNavigation(route => { app.navigate(route); });
    hideSplash();
    // Show the screen first; the catalogue fills in when it answers, so a slow connection never blocks the app.
    await app.navigate(getCurrentRoute());
    loadSearch('', 1).catch(error => console.warn('First catalogue load failed:', error?.message));
    try {
      const { apiClient, onApiStatus } = await import('./services/api-client.js');
      onApiStatus(handleApiStatus);
      const health = await apiClient.health();
      setConnectionStatus('online', 'MangaDex online');
      console.info('Tokyo Manga Lab API ready:', health.service || 'health check passed');
    } catch (error) {
      setConnectionStatus('offline', 'Catalogue offline');
      scheduleReconnect();
      console.warn('Catalogue health check failed:', error.message);
    }
    if (state.anilist.status.connected) flushOutbox().catch(error => console.warn('AniList outbox not sent:', error.message));
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(APP_VERSION)}`).catch(error => console.warn('Offline app-shell registration skipped:', error));
    }
  } catch (error) {
    console.error('Tokyo Manga Lab initialization failed:', error);
    hideSplash();
    root.innerHTML = `<section class="surface surface-pad"><h2>Local storage could not start</h2><p>${escapeHtml(error.message || 'Your browser could not open the local database.')}</p><p>Open this site through a web server or GitHub Pages and try again in a current browser.</p><button class="button" data-action="retry-screen">Retry</button></section>`;
  }
}

initialize();
