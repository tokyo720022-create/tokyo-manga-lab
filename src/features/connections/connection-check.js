// "Test connections": asks each service one cheap question and explains the answer in plain words.
// Probes are passed in so this file stays pure and testable; the app supplies the real ones.

const HINTS = {
  UNAUTHORIZED: 'Your sign-in has expired. Sign in again.',
  RATE_LIMITED: 'The service is busy and asked us to wait. Try again in a minute.',
  TIMEOUT: 'The service took too long to answer. Try again shortly.',
  NETWORK_ERROR: 'The request did not get through. Check your internet connection.',
  UNAVAILABLE: 'The service is having problems right now. Your library still works.'
};

export function explainFailure(error) {
  const code = String(error?.code || '');
  if (HINTS[code]) return HINTS[code];
  if (error?.status === 401 || error?.status === 403) return HINTS.UNAUTHORIZED;
  if (error?.status === 429) return HINTS.RATE_LIMITED;
  if (error?.status >= 500) return HINTS.UNAVAILABLE;
  return error?.message ? String(error.message).slice(0, 140) : 'The check failed for an unknown reason.';
}

async function timed(probe, now) {
  const start = now();
  try {
    const detail = await probe();
    return { ok: true, ms: Math.max(0, Math.round(now() - start)), detail: detail || '' };
  } catch (error) {
    return { ok: false, ms: Math.max(0, Math.round(now() - start)), detail: explainFailure(error) };
  }
}

// probes: { mangadex?: () => Promise<string|void>, anilist?: ..., mal?: ... }. A missing probe means "not connected".
export async function checkConnections(probes, { now = () => Date.now() } = {}) {
  const names = [['mangadex', 'MangaDex'], ['anilist', 'AniList'], ['mal', 'MyAnimeList']];
  const results = await Promise.all(names.map(async ([key, label]) => {
    if (!probes[key]) return { key, label, skipped: true, ok: true, detail: 'Not connected, so nothing to check.' };
    return { key, label, ...(await timed(probes[key], now)) };
  }));
  return { results, allOk: results.every(row => row.ok), summary: summarize(results) };
}

export function summarize(results) {
  return results.map(row => row.skipped ? `${row.label}: not connected` : row.ok ? `${row.label}: working${row.detail ? ` (${row.detail})` : ''}` : `${row.label}: problem. ${row.detail}`).join('\n');
}
