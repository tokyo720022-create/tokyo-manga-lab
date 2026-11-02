# API contracts — Tokyo Manga Lab

## Current compatibility routes

### `GET /health`
Returns `{ ok, service, contentRatings, apiVersion }`.

### `GET /manga?q={query}&page={page}[&genre=…&status=…&sort=…]`
Legacy MangaDex search response retained for existing frontend compatibility (the app still uses it for search). `page` is clamped to 1–20 and each page contains up to 24 results. Only `safe` and `suggestive` ratings are requested. Accepts the same `genre`, `status` and `sort` filters as `/api/v1/search` below and returns `lastChapter`.

## Versioned metadata API

All v1 success responses include `meta.apiVersion = "1"` and a `requestId`. Errors use `{ error: { code, message }, meta }`.

### `GET /api/v1/sources`
Returns source IDs and capability flags. For the current connector, `search`, `titleDetails`, `chapters` and `chapterContent` are supported; the Worker's `offlineDownloads` flag is false because the Worker never downloads or stores anything; the app saves chapters itself (`docs/DOWNLOADS.md`). `chapterContent` means the Worker can return the *addresses* of chapter pages; it never relays image bytes.

### Skipping titles with no chapters (1.3.0)
`/manga` and `/api/v1/search` accept `hasChapters=1` and an optional `lang=<two or three letter code>`. With `hasChapters=1` the Worker asks MangaDex for `hasAvailableChapters=true` (and `availableTranslatedLanguage[]=<lang>` when a valid code is given), so titles with nothing to read are left out and `total` counts only the rest. The extra lookup for safe-rated tagged titles uses the same filter. Leaving the parameters out changes nothing. An invalid `lang` is ignored.

### `GET /api/v1/search?query={query}&type=manga&page={page}`
Returns `{ data: ContentItem[], pagination, meta }`. The normalized ContentItem includes `sourceId`, `externalId`, `contentType`, `title`, `alternateTitles`, `description`, `coverUrl`, `authors`, `artists`, `genres`, `tags`, `publicationStatus`, `releaseYear`, `language`, `sourceUrl`, and `contentRating`.

Optional filters (0.12.0): `genre` (comma-separated tag ids, at most 6, all must match), `status` (`ongoing|completed|hiatus|cancelled`) and `sort` (`popular` = most followed, `new` = newest title, `updated` = newest chapter). Unknown values are ignored; the loli and shota tag ids are dropped from `genre`. With no query and no sort the order is newest chapter first. While a filter is on, the extra safe-rated tagged-title lookup is skipped.

### `GET /api/v1/tags`
Returns `{ data: [{ id, name, group }], meta }` for the Genre sheet, from MangaDex's tag list (kept in the Worker for six hours). loli and shota are never listed; tags about sexual content are listed only in the adult-gated case (app, no Origin header, `adult=1`).

### `GET /api/v1/latest?page={page}`
Newest English chapters, one entry per title: `{ data: ContentItem[] (each with latestChapter: { number, publishedAt }), pagination, meta }`. One page reads the newest 100 chapters (so a page can hold up to 100 titles); pages are clamped to 1–20. Titles go through the same content policy as search.

### `GET /api/v1/updates?ids={uuid,uuid,…}`
New in 1.1.0. Up to 50 MangaDex title ids (400 `INVALID_MANGA_ID` if none valid, `TOO_MANY_IDS` if more than 50). Returns `data: [{ externalId, latestChapterId, updatedAt }]` from one MangaDex call (`latestUploadedChapter`); titles hidden by the rating policy are left out, adult titles only in the same case as the other routes. Cached for 60 seconds. The app compares `latestChapterId` with its stored starting point and only then asks `/api/v1/manga/{id}/chapters` for what is new.

### MyAnimeList routes (1.2.0, optional account link)
Pass the person's own token as `Authorization: Bearer <token>`; the Worker forwards it to MyAnimeList only, stores nothing and caches nothing (`Cache-Control: no-store`). Only these requests exist, and CORS now also allows `POST`, `PATCH` and the `Authorization` header for them. Every other route is still GET only.
- `POST /api/v1/mal/token` — JSON `{ grant_type: "authorization_code", client_id, code, code_verifier }` or `{ grant_type: "refresh_token", client_id, refresh_token }`. The redirect address is fixed to `tokyomangalab://mal-auth` by the Worker. Returns `data: { access_token, refresh_token, expires_in, token_type }`. A refused sign-in is `MAL_AUTH_FAILED`.
- `GET /api/v1/mal/me` — the account and its anime totals.
- `GET /api/v1/mal/list?offset=` — 100 manga entries per page (`hasNext`, `nextOffset`, `hidden`). Adult entries are removed unless the Android app has the adult preference on.
- `GET /api/v1/mal/search?q=` — up to 10 titles (3 or more letters).
- `GET /api/v1/mal/manga/{id}` — one title with the person's own entry.
- `PATCH /api/v1/mal/manga/{id}/status` — JSON with any of `status` (`reading|completed|on_hold|dropped|plan_to_read`), `score` (0-10), `num_chapters_read`, `num_volumes_read`, `is_rereading`, `start_date`, `finish_date`. Anything else is dropped; invalid values are `INVALID_REQUEST`.
Errors: `UNAUTHORIZED` (401, token missing or expired), `RATE_LIMITED`, `NOT_FOUND`, `TITLE_UNAVAILABLE`, `INVALID_REQUEST`, `UPSTREAM_UNAVAILABLE`.

### `GET /api/v1/manga/{mangaDexUuid}`
Returns `{ data: ContentItem, meta }`. Only MangaDex UUIDs and supported content ratings are accepted.

### `GET /api/v1/manga/{mangaDexUuid}/chapters?page=1&language=en`
Returns `{ data: ChapterMetadata[], pagination, meta }`. Chapter metadata includes a provider-scoped `externalId`, chapter/volume number, title, language, page count, publication timestamp, scanlation group names, and canonical source URL. Use `language=all` for all available translation languages. This endpoint does not return page addresses; use the pages endpoint below.

### `GET /api/v1/chapters/{chapterUuid}/pages`
Returns `{ data: { chapterId, mangaExternalId, baseUrl, hash, data[], dataSaver[], validForSeconds }, meta }`. The reader builds each image address as `baseUrl/{data|data-saver}/hash/filename` and loads it straight from the MangaDex network node. Notes:
- Fixed upstream paths only (`/chapter/{id}` and `/at-home/server/{id}`), a validated UUID, and filenames/hash/base URL are validated. This is not a general proxy, and no image bytes pass through the Worker.
- Responses are `Cache-Control: no-store` because node addresses expire (MangaDex guarantees 15 minutes). The app refreshes after 14 minutes or on a failed image.
- The parent title's rating is checked first and the endpoint fails closed if it cannot be read.
- Chapters hosted on another site return `422 CHAPTER_EXTERNAL`.

## Adult ratings (Android app only)
By default every endpoint serves `safe` and `suggestive` titles only. Adding `adult=1` also allows `erotica` and `pornographic`, but **only when the request has no `Origin` header**, which is the case for the Android app's native HTTP layer and never for a browser. Browser requests (including the public GitHub Pages demo) always get the neutral catalogue. This is a product policy that keeps the demo neutral. It is not authentication or age verification.
Titles tagged `loli` or `shota` are excluded in every mode (request filter by tag id plus a response check by tag name).

## Stable identity

A catalogue entry is keyed in the app by an internal `contentItemId`, while provider identifiers remain in `sourceEntries` (`sourceId` + `externalId`). Matching across different providers should be conservative. Do not merge solely because chapter numbers or similar titles match.

## Error codes

- `UNSUPPORTED_CONTENT_TYPE` — not yet supported by the source registry.
- `INVALID_MANGA_ID` — ID is not a valid MangaDex UUID.
- `TOO_MANY_IDS` — more than 50 ids in `ids=`.
- `INVALID_CHAPTER_ID` — chapter ID is not a valid UUID.
- `CHAPTER_UNAVAILABLE` — chapter missing, or its title is filtered by the rating policy.
- `CHAPTER_EXTERNAL` — chapter is hosted off MangaDex; open the source link.
- `INVALID_LANGUAGE` — invalid language filter.
- `TITLE_UNAVAILABLE` — missing or filtered by the connector's content-rating policy.
- `RATE_LIMITED` — upstream rate limit.
- `UPSTREAM_UNAVAILABLE` — upstream timeout or failure.
- `NOT_FOUND` — unknown API route.
