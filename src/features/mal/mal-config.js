// MyAnimeList (optional account link). The API only allows the "authorization code" sign-in with a client ID that the
// person registers for themselves, so there is no built-in ID here.
export const MAL_AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize';

// Register this exact redirect URL on myanimelist.net/apiconfig when you create the app.
export const MAL_REDIRECT_URI = 'tokyomangalab://mal-auth';
export const MAL_REDIRECT_PROTOCOL = 'tokyomangalab:';
export const MAL_REDIRECT_HOST = 'mal-auth';

// The app's own MyAnimeList client ID (app "Tokyo Manga Lab", type android, redirect tokyomangalab://mal-auth), so people can sign in
// without creating anything. A client ID is public by design and no client secret is used (PKCE). A person can still set
// their own in Settings > Account and sync > Advanced, and that one wins.
export const DEFAULT_MAL_CLIENT_ID = 'f12c4b87e9aa18f53468de53d93344c9';

export const MAL_REGISTER_URL = 'https://myanimelist.net/register.php';
export const MAL_APPS_URL = 'https://myanimelist.net/apiconfig';
export const MAL_TITLE_URL = id => `https://myanimelist.net/manga/${encodeURIComponent(id)}`;

export const AUTH_ATTEMPT_MAX_AGE_MS = 15 * 60 * 1000;
export const ACCESS_SKEW_MS = 60 * 1000;          // refresh a minute before the access token runs out
export const LIST_PAGE_SIZE = 100;                 // the Worker pages 100 at a time
export const MAX_LIST_PAGES = 200;
export const MAX_PUSHES_PER_RUN = 60;
export const PUSH_SPACING_MS = 800;
