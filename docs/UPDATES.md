# New-chapter checks, notifications and auto-download (1.1.0)

**Status:** the in-app part is covered by unit tests and the browser suite `updates_e2e.py` against a mocked Worker. It has **not** been run against live MangaDex or on a real phone. The optional Android background add-on has never been compiled.

## What it does
- Looks for new chapters of the titles in your library marked **Reading** (or **Reading + planned**, your choice in Settings > Notifications).
- Finds are listed in an **Updates** section on Home: one row per title with its new chapters, tap to open, mark read, or dismiss.
- A toast tells you when something new arrives while the app is open.
- **Auto-download** (Settings > Downloads, off by default) queues the newest 1, 3, 5 or 10 new chapters per title through the normal download queue. It obeys the Wi-Fi-only and storage-limit settings.

## How a check works
1. The first time a title is seen it only gets a **starting point** (its newest chapter and the time). Nothing old is reported.
2. Every check asks the Worker `GET /api/v1/updates?ids=<up to 50 title ids>` for each title's newest chapter id. A title whose id changed is asked for its recent chapters (up to 20); chapters not seen before and published after the starting point (10-minute grace) are new.
3. One run covers at most 100 titles. If the Worker has no `/api/v1/updates` route (an old deployment) the app falls back to a per-title lookup, 12 titles per run.
4. Rate limits stop the run and it tries again later. A failed run keeps the time of the last good one, and the status line in Settings says so. Checks are never closer than 60 seconds apart.
5. While the app is open it looks at the clock every 5 minutes, on startup (after 6 seconds) and when you return to the app; a check runs only when the chosen interval (30 min, 1, 3, 6 hours) has passed. **Check now** in Settings forces one.

Adult titles are included only where the adult preference already allows them (Android app with the toggle on).

## Phone alerts with the app closed (optional Android add-on)
A web app cannot wake itself when closed, so background alerts need a small native part: a WorkManager job that runs the same check and posts a notification (channel `tml-updates`). Tapping it opens the app, which merges what the phone found into the Updates list.

It is **off by default** because it has never been compiled. To try it:
1. In the GitHub repository create an empty file named `native/android/UPDATES_ENABLED`.
2. Run **Build Android APK**.

`scripts/android-customize.sh` then runs `scripts/android-native-updates.sh`, which adds the WorkManager dependency, the Kotlin Gradle plugin if the downloads add-on has not already, the `POST_NOTIFICATIONS` permission, registers the `TmlUpdates` plugin and copies the Kotlin files from `native/android/updates/`.

**If the build fails, delete `native/android/UPDATES_ENABLED` and build again.** The app is the same without it, except that alerts only arrive while the app is open. Please send the Gradle error text.

Things to know: Android 13+ asks for notification permission (Settings > Notifications > Enable phone alerts); Android may delay background work to save battery, so "every hour" is a target, not a promise.

## Privacy
Checks send only MangaDex title ids to your own Worker. Nothing is uploaded elsewhere and no account is involved. The Updates list and starting points live in the phone's IndexedDB (stores `updateWatch`, `chapterUpdates`, database version 4).

## Code map
`src/features/updates/`: `update-plan.js` (pure rules), `update-checker.js` (a run), `update-controller.js` (schedule, inbox, auto-download, native bridge), `update-view.js` (Home section). Storage: `src/data/repositories/update-repository.js`. Native: `native/android/updates/`.

## Check that the Android add-on compiles
The optional background checker has never been compiled. Run the **Check Android add-ons** workflow first (see `docs/ANDROID-NATIVE-DOWNLOADS.md`); it switches both add-ons on for a throw-away build and reports whether they compile. Only then add `native/android/UPDATES_ENABLED`.
