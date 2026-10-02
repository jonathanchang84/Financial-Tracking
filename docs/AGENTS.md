# Working in this repository

Read this first. It is the part of the context that is easy to get wrong and expensive
to discover — a session ending does not lose it, because it lives in the repo.

**Planned work is in [`docs/BACKLOG.md`](BACKLOG.md).** Read that before starting
anything. If you are about to do work that is not there, either it is unplanned (agree
it first) or you have found something new (add it).

---

## What this repository actually is

Two products share this repository:

| Path | What it is |
|------|------------|
| `financial-dashboard-pwa/` | **The live app.** A Svelte 5 local-first PWA served by a Cloudflare **Worker**. |
| `Sources/`, `Package.swift`, `Financial Tracking.xcodeproj` | A native Apple app (SwiftUI). |
| `pwa/` | A superseded vanilla-JS prototype. **Not deployed.** See D2 / Q4. |

## The Worker is not Cloudflare Pages  (D3)

This is the single most expensive mistake available here.

- `wrangler.toml` → `main = "worker/index.js"`, plus **D1** and a **Durable Object**
  (the auth rate limiter). `run_worker_first = ["/api/*"]` routes the API through the
  Worker and everything else to the asset server.
- Routes live in `worker/index.js` → `worker/auth.js`, `worker/sync.js`,
  `worker/support.js`, `worker/crypto.js`, `worker/limits.js`, `worker/rate-limiter.js`.
- There is **no `functions/` directory**. Pages Functions are not used.
- `public/` holds four files — `_headers`, `icon.svg`, `manifest.webmanifest`, `sw.js`.
  It is not a deployable site.

```bash
# Correct
npx wrangler deploy

# Wrong — publishes four files and breaks the site
npx wrangler pages deploy ./public
```

## Commands

All from `financial-dashboard-pwa/`:

```bash
npm test              # unit, node --test
npm run build         # vite build -> dist/
npm run test:functional
npm run test:browser  # playwright; needs `npm run setup` once
npm run validate      # all four, in the order CI runs them
npm run deploy        # validate && wrangler deploy
```

`npm run deploy` is the gated manual path. A broken CI credential costs the
**automatic trigger**, not the gates  (D4).

## Conventions

- **Svelte 5 runes** — `$state`, `$derived`, `$props`. Not the legacy `export let`.
- **Services are pure and injectable** so `node --test` can import them without a
  browser. `syncEngine.js` cannot be tested this way because it pulls in
  `svelte/store` and `import.meta.env` — that is why `dataSafety.js` exists separately.
- **Comments explain why, not what.** The house style is a block comment stating the
  reasoning, often including the bug that motivated it. Match it.
- **The Worker never trusts the client** — origin checks, per-IP rate limits, hashed
  tokens, same-origin only for state-changing calls.
- **Money is never rounded for display**, and an absent value renders as an em-dash
  rather than a zero, because a zero claims a balance was nil.

## Landmines

Each of these has already cost time. Check here before concluding something is broken.

- **CI has failed six consecutive runs** (`6beb7b5` → `54d2da4`). The deploy step
  cannot authenticate — the `CLOUDFLARE_API_TOKEN` secret needs attention (**C1**).
  Local `wrangler whoami` works, so `npx wrangler deploy` succeeds from this machine.
  **A push does not mean production has it** — see C2, which fixes the observability.
- **`gh` is not installed** and there is no `GH_TOKEN`/`GITHUB_TOKEN`. The GitHub REST
  API is readable unauthenticated (runs, commits); anything that writes is not.
- **CI logs return 403** without auth, so a failing step cannot be diagnosed from the
  public API — only the step name and conclusion.
- **A local wrangler dev server may already be running**, and starting another fails
  with `bind(): Address already in use`. Harmless; it retries.
- **Svelte 5 deprecation warnings during build are expected** and are not failures.
  Read the exit status, not the noise.
- **`Financial Tracking.xcodeproj` generates build artefacts** into `DerivedData/` and
  `.build/`. Searching the repo root without excluding those returns megabytes of
  binary. Always scope a search to `financial-dashboard-pwa/`.

## If you are resuming after a break

1. Read `docs/BACKLOG.md`. Its **Where to start** section names the next item.
2. `git log --oneline -10` — commit messages here carry the *reasoning*, not just the
   change, so they reconstruct most decisions on their own.
3. Check the deployed build before trusting a claim about production:
   ```bash
   curl -s https://financial-tracking.jonathanchang84.workers.dev/api/health
   ```
   Today this returns `{"ok":true}` with **no build id**, which is why "is production
   running main?" cannot currently be answered. That is **C2**, and it is the first
   thing to build if you need that answer.
4. Take the lowest unblocked ID in the lowest-numbered epic.