/**
 * Build freshness guard.
 *
 * A tab opened before a deploy keeps running the JavaScript it loaded at that
 * moment — no amount of server-side change affects it. That produced a very
 * confusing failure once already: a pre-migration build kept calling Supabase
 * and kept showing Supabase error copy long after the Worker was live.
 *
 * The compiled-in build id is compared against the one the service worker
 * advertises. A mismatch means this tab is stale, so old caches are dropped and
 * the page is reloaded once. The sessionStorage latch stops a reload loop if
 * the two ever disagree persistently (for example a partially deployed build).
 */

/**
 * `import.meta.env` is injected by Vite at build time. Node (the test runner)
 * has no such object, so it is read defensively rather than assumed.
 */
const buildEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

export const BUILD_ID = buildEnv.VITE_BUILD_ID || 'dev';

const RELOAD_LATCH = 'findash-reload-latch';

function readLatch() {
  try {
    return sessionStorage.getItem(RELOAD_LATCH) || '';
  } catch {
    return '';
  }
}

function writeLatch(value) {
  try {
    sessionStorage.setItem(RELOAD_LATCH, value);
  } catch {
    /* storage may be disabled; the guard simply becomes a no-op */
  }
}

function clearLatch() {
  try {
    sessionStorage.removeItem(RELOAD_LATCH);
  } catch {
    /* ignore */
  }
}

/** Pull the build id out of the service worker source. */
export function parseWorkerBuildId(source) {
  const match = String(source || '').match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : '';
}

async function dropCaches() {
  if (!('caches' in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    /* cache deletion is best effort */
  }
}

/**
 * Reload the tab once if it is running an out-of-date build.
 * Returns a short status string for diagnostics; never throws.
 */
export async function ensureFreshBuild({ fetchImpl = fetch, reload = () => location.reload() } = {}) {
  if (BUILD_ID === 'dev' || !('serviceWorker' in navigator)) return 'skipped';

  let workerBuildId = '';
  try {
    // `cache: 'reload'` bypasses the HTTP cache so we always read the deployed worker.
    const response = await fetchImpl('/sw.js', { cache: 'reload' });
    if (response.ok) workerBuildId = parseWorkerBuildId(await response.text());
  } catch {
    return 'offline';
  }

  if (!workerBuildId || workerBuildId === BUILD_ID) {
    clearLatch();
    return 'current';
  }

  // Already reloaded once for this mismatch: do not loop, just report it.
  if (readLatch() === `${BUILD_ID}->${workerBuildId}`) return 'stale-persistent';

  writeLatch(`${BUILD_ID}->${workerBuildId}`);
  const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  await registration?.update?.().catch?.(() => {});
  await dropCaches();
  reload();
  return 'reloading';
}