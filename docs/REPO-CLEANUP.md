# Keeping the repository tidy

## Removing old files with an update zip
Your phone cannot delete files in bulk on GitHub, so the **Unzip and apply ZIP** workflow can do it: if the zip contains a file named `DELETE-FILES.txt`, the workflow removes the paths listed in it before copying the new files in.

Rules the workflow follows:
- One repository path per line. Anything after a `#` is a note. A path ending in `/` removes that whole folder.
- It never touches `.git` or `.github`, never goes outside the repository, and skips anything that looks unsafe (it says so in the log).
- `DELETE-FILES.txt` itself is not copied into the repository.
- The change arrives as a pull request like any other, so you see exactly what is removed before you merge.

This needs the updated `unzip-and-apply.yml` (paste it into `.github/workflows/` by hand once; zips cannot change `.github`).

## What the current list removes
- `mangadex-live.js`: an old one-file prototype that nothing loads.
- `Tokyo-Manga-Lab-v0.10.1-Exceptions.zip` and `Tokyo-Manga-Lab-v0.11.0-Downloads.zip`: old release zips left in the repository root.
- `docs/Workflows/`: a duplicate of `docs/workflows/` that differs only in the capital letter (the two cause trouble on Windows and macOS).

The old files stay in the Git history, so nothing is lost for good.
