// Settings are described as data: category (class) > sub-category (group) > item.
//
// Item types
//   toggle   - on/off, saved under `key`
//   select   - one of `options`, saved under `key`
//   themes   - the colour theme picker (cards with a colour preview), saved under `key`
//   action   - a button; `action` is a data-action name handled in app.js
//   link     - opens an https URL in a new tab
//   text     - short text, saved under `key` (use `inputMode` and `placeholder`)
//   info     - read-only value (`value`, or `valueFrom` for a live value computed in app.js)
//   planned  - not built yet; shown dimmed with a "Planned" badge
//
// Any item may carry `when` (see SETTING_CONDITIONS): 'anilistConnected', 'anilistDisconnected', 'nativeAlerts' or 'noNativeAlerts' to show it only in that state.
//
// To add a setting: add the key to DEFAULT_SETTINGS in settings-service.js, then add an item here.
import { APP_NAME, APP_VERSION, MANGADEX_URL, REPO_URL } from '../../shared/app-info.js';
import { API_BASE_URL } from '../../services/api-client.js';
import { THEME_OPTIONS } from '../theme/themes.js';
import { AUTO_LIMIT_OPTIONS, INTERVAL_OPTIONS, SCOPE_OPTIONS } from '../updates/update-plan.js';

export const CHAPTER_LANGUAGES = Object.freeze([
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian'],
  ['id', 'Indonesian'], ['ru', 'Russian'], ['tr', 'Turkish'], ['pl', 'Polish'], ['vi', 'Vietnamese'], ['th', 'Thai'],
  ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']
]);

// Settings home groups its categories under these headings.
export const SETTINGS_SECTIONS = Object.freeze([
  { id: 'app', title: 'App' },
  { id: 'connections', title: 'Accounts and sources' },
  { id: 'data', title: 'Data and about' },
  { id: 'later', title: 'Coming later' }
]);

// A category may show a live value on the settings home: `valueFrom` names one of CATEGORY_VALUES (computed in app.js).
// A group may be `collapsed: true` (an "advanced" fold). An item may carry `badge` (a short tag such as "Android app").
export const SETTINGS_CATEGORIES = Object.freeze([
  {
    id: 'appearance', section: 'app', title: 'Appearance', icon: 'palette', summary: 'Theme and covers', valueFrom: 'theme',
    groups: [
      { id: 'theme', title: 'Theme', items: [
        { type: 'themes', key: 'theme', title: 'Colour theme', description: 'Pick a look. The moon button at the top cycles through them.', options: THEME_OPTIONS },
        { type: 'planned', id: 'accent-colour', title: 'Custom accent colour', description: 'Pick your own accent.' },
        { type: 'planned', id: 'pure-black', title: 'Pure black mode', description: 'True black backgrounds for AMOLED screens.' }
      ] },
      { id: 'display', title: 'Display', items: [
        { type: 'select', key: 'coverSize', title: 'Cover size', description: 'Two covers per row, or three when compact.', options: [['comfortable', 'Comfortable'], ['compact', 'Compact']] },
        { type: 'toggle', key: 'reducedMotion', title: 'Reduce motion', description: 'Turn off animations and transitions.' },
        { type: 'planned', id: 'text-size', title: 'Text size', description: 'Make text larger or smaller across the app.' }
      ] }
    ]
  },
  {
    id: 'reading', section: 'app', title: 'Reading', icon: 'bookOpen', summary: 'Reader and chapters', valueFrom: 'readerMode',
    groups: [
      { id: 'reader', title: 'Reader', items: [
        { type: 'select', key: 'readerMode', title: 'Reading mode', description: 'Scroll for webtoons, right to left for manga.', options: [['scroll', 'Vertical scroll'], ['rtl', 'Right to left'], ['ltr', 'Left to right']] },
        { type: 'select', key: 'readerFit', title: 'Page fit', description: 'For the page-by-page modes.', options: [['width', 'Fit width'], ['height', 'Fit height']] },
        { type: 'select', key: 'readerQuality', title: 'Image quality', description: 'Data saver uses less mobile data.', options: [['data', 'Original quality'], ['data-saver', 'Data saver']] },
        { type: 'select', key: 'readerOrientation', title: 'Screen rotation', badge: 'Android app', description: 'Lock portrait or landscape while reading.', options: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
        { type: 'select', key: 'readerAutoSpeed', title: 'Auto read speed', description: 'Start auto read from the reader options.', options: [['1', 'Very slow'], ['2', 'Slow'], ['3', 'Medium'], ['4', 'Fast'], ['5', 'Very fast']] },
        { type: 'info', title: 'Resume where you left off', value: 'Automatic', description: 'Chapters reopen at the page you stopped on. Finished chapters start at page one.' },
        { type: 'planned', id: 'keep-awake', title: 'Keep screen on', description: 'Stop the screen sleeping while you read.' }
      ] },
      { id: 'reader-display', title: 'Reader display and controls', items: [
        { type: 'toggle', key: 'readerShowStatusBar', title: 'Show status bar', badge: 'Android app', description: 'Turn off to read full screen.' },
        { type: 'toggle', key: 'readerShowClock', title: 'Time and battery', description: 'A small clock and battery level on the page.' },
        { type: 'toggle', key: 'readerVolumeKeys', title: 'Volume keys turn pages', badge: 'Android app', description: 'Volume down goes forward, volume up goes back.' },
        { type: 'toggle', key: 'readerChapterNotice', title: 'Chapter reminder', description: 'Show the chapter name when you open it.' },
        { type: 'toggle', key: 'readerSkipExtras', title: 'Skip extras', description: 'Next and previous skip chapters with no number.' },
        { type: 'action', action: 'reader-tips-reset', title: 'Operation tips', description: 'Show the reader tips again next time.', button: 'Show again' }
      ] },
      { id: 'chapter-list', title: 'Chapter list', items: [
        { type: 'select', key: 'chapterSortKey', title: 'Sort chapters', description: 'By source keeps the MangaDex order.', options: [['source', 'By source'], ['number', 'By chapter number'], ['date', 'By upload date'], ['title', 'Alphabetically']] },
        { type: 'select', key: 'chapterSortDir', title: 'Order', description: 'Which end of the list comes first.', options: [['desc', 'Newest first'], ['asc', 'Oldest first']] },
        { type: 'select', key: 'chapterDisplay', title: 'Chapter names', description: 'Source title, or just the number.', options: [['source-title', 'Source title'], ['number', 'Chapter number']] },
        { type: 'toggle', key: 'chapterFilterUnread', title: 'Only unread chapters', description: 'Hide chapters you have finished.' },
        { type: 'toggle', key: 'chapterFilterBookmarked', title: 'Only bookmarked chapters', description: 'Show only chapters you bookmarked.' }
      ] },
      { id: 'later', title: 'Later', items: [
        { type: 'planned', id: 'reading-goals', title: 'Reading goals', description: 'Weekly goals and streaks.' }
      ] }
    ]
  },
  {
    id: 'downloads', section: 'app', title: 'Downloads', icon: 'download', summary: 'Offline chapters and storage',
    groups: [
      { id: 'offline', title: 'Offline chapters', items: [
        { type: 'select', key: 'downloadQuality', title: 'Download quality', description: 'Data saver files are about half the size.', options: [['data-saver', 'Data saver'], ['data', 'Original quality']] },
        { type: 'toggle', key: 'downloadWifiOnly', title: 'Download on Wi-Fi only', description: 'Waits on mobile data. Needs the phone to report its connection type.' },
        { type: 'select', key: 'downloadStorageLimitMb', title: 'Storage limit', description: 'New downloads wait once this much is used.', options: [['512', '512 MB'], ['1024', '1 GB'], ['2048', '2 GB'], ['5120', '5 GB'], ['0', 'No limit']] },
        { type: 'info', title: 'Saved on this device', valueFrom: 'downloadUsage', description: 'Downloads stay on this phone. They are not part of a backup.' },
        { type: 'action', action: 'open-downloads', title: 'Manage downloads', description: 'See the queue and delete chapters.', button: 'Open' }
      ] },
      { id: 'auto', title: 'Auto-download', items: [
        { type: 'toggle', key: 'autoDownloadEnabled', title: 'Auto-download new chapters', description: 'Saves new chapters of the titles you follow. Uses the Wi-Fi, storage and quality settings above.' },
        { type: 'select', key: 'autoDownloadMax', title: 'Most per title', description: 'The newest chapters are saved first, so a long gap does not fill your phone.', options: AUTO_LIMIT_OPTIONS },
        { type: 'info', title: 'Which titles', value: 'Set in Notifications', description: 'Auto-download follows the same list as new-chapter alerts.' }
      ] }
    ]
  },
  {
    id: 'library', section: 'app', title: 'Library', icon: 'library', summary: 'Sort and backup',
    groups: [
      { id: 'shelf', title: 'Shelf', items: [
        { type: 'select', key: 'defaultLibrarySort', title: 'Sort library by', description: 'Order used when you open your library.', options: [['recently-updated', 'Recently updated'], ['recently-added', 'Recently added'], ['title', 'Title (A to Z)']] }
      ] },
      { id: 'backup', title: 'Backup and restore', items: [
        { type: 'action', action: 'export-backup', title: 'Export backup', description: 'Save library, collections and settings as a file.', button: 'Export' },
        { type: 'action', action: 'import-backup', title: 'Import backup', description: 'Merge a backup file. Downloads are not included.', button: 'Import' }
      ] },
      { id: 'collections', title: 'Collections', items: [
        { type: 'planned', id: 'smart-collections', title: 'Smart collections', description: 'Collections that fill themselves from rules.' },
        { type: 'planned', id: 'manage-collections', title: 'Manage collections', description: 'Rename, reorder and delete collections.' }
      ] }
    ]
  },
  {
    id: 'content', section: 'app', title: 'Language and content', icon: 'globe', summary: 'Language and ratings', valueFrom: 'language',
    groups: [
      { id: 'language', title: 'Language', items: [
        { type: 'select', key: 'preferredLanguage', title: 'Chapter language', description: 'Language chapter lists open in.', options: CHAPTER_LANGUAGES },
        { type: 'toggle', key: 'hideEmptyTitles', title: 'Hide titles with no chapters', description: 'Search skips titles MangaDex has no chapters for in your language.' }
      ] },
      { id: 'safety', title: 'Content safety', items: [
        { type: 'toggle', key: 'adultContentEnabled', title: 'Adult-content preference', badge: 'Android app', description: 'Off by default. A preference on this device, not age verification. Adds titles rated erotica or pornographic.' },
        { type: 'info', title: 'Catalogue ratings', valueFrom: 'ratings', description: 'Titles tagged loli or shota show only when rated safe. Suggestive and adult ones never show.' }
      ] }
    ]
  },
  {
    id: 'account', section: 'connections', title: 'Account and sync', icon: 'cloud', summary: 'AniList, MyAnimeList and tracking', valueFrom: 'anilistStatus',
    groups: [
      { id: 'anilist', title: 'AniList', items: [
        { type: 'info', title: 'Account', valueFrom: 'anilistStatus' },
        { type: 'action', action: 'anilist-connect', title: 'Sign in with AniList', description: 'Opens AniList to approve access.', button: 'Sign in', when: 'anilistDisconnected' },
        { type: 'action', action: 'anilist-register', title: 'Create an AniList account', description: 'Free and optional. Opens anilist.co.', button: 'Register', when: 'anilistDisconnected' },
        { type: 'toggle', key: 'anilistPushEnabled', title: 'Send changes to AniList', description: 'Status changes you make here are saved there too. Nothing is ever deleted.', when: 'anilistConnected' },
        { type: 'action', action: 'anilist-sync', title: 'Sync now', description: 'Bring your AniList manga list in.', button: 'Sync', resultId: 'anilistResult', when: 'anilistConnected' },
        { type: 'info', title: 'Last sync', valueFrom: 'anilistLastSync', when: 'anilistConnected' },
        { type: 'action', action: 'anilist-apps', title: 'Manage access on AniList', description: 'Revoke this app completely on anilist.co.', button: 'Open', when: 'anilistConnected' },
        { type: 'action', action: 'anilist-disconnect', title: 'Sign out', description: 'Removes the sign-in from this device only.', button: 'Sign out', danger: true, when: 'anilistConnected' }
      ] },
      { id: 'mal', title: 'MyAnimeList', items: [
        { type: 'info', title: 'Account', valueFrom: 'malStatus' },
        { type: 'action', action: 'mal-connect', title: 'Sign in with MyAnimeList', description: 'Opens MyAnimeList to approve access. Nothing to set up.', button: 'Sign in', when: 'malDisconnected' },
        { type: 'action', action: 'mal-register', title: 'Create a MyAnimeList account', description: 'Free and optional. Opens myanimelist.net.', button: 'Register', when: 'malDisconnected' },
        { type: 'toggle', key: 'malPushEnabled', title: 'Send changes to MyAnimeList', description: 'Status changes you make here are saved there too. Nothing is ever deleted.', when: 'malConnected' },
        { type: 'action', action: 'mal-sync', title: 'Sync now', description: 'Bring your MyAnimeList manga list in.', button: 'Sync', resultId: 'malResult', when: 'malConnected' },
        { type: 'info', title: 'Last sync', valueFrom: 'malLastSync', when: 'malConnected' },
        { type: 'action', action: 'mal-apps', title: 'MyAnimeList app settings', description: 'Opens myanimelist.net/apiconfig, where your client ID is managed.', button: 'Open', when: 'malConnected' },
        { type: 'action', action: 'mal-disconnect', title: 'Sign out', description: 'Removes the sign-in from this device only.', button: 'Sign out', danger: true, when: 'malConnected' }
      ] },
      { id: 'profile-source', title: 'Profile', items: [
        { type: 'select', key: 'profileSource', title: 'Profile shows', description: 'Which account supplies the name, picture and banner on your Profile when both are connected. MyAnimeList has no banner.', options: [['anilist', 'AniList'], ['mal', 'MyAnimeList']], when: 'bothConnected' }
      ] },
      { id: 'tracking', title: 'Tracking', items: [
        { type: 'toggle', key: 'trackerAutoUpdate', title: 'Update progress after reading', description: 'Updates AniList and MyAnimeList when you finish a chapter. Waits if offline. Progress only goes up.' },
        { type: 'select', key: 'trackerMarkRead', title: 'When marked as read', description: 'Update your tracker when you mark chapters read yourself.', options: [['always', 'Always'], ['ask', 'Ask each time'], ['never', 'Never']] }
      ] },
      { id: 'advanced', title: 'Advanced sign-in options', collapsed: true, items: [
        { type: 'action', action: 'anilist-paste-token', title: 'Paste a token instead', description: 'Use this if sign-in does not return to the app.', button: 'Paste', when: 'anilistDisconnected' },
        { type: 'text', key: 'malClientId', title: 'Use my own client ID', description: 'Optional. Leave empty to use the built-in one. Never paste a Client Secret.', inputMode: 'text', placeholder: 'Built-in ID in use', when: 'malDisconnected' },
        { type: 'text', key: 'anilistClientId', title: 'Use my own AniList app ID', description: 'Optional. Create a free app at anilist.co/settings/developer with redirect URL tokyomangalab://anilist-auth, then paste its number. Leave empty to use the built-in app.', inputMode: 'numeric', placeholder: 'App ID', when: 'anilistDisconnected' }
      ] },
      { id: 'later', title: 'Later', items: [
        { type: 'planned', id: 'more-trackers', title: 'More trackers', description: 'Kitsu, MangaUpdates and others.' },
        { type: 'planned', id: 'sign-in', title: 'Tokyo Manga Lab account', description: 'Sync without AniList and apply as a creator.' },
        { type: 'planned', id: 'profile-details', title: 'Profile details', description: 'Name, avatar and bio.' },
        { type: 'planned', id: 'cloud-sync', title: 'Cloud sync', description: 'Keep library and progress identical on every device.' }
      ] }
    ]
  },
  {
    id: 'sources', section: 'connections', title: 'Sources and connection', icon: 'plug', summary: 'Source and API status',
    groups: [
      { id: 'catalogue', title: 'Catalogue', items: [
        { type: 'toggle', key: 'enableOnlineSearch', title: 'Online catalogue search', description: 'Allow requests to MangaDex. Your library works without it.' },
        { type: 'info', title: 'Active source', value: 'MangaDex' },
        { type: 'planned', id: 'more-sources', title: 'More sources', description: 'Added one at a time, after review.' }
      ] },
      { id: 'connection', title: 'Connection', items: [
        { type: 'info', title: 'API address', value: API_BASE_URL },
        { type: 'action', action: 'check-api', title: 'Test connection', description: 'Check that the catalogue API is reachable.', button: 'Test', resultId: 'apiTestResult' },
        { type: 'action', action: 'check-connections', title: 'Test all connections', description: 'Checks MangaDex, AniList and MyAnimeList and says what to do if one is down.', button: 'Test', resultId: 'connectionsResult' }
      ] }
    ]
  },
  {
    id: 'privacy', section: 'data', title: 'Privacy and data', icon: 'shield', summary: 'What is stored and where',
    groups: [
      { id: 'storage', title: 'On this device', items: [
        { type: 'info', title: 'Where your data lives', value: 'This device only', description: 'No Tokyo Manga Lab account exists. AniList data is sent only if you connect and sync. Backups are files you save yourself.' },
        { type: 'planned', id: 'storage-usage', title: 'Storage usage', description: 'See how much space the app uses.' },
        { type: 'planned', id: 'clear-cache', title: 'Clear cached covers', description: 'Free space without touching your library.' }
      ] }
    ]
  },
  {
    id: 'about', section: 'data', title: 'About', icon: 'info', summary: 'Version, credits and links',
    groups: [
      { id: 'app', title: 'App', items: [
        { type: 'info', title: 'Version', value: `${APP_NAME} ${APP_VERSION}` },
        { type: 'info', title: 'Made by', value: 'Hariharasuthan Karunakaran', description: 'Tokyo Brotherhood' }
      ] },
      { id: 'links', title: 'Links', items: [
        { type: 'link', title: 'Source code', href: REPO_URL, description: 'View the project on GitHub.' },
        { type: 'link', title: 'MangaDex', href: MANGADEX_URL, description: 'Catalogue data and covers come from MangaDex.' }
      ] }
    ]
  },
  {
    id: 'notifications', section: 'app', title: 'Notifications', icon: 'bell', summary: 'New chapter alerts',
    groups: [
      { id: 'alerts', title: 'New chapters', items: [
        { type: 'toggle', key: 'updatesEnabled', title: 'Check for new chapters', description: 'Looks for new chapters of the titles you follow when the app is open.' },
        { type: 'select', key: 'updatesScope', title: 'Titles to follow', description: 'Only titles saved from MangaDex can be checked.', options: SCOPE_OPTIONS },
        { type: 'select', key: 'updatesInterval', title: 'Check how often', description: 'Used while the app is open, and by phone alerts in the Android app.', options: INTERVAL_OPTIONS },
        { type: 'info', title: 'Status', valueFrom: 'updateStatus' },
        { type: 'action', action: 'check-updates', title: 'Check now', description: 'New chapters appear on Home.', button: 'Check', resultId: 'updatesResult' },
        { type: 'action', action: 'updates-clear', title: 'Clear the list', description: 'Empties New chapters on Home. Reading progress is untouched.', button: 'Clear' }
      ] },
      { id: 'phone', title: 'Phone alerts', items: [
        { type: 'toggle', key: 'updatesPhoneAlerts', title: 'Alert me on my phone', description: 'A notification when a new chapter arrives, even with the app closed.', badge: 'Android app', when: 'nativeAlerts' },
        { type: 'info', title: 'Alert permission', valueFrom: 'alertsStatus', when: 'nativeAlerts' },
        { type: 'action', action: 'enable-alerts', title: 'Allow notifications', description: 'Android asks once. You can change it later in system settings.', button: 'Allow', when: 'nativeAlerts' },
        { type: 'info', title: 'Alerts with the app closed', value: 'Not in this build', description: 'This build checks only while the app is open. See docs/UPDATES.md for the optional Android add-on.', when: 'noNativeAlerts' },
        { type: 'planned', id: 'reminders', title: 'Reading reminders', description: 'A gentle nudge at a time you choose.' }
      ] }
    ]
  }
]);

export function findCategory(id) {
  return SETTINGS_CATEGORIES.find(category => category.id === id) || null;
}

export const SETTING_CONDITIONS = Object.freeze(['anilistConnected', 'anilistDisconnected', 'malConnected', 'malDisconnected', 'bothConnected', 'nativeAlerts', 'noNativeAlerts']);
export const DYNAMIC_VALUES = Object.freeze(['anilistStatus', 'anilistLastSync', 'malStatus', 'malLastSync', 'ratings', 'downloadUsage', 'updateStatus', 'alertsStatus']);
export const CATEGORY_VALUES = Object.freeze(['theme', 'readerMode', 'language', 'anilistStatus']);

export function allSettingKeys() {
  const keys = [];
  for (const category of SETTINGS_CATEGORIES) for (const group of category.groups) for (const item of group.items) if (item.key) keys.push(item.key);
  return keys;
}
