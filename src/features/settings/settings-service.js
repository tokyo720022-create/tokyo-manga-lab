import { getRecord, putRecord } from '../../data/database.js';
import { SETTINGS_CATEGORIES } from './settings-schema.js';

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'sakura',
  adultContentEnabled: false,
  reducedMotion: false,
  defaultLibrarySort: 'recently-updated',
  preferredLanguage: 'en',
  enableOnlineSearch: true,
  coverSize: 'comfortable',
  readerMode: 'scroll',
  readerFit: 'width',
  readerQuality: 'data',
  readerOrientation: 'auto',
  readerAutoSpeed: '3',
  readerShowStatusBar: true,
  readerShowClock: false,
  readerVolumeKeys: false,
  readerChapterNotice: false,
  readerSkipExtras: false,
  anilistClientId: '',
  anilistPushEnabled: false,
  trackerAutoUpdate: true,
  trackerMarkRead: 'always',
  chapterSortKey: 'source',
  chapterSortDir: 'desc',
  chapterDisplay: 'source-title',
  chapterFilterUnread: false,
  chapterFilterBookmarked: false
});

const BOOLEAN_KEYS = new Set(['adultContentEnabled', 'reducedMotion', 'enableOnlineSearch', 'anilistPushEnabled', 'readerShowStatusBar', 'readerShowClock', 'readerVolumeKeys', 'readerChapterNotice', 'readerSkipExtras', 'trackerAutoUpdate', 'chapterFilterUnread', 'chapterFilterBookmarked']);

// Allowed values for every select setting come from the schema, so the UI and validation cannot drift apart.
function allowedValues(key) {
  for (const category of SETTINGS_CATEGORIES) {
    for (const group of category.groups) {
      const item = group.items.find(entry => entry.key === key && (entry.type === 'select' || entry.type === 'themes'));
      if (item) return item.options.map(([value]) => value);
    }
  }
  return null;
}

export function normalizeSettingValue(key, value) {
  if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new Error('Unknown setting.');
  if (BOOLEAN_KEYS.has(key)) return Boolean(value);
  if (key === 'anilistClientId') {
    const text = String(value ?? '').trim();
    if (!/^\d{0,9}$/.test(text)) throw new Error('The AniList client ID is a number, for example 12345.');
    return text;
  }
  const allowed = allowedValues(key);
  if (allowed && !allowed.includes(value)) throw new Error('That option is not available.');
  return value;
}

export async function loadSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const record = await getRecord('appSettings', key);
    if (record && Object.hasOwn(record, 'value')) {
      try { settings[key] = normalizeSettingValue(key, record.value); }
      catch { settings[key] = DEFAULT_SETTINGS[key]; }
    }
  }
  return settings;
}

export async function saveSetting(key, value) {
  const clean = normalizeSettingValue(key, value);
  const record = { key, value: clean, updatedAt: new Date().toISOString() };
  await putRecord('appSettings', record);
  return record;
}
