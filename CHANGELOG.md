# Changelog

## 0.4.0-preview — Claude Starter Kit
- Combined the code foundation with the full product blueprint and Claude master prompt.
- Added detailed data-schema and release roadmap documents.
- Added Termux bootstrap/verification and ZIP packaging scripts.
- Added GitHub Actions workflow for syntax checks, tests and downloadable ZIP artifact.
- Included the approved generated UI concept image for Claude as visual reference.
- Existing tests: 17 passing in the packaging environment.

## 0.5.0 - Android APK wrapper
- Capacitor Android wrapper (config, www bundle script, icon generation).
- `Build Android APK` and `Unzip and apply ZIP` GitHub Actions workflows.
- See BUILD-APK.md.

## 0.5.1 - UI refresh
- New design: cover-first poster cards, shelves on Home, floating bottom navigation with icons.
- Profile is now a hub of sections, with planned-feature slots.
- Settings are organised as categories and sub-categories, driven by `settings-schema.js`.
- New settings: cover size, sort library by, chapter language (now used when opening a title).
- Fixed: the chapter language menu in the title sheet did nothing.
- See docs/EXTENDING-UI.md.

## 0.6.0 - AniList sync
- Sign in with AniList (one-tap app link, or paste a token), import your manga list, and save status changes back.
- Exact-ID matching only, never deletes, asks before adding titles to AniList, skips adult titles while that preference is off.
- Android build registers the `tokyomangalab://anilist-auth` link and bundles the Capacitor App and Browser plugins.
- Local database upgraded to version 2 (new `accountLinks` and `syncLinks` stores; existing data is kept).
- Worker passes `anilistId` and `malId` through (not deployed by this change).
- See docs/ANILIST.md.

## 0.7.0 - Reader
- In-app manga reader for MangaDex chapters: tap **Read** in a title's chapter list. Vertical scroll, right-to-left and left-to-right modes, page slider, tap zones and arrow keys, previous/next chapter, data-saver quality.
- Resumes where you stopped and records finished chapters (`chapterProgress`) and reading sessions (`readingSessions`), so the statistics screen starts counting real reading. No database version change.
- Pages load directly from MangaDex nodes; the app does not download, store or re-host them. Expired or failing addresses are refreshed automatically (rate-limited and capped), with a manual retry.
- Sends MangaDex's requested image-load reports (URL, result and timing only; no account data).
- Worker: new `GET /api/v1/chapters/{id}/pages` (not deployed by this change). The reader needs this Worker update; until it is deployed the Read screen explains that and links to MangaDex.
- Adult MangaDex ratings (erotica, pornographic) are available only in the Android app, behind the off-by-default preference with a confirmation. The web demo never receives them. Loli/shota-tagged titles are blocked in every mode.
- New settings: reading mode, page fit, image quality.
- No third-party adult sites were added; see docs/ADULT-SOURCES.md.

## 0.7.1 - Reader image recovery
- If the WebView will not show a page image, the reader now fetches the same address through the app's own network layer (Capacitor native HTTP) and shows that copy. It also reports the real size and X-Cache result to MangaDex in that case.
- When a page still fails, the message says why (refused 403, not found 404, rate limited, could not connect, not an image) and names the image server host and port, so a blocked network can be told apart from an expired address.
- Fix: a failed page no longer needs an automatic address refresh before the app-network fallback is tried.

## 0.8.0 - Reader options
- New **Reader options** sheet (sliders button in the reader's top bar): reading mode (left to right, right to left, vertical), image quality, **auto read** with five speeds, **screen rotation** (auto, portrait, landscape), **show status bar**, **time and battery**, **volume keys turn pages**, **chapter reminder**, **skip extras**, share the chapter link, the operation tips, and a shortcut to more settings. Every option is also in Settings > Reading and is saved on the device.
- Auto read scrolls by itself in vertical mode and turns pages on a timer in the page modes. Touching the page while it scrolls pauses it, and the on-screen pill resumes or stops it.
- Operation tips appear the first time you open the reader and can be shown again from the sheet or from Settings.
- Fix: a chapter MangaDex has no readable pages for (for example some One Piece chapters) now says so, using the Worker's own message, instead of claiming the reader is not available yet.
- Android build: adds the Capacitor Status Bar and Screen Orientation plugins and a small `MainActivity` hook that passes the volume keys to the page only while the reader is open and the volume option is on (the reader address carries `?vol=1`). Everywhere else the volume keys work normally.
- Status bar, rotation and volume keys only work in the Android app. In a browser they say so instead of failing.
- The Worker did not change in this version.

## 0.9.0 - AniList to MangaDex linking
- AniList-only titles can now list and read chapters: the title sheet matches the AniList numeric ID against MangaDex's `anilistId`, and otherwise offers a candidate picker. Titles are never linked by name similarity.
- The link is a separate `sourceEntries` row (no schema change). AniList description and artwork are kept; MangaDex only fills blanks. Chapter availability comes from the linked MangaDex record.
- Change or unlink from the title sheet. New `docs/LINKING.md`, 14 unit tests and an end-to-end test.
- Service worker cache bumped to `v8`.
- `worker/wrangler.toml` name corrected from `tokyo-manga-lab-api` to `tokyo-manga-lab-api2` so it matches the live Worker. Nothing was deployed.

## 0.9.1 - Bug-fix round
- Search: typing no longer loses focus. Only the results area redraws.
- Title sheet: it now has its own history entry, so the Android Back button and Esc close it instead of changing the page behind it. Back from the reader returns to the page the sheet was opened from.
- Adult-rated titles are hidden from the Library and Home while the preference is off (or in the web build). They stay saved on this device, and the Library says how many are hidden.
- Chapter lists skip chapters hosted on other sites and chapters with no pages (Worker change: `includeExternalUrl=0`, `includeEmptyPages=0`). Redeploy the Worker to get this.
- Export backup works in the Android app: the file goes to the share sheet (needs `@capacitor/filesystem` and `@capacitor/share`).
- APK signing: the build can use one saved key (`ANDROID_DEBUG_KEYSTORE_BASE64`) so updates install over older builds. See `docs/SIGNING.md`; the workflow file is in `docs/workflows/` and must be pasted into `.github/workflows/` by hand.
- Smaller: bigger tap targets, higher contrast for faint text, collections chosen in an in-app sheet instead of a prompt box, `npm run check` finds every file itself (and fails if the offline cache misses a module), `DELETE-FILES.txt` support in the import script, `mangadex-live.js` queued for removal, Worker User-Agent version.
- Service worker cache bumped to `v9`.


## 0.9.2 - Covers, logo, hardening
- **New logo** used as the Android app icon, header mark, browser favicon and home-screen icons (192, 512 and Apple touch PNGs, plus a maskable entry in the manifest).
- **Covers:** MangaDex covers load a sharper 512 version on high-density screens, show a loading shimmer (still when reduced motion is on), retry once if the network blinks, fall back to the other known cover for linked titles, and then to the local placeholder. Covers are cached in a separate cache that survives app updates and is trimmed to 400 images. The cover-size setting now also applies to the Home rails and the Library list.
- **Security:** a Content-Security-Policy limits scripts, connections and objects to what the app uses. Cover addresses are only accepted from `uploads.mangadex.org` and `*.anilist.co` over https, so an imported backup cannot make the app load images from elsewhere.
- **Offline cache:** the shell cache is named after the app version (`sw.js?v=<version>`), so a release can no longer leave an old cache behind by forgetting to bump a number.
- **Backups merge instead of overwrite:** importing keeps whichever copy is newer, includes AniList sync links, and says how many items were kept because they are newer on this device.
- Chapter progress: a one-page chapter is finished only when you reach its end card. A saved title no longer loses its description or cover when a later catalogue response comes back with blanks.
- Errors: a catalogue outage that returns a web page instead of JSON now gives the friendly "temporarily unavailable" message. A blocked database upgrade (another tab still open) no longer hangs the app.
- Worker: best-effort per-IP rate limit (120 requests per minute per Worker instance, `/health` exempt). Redeploy the Worker to get it.
- Text that described an older build (cloud sync, "after the reader is connected", Downloads) was rewritten to match what the app does now.
- Build: `docs/workflows/build-apk.yml` uses `npm ci` when a `package-lock.json` exists and uploads the generated lockfile as an artifact when it does not. `docs/workflows/ci.yml` gains a browser-test job.
- Tests: the browser suites now live in `tests/e2e/` (`python3 tests/e2e/run.py`) and also fail on any Content-Security-Policy violation. 116 unit tests.
- **Comick** was reviewed as a second manga source and **not added**; see `docs/SOURCE-REVIEW.md`.

## 0.9.3 - Optional AniList login, one tap
- AniList sign-in now works the way other AniList apps do: the app can ship with its own public app ID, so people tap **Log in with AniList** instead of creating an app and pasting an ID. Set it once in `src/features/anilist/anilist-config.js` (`DEFAULT_ANILIST_CLIENT_ID`); see `docs/ANILIST.md`. Until it is set, the app explains this and still lets people paste their own ID or a token.
- New **Connect AniList** card on Profile: says it is optional, says the app works fully without it, reminds people to check the address says anilist.co, and offers **Log in**, **Register** (anilist.co/signup) and **Not now**. The choice is remembered. Once connected the card shows the account and a Sync button.
- Settings > Account and sync: the client ID box is now "Use my own AniList app ID (advanced)"; new **Create an AniList account** and **Manage access on AniList** rows. A typed ID wins over the built-in one.
- Nothing is gated behind a login. A returning sign-in link is still accepted only right after sign-in was started in the app.
- Tests: 122 unit tests; new browser suite `login_card_e2e.py` (9 suites in all).

## 0.9.4 - Chapter list options and AniList tracking
- **Chapter list:** the whole list now loads (100 chapters at a time) so it can be sorted and filtered as one list. New filter button on a title with Mihon-style tabs: **Filter** (unread, bookmarked, scanlator), **Sort** (by source, chapter number, upload date, alphabetically; tap the selected one to flip the order) and **Display** (source title or chapter number). Choices are saved on the device and also appear in Settings > Reading > Chapter list. The reader still uses MangaDex order for Next and Previous.
- **Per-chapter menu (the dots):** mark as read or unread, mark previous chapters as read, bookmark. Read chapters are dimmed; unfinished ones show the page you stopped on.
- **Tracking panel on every title** (Tracking button): status, chapters read (with + and -), score 0-10, start date and finish date. A title is linked to AniList by exact ID (its own AniList entry, a stored link, or the AniList ID MangaDex lists). If there is none you search AniList and pick the right one yourself; names are never matched automatically.
- **Update progress after reading** (Settings > Account and sync > Tracking, on by default): finishing a chapter updates AniList right away. **Update progress when marked as read:** Always, Ask each time, or Never.
- **Instant, with a safety net:** changes are sent immediately. If AniList cannot be reached they are kept on the device and sent when you are back online or next open the app. Chapter updates are decided against AniList's current entry when sent, so progress only ever goes up; reaching the last chapter completes the title and fills the start and finish dates.
- Worker: chapter pages accept `limit` (up to 100). Redeploy the Worker for faster loading; without it the app still works, 24 at a time.
- Tests: 160+ unit tests; new browser suite `tracking_e2e.py` (10 suites).

## 0.9.4 - Chapter options and AniList tracking (Mihon style)
- **Chapter list options** (the sliders button on a title): **Sort** by source, chapter number, upload date or alphabetically (tap the selected one to flip the order), **Filter** by unread, bookmarked or scanlator, **Display** as source title or chapter number. Choices are saved in Settings > Reading > Chapter list.
- The whole chapter list now loads (100 at a time, shown 60 rows at a time with Show more), so sorting and filtering work across every chapter, not one page. A very long title shows a "Load the remaining chapters" button. The Worker accepts `limit` up to 100 for chapter pages (redeploy it for fewer requests; the older Worker still works, just slower).
- Every chapter row has a ⋯ menu: **Mark as read / unread**, **Mark previous as read**, **Bookmark**. Read chapters are dimmed with a tick, unread ones have a dot, and a started chapter shows its page.
- **Tracking** button on every title: link it to AniList (the AniList ID is used when known; otherwise you search and pick, never matched by name), then set **status, chapters read (with + and −), score (0-10), start date and finish date**. Each change is sent to AniList straight away.
- **Update progress after reading** (Settings > Account and sync > Tracking, on by default): finishing a chapter in the reader updates AniList. Progress only goes up, a title that was planned, paused or dropped becomes Reading, the start date is filled in once, and reaching the last chapter completes it. It is checked against AniList's live entry when sent, so older numbers never overwrite newer ones.
- **Update progress when marked as read**: Always, Ask each time, or Never.
- If AniList cannot be reached, the change is saved on this device, the panel says so, and it is sent when the phone is back online or the next time the app opens.
- Browser tests: new `tracking_e2e.py` (10 suites in all). 145 unit tests.
- Not done: other trackers (MyAnimeList, Kitsu and so on) are listed as planned; chapter downloads (the Downloaded filter) do not exist yet.

## 0.9.5 - Built-in AniList app ID and tidier Settings
- The app now ships with its AniList app ID (44302), so **Log in with AniList** is one tap in the Android app. The app's Redirect URL on anilist.co must be exactly `tokyomangalab://anilist-auth`. An ID typed in Settings still wins.
- **Settings reorganised.** Settings home groups categories under App, Accounts and sources, Data and about, with a live value on the right (theme, reading mode, language, AniList state) and a search box that finds any setting. Category pages use a header icon, short one-line descriptions, small "Android app" tags instead of long notes, and one collapsed "Coming later" list at the bottom instead of dimmed planned rows scattered through the page.
- **Account and sync page** now reads top to bottom: AniList account (sign in or sync), Tracking, then a collapsed "Advanced sign-in options" holding Paste a token and Use my own app ID. The app-ID field sits full width under its description.
- Profile: stats come first, the AniList card is shorter, Settings shortcuts are one clear group, planned features are folded away. Downloads no longer lists a planned item among real information. Wide screens show Settings and Profile in one centred column. Section headings are small capitals so headings and rows are easier to tell apart.
- Every settings key and behaviour is unchanged; no data migration. Tests: 147 unit tests; browser tests updated for the collapsed advanced section.

## 0.9.6 - Opening screen, simpler Profile, steadier connection
- **Opening screen:** the app logo, name and tagline show for about a second as the app starts (web, installed app and Android). In the Android build the generated launch pictures are replaced by the same logo on the dark background, so there is no white flash. It also goes away by itself if anything fails to start.
- **Profile is now short:** who you are, your four numbers, the optional AniList card, My library and Downloads, one Settings row, and the seven-day chart once you have read something. Accounts, preferences, backup shortcuts and the planned-feature list moved to Settings (planned features are under Settings > Coming later).
- **Steadier connection to the catalogue API:**
  - The app quietly retries a dropped, timed-out or gateway-failed request (up to two more tries with a short wait, and it respects rate limits) before showing an error.
  - The status pill tells the truth: it goes offline only when requests still fail after retries, and comes back by itself. While offline the app re-checks every 20 seconds (only while it is on screen), straight away when the phone reports it is online or the app returns to the front, and then reloads the search that failed.
  - The first screen no longer waits for the catalogue; the catalogue fills in when it answers.
  - **Worker (needs a redeploy):** one quiet retry for a dropped MangaDex connection or a 502/503/504; rate limits and "not found" pass straight through.
- Tests: 150 unit tests; new browser suite `connection_e2e.py` (11 suites in all).

## 0.9.7 - AniList profile on the Profile screen
- When you are signed in to AniList, Profile shows **your AniList profile** instead of "Local reader": banner, avatar, name, a "View on AniList" link, your anime, manga, following and followers totals, chapters and volumes read, manga mean score, and your bio (as short plain text).
- It is saved on the device, so it still shows offline, and refreshed in the background at most every 15 minutes. If follower counts cannot be loaded the strip shows chapters read instead. Images are only accepted from AniList's own https image hosts.
- Your local library numbers stay under "In this app". The sync card now says when you last synced. Signed out, Profile is unchanged.
- Tests: 154 unit tests; new browser suite `profile_e2e.py` (12 suites in all). Not yet checked against live AniList: the profile and follower queries were written to AniList's documented schema and tested against a mock.

## 0.10.0 - Ten themes and a tidier Profile banner (first public release)
- **Eight new themes** next to Sakura Night and Midnight Blue: Sakura Flowers (light), One Piece, Naruto, Gintama (the special one: Edo wave pattern, silver-to-pink buttons), Dragon Ball, Bleach, Rent-a-Girlfriend (light) and Attack on Titan. Colours and faint CSS patterns only; no artwork, logos or characters. Docs: `docs/THEMES.md`.
- **Theme picker** in Settings > Appearance: a card per theme with a colour preview and a "Special" tag on Gintama. The moon button at the top now cycles through all themes. The browser bar and form controls follow the theme, light or dark.
- **Readable everywhere:** a new test checks text, muted text, button labels and accents against each theme's backgrounds (contrast ratios) so a new theme cannot ship unreadable. Borders and status colours that were fixed for dark themes now follow the theme.
- **Profile banner fixed:** the AniList banner is shown at its natural wide shape (about 3:1) instead of being zoomed and cropped, and the avatar and name now sit under it on the left so they no longer cover the banner artwork.
- README rewritten for the public release (it still described an early preview).
- Tests: 158 unit tests; 13 browser suites (new: themes).

## 0.10.2 - Tag policy: safe-rated titles with loli/shota tags
- **Worker (needs a redeploy):** the loli/shota tag block now works by rating instead of hiding every tagged title. A tagged title is shown only when MangaDex rates it **safe** and it carries no sexual-content tag; suggestive, erotica and pornographic stay blocked in every mode, including with the 18+ toggle on. `ALWAYS_BLOCKED_IDS` in the Worker hides any title that slips through. Tagged safe titles are found by searching their name and open normally. See `docs/TAG-POLICY.md`.
- Settings > Language and content describes the rule.
- This replaces the hand-kept exception list that briefly existed in the 0.10.1 zip (`docs/EXCEPTIONS.md` is gone).
- Tests: 163 unit tests.

## 0.11.0 - Offline chapter downloads
- **Download chapters and read them with no connection.** Open a title and tap **Download**: the new **Add to Download** screen has a round checkbox per chapter, *jump to*, a sort arrow, *Select All*, an "N Selected" count and a Download button that is disabled until you pick something. The icon at the top right opens the queue.
- **Downloads tab** rebuilt: storage used against your limit, the live queue (progress, pause, resume, retry, cancel) and every saved chapter grouped by title, with delete per chapter, per title or all. Chapter rows on a title show "Downloaded" or "In download queue" and have Download / Delete download in their menu.
- **Offline reader:** a saved chapter opens from the phone with no network and no reports; if it is damaged the reader falls back to online. Saved chapters keep the quality they were saved in.
- **Settings > Downloads (new):** download quality (default Data saver), Download on Wi-Fi only (default on) and Storage limit (default 2 GB). These replace the planned entries. Two new planned entries: auto-download new chapters, delete after reading.
- **Polite by design:** one chapter at a time, three images at a time, at least 2.5 s between page-list requests (MangaDex allows 40 a minute), anonymous image requests, every fetch from a MangaDex node reported, expired addresses refreshed, failed chapters kept resumable. The Worker still never relays image bytes, so **no Worker redeploy is needed for this release**.
- **Storage:** images live in their own IndexedDB database (a storage adapter), records in `downloadJobs`. Downloads are never in backups and are never uploaded. The app asks the phone to keep its storage persistent.
- **CSP:** `connect-src` now allows `https://*.mangadex.network` (with and without a port) and `uploads.mangadex.org` so the browser version can fetch pages to save them. The reader's page text no longer claims nothing is ever stored.
- **Optional Kotlin plugin (off by default, never compiled):** `native/android/kotlin/` keeps downloads running with the screen off through a progress notification. Enable it by adding the empty file `native/android/ENABLED`; delete the file if the APK build fails. See `docs/ANDROID-NATIVE-DOWNLOADS.md`.
- Docs: `docs/DOWNLOADS.md`, `docs/ANDROID-NATIVE-DOWNLOADS.md`. Reader security fix: blob: pages are never reported to MangaDex.
- Tests: 190+ unit tests; new browser suite `downloads_e2e.py` (14 suites in all). Not verified on a real phone or live MangaDex.

## 0.11.1 - Fix: Kotlin plugin files were not imported
- The 0.11.0 zip imported without the `native/android/kotlin/` files because `.gitignore` had a bare `android/` line (meant for the generated top-level `android/` project), which also matched `native/android/`. GitHub's import therefore left them out and one unit test (`keep-alive.test.mjs`, which checks those files exist) failed in the APK build's test step, stopping the build.
- `.gitignore` now anchors `/android/` and `/www/` to the top level. A new test fails if an unanchored `android/` or `www/` line comes back.
- No app code changed. Apply this zip over 0.11.0, or instead of it.

## 0.12.0 - Discover filters and Latest, Recent, new Downloads screen
- **Discover:** ALL | LATEST tabs. On ALL, **Genre**, **Status** (Ongoing, Completed, Hiatus, Cancelled) and **Sort by** (Popular, New, Updated) open bottom sheets with chips, **Reset** and **Done**; Escape or tapping outside discards. Genres combine (all must match, up to 6). Cards say **Completed** or **Up to Ch. N**; LATEST cards also carry the date (Today, Yesterday, Oct 24). The old row of genre chips that only filtered the loaded page is gone. If the genre list cannot load you get a message and Retry.
- **Worker (needs a redeploy):** new `GET /api/v1/tags` and `GET /api/v1/latest`; `genre`, `status`, `sort` on `/manga` and `/api/v1/search`; `lastChapter` in results. Loli/shota are never listed or filterable, sexual-content tags only in the adult-gated case. Default browse order now uses MangaDex's documented `latestUploadedChapter` key. Single-file copy: `tokyo-manga-lab-api2-worker.js`.
- **Recent (new tab):** the titles you read, newest first, grouped by day, with "Read to Ch. N". Tap to open, remove one row, or clear all (progress is untouched). New `readingHistory` store (database version 3), included in backups.
- **Downloads screen** redesigned: one row per title with cover, "Status n/N" and a progress bar, "Read to Ch. X", storage used; tap to expand chapters; a manage button for delete-all.
- **Default theme is now Sakura Flowers** (first install and after reset).
- **AniList:** the first sign-in now imports your list automatically.
- Tests: 208 unit tests; new browser suites `recent_e2e.py` and `discover_e2e.py`.

## 1.0.0 - First stable version
- Version number moved to 1.0.0 (no feature changes from 0.12.0), and a release workflow (`release-apk.yml`) that attaches the APK to a GitHub release.

## 1.1.0 - New-chapter checks, notifications and auto-download
- **New chapters:** the app checks the titles you are reading (or reading + planned) for new chapters. Finds appear in an **Updates** section on Home (open, mark read, dismiss) and as a toast while the app is open. Settings > **Notifications** is now real: turn checks on, choose which titles, how often (30 min to 6 hours), **Check now**, and clear the list. The first sight of a title only sets a starting point, so old chapters are never reported.
- **Auto-download:** Settings > Downloads > Auto-download (off by default) queues the newest 1, 3, 5 or 10 new chapters per title through the normal queue (Wi-Fi-only and storage limit still apply). A switch also sits on the Downloads screen.
- **Phone alerts with the app closed:** optional Android add-on (WorkManager + notification channel), **off by default and never compiled**. Create an empty `native/android/UPDATES_ENABLED` to try it; delete it if the build fails. See `docs/UPDATES.md`.
- **Worker (needs a redeploy):** new `GET /api/v1/updates?ids=` (up to 50 titles per request, one MangaDex call). Older Workers still work, more slowly. Single-file copy: `tokyo-manga-lab-api2-worker.js`.
- Local database upgraded to version 4 (new `updateWatch` and `chapterUpdates` stores; existing data is kept).
- Fixes: browser tests no longer break on the page's security policy (`wait_for_function` calls now use the function form, which fixed the `reader_e2e` failure); `package-lock.json` version matched to the app; the planned "notifications" and "auto-download" entries are removed from Coming later.
- Tests: new unit tests for the check rules, checker, controller and add-on files; new browser suite `updates_e2e.py`. Not verified on a real phone or live MangaDex.

## 1.2.0 - MyAnimeList (optional account link)
- **Sign in with MyAnimeList** (Android app, optional) next to AniList: import your manga list (first sign-in imports only and sends nothing back), keep statuses in step both ways with the same rules as AniList (newer change wins, never deletes, sending back is opt-in), and update chapters read after you read. Needs your own free client ID (App Type "other", redirect `tokyomangalab://mal-auth`); see `docs/MYANIMELIST.md`.
- **Tracking panel** now works for both services: status, chapters, score (0-10), dates, find and link a title. With both connected it has a tab per service. Reading a chapter updates every connected service.
- **Profile**: AniList stays the default. When both are connected, **Settings > Account and sync > Profile shows** switches it to MyAnimeList. MyAnimeList's API has no banner and no follower counts, so its Profile has a plain banner, no followers, and manga totals worked out from your synced list.
- **MyAnimeList-only titles** can be linked to MangaDex for chapters, matched only by the MyAnimeList id MangaDex itself lists or by the title you pick. MangaDex titles that list a MyAnimeList id now remember it, so sync and tracking match them exactly.
- **Library** cards show an `MAL · ch. N` tag beside the AniList one. Covers from MyAnimeList's image host are allowed.
- **Worker (needs a redeploy):** new `POST /api/v1/mal/token` and `/api/v1/mal/{me,list,search,manga/{id},manga/{id}/status}`. They pass your own token to MyAnimeList for fixed requests only, store and log nothing, and never accept a redirect address from the request. Every other route is still GET only. Single-file copy: `tokyo-manga-lab-api2-worker.js`.
- **Android build:** `scripts/android-customize.sh` also registers `tokyomangalab://mal-auth`. Build a new APK once after applying this.
- No database upgrade (still version 4). Tokens are kept in `accountLinks`, never in backups.
- Tests: unit tests for sign-in, mapping, client, profile, Worker routes and linking; new browser suite `mal_e2e.py` (18 suites in all). Not verified against the real MyAnimeList or on a phone.

## 1.2.1 - Stability
- **APK updates install over the old app again.** The build now stops with a clear message when the saved signing key (`ANDROID_DEBUG_KEYSTORE_BASE64`) is missing, instead of quietly signing with a random key (the cause of "App not installed as package conflicts with an existing package"). Every build prints its signing fingerprint and warns when it is not the Tokyo Manga Lab key. Recovery steps are in `docs/SIGNING.md`.
- **MyAnimeList sign-in is built in.** The app ships with its own client ID, so nobody has to create one. A client ID typed in Settings still takes priority.
- **Quiet retries** for AniList and MyAnimeList (dropped connection, timeouts, gateway errors, short rate limits), shared in `src/shared/retry.js`. Sign-in code exchange is never repeated.
- **Queued changes** (chapter progress, status, scores) for both services are sent on start, when the app comes to the front, and every 5 minutes. A change that was told to wait (rate limit, service down) is not sent early, except that coming back online clears the wait.
- **Worker:** the last good MangaDex answer is kept for a day and served when MangaDex is down, slow or rate-limiting (never for "not found", never for page images). MyAnimeList reads are repeated once after a gateway error; saves are not.
- **Settings > Sources and connection > Test all connections** checks MangaDex, AniList and MyAnimeList and explains problems in plain words.
- Tests: retry layer, Worker fallbacks, connection check, queued-change sending, built-in client ID.

## 1.3.0 - Titles with no chapters
- **Search and Discover leave out titles that have no chapters** in your chapter language. The app asks MangaDex to do the filtering (`hasAvailableChapters` plus the language), so empty titles never fill result pages and page counts stay honest. New setting **Hide titles with no chapters** (Settings > Language and content, on by default).
- **One tap to see them anyway:** Discover shows a line under the result count ("Titles with no chapters are hidden. Show them") and the same line flips back.
- The title page says **"No chapters on MangaDex in <language>"** and points to the language picker and the MangaDex page, instead of a vague message.
- Worker: new optional search parameters `hasChapters=1` and `lang=<code>` (`/api/v1/search` and legacy `/manga`). Without them nothing changes, so older app versions keep working. The extra lookup for safe-rated tagged titles is filtered the same way.
- Missing chapters inside a title are not touched. Titles already in your library or imported from AniList / MyAnimeList are never hidden; they just show the clearer message.
- Tests: Worker filter parameters (with and without, invalid language), browser test of the hidden/shown toggle.

