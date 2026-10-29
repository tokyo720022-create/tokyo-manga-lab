import { MAL_AUTH_URL, MAL_REDIRECT_HOST, MAL_REDIRECT_PROTOCOL, MAL_REDIRECT_URI } from './mal-config.js';

// MyAnimeList client IDs are about 32 letters and numbers.
export const isValidClientId = value => /^[A-Za-z0-9]{16,64}$/.test(String(value || '').trim());

const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
function randomText(length, random = globalThis.crypto) {
  const bytes = new Uint8Array(length);
  random.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += URL_SAFE[byte % URL_SAFE.length];
  return out;
}

// MyAnimeList only supports the "plain" PKCE method: the challenge is the verifier itself. The verifier never leaves the
// device until the sign-in code is exchanged, and it is only useful together with that one-time code.
export function createAuthAttempt({ random } = {}) {
  return { verifier: randomText(64, random), state: randomText(24, random) };
}

export function buildAuthorizeUrl(clientId, { verifier, state }) {
  if (!isValidClientId(clientId)) throw new Error('Enter your MyAnimeList client ID first. It is about 32 letters and numbers.');
  const url = new URL(MAL_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', String(clientId).trim());
  url.searchParams.set('code_challenge', verifier);
  url.searchParams.set('code_challenge_method', 'plain');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', MAL_REDIRECT_URI);
  return url.href;
}

// MyAnimeList returns tokyomangalab://mal-auth?code=...&state=... (or ?error=access_denied).
export function parseAuthRedirect(urlString) {
  let url;
  try { url = new URL(String(urlString)); } catch { return { ok: false, reason: 'not-a-url' }; }
  if (url.protocol !== MAL_REDIRECT_PROTOCOL || url.hostname !== MAL_REDIRECT_HOST) return { ok: false, reason: 'not-ours' };
  const error = url.searchParams.get('error');
  if (error) return { ok: false, reason: 'denied', message: url.searchParams.get('error_description') || error };
  const code = (url.searchParams.get('code') || '').trim();
  const state = (url.searchParams.get('state') || '').trim();
  if (!/^[A-Za-z0-9._~-]{10,2048}$/.test(code)) return { ok: false, reason: 'no-code' };
  return { ok: true, code, state };
}
