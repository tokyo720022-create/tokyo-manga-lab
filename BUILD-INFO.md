# Tokyo Manga Lab - build info

Version: 0.10.1
Milestone: Themes, AniList profile, first public release

See `CHANGELOG.md` for what changed in each version and `docs/` for the design notes.

## Checks
- `npm run check` parses every file and confirms the offline cache lists every module.
- `npm test` runs the unit tests.
- `python3 tests/e2e/run.py` runs the browser tests (needs Python Playwright with Chromium).

## Not included
- No offline chapter downloads.
- No Worker deployment, GitHub commit or push is done by building this package.
