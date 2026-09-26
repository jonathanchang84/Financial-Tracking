# Financial Dashboard PWA

Offline-first Svelte/Vite financial dashboard. Authentication and sync are owned entirely by a
Cloudflare Worker backed by D1. Supabase is not involved: no Supabase Auth, no RLS, and no mail
provider of any kind.

## Status

- Local source of truth: IndexedDB `financial-health-local` version 2. Everything works offline with
  no account at all.
- Sign-in is optional. When the app API is configured, an account adds cross-device sync. Passwords
  are hashed with PBKDF2-SHA-256 plus a server-side pepper; sessions are opaque `HttpOnly` cookies.
- **Every authentication flow completes in-session.** The app sends no email, so there is no inbox
  to wait on and no third party that can lock you out.
  - Sign up creates a usable, signed-in account immediately.
  - Sign in is email and password.
  - Password recovery proves identity with a secret answer you saved (mother's maiden name, first
    pet's name) and sets a new password in the same session.
  - Email and password changes re-authenticate with the current password, because there is no
    confirmation link.
- **Income streams.** More than one income is normal, so payday is a list rather than a single date: each stream has a
  name and the day of the month it arrives, and exactly one is the **main payday** the runway runs from and to. A
  lone stream becomes the main one automatically, and deleting the main promotes another so the runway never loses
  its anchor. A day that lands on a weekend is brought back to the **Friday before** (income moves *back*; a bill
  that lands on a weekend still moves *forward* to Monday, because a bill cannot be paid early). Streams live in
  the `incomeStreams` setting, so they need no database schema change and travel between devices with everything
  else. An existing single `payday` value is adopted as one stream named "Income" on first load; the old key is
  kept as a fallback so old backups still restore.
- Writes commit to IndexedDB first and are then committed to the database automatically, about a second after
  the change, so there is no sync step to remember. Rapid edits to the same record are coalesced into a single
  request carrying the newest value, which also keeps request counts well below one per keystroke. Offline
  rows stay `pending_sync` until connectivity returns, then push themselves.
- Overview display currency converts figures with the historic fixed rates. Account, holding, and
  pension rows keep their own currency and can be edited or deleted.
- Cash flow uses a daily table plus a lightweight inline runway trajectory, a workbook-style
  current-month paid/unpaid remainder table, and a category doughnut. Safe to Spend is a
  hypothetical daily amount based on the obligations-only balance and the remaining non-payday
  days; it does not reduce Starting or Ending. Saturday and Sunday bill due dates shift to Monday.
- Position, investment, and pension updates append SCD Type 2 snapshots (`validFrom`, `validTo`,
  `currentFlag`) under a stable logical id instead of rewriting history. Pension pots can have
  individual annual growth rates, compounded monthly as `(1 + annual rate)^(1/12) - 1`, and the
  projection can be selected from 1 to 80 calendar years.
- Profile management from the Profile button: change the email address, change the password after
  re-checking the current one, and add/change/delete/verify secret answers. Secret answers are
  normalized and stored only as salted PBKDF2 digests; they cannot be displayed or recovered and are
  not included in local backups or finance sync.

## Scripts

```bash
npm install
npm run setup           # one-off: download Chromium for the browser tests
npm run dev
npm run build
npm run test            # unit tests
npm run test:functional # real end-to-end sign-up / sign-in / recovery
npm run test:browser    # browser smoke tests: renders, metrics, sign-in round trip
npm run validate        # everything above except the browser needs `npm run setup` first
npm run deploy          # validate, then wrangler deploy
npm run checkpoint      # commit the working tree in one deliberate step
```

### Testing

`npm run test` is deliberately dependency-free (`node --test`) and runs in under a second, which is
what makes it cheap enough to sit in a pre-commit hook. It covers the pure logic only.

Two heavier suites cover what unit tests cannot, both against a real local Worker and D1:

- `npm run test:functional` — the API contract: sign-up, sign-in, recovery, sync.
- `npm run test:browser` — Playwright, driving a real browser so IndexedDB, fetch and the service
  worker are exercised. Requires `npm run setup` once, because the ~300 MB Chromium download is not
  part of `npm install`.

CI runs `npm run validate` before deploying, so the shipped build has passed the same gate as a local
one. A tracked pre-commit hook runs the fast unit suite; the full gate is CI's job, because a hook
slow enough to notice gets bypassed.

## Architecture

```text
Browser (static PWA)
  ├─ IndexedDB            local source of truth, works offline
  ├─ /api/auth/*          ──► Cloudflare Worker
  └─ /api/sync/*          ──► Cloudflare Worker ──► D1 (users, sessions, tokens, secrets, rows)
```

No mail provider participates in any flow.

- `worker/index.js` routes `/api/*` and serves the static assets for everything else.
- `worker/auth.js` owns sign-up, sign-in, logout, session lookup, in-session recovery, email change,
  and account secrets.
- `worker/sync.js` pushes and pulls owner-scoped finance rows.
- `worker/support.js` holds session cookies, request parsing, origin checks, and rate limiting.
- `worker/crypto.js` holds password hashing, token generation, and constant-time comparison.
- `worker/rate-limiter.js` is the Durable Object backing per-IP rate limits.
- `migrations/` is the D1 schema.

### Security properties

- Passwords are never stored or logged. Only `PBKDF2-SHA-256` digests with a per-user salt and a
  server-side `AUTH_PEPPER` are persisted.
- Sessions are opaque random tokens; only their SHA-256 hash is stored. The browser gets an
  `HttpOnly`, `SameSite=Lax`, `Secure` cookie and never sees the token in JavaScript.
- Recovery grants are single-use, stored hashed, valid for 15 minutes, and marked consumed on first
  use. Completing a reset revokes every session for that account.
- Secret answers are hashed in the browser and compared as digests, so the plaintext answer never
  reaches the Worker.
- `POST /api/auth/recovery-questions` returns a decoy question with a fresh random salt for unknown
  addresses, so the endpoint cannot be used to discover which email addresses have an account.
- All state-changing API calls are same-origin only; the Worker rejects a mismatched `Origin`.
- Sign-in, sign-up, and recovery attempts are rate limited per client IP by a Durable Object.
- `AUTH_PEPPER` is the only Worker secret. There is no mail API key to leak.

## Setup

### 1. Install and build

```bash
cd financial-dashboard-pwa
npm ci
npm run build
```

### 2. Create the database

```bash
npx wrangler login
npx wrangler d1 create financial-tracking
```

Copy the printed `database_id` into the `[[d1_databases]]` block in `wrangler.toml`, then apply the
schema:

```bash
npx wrangler d1 migrations apply financial-tracking --remote
```

### 3. Set the one secret

```bash
npx wrangler secret put AUTH_PEPPER     # generate with: openssl rand -base64 48
```

`APP_URL`, `AUTH_APP_NAME` and `RATE_LIMIT_ALLOWLIST` are plain vars in `wrangler.toml`.

`RATE_LIMIT_ALLOWLIST` is a comma separated list of client IPs that skip auth rate limiting, so a flaky
line or a proxy retry loop cannot lock you out of your own app. Edit the var and redeploy when your
address changes. Addresses are matched against the Cloudflare-supplied `CF-Connecting-IP`, so an entry
does nothing unless the request arrives through the Cloudflare edge, and a forged `X-Forwarded-For`
cannot claim the exemption. Leave it empty to rate limit everyone.

IPv4 and IPv6 may be mixed in the same list. IPv6 entries are compared by value rather than as text,
so hex case (`2A00:...` vs `2a00:...`) and `::` zero compression do not affect whether an address
matches, and an IPv4-mapped `::ffff:1.2.3.4` is treated as `1.2.3.4`. Only exact addresses are listed —
there is no CIDR support, so a whole subnet cannot be exempted by accident.

### 4. Deploy

```bash
npm run deploy        # runs the full gate first, then wrangler deploy
```

The deployment serves hashed files from `dist/assets` with single-page-application fallback. For a
local Workers preview use `npx wrangler dev`, and for a static preview of the build use
`npm run preview`.


## Account management

- **Sign up** creates the account and signs you in at once. Nothing to confirm.
- **Sign in** is email and password. A wrong password returns `401`, never `500`.
- **Forgot password** asks for the email, returns the secret questions saved on that account, then
  asks for one answer. A correct answer issues a short-lived recovery grant that sets the new
  password immediately. **An account with no secret answers cannot be recovered** — add at least one
  from Profile as soon as you sign up.
- **Secret answers** are security metadata, not encryption. They cannot be displayed or recovered,
  and a low-entropy answer could be guessed by someone who obtains the database. Prefer an answer
  you would not easily find on social media.
- **Email changes** require the current password, because there is no confirmation email to click.
- **Existing Supabase accounts do not carry over.** Password hashes cannot be migrated between two
  different authentication systems, so a previous Supabase account must be created again here. Data
  that only ever existed in the old Supabase tables is not imported either.

## Functional test

`scripts/functional-test.mjs` starts its own `wrangler dev` on port 8788 against **local** D1, so it
never touches the deployed site or the production database, and it cleans up the process and its
temporary `.dev.vars` afterwards. It covers the flows unit tests cannot prove:

1. **Sign up as a new user** — the account is created and a session issued, with no confirmation.
2. **Sign in as an existing user** — a wrong password is `401`, the right one returns a session, the
   session authenticates a protected sync push/pull, and signing out revokes it.
3. **Recover a password in-session** — save a secret, prove it, consume a single-use grant, and
   confirm the old password stops working while the new one works. It also asserts the removed
   emailed-reset route is genuinely `404`, and that an unknown email address is indistinguishable
   from one with no secrets.

The account is a fresh random address each run, so a repeat cannot pass via the duplicate path.
Because it runs in the real Workers runtime, it catches what Node unit tests miss: Cloudflare's
PBKDF2 iteration ceiling, a Durable Object rate limit, or a missing binding.

```bash
# Verify a live origin (creates a real account and spends a rate-limit slot)
FT_BASE_URL=https://financial-tracking.jonathanchang84.workers.dev npm run test:functional
```

An external run stops after sign-up. A Cloudflare edge rate limit is detected and reported as an
upstream block rather than an application failure.

## Troubleshooting

Run `curl -s <your-app-origin>/api/health` first. It returns `{"ok":true}`.

- **"The sign-in service hit an internal error." (HTTP 500).** The deployed Worker is an older build.
  Compare the bundle referenced by the live `index.html` against a fresh `npm run build`: the
  `assets/index-*.js` filename must match. A current build's health response is exactly
  `{"ok":true}` — a `mail` key means an old pre-email-removal build is still deployed.
- **Sign-up says the account already exists.** That address is already in the Worker's D1 database.
  Sign in instead, or use in-session recovery.
- **Recovery says no questions are available.** The account has no secret answers saved, so it
  cannot be recovered by answer. This is the trade-off of sending no email: recovery depends on a
  secret you set up in advance.
- **Everything is rejected with 401.** The session cookie is missing or expired. Cookies are
  `Secure`, so plain `http://` on a non-localhost host will not store them.
- **API calls fail with a network error.** The service worker never caches `/api/*`. If the Worker
  is not deployed alongside the app, the API origin is unreachable; deploy it or set `VITE_API_URL`.
- **Requests rejected with 403 `origin_denied`.** The browser origin does not match the Worker's
  `APP_URL`. Update the var in `wrangler.toml` and redeploy.
- **A password reset link from an older build no longer works.** Reset-by-link was removed. Use
  in-session recovery with a secret answer instead.
