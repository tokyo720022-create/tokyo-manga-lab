// The shell cache is named after the app version (app.js registers ./sw.js?v=<version>), so every release gets a
// fresh cache and old ones are removed on activate. Without a version it falls back to a fixed name.
const VERSION = (() => {
  try { return (new URL(self.location.href).searchParams.get('v') || '').replace(/[^0-9A-Za-z._-]/g, '').slice(0, 24); } catch { return ''; }
})();
const CACHE_NAME = `tokyo-manga-lab-shell-${VERSION || 'dev'}`;
// Covers live in their own cache that survives app updates, so artwork is not downloaded again after each release.
const COVER_CACHE = 'tokyo-manga-lab-covers-v1';
const COVER_LIMIT = 400;
const COVER_HOSTS = [/^uploads\.mangadex\.org$/, /^s\d+\.anilist\.co$/];
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest', './assets/favicon.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png', './assets/logo-96.png',
  './css/base.css', './css/theme.css', './css/layout.css', './css/components.css', './css/screens.css', './css/reader.css', './css/downloads.css', './css/recent.css', './css/discover.css', './css/updates.css',
  './src/app.js', './src/core/app-controller.js', './src/core/router.js',
  './src/data/database.js', './src/data/models.js', './src/data/backup-merge.js', './src/data/repositories/library-repository.js',
  './src/services/api-client.js', './src/sources/source-registry.js', './src/sources/manga/mangadex-adapter.js',
  './src/features/anilist/anilist-config.js', './src/features/anilist/anilist-mapper.js', './src/features/anilist/anilist-auth.js', './src/features/anilist/anilist-client.js', './src/features/anilist/sync-planner.js',
  './src/features/mal/mal-config.js',
  './src/features/mal/mal-auth.js',
  './src/features/mal/mal-mapper.js',
  './src/features/mal/mal-client.js',
  './src/features/mal/mal-store.js',
  './src/features/mal/mal-profile.js',
  './src/features/mal/mal-sync.js',
  './src/features/mal/mal-tracking.js', './src/features/anilist/anilist-store.js', './src/features/anilist/anilist-sync.js', './src/features/anilist/anilist-native.js', './src/features/anilist/anilist-profile.js', './src/features/theme/themes.js', './src/features/reader/reader-pages.js', './src/features/reader/reader-report.js', './src/features/reader/reader-progress.js', './src/features/reader/reader-native.js', './src/features/reader/reader-features.js', './src/features/reader/reader-view.js', './src/features/linking/mangadex-link.js', './src/features/backup/backup-export.js', './src/data/repositories/link-repository.js', './src/features/settings/settings-service.js', './src/features/settings/settings-schema.js', './src/features/profile/profile-sections.js', './src/features/feature-registry.js', './src/shared/icons.js', './src/shared/app-info.js', './src/features/settings/legacy-migration.js', './src/features/statistics/statistics-service.js', './src/shared/utils.js', './src/shared/retry.js', './src/features/connections/connection-check.js', './src/shared/covers.js', './src/features/anilist/anilist-login.js', './src/features/chapters/chapter-view.js', './src/features/chapters/chapter-ui.js', './src/features/tracking/tracking-ui.js', './src/features/tracking/tracking.js', './src/features/tracking/tracking-service.js', './src/data/repositories/chapter-marks-repository.js',
  './src/features/downloads/download-plan.js', './src/features/downloads/download-manager.js', './src/features/downloads/download-fetch.js', './src/features/downloads/download-repository.js', './src/features/downloads/network-wait.js', './src/features/downloads/page-store.js', './src/features/downloads/download-ui.js', './src/features/downloads/download-controller.js', './src/features/downloads/keep-alive.js', './src/data/repositories/history-repository.js', './src/features/recent/recent-view.js', './src/features/discover/discover-filters.js', './src/features/updates/update-plan.js', './src/features/updates/update-checker.js', './src/features/updates/update-controller.js', './src/features/updates/update-view.js', './src/data/repositories/update-repository.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('tokyo-manga-lab-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (url.origin !== scopeUrl.origin) {
    // Only cover artwork from the two known hosts is cached. The catalogue API and everything else pass through untouched.
    if (request.destination === 'image' && url.protocol === 'https:' && COVER_HOSTS.some(host => host.test(url.hostname))) {
      event.respondWith(coverResponse(request));
    }
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(new URL('./index.html', self.registration.scope), response.clone()).catch(() => {});
        return response;
      } catch {
        return (await caches.match(new URL('./index.html', self.registration.scope))) || Response.error();
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});

async function coverResponse(request) {
  const cache = await caches.open(COVER_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  try {
    // CORS first: that response can be inspected and cached. Opaque responses are never stored (they cannot be checked).
    const response = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
    if (response.ok && response.type === 'cors') {
      await cache.put(request.url, response.clone()).catch(() => {});
      trimCoverCache(cache).catch(() => {});
    }
    return response;
  } catch {
    try { return await fetch(request); } catch { return Response.error(); }
  }
}

async function trimCoverCache(cache) {
  const keys = await cache.keys();
  const extra = keys.length - COVER_LIMIT;
  for (let index = 0; index < extra; index += 1) await cache.delete(keys[index]);
}
