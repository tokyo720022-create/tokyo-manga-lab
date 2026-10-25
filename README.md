# Tokyo Manga Lab

A mobile-first manga library and reader. It runs as a web app (GitHub Pages / installable PWA) and as an Android app (built by GitHub Actions). Your library, progress and settings live on your own device.

Version: see `BUILD-INFO.md` and `CHANGELOG.md`.

## What it does

- **Discover and read.** Search MangaDex, open a title, read chapters in vertical-scroll, right-to-left or left-to-right modes with progress remembered per chapter.
- **Library.** Save titles, set a reading status, favourites and collections. JSON backup and restore (library, collections and settings; never your AniList sign-in).
- **Chapter list.** Sort, filter (unread, bookmarked, scanlator), display options, mark read, bookmark.
- **AniList (optional).** Log in, import your manga list, track status, chapters, score and dates, and send progress when you finish a chapter (queued while offline). Your AniList banner, avatar and totals show on Profile. The app works fully without it. See `docs/ANILIST.md`.
- **Themes.** Ten colour themes: Sakura Night, Midnight Blue, Sakura Flowers, One Piece, Naruto, Gintama, Dragon Ball, Bleach, Rent-a-Girlfriend and Attack on Titan. They use each series' mood and colours only, with no artwork, logos or characters. See `docs/THEMES.md`.
- **Steady connection.** Short network drops are retried quietly, the status dot recovers by itself, and covers are cached on the device.
- **Settings** are grouped and searchable.

## Run it locally

ES modules and service workers need HTTP, not `file://`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Checks

```bash
npm run check   # parses every file; the offline cache must list every module
npm test        # unit tests
python3 tests/e2e/run.py   # browser tests (Python Playwright with Chromium)
```

## Deploying

- **Web:** GitHub Pages serves the repository root. See `DEPLOY-ON-ANDROID.md`.
- **Worker (catalogue API):** `worker/src/index.js`, deployed as `tokyo-manga-lab-api2`. Check the Worker name in `worker/wrangler.toml` before running Wrangler. The Worker only talks to MangaDex, never mirrors chapter pages, and rate-limits each address.
- **Android app:** `BUILD-APK.md` and `docs/SIGNING.md`.

## Current limits

- Chapters are read from MangaDex through the in-app reader. Nothing is downloaded, so there is no offline reading yet.
- MangaDex is the only manga source. AniList is for tracking and metadata only. Other sources must pass `docs/SOURCE-REVIEW.md` first.
- No Tokyo Manga Lab accounts or cloud sync. Backups are files you save yourself.
- Adult titles are an off-by-default preference, available only in the Android app. It is not age verification (`docs/ADULT-SOURCES.md`).
- Planned features are listed under Settings > Coming later. They are not built.

## Credits and notices

Catalogue data and covers come from [MangaDex](https://mangadex.org). Tracking uses [AniList](https://anilist.co). Tokyo Manga Lab is an independent project and is not affiliated with MangaDex, AniList or any series named in the themes. Series names appear only to label colour schemes.
