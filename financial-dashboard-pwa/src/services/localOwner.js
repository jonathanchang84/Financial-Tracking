/**
 * Which account owns the local IndexedDB data.
 *
 * IndexedDB belongs to the browser profile, not to the account. Signing out only
 * revoked the server session, so the rows stayed on the device: on a shared
 * profile the next person to sign in saw the previous account's data, and any
 * row still marked `pending_sync` was pushed into their account on its own
 * authenticated session, where it looks entirely legitimate.
 *
 * Dependency-injected and separate so it can be unit tested — `syncEngine.js`
 * pulls in `svelte/store` and `import.meta.env` and cannot be imported by
 * `node --test` (see `tests/localOwner.test.js`).
 */

export const LOCAL_OWNER_KEY = 'fh-app-local-owner';

function browserStorage() {
  try {
    // Touching localStorage throws outright when storage is disabled by policy.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createLocalOwner(storage = browserStorage()) {
  const read = () => {
    try { return storage?.getItem(LOCAL_OWNER_KEY) || ''; } catch { return ''; }
  };
  const write = (id) => {
    try { storage?.setItem(LOCAL_OWNER_KEY, id); } catch { /* storage may be disabled */ }
  };

  return {
    /** Account id recorded as owning the local data, or '' when unknown. */
    read,

    /**
     * Record `userId` as the owner and report whether the local data may be kept.
     * `false` means it belonged to a *different* account, so it must be cleared
     * before anything is flushed or those rows would be attributed to this user.
     */
    claim(userId) {
      const id = String(userId || '');
      if (!id) return true;
      const previous = read();
      if (previous && previous !== id) return false;
      if (!previous) write(id);
      return true;
    },

    /**
     * Only for an explicit user-driven wipe. Signing out must NOT call this: the
     * marker is the only record of who owns the local data, and losing it on
     * sign-out is exactly what lets the next account inherit that data.
     */
    forget() {
      try { storage?.removeItem(LOCAL_OWNER_KEY); } catch { /* ignore */ }
    }
  };
}
