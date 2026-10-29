# MyAnimeList (optional account link, 1.2.0)

**Status:** covered by unit tests and the browser suite `mal_e2e.py` against a mocked Worker. It has **not** been run against the real MyAnimeList or on a phone. MyAnimeList's API behaviour below comes from its public documentation and needs a real-account check.

Like AniList, it is optional. Nothing in the app waits for it.

## What you can do
- **Sign in** from the Android app (Settings > Account and sync, or the card on Profile).
- **Import your manga list** (first sign-in imports automatically and never sends anything back).
- **Keep statuses in step** both ways with the same rules as AniList: only one side changed, that side wins; both changed, the newer one wins and is counted as a conflict; nothing is ever deleted on either side. Sending changes back is off until you allow it.
- **Update progress after reading** (the existing "Update progress after reading" and "When marked as read" settings now cover both services). Chapters only ever go up; a title you were not reading starts being read; reaching the last known chapter completes it.
- **Tracking panel** on any title: status, chapters read, score (0-10), start and finish dates. When both services are connected, the panel has a tab for each.
- **Profile**: your name, picture and totals. AniList is the default. When both are connected, **Settings > Account and sync > Profile shows** switches it to MyAnimeList.

## What MyAnimeList does not offer
- **No banner and no follower counts.** The MyAnimeList profile shows a plain banner and no followers.
- **No manga totals.** Manga counts, chapters and volumes read, and the mean score are worked out from your synced list.
- **No MangaDex links on its titles.** AniList lists MangaDex addresses, so imports can match MangaDex titles exactly; MyAnimeList does not. A MyAnimeList-only title is matched with MangaDex only when MangaDex itself lists that MyAnimeList id (it is recorded when you open the MangaDex title), or when you pick the MangaDex title yourself with **Find on MangaDex**. Names are never matched automatically.

## Setting it up
Nothing to set up. The app ships with its own client ID (app "Tokyo Manga Lab", registered on myanimelist.net/apiconfig as App Type **android** with redirect `tokyomangalab://mal-auth`), so you only tap **Sign in with MyAnimeList** (Settings or Profile). A client ID is public by design, and no client secret is used or stored (PKCE).

Want to use your own app instead? Create one at myanimelist.net/apiconfig (redirect URL exactly `tokyomangalab://mal-auth`), then paste its **Client ID** (never the Client Secret) in Settings > Account and sync > Advanced sign-in options > **Use my own client ID**. Yours wins over the built-in one; clearing the field goes back to the built-in one.

The built-in ID lives in `src/features/mal/mal-config.js` (`DEFAULT_MAL_CLIENT_ID`). If the MyAnimeList app is ever deleted or changed, update it there.

For the sign-in link to return to the app the Android project needs the `mal-auth` link registered. `scripts/android-customize.sh` adds it on every APK build, so build a new APK once after applying 1.2.0 or newer.

## How sign-in works
Authorization code with PKCE (MyAnimeList supports the `plain` method only). The app makes a random verifier and state, opens the MyAnimeList page, and accepts the returning link only if it arrives within 15 minutes of starting sign-in and carries the same state. The one-time code and verifier are exchanged for tokens through the Worker. The access token lasts about an hour and is renewed with the refresh token; MyAnimeList gives a new refresh token each time, so only one renewal runs at a time and its result is saved first. If a renewal is refused you are asked to connect again.

## Privacy and the Worker
MyAnimeList does not allow calls straight from a web view, so the app calls the Worker's `/api/v1/mal/...` routes (`docs/api-contracts.md`). They pass **your own token** on to MyAnimeList for a fixed list of requests (token exchange, your profile, your manga list, one title, a title search, saving one list entry). The Worker stores nothing and logs nothing, never forwards the token anywhere else, takes the redirect address from its own code (never from the request), and accepts only listed paths, query fields and body fields. Adult titles are hidden unless the Android app has the adult preference on, as on every other route.

Tokens live on your device in the `accountLinks` store, which is never in a backup. **Sign out** deletes them. To revoke the app completely, delete the client ID on myanimelist.net.

## Limits and honesty
- Android app only (the sign-in link needs it). In a browser the card says so.
- Not tested against the real MyAnimeList. In particular: the `nsfw` handling of the list endpoint, whether `start_date`/`finish_date` come back on every entry, and the effect of the 100-per-page paging should be checked with a real account.
- Scores are whole numbers 0-10 on MyAnimeList, so a score set to 7.5 in the tracking panel is sent as 8.
- Re-reading is shown as "Re-reading" in the panel; MyAnimeList stores it as Reading with the re-reading flag.

## Code map
`src/features/mal/`: `mal-config.js`, `mal-auth.js` (PKCE and redirect), `mal-client.js` (Worker calls, token renewal), `mal-mapper.js` (statuses and entries), `mal-store.js` (storage), `mal-profile.js`, `mal-sync.js` (sync engine and outbox), `mal-tracking.js` (Tracking panel service). The sync planner and the progress rules are shared with AniList (`features/anilist/sync-planner.js`, `features/tracking/tracking.js`).
