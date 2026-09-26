/**
 * Data protection: whether the user's records exist anywhere but this browser.
 *
 * IndexedDB is the only copy of everything until the account exists, and even then
 * a browser may evict an un-installed origin. This module turns those facts into
 * one state the UI can show honestly, so "Saved locally" never reads like safety.
 *
 * Pure and injectable so it is unit testable — `syncEngine.js` pulls in
 * `svelte/store` and `import.meta.env` and cannot be imported by `node --test`.
 */

/**
 *  - `protected`      signed in, online, nothing waiting
 *  - `offline`        no connection; writes queue and push on reconnect
 *  - `offline-pending` offline with rows still to send
 *  - `local-only`     no account, so this browser profile is the only copy
 *  - `stalled`        online and signed in but rows will not commit: a failure
 */
export function protectionState({ online = true, signedIn = false, pending = 0 } = {}) {
  const queued = Number.isFinite(Number(pending)) ? Math.max(0, Number(pending)) : 0;
  if (!online) return queued > 0 ? 'offline-pending' : 'offline';
  if (!signedIn) return 'local-only';
  if (queued > 0) return 'stalled';
  return 'protected';
}

const COPY = {
  protected: { label: 'Synced', tone: 'ok', detail: 'Every change is in your account.' },
  offline: { label: 'Offline', tone: 'warn', detail: 'Changes are saved here and push when you reconnect.' },
  'offline-pending': {
    label: 'Offline · queued',
    tone: 'warn',
    detail: 'Waiting to send. These changes are only on this device until you reconnect.'
  },
  'local-only': {
    label: 'This device only',
    tone: 'alert',
    detail: 'Sign in to keep a copy in your account. Clearing this browser or losing the device loses the data.'
  },
  stalled: {
    label: 'Not syncing',
    tone: 'alert',
    detail: 'Signed in and online, but some changes are not reaching your account. Use Re-sync everything.'
  }
};

export function protectionCopy(state) {
  return COPY[state] || COPY.protected;
}

const DISMISS_KEY = 'fh-app-protection-dismissed';
/** Records added after dismissing before it is worth mentioning again. */
const RESHOW_AFTER_MORE = 20;

/**
 * Show the nudge only when there is something to lose and no account holding it.
 *
 * While signed out, rows are never marked synced — `syncRecord` returns early
 * without a session — so a non-zero pending count is exactly "this device holds
 * data that exists nowhere else". That reuses the counter already being
 * maintained rather than adding another full scan of every store.
 *
 * Dismissal is remembered with the pending count at the time, so it does not nag
 * but still reappears once there is meaningfully more to lose.
 */
export function shouldShowProtectionBanner({ state, pending = 0, dismissedAt = 0 } = {}) {
  if (state !== 'local-only') return false;
  const queued = Number.isFinite(Number(pending)) ? Number(pending) : 0;
  if (queued <= 0) return false;
  const dismissed = Number(dismissedAt) || 0;
  if (!dismissed) return true;
  return queued - dismissed >= RESHOW_AFTER_MORE;
}

export function readDismissedAt(storage = safeStorage()) {
  try { return Number(storage?.getItem(DISMISS_KEY)) || 0; } catch { return 0; }
}

export function rememberDismissedAt(value, storage = safeStorage()) {
  try { storage?.setItem(DISMISS_KEY, String(Number(value) || 0)); } catch { /* ignore */ }
}

function safeStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * Ask the browser not to evict this origin under storage pressure. Without it a
 * browser may drop IndexedDB for a site that is not installed, which for a
 * single-user app means the only copy of their records. It is a hint rather than a
 * guarantee, some browsers need a user gesture, and a refusal is normal — so this
 * never throws and never surfaces as an error.
 */
export async function requestPersistentStorage(nav = typeof navigator === 'undefined' ? null : navigator) {
  try {
    if (!nav?.storage?.persist) return false;
    if (await nav.storage.persisted?.()) return true;
    return (await nav.storage.persist()) === true;
  } catch {
    return false;
  }
}
