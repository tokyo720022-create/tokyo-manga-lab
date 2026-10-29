// Talks to MyAnimeList through the Tokyo Manga Lab Worker (MyAnimeList's API cannot be called straight from a web view).
// The Worker passes the person's own token on and keeps nothing. Tokens are refreshed here when they run out.
import { LIST_PAGE_SIZE, MAX_LIST_PAGES } from './mal-config.js';
import { withRetry } from '../../shared/retry.js';

export class MalError extends Error {
  constructor(message, { status = 0, code = 'MAL_ERROR', retryAfter = 0 } = {}) {
    super(message);
    this.name = 'MalError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const REQUEST_TIMEOUT_MS = 25000;

async function send(url, { method = 'GET', headers = {}, body, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { method, headers: { Accept: 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new MalError('MyAnimeList took too long to respond.', { code: 'TIMEOUT' });
    throw new MalError('Could not reach MyAnimeList. Check your connection.', { code: 'NETWORK_ERROR' });
  } finally { clearTimeout(timer); }
  let payload = null;
  try { payload = await response.json(); } catch { /* handled below */ }
  if (response.ok) {
    if (!payload || typeof payload !== 'object') throw new MalError('MyAnimeList returned an unreadable response.', { code: 'INVALID_RESPONSE' });
    return payload;
  }
  const code = payload?.error?.code || '';
  if (response.status === 429 || code === 'RATE_LIMITED') {
    const wait = Number(response.headers?.get?.('Retry-After')) || 60;
    throw new MalError(`MyAnimeList is rate limiting requests. Try again in ${wait} seconds.`, { status: 429, code: 'RATE_LIMITED', retryAfter: wait });
  }
  if (response.status === 401 || code === 'UNAUTHORIZED') throw new MalError('MyAnimeList sign-in expired or was revoked. Connect again.', { status: 401, code: 'UNAUTHORIZED' });
  if (code === 'MAL_AUTH_FAILED') throw new MalError(payload?.error?.message || 'MyAnimeList did not accept that sign-in.', { status: response.status, code: 'AUTH_FAILED' });
  if (response.status === 404) throw new MalError(payload?.error?.message || 'MyAnimeList does not know that title.', { status: 404, code: 'NOT_FOUND' });
  if (response.status >= 500) throw new MalError('MyAnimeList is not available right now. Nothing was lost; try again later.', { status: response.status, code: 'UNAVAILABLE' });
  throw new MalError(payload?.error?.message || `MyAnimeList returned HTTP ${response.status}.`, { status: response.status, code: 'MAL_ERROR' });
}

// Exchanges the one-time sign-in code (and the PKCE verifier) for tokens.
export async function exchangeCode({ apiBase, clientId, code, verifier, fetchImpl = (...args) => fetch(...args) }) {
  // Not retried: a sign-in code works once, and a repeat after a lost answer would be refused.
  const payload = await send(`${apiBase}/api/v1/mal/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier }, fetchImpl });
  return readTokens(payload);
}

export async function refreshTokens({ apiBase, clientId, refreshToken, fetchImpl = (...args) => fetch(...args), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const ask = () => send(`${apiBase}/api/v1/mal/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }, fetchImpl });
  // A refresh token is replaced when it is used, so an answer that may have been lost on the way back (a timeout, a 5xx)
  // is never repeated blindly. Only a connection that never opened is tried once more.
  let payload;
  try { payload = await ask(); }
  catch (error) {
    if (error?.code !== 'NETWORK_ERROR') throw error;
    await sleep(900);
    payload = await ask();
  }
  return readTokens(payload);
}

function readTokens(payload, now = Date.now()) {
  const data = payload?.data;
  if (!data?.access_token) throw new MalError('MyAnimeList did not return a sign-in.', { code: 'INVALID_RESPONSE' });
  return { accessToken: data.access_token, refreshToken: data.refresh_token || null, expiresAt: now + (Number(data.expires_in) || 3600) * 1000 };
}

// auth = { getToken(): Promise<string>, refresh(): Promise<string> }. A 401 triggers one refresh and one retry.
export function createMalClient({ apiBase, auth, adult = () => false, fetchImpl = (...args) => fetch(...args), retryDelays, sleep } = {}) {
  if (!auth) throw new MalError('Not signed in to MyAnimeList.', { code: 'UNAUTHORIZED' });

  async function request(path, { method = 'GET', query = {}, body } = {}) {
    const url = new URL(`${apiBase}/api/v1/mal${path}`);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    if (adult()) url.searchParams.set('adult', '1');
    // Connection drops, 5xx and short rate limits are retried quietly. Saving a list entry is safe to repeat because it
    // sets the entry to the values sent rather than adding to it.
    const run = token => withRetry(() => send(url.toString(), { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body, fetchImpl }), { delays: retryDelays, sleep });
    try { return await run(await auth.getToken()); }
    catch (error) {
      if (error?.code !== 'UNAUTHORIZED') throw error;
      return run(await auth.refresh());
    }
  }

  return {
    // The person's account: id, name, picture, joined date, location and anime totals.
    async viewer() {
      const me = (await request('/me')).data;
      if (!me?.id) throw new MalError('MyAnimeList did not return your account.', { code: 'INVALID_RESPONSE' });
      return me;
    },
    // Every manga entry once, newest change first.
    async mangaList() {
      const rows = [];
      let hidden = 0;
      let offset = 0;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const result = await request('/list', { query: { offset } });
        rows.push(...(Array.isArray(result.data) ? result.data : []));
        hidden += Number(result.hidden) || 0;
        if (!result.hasNext) break;
        offset = Number(result.nextOffset) || offset + LIST_PAGE_SIZE;
      }
      const seen = new Set();
      return { rows: rows.filter(row => { const id = row?.node?.id; if (id == null || seen.has(id)) return false; seen.add(id); return true; }), hidden };
    },
    // Saves only the fields given (MyAnimeList keeps the rest).
    async saveEntry({ mediaId, ...body }) {
      const saved = (await request(`/manga/${Number(mediaId)}/status`, { method: 'PATCH', body })).data;
      if (!saved || typeof saved !== 'object') throw new MalError('MyAnimeList did not confirm the change.', { code: 'INVALID_RESPONSE' });
      return saved;
    },
    // One title with the person's own list entry (list_status is absent when it is not on their list).
    async mediaEntry(mediaId) {
      const node = (await request(`/manga/${Number(mediaId)}`)).data;
      if (!node?.id) throw new MalError('MyAnimeList does not know that title.', { code: 'NOT_FOUND' });
      return node;
    },
    async searchManga(query) {
      const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (text.length < 3) return [];
      const data = (await request('/search', { query: { q: text } })).data;
      return Array.isArray(data) ? data : [];
    }
  };
}
