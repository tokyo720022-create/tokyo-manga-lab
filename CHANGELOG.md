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

## 0.10.1 - Reviewed exceptions for wrongly blocked titles
- **Worker (needs a redeploy):** a short, hand-kept list `REVIEWED_EXCEPTIONS` in `worker/src/index.js` lets a title through that the loli/shota tag block hides although it is not sexual. A listed title is shown only when MangaDex rates it **safe** (suggestive, erotica and pornographic stay blocked, with or without the 18+ toggle), and unlisted titles stay blocked. The shipped list is empty. Listed titles are found by searching their name and open normally, chapters and reader included. See `docs/EXCEPTIONS.md`.
- The Catalogue ratings note in Settings mentions the exception.
- Tests: 166 unit tests.
