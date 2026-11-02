// One quiet retry policy for the AniList and MyAnimeList calls, so a dropped mobile connection, a gateway blip or a
// short rate limit does not turn into an error message. Only failures that usually clear by themselves are retried:
//   NETWORK_ERROR, TIMEOUT      the connection dropped or was slow
//   UNAVAILABLE                 the service answered 5xx
//   RATE_LIMITED                waits the time the service asked for, if that is short enough to wait for
// Everything else (sign-in problems, "not found", bad requests) is returned straight away, because trying again cannot help.
const RETRYABLE = new Set(['NETWORK_ERROR', 'TIMEOUT', 'UNAVAILABLE']);
export const DEFAULT_DELAYS_MS = Object.freeze([800, 2500]);
export const MAX_RATE_LIMIT_WAIT_S = 20;

const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function retryDelay(error, attempt, delays = DEFAULT_DELAYS_MS) {
  if (error?.code === 'RATE_LIMITED') {
    const seconds = Number(error.retryAfter) || 0;
    return seconds > 0 && seconds <= MAX_RATE_LIMIT_WAIT_S ? seconds * 1000 : null; // too long: let the caller decide
  }
  if (!RETRYABLE.has(error?.code)) return null;
  return delays[Math.min(attempt, delays.length - 1)];
}

// run() is called again after each retryable failure, up to delays.length more times.
export async function withRetry(run, { delays = DEFAULT_DELAYS_MS, sleep = realSleep, signal } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await run(attempt); }
    catch (error) {
      const wait = attempt < delays.length ? retryDelay(error, attempt, delays) : null;
      if (wait === null || signal?.aborted) throw error;
      await sleep(wait);
    }
  }
}
