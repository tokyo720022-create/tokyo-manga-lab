# Reviewed exceptions (titles wrongly hidden by the tag block)

Tokyo Manga Lab never shows titles that MangaDex tags **loli** or **shota**. The block works by tag, so it also hides some titles that are not sexual at all. This page explains the one narrow way to let such a title through, after you have checked it yourself.

## What the rule is
- You may list a title by its MangaDex id in `REVIEWED_EXCEPTIONS` at the top of `worker/src/index.js`.
- A listed title is shown **only if MangaDex itself rates it "safe"**. If MangaDex rates it suggestive, erotica or pornographic, it stays blocked even though it is listed. This is checked on every request, so a later rating change on MangaDex takes effect straight away.
- Titles that are not listed stay blocked, whatever their rating. The 18+ toggle does not change any of this.
- Nothing else unblocks the tags. There is no setting, no app-side list and no way for the app (or anyone calling the Worker) to pass an id. The list lives in the Worker so it cannot be overridden from a phone.

## How to add a title
1. Open the title on mangadex.org and read its page. Only add it if it is clearly not sexual content. If you are unsure, leave it out.
2. Copy the id from the address: `https://mangadex.org/title/<this-part>/name` (a UUID like `a96676e5-8ae2-425e-b549-7f15dd34a6d8`).
3. Add a line to the list. The title text is only a note for you:
   ```js
   const REVIEWED_EXCEPTIONS = [
     { id: "a96676e5-8ae2-425e-b549-7f15dd34a6d8", title: "Name of the title" },
   ];
   ```
4. Run `npm test`, apply the change, and **redeploy the Worker**. The filter runs in the Worker, so the app itself does not need an update. Until the Worker is redeployed nothing changes.

## What you will see
- The title appears in search results when your search words match its title (first page of results), and opens normally with its chapters and reader.
- It does not appear in the "latest" shelf on its own; search for it by name.
- Up to 100 ids are used. Entries that are not valid ids are ignored.

## Tests
`tests/worker-exceptions.test.mjs` checks that the shipped list is empty, that a listed safe title works, that listed titles rated suggestive, erotica or pornographic stay blocked in every mode, that unlisted titles stay blocked, that chapter pages follow the same rule, and that search stays working if the extra lookup fails.
