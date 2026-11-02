import test from 'node:test';
import assert from 'node:assert/strict';
import { afterRightPin, afterWrongPin, checkPin, createPinRecord, describeWait, isValidPin, shouldLockOnReturn, waitAfterFailures, waitRemainingMs } from '../src/features/privacy/privacy-lock.js';

const fast = { iterations: 1000 }; // the real count is slow on purpose; tests use a small one

test('a PIN is 4 to 8 digits', () => {
  for (const good of ['1234', '00000000', '987654']) assert.equal(isValidPin(good), true, good);
  for (const bad of ['', '123', '123456789', '12a4', '12 34', null, undefined, '１２３４']) assert.equal(isValidPin(bad), false, String(bad));
});

test('the stored record never contains the PIN, and the right PIN opens it', async () => {
  const record = await createPinRecord('4821', fast);
  assert.ok(!JSON.stringify(record).includes('4821'));
  assert.equal(record.provider, 'privacy-lock');
  assert.equal(await checkPin(record, '4821'), true);
  assert.equal(await checkPin(record, '4822'), false);
  assert.equal(await checkPin(record, ''), false);
  assert.equal(await checkPin(null, '4821'), false);
});

test('the same PIN gets a different salt and hash every time', async () => {
  const a = await createPinRecord('1111', fast);
  const b = await createPinRecord('1111', fast);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('an invalid PIN is refused when creating', async () => {
  await assert.rejects(() => createPinRecord('12', fast), /4 to 8 digits/);
});

test('wrong guesses: four free, then 30 s, 60 s, 120 s ... capped at 15 minutes', () => {
  assert.deepEqual([1, 2, 3, 4].map(waitAfterFailures), [0, 0, 0, 0]);
  assert.equal(waitAfterFailures(5), 30000);
  assert.equal(waitAfterFailures(6), 60000);
  assert.equal(waitAfterFailures(7), 120000);
  assert.equal(waitAfterFailures(40), 15 * 60 * 1000);
});

test('failures are counted, the wait is set, and a right PIN clears it', async () => {
  let record = await createPinRecord('1234', fast);
  for (let i = 0; i < 5; i += 1) record = afterWrongPin(record, 1000);
  assert.equal(record.failures, 5);
  assert.equal(record.lockedUntil, 31000);
  assert.equal(waitRemainingMs(record, 11000), 20000);
  assert.equal(waitRemainingMs(record, 99000), 0);
  record = afterRightPin(record);
  assert.equal(record.failures, 0);
  assert.equal(waitRemainingMs(record, 1000), 0);
});

test('waits read naturally', () => {
  assert.equal(describeWait(1000), '1 second');
  assert.equal(describeWait(30000), '30 seconds');
  assert.equal(describeWait(61000), '2 minutes');
});

test('the app locks again only after the chosen time away', () => {
  assert.equal(shouldLockOnReturn({ hiddenAt: 1000, now: 1001, delaySeconds: '0' }), true, 'immediately');
  assert.equal(shouldLockOnReturn({ hiddenAt: 1000, now: 30000, delaySeconds: '60' }), false);
  assert.equal(shouldLockOnReturn({ hiddenAt: 1000, now: 61000, delaySeconds: '60' }), true);
  assert.equal(shouldLockOnReturn({ hiddenAt: 0, now: 99999, delaySeconds: '0' }), false, 'never hidden: nothing to lock');
  assert.equal(shouldLockOnReturn({ hiddenAt: 1000, now: 20000, delaySeconds: 'junk' }), false, 'a bad setting falls back to one minute');
});
