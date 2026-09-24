# Financial Dashboard PWA

Offline-first Svelte/Vite production app. It does not replace the historic `pwa/` prototype or the Apple sources. Those trees stay untouched.

## Status

- Local source of truth: IndexedDB `financial-health-local` version 2.
- Writes commit locally first. If the browser is online and Supabase is configured, the sync engine upserts in the background and stamps `owner_id` from the signed-in user. Offline rows stay `pending_sync` until connectivity returns.
- Overview display currency converts figures with the historic fixed rates. Account, holding, and pension rows keep their own currency and can be edited or deleted.
- Cash flow uses a daily table plus lightweight inline runway trajectory, a workbook-style current-month paid/unpaid remainder table, and a category doughnut: starting balance, safe-to-spend amount, Spend Items, cumulative Spend Items, scheduled bills and ending balance. Saturday and Sunday bill due dates shift to Monday. The saved balance, default display currency, payday, payment state and redundancy assumptions are stored in IndexedDB and synchronized through the existing settings table.
- Position, investment, and pension updates append SCD Type 2 snapshots (`validFrom`, `validTo`, `currentFlag`) under a stable logical id instead of rewriting history. Position, investment, and pension screens show a month-by-item table with the last value recorded in each month and the adjacent month percentage change. Pension pots can have individual annual growth rates, with monthly values compounded using `(1 + annual rate)^(1/12) - 1`.
- Static `dist/` output is the Cloudflare Pages artifact. Runtime cost is $0 on the Cloudflare Pages and Supabase free tiers when those limits are respected.

## Scripts

```bash
npm install
npm run dev
npm run build
```

Pages build command: `npm run build`. Output directory: `dist`.

## Cloud

Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Apply `supabase/schema.sql` in the Supabase SQL editor. Without those variables the app stays fully local.

Sign-in is optional. The dashboard works offline with no session.
