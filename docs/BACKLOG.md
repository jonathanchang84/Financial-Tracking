# Financial Tracking — Backlog

Everything we intend to build, why we want it, and what we have already decided.

Written 2026-10-01. **This file is the source of truth for planned work.** If it is
not here it is not planned; if it is here and unticked it is owed. It is updated in
the same commit as the code it describes, because a backlog that lags the repository
is worse than none — it lies with confidence.

## How to use this file

- **Epic** — a body of work with a goal and a reason it exists. Carries its own
  context, the decisions it depends on, and what is deliberately out of scope.
- **Story** — `AS A … I WANT … SO THAT …`. The unit we pick up and finish.
- **Acceptance criteria** — `GIVEN … WHEN … THEN …`. A box is only ticked when the
  thing it names is verifiably true, which in this repo usually means a test.

**How to pick the next item:** the lowest unblocked ID in the lowest-numbered epic.
If an item is blocked, take the next one and write down why it is blocked.

## Status

| Epic | Goal | Status |
|------|------|--------|
| **A** | Fault handling | not started |
| **B** | Diagnostics & information | not started |
| **C** | Deploy reliability | ⛔ blocked on C1 — needs a human |
| **D** | Housekeeping | not started |
| **E** | Conversational navigation | not started |
| **F** | Conversational execution | 🔴 deferred — highest risk |

---

## EPIC A — Fault handling

**Goal** — When something breaks, the app tells the user what broke and what to do
about it, and the owner can see what broke, when, its nature, and which user hit it.

**Why** — as of 2026-10-01:

- An error reaches the user as a bare string with no code they can quote back.
- `friendlyAuthError()` in `src/services/authErrors.js` covers about 10 of the 22
  codes `worker/` throws; the other 12 fall through to the raw server string.
- Validation failures in `src/services/commands.js` throw a bare `Error`, no code.
- The owner sees only an ephemeral Cloudflare log line, with no user attribution.
- Local IndexedDB and offline failures never reach the Worker at all.

**Decisions** — D5, D6, D7, D8
**Out of scope** — A5 (operator admin needs its own permission model and review)
**Open questions** — none in this epic
**Dependency** — **A1 is the critical path.** The log needs `area`/`severity` to be
real fields, the user-facing copy needs the entries, and B2's error reference page
renders straight from them.

### A1 — One error catalogue, shared by both runtimes

**As a** developer adding an error,
**I want** one catalogue of codes,
**so that** the code the Worker throws and the copy the user reads can never disagree.

**Acceptance criteria**

- [ ] **Given** a catalogue entry, **when** `worker/support.js` throws an `AppError`, **then** its status and default message come from that entry.
- [ ] **Given** `worker/*.js`, **when** the suite scans for `new AppError(...)`, **then** every code is present and every status matches, or the test fails.
- [ ] **Given** an import from the Worker, the client or the test runner, **when** it is bundled, **then** it resolves with no build configuration change.
- [ ] **Given** a code, **when** the client resolves it, **then** it yields a title, a plain-English line, and a next action.

### A2 — Admin-visible error log

**As the** app owner,
**I want** to see what error happened, when, its nature, and which user hit it,
**so that** I can support a report without asking the user to guess.

**Acceptance criteria**

- [ ] **Given** `migrations/0005_error_events.sql`, **when** it is applied, **then** `error_events` exists with a `fingerprint` primary key plus `first_seen_at`, `last_seen_at`, `occurrences`, `code`, `area`, `severity`, `status`, `route`, `method`, `user_id`, `error_name`, `build`.
- [ ] **Given** any request that errors, **when** `errorResponse()` runs, **then** an event is recorded, with the user resolved where one exists.
- [ ] **Given** a log write that fails, **when** the response is built, **then** the original status and body are returned unchanged.
- [ ] **Given** an error, **when** it is stored, **then** no message, body, header, cookie, token or email is persisted.
- [ ] **Given** the same error twice, **when** the second occurs, **then** `occurrences` increments rather than a second row appearing.
- [ ] **Given** an event older than 30 days, **when** the cron trigger runs, **then** it is pruned.
- [ ] **Given** a deleted account, **when** the rows are examined, **then** `user_id` is null rather than orphaned.

### A3 — Codes visible to users

**As a** user who hit a problem,
**I want** to be told what went wrong and what to do about it in plain English,
**so that** I can fix it myself instead of reporting that "it broke".

**Acceptance criteria**

- [ ] **Given** any of the 22 codes, **when** the client receives it, **then** it produces user copy rather than the raw server string.
- [ ] **Given** an unrecognised code, **when** it is resolved, **then** the raw message is shown unchanged rather than a blank.
- [ ] **Given** a Cloudflare edge block that answers with HTML, **when** it cannot be parsed, **then** the existing generic copy still applies.
- [ ] **Given** any error toast, **when** it is rendered, **then** the code is visible and copyable.
- [ ] **Given** a boot failure, **when** the panel is shown, **then** it carries the resolved copy and code.
- [ ] **Given** the last errors in a session, **when** the tab is reloaded, **then** they are still readable, so a failure can be investigated after the fact.

### A4 — Extract the balance write path into a service

**As a** developer,
**I want** the balance write semantics in a tested service rather than inline in a component,
**so that** every caller enforces the same past/today/future rules.

**Why** — `CashFlow.svelte:150-176` implements three genuinely different operations:
a past date writes history only ("a backfill must never move today's balance"), today
writes both, and a future date is rejected outright. Two commits exist solely to get
this right (`a5c7e1e`, `93213fd`). The logic is currently unreachable from anywhere
else, and `balanceHistory.js` exports read helpers only.

**Acceptance criteria**

- [ ] **Given** a past date, **when** a balance is written, **then** history is updated and the current balance is not.
- [ ] **Given** today, **when** a balance is written, **then** both the record and the current balance are updated together.
- [ ] **Given** a future date, **when** a balance is written, **then** it is rejected and nothing is stored.
- [ ] **Given** the component, **when** it is refactored, **then** it calls the service and holds no write logic of its own.

### A5 — Operator admin console  ⛔ held for separate review

**As the** app owner,
**I want** to browse the error log and manage accounts from the app,
**so that** I can service the app without the database or a deploy.

**Why held** — this is a new permission surface. It needs a role model, a decision
on how the first admin is bootstrapped without creating an obvious escalation path,
how an admin is demoted, and whether an audit log is legally required.

**Acceptance criteria**

- [ ] **Given** an unauthenticated request, **when** it calls `/api/admin/*`, **then** it is rejected.
- [ ] **Given** an authenticated non-admin, **when** it calls `/api/admin/*`, **then** it is rejected.
- [ ] **Given** an admin, **when** they list errors, **then** they can filter by code, area, user and time range.
- [ ] **Given** an exported error list, **when** it is serialised, **then** it contains no stored message or credential material.

---

## EPIC B — Diagnostics & information

**Goal** — The app explains itself: what it thinks is happening, what every word on
screen means, and what to do about an error — without leaving the app or reading the README.

**Why** — the only documentation is `README.md`, which is written for a developer and
explicitly covers internals the user does not need. It cannot be reached from the UI.
`App.svelte` routes by hash, so a new screen is cheap.

**Decisions** — D17 (the assistant is a router, not an actor)
**Out of scope** — a helpdesk, contact forms, telemetry
**Open questions** — Q1 (glossary scope)

### B1 — System status and diagnostics

**As a** user with something wrong,
**I want** to see what the app thinks its state is,
**so that** I can report the problem accurately instead of describing a symptom.

**Acceptance criteria**

- [ ] **Given** the app running, **when** the status screen is opened, **then** it shows the build id, the service-worker build id, and whether they agree.
- [ ] **Given** a sync engine, **when** the screen is rendered, **then** it shows status, pending count, and the time of the last successful sync.
- [ ] **Given** a browser that can report storage, **when** the screen is rendered, **then** it shows usage, quota and whether storage is persistent.
- [ ] **Given** a signed-out user, **when** the screen is rendered, **then** it says so plainly rather than showing zeros.
- [ ] **Given** the status screen, **when** the copy action is used, **then** it produces a plain-text report suitable for pasting into a bug report.
- [ ] **Given** the re-sync action, **when** it is triggered, **then** it is confirmed first and reports what it did.

### B2 — Information page: glossary, FAQs, error reference

**As a** user,
**I want** to look up what a term means or how something works,
**so that** I do not have to guess at the numbers on my own balance.

**Acceptance criteria**

- [ ] **Given** the app, **when** the information view is opened, **then** it is reachable by hash and renders with no network call.
- [ ] **Given** a search term, **when** it is typed, **then** glossary terms, FAQ entries and error codes are all searched.
- [ ] **Given** the error reference, **when** it is rendered, **then** every catalogue code from A1 appears, so it cannot go stale.
- [ ] **Given** a glossary term, **when** it is opened, **then** it carries a short definition and a fuller explanation.
- [ ] **Given** an offline device, **when** the page is opened, **then** it still renders, because the content is compiled into the bundle.
- [ ] **Given** the content modules, **when** the suite runs, **then** a term or answer that is empty fails the test.

---

## EPIC C — Deploy reliability

**Goal** — Production provably runs `main`, and it is visible when it does not.

**Why** — six consecutive GitHub Actions runs have failed (`6beb7b5` → `54d2da4`).
Local `wrangler whoami` is valid and `npx wrangler deploy` works, so **production has
advanced only through manual deploys from one machine**. `GET /api/health` returns
`{"ok":true}` with no build identifier, so there is no way to tell from outside which
commit is deployed. Repo and production can diverge invisibly, indefinitely.

**Decisions** — D3, D4
**Out of scope** — migrating to Cloudflare Pages (see D3), a multi-environment setup
**Open questions** — Q2 (CI versus `npm run deploy` as the standing rule)

### C1 — Repair the CI Cloudflare credential  ⛔ needs a human

**As the** app owner,
**I want** the deploy step to authenticate,
**so that** pushing to `main` ships the app without me being at the machine.

**Why it needs a human** — the token lives in GitHub Actions secrets. No agent can
reach it, and `gh` is not installed on this machine.

**Acceptance criteria**

- [ ] **Given** a Cloudflare API token with Workers Scripts Edit and D1 Edit, **when** it is stored as `CLOUDFLARE_API_TOKEN`, **then** the workflow's deploy step authenticates. (`account_id` is already in `wrangler.toml`.)
- [ ] **Given** a repaired credential, **when** the workflow is re-run, **then** it reaches `success` and the live asset hash matches a fresh `npm run build`.
- [ ] **Given** any future deploy failure, **when** it is read, **then** the cause is diagnosable from the run summary rather than a bare 401.

### C2 — Report the deployed build from `/api/health`

**As an** agent or user picking this repo up cold,
**I want** to tell from one `curl` whether production is running `main`,
**so that** drift is visible even when CI is broken.

**Acceptance criteria**

- [ ] **Given** a deployed Worker, **when** `GET /api/health` is called, **then** it returns `{"ok":true,"build":"findash-v14"}`.
- [ ] **Given** a build that cannot be determined, **when** health is called, **then** the key is omitted rather than the request failing.
- [ ] **Given** the health route, **when** the suite runs, **then** the response shape is asserted.

### C3 — Plumb the build id into the Worker

**As a** developer,
**I want** the Worker's build id generated from the same source as the bundle's,
**so that** the version reported is never a second, drifting copy.

**Why** — `VERSION` lives in `public/sw.js`. `vite.config.js` already reads it and
injects `VITE_BUILD_ID` into the client bundle, so the rule "one source" is already
established here; the Worker simply is not wired into it.

**Acceptance criteria**

- [ ] **Given** `public/sw.js`, **when** the Worker is built, **then** its build id is generated from `VERSION` rather than hand-maintained.
- [ ] **Given** the bundle and the Worker, **when** both report a build, **then** the values are identical.
- [ ] **Given** a changed `VERSION`, **when** the app builds, **then** both change together.

### C4 — Deployment drift alarm

**As the** app owner,
**I want** to be told when production has fallen behind `main`,
**so that** a broken pipeline does not go unnoticed for weeks.

**Acceptance criteria**

- [ ] **Given** the health endpoint, **when** a scheduled job runs, **then** it compares the reported build to `public/sw.js` `VERSION`.
- [ ] **Given** a mismatch, **when** the job runs, **then** it fails visibly rather than passing quietly.
- [ ] **Given** a match, **when** the job runs, **then** it passes and writes nothing.

---

## EPIC D — Housekeeping

**Goal** — Remove the small things that mislead, now that they are known.

**Decisions** — none
**Out of scope** — refactoring that is not tied to a known problem
**Open questions** — Q1 (glossary scope), Q4 (whether to keep the legacy prototype)

### D1 — The PWA README describes a retired cycle model

**As a** developer,
**I want** the README to describe how the cycle actually works now,
**so that** I am not misled by documentation that predates `3cf6ba9`.

**Acceptance criteria**

- [ ] **Given** `financial-dashboard-pwa/README.md`, **when** the cycle paragraph is read, **then** it matches the current behaviour, including the weekday-shift and the reserve being measured from today.

### D2 — Legacy `pwa/` prototype directory

**As a** developer,
**I want** the superseded prototype either removed or clearly marked,
**so that** I do not edit or deploy the wrong app.

**Acceptance criteria**

- [ ] **Given** the repository root, **when** a new contributor looks for the app, **then** `financial-dashboard-pwa/` is unambiguously identified as the live one.
- [ ] **Given** the decision, **when** it is recorded, **then** the `pwa/` directory is either deleted or carries a header saying it is superseded.

### D3 — CI browser smoke flakiness

**As a** developer,
**I want** the browser suite to fail only for real reasons,
**so that** a genuine regression is not lost in noise.

**Acceptance criteria**

- [ ] **Given** repeated CI runs of an unchanged commit, **when** the browser suite runs, **then** it does not fail intermittently.

### D4 — The "Ending reads low" caveat

**As a** user who entered today's balance after paying a bill,
**I want** the app to explain why today's ending is below my bank balance,
**so that** I do not think the figures are wrong.

**Acceptance criteria**

- [ ] **Given** a recorded balance for today that already accounts for bills due today, **when** the ending is shown, **then** the explanation is available in the information page.
- [ ] **Given** a bill ticked paid for an occurrence due today, **when** the row is shown, **then** it still charges, and the reason is documented.

---

## EPIC E — Conversational navigation

**Goal** — The user speaks or types what they want to do, and the app takes them to the
right screen with the right field focused and pre-filled. The user presses the button.

**Why** — "set my available balance to X" means typing into a form on a phone. The
model's whole job is to find the right form. It never writes anything, so it cannot
corrupt anything, and a mistake costs nothing but closing a panel.

**This is the deliberate shape:** the assistant is a **router, not an actor**.

**Decisions** — D14, D15, D18, D19, D21
**Out of scope** — anything that writes, deletes or clears (see EPIC F)
**Open questions** — Q3 (which providers, and what may leave the device)

### E1 — Provider rotation across free tiers

**As the** app owner,
**I want** the assistant to fail over between providers per request,
**so that** a rate limit or outage on one does not take the feature down.

**Why rotation belongs here** — each request is independent and stateless, so failing
over carries nothing across. This is exactly where rotation pays; it does not help a
developer conversation, where the next model inherits no context.

**Acceptance criteria**

- [ ] **Given** a provider that fails or rate-limits, **when** a request is made, **then** the next provider in the chain is tried without the user doing anything.
- [ ] **Given** all providers exhausted, **when** the final attempt fails, **then** the user is told plainly rather than left waiting.
- [ ] **Given** a successful failover, **when** it is rendered, **then** the answer is identical in substance — rotation changes the plumbing, never the facts.
- [ ] **Given** the chain, **when** it is defined, **then** it is a single ordered list that can be tested without calling any provider.

### E2 — Answer questions the app already computes

**As a** user,
**I want** to ask why a figure is what it is,
**so that** I understand my own runway.

**Why** — most questions are already pure functions: `runwayPlanner`,
`currentMonthExpenses`, `wealth`, `income`. The app computes; the model only words it.

**Acceptance criteria**

- [ ] **Given** a question about a figure, **when** it is asked, **then** the numbers in the answer are produced by the app's own code, never by the model.
- [ ] **Given** an answer, **when** it is rendered, **then** every figure in it appears in the app's computed output; anything else fails the test.
- [ ] **Given** a question the app cannot answer, **when** it is asked, **then** the assistant says so rather than improvising.

### E3 — Navigate to the balance form and pre-fill

**As a** user,
**I want** to say "set my available balance to 1758.04" and land on that form,
**so that** I do not hunt for it.

**Why** — the balance save has three distinct meanings (history-only backfill, today,
and a rejected future date). The assistant does not choose between them: it lands on
the real form, which already asks correctly.

**Acceptance criteria**

- [ ] **Given** the intent "set my balance", **when** it is resolved, **then** the app navigates to the cash-flow screen with the balance field focused and the amount pre-filled.
- [ ] **Given** a pre-filled amount, **when** it is shown, **then** it is visible and editable before anything is saved.
- [ ] **Given** a past, today or future date, **when** the user submits the form, **then** the existing `CashFlow.svelte` rules decide the outcome unchanged.

### E4 — Navigate to the other record forms and pre-fill

**As a** user,
**I want** to say "log 42 pounds of groceries yesterday" and land on that form,
**so that** I can add a record by voice or text.

**Acceptance criteria**

- [ ] **Given** the intent "log a spend", "add a spend item" or "add a bill", **when** it is resolved, **then** the app navigates to the matching form with the relevant fields pre-filled.
- [ ] **Given** the assistant, **when** it lists what it can navigate to, **then** that list is the complete set defined in the capability registry.
- [ ] **Given** a capability registry, **when** it is reviewed, **then** it contains no destructive entry — deletes, `clearLocalData` and `restoreBackup` are absent by construction.

### E5 — Honest degradation

**As a** user,
**I want** to be told when the assistant cannot help,
**so that** I do not wait on something that is never going to answer.

**Acceptance criteria**

- [ ] **Given** no connection, **when** the assistant is used, **then** it says the feature needs a connection, and the rest of the app keeps working.
- [ ] **Given** a quota exhaustion, **when** the assistant is used, **then** it is reported as a quota limit rather than an outage.
- [ ] **Given** the assistant is unavailable, **when** a user asks for something, **then** the normal navigation still works.

### E6 — Assistant failures become catalogue codes

**As a** developer,
**I want** assistant failures in the same catalogue as everything else,
**so that** they get the same copy and the same log.

**Acceptance criteria**

- [ ] **Given** an assistant failure, **when** it is reported, **then** it carries a code such as `llm_unavailable` or `llm_rate_limited` from A1.
- [ ] **Given** a provider that returns an error, **when** it is surfaced, **then** the provider is not named in user-facing copy unless it helps the user act.

### E7 — Voice input

**As a** user on a phone,
**I want** to speak rather than type a balance into a form,
**so that** capturing it costs almost nothing.

**Why promoted** — this was deferred while voice had no purpose beyond convenience.
Given E3 and E4, typing a figure into a small form on a phone is precisely the friction
voice removes. `webkitSpeechRecognition` and `speechSynthesis` are browser-native and
need no key and no third party.

**Acceptance criteria**

- [ ] **Given** a supporting browser, **when** voice is started, **then** the transcript appears as editable text before anything is acted on.
- [ ] **Given** a browser without speech recognition, **when** the control is shown, **then** it is hidden or disabled with an explanation rather than failing.
- [ ] **Given** voice is used, **when** no provider credentials exist, **then** speech-to-text still works locally and only the interpretation needs a provider.
- [ ] **Given** transcribed text, **when** it is displayed, **then** it is shown before use, never acted on silently.

---

## EPIC F — Conversational execution  🔴 deferred

**Goal** — The assistant may propose a change that the app then validates, shows, and
applies only after the user confirms.

**Why deferred** — this is where the model acts rather than navigates, and therefore
where the risk lives. It stays a separate epic so EPIC E can ship on its own and be
genuinely useful without it.

**Decisions** — D17, D20
**Open questions** — Q3

### F1 — Typed action proposal

**As a** user,
**I want** to see exactly what will change before it changes,
**so that** an interpreted instruction cannot quietly do something else.

**Acceptance criteria**

- [ ] **Given** an instruction the app can act on, **when** it is interpreted, **then** the result is a typed proposal the app validates against its own rules.
- [ ] **Given** a proposal the app cannot validate, **when** it is produced, **then** it is rejected rather than guessed at.
- [ ] **Given** a parsed figure, **when** it is proposed, **then** the app echoes it back exactly, because `1758.04` and `175.04` differ by one word.

### F2 — Confirmed writes

**As a** user,
**I want** changes applied only when I approve them,
**so that** the assistant never writes on its own.

**Acceptance criteria**

- [ ] **Given** a validated proposal, **when** the user approves, **then** the write goes through the same service the form uses.
- [ ] **Given** a proposal the user does not approve, **when** they dismiss it, **then** nothing is written and no state changes.

### F3 — Audit trail for assistant actions

**As the** app owner,
**I want** to see what the assistant did and when,
**so that** an unexpected change is traceable.

**Acceptance criteria**

- [ ] **Given** an assistant-initiated write, **when** it completes, **then** an entry is recorded in the same trail as A2's errors.
- [ ] **Given** a rejected proposal, **when** it is discarded, **then** that is also recorded.

### F4 — Free-form queries over raw records  ⛔ open question

**As a** user,
**I want** to ask anything about my data in my own words,
**so that** I do not have to learn the shape of the app.

**Why blocked** — the only item that would send raw balances, bills and holdings to a
third-party provider. It cannot be built until Q3 is answered.

**Acceptance criteria**

- [ ] **Given** an explicit decision on what may leave the device, **when** the feature is built, **then** the boundary is enforced in code and covered by tests.

---

# Decisions

Settled. Referenced by the epics above so they cannot contradict each other. A decision
is not quietly reopened — it is amended with a dated note, so the history survives.

| # | Decision | Why |
|---|----------|-----|
| **D1** | A paid marker clears only occurrences *strictly ahead* of today. Today and the past are committed. | Shipped in `54d2da4`. Ticking a bill due today had zeroed its row and inflated Safe to Spend by the amount that went missing. |
| **D2** | Column order: *Projected cumulative safe spend* before *Spend Items*. | Shipped in `54d2da4`. Groups the two hypothetical budget figures and puts real money-out beside Ending. |
| **D3** | This is a **Cloudflare Workers** app. Do not migrate to Pages. | `wrangler.toml` has `main = "worker/index.js"` plus D1 and a Durable Object. `npx wrangler pages deploy ./public` would publish four files and a broken site. |
| **D4** | Manual deploys are **not** ungated: `npm run deploy` is `validate` + `wrangler deploy`. | So the broken CI credential costs the automatic trigger, not the gates. |
| **D5** | The error log **never** stores messages, bodies, headers, cookies, tokens or emails. Code and fingerprint only. | Personal financial data. `invalid_credentials` says everything needed without persisting the attempted email. |
| **D6** | The log aggregates by fingerprint with an occurrence counter, not one row per error. | A hammered endpoint cannot flood the table, and "4,200 times since Tuesday" is the answer an admin actually wants. |
| **D7** | A failed log write must never change the response status or body. | Logging must not turn a 400 into a 500. |
| **D8** | The catalogue is authoritative for code and status; message text stays free-form at throw sites. | Accepted tradeoff — several messages interpolate (`Send at most ${MAX_PUSH_ROWS} rows`). |
| **D9** | Operator admin is deferred to its own review. | A new permission surface needing a role model, bootstrap and demotion decisions. |
| **D10** | The assistant never sees raw records. | Would egress balances, bills and holdings to third parties. Revisit via Q3. |
| **D11** | Client→server error reporting is deferred. | A free-text write channel into a finance store is an abuse surface. If reopened: whitelisted codes only, no message, rate limited. |
| **D12** | The backlog lives in the repo, not GitHub Issues. | No `gh` and no token here; a repo file is also readable by any agent at the start of a session. |
| **D13** | Epics, not tracks. Deferred ideas are decisions, not epics. | An epic is work to be delivered; "we decided not to" is not. |
| **D14** | The app computes; the model only words it. | Keeps a model out of arithmetic on real money, and makes correctness testable. |
| **D15** | Rotation is a per-request, stateless concern in the app. | Unlike a developer conversation, nothing needs carrying across a failover. |
| **D16** | Egress is limited to intent plus figures already on screen. | Pending Q3. |
| **D17** | The assistant never writes. It proposes; the app validates, shows, and executes only after confirmation. | The model never touches IndexedDB. Keeps the surface a reviewable function-calling layer. |
| **D18** | Ambiguity is resolved by asking, never guessing. | `CashFlow.svelte` has three distinct balance-write meanings; two commits exist solely to get this right. |
| **D19** | Destructive operations are unreachable by the assistant. | Satisfied structurally by the capability registry rather than by policy. `confirmDelete` uses `window.confirm`, unusable for an agent. |
| **D20** | Assistant actions are audited in the same trail as errors. | An unexpected change must be traceable. |
| **D21** | The assistant may only navigate to and pre-fill actions in the capability registry; the registry is the complete allowlist. | The security boundary is enumerable, reviewable and testable without a model. |

---

# Open questions

Not decided. Each needs an answer from the owner before the dependent work starts.

### Q1 — Glossary scope
Should the information page cover **the PWA only**, or **the PWA and the Apple app**?
The root README already has *Feature Guide* and *Privacy and Limitations* sections that
are usable source wording either way. Blocks the content of B2.

### Q2 — Which deploy path is the standing rule
Repair CI and let it deploy, or keep CI as gates only and ship with `npm run deploy`?
If the latter, the workflow should probably be disabled so it cannot fail confusingly on
every push. Blocks C1.

### Q3 — What may leave the device
Needed before EPIC E can be built, and before F4 can be unblocked. Roughly: intent plus
on-screen figures only (the current default), or raw records too. Also decides which
providers are acceptable at all.

### Q4 — Keep the legacy `pwa/` prototype?
Delete it, or keep it with a header saying it is superseded? Blocks D2.

---

# Considered and not planned

Recorded so they are not relitigated. Each carries the condition that would reopen it.

| Idea | Why not | Reopen if |
|------|---------|-----------|
| **Cloudflare Pages migration** | Loses the Durable Object binding and rewrites routing for no gain. This is a Workers app. | The app outgrows a single Worker. |
| **Client→server error reporting** | A free-text write channel into a finance store. | Only as whitelisted codes, no message, rate limited. |
| **Assistant free-form over raw records** | Egress of personal financial data. | Q3 is answered in favour of it. |
| **Automatic agent failover for development** | A new model inherits no conversation context, so it would restart rather than continue. | Context is persisted to the repo. It now is — see `docs/AGENTS.md`. |
| **Email delivery / reset by link** | Removed in `0003_remove_email.sql`. No mail provider, no API key to leak. | A transactional mail provider becomes worth its cost. |

---

## Where to start

**A1 — the error catalogue.** It is the critical path: the log needs `area` and
`severity` to be real fields, the user-facing copy needs the entries, and the
information page's error reference renders straight from them. Everything in EPIC A and
EPIC B depends on it, and it is the cheapest item here to verify.
