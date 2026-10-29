# Keeping APK updates installable

Android only installs an APK over an older one when both were signed with the **same key**. The build creates a
throwaway debug key on every run, so each new APK looked like a different app and could not be installed over the
old one. Uninstalling first deletes the app's data (library, progress, AniList sign-in).

The fix is to give every build the same key, stored as a GitHub secret.

## One-time setup (phone friendly)
1. Open `debug-signing-key.txt` (sent with the update). It is one long line of text. Copy all of it.
2. On GitHub: your repo > **Settings** > **Secrets and variables** > **Actions** > **New repository secret**.
3. Name: `ANDROID_DEBUG_KEYSTORE_BASE64`. Value: paste the text. Save.
4. Replace `.github/workflows/build-apk.yml` with the file in `docs/workflows/build-apk.yml` (GitHub's website editor:
   open the file, pencil icon, select all, paste, commit). The "Unzip and apply ZIP" workflow cannot change `.github`.
5. Run **Build Android APK**. The log ends with a *signing fingerprint*. It should read
   `5D:95:DD:98:36:04:94:58:...` and stay the same on every later build.

## What to expect
- The **first** APK signed with this key will not install over the old random-key build. Export a backup first
  (Settings > Library > Export backup; the app now opens the Android share sheet), uninstall once, install, then
  import the backup. After that, updates install in place and keep your data.
- This is a *debug* key for sideloading, not a Play Store key. Anyone who has the secret text can sign an APK that
  Android treats as an update to this app, so keep it private and do not commit it to the repository. If it leaks,
  create a new key (the same one-time setup) and accept one more reinstall.
- Since 1.2.1 a build **stops with a clear error** when the secret is missing (instead of quietly producing an APK that cannot update). To build anyway, run the workflow by hand and tick `allow_random_key`.
- Every build prints the APK's signing fingerprint in its run summary. It should be `5D:95:DD:98:36:04:94:58:F3:A7:A2:E3:F5:7A:AF:D0:22:5A:E8:45:4B:AB:D1:6D:15:F6:94:04:AE:29:2E:E2` every time. The build warns when it is not.

## "App not installed as package conflicts with an existing package"
Android is saying the new APK and the installed app were signed with **different keys**. Open the latest **Build Android APK** run on GitHub and look at the fingerprint in its summary (or the *Show the signing fingerprint* step):
- **It starts with `5D:95:DD`:** the new APK is right, and the app already on your phone was built with another key (for example an earlier build made before the secret existed). Do the one-time reinstall below. After it, updates install in place.
- **It does not, or the build said the secret is missing:** the new APK has the wrong key. Add or fix the `ANDROID_DEBUG_KEYSTORE_BASE64` secret (steps above) and run the build again. No reinstall is needed if the phone's app already has the right key.

### One-time reinstall without losing your library
1. In the old app: Settings > Library > **Export backup** and keep the file.
2. Uninstall Tokyo Manga Lab, install the new APK, open **Import backup** and choose the file.
3. Sign in to AniList / MyAnimeList again (sign-in tokens are never part of a backup). Downloaded chapters are not in backups either and have to be downloaded again.
