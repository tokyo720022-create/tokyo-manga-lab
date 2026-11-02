// The PIN record lives in `accountLinks`, which is never part of a backup, so a PIN hash never leaves this device.
import { deleteRecord, getRecord, putRecord } from '../../data/database.js';

const KEY = 'privacy-lock';
export const getPinRecord = () => getRecord('accountLinks', KEY);
export const savePinRecord = record => putRecord('accountLinks', { ...record, provider: KEY });
export const clearPinRecord = () => deleteRecord('accountLinks', KEY);
