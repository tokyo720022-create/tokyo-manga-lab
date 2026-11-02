// Connects the pieces: AniList client + planner + local library. UI code calls only this module.
import { getAllRecords, getRecord, putRecord } from '../../data/database.js';
import { addToLibrary, cacheCatalogueItems } from '../../data/repositories/library-repository.js';
import { MAX_PUSHES_PER_RUN, PUSH_SPACING_MS } from './anilist-config.js';
import { AniListError, createAniListClient } from './anilist-client.js';
import { normalizeRemoteEntry, toRemoteStatus } from './anilist-mapper.js';
import { planSync } from './sync-planner.js';
import {
  clearAccount, deleteOutbox, getAccount, getOutbox, getSyncLinks, getTracking, putOutbox, putSyncLinks, putTracking, saveAccount, syncLinkId
} from './anilist-store.js';
import { normalizeProfile, profileIsStale } from './anilist-profile.js';
import { patchIsEmpty, patchToVariables, planAfterRead, toDateText } from '../tracking/tracking.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const LIBRARY_PROFILE = 'local-default';

export async function connectWithToken({ accessToken, expiresAt }, { fetchImpl } = {}) {
  const client = createAniListClient({ token: accessToken, fetchImpl });
  const viewer = await client.viewer();
  const previous = await getAccount();
  const same = previous?.viewer?.id === viewer.id;
  const account = { accessToken, expiresAt, viewer, connectedAt: Date.now(), lastSync: same ? previous.lastSync || null : null, profile: same ? previous.profile || null : null };
  await saveAccount(account);
  return account;
}

// Loads the profile shown on the Profile screen and keeps a copy on the account, so it still shows offline.
// Returns the saved profile (possibly older) when AniList cannot be reached.
export async function refreshProfile({ fetchImpl, force = false } = {}) {
  const account = await getAccount();
  if (!describeAccount(account).connected) return null;
  if (!force && !profileIsStale(account.profile)) return account.profile;
  try {
    const client = createAniListClient({ token: account.accessToken, fetchImpl });
    const viewer = await client.profile();
    let social = null;
    try { social = await client.socialCounts(viewer.id); } catch { social = account.profile ? { followers: account.profile.followers, following: account.profile.following } : null; }
    const profile = normalizeProfile(viewer, social);
    const latest = await getAccount();
    if (latest && latest.viewer?.id === viewer.id) await saveAccount({ ...latest, profile });
    return profile;
  } catch (error) {
    if (error?.code === 'UNAUTHORIZED') throw error;
    return account.profile || null;
  }
}

export async function disconnect() { await clearAccount(); }

export function describeAccount(account, now = Date.now()) {
  if (!account) return { connected: false, expired: false, label: 'Not connected' };
  if (account.expiresAt && account.expiresAt < now) return { connected: false, expired: true, label: 'Sign-in expired. Connect again.' };
  return { connected: true, expired: false, label: `Connected as ${account.viewer?.name || 'AniList user'}` };
}

export async function activeClient(fetchImpl) {
  const account = await getAccount();
  const state = describeAccount(account);
  if (!state.connected) throw new AniListError(state.expired ? 'AniList sign-in expired. Connect again.' : 'Connect your AniList account first.', { code: 'UNAUTHORIZED' });
  return { account, client: createAniListClient({ token: account.accessToken, fetchImpl }) };
}

// Maps: AniList id <-> internal content id, built from sourceEntries (provider ids live there by design).
export async function loadMappings() {
  // Chapter-source link rows describe where chapters come from; they are not identity mappings.
  const rows = (await getAllRecords('sourceEntries')).filter(row => !row.linkRole);
  const byKey = new Map(rows.map(row => [`${row.sourceId}:${row.externalId}`, row.contentItemId]));
  const mediaByContent = new Map();
  for (const row of rows) if (row.sourceId === 'anilist') mediaByContent.set(row.contentItemId, String(row.externalId));
  return { byKey, mediaByContent };
}

// Turns an AniList entry into the row the tracking panel shows.
export function trackingRowFromEntry({ mediaId, contentItemId, userId, entry, media = null, previous = null }) {
  return {
    mediaId: String(mediaId), contentItemId, userId,
    entryId: entry?.id ?? null, onList: Boolean(entry),
    status: entry?.status ?? null, progress: Number(entry?.progress) || 0, score: Number(entry?.score) || 0,
    startedAt: toDateText(entry?.startedAt), completedAt: toDateText(entry?.completedAt),
    totalChapters: Number(media?.chapters) || previous?.totalChapters || 0,
    title: media ? (media.title?.english || media.title?.romaji || media.title?.native || previous?.title || '') : (previous?.title || ''),
    siteUrl: media?.siteUrl || previous?.siteUrl || `https://anilist.co/manga/${mediaId}`,
    updatedAtMs: (Number(entry?.updatedAt) || 0) * 1000
  };
}

// Sends everything waiting in the outbox. A row holds a library status (from the library) and/or a patch (from tracking:
// chapters read, score, dates, status). Network trouble keeps rows queued and stops; nothing is lost.
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
        // "A chapter was read": decide against what AniList has right now, so progress can only go up and nothing is overwritten with older numbers.
        const media = await client.mediaEntry(row.mediaId);
        const remoteEntry = media.mediaListEntry;
        const plan = planAfterRead({
          entry: remoteEntry ? { status: remoteEntry.status, progress: remoteEntry.progress, startedAt: toDateText(remoteEntry.startedAt), completedAt: toDateText(remoteEntry.completedAt) } : null,
          chapterNumber: row.autoRead.chapterNumber, totalChapters: media.chapters
        });
        Object.assign(patch, plan || {});
        if (patchIsEmpty(patch) && !row.libraryStatus) {
          await deleteOutbox(row.id);
          const before = await getTracking(row.contentItemId);
          if (remoteEntry) await putTracking(trackingRowFromEntry({ mediaId: row.mediaId, contentItemId: row.contentItemId, userId: account.viewer.id, entry: remoteEntry, media, previous: before }));
          continue;
        }
      }
      if (patch.status === undefined && row.libraryStatus && toRemoteStatus(row.libraryStatus)) patch.status = toRemoteStatus(row.libraryStatus);
      const saved = await client.saveEntry({ mediaId: row.mediaId, ...patchToVariables(patch) });
      await deleteOutbox(row.id);
      const previous = (await getSyncLinks(account.viewer.id)).get(String(row.mediaId));
      if (row.libraryStatus) {
        await putSyncLinks([{ id: syncLinkId(row.mediaId), provider: 'anilist', userId: account.viewer.id, mediaId: row.mediaId, contentItemId: row.contentItemId, entryId: saved.id, baseStatus: row.libraryStatus, remoteProgress: saved.progress ?? 0, remoteUpdatedAtMs: (saved.updatedAt || 0) * 1000, syncedAt: Date.now() }]);
      } else if (previous) {
        // A tracking-only change: refresh the numbers but do not claim the library and AniList agree on a status.
        await putSyncLinks([{ ...previous, entryId: saved.id, remoteProgress: saved.progress ?? 0, remoteUpdatedAtMs: (saved.updatedAt || 0) * 1000, syncedAt: Date.now() }]);
      }
      const trackingBefore = await getTracking(row.contentItemId);
      await putTracking(trackingRowFromEntry({ mediaId: row.mediaId, contentItemId: row.contentItemId, userId: account.viewer.id, entry: saved, previous: trackingBefore }));
      sent += 1;
      applied.push({ mediaId: String(row.mediaId), contentItemId: row.contentItemId, patch, saved });
      if (sleepMs) await sleep(sleepMs);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') { await clearAccount(); throw error; }
      if (['RATE_LIMITED', 'UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT'].includes(error.code)) {
        // AniList is busy, down or unreachable. Keep the change queued and stop instead of hammering it.
        await putOutbox({ ...row, lastError: error.message, retryAfter: Date.now() + (error.retryAfter || 300) * 1000 });
        break;
      }
      await putOutbox({ ...row, attempts: (row.attempts || 0) + 1, lastError: error.message });
    }
  }
  return { sent, remaining: (await getOutbox()).length, applied };
}

// Queue a tracking change for AniList, merged with anything already waiting for the same title.
//   patch            fields the person set in the tracking panel (status, progress, score, dates)
//   autoReadChapter  "this chapter was read": resolved against AniList's current entry when it is sent
export async function queueTrackingPatch({ mediaId, contentItemId, patch = {}, autoReadChapter = null }) {
  const existing = (await getOutbox()).find(row => row.id === syncLinkId(mediaId));
  const merged = { ...(existing?.patch || {}), ...patch };
  const before = Number(existing?.autoRead?.chapterNumber);
  const now = autoReadChapter === null || autoReadChapter === undefined ? NaN : Number(autoReadChapter);
  const highest = Math.max(Number.isFinite(before) ? before : -Infinity, Number.isFinite(now) ? now : -Infinity);
  await putOutbox({
    id: syncLinkId(mediaId), provider: 'anilist', mediaId: String(mediaId), contentItemId,
    // A status picked in the tracking panel replaces an older library status that was still waiting.
    libraryStatus: patch.status !== undefined ? undefined : existing?.libraryStatus,
    patch: merged, autoRead: Number.isFinite(highest) ? { chapterNumber: highest } : undefined,
    status: 'pending', createdAt: existing?.createdAt || Date.now(), attempts: 0
  });
}

// Called after the user changes a title's status here. Quietly queues a push when the title has an AniList id.
export async function notifyLocalChange(contentItemId, { fetchImpl, flush = true } = {}) {
  const account = await getAccount();
  if (!describeAccount(account).connected) return { queued: false, reason: 'not-connected' };
  const { mediaByContent } = await loadMappings();
  const mediaId = mediaByContent.get(contentItemId);
  if (!mediaId) return { queued: false, reason: 'not-linked' };
  const entry = await getRecord('libraryEntries', `${LIBRARY_PROFILE}:${contentItemId}`);
  if (!entry || !toRemoteStatus(entry.personalStatus)) return { queued: false, reason: 'no-entry' };
  const waiting = (await getOutbox()).find(row => row.id === syncLinkId(mediaId));
  // A library status change replaces an older status in a waiting patch but keeps its chapters, score and dates.
  const patch = { ...(waiting?.patch || {}) };
  delete patch.status;
  await putOutbox({ id: syncLinkId(mediaId), provider: 'anilist', mediaId, contentItemId, libraryStatus: entry.personalStatus, patch, status: 'pending', createdAt: waiting?.createdAt || Date.now(), attempts: 0 });
  if (flush) flushOutbox({ fetchImpl }).catch(() => {});
  return { queued: true, mediaId };
}

async function applyPull(pull, remote, userId) {
  const raw = remote.item;
  let contentItemId = pull.contentItemId;
  if (!contentItemId) {
    const [item] = await cacheCatalogueItems([raw]);
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

  onProgress('Reading your AniList manga list');
  const remoteAll = (await client.mangaList(userId)).map(normalizeRemoteEntry).filter(Boolean);
  const remote = allowAdult ? remoteAll : remoteAll.filter(entry => !entry.isAdult);
  summary.hiddenAdult = remoteAll.length - remote.length;
  const remoteById = new Map(remote.map(entry => [entry.mediaId, entry]));

  // Exact links only: attach an AniList id to a MangaDex title we already have when AniList lists that MangaDex id.
  const { byKey, mediaByContent: initialMedia } = await loadMappings();
  for (const entry of remote) {
    if (!entry.mangadexId || byKey.has(`anilist:${entry.mediaId}`)) continue;
    const existing = byKey.get(`mangadex:${entry.mangadexId}`);
    if (existing && !initialMedia.has(existing)) {
      // Only add the id mapping. Never overwrite the MangaDex metadata we already have.
      await putRecord('sourceEntries', {
        id: `anilist:${entry.mediaId}`, contentItemId: existing, sourceId: 'anilist', externalId: entry.mediaId,
        sourceUrl: `https://anilist.co/manga/${entry.mediaId}`, sourceTitle: entry.item.title, language: null,
        availabilityStatus: 'available', lastCheckedAt: new Date().toISOString()
      });
    }
  }
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
    if (!doPush) { summary.notes.push('Skipped sending changes to AniList.'); }
  }
  const pushes = doPush ? plan.pushes : [];
  summary.skippedPush = plan.skippedPush.length + (doPush ? 0 : plan.pushes.length);
  summary.conflicts = plan.conflicts.length;
  summary.removedRemotely = plan.removedRemotely.length;

  const now = Date.now();
  const linkRows = [];
  const makeLink = (mediaId, contentItemId, status, remoteEntry) => ({
    id: syncLinkId(mediaId), provider: 'anilist', userId, mediaId, contentItemId,
    entryId: remoteEntry?.entryId ?? links.get(mediaId)?.entryId ?? null, baseStatus: status,
    remoteProgress: remoteEntry?.progress ?? links.get(mediaId)?.remoteProgress ?? 0, remoteUpdatedAtMs: remoteEntry?.updatedAtMs ?? 0, syncedAt: now
  });

  onProgress('Updating your library');
  for (const pull of plan.pulls) {
    const entry = remoteById.get(pull.mediaId);
    const contentItemId = await applyPull(pull, entry, userId);
    linkRows.push(makeLink(pull.mediaId, contentItemId, pull.status, entry));
    summary.pulled += 1;
  }
  for (const row of plan.inSync) {
    linkRows.push(makeLink(row.mediaId, row.contentItemId, row.status, remoteById.get(row.mediaId)));
    summary.inSync += 1;
  }
  await putSyncLinks(linkRows);

  let stopped = null;
  const batch = pushes.slice(0, MAX_PUSHES_PER_RUN);
  summary.pending = pushes.length - batch.length;
  for (const [index, push] of batch.entries()) {
    onProgress(`Sending changes to AniList (${index + 1} of ${batch.length})`);
    try {
      const saved = await client.saveEntry({ mediaId: push.mediaId, status: toRemoteStatus(push.status) });
      await putSyncLinks([{ ...makeLink(push.mediaId, push.contentItemId, push.status, null), entryId: saved.id, remoteProgress: saved.progress ?? 0, remoteUpdatedAtMs: (saved.updatedAt || 0) * 1000 }]);
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

  const fresh = await getAccount();
  if (fresh) await saveAccount({ ...fresh, lastSync: summary });
  return summary;
}

export function describeSummary(summary) {
  if (!summary) return 'Not synced yet.';
  const parts = [];
  if (summary.pulled) parts.push(`${summary.pulled} updated here`);
  if (summary.pushed) parts.push(`${summary.pushed} sent to AniList`);
  if (summary.conflicts) parts.push(`${summary.conflicts} conflict${summary.conflicts === 1 ? '' : 's'} (newer change kept)`);
  if (summary.hiddenAdult) parts.push(`${summary.hiddenAdult} adult title${summary.hiddenAdult === 1 ? '' : 's'} skipped`);
  if (summary.removedRemotely) parts.push(`${summary.removedRemotely} no longer on AniList (kept here)`);
  if (summary.unlinked) parts.push(`${summary.unlinked} not linked to AniList yet`);
  const lead = parts.length ? parts.join(', ') : 'Everything matches';
  return [`${lead}.`, ...(summary.notes || [])].join(' ');
}
