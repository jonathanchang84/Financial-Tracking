# Financial Tracking

Native local-first financial tracking for iPhone, iPad, and Mac. The application uses SwiftUI with a shared domain layer, Core Data persistence, and MVVM-oriented feature boundaries.

## Current Status

The repository contains the initial implementation foundation:

- Shared Swift package with money, date, recurring-bill, SCD Type 2, and runway rules.
- Core Data model factory covering bills, accounts, assets, liabilities, holdings, cached market data, and pensions.
- Owner-scoped repository boundary for local row-level isolation.
- Provider-neutral market-data client for a self-hosted REST proxy.
- SwiftUI shell with four feature tabs and empty states.
- XcodeGen project manifest at `project.yml` and generated `Financial Tracking.xcodeproj`.

The generated project currently includes iOS and macOS application/test schemes. Regenerate it after changing `project.yml` with XcodeGen.

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

Enter recurring bills with a category, amount, and due day. Saturday and Sunday due dates shift to the following Monday. Each month receives independent bill occurrences, allowing paid/unpaid status and variable amount updates without changing the recurring definition. Enter available balance and next payday to calculate remaining bill obligations, daily budget, projected month-end balance, and daily target-versus-actual spend.

### Financial Position

Create unlimited accounts and associate them with institutions. Add balance snapshots by date, physical assets, and liabilities. Net worth is assets minus liabilities, with institution grouping and historical trends.

### Portfolio

Add stocks, funds, and ETFs with quantity, purchase price, currency, and snapshot date. The app reads normalized quote and historical data from a self-hosted proxy and caches the last known values locally. Cached values are labeled with observation time and stale status.

### Pension and Retirement

Create pension pots with provider and scheme metadata, then add dated valuation entries. The trajectory view will support YTD, 1Y, 5Y, and All filters for comparing pots.

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

- Dashboard, runway, next-payday, daily safe-spend, and cumulative spend charts.
- Net-worth, portfolio, and pension historical snapshots with native currency selection.
- Month-on-month actual growth calculation and twelve-month compound-growth projections.
- Monthly budget limits, local transaction/spend logs, and safety progress indicators.
- Light/dark presentation modes and responsive phone/desktop layouts.
- JSON export/import backup that replaces or restores the local IndexedDB data set.
- `manifest.json`, `sw.js`, and app icon assets under `pwa/assets/icons/`.

For iPhone installation, serve the same folder over HTTPS from a trusted host, open it in Safari, tap Share, then choose **Add to Home Screen**. The manifest uses standalone display mode and portrait-primary orientation. No account, server, or network service is required after the app shell has been cached.