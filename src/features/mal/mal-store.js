// Storage for the MyAnimeList connection. Tokens live in the `accountLinks` store, which is never part of a backup.
import { deleteRecord, getAllRecords, getByIndex, getRecord, putMany, putRecord } from '../../data/database.js';

export const PROVIDER = 'mal';
const PENDING = 'mal-pending';
const TRACK = 'mal-track';

export const getAccount = () => getRecord('accountLinks', PROVIDER);
export const saveAccount = account => putRecord('accountLinks', { ...account, provider: PROVIDER });
export const clearAccount = () => deleteRecord('accountLinks', PROVIDER);

// The one-time sign-in attempt: the verifier and state we made, kept until the redirect comes back.
export const markAuthAttempt = ({ verifier, state, clientId }, now = Date.now()) => putRecord('accountLinks', { provider: PENDING, verifier, state, clientId, startedAt: now });
export const getAuthAttempt = () => getRecord('accountLinks', PENDING);
export const clearAuthAttempt = () => deleteRecord('accountLinks', PENDING);

export async function getSyncLinks(userId) {
  const rows = await getAllRecords('syncLinks');
  return new Map(rows.filter(row => row.provider === PROVIDER && row.userId === userId).map(row => [row.mediaId, row]));
}
export const putSyncLinks = rows => putMany('syncLinks', rows);
export const syncLinkId = mediaId => `${PROVIDER}:${mediaId}`;

export const getOutbox = async () => (await getAllRecords('syncOutbox')).filter(row => row.provider === PROVIDER && row.status !== 'done');
export const putOutbox = row => putRecord('syncOutbox', row);
export const deleteOutbox = id => deleteRecord('syncOutbox', id);

export const trackingId = mediaId => `${TRACK}:${mediaId}`;
export async function getTracking(contentItemId) {
  if (!contentItemId) return null;
  return (await getByIndex('syncLinks', 'contentItemId', contentItemId)).find(row => row.provider === TRACK) || null;
}
export const putTracking = row => putRecord('syncLinks', { ...row, id: trackingId(row.mediaId), provider: TRACK, syncedAt: Date.now() });
export const deleteTracking = mediaId => deleteRecord('syncLinks', trackingId(mediaId));
