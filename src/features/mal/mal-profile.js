// The signed-in person's MyAnimeList profile, shaped like the AniList one so the Profile screen can show either.
// MyAnimeList's API has no banner, no follower counts and no manga totals, so the manga numbers are worked out from
// the list that sync reads, and the banner is left empty.
import { safeCoverUrl } from '../../shared/covers.js';
import { PROFILE_STALE_MS } from '../anilist/anilist-profile.js';

const count = value => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.round(Number(value)) : 0);
const score = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

// Totals for the manga list: how many titles, chapters and volumes read, and the mean of the scores that are set.
export function mangaTotals(rows = []) {
  let chapters = 0; let volumes = 0; let scoreSum = 0; let scored = 0;
  for (const row of rows) {
    const list = row?.list_status || {};
    chapters += count(list.num_chapters_read);
    volumes += count(list.num_volumes_read);
    const value = Number(list.score) || 0;
    if (value > 0) { scoreSum += value; scored += 1; }
  }
  return { count: rows.length, chaptersRead: chapters, volumesRead: volumes, meanScore: scored ? Math.round(scoreSum / scored * 100) / 100 : 0 };
}

const safeDate = value => { const time = Date.parse(value || ''); return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : ''; };

export function normalizeProfile(me, manga = null, previous = null, now = Date.now()) {
  if (!me?.id) return null;
  const name = String(me.name || '').slice(0, 60);
  const anime = me.anime_statistics || {};
  return {
    id: me.id,
    name,
    siteUrl: name ? `https://myanimelist.net/profile/${encodeURIComponent(name)}` : '',
    avatarUrl: safeCoverUrl(me.picture),
    bannerUrl: null,
    about: '',
    location: String(me.location || '').slice(0, 60),
    joinedAt: safeDate(me.joined_at),
    manga: manga || previous?.manga || { count: 0, chaptersRead: 0, volumesRead: 0, meanScore: 0 },
    anime: { count: count(anime.num_items), episodesWatched: count(anime.num_episodes), meanScore: score(anime.mean_score) },
    followers: null,
    following: null,
    fetchedAt: now
  };
}

export { PROFILE_STALE_MS };
export const profileIsStale = (profile, now = Date.now()) => !profile || !profile.fetchedAt || now - profile.fetchedAt > PROFILE_STALE_MS;
