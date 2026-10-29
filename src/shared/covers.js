// Cover image helpers. Covers only load from hosts we expect (MangaDex, AniList and MyAnimeList), over https. Anything else
// (for example a cover URL that came in through an imported backup) is treated as "no cover" and shows the placeholder.
const ANILIST_HOST = /^s\d+\.anilist\.co$/;

export function isAllowedCoverHost(hostname) {
  return hostname === 'uploads.mangadex.org' || hostname === 'cdn.myanimelist.net' || ANILIST_HOST.test(hostname);
}

export function safeCoverUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || !isAllowedCoverHost(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

// MangaDex serves the same cover at .256.jpg and .512.jpg. Cards use both so high-density phone screens get a sharp image.
const MANGADEX_THUMB = /\.256\.jpg$/;

export function coverVariants(value) {
  const src = safeCoverUrl(value);
  if (!src) return null;
  if (new URL(src).hostname === 'uploads.mangadex.org' && MANGADEX_THUMB.test(new URL(src).pathname)) {
    const large = src.replace(MANGADEX_THUMB, '.512.jpg');
    return { src, large, srcset: `${src} 256w, ${large} 512w` };
  }
  return { src, large: src, srcset: '' };
}

// A second try with a changed address, so a cover that failed once (flaky network) is asked for again once.
export function retryUrl(value) {
  const url = new URL(value);
  url.searchParams.set('tmlretry', '1');
  return url.href;
}
