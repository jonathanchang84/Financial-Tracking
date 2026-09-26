/**
 * Authentication rate-limit policy, in one place.
 *
 * These used to be literals at each of seven call sites, so tuning a route meant
 * finding the right line. They are deliberately *not* configurable through `env`:
 * the flexibility that actually matters — "stop locking me out" — is already
 * provided by RATE_LIMIT_ALLOWLIST, and putting a fixed policy behind config
 * parsing would only add a failure mode for values that do not change.
 *
 * `signup` is looser than the credential routes because creating an account is
 * not a credential guess; anything that takes an existing password is held to the
 * tighter 10 per 15 minutes.
 */
export const AUTH_LIMITS = {
  signup: { attempts: 20, windowSeconds: 3600 },
  signin: { attempts: 10, windowSeconds: 900 },
  'recovery-questions': { attempts: 10, windowSeconds: 900 },
  recover: { attempts: 10, windowSeconds: 900 },
  'reset-password': { attempts: 10, windowSeconds: 900 },
  'change-password': { attempts: 10, windowSeconds: 900 },
  'email-change': { attempts: 10, windowSeconds: 900 }
};

/** The tightest policy, used for an unknown route so a typo fails closed. */
const FALLBACK = { attempts: 10, windowSeconds: 900 };

export function limitFor(bucket) {
  return Object.prototype.hasOwnProperty.call(AUTH_LIMITS, bucket) ? AUTH_LIMITS[bucket] : FALLBACK;
}
