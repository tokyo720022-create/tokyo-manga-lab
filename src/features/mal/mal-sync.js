// Connects the pieces for MyAnimeList: client + planner + local library. UI code calls only this module.
import { getAllRecords, getRecord, putRecord } from '../../data/database.js';
import { addToLibrary, cacheCatalogueItems } from '../../data/repositories/library-repository.js';
import { API_BASE_URL, adultActive } from '../../services/api-client.js';
import { planSync } from '../anilist/sync-planner.js';
import { patchIsEmpty, planAfterRead } from '../tracking/tracking.js';
import { MAL_TITLE_URL, MAX_PUSHES_PER_RUN, PUSH_SPACING_MS } from './mal-config.js';
import { MalError, createMalClient, exchangeCode, refreshTokens } from './mal-client.js';
import { entryFromListStatus, libraryStatusBody, normalizeRemoteEntry, patchToMalBody, toLocalStatus, toRemoteStatus } from './mal-mapper.js';
import { mangaTotals, normalizeProfile, profileIsStale } from './mal-profile.js';
import { clearAccount, deleteOutbox, getAccount, getOutbox, getSyncLinks, getTracking, putOutbox, putSyncLinks, putTracking, saveAccount, syncLinkId } from './mal-store.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const LIBRARY_PROFILE = 'local-default';
const apiBase = () => API_BASE_URL;

export function describeAccount(account) {
  if (!account) return { connected: false, expired: false, label: 'Not connected' };
  if (!account.refreshToken && account.expiresAt && account.expiresAt < Date.now()) return { connected: false, expired: true, label: 'Sign-in expired. Connect again.' };
  return { connected: true, expired: false, label: `Connected as ${account.viewer?.name || 'MyAnimeList user'}` };
}

// Tokens: the access token lasts about an hour, so it is renewed with the refresh token. MyAnimeList hands out a new
// refresh token each time, so only one renewal may run at once and its result is saved before anything else uses it.
let renewing = null;
function makeAuth({ fetchImpl } = {}) {
  async function renew() {
    if (renewing) return renewing;
    renewing = (async () => {
      const account = await getAccount();
      if (!account?.refreshToken || !account.clientId) { await clearAccount(); throw new MalError('MyAnimeList sign-in expired. Connect again.', { code: 'UNAUTHORIZED' }); }
      try {
        const tokens = await refreshTokens({ apiBase: apiBase(), clientId: account.clientId, refreshToken: account.refreshToken, fetchImpl });
        const latest = (await getAccount()) || account;
        await saveAccount({ ...latest, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || latest.refreshToken, expiresAt: tokens.expiresAt });
        return tokens.accessToken;
      } catch (error) {
        if (error.code === 'AUTH_FAILED' || error.code === 'UNAUTHORIZED') { await clearAccount(); throw new MalError('MyAnimeList sign-in expired. Connect again.', { code: 'UNAUTHORIZED' }); }
        throw error;
      }
    })().finally(() => { renewing = null; });
    return renewing;
  }
  return {
    async getToken() {
      const account = await getAccount();
      if (!account) throw new MalError('Connect your MyAnimeList account first.', { code: 'UNAUTHORIZED' });
      if (!account.accessToken || (account.expiresAt && account.expiresAt - 60000 < Date.now())) return renew();
      return account.accessToken;
    },
    refresh: renew
  };
}

export async function activeClient(fetchImpl) {
  const account = await getAccount();
  const state = describeAccount(account);
  if (!state.connected) throw new MalError(state.expired ? 'MyAnimeList sign-in expired. Connect again.' : 'Connect your MyAnimeList account first.', { code: 'UNAUTHORIZED' });
  return { account, client: createMalClient({ apiBase: apiBase(), auth: makeAuth({ fetchImpl }), adult: adultActive, fetchImpl }) };
}

// The sign-in code came back: trade it for tokens, check who signed in, and keep the account.
export async function connectWithCode({ code, verifier, clientId }, { fetchImpl } = {}) {
  const tokens = await exchangeCode({ apiBase: apiBase(), clientId, code, verifier, fetchImpl });
  const previous = await getAccount();
  await saveAccount({ ...(previous || {}), accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, clientId, viewer: previous?.viewer || null });
  try {
    const client = createMalClient({ apiBase: apiBase(), auth: makeAuth({ fetchImpl }), adult: adultActive, fetchImpl });
    const me = await client.viewer();
    const viewer = { id: me.id, name: me.name || '', siteUrl: me.name ? `https://myanimelist.net/profile/${encodeURIComponent(me.name)}` : '', avatarUrl: me.picture || '' };
    const same = previous?.viewer?.id === viewer.id;
    const account = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, clientId, viewer, connectedAt: Date.now(), lastSync: same ? previous.lastSync || null : null, profile: same ? previous.profile || null : normalizeProfile(me) };
    await saveAccount(account);
    return account;
  } catch (error) { await clearAccount(); throw error; }
}

export async function disconnect() { await clearAccount(); }

// Loads the profile for the Profile screen and keeps a copy on the account, so it still shows offline.
export async function refreshProfile({ fetchImpl, force = false } = {}) {
  const account = await getAccount();
  if (!describeAccount(account).connected) return null;
  if (!force && !profileIsStale(account.profile)) return account.profile;
  try {
    const { client } = await activeClient(fetchImpl);
    const me = await client.viewer();
    const profile = normalizeProfile(me, null, account.profile);
    const latest = await getAccount();
    if (latest) await saveAccount({ ...latest, profile });
    return profile;
  } catch (error) {
    if (error?.code === 'UNAUTHORIZED') throw error;
    return account.profile || null;
  }
}

// Maps: MyAnimeList id <-> internal content id, from sourceEntries (provider ids live there by design).
export async function loadMappings() {
  const rows = (await getAllRecords('sourceEntries')).filter(row => !row.linkRole);
  const byKey = new Map(rows.map(row => [`${row.sourceId}:${row.externalId}`, row.contentItemId]));
  const mediaByContent = new Map();
  for (const row of rows) if (row.sourceId === 'mal') mediaByContent.set(row.contentItemId, String(row.externalId));
  return { byKey, mediaByContent };
}

export function trackingRowFromEntry({ mediaId, contentItemId, userId, entry, node = null, previous = null }) {
  return {
    mediaId: String(mediaId), contentItemId, userId,
    entryId: null, onList: Boolean(entry),
    status: entry?.status ?? null, progress: Number(entry?.progress) || 0, score: Number(entry?.score) || 0,
    startedAt: entry?.startedAt ?? null, completedAt: entry?.completedAt ?? null,
    totalChapters: Number(node?.num_chapters) || previous?.totalChapters || 0,
    title: node ? (node.alternative_titles?.en || node.title || previous?.title || '') : (previous?.title || ''),
    siteUrl: MAL_TITLE_URL(mediaId),
    updatedAtMs: entry?.updatedAtMs || 0
  };
}

// Sends everything waiting in the outbox. A row holds a library status and/or a patch (chapters read, score, dates, status).
// Network trouble keeps rows queued and stops; nothing is lost.
export async function flushOutbox({ fetchImpl, sleepMs = PUSH_SPACING_MS, ignoreWait = false } = {}) {
  const rows = (await getOutbox()).sort((a, b) => a.createdAt - b.createdAt);
  if (!rows.length) return { sent: 0, remaining: 0, applied: [] };
  const { account, client } = await activeClient(fetchImpl);
  let sent = 0;
  const applied = [];
  for (const row of rows) {
    // A row that was told to wait (rate limit, service down) is left alone until that time has passed.
    // (ignoreWait: the phone just came back online, so the reason for waiting is gone.)
    if (!ignoreWait && row.retryAfter && row.retryAfter > Date.now()) continue;
    try {
      const patch = { ...(row.patch || {}) };
      if (row.autoRead) {
        // "A chapter was read": decide against what MyAnimeList has right now, so progress only goes up.
        const node = await client.mediaEntry(row.mediaId);
        const remoteEntry = entryFromListStatus(node.my_list_status, node);
        const plan = planAfterRead({ entry: remoteEntry ? { status: remoteEntry.status, progress: remoteEntry.progress, startedAt: remoteEntry.startedAt, completedAt: remoteEntry.completedAt } : null, chapterNumber: row.autoRead.chapterNumber, totalChapters: node.num_chapters });
        Object.assign(patch, plan || {});
        if (patchIsEmpty(patch) && !row.libraryStatus) {
          await deleteOutbox(row.id);
          const before = await getTracking(row.contentItemId);
          if (remoteEntry) await putTracking(trackingRowFromEntry({ mediaId: row.mediaId, contentItemId: row.contentItemId, userId: account.viewer.id, entry: remoteEntry, node, previous: before }));
          continue;
        }
      }
      const body = patchToMalBody(patch);
      if (body.status === undefined && row.libraryStatus && toRemoteStatus(row.libraryStatus)) Object.assign(body, libraryStatusBody(row.libraryStatus));
      const saved = await client.saveEntry({ mediaId: row.mediaId, ...body });
      await deleteOutbox(row.id);
      const savedEntry = entryFromListStatus(saved) || null;
      const previous = (await getSyncLinks(account.viewer.id)).get(String(row.mediaId));
      if (row.libraryStatus) {
        await putSyncLinks([{ id: syncLinkId(row.mediaId), provider: 'mal', userId: account.viewer.id, mediaId: String(row.mediaId), contentItemId: row.contentItemId, entryId: null, baseStatus: row.libraryStatus, remoteProgress: savedEntry?.progress ?? 0, remoteUpdatedAtMs: savedEntry?.updatedAtMs ?? 0, syncedAt: Date.now() }]);
      } else if (previous) {
        await putSyncLinks([{ ...previous, remoteProgress: savedEntry?.progress ?? 0, remoteUpdatedAtMs: savedEntry?.updatedAtMs ?? 0, syncedAt: Date.now() }]);
      }
      const trackingBefore = await getTracking(row.contentItemId);
      await putTracking(trackingRowFromEntry({ mediaId: row.mediaId, contentItemId: row.contentItemId, userId: account.viewer.id, entry: savedEntry, previous: trackingBefore }));
      sent += 1;
      applied.push({ mediaId: String(row.mediaId), contentItemId: row.contentItemId, patch, saved });
      if (sleepMs) await sleep(sleepMs);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { await clearAccount(); throw error; }
      if (['RATE_LIMITED', 'UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT'].includes(error.code)) {
        await putOutbox({ ...row, lastError: error.message, retryAfter: Date.now() + (error.retryAfter || 300) * 1000 });
        break;
      }
      await putOutbox({ ...row, attempts: (row.attempts || 0) + 1, lastError: error.message });
    }
  }
  return { sent, remaining: (await getOutbox()).length, applied };
}

// Queue a tracking change, merged with anything already waiting for the same title.
export async function queueTrackingPatch({ mediaId, contentItemId, patch = {}, autoReadChapter = null }) {
  const existing = (await getOutbox()).find(row => row.id === syncLinkId(mediaId));
  const merged = { ...(existing?.patch || {}), ...patch };
  const before = Number(existing?.autoRead?.chapterNumber);
  const now = autoReadChapter === null || autoReadChapter === undefined ? NaN : Number(autoReadChapter);
  const highest = Math.max(Number.isFinite(before) ? before : -Infinity, Number.isFinite(now) ? now : -Infinity);
  await putOutbox({
    id: syncLinkId(mediaId), provider: 'mal', mediaId: String(mediaId), contentItemId,
    libraryStatus: patch.status !== undefined ? undefined : existing?.libraryStatus,
    patch: merged, autoRead: Number.isFinite(highest) ? { chapterNumber: highest } : undefined,
    status: 'pending', createdAt: existing?.createdAt || Date.now(), attempts: 0
  });
}

// After the person changes a title's status here: quietly queue it when the title has a MyAnimeList id.
export async function notifyLocalChange(contentItemId, { fetchImpl, flush = true } = {}) {
  const account = await getAccount();
  if (!describeAccount(account).connected) return { queued: false, reason: 'not-connected' };
  const { mediaByContent } = await loadMappings();
  const mediaId = mediaByContent.get(contentItemId);
  if (!mediaId) return { queued: false, reason: 'not-linked' };
  const entry = await getRecord('libraryEntries', `${LIBRARY_PROFILE}:${contentItemId}`);
  if (!entry || !toRemoteStatus(entry.personalStatus)) return { queued: false, reason: 'no-entry' };
  const waiting = (await getOutbox()).find(row => row.id === syncLinkId(mediaId));
  const patch = { ...(waiting?.patch || {}) };
  delete patch.status;
  await putOutbox({ id: syncLinkId(mediaId), provider: 'mal', mediaId, contentItemId, libraryStatus: entry.personalStatus, patch, status: 'pending', createdAt: waiting?.createdAt || Date.now(), attempts: 0 });
  if (flush) flushOutbox({ fetchImpl }).catch(() => {});
  return { queued: true, mediaId };
}

async function applyPull(pull, remote) {
  let contentItemId = pull.contentItemId;
  if (!contentItemId) {
    const [item] = await cacheCatalogueItems([remote.item]);
    contentItemId = item.id;
    await addToLibrary(item, pull.status);
  } else {
    const entryId = `${LIBRARY_PROFILE}:${contentItemId}`;
    const entry = await getRecord('libraryEntries', entryId);
    if (entry) await putRecord('libraryEntries', { ...entry, personalStatus: pull.status, updatedAt: new Date().toISOString() });
  }
  return contentItemId;
}

export async function runSync({ pushEnabled = false, allowAdult = false, confirmPush = null, fetchImpl, sleepMs = PUSH_SPACING_MS, onProgress = () => {} } = {}) {
  const { account, client } = await activeClient(fetchImpl);
  const userId = account.viewer.id;
  const summary = { at: Date.now(), pulled: 0, pushed: 0, inSync: 0, conflicts: 0, hiddenAdult: 0, unlinked: 0, removedRemotely: 0, skippedPush: 0, pending: 0, notes: [] };

  await flushOutbox({ fetchImpl, sleepMs }).catch(error => { if (error.code === 'UNAUTHORIZED') throw error; });

  onProgress('Reading your MyAnimeList manga list');
  const { rows, hidden } = await client.mangaList();
  const remoteAll = rows.map(normalizeRemoteEntry).filter(Boolean);
  const remote = allowAdult ? remoteAll : remoteAll.filter(entry => !entry.isAdult);
  summary.hiddenAdult = remoteAll.length - remote.length + (Number(hidden) || 0);
  const remoteById = new Map(remote.map(entry => [entry.mediaId, entry]));

  const { mediaByContent } = await loadMappings();
  const libraryEntries = await getAllRecords('libraryEntries');
  const local = libraryEntries.filter(row => mediaByContent.has(row.contentItemId)).map(row => ({
    contentItemId: row.contentItemId, mediaId: mediaByContent.get(row.contentItemId), status: row.personalStatus, updatedAtMs: Date.parse(row.updatedAt) || 0
  }));
  summary.unlinked = libraryEntries.length - local.length;

  const links = await getSyncLinks(userId);
  const bases = Object.fromEntries([...links.values()].map(row => [row.mediaId, row.baseStatus]));
  const plan = planSync({ remote, local, bases, pushEnabled });

  let doPush = pushEnabled;
  if (pushEnabled && plan.pushes.length && typeof confirmPush === 'function') {
    doPush = await confirmPush(plan.pushes.length);
    if (!doPush) summary.notes.push('Skipped sending changes to MyAnimeList.');
  }
  const pushes = doPush ? plan.pushes : [];
  summary.skippedPush = plan.skippedPush.length + (doPush ? 0 : plan.pushes.length);
  summary.conflicts = plan.conflicts.length;
  summary.removedRemotely = plan.removedRemotely.length;

  const now = Date.now();
  const linkRows = [];
  const makeLink = (mediaId, contentItemId, status, remoteEntry) => ({
    id: syncLinkId(mediaId), provider: 'mal', userId, mediaId, contentItemId, entryId: null, baseStatus: status,
    remoteProgress: remoteEntry?.progress ?? links.get(mediaId)?.remoteProgress ?? 0, remoteUpdatedAtMs: remoteEntry?.updatedAtMs ?? 0, syncedAt: now
  });

  onProgress('Updating your library');
  for (const pull of plan.pulls) {
    const entry = remoteById.get(pull.mediaId);
    const contentItemId = await applyPull(pull, entry);
    linkRows.push(makeLink(pull.mediaId, contentItemId, pull.status, entry));
    summary.pulled += 1;
  }
  for (const row of plan.inSync) { linkRows.push(makeLink(row.mediaId, row.contentItemId, row.status, remoteById.get(row.mediaId))); summary.inSync += 1; }
  await putSyncLinks(linkRows);

  let stopped = null;
  const batch = pushes.slice(0, MAX_PUSHES_PER_RUN);
  summary.pending = pushes.length - batch.length;
  for (const [index, push] of batch.entries()) {
    onProgress(`Sending changes to MyAnimeList (${index + 1} of ${batch.length})`);
    try {
      const saved = await client.saveEntry({ mediaId: push.mediaId, ...libraryStatusBody(push.status) });
      const savedEntry = entryFromListStatus(saved);
      await putSyncLinks([{ ...makeLink(push.mediaId, push.contentItemId, push.status, null), remoteProgress: savedEntry?.progress ?? 0, remoteUpdatedAtMs: savedEntry?.updatedAtMs ?? 0 }]);
      summary.pushed += 1;
      if (sleepMs) await sleep(sleepMs);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { await clearAccount(); throw error; }
      stopped = error;
      summary.pending += batch.length - index;
      break;
    }
  }
  if (stopped) summary.notes.push(stopped.code === 'RATE_LIMITED' ? stopped.message : `Stopped early: ${stopped.message}`);
  if (summary.pending && !stopped) summary.notes.push(`${summary.pending} more changes will go out next time you sync.`);

  // The Profile's manga numbers come from this list (MyAnimeList's API has no manga totals of its own).
  const fresh = await getAccount();
  if (fresh) {
    const totals = mangaTotals(remote.length === remoteAll.length ? rows : rows.filter(row => remoteById.has(String(row?.node?.id))));
    await saveAccount({ ...fresh, lastSync: summary, profile: fresh.profile ? { ...fresh.profile, manga: totals, fetchedAt: fresh.profile.fetchedAt } : fresh.profile });
  }
  return summary;
}

export function describeSummary(summary) {
  if (!summary) return 'Not synced yet.';
  const parts = [];
  if (summary.pulled) parts.push(`${summary.pulled} updated here`);
  if (summary.pushed) parts.push(`${summary.pushed} sent to MyAnimeList`);
  if (summary.conflicts) parts.push(`${summary.conflicts} conflict${summary.conflicts === 1 ? '' : 's'} (newer change kept)`);
  if (summary.hiddenAdult) parts.push(`${summary.hiddenAdult} adult title${summary.hiddenAdult === 1 ? '' : 's'} skipped`);
  if (summary.removedRemotely) parts.push(`${summary.removedRemotely} no longer on MyAnimeList (kept here)`);
  if (summary.unlinked) parts.push(`${summary.unlinked} not linked to MyAnimeList yet`);
  const lead = parts.length ? parts.join(', ') : 'Everything matches';
  return [`${lead}.`, ...(summary.notes || [])].join(' ');
}

export { toLocalStatus };
