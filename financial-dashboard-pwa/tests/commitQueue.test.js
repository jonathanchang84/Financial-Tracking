import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkRows, createCoalescingQueue } from '../src/services/commitQueue.js';

/** A controllable clock so the debounce can be tested without real waiting. */
function fakeClock() {
  let next = 1;
  const pending = new Map();
  return {
    setTimer: (fn) => { const id = next; next += 1; pending.set(id, fn); return id; },
    clearTimer: (id) => { pending.delete(id); },
    run() { const entries = [...pending.entries()]; pending.clear(); for (const [, fn] of entries) fn(); },
    get scheduled() { return pending.size; }
  };
}

test('chunks rows at the request boundary without losing or duplicating any', () => {
  // The Worker rejects a batch over 100 rows, so an oversized queue must be split
  // rather than dropped or sent whole.
  const rows = Array.from({ length: 250 }, (_, index) => index);
  const chunks = chunkRows(rows, 100);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 50]);
  assert.deepEqual(chunks.flat(), rows);
  assert.deepEqual(chunkRows([], 100), []);
  assert.equal(chunkRows([1, 2, 3], 100).length, 1);
});

test('repeated edits to one record collapse into a single newest-value flush', async () => {
  // The whole point of coalescing: editing a field five times must cost one
  // request carrying the last value, not five requests carrying stale versions.
  const clock = fakeClock();
  const batches = [];
  const queue = createCoalescingQueue({
    delay: 1_200,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => { batches.push(batch); return batch.map(() => true); }
  });

  const settled = [];
  for (const value of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
    settled.push(new Promise((resolve) => queue.set('bills r1', { value, resolve })));
  }
  assert.equal(queue.size, 1, 'five edits to one record must leave a single queued entry');
  assert.equal(clock.scheduled, 1, 'the debounce must not stack a timer per edit');

  // Drain explicitly rather than firing the clock, so this test observes the one
  // flush that carries the burst instead of racing the timer-triggered drain.
  const result = await queue.drain();

  assert.equal(batches.length, 1, 'exactly one request for the whole burst');
  assert.equal(batches[0].length, 1);
  assert.equal(batches[0][0].value, 'abcde', 'the newest value must be the one sent');
  assert.equal(result.committed, 1);
  // The superseded attempts settle as not-committed instead of hanging forever.
  assert.deepEqual(await Promise.all(settled), [false, false, false, false, true]);
});

test('different records are kept apart and reported individually', async () => {
  const clock = fakeClock();
  let seen = null;
  const queue = createCoalescingQueue({
    delay: 1_200,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => { seen = batch.map((entry) => entry.id); return [true, false]; }
  });
  const settled = [];
  queue.set('bills r1', { id: 'r1', resolve: (v) => settled.push(['r1', v]) });
  queue.set('bills r2', { id: 'r2', resolve: (v) => settled.push(['r2', v]) });
  clock.run();
  await queue.drain();
  assert.deepEqual(seen, ['r1', 'r2']);
  assert.ok(settled.some(([id, value]) => id === 'r1' && value === true));
  assert.ok(settled.some(([id, value]) => id === 'r2' && value === false));
});


test('a failed push reports not-committed so the rows stay pending for a retry', async () => {
  // Losing the "not committed" signal here would mark a row synced in IndexedDB
  // while the server never received it, and the change would be lost for good.
  const clock = fakeClock();
  const queue = createCoalescingQueue({
    delay: 1_200,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async () => { throw new Error('network down'); }
  });
  let outcome = null;
  queue.set('bills r1', { id: 'r1', resolve: (value) => { outcome = value; } });
  clock.run();
  await queue.drain();
  assert.equal(outcome, false);
  assert.equal(queue.size, 0, 'a failed batch is not silently retried in a tight loop');
});

test('a drain already in flight does not resend entries another drain took', async () => {
  // Two flushes can overlap when a page-hide commit races the periodic net.
  // Each entry must be sent exactly once, never twice.
  const clock = fakeClock();
  const sent = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queue = createCoalescingQueue({
    delay: 1_200,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => {
      sent.push(...batch.map((entry) => entry.id));
      if (batch.length === 1 && batch[0].id === 'r1') await gate;
      return batch.map(() => true);
    }
  });
  queue.set('bills r1', { id: 'r1', resolve: () => {} });
  clock.run();
  const first = queue.drain();
  queue.set('bills r2', { id: 'r2', resolve: () => {} });
  const second = queue.drain();
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sent.sort(), ['r1', 'r2'], 'each entry is sent exactly once');
});

test('draining an empty queue costs nothing and never calls the network', async () => {
  const clock = fakeClock();
  let calls = 0;
  const queue = createCoalescingQueue({
    delay: 1_200,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async () => { calls += 1; return []; }
  });
  const result = await queue.drain();
  assert.equal(calls, 0);
  assert.equal(result.committed, 0);
});

test('cancel stops a scheduled flush without discarding the queued rows', async () => {
  const clock = fakeClock();
  let calls = 0;
  const queue = createCoalescingQueue({
    delay: 1_200,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onFlush: async (batch) => { calls += 1; return batch.map(() => true); }
  });
  queue.set('bills r1', { id: 'r1', resolve: () => {} });
  queue.cancel();
  assert.equal(clock.scheduled, 0, 'the pending timer must be cleared');
  assert.equal(queue.size, 1, 'cancelling the timer must not drop the row');
  await queue.drain();
  assert.equal(calls, 1, 'an explicit drain still sends it');
});
