import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalOwner, LOCAL_OWNER_KEY } from '../src/services/localOwner.js';

/** A stand-in for localStorage so the module is testable without a browser. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get size() { return map.size; }
  };
}

test('the first account to sign in claims the empty device without a wipe', () => {
  const storage = fakeStorage();
  const owner = createLocalOwner(storage);
  assert.equal(owner.read(), '', 'nothing is owned yet');
  assert.equal(owner.claim('user-a'), true, 'no conflict on a fresh device');
  assert.equal(owner.read(), 'user-a', 'and the marker is recorded');
});

test('the same account signing back in keeps its local data', () => {
  // Signing out must not wipe anything: the user returning to their own account
  // expects their data to still be there, and the server has a copy anyway.
  const storage = fakeStorage();
  const owner = createLocalOwner(storage);
  owner.claim('user-a');
  assert.equal(owner.claim('user-a'), true, 'matching ids keep the data');
  assert.equal(owner.read(), 'user-a');
});

test('a different account is refused so the previous account rows cannot be pushed', () => {
  // This is the regression: on a shared browser profile, user A signs out and user
  // B signs in. B must not inherit A's rows, and specifically A's pending_sync
  // rows must never be flushed into B's account.
  const storage = fakeStorage();
  const owner = createLocalOwner(storage);
  assert.equal(owner.claim('user-a'), true);
  const verdict = owner.claim('user-b');
  assert.equal(verdict, false, 'the caller must clear before flushing anything');
  assert.equal(owner.read(), 'user-a', 'the marker still names the true owner until cleared');
});

test('the marker survives sign-out, which is what makes detection work', () => {
  // Regression for the bug that shipped: the handler used to call forget() on
  // sign-out, so the next sign-in saw an empty marker, concluded the data was
  // unowned, kept it, and pushed the previous account's rows into the new one.
  const storage = fakeStorage();
  const owner = createLocalOwner(storage);
  owner.claim('user-a');
  // Signing out is simply not calling forget(): nothing to do, by design.
  assert.equal(owner.claim('user-b'), false, 'still detected after a sign-out gap');
});

test('forget is reserved for an explicit wipe', () => {
  const storage = fakeStorage();
  const owner = createLocalOwner(storage);
  owner.claim('user-a');
  owner.forget();
  assert.equal(owner.read(), '', 'the marker is gone');
  assert.equal(owner.claim('user-b'), true, 'a wiped device has nothing to leak');
});

test('a missing, empty or hostile user id cannot lose data', () => {
  const storage = fakeStorage();
  const owner = createLocalOwner(storage);
  owner.claim('user-a');
  assert.equal(owner.claim(''), true, 'no id means no verdict, so keep the data');
  assert.equal(owner.claim(null), true);
  assert.equal(owner.claim(undefined), true);
  assert.equal(owner.read(), 'user-a', 'and nothing was overwritten');
});

test('storage that throws or is unavailable degrades instead of breaking sign-in', () => {
  // Storage can be disabled by policy, and touching localStorage can throw. A
  // sync failure here must never stop someone signing in.
  const hostile = {
    getItem() { throw new Error('blocked by policy'); },
    setItem() { throw new Error('blocked by policy'); },
    removeItem() { throw new Error('blocked by policy'); }
  };
  const owner = createLocalOwner(hostile);
  assert.equal(owner.read(), '');
  assert.equal(owner.claim('user-a'), true, 'cannot detect a switch, but must not fail');
  assert.equal(owner.claim('user-a'), true);
  assert.doesNotThrow(() => owner.forget());

  const absent = createLocalOwner(null);
  assert.equal(absent.read(), '');
  assert.equal(absent.claim('user-a'), true);
  assert.doesNotThrow(() => absent.forget());
});

test('the marker key is stable, so an existing install keeps its detection', () => {
  // Changing this string would orphan the marker already in every browser and
  // silently re-open the cross-account leak.
  assert.equal(LOCAL_OWNER_KEY, 'fh-app-local-owner');
});
