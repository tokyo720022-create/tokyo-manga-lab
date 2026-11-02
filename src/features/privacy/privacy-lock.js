// The PIN lock, the maths only: making and checking a PIN, wrong-guess delays, and when the app should lock again.
// Nothing here touches the page or storage, so it can be tested on its own.
export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const PBKDF2_ITERATIONS = 150000;
export const LOCK_DELAYS = Object.freeze([['0', 'Immediately'], ['30', 'After 30 seconds'], ['60', 'After 1 minute'], ['300', 'After 5 minutes'], ['900', 'After 15 minutes']]);
export const DEFAULT_LOCK_DELAY = '60';

const FREE_TRIES = 4;                 // wrong PINs in a row before the waiting starts
const FIRST_WAIT_MS = 30 * 1000;
const MAX_WAIT_MS = 15 * 60 * 1000;

export const isValidPin = pin => new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(String(pin ?? ''));

const toBase64 = bytes => btoa(String.fromCharCode(...bytes));
const fromBase64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));

async function derive(pin, salt, iterations, subtle) {
  const key = await subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

// A stored PIN is a random salt plus a slow hash of the PIN. The PIN itself is never kept.
export async function createPinRecord(pin, { subtle = globalThis.crypto?.subtle, random = bytes => globalThis.crypto.getRandomValues(bytes), now = Date.now(), iterations = PBKDF2_ITERATIONS } = {}) {
  if (!isValidPin(pin)) throw new Error(`A PIN is ${PIN_MIN} to ${PIN_MAX} digits.`);
  if (!subtle) throw new Error('This device cannot protect a PIN here.');
  const salt = random(new Uint8Array(16));
  const hash = await derive(pin, salt, iterations, subtle);
  return { provider: 'privacy-lock', salt: toBase64(salt), hash: toBase64(hash), iterations, createdAt: now, failures: 0, lockedUntil: 0 };
}

export async function checkPin(record, pin, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!record?.salt || !record?.hash || !isValidPin(pin) || !subtle) return false;
  const expected = fromBase64(record.hash);
  const actual = await derive(pin, fromBase64(record.salt), Number(record.iterations) || PBKDF2_ITERATIONS, subtle);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) difference |= expected[i] ^ actual[i];
  return difference === 0;
}

// Wrong guesses: the first few are free, then 30 seconds, doubling each time, never more than 15 minutes.
export function waitAfterFailures(failures) {
  if (failures <= FREE_TRIES) return 0;
  return Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (failures - FREE_TRIES - 1));
}

export const afterWrongPin = (record, now = Date.now()) => {
  const failures = (Number(record.failures) || 0) + 1;
  return { ...record, failures, lockedUntil: now + waitAfterFailures(failures) };
};
export const afterRightPin = record => ({ ...record, failures: 0, lockedUntil: 0 });
export const waitRemainingMs = (record, now = Date.now()) => Math.max(0, (Number(record?.lockedUntil) || 0) - now);

export function describeWait(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// The app was hidden at `hiddenAt` and is back now: does it ask for the PIN?
export function shouldLockOnReturn({ hiddenAt, now = Date.now(), delaySeconds }) {
  if (!(hiddenAt > 0)) return false;
  const delay = Number(delaySeconds);
  const wait = Number.isFinite(delay) && delay >= 0 ? delay * 1000 : Number(DEFAULT_LOCK_DELAY) * 1000;
  return now - hiddenAt >= wait;
}
