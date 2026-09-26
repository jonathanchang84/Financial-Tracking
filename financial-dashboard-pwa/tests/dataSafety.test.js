import test from 'node:test';
import assert from 'node:assert/strict';

import { protectionCopy, protectionState, requestPersistentStorage, readDismissedAt, rememberDismissedAt, shouldShowProtectionBanner } from '../src/services/dataSafety.js';

test('the nudge appears only when there is data and no account holding it', () => {
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 12 }), true);
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 1 }), true, 'even one record matters');
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 0 }), false, 'nothing to lose, nothing to say');
  // Never nag someone who is already protected, offline, or has a failure to deal with.
  for (const state of ['protected', 'offline', 'offline-pending', 'stalled']) {
    assert.equal(shouldShowProtectionBanner({ state, pending: 99 }), false, `${state} is not the nudge's business`);
  }
});

test('dismissing stops the nagging but does not hide a much larger pile of data', () => {
  // Dismissal is remembered together with the count at the time, so it reappears
  // once there is meaningfully more to lose rather than being lost forever.
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 12, dismissedAt: 12 }), false);
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 30, dismissedAt: 12 }), false, 'not yet');
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 32, dismissedAt: 12 }), true, '20 more records');
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 500, dismissedAt: 12 }), true);
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 5, dismissedAt: 12 }), false, 'fewer rows, stay hidden');
});

test('nonsense inputs never produce a nag or a crash', () => {
  assert.equal(shouldShowProtectionBanner(), false, 'no input at all');
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: NaN }), false);
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: -3, dismissedAt: 0 }), false);
  assert.equal(shouldShowProtectionBanner({ state: undefined, pending: 5 }), false);
  assert.equal(shouldShowProtectionBanner({ state: 'local-only', pending: 5, dismissedAt: NaN }), true, 'NaN dismissal is no dismissal');
});

test('the dismissal survives a reload, and broken storage does not break anything', () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); }
  };
  assert.equal(readDismissedAt(storage), 0, 'nothing remembered yet');
  rememberDismissedAt(12, storage);
  assert.equal(readDismissedAt(storage), 12, 'dismissal is read back after a reload');
  rememberDismissedAt('nonsense', storage);
  assert.equal(readDismissedAt(storage), 0, 'garbage is treated as no dismissal');

  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };
  assert.equal(readDismissedAt(hostile), 0);
  assert.doesNotThrow(() => rememberDismissedAt(5, hostile));
  assert.equal(readDismissedAt(null), 0);
  assert.doesNotThrow(() => rememberDismissedAt(5, null));
});


test('signed in, online and nothing queued means the data is safe', () => {
  assert.equal(protectionState({ online: true, signedIn: true, pending: 0 }), 'protected');
  assert.equal(protectionCopy('protected').tone, 'ok');
});

test('no account means this device is the only copy, and it must not read as safe', () => {
  // The regression this fixes: the pill said "Saved locally" in the same grey as a
  // healthy state, so a single-user app looked protected when it was not.
  const state = protectionState({ online: true, signedIn: false, pending: 0 });
  assert.equal(state, 'local-only');
  const copy = protectionCopy(state);
  assert.equal(copy.tone, 'alert');
  assert.notEqual(copy.tone, 'ok');
  assert.match(copy.detail, /Sign in/i);
  assert.match(copy.detail, /loses the data/i, 'the consequence is stated, not implied');
});

test('offline is distinguished from local-only, and queued rows are called out', () => {
  assert.equal(protectionState({ online: false, signedIn: true, pending: 0 }), 'offline');
  assert.equal(protectionState({ online: false, signedIn: true, pending: 4 }), 'offline-pending');
  // Offline wins over signed-out: being offline is a temporary condition, and
  // saying "this device only" while a session exists would be misleading.
  assert.equal(protectionState({ online: false, signedIn: false, pending: 2 }), 'offline-pending');
  assert.equal(protectionCopy('offline').tone, 'warn');
  assert.equal(protectionCopy('offline-pending').tone, 'warn');
});

test('online and signed in with rows still queued means a commit is failing', () => {
  // Previously this failed silently as a number in a tooltip.
  const state = protectionState({ online: true, signedIn: true, pending: 3 });
  assert.equal(state, 'stalled');
  const copy = protectionCopy(state);
  assert.equal(copy.tone, 'alert');
  assert.match(copy.label, /Not syncing/);
  assert.match(copy.detail, /Re-sync/);
});

test('every state has copy, and an unknown state degrades to the safe one', () => {
  for (const state of ['protected', 'offline', 'offline-pending', 'local-only', 'stalled']) {
    const copy = protectionCopy(state);
    assert.ok(copy.label && copy.tone && copy.detail, `${state} needs label, tone and detail`);
  }
  assert.equal(protectionCopy('something-new').tone, 'ok');
  assert.equal(protectionState().tone, undefined, 'default input is local-only, not safe');
  assert.equal(protectionState(), 'local-only');
});

test('a nonsense pending count cannot fake a healthy state', () => {
  assert.equal(protectionState({ online: true, signedIn: true, pending: NaN }), 'protected', 'NaN reads as nothing queued');
  assert.equal(protectionState({ online: true, signedIn: true, pending: -5 }), 'protected', 'a negative count is clamped to zero');
  assert.equal(protectionState({ online: true, signedIn: true, pending: '3' }), 'stalled', 'a numeric string still counts');
  // A fractional count is impossible in practice, and this deliberately fails safe:
  // a false "Not syncing" is a mild annoyance, whereas a false "Synced" would hide
  // data that is genuinely not committed.
  assert.notEqual(protectionState({ online: true, signedIn: true, pending: 0.4 }), 'protected');
  assert.equal(protectionState({ online: true, signedIn: false, pending: 0.4 }), 'local-only', 'signed out still wins');
});

test('asking for persistent storage never throws, whatever the browser does', async () => {
  assert.equal(await requestPersistentStorage(null), false, 'no navigator');
  assert.equal(await requestPersistentStorage({}), false, 'no storage API');
  assert.equal(await requestPersistentStorage({ storage: {} }), false, 'no persist method');
  assert.equal(
    await requestPersistentStorage({ storage: { persist: () => Promise.resolve(true), persisted: () => Promise.resolve(false) } }),
    true
  );
  assert.equal(
    await requestPersistentStorage({ storage: { persist: () => Promise.resolve(false), persisted: () => Promise.resolve(false) } }),
    false,
    'a refusal is normal and must be a plain false'
  );
  // Already granted: must not ask again.
  let asked = 0;
  const granted = {
    storage: {
      persisted: () => Promise.resolve(true),
      persist: () => { asked += 1; return Promise.resolve(true); }
    }
  };
  assert.equal(await requestPersistentStorage(granted), true);
  assert.equal(asked, 0, 'an existing grant is reused rather than re-requested');
  // Hostile implementations must not break boot.
  assert.equal(
    await requestPersistentStorage({ storage: { persist: () => { throw new Error('blocked'); } } }),
    false
  );
  assert.equal(
    await requestPersistentStorage({ storage: { persisted: () => { throw new Error('blocked'); }, persist: () => Promise.resolve(true) } }),
    false
  );
});
