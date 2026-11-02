# Privacy screen (1.4.0)

An optional PIN lock plus a blank preview in Android's recent-apps list. Settings > Privacy and data > **Privacy screen**.

## What it does
- **PIN lock.** Choose a 4 to 8 digit PIN. The app asks for it when it is opened fresh, and when you come back after being away for the time you chose (immediately, 30 seconds, 1, 5 or 15 minutes, default 1 minute).
- **Blank cover.** While the lock is on, the app is covered with a plain screen the moment you leave it, so nothing shows in a quick glance at the phone.
- **Hide the app in recent apps** (Android app only). Android shows a blank preview in the recent-apps list. This also stops screenshots and screen recordings of the app, which is how Android implements it (`FLAG_SECURE`). Turn it off to take screenshots again.
- **Wrong tries.** Four wrong PINs in a row are free. After that the app makes you wait 30 seconds, then 60, 120 and so on, never more than 15 minutes. A right PIN clears the count.
- **Change or turn off.** Both ask for the current PIN first.

## What it does not do
- It is a screen lock, **not encryption.** Your library and settings on the phone are stored as before. Someone with technical access to the phone's storage is not stopped by it.
- **No recovery.** There is no "forgot PIN". The only way back in is clearing the app's data in Android settings, which also deletes the library. Export a backup (Settings > Library) before you turn the lock on.
- No fingerprint or face unlock yet. That needs an Android add-on and is a possible later step.

## How the PIN is kept
The PIN is never stored. The app stores a random salt and a slow hash (PBKDF2 with SHA-256, 150,000 rounds) in the `accountLinks` store, which is never part of a backup, so the record does not leave the phone. The wait after wrong tries is stored with it. A backup you import on another phone brings no PIN.

## Android side
`scripts/android-customize.sh` adds a small bridge called `TmlPrivacy` to `MainActivity` on every APK build. The web app calls `TmlPrivacy.setSecure(true/false)`; the bridge sets or clears the window's secure flag. In a browser nothing calls it. The edit is plain Java and idempotent. It was compiled only against stand-in classes here, never in a real Android build, so check that the APK still builds and the setting works (`docs/PHONE-TEST-CHECKLIST.md`).

## Files
`src/features/privacy/` (`privacy-lock.js` the maths, `privacy-store.js`, `privacy-controller.js` the screens), `css/privacy.css`, tests `tests/privacy-lock.test.mjs` and `tests/e2e/privacy_e2e.py`.
