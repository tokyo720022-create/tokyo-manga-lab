# Phone test checklist

Everything below was tested in a desktop browser against mocked services. None of it has been run on a real phone against the live services. Go through this list once on your phone after each big update and write down anything that does not behave as described, with what you tapped and what you saw (a screenshot helps). Each line takes under a minute.

## 1. Install and update
- [ ] The new APK installs over the old app (no "package conflicts" message). If it does not, read `docs/SIGNING.md`.
- [ ] Open the app: your library, collections and settings are all still there.
- [ ] Settings > About shows the version you expect.

## 2. Connections
- [ ] Settings > Sources and connection > **Test all connections**: MangaDex says working. Connected accounts say working with your name.
- [ ] Turn on airplane mode and tap it again: MangaDex says the internet is the problem, in plain words. Turn airplane mode off.

## 3. Discover and chapters
- [ ] Search a popular title. Results load and open.
- [ ] Under the result count, "Titles with no chapters are hidden" is shown. Tap "Show them", then "Hide them".
- [ ] Open a title and read a chapter. Pages load, progress is remembered when you leave and come back.
- [ ] Open a title with no chapters (use "Show them"): the page says "No chapters on MangaDex in English" and the language picker works.

## 4. AniList and MyAnimeList
- [ ] Sign in with AniList. The app comes back by itself. Your name and list appear.
- [ ] Sign in with MyAnimeList (nothing to set up). The app comes back by itself.
- [ ] Read a chapter of a tracked title: the progress changes on the site (check in a browser).
- [ ] With airplane mode on, read another chapter. The tracking panel says the change is saved on the phone. Turn airplane mode off: it is sent within a minute.
- [ ] If both are connected, Settings can switch which profile and banner show.

## 5. New chapters
- [ ] Settings > Notifications: turn checks on, tap **Check now**. The result line says how many titles were checked.
- [ ] (Only if you enabled the add-on) Android asks once for permission to show notifications. Allow it.

## 6. Downloads
- [ ] Download one short chapter on Wi-Fi. It appears under Downloads and opens with the phone offline.
- [ ] Start a download of several chapters, lock the screen for two minutes, unlock: the download kept going (needs the add-on for a notification).
- [ ] Delete a downloaded chapter. The space is freed.

## 7. Backup
- [ ] Settings > Library > **Export backup** saves a file. Import it back: nothing doubles.

## What to send me if something fails
The step number, what you expected, what happened, and the app version. For build problems, the run summary on GitHub.
