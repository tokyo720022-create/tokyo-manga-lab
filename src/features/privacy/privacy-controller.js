// The privacy screen: a PIN lock that covers the app, a blank cover while the app is in the background, and the
// screens for choosing, changing and removing the PIN. It is a screen lock for everyday privacy, not encryption:
// the library on the phone is not encrypted by it.
import { escapeHtml } from '../../shared/utils.js';
import { PIN_MAX, PIN_MIN, afterRightPin, afterWrongPin, checkPin, createPinRecord, describeWait, isValidPin, shouldLockOnReturn, waitRemainingMs } from './privacy-lock.js';
import { clearPinRecord, getPinRecord, savePinRecord } from './privacy-store.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];

export function createPrivacyController({ getSettings, onChange = () => {}, toast = () => {}, store = { getPinRecord, savePinRecord, clearPinRecord }, now = () => Date.now(), pinOptions = {} }) {
  let record = null;
  let dialog = null;
  let mode = '';          // '' | 'cover' | 'lock' | 'verify' | 'new' | 'confirm'
  let flow = null;        // { kind: 'setup' | 'change' | 'remove', newPin: '', done }
  let entry = '';
  let message = '';
  let hiddenAt = 0;
  let busy = false;
  let retryTimer = 0;
  let shake = false;

  const hasPin = () => Boolean(record);
  const delaySeconds = () => getSettings()?.privacyLockDelay;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'privacy-dialog';
    dialog.id = 'privacyDialog';
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (flow) finishFlow(false); });
    dialog.addEventListener('click', handleClick);
    document.body.append(dialog);
    return dialog;
  }

  function copyFor() {
    if (mode === 'lock') return { title: 'Tokyo Manga Lab is locked', sub: 'Enter your PIN to open it.' };
    if (mode === 'verify') return { title: 'Enter your current PIN', sub: flow?.kind === 'remove' ? 'This turns the lock off.' : 'Then you can choose a new one.' };
    if (mode === 'new') return { title: flow?.kind === 'change' ? 'Choose a new PIN' : 'Choose a PIN', sub: `${PIN_MIN} to ${PIN_MAX} digits. You will need it to open the app after you have been away. If you forget it, the only way back in is clearing the app's data, which also deletes your library, so keep a backup.` };
    return { title: 'Repeat the PIN', sub: 'Type the same PIN once more.' };
  }

  function keyMarkup(key) {
    if (key === 'back') return '<button type="button" class="privacy-key privacy-key-small" data-pin="back" aria-label="Delete the last digit">⌫</button>';
    if (key === 'ok') return '<button type="button" class="privacy-key privacy-key-small privacy-key-ok" data-pin="ok" aria-label="Confirm PIN">OK</button>';
    return `<button type="button" class="privacy-key" data-pin="${key}" aria-label="${key}">${key}</button>`;
  }

  function render() {
    const box = ensureDialog();
    if (mode === 'cover') {
      box.setAttribute('aria-label', 'Tokyo Manga Lab');
      box.innerHTML = '<div class="privacy-card privacy-cover"><img class="privacy-logo" src="./assets/logo-96.png" width="72" height="72" alt=""></div>';
      return;
    }
    const { title, sub } = copyFor();
    const shown = Math.max(PIN_MIN, entry.length);
    const dots = Array.from({ length: shown }, (_, index) => `<span class="privacy-dot${index < entry.length ? ' is-on' : ''}"></span>`).join('');
    const cancel = flow ? '<button type="button" class="button-subtle privacy-cancel" data-pin="cancel">Cancel</button>' : '';
    const hint = mode === 'lock' ? '<p class="privacy-hint">Forgot it? Clearing the app\'s data in Android settings removes the lock, and your library with it.</p>' : '';
    box.setAttribute('aria-label', title);
    box.innerHTML = `<div class="privacy-card${shake ? ' is-shaking' : ''}">
      <img class="privacy-logo" src="./assets/logo-96.png" width="72" height="72" alt="">
      <h2 id="privacyTitle">${escapeHtml(title)}</h2>
      <p class="privacy-sub">${escapeHtml(sub)}</p>
      <div class="privacy-dots" role="img" aria-label="${entry.length} digit${entry.length === 1 ? '' : 's'} entered">${dots}</div>
      <p class="privacy-message" role="alert">${escapeHtml(message)}</p>
      <div class="privacy-pad">${KEYS.map(keyMarkup).join('')}</div>
      ${cancel}${hint}
    </div>`;
    shake = false;
  }

  function open(nextMode) {
    mode = nextMode;
    entry = '';
    render();
    const box = ensureDialog();
    if (!box.open) box.showModal();
    box.focus({ preventScroll: true });
  }

  function close() {
    mode = '';
    entry = '';
    message = '';
    window.clearTimeout(retryTimer);
    if (dialog?.open) dialog.close();
  }

  const refresh = () => { render(); dialog?.focus({ preventScroll: true }); };

  function showWait() {
    const left = waitRemainingMs(record, now());
    window.clearTimeout(retryTimer);
    if (left <= 0) return false;
    message = `Too many wrong tries. Try again in ${describeWait(left)}.`;
    retryTimer = window.setTimeout(() => { message = ''; if (mode) refresh(); }, left + 50);
    return true;
  }

  async function submit() {
    if (busy) return;
    if (!isValidPin(entry)) { message = `Enter ${PIN_MIN} to ${PIN_MAX} digits.`; refresh(); return; }
    busy = true;
    try {
      if (mode === 'new') {
        flow.newPin = entry;
        mode = 'confirm'; entry = ''; message = ''; refresh();
        return;
      }
      if (mode === 'confirm') {
        if (entry !== flow.newPin) { flow.newPin = ''; mode = 'new'; entry = ''; message = 'The two PINs did not match. Start again.'; shake = true; refresh(); return; }
        record = await createPinRecord(entry, pinOptions);
        await store.savePinRecord(record);
        toast(flow.kind === 'change' ? 'PIN changed.' : 'PIN lock is on.');
        finishFlow(true);
        return;
      }
      // 'lock' and 'verify' both check the PIN against the stored one
      if (showWait()) { entry = ''; refresh(); return; }
      if (await checkPin(record, entry)) {
        if (record.failures || record.lockedUntil) { record = afterRightPin(record); await store.savePinRecord(record); }
        if (mode === 'lock') { close(); return; }
        if (flow.kind === 'remove') {
          await store.clearPinRecord();
          record = null;
          toast('PIN lock is off.');
          finishFlow(true);
          return;
        }
        mode = 'new'; entry = ''; message = ''; refresh();
        return;
      }
      record = afterWrongPin(record, now());
      await store.savePinRecord(record);
      entry = ''; shake = true;
      message = 'Wrong PIN.';
      showWait();
      refresh();
    } finally { busy = false; }
  }

  function finishFlow(changed) {
    const current = flow;
    flow = null;
    close();
    if (changed) onChange();
    current?.done?.(changed);
  }

  function press(key) {
    if (busy || !mode || mode === 'cover') return;
    if (key === 'cancel') { finishFlow(false); return; }
    if (key === 'ok') { submit(); return; }
    if (key === 'back') entry = entry.slice(0, -1);
    else if (/^\d$/.test(key) && entry.length < PIN_MAX) entry += key;
    else return;
    if (message && !waitRemainingMs(record, now())) message = '';
    refresh();
  }

  function handleClick(event) {
    const button = event.target.closest('[data-pin]');
    if (button) press(button.dataset.pin);
  }

  function handleKey(event) {
    if (!mode || mode === 'cover' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^\d$/.test(event.key)) { event.preventDefault(); press(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); press('back'); }
    else if (event.key === 'Enter') { event.preventDefault(); press('ok'); }
  }

  // The app went to the background: cover it at once. Coming back: ask for the PIN if it was away long enough.
  function handleVisibility() {
    if (!record) return;
    if (document.visibilityState === 'hidden') {
      if (!mode) { hiddenAt = now(); open('cover'); }
      else if (mode !== 'lock') hiddenAt = hiddenAt || now();
      return;
    }
    if (mode === 'cover') {
      if (shouldLockOnReturn({ hiddenAt, now: now(), delaySeconds: delaySeconds() })) open('lock');
      else close();
      hiddenAt = 0;
    } else if (hiddenAt && mode && mode !== 'lock') {
      // a PIN screen (choose/change) was open while away: leave it
      hiddenAt = 0;
    }
  }

  function startFlow(kind) {
    return new Promise(resolve => {
      if (flow) { resolve(false); return; }
      if (kind !== 'setup' && !record) { resolve(false); return; }
      flow = { kind, newPin: '', done: resolve };
      message = '';
      open(kind === 'setup' ? 'new' : 'verify');
    });
  }

  // Asks Android to blank the app in the recent-apps list (and block screenshots). A no-op in a browser.
  function applySecure() {
    try { window.TmlPrivacy?.setSecure?.(Boolean(getSettings()?.privacyHideRecents)); } catch { /* the Android hook is optional */ }
  }

  async function init() {
    document.addEventListener('keydown', handleKey);
    document.addEventListener('visibilitychange', handleVisibility);
    try { record = await store.getPinRecord(); } catch { record = null; }
    applySecure();
    if (record) { hiddenAt = 0; open('lock'); showWait(); if (message) refresh(); }
  }

  return { init, hasPin, applySecure, setup: () => startFlow('setup'), change: () => startFlow('change'), remove: () => startFlow('remove'), isOpen: () => Boolean(mode) };
}
