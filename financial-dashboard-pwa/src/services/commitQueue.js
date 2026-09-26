/**
 * Coalescing write-behind queue for committed changes.
 *
 * Framework-free and dependency-free on purpose: `syncEngine.js` cannot be
 * imported by the test runner (it pulls in `svelte/store` and `import.meta.env`),
 * so the scheduling and coalescing rules live here where they can be tested
 * directly with a fake clock.
 *
 * Behaviour that matters: repeated edits to the same record collapse into a
 * single flush carrying only the newest value, so a burst of edits costs one
 * request per record group instead of one request per keystroke.
 */

/** Split rows into request-sized batches. */
export function chunkRows(rows, size = 100) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

export function createCoalescingQueue({ delay = 1_200, onFlush, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const entries = new Map();
  let timer = null;

  function schedule() {
    if (timer !== null) return;
    timer = setTimer(() => { timer = null; void drain(); }, delay);
  }

  function cancel() {
    if (timer !== null) { clearTimer(timer); timer = null; }
  }

  /**
   * Queue an entry, superseding any earlier one for the same key. The superseded
   * entry is settled as "not committed" here rather than being the caller's job,
   * because the queue already holds its resolver and forgetting to wire that up
   * would strand a promise that never resolves.
   */
  function set(key, entry) {
    const previous = entries.get(key);
    // Re-insert so the map keeps the most recently touched key last.
    entries.delete(key);
    entries.set(key, entry);
    previous?.resolve?.(false);
    schedule();
  }

  async function drain() {
    if (!entries.size) return { committed: 0 };
    // Snapshot and clear synchronously, so a drain started while another is
    // still awaiting picks up exactly the entries added since, never the same
    // entry twice.
    const batch = [...entries.values()];
    entries.clear();
    let settled;
    try {
      settled = await onFlush(batch);
    } catch {
      settled = batch.map(() => false);
    }
    const flags = Array.isArray(settled) ? settled : batch.map(() => false);
    batch.forEach((entry, index) => entry.resolve?.(Boolean(flags[index])));
    return { committed: flags.filter(Boolean).length };
  }

  return {
    set,
    drain,
    cancel,
    has: (key) => entries.has(key),
    get size() { return entries.size; },
    /** Queue depth, exposed for the status line. */
    pending: () => [...entries.values()]
  };
}
