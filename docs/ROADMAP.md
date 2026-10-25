# Implementation roadmap

The phases are ordered by dependencies. Do not attempt all future features in the first release.

## Phase 0 — Baseline audit
- Read repository and plan.
- Run syntax checks and tests.
- Capture backup before migration or replacement.
- Verify API hostname, Worker script name, Pages origin and source behavior.
- Confirm no private tokens are committed.

**Exit criteria:** clear list of verified working features and known issues.

## Phase 1 — Manga V1 foundation
- UI shell and ten colour themes (Settings > Appearance).
- Search/pagination using MangaDex through Worker.
- Normalized title cards and metadata details.
- Chapter metadata list linking to original source.
- IndexedDB library, statuses, favourites, collections, filters and JSON backup/restore.
- Settings, safe content default, API health status.
- Responsive/error/loading/empty states.

**Exit criteria:** local device checks, tests green, backup migration verified, no unintended remote changes.

## Phase 2 — Reliability and in-app reader
- Verify the Worker is deployed to the exact intended hostname before wiring new routes.
- Add regression tests for API errors, pagination and unsupported titles.
- Implement a manga reader only after source rules and content access have been reviewed.
- Add bookmarks, stable progress resume and reader preferences.
- Add download manager only for content that may be stored offline.

**Exit criteria:** real-device reader smoke tests, no data loss on reload/upgrade, storage usage visible.

## Phase 3 — Novel Reading Beta (after website launch)
- Local TXT and EPUB imports first.
- Reflowable text reader with stable position/bookmarks.
- PDF view as separate fixed-layout reader.
- Import validation, error handling, export guidance and format tests.
- Add permitted online web-novel adapters only after source terms are reviewed.

**Exit criteria:** import/open/resume/delete and offline behavior verified; no user file is lost silently.

## Phase 4 — Original publishing backend
- Choose backend/auth/database/file storage after requirements/cost review.
- Reader/applicant/approved-author/moderator/admin roles.
- Applications, moderation review, author studio, drafts, publish, revisions, report/takedown, audit logs and notifications.
- Server-side authorization tests before public submissions.

**Exit criteria:** security review, rights declaration, privacy/terms, moderation process, backups and restore test.

## Phase 5 — Public distribution and optional donations
- Official website, release downloads and changelog.
- Privacy policy, terms, support and content notices.
- Optional voluntary creator donations only; no paywall for reading.
- Decide on Android packaging (PWA wrapper/Capacitor/native) after file-access prototype.

## Release gate for every phase
- `npm run check`
- `npm test`
- `git diff --check`
- Mobile visual/interaction smoke test
- Backup and rollback plan for data/storage changes
- Explicit user approval before push/merge/deploy
