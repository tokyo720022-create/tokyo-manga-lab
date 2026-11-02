# Reader

Open a title, then tap **Read** on a chapter (the ↗ button opens it on MangaDex instead). The reader is route `#read/<chapterId>` and hides the normal app chrome.

## How it works
1. The app asks the Worker for the chapter's page list (`GET /api/v1/chapters/{id}/pages`). The Worker returns a base URL, a hash and filenames, never images.
2. The app builds `baseUrl/{data|data-saver}/hash/filename` and shows the images straight from MangaDex's network. Nothing is re-hosted. (Chapters you download are saved on your phone and open without a network; see `docs/DOWNLOADS.md`.)
3. Node addresses expire. The app asks for fresh ones after 14 minutes or when an image fails (at most 4 automatic refreshes per visit, 3 seconds apart). A failed page shows a retry button.
4. MangaDex asks every client to report image loads from its network nodes, so the app sends `{ url, success, cached, bytes, duration }` to `api.mangadex.network/report`. Nothing about you, your library or what you read is included. `bytes` comes from the browser's resource timing and is 0 when the browser hides cross-origin sizes; `cached` is always false because the app cannot see the `X-Cache` header from an `<img>` element.

## When a page will not load
1. The image is requested normally by the WebView.
2. If that fails, the Android app asks its own network layer (Capacitor native HTTP) for the same address and shows the result. This sidesteps WebView-only restrictions and gives exact size and cache information for MangaDex's reports.
3. If that also fails, the app asks the Worker for fresh addresses once (expired addresses are the usual cause) and tries again.
4. If the page still cannot load, a box under it says why and which server and port it tried (for example: refused 403, not found 404, or could not connect, which often means a network or ISP is blocking non-standard ports). **Retry** forces a fresh address.
In a plain browser (no app network layer) only steps 1, 3 and 4 apply.

## Reader options (sliders button)
| Option | What it does | Needs the app |
| --- | --- | --- |
| Reading mode | Left to right, right to left or vertical scroll | no |
| Image quality | Original or data saver | no |
| Auto read | Scrolls (vertical) or turns pages (page modes) at one of five speeds. Touching the page while it scrolls pauses it; the pill at the bottom resumes or stops it. Auto read stops at the end of the chapter. | no |
| Screen rotation | Auto, portrait or landscape. Put back to auto when you leave the reader. | yes |
| Show status bar | Turn off to read full screen. Restored when you leave the reader. | yes |
| Time and battery | Small clock and battery level on the page. The battery level only shows when the device reports it. | no |
| Volume keys | Volume down goes forward, volume up goes back, only while the reader is open | yes |
| Chapter reminder | Shows the chapter name when you open it | no |
| Skip extras | Next and previous skip chapters that have no chapter number (side stories, extras, one-shots) | no |
| Share | Shares or copies only the link to the chapter on MangaDex | no |
| Operation tips | Shown once on first use. Shown again from the sheet or Settings. | no |
| More settings | Opens Settings > Reading. The browser back button returns to the chapter. | no |

All of these (except share and tips) are also in Settings > Reading and are saved on the device.

### How the volume keys work
The web page cannot receive the phone's volume keys by itself. While the volume option is on, the reader address becomes `#read/<id>?vol=1`. A small hook in the generated `MainActivity` (added by `scripts/android-customize.sh`) checks for that marker, and only then sends a `tmlvolume` event to the page and swallows the key. If the hook could not be added, the build prints a warning and the rest of the reader still works.

## Modes and controls
- **Vertical scroll**: all pages in a column, loaded shortly before they scroll into view.
- **Right to left / left to right**: one page at a time. Tap the left or right 30% of the screen (swapped for right to left), use the arrow keys or Space, or drag the slider. Tap the middle to hide or show the bars.
- The mode button cycles modes and HD/Saver switches quality; both choices are saved as settings. Page fit is in Settings > Reading.
- Closing the reader returns to the screen you came from and reopens the title sheet.

## Progress
Stored in `chapterProgress` (`mangadex-chapter:<uuid>`): last page, total pages, `readingState` (`not-started`, `in-progress`, `completed`). A finished chapter stays finished if you reopen it and reopens at page one. Each visit longer than 5 seconds adds a `readingSessions` row (active seconds only while the app is visible).

## Known limits
- Next/previous chapter uses the chapter list you opened it from (one page of 24), so the first or last entry of that page has no neighbour until you go back and change page.
- Chapters hosted on another site cannot be shown and link out instead.
- Keep-screen-on is not built. Offline downloads exist (`docs/DOWNLOADS.md`); a downloaded chapter keeps the quality it was saved in, so the quality switch is disabled for it.
- "Chapter reminder" shows the chapter name when you open it. It is not a notification for new chapters; that needs background checks the app does not have.
- Volume keys, status bar and rotation are untested on a real phone (verified with mocks and a stub compile only).
- Needs the updated Worker deployed (see CHANGELOG 0.7.0).
- Verified with mocked network in Chromium and unit tests. Not yet tried against live MangaDex or on a device.

## Zoom (1.4.0)
- **Pinch** with two fingers to zoom between 100% (fit) and 400%. The spot under your fingers stays put.
- **Double-tap** the page to zoom to 250%, and again to go back. In the page-by-page modes only the middle of the screen zooms, because the edges turn pages.
- **Buttons:** Reader options > Zoom has − and +. While zoomed, a small pill shows the zoom with a **Reset** button. On a keyboard, + and - zoom and 0 resets.
- **Panning:** drag to move around the zoomed page, in every direction, up to every edge.
- **While zoomed in, taps do not turn the page**, so a tap on a panel never flips it by accident. Reset the zoom, or use the slider, the volume keys or the arrow keys, to move on. A new page starts at its top-left corner.
- Zoom is not remembered between chapters, and changing the reading mode resets it.
- Code: `src/features/reader/reader-zoom.js` (the maths, tested in `tests/reader-zoom.test.mjs`), wiring in `reader-view.js`, styles in `css/reader.css`.

