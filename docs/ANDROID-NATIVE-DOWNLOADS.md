# Optional: Kotlin plugin for downloads with the screen off

**Status: written, not compiled.** There is no Android SDK where this app is authored, so this plugin has never been built or run. That is why it is **off by default**. Downloads work without it.

## What it does
A small Capacitor plugin in Kotlin (`native/android/kotlin/`). It runs a foreground service with a quiet progress notification ("Downloading chapters, Ch. 12 · Title") so Android does not freeze the app's WebView while the screen is off. The downloading itself stays in the web code; the plugin only keeps the app alive and shows progress. The web app talks to it through `Capacitor.Plugins.TmlDownloads` (`start`, `update`, `stop`) and does nothing if it is absent.

## Turn it on
1. In the GitHub repository, create an empty file named `native/android/ENABLED` (Add file > Create new file).
2. Run **Build Android APK**.

`scripts/android-customize.sh` sees the file and runs `scripts/android-native-downloads.sh`, which:
- adds the Kotlin Gradle plugin (1.9.25) and `kotlin-android` to the generated Android project, matching the app's Java level;
- adds the permissions `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` and the service entry to the manifest;
- registers the plugin in `MainActivity`;
- copies the two Kotlin files in with the app's package name.

## If the build fails
Delete `native/android/ENABLED` and build again. The app is identical without it, except downloads may pause with the screen off. Please send the Gradle error text so the script can be fixed.

## Things to know
- On Android 13 and newer the notification is hidden until notifications are allowed for the app in system settings. The service runs either way.
- Android may refuse to start a foreground service while the app is in the background; the app then just downloads while it is on screen.
- Android 15 limits "data sync" foreground services to about six hours a day.

## Check that it compiles (no phone needed)
Run the **Check Android add-ons** workflow (Actions tab > Check Android add-ons > Run workflow). It builds a throw-away debug app with both add-ons switched on and reports **Passed** or **Failed** in its summary. It changes nothing in your repository and does not affect your normal APK. Only after it passes, add the empty file `native/android/ENABLED` to turn the add-on on in real builds. Paste the workflow from `docs/workflows/check-android-addons.yml` into `.github/workflows/` once.
