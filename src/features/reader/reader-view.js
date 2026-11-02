import { escapeHtml } from '../../shared/utils.js';
import { icon } from '../../shared/icons.js';
import { buildPageUrls, clampPage, isChapterId, pagesExpired, pickQuality, shouldReport } from './reader-pages.js';
import { sendReport } from './reader-report.js';
import { describeFailure, fetchImageNative, shortDetails } from './reader-native.js';
import { loadChapterProgress, recordReadingSession, saveChapterProgress } from './reader-progress.js';
import { MIN_ZOOM, clampZoom, doubleTapTarget, formatZoom, isDoubleTap, isZoomed, pinchZoom, scrollToKeepFocus, stepZoom } from './reader-zoom.js';
import {
  AUTO_SPEEDS, autoSpeed, findNeighbor, formatStatusLine, getBatteryReader, markTipsSeen, setOrientation,
  setStatusBarVisible, setVolumeCapture, shareLink, tipsSeen, volumeAction
} from './reader-features.js';

const MODES = ['scroll', 'rtl', 'ltr'];
const PRELOAD_AHEAD = 2;
const MIN_ERROR_REFRESH_GAP_MS = 3000; // spacing between refreshes triggered by failing images
const MAX_ERROR_REFRESHES = 4;         // per chapter visit, so a broken node cannot cause a request storm
const CLOCK_INTERVAL_MS = 30000;
// Setting key -> option name used inside the reader.
const TOGGLES = Object.freeze({
  readerShowStatusBar: 'showStatusBar',
  readerShowClock: 'showClock',
  readerVolumeKeys: 'volumeKeys',
  readerChapterNotice: 'chapterNotice',
  readerSkipExtras: 'skipExtras'
});

export function renderReaderShell() {
  return `<section class="reader" id="readerRoot" aria-label="Manga reader"><div class="reader-status"><span class="spinner"></span><p>Opening chapter…</p></div></section>`;
}

function chapterLabel(chapter) {
  return chapter?.label || 'Chapter';
}

// Decide by the Worker's error code, not the HTTP status: a 404 can mean an old Worker without the page
// endpoint, or just a chapter MangaDex has no readable pages for.
export function friendlyError(error) {
  const code = error?.code;
  if (code === 'CHAPTER_EXTERNAL') return { title: 'Hosted on another site', text: 'This chapter is not served by MangaDex, so it cannot be shown here. Open it from the source link.' };
  if (code === 'CHAPTER_UNAVAILABLE') {
    return { title: 'This chapter is not available', text: `${error?.message || 'MangaDex has no readable pages for it.'} MangaDex may have removed or restricted it. Try another chapter, or open it on MangaDex.` };
  }
  if (error?.status === 404) return { title: 'Reader not available yet', text: 'The catalogue API does not offer chapter pages yet. If you host the Worker yourself, deploy the updated version, then try again.' };
  if (code === 'RATE_LIMITED') return { title: 'Slow down a moment', text: 'MangaDex is rate-limiting requests. Wait a few seconds and try again.' };
  return { title: 'Could not open this chapter', text: error?.message || 'Check your connection and try again.' };
}

/**
 * Mounts the reader into `host`. Dependencies are passed in so this file never imports the app,
 * which keeps it testable and avoids circular imports.
 * Returns { destroy }.
 */
export function mountReader(host, { chapterId, context, settings, loadPages, onClose, onHistory, onOpenChapter, onSetting, onOpenSettings }) {
  const chapters = Array.isArray(context?.chapters) ? context.chapters : [];
  const position = chapters.findIndex(chapter => chapter.id === chapterId);
  const current = position >= 0 ? chapters[position] : null;
  const contentItemId = context?.contentItemId || null;
  const isApp = Boolean(window.Capacitor?.isNativePlatform?.());

  const view = {
    pages: null, urls: [], page: 0, total: 0, ended: false,
    mode: MODES.includes(settings?.readerMode) ? settings.readerMode : 'scroll',
    quality: settings?.readerQuality === 'data-saver' ? 'data-saver' : 'data',
    fit: settings?.readerFit === 'height' ? 'height' : 'width',
    opts: {
      showStatusBar: settings?.readerShowStatusBar !== false,
      showClock: Boolean(settings?.readerShowClock),
      volumeKeys: Boolean(settings?.readerVolumeKeys),
      chapterNotice: Boolean(settings?.readerChapterNotice),
      skipExtras: Boolean(settings?.readerSkipExtras),
      orientation: ['portrait', 'landscape'].includes(settings?.readerOrientation) ? settings.readerOrientation : 'auto',
      autoSpeed: autoSpeed(settings?.readerAutoSpeed).id
    },
    uiVisible: true, sheetOpen: false, tips: false, destroyed: false,
    refreshing: null, lastRefresh: 0, lastErrorRefresh: 0, errorRefreshes: 0,
    startedAt: Date.now(), activeSeconds: 0, saveTimer: null, observer: null, loadObserver: null,
    statusHidden: false, orientationLocked: false, clockTimer: 0, battery: null,
    zoom: MIN_ZOOM, lastTap: null, pinch: null
  };
  const auto = { on: false, paused: false, raf: 0, timer: 0, last: 0, carry: 0 };
  const controller = new AbortController();
  const started = new Map(); // index -> { start, url, retried }
  const blobUrls = new Map(); // index -> object URL for pages loaded through the app's own network layer

  const sourceUrl = isChapterId(chapterId) ? `https://mangadex.org/chapter/${encodeURIComponent(chapterId)}` : '';
  const nextChapter = () => findNeighbor(chapters, position, 'next', view.opts.skipExtras);
  const prevChapter = () => findNeighbor(chapters, position, 'prev', view.opts.skipExtras);

  function setStatus(html) { host.innerHTML = `<div class="reader-status">${html}</div>`; }

  function toast(text, ms = 2600) {
    host.querySelector('.reader-toast')?.remove();
    const note = document.createElement('div');
    note.className = 'reader-toast';
    note.textContent = text;
    host.appendChild(note);
    window.setTimeout(() => note.remove(), ms);
  }

  function showError(error) {
    const { title, text } = friendlyError(error);
    setStatus(`<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p><div class="reader-status-actions"><button class="button" data-reader="retry">Try again</button>${sourceUrl ? `<a class="button" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open on MangaDex ↗</a>` : ''}<button class="button-subtle" data-reader="close">Back</button></div>`);
  }

  // ---- page URL management -------------------------------------------------------------
  async function fetchPages() {
    const pages = await loadPages(chapterId, { signal: controller.signal });
    if (view.pages?.release && view.pages !== pages) view.pages.release();
    view.pages = pages;
    view.quality = pages.offline ? (pages.quality === 'data-saver' ? 'data-saver' : 'data') : pickQuality(pages, view.quality);
    view.urls = buildPageUrls(pages, view.quality);
    view.total = view.urls.length;
    view.lastRefresh = Date.now();
  }

  // Single-flight refresh so several failing images trigger one request.
  // `expiry` (URLs aged out) and `manual` (the person tapped retry) are always allowed; refreshes caused by
  // failing images are rate-limited and capped so a broken node cannot make the app hammer the API.
  function refreshPages({ expiry = false, manual = false } = {}) {
    if (view.pages?.offline) return Promise.resolve(false); // saved pages have nothing to refresh
    if (view.refreshing) return view.refreshing;
    if (!expiry && !manual) {
      if (view.errorRefreshes >= MAX_ERROR_REFRESHES || Date.now() - view.lastErrorRefresh < MIN_ERROR_REFRESH_GAP_MS) return Promise.resolve(false);
      view.errorRefreshes += 1;
      view.lastErrorRefresh = Date.now();
    }
    view.refreshing = fetchPages().then(() => true).catch(() => false).finally(() => { view.refreshing = null; });
    return view.refreshing;
  }

  async function urlFor(index) {
    if (pagesExpired(view.pages)) await refreshPages({ expiry: true });
    return view.urls[index];
  }

  // ---- image loading + MangaDex reports ------------------------------------------------
  function resourceBytes(url) {
    try {
      const entries = performance.getEntriesByName(url);
      const entry = entries[entries.length - 1];
      return entry ? (entry.encodedBodySize || 0) : 0; // 0 when the browser hides cross-origin sizes.
    } catch { return 0; }
  }

  async function loadImage(img) {
    const index = Number(img.dataset.index);
    if (!Number.isFinite(index) || img.dataset.state === 'loading' || img.dataset.state === 'done') return;
    img.dataset.state = 'loading';
    if (blobUrls.has(index)) { img.src = blobUrls.get(index); return; }
    const url = await urlFor(index);
    if (view.destroyed || !url) return;
    started.set(index, { start: performance.now(), url, retried: started.get(index)?.retried || false });
    img.src = url;
  }

  function onImageLoad(img) {
    const index = Number(img.dataset.index);
    img.dataset.state = 'done';
    const info = started.get(index);
    if (info && shouldReport(info.url) && img.dataset.native !== '1') {
      sendReport({ url: info.url, success: true, cached: false, bytes: resourceBytes(info.url), duration: performance.now() - info.start });
    }
  }

  // Shows a page that the WebView would not load, using the app's own network layer.
  async function recoverWithNativeFetch(img, index, url) {
    const result = await fetchImageNative(url);
    if (result.ok) {
      const objectUrl = URL.createObjectURL(result.blob);
      blobUrls.set(index, objectUrl);
      if (shouldReport(url)) sendReport({ url, success: true, cached: result.cached, bytes: result.bytes, duration: result.duration });
      if (!view.destroyed) { img.dataset.native = '1'; img.dataset.state = 'loading'; img.src = objectUrl; }
    }
    return result;
  }

  async function onImageError(img) {
    const index = Number(img.dataset.index);
    if (img.dataset.native === '1') { // the app-network copy would not decode either
      img.dataset.state = 'failed';
      showFailure(img, index, { ok: false, available: true, status: 0, error: 'not-image' });
      return;
    }
    if (view.pages?.offline) { // a saved page that will not show: nothing to ask the network for
      img.dataset.state = 'failed';
      showFailure(img, index, { ok: false, available: false, status: 0, error: 'offline-copy' });
      return;
    }
    const info = started.get(index);
    if (info && shouldReport(info.url)) sendReport({ url: info.url, success: false, bytes: 0, duration: performance.now() - info.start });
    if (view.destroyed || !info) return;
    // First, ask the app's network layer for the same address. If that works the WebView was the problem.
    const result = await recoverWithNativeFetch(img, index, info.url);
    if (result.ok || view.destroyed) return;
    // Otherwise the address may have expired: get fresh ones once and try again.
    if (!info.retried) {
      info.retried = true;
      const refreshed = await refreshPages();
      if (refreshed && !view.destroyed && view.urls[index]) {
        started.set(index, { start: performance.now(), url: view.urls[index], retried: true });
        img.dataset.state = 'loading';
        img.src = view.urls[index];
        return;
      }
    }
    img.dataset.state = 'failed';
    showFailure(img, index, result);
  }

  function hostOf(url) { try { return new URL(url).host; } catch { return ''; } }

  function showFailure(img, index, result) {
    const holder = img.closest('.reader-slot');
    if (!holder || holder.querySelector('.reader-retry')) return;
    const server = hostOf(started.get(index)?.url || view.urls[index]);
    holder.insertAdjacentHTML('beforeend', `<div class="reader-retry"><p>${escapeHtml(describeFailure(result, server))}</p><small>${escapeHtml(shortDetails(result))}</small><button class="button" data-reader="retry-image" data-index="${index}">Retry page ${index + 1}</button></div>`);
  }

  function bindImage(img) {
    img.addEventListener('load', () => onImageLoad(img));
    img.addEventListener('error', () => onImageError(img));
  }

  async function retryImage(index) {
    const img = host.querySelector(`.reader-img[data-index="${index}"]`);
    if (!img) return;
    img.closest('.reader-slot')?.querySelector('.reader-retry')?.remove();
    img.dataset.native = '';
    if (blobUrls.has(index)) { URL.revokeObjectURL(blobUrls.get(index)); blobUrls.delete(index); }
    const info = started.get(index) || { retried: false };
    started.set(index, { ...info, retried: false });
    await refreshPages({ manual: true });
    img.dataset.state = '';
    await loadImage(img);
  }

  // ---- markup --------------------------------------------------------------------------
  function slotMarkup(index) {
    return `<div class="reader-slot" data-slot="${index}"><img class="reader-img" data-index="${index}" alt="Page ${index + 1} of ${view.total}" decoding="async" referrerpolicy="no-referrer" draggable="false"></div>`;
  }

  function endCardMarkup() {
    const next = nextChapter();
    return `<div class="reader-end" data-end="true"><h3>End of ${escapeHtml(chapterLabel(current))}</h3><div class="reader-status-actions">${next ? `<button class="button" data-reader="next-chapter">Next: ${escapeHtml(chapterLabel(next))}</button>` : ''}<button class="button-subtle" data-reader="close">Back to title</button></div>${next ? '' : '<p class="muted">No newer chapter in the list you opened this from.</p>'}</div>`;
  }

  function barMarkup() {
    return `<header class="reader-bar" ${view.uiVisible ? '' : 'hidden'}>
      <button class="icon-button" data-reader="close" aria-label="Close reader">${icon('chevronLeft')}</button>
      <div class="reader-title"><strong>${escapeHtml(context?.title || 'Reading')}</strong><small>${escapeHtml(chapterLabel(current))}</small></div>
      <button class="icon-button" data-reader="sheet-open" aria-label="Reader options" aria-haspopup="dialog">${icon('sliders')}</button>
    </header>`;
  }

  function footMarkup() {
    const shown = Math.min(view.page + 1, view.total);
    return `<footer class="reader-foot" ${view.uiVisible ? '' : 'hidden'}>
      <button class="button-subtle" data-reader="prev-chapter" ${prevChapter() ? '' : 'disabled'} aria-label="Previous chapter">‹ Prev</button>
      <label class="reader-slider"><span class="reader-count" id="readerCount">${shown} / ${view.total}</span><input type="range" min="1" max="${Math.max(1, view.total)}" value="${shown}" data-reader="seek" aria-label="Go to page" ${view.mode === 'rtl' ? 'dir="rtl"' : ''}></label>
      <button class="button-subtle" data-reader="next-chapter" ${nextChapter() ? '' : 'disabled'} aria-label="Next chapter">Next ›</button>
    </footer>`;
  }

  function attribution() {
    const groups = Array.isArray(current?.groups) && current.groups.length ? `Group: ${escapeHtml(current.groups.join(', '))} · ` : '';
    return `<p class="reader-credit">${groups}Pages are served by MangaDex and are not stored by this app. ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open on MangaDex ↗</a>` : ''}</p>`;
  }

  function segment(value, label, active, action, glyph = '') {
    return `<button class="reader-seg${active ? ' is-on' : ''}" data-reader="${action}" data-value="${escapeHtml(value)}" aria-pressed="${active}">${glyph ? `<span aria-hidden="true">${glyph}</span>` : ''}${escapeHtml(label)}</button>`;
  }

  function switchRow(key, title, hint, requiresApp = false) {
    const name = TOGGLES[key];
    const on = Boolean(view.opts[name]);
    const note = requiresApp && !isApp ? ' (Android app only)' : '';
    return `<div class="reader-row"><div class="reader-row-text"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(hint)}${note}</small></div><button class="reader-switch" role="switch" aria-checked="${on}" aria-label="${escapeHtml(title)}" data-reader="toggle" data-key="${key}"><span></span></button></div>`;
  }

  function sheetMarkup() {
    const o = view.opts;
    const speed = autoSpeed(o.autoSpeed);
    return `<div class="reader-sheet-backdrop" data-reader="sheet-close"></div>
    <div class="reader-sheet" role="dialog" aria-modal="true" aria-label="Reader options">
      <div class="reader-sheet-head"><strong>Reader options</strong><button class="button-subtle" data-reader="sheet-close">Done</button></div>
      <div class="reader-sheet-body">
        <div class="reader-group"><span class="reader-group-label">Reading mode</span><div class="reader-segs">
          ${segment('ltr', 'Left to right', view.mode === 'ltr', 'set-mode', '→')}${segment('rtl', 'Right to left', view.mode === 'rtl', 'set-mode', '←')}${segment('scroll', 'Vertical', view.mode === 'scroll', 'set-mode', '↕')}
        </div></div>
        <div class="reader-group"><span class="reader-group-label">Image quality</span><div class="reader-segs">
          ${segment('data', 'Original', view.quality === 'data', 'set-quality')}${segment('data-saver', 'Data saver', view.quality === 'data-saver', 'set-quality')}
        </div></div>
        <div class="reader-group"><span class="reader-group-label">Zoom</span><div class="reader-row"><div class="reader-row-text"><strong>Pinch or double-tap the page</strong><small>Or use the buttons.</small></div><div class="reader-zoom-buttons"><button class="button-subtle" data-reader="zoom-out" aria-label="Zoom out">−</button><span class="reader-zoom-label" aria-live="polite">${escapeHtml(formatZoom(view.zoom))}</span><button class="button-subtle" data-reader="zoom-in" aria-label="Zoom in">+</button></div></div></div>
        <div class="reader-group"><span class="reader-group-label">Auto read</span>
          <div class="reader-row"><div class="reader-row-text"><strong>${auto.on ? 'Auto read is on' : 'Scroll or turn pages for you'}</strong><small class="reader-speed-label">Speed: ${escapeHtml(speed.label)}</small></div><button class="button${auto.on ? '' : '-primary'}" data-reader="auto-toggle">${auto.on ? 'Stop' : 'Start'}</button></div>
          <input class="reader-range" type="range" min="1" max="${AUTO_SPEEDS.length}" step="1" value="${o.autoSpeed}" data-reader="auto-speed" aria-label="Auto read speed">
        </div>
        <div class="reader-group"><span class="reader-group-label">Screen rotation${isApp ? '' : ' (Android app only)'}</span><div class="reader-segs">
          ${segment('auto', 'Auto', o.orientation === 'auto', 'set-orientation')}${segment('portrait', 'Portrait', o.orientation === 'portrait', 'set-orientation')}${segment('landscape', 'Landscape', o.orientation === 'landscape', 'set-orientation')}
        </div></div>
        <div class="reader-group">
          ${switchRow('readerShowStatusBar', 'Show status bar', 'Keep the system bar visible while reading', true)}
          ${switchRow('readerShowClock', 'Time and battery', 'A small clock and battery level on the page')}
          ${switchRow('readerVolumeKeys', 'Volume keys turn pages', 'Volume down goes forward, volume up goes back', true)}
          ${switchRow('readerChapterNotice', 'Chapter reminder', 'Show the chapter name when you open it')}
          ${switchRow('readerSkipExtras', 'Skip extras', 'Next and previous skip chapters without a number')}
        </div>
        <div class="reader-group reader-actions">
          <button class="reader-action" data-reader="share"><span>Share chapter link</span><span aria-hidden="true">↗</span></button>
          <button class="reader-action" data-reader="show-tips"><span>See the operation tips again</span><span aria-hidden="true">›</span></button>
          <button class="reader-action" data-reader="more-settings"><span>More settings</span><span aria-hidden="true">›</span></button>
        </div>
      </div>
    </div>`;
  }

  function tipsMarkup() {
    const paged = view.mode !== 'scroll';
    const items = [
      'Tap the middle of the page to show or hide the bars.',
      paged ? `Tap the left or right edge to turn the page${view.mode === 'rtl' ? ' (the left edge goes forward in right-to-left mode)' : ''}.` : 'Scroll to read. Drag the slider to jump to a page.',
      'Pinch to zoom, or double-tap the middle of the page. Reset brings the page back to fit. While zoomed in, taps do not turn the page.',
      'Tap the sliders button for reading mode, auto read, rotation and more.',
      view.opts.volumeKeys ? 'Volume down goes forward and volume up goes back.' : 'Turn on volume keys in the options to turn pages with the phone buttons.',
      'Your place is saved. Open the chapter again to continue where you stopped.'
    ];
    return `<div class="reader-tips" role="dialog" aria-modal="true" aria-label="Reader tips"><div class="reader-tips-card"><h3>Reader tips</h3><ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul><button class="button-primary" data-reader="tips-done">Got it</button></div></div>`;
  }

  function autoPillMarkup() {
    if (!auto.on) return '';
    return `<div class="reader-auto"><button class="button reader-auto-main" data-reader="auto-pause" aria-label="${auto.paused ? 'Resume auto read' : 'Pause auto read'}">${auto.paused ? '▶ Resume auto read' : '⏸ Auto read'}</button><button class="button-subtle" data-reader="auto-stop" aria-label="Stop auto read">✕</button></div>`;
  }

  function overlaysMarkup() {
    return `${view.opts.showClock ? '<div class="reader-clock" id="readerClock"></div>' : ''}<div id="readerZoomPill">${zoomPillMarkup()}</div>${autoPillMarkup()}${view.sheetOpen ? sheetMarkup() : ''}${view.tips ? tipsMarkup() : ''}`;
  }

  function renderOverlays() {
    const box = host.querySelector('#readerOverlays');
    if (!box) return;
    box.innerHTML = overlaysMarkup();
    updateClock();
    if (view.sheetOpen) box.querySelector('.reader-sheet [data-reader="sheet-close"]')?.focus({ preventScroll: true });
  }

  function refreshFoot() {
    const foot = host.querySelector('.reader-foot');
    if (foot) foot.outerHTML = footMarkup();
  }

  function teardownObservers() {
    view.observer?.disconnect();
    view.loadObserver?.disconnect();
    view.endObserver?.disconnect();
    view.endSeen = false;
    view.observer = view.loadObserver = null;
  }

  function render() {
    teardownObservers();
    const slots = view.mode === 'scroll'
      ? Array.from({ length: view.total }, (_, index) => slotMarkup(index)).join('') + endCardMarkup()
      : (view.ended ? endCardMarkup() : slotMarkup(view.page));
    host.innerHTML = `${barMarkup()}<div class="reader-stage" data-mode="${view.mode}" data-fit="${view.fit}" data-zoomed="${isZoomed(view.zoom)}" style="--zoom:${clampZoom(view.zoom)}" tabindex="0">${slots}${view.mode === 'scroll' ? attribution() : ''}</div>${footMarkup()}<div class="reader-overlays" id="readerOverlays">${overlaysMarkup()}</div>`;
    host.querySelectorAll('.reader-img').forEach(bindImage);
    const stage = host.querySelector('.reader-stage');
    if (view.mode === 'scroll') setupScrollMode(stage);
    else setupPagedMode();
    if (stage && isZoomed(view.zoom) && view.mode !== 'scroll') { stage.scrollLeft = 0; stage.scrollTop = 0; }
    if (!view.sheetOpen && !view.tips) stage?.focus({ preventScroll: true });
    updateClock();
    scheduleAuto();
  }

  function setupScrollMode(stage) {
    // Load images shortly before they scroll into view instead of using native lazy loading,
    // so the load timer that MangaDex asks us to report starts when the request really starts.
    view.loadObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { loadImage(entry.target); view.loadObserver.unobserve(entry.target); }
    }, { rootMargin: '150% 0px' });
    view.observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setPage(Number(visible.target.dataset.index), { fromScroll: true });
    }, { threshold: [0.35, 0.6] });
    host.querySelectorAll('.reader-img').forEach(img => { view.loadObserver.observe(img); view.observer.observe(img); });
    // Reaching the end card in vertical scroll counts as finishing the chapter, even for a one-page chapter.
    const endCard = host.querySelector('.reader-end');
    if (endCard) {
      view.endObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { view.endSeen = true; scheduleSave(); }
      }, { threshold: 0.6 });
      view.endObserver.observe(endCard);
    }
    const target = stage.querySelector(`.reader-slot[data-slot="${view.page}"]`);
    if (target && view.page > 0) target.scrollIntoView({ block: 'start' });
  }

  function setupPagedMode() {
    if (view.ended) return;
    const img = host.querySelector('.reader-img');
    if (img) loadImage(img);
    // Warm the next pages so turning is instant.
    for (let step = 1; step <= PRELOAD_AHEAD; step += 1) {
      const index = view.page + step;
      if (index >= view.total) break;
      urlFor(index).then(url => { if (url && !view.destroyed) { const warm = new Image(); warm.referrerPolicy = 'no-referrer'; warm.src = url; } });
    }
  }

  // ---- paging + progress ---------------------------------------------------------------
  function updateCounter() {
    const count = host.querySelector('#readerCount');
    const slider = host.querySelector('.reader-slider input');
    const shown = Math.min(view.page + 1, view.total);
    if (count) count.textContent = `${shown} / ${view.total}`;
    if (slider) slider.value = String(shown);
  }

  function scheduleSave() {
    window.clearTimeout(view.saveTimer);
    view.saveTimer = window.setTimeout(() => {
      saveChapterProgress({ chapterId, contentItemId, page: view.page, total: view.total, ended: view.ended || view.endSeen }).catch(error => console.warn('Reading progress not saved:', error));
    }, 600);
  }

  function setPage(index, { fromScroll = false } = {}) {
    const next = clampPage(index, view.total);
    if (next === view.page && !fromScroll && !view.ended) return;
    view.page = next;
    view.ended = false;
    updateCounter();
    scheduleSave();
  }

  function goPaged(delta) {
    if (view.mode === 'scroll') return;
    if (view.ended) { if (delta < 0) { view.ended = false; render(); } return; }
    const target = view.page + delta;
    if (target >= view.total) {
      view.ended = true;
      scheduleSave();
      render();
      return;
    }
    if (target < 0) { const prev = prevChapter(); if (prev) onOpenChapter(prev.id); return; }
    view.page = target;
    scheduleSave();
    render();
  }

  // One step forward (1) or back (-1): a page in paged modes, most of a screen when scrolling.
  function step(direction) {
    if (view.mode !== 'scroll') { goPaged(direction); return; }
    const stage = host.querySelector('.reader-stage');
    if (!stage) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    stage.scrollBy({ top: direction * stage.clientHeight * 0.85, behavior: reduce ? 'auto' : 'smooth' });
  }

  // In right-to-left mode the "next page" direction is leftwards.
  const forwardDelta = side => (view.mode === 'rtl' ? (side === 'left' ? 1 : -1) : (side === 'left' ? -1 : 1));

  // ---- zoom ---------------------------------------------------------------------------
  // Zooming makes the pages wider (a CSS variable), so the stage's own scrolling pans them in every direction.
  function zoomPillMarkup() {
    if (!isZoomed(view.zoom)) return '';
    return `<div class="reader-zoom-pill"><span>${escapeHtml(formatZoom(view.zoom))}</span><button class="button-subtle" data-reader="zoom-reset" aria-label="Back to fit">Reset</button></div>`;
  }

  function updateZoomUi() {
    const stage = host.querySelector('.reader-stage');
    if (stage) { stage.dataset.zoomed = String(isZoomed(view.zoom)); stage.style.setProperty('--zoom', String(clampZoom(view.zoom))); }
    const pill = host.querySelector('#readerZoomPill');
    if (pill) pill.innerHTML = zoomPillMarkup();
    const label = host.querySelector('.reader-zoom-label');
    if (label) label.textContent = formatZoom(view.zoom);
  }

  // focus: where the fingers are (px inside the stage). Keeps that spot of the page under the fingers.
  function setZoom(next, focus = null) {
    const stage = host.querySelector('.reader-stage');
    const target = clampZoom(next);
    if (target === view.zoom && !focus) return;
    let anchorX = 0; let anchorY = 0;
    if (stage && focus) {
      anchorX = (stage.scrollLeft + focus.x) / Math.max(1, stage.scrollWidth);
      anchorY = (stage.scrollTop + focus.y) / Math.max(1, stage.scrollHeight);
    }
    view.zoom = target;
    updateZoomUi();
    if (stage && focus) {
      stage.scrollLeft = scrollToKeepFocus(anchorX, stage.scrollWidth, focus.x, stage.clientWidth);
      stage.scrollTop = scrollToKeepFocus(anchorY, stage.scrollHeight, focus.y, stage.clientHeight);
    } else if (stage && !isZoomed(target)) { stage.scrollLeft = 0; }
  }

  const stageFocus = (stage, clientX, clientY) => { const rect = stage.getBoundingClientRect(); return { x: clientX - rect.left, y: clientY - rect.top }; };
  const fingerGap = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  function handleTouchStart(event) {
    const stage = event.target.closest?.('.reader-stage');
    if (!stage || event.touches.length !== 2) return;
    const [a, b] = event.touches;
    view.pinch = { startZoom: view.zoom, startGap: fingerGap(event.touches), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
    view.lastTap = null;
    host.addEventListener('touchmove', handleTouchMove, { passive: false });
    if (auto.on && !auto.paused) setAutoPaused(true);
  }

  function handleTouchMove(event) {
    if (!view.pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const stage = host.querySelector('.reader-stage');
    if (!stage) return;
    const [a, b] = event.touches;
    const next = pinchZoom(view.pinch.startZoom, view.pinch.startGap, fingerGap(event.touches));
    setZoom(next, stageFocus(stage, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2));
  }

  function handleTouchEnd(event) {
    if (view.pinch && event.touches.length < 2) { view.pinch = null; view.lastTap = null; host.removeEventListener('touchmove', handleTouchMove); }
  }

  function setMode(mode) {
    if (!MODES.includes(mode) || mode === view.mode) return;
    view.mode = mode;
    view.ended = false;
    view.zoom = MIN_ZOOM;
    onSetting?.('readerMode', mode);
    render();
  }

  function setQuality(quality) {
    if (!view.pages || quality === view.quality) return;
    if (view.pages.offline) { toast('Downloaded chapters keep the quality they were saved in.'); return; }
    if (!(quality === 'data' ? view.pages.data : view.pages.dataSaver).length) { toast('This chapter is not available in that quality.'); return; }
    view.quality = quality;
    view.urls = buildPageUrls(view.pages, quality);
    started.clear();
    for (const objectUrl of blobUrls.values()) URL.revokeObjectURL(objectUrl);
    blobUrls.clear();
    onSetting?.('readerQuality', quality);
    render();
  }

  // ---- auto read -----------------------------------------------------------------------
  function haltAutoLoops() {
    window.cancelAnimationFrame(auto.raf);
    window.clearInterval(auto.timer);
    auto.raf = 0;
    auto.timer = 0;
  }

  function scheduleAuto() {
    haltAutoLoops();
    if (!auto.on || auto.paused || view.destroyed) return;
    const speed = autoSpeed(view.opts.autoSpeed);
    if (view.mode === 'scroll') {
      auto.last = 0;
      auto.carry = 0;
      const frame = timestamp => {
        if (!auto.on || auto.paused || view.destroyed) return;
        const stage = host.querySelector('.reader-stage');
        if (stage) {
          if (auto.last) {
            auto.carry += ((timestamp - auto.last) / 1000) * speed.pxPerSecond;
            const whole = Math.floor(auto.carry);
            if (whole >= 1) { stage.scrollTop += whole; auto.carry -= whole; }
          }
          auto.last = timestamp;
          if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2) { stopAuto('Reached the end of the chapter.'); return; }
        }
        auto.raf = window.requestAnimationFrame(frame);
      };
      auto.raf = window.requestAnimationFrame(frame);
    } else {
      auto.timer = window.setInterval(() => {
        if (view.ended) { stopAuto('Reached the end of the chapter.'); return; }
        goPaged(1);
      }, speed.secondsPerPage * 1000);
    }
  }

  function startAuto() {
    auto.on = true;
    auto.paused = false;
    view.sheetOpen = false;
    renderOverlays();
    scheduleAuto();
  }

  function stopAuto(message = '') {
    auto.on = false;
    auto.paused = false;
    haltAutoLoops();
    renderOverlays();
    if (message) toast(message);
  }

  function setAutoPaused(paused) {
    if (!auto.on || auto.paused === paused) return;
    auto.paused = paused;
    renderOverlays();
    scheduleAuto();
  }

  // ---- display options -----------------------------------------------------------------
  function updateClock() {
    const el = host.querySelector('#readerClock');
    if (el) el.textContent = formatStatusLine(new Date(), view.battery?.());
  }

  async function startClock() {
    window.clearInterval(view.clockTimer);
    if (!view.opts.showClock) return;
    view.battery = view.battery || await getBatteryReader();
    updateClock();
    view.clockTimer = window.setInterval(updateClock, CLOCK_INTERVAL_MS);
  }

  async function applyStatusBar() {
    const result = await setStatusBarVisible(view.opts.showStatusBar);
    view.statusHidden = result === 'ok' && !view.opts.showStatusBar;
    return result;
  }

  async function applyOrientation() {
    const result = await setOrientation(view.opts.orientation);
    view.orientationLocked = result === 'ok' && view.opts.orientation !== 'auto';
    return result;
  }

  function applyDeviceOptions() {
    // Only touch the system when the person asked for something other than the defaults.
    if (!view.opts.showStatusBar) applyStatusBar();
    if (view.opts.orientation !== 'auto') applyOrientation();
    setVolumeCapture(view.opts.volumeKeys, chapterId);
    startClock();
  }

  async function toggleOption(key) {
    const name = TOGGLES[key];
    if (!name) return;
    view.opts[name] = !view.opts[name];
    onSetting?.(key, view.opts[name]);
    if (key === 'readerShowStatusBar') {
      const result = await applyStatusBar();
      if (result === 'unavailable') toast('Hiding the status bar needs the Android app.');
    } else if (key === 'readerShowClock') startClock();
    else if (key === 'readerVolumeKeys') {
      setVolumeCapture(view.opts.volumeKeys, chapterId);
      if (view.opts.volumeKeys && !isApp) toast('Volume keys only work in the Android app.');
    } else if (key === 'readerSkipExtras') refreshFoot();
    renderOverlays();
  }

  async function setOrientationOption(mode) {
    if (!['auto', 'portrait', 'landscape'].includes(mode)) return;
    view.opts.orientation = mode;
    onSetting?.('readerOrientation', mode);
    const result = await applyOrientation();
    if (result === 'unavailable') toast('Screen rotation needs the Android app.');
    else if (result === 'failed') toast('The screen could not be rotated.');
    renderOverlays();
  }

  async function share() {
    const label = `${context?.title || 'Manga'} - ${chapterLabel(current)}`;
    const result = await shareLink({ title: label, url: sourceUrl });
    if (result === 'copied') toast('Link copied.');
    else if (result === 'failed') toast('The link could not be shared.');
  }

  function closeTips() {
    view.tips = false;
    markTipsSeen();
    renderOverlays();
  }

  // ---- events --------------------------------------------------------------------------
  function handleClick(event) {
    const control = event.target.closest('[data-reader]');
    if (control) {
      const value = control.dataset.value;
      switch (control.dataset.reader) {
        case 'close': onClose(); break;
        case 'retry': start(); break;
        case 'retry-image': retryImage(Number(control.dataset.index)); break;
        case 'sheet-open': view.sheetOpen = true; renderOverlays(); break;
        case 'sheet-close': view.sheetOpen = false; renderOverlays(); break;
        case 'zoom-in': setZoom(stepZoom(view.zoom, 1)); break;
        case 'zoom-out': setZoom(stepZoom(view.zoom, -1)); break;
        case 'zoom-reset': setZoom(MIN_ZOOM); break;
        case 'set-mode': setMode(value); break;
        case 'set-quality': setQuality(value); break;
        case 'set-orientation': setOrientationOption(value); break;
        case 'toggle': toggleOption(control.dataset.key); break;
        case 'auto-toggle': if (auto.on) stopAuto(); else startAuto(); break;
        case 'auto-pause': setAutoPaused(!auto.paused); break;
        case 'auto-stop': stopAuto(); break;
        case 'share': share(); break;
        case 'show-tips': view.sheetOpen = false; view.tips = true; renderOverlays(); break;
        case 'tips-done': closeTips(); break;
        case 'more-settings': onOpenSettings?.(); break;
        case 'next-chapter': { const next = nextChapter(); if (next) onOpenChapter(next.id); break; }
        case 'prev-chapter': { const prev = prevChapter(); if (prev) onOpenChapter(prev.id); break; }
        default: break;
      }
      return;
    }
    const stage = event.target.closest('.reader-stage');
    if (!stage || event.target.closest('a, button, input')) return;
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    // A second quick tap zooms. In the page-by-page modes the edges turn pages, so only the middle can zoom there.
    const now = Date.now();
    const second = isDoubleTap(view.lastTap, now, event.clientX, event.clientY);
    view.lastTap = { time: now, x: event.clientX, y: event.clientY };
    if (second && !view.ended && (view.mode === 'scroll' || (x >= 0.3 && x <= 0.7))) {
      view.lastTap = null;
      toggleUi(); // the first tap of the pair already toggled the bars: put them back
      setZoom(doubleTapTarget(view.zoom), stageFocus(stage, event.clientX, event.clientY));
      return;
    }
    // While zoomed in, taps never turn the page by accident. Reset the zoom (or use the slider or keys) to move on.
    if (view.mode !== 'scroll' && !view.ended && !isZoomed(view.zoom) && x < 0.3) goPaged(forwardDelta('left'));
    else if (view.mode !== 'scroll' && !view.ended && !isZoomed(view.zoom) && x > 0.7) goPaged(forwardDelta('right'));
    else toggleUi();
  }

  function toggleUi() {
    view.uiVisible = !view.uiVisible;
    host.querySelector('.reader-bar')?.toggleAttribute('hidden', !view.uiVisible);
    host.querySelector('.reader-foot')?.toggleAttribute('hidden', !view.uiVisible);
  }

  function handleInput(event) {
    const kind = event.target.dataset?.reader;
    if (kind === 'auto-speed') {
      view.opts.autoSpeed = autoSpeed(event.target.value).id;
      const label = host.querySelector('.reader-speed-label');
      if (label) label.textContent = `Speed: ${autoSpeed(view.opts.autoSpeed).label}`;
      scheduleAuto();
      return;
    }
    if (kind !== 'seek') return;
    const index = Number(event.target.value) - 1;
    if (view.mode === 'scroll') {
      view.page = clampPage(index, view.total);
      host.querySelector(`.reader-slot[data-slot="${view.page}"]`)?.scrollIntoView({ block: 'start' });
      updateCounter();
      scheduleSave();
    } else {
      view.page = clampPage(index, view.total);
      view.ended = false;
      scheduleSave();
      render();
    }
  }

  // Save the auto read speed once the slider is released, not on every tick of the drag.
  function handleChange(event) {
    if (event.target.dataset?.reader === 'auto-speed') onSetting?.('readerAutoSpeed', view.opts.autoSpeed);
  }

  // Touching or wheeling the page while it scrolls itself pauses auto read; the pill resumes it.
  function handleUserScroll(event) {
    if (auto.on && !auto.paused && view.mode === 'scroll' && event.target.closest?.('.reader-stage')) setAutoPaused(true);
  }

  function handleKey(event) {
    if (event.target.matches?.('input, textarea, select')) return;
    if (event.key === 'Escape') {
      if (view.tips) closeTips();
      else if (view.sheetOpen) { view.sheetOpen = false; renderOverlays(); } else onClose();
      return;
    }
    if (view.opts.volumeKeys) {
      const action = volumeAction(event.key);
      if (action) { event.preventDefault(); step(action === 'next' ? 1 : -1); return; }
    }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(stepZoom(view.zoom, 1)); return; }
    if (event.key === '-') { event.preventDefault(); setZoom(stepZoom(view.zoom, -1)); return; }
    if (event.key === '0') { event.preventDefault(); setZoom(MIN_ZOOM); return; }
    if (view.mode === 'scroll') return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); goPaged(forwardDelta('left')); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); goPaged(forwardDelta('right')); }
    else if (event.key === ' ') { event.preventDefault(); goPaged(1); }
  }

  // Sent by the Android shell while the reader address carries vol=1 (see scripts/android-customize.sh).
  function handleVolumeEvent(event) {
    if (!view.opts.volumeKeys) return;
    const action = volumeAction(event.detail);
    if (action) step(action === 'next' ? 1 : -1);
  }

  host.addEventListener('click', handleClick);
  host.addEventListener('input', handleInput);
  host.addEventListener('change', handleChange);
  host.addEventListener('touchstart', handleUserScroll, { passive: true });
  host.addEventListener('touchstart', handleTouchStart, { passive: true });
  host.addEventListener('touchend', handleTouchEnd, { passive: true });
  host.addEventListener('touchcancel', handleTouchEnd, { passive: true });
  host.addEventListener('wheel', handleUserScroll, { passive: true });
  document.addEventListener('keydown', handleKey);
  window.addEventListener('tmlvolume', handleVolumeEvent);
  const timer = window.setInterval(() => { if (document.visibilityState === 'visible') view.activeSeconds += 1; }, 1000);

  async function start() {
    setStatus('<span class="spinner"></span><p>Opening chapter…</p>');
    try {
      await fetchPages();
      const saved = await loadChapterProgress(chapterId).catch(() => null);
      // Resume unless the chapter was already finished; a finished chapter reopens at page one.
      view.page = saved && saved.readingState !== 'completed' ? clampPage(saved.page, view.total) : 0;
      if (view.destroyed) return;
      try { onHistory?.({ chapterId, page: view.page, total: view.total }); } catch { /* Recent is a convenience */ }
      if (!tipsSeen()) view.tips = true;
      render();
      const parts = [];
      if (view.opts.chapterNotice) parts.push(chapterLabel(current));
      if (view.page > 0) parts.push(`resumed at page ${view.page + 1}`);
      if (parts.length) { const text = parts.join(' · '); toast(text.charAt(0).toUpperCase() + text.slice(1), 3000); }
    } catch (error) {
      if (view.destroyed || error?.name === 'AbortError') return;
      showError(error);
    }
  }

  applyDeviceOptions();
  start();

  return {
    destroy() {
      if (view.destroyed) return;
      view.destroyed = true;
      controller.abort();
      haltAutoLoops();
      teardownObservers();
      for (const objectUrl of blobUrls.values()) URL.revokeObjectURL(objectUrl);
      blobUrls.clear();
      view.pages?.release?.();
      window.clearInterval(timer);
      window.clearInterval(view.clockTimer);
      window.clearTimeout(view.saveTimer);
      host.removeEventListener('click', handleClick);
      host.removeEventListener('input', handleInput);
      host.removeEventListener('change', handleChange);
      host.removeEventListener('touchstart', handleUserScroll);
      host.removeEventListener('touchstart', handleTouchStart);
      host.removeEventListener('touchmove', handleTouchMove);
      host.removeEventListener('touchend', handleTouchEnd);
      host.removeEventListener('touchcancel', handleTouchEnd);
      host.removeEventListener('wheel', handleUserScroll);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('tmlvolume', handleVolumeEvent);
      // Give the phone back the way we found it.
      if (view.statusHidden) setStatusBarVisible(true);
      if (view.orientationLocked) setOrientation('auto');
      if (view.total > 0) { try { onHistory?.({ chapterId, page: view.page, total: view.total, keepTime: true }); } catch { /* Recent is a convenience */ } }
      if (view.total > 0) saveChapterProgress({ chapterId, contentItemId, page: view.page, total: view.total, ended: view.ended || view.endSeen }).catch(() => {});
      recordReadingSession({ chapterId, contentItemId, startedAt: view.startedAt, activeSeconds: view.activeSeconds }).catch(() => {});
    }
  };
}
