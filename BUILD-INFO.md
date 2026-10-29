# Tokyo Manga Lab - build info

Version: 1.2.1
Milestone: Stability (signing safeguards, retries, MyAnimeList built-in sign-in)

See `CHANGELOG.md` for what changed in each version and `docs/` for the design notes.

## Checks
- `npm run check` parses every file and confirms the offline cache lists every module.
- `npm test` runs the unit tests.
- `python3 tests/e2e/run.py` runs the browser tests (needs Python Playwright with Chromium).

## Not included
- MyAnimeList sign-in, sync and tracking were tested against mocked responses only, never the real service. The Worker needs the 1.2.1 redeploy (`/api/v1/mal/...`, last-good MangaDex answers), and the Android build needs a fresh APK build for the sign-in link (`docs/MYANIMELIST.md`). The built-in client ID was copied from a screenshot, so the first real sign-in is the real test.
- New-chapter checks need the updated Worker deployed (`tokyo-manga-lab-api2`, route `/api/v1/updates`; the app falls back to slower per-title lookups without it). Tested against mocked responses only, not live MangaDex.
- Alerts with the app closed need the optional Android add-on (`docs/UPDATES.md`), which has never been compiled. Downloads have not been run on a real phone either, and their Kotlin plugin has not been compiled (`docs/ANDROID-NATIVE-DOWNLOADS.md`).
- No Worker deployment, GitHub commit or push is done by building this package.
