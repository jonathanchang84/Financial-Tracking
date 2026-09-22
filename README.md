# Financial Tracking

Native local-first financial tracking for iPhone, iPad, and Mac, plus an offline browser app (PWA). The Apple app uses SwiftUI with a shared domain layer, a locally persisted observable store, a Core Data model factory, and MVVM-oriented feature boundaries.

## Current Status

### Apple App (SwiftUI)

The Xcode project builds successfully for iOS and macOS. Key features:

- Shared Swift package (`Sources/FinancialTrackingCore`) with money, date, recurring-bill, SCD Type 2, and runway rules.
- Core Data model factory covering bills, accounts, assets, liabilities, holdings, cached market data, and pensions.
- Owner-scoped repository boundary for local row-level isolation.
- Provider-neutral market-data client for a self-hosted REST proxy.
- Currency picker sheet that controls the display currency across all screens.
- Cash Flow screen with a daily runway table (starting balance, safe amount, commitments, cumulative commitments, scheduled bills, ending balance) — no chart.
- Named commitments that can be added, renamed, re-dated, re-amounted, and deleted.
- Position, Portfolio, and Pensions screens each show:
  - A latest-value summary table.
  - A history table of all dated snapshots for that category.
  - An Update control that lets you pick from existing series names or enter a new name, then record a value for a chosen date.
- How To screen covering installation and operation for both the Apple app and the browser app.
- XcodeGen project manifest at `project.yml` and generated `Financial Tracking.xcodeproj`.

The generated project includes iOS and macOS application/test schemes. Regenerate it after changing `project.yml` with XcodeGen.

### Browser App (Offline PWA)

The `pwa/` folder contains a standalone offline financial dashboard that runs entirely in the browser using IndexedDB.

Current features:

- Dashboard with headline metrics (net worth, available balance, expenses logged) and a daily runway table instead of a chart.
- Currency selector on the dashboard that converts all displayed values to the chosen currency using fixed exchange rates.
- Cash Flow screen with runway settings form, a daily runway table (day, date, balance, safe target, cumulative spend), plus named commitments and recurring bills that can be added, edited and deleted — matching the Apple app.
- Position, Investments, and Pensions screens aligned with the Apple app's data model:
  - Named accounts (institution, asset/liability, currency), holdings (symbol, type, units, unit price) and pension pots (provider, currency) stored as current records, each with Edit / Update / Delete controls.
  - An Update action replaces the current value and records a dated snapshot under the same name, mirroring the Apple app's record-update helpers.
  - Forms that accept a name for every new entry, with Update modals that let you pick from existing names and change the currency.
  - History tables showing all dated snapshots with per-entry currency and converted display values.
- Backup and restore using JSON export/import of the local IndexedDB database.
- `manifest.json`, `sw.js`, and app icon assets under `pwa/assets/icons/`.

For iPhone installation, serve the `pwa/` folder over HTTPS from a trusted host, open it in Safari, tap Share, then choose **Add to Home Screen**. The manifest uses standalone display mode and portrait-primary orientation.

Both apps store data locally only (UserDefaults on Apple platforms, IndexedDB in the browser). No account, server, or network service is required after the app shell has been cached.

## Architecture

`Sources/FinancialTrackingCore` contains platform-independent domain rules. The app target is organized into:

- `App`: application entry point and dependency composition.
- `Domain`: typed feature models, use-case boundaries, and business rules.
- `Data/CoreData`: persistent container and schema construction.
- `Data/Repositories`: owner-scoped persistence interfaces.
- `Data/MarketData`: URLSession client for the self-hosted provider proxy.
- `Presentation`: SwiftUI feature screens and view models as screens mature.

The intended flow is `View -> ViewModel -> Use Case -> Repository -> Core Data / Market Client`. Views do not perform persistence or network work directly.

## Data and Security Model

Every user-owned record stores an immutable `ownerID`. Repository reads and writes must be created with an explicit `OwnerScope`; writes for another owner throw `RepositoryError.ownerScopeViolation`. This is an application-level local RLS pattern, not a substitute for server authorization.

Mutable records use SCD Type 2 metadata:

- `validFrom`: when this version became effective.
- `validTo`: when it was closed, or `nil` for the current version.
- `currentFlag`: true only for the current version.
- Stable logical IDs connect versions of the same business record.

Updates close the current version and insert a new version. Historical snapshots such as balances and pension valuations remain date-stamped records rather than being overwritten.

## Setup

Requirements:

- macOS with Xcode 15 or newer.
- iOS/iPadOS 17 SDK and macOS 14 SDK.
- XcodeGen (`brew install xcodegen`) to generate the project file from `project.yml`.
- Swift 5.9 or newer.

Generate the project:

```sh
xcodegen generate
open "Financial Tracking.xcodeproj"
```

Select the `Financial Tracking` scheme and run it on an iPhone/iPad simulator or Mac. Signing is intentionally not configured in source control; set the development team in Xcode for device builds.

## Feature Guide

### Cash Flow and Daily Runway

Enter recurring bills with a category, amount, and due day. Saturday and Sunday due dates shift to the following Monday. Each month receives independent bill occurrences, allowing paid/unpaid status and variable amount updates without changing the recurring definition.

Enter available balance and next payday to calculate remaining bill obligations, the safe daily amount, and the projected end-of-pay-period balance. The daily runway is presented as a table rather than a chart. Each row shows the date, starting balance, safe-to-commit amount for that day, commitments recorded that day, cumulative commitments, scheduled bills, and the ending balance.

Recorded commitments are named entries (for example `Car service`). Tap a commitment to rename it or change its amount, date, or currency, and swipe to delete it. A commitment is created from the Add commitment button in the Cash Flow screen.

### Financial Position

Create unlimited accounts and associate them with institutions. Every account has a required name, for example `Barclays savings`, and that name is the series label for its dated snapshots. Add balance snapshots by date, physical assets, and liabilities. The screen shows a Current position list, a Latest value by name summary table, a History chart that can be filtered to a single name or all names, and a Saved snapshots list where every row can be tapped to edit its name, date, value, currency, or to delete it.

The Update button on an account row records a new value for a chosen date and stores that dated snapshot under the same name, so separate series stay apart.

### Portfolio

Add stocks, funds, and ETFs with a fund or account name (for example `Fund 1`), symbol, quantity, purchase price, currency, and snapshot date. Names keep each fund's dated values in their own series. The Update button records a new unit price for a date, stores the fund's market value (quantity × price) as a dated snapshot under that name, and the Latest value by name table plus the name filter on the history chart keep funds separated.

The app is designed to read normalized quote and historical data from a self-hosted proxy and cache the last known values locally. Cached values are labelled with observation time and stale status. Automatic quote fetching is not wired into the interface yet; values are entered and dated manually.

### Pension and Retirement

Create pension pots with a required pot name, provider, and scheme metadata, then add dated valuation entries. Each pot keeps its own valuation series, the screen lists Latest value by name, and the Update button records a new valuation for a chosen date. Trajectory filters for YTD, 1Y, 5Y, and All remain a future enhancement.

## Market Proxy Contract

Configure a proxy base URL outside source control. The initial client expects:

```text
GET /v1/quotes/{symbol}
{
  "symbol": "VTI",
  "price": 271.42,
  "currencyCode": "USD",
  "observedAt": "2026-09-22T12:00:00Z"
}
```

Historical prices and FX rates should use the same normalized, provider-neutral convention. Do not put Yahoo credentials or provider tokens in the app. The proxy is responsible for provider terms, rate limits, secrets, and response normalization.

## Tests and Builds

The platform-independent package can be compiled with:

```sh
swift build
```

Once full Xcode is selected, generate the project and run:

```sh
xcodebuild -project "Financial Tracking.xcodeproj" -list
./Scripts/test.sh
./Scripts/build.sh
```

The default scripts test and build the macOS schemes. To use an iOS scheme, pass
the scheme explicitly, for example `SCHEME="Financial TrackingTests_iOS" ./Scripts/test.sh`
with an appropriate iOS simulator destination added to the script or direct
`xcodebuild` command.

The Xcode test target uses an in-memory Core Data store for deterministic tests. Device archives and signing require an Apple Developer team and certificates supplied through Xcode or private CI configuration.

## Release Workflow

Use semantic commit subjects such as:

```text
feat(bills): round weekend due dates to Monday
fix(portfolio): preserve stale cached quote on provider failure
```

The configured repository remote is retained as GitHub. GitLab CI can be added when a GitLab remote is supplied; credentials and signing materials must remain in CI secrets. No commits, pushes, certificates, or API secrets are generated automatically.

## Privacy and Limitations

The initial design is local-only and does not sync financial data to iCloud. Market values may be delayed or unavailable, so timestamps and stale state must be shown in the UI. Users should verify provider licensing and data terms before distribution.

## Standalone Offline PWA

The separate browser application lives in `pwa/`. It does not share runtime code with the native app and makes no remote API, telemetry, font, or tracking request. All browser data is stored in IndexedDB under the `financial-health-local` database.

Run it locally from the repository root:

```sh
cd pwa
python3 -m http.server 4173
```

Open `http://localhost:4173` in Safari, Chrome, or Edge. A local HTTP server is required for service-worker registration; opening `index.html` directly will still show the UI but will not enable offline caching. The PWA includes:

- Dashboard, runway, next-payday, daily safe-to-commit calculations, and commitment tables.
- Cash Flow daily runway table showing starting balance, safe amount, commitment, cumulative commitments, scheduled bills, and ending balance.
- Net-worth, portfolio, and pension historical snapshots with native currency selection.
- Explicit account, fund, and pension-pot names allow separate series such as `Savings 1`, `Savings 2`, `Fund 1`, and `Fund 2`.
- Update controls for named commitments and every dated position, investment, and pension snapshot.
- Month-on-month actual growth calculation and twelve-month compound-growth projections.
- Monthly budget limits, local transaction/spend logs, and safety progress indicators.
- Light/dark presentation modes and responsive phone/desktop layouts.
- JSON export/import backup that replaces or restores the local IndexedDB data set.
- `manifest.json`, `sw.js`, and app icon assets under `pwa/assets/icons/`.

For iPhone installation, serve the same folder over HTTPS from a trusted host, open it in Safari, tap Share, then choose **Add to Home Screen**. The manifest uses standalone display mode and portrait-primary orientation. No account, server, or network service is required after the app shell has been cached.

## How To Use Both Apps

### Native Apple App - Install

1. Install Xcode 15 or newer and open `Financial Tracking.xcodeproj`.
2. Choose the `Financial Tracking_iOS` scheme with an iPhone or iPad simulator, or the `Financial Tracking_macOS` scheme to run on your Mac.
3. Press Run (Command-R). For a physical device, set your Apple Developer team under Signing & Capabilities first.
4. Regenerate the project with `xcodegen generate` after editing `project.yml`.
5. Run tests with `Product > Test` or `./Scripts/test.sh`, and build the macOS app with `./Scripts/build.sh`.

### Native Apple App - Operate

1. Cash Flow: save the available balance, currency, and next payday, then add recurring bills and named commitments. The daily runway table lists every day with starting balance, safe amount, commitments today, cumulative commitments, scheduled bills, and ending balance.
2. Commitments: tap a commitment row to rename it or change its amount, date, or currency, and swipe a row to delete it.
3. Position: add named accounts, assets, and liabilities such as `Barclays savings`. Press Update on a row to enter a new value and date; the dated snapshot is stored under the same name.
4. Portfolio: add named funds or investment accounts with quantity and unit price, then press Update to record a new unit price for a date.
5. Pensions: add separately named pots and press Update to record a new valuation for a date.
6. Every Position, Portfolio, and Pensions screen shows a Latest value by name summary, lets you chart a single name or all names together, and lets you tap any saved snapshot row to edit or delete it.

### Offline PWA - Install

1. Run `cd pwa && python3 -m http.server 4173` from the repository root.
2. Open `http://localhost:4173` in Safari, Chrome, or Edge.
3. For iPhone, serve `pwa/` over HTTPS, open it in Safari, tap Share, then choose Add to Home Screen.
4. A local HTTP server is required for offline caching. Opening `index.html` directly still shows the interface but does not register the service worker.

### Offline PWA - Operate

1. The dashboard shows the headline numbers.
2. Cash flow holds the runway form, the daily table, and the recorded commitments list, where each commitment can be updated or deleted by name.
3. Position, Investments, and Pensions accept a name for every account, fund, or pot so separate series stay apart, and each dated snapshot row has an Update control.
4. Budgets set monthly limits, and Backup exports or restores the local IndexedDB database as JSON.

This section mirrors the in-app How To screen (the `How To` tab in the Apple app and the `How to` tab in the browser app).