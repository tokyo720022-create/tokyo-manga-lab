# Linking AniList (and MyAnimeList) titles to MangaDex chapters

> Since 1.2.0 the same flow serves MyAnimeList-only titles (`sourceId: "mal"`): the automatic match uses the `malId` MangaDex lists instead of `anilistId`, the stored link row records `linkedMalId` and kind `mal-id`, and everything else is identical. See `docs/MYANIMELIST.md`.

AniList has no chapters. A title that exists only on AniList (`sourceId: "anilist"`) therefore needs a MangaDex record
before the chapter list and the reader can work. Since v0.9.0 the title sheet does this in two steps.

## 1. Exact AniList ID (automatic)
When you open an AniList-only title and no link exists yet, the app searches MangaDex with the AniList titles
(main title, then up to two alternates: at most three searches). MangaDex stores an AniList ID in `links.al`; the Worker
returns it as `anilistId`. If **exactly one** result carries this title's AniList ID, it is linked automatically
(`linkKind: "anilist-id"`).

MangaDex's API cannot filter by AniList ID, so the ID is checked on search results. A title MangaDex has not tagged
with an AniList ID can therefore not be matched this way.

## 2. Pick a candidate (never automatic)
Otherwise a picker lists up to 12 MangaDex candidates with cover, year, status and author, plus a search box.
Nothing is linked by similar names. Each candidate shows how MangaDex relates it to AniList:

| Badge | Meaning |
|---|---|
| AniList ID matches | MangaDex lists this title's AniList ID (shown first) |
| No AniList ID on MangaDex | Only you can decide; use *Preview on MangaDex* |
| MangaDex lists AniList #N | Probably another work; button reads *Link anyway* and asks to confirm |

Two exact matches are also shown in the picker rather than choosing one. Candidates rated erotica/pornographic are
filtered by the existing adult gate; loli/shota are never returned by the Worker.

## What is stored
One row per AniList item in `sourceEntries`, id `chapter-source:<contentItemId>`, with `linkRole: "chapter-source"`,
the MangaDex UUID, `linkKind` (`anilist-id` or `user-selected`), `linkedAnilistId`, and a small snapshot
(description, cover, authors, tags) used only to fill blanks. There is **no IndexedDB schema change**.

- The row never uses the `mangadex:<uuid>` key, so a MangaDex title saved on its own is not re-pointed or merged.
  If both exist you may see two library entries; nothing is merged for you.
- AniList sync ignores these rows when building identity mappings.
- Library status, progress and AniList sync still belong to the AniList item.

## Metadata
AniList's description, cover, authors and tags are kept. MangaDex data fills only fields AniList left empty, and the
sheet says which ones. **Chapter availability always comes from the linked MangaDex record.**

## Change or remove
The banner on a linked title has *Change* (reopens the picker, with *Keep current link*) and *Unlink* (asks first;
library entry and progress are untouched). After Unlink the picker opens instead of auto-matching again.

## Not covered
- No fuzzy or title-similarity auto-linking, by design.
- Links are not synced anywhere and live only in this device's IndexedDB (they are in the normal backup, as `sourceEntries`).
- The picker needs the Worker's search route and "Online search" enabled in Settings.
