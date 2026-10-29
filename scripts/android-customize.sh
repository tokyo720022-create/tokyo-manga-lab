#!/usr/bin/env bash
# Runs AFTER `npx cap add android`. Applies version numbers and the app icon
# to the generated (never committed) android/ project.
set -euo pipefail

VERSION_NAME="${1:?usage: android-customize.sh <versionName> <versionCode>}"
VERSION_CODE="${2:?usage: android-customize.sh <versionName> <versionCode>}"
GRADLE=android/app/build.gradle
RES=android/app/src/main/res

[ -f "$GRADLE" ] || { echo "ERROR: $GRADLE not found - did 'cap add android' run?"; exit 1; }

sed -i -E "s/versionCode [0-9]+/versionCode ${VERSION_CODE}/; s/versionName \"[^\"]*\"/versionName \"${VERSION_NAME}\"/" "$GRADLE"
grep -E "versionCode|versionName" "$GRADLE"

# --- Icons (ImageMagick `convert` is preinstalled on GitHub's ubuntu runners) ---
ICON=resources/icon.png
if [ -f "$ICON" ] && command -v convert >/dev/null 2>&1; then
  declare -A LEGACY=( [mdpi]=48 [hdpi]=72 [xhdpi]=96 [xxhdpi]=144 [xxxhdpi]=192 )
  declare -A FOREGROUND=( [mdpi]=108 [hdpi]=162 [xhdpi]=216 [xxhdpi]=324 [xxxhdpi]=432 )
  for d in "${!LEGACY[@]}"; do
    dir="$RES/mipmap-$d"; mkdir -p "$dir"
    s=${LEGACY[$d]}; f=${FOREGROUND[$d]}; inner=$(( f * 66 / 100 ))
    convert "$ICON" -resize "${s}x${s}" "$dir/ic_launcher.png"
    convert "$ICON" -resize "${s}x${s}" \( +clone -alpha extract -fill black -colorize 100 -fill white -draw "circle $((s/2)),$((s/2)) $((s/2)),0" \) -alpha off -compose CopyOpacity -composite "$dir/ic_launcher_round.png"
    convert "$ICON" -resize "${inner}x${inner}" -background none -gravity center -extent "${f}x${f}" "$dir/ic_launcher_foreground.png"
  done
  mkdir -p "$RES/values"
  cat > "$RES/values/ic_launcher_background.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#09080F</color>
</resources>
XML
  echo "Icons generated from $ICON"
else
  echo "WARN: icon or ImageMagick missing - keeping default Capacitor icon"
fi

# --- Launch screen: replace Capacitor's default splash pictures with the app logo on the app's dark background ---
# The generated project shows drawable*/splash.png while the app starts. Same look as the opening screen in the app.
if [ -f "$ICON" ] && command -v convert >/dev/null 2>&1; then
  SPLASH_COUNT=0
  while IFS= read -r splash; do
    dims=$(identify -format "%wx%h" "$splash" 2>/dev/null || echo "")
    [ -n "$dims" ] || continue
    w=${dims%x*}; h=${dims#*x}
    short=$(( w < h ? w : h )); logo=$(( short * 38 / 100 ))
    if convert -size "${w}x${h}" "radial-gradient:#2a1646-#09080f" \( "$ICON" -resize "${logo}x${logo}" \) -gravity center -composite "$splash"; then SPLASH_COUNT=$((SPLASH_COUNT + 1)); fi
  done < <(find "$RES" -type f -name "splash.png" 2>/dev/null)
  echo "Launch screen: replaced $SPLASH_COUNT splash picture(s)"
else
  echo "WARN: icon or ImageMagick missing - keeping the default launch screen"
fi

# --- AniList sign-in: let Android hand tokyomangalab://anilist-auth links back to the app ---
MANIFEST=android/app/src/main/AndroidManifest.xml
[ -f "$MANIFEST" ] || { echo "ERROR: $MANIFEST not found"; exit 1; }
python3 - "$MANIFEST" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
if 'android:scheme="tokyomangalab"' in text:
    print("Intent filter already present")
    sys.exit(0)
anchor = text.find('android:name=".MainActivity"')
if anchor < 0:
    sys.exit("ERROR: MainActivity not found in AndroidManifest.xml")
close = text.find("</activity>", anchor)
if close < 0:
    sys.exit("ERROR: MainActivity closing tag not found")
flt = '''
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="tokyomangalab" android:host="anilist-auth" />
            </intent-filter>
        '''
text = text[:close] + flt + text[close:]
open(path, "w", encoding="utf-8").write(text)
print("Added tokyomangalab://anilist-auth intent filter")
PY
grep -q 'android:scheme="tokyomangalab"' "$MANIFEST" || { echo "ERROR: AniList intent filter missing after edit"; exit 1; }

# --- MyAnimeList sign-in: the same for tokyomangalab://mal-auth (a separate check, so older projects get it too) ---
python3 - "$MANIFEST" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
if 'android:host="mal-auth"' in text:
    print("MyAnimeList intent filter already present")
    sys.exit(0)
anchor = text.find('android:name=".MainActivity"')
close = text.find("</activity>", anchor) if anchor >= 0 else -1
if close < 0:
    sys.exit("ERROR: MainActivity not found in AndroidManifest.xml")
flt = '''
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="tokyomangalab" android:host="mal-auth" />
            </intent-filter>
        '''
text = text[:close] + flt + text[close:]
open(path, "w", encoding="utf-8").write(text)
print("Added tokyomangalab://mal-auth intent filter")
PY
grep -q 'android:host="mal-auth"' "$MANIFEST" || { echo "ERROR: MyAnimeList intent filter missing after edit"; exit 1; }

# --- Reader: volume keys turn pages ------------------------------------------------------------
# The web app puts "vol=1" in the reader address (#read/<id>?vol=1) while the reader option is on. Only then does
# the app intercept the volume keys and pass them to the page; everywhere else volume works normally.
MAIN=$(find android/app/src/main/java -name MainActivity.java | head -n 1)
if [ -n "$MAIN" ]; then
python3 - "$MAIN" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
if "tmlvolume" in text:
    print("Volume-key hook already present")
    sys.exit(0)
pattern = re.compile(r"public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}")
if not pattern.search(text):
    print("WARN: MainActivity has an unexpected shape; volume-key paging will not be available in this build")
    sys.exit(0)
body = """public class MainActivity extends BridgeActivity {
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if ((code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN) && getBridge() != null) {
            WebView webView = getBridge().getWebView();
            String url = webView != null ? webView.getUrl() : null;
            if (url != null && url.contains("#read/") && url.contains("vol=1")) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                    String direction = code == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('tmlvolume',{detail:'" + direction + "'}))", null);
                }
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }
}"""
text = pattern.sub(lambda m: body, text, count=1)
text = text.replace("import com.getcapacitor.BridgeActivity;", "import android.view.KeyEvent;\nimport android.webkit.WebView;\nimport com.getcapacitor.BridgeActivity;", 1)
open(path, "w", encoding="utf-8").write(text)
print("Added volume-key hook to MainActivity")
PY
  grep -q "tmlvolume" "$MAIN" && echo "Volume-key hook present" || echo "WARN: volume-key hook missing after edit"
else
  echo "WARN: MainActivity.java not found; volume-key paging will not be available in this build"
fi

# --- Optional: Kotlin download-notification plugin (keeps downloads running with the screen off) ---------------
# Off unless the file native/android/ENABLED exists. See docs/ANDROID-NATIVE-DOWNLOADS.md.
if [ -f native/android/ENABLED ]; then
  echo "Native downloads plugin: enabled by native/android/ENABLED"
  bash scripts/android-native-downloads.sh
else
  echo "Native downloads plugin: not enabled (optional)"
fi

# --- Optional: Kotlin new-chapter checker (alerts while the app is closed) ------------------------------------------
# Off unless the file native/android/UPDATES_ENABLED exists. Runs after the downloads plugin. See docs/UPDATES.md.
if [ -f native/android/UPDATES_ENABLED ]; then
  echo "Native updates checker: enabled by native/android/UPDATES_ENABLED"
  bash scripts/android-native-updates.sh
else
  echo "Native updates checker: not enabled (optional)"
fi
