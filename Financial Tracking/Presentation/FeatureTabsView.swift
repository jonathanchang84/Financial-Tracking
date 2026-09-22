import SwiftUI
import Charts

struct FeatureTabsView: View {
    @State private var currencyPicker = StoreCurrencyPicker()
    @EnvironmentObject private var store: AppDataStore

    var body: some View {
        TabView {
            CashFlowView()
                .tabItem { Label("Cash Flow", systemImage: "calendar") }

            NetWorthView()
                .tabItem { Label("Position", systemImage: "chart.pie") }

            PortfolioView()
                .tabItem { Label("Portfolio", systemImage: "chart.line.uptrend.xyaxis") }

            PensionView()
                .tabItem { Label("Pensions", systemImage: "figure.walk") }

            HowToView().tabItem { Label("How To", systemImage: "questionmark.circle") }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $currencyPicker.isPresented) {
            CurrencyPickerSheet(picker: $currencyPicker) {
                store.currentBalanceCurrencyCode = currencyPicker.selectedCurrencyCode
            }
        }
    }
}

// MARK: - How To

private struct HowToView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Apple app - install") {
                    Text("1. Install Xcode 15 or newer, then open Financial Tracking.xcodeproj.")
                    Text("2. Choose the Financial Tracking_iOS scheme with an iPhone or iPad simulator, or Financial Tracking_macOS to run on this Mac.")
                    Text("3. Press Run (Command-R). For a physical device, set your Apple Developer team under Signing & Capabilities first.")
                    Text("4. If you edit project.yml, regenerate the project with: xcodegen generate")
                }
                Section("Apple app - operate") {
                    Text("Cash Flow: save the available balance, currency and next payday, then add recurring bills and named commitments. The daily runway table lists every day with starting balance, safe amount, commitments today, cumulative commitments, scheduled bills and ending balance.")
                    Text("Commitments: tap a commitment row to rename it or change its amount, date or currency. Swipe a row to delete it.")
                    Text("Position: add named accounts, assets and liabilities, for example Barclays savings. Tap Update on a row to enter a new value and date; the app stores that dated snapshot under the same name.")
                    Text("Portfolio: add named funds or investment accounts with quantity and unit price. Tap Update to record a new unit price for a date, which stores the fund's market value for that day.")
                    Text("Pensions: add separately named pots and tap Update to record a new valuation for a date.")
                    Text("Each Position, Portfolio and Pensions screen lists every saved snapshot and can chart or filter a single name, so separate series stay apart.")
                }
                Section("Browser app (offline PWA) - install") {
                    Text("1. From the repository root run: cd pwa && python3 -m http.server 4173")
                    Text("2. Open http://localhost:4173 in Safari, Chrome or Edge.")
                    Text("3. On iPhone or iPad, serve the pwa folder over HTTPS, open it in Safari, tap Share, then choose Add to Home Screen.")
                    Text("A local HTTP server is required for offline caching. Opening index.html directly still shows the interface but skips the service worker.")
                }
                Section("Browser app (offline PWA) - operate") {
                    Text("Dashboard shows the headline numbers. Cash flow holds the runway form, the daily table and the recorded commitments list, where each commitment can be updated or deleted by name.")
                    Text("Position, Investments and Pensions accept a name for each account, fund or pot so separate series stay apart, and every dated snapshot row has an Update control.")
                    Text("Budgets set monthly limits, and Backup exports or restores the local IndexedDB database as JSON.")
                }
                Section("Privacy and data") {
                    Text("Both apps are local-only. The Apple app stores data in UserDefaults on this device and the browser app stores data in IndexedDB in this browser. No account, remote API, analytics or tracking is used.")
                    Text("Market prices are not fetched automatically; enter the values you want to keep and record them by date.")
                }
                Section("Tests and builds") {
                    Text("Run the shared domain tests with ./Scripts/test.sh and build the macOS app with ./Scripts/build.sh.")
                    Text("Compile only the platform-independent rules with: swift build")
                }
            }
            .navigationTitle("How To")
        }
    }
}

// MARK: - Cash flow

private struct CashFlowView: View {
    @EnvironmentObject private var store: AppDataStore
    @State private var showingAddBill = false
    @State private var showingAddCommitment = false
    @State private var editingBill: BillRecord?
    @State private var editingCommitment: CommitmentRecord?
    @State private var balanceDraft = ""
    @State private var balanceCurrency = "USD"
    @State private var payDate = Date()

    private var matchingBills: [BillRecord] { store.bills.filter { $0.currencyCode == store.currentBalanceCurrencyCode } }
    private var monthlyBills: Decimal { matchingBills.reduce(.zero) { $0 + $1.amount } }
    private var obligationSummary: String {
        let codes = Set(store.bills.map(\.currencyCode))
        guard codes.count == 1, let code = codes.first else { return codes.isEmpty ? "-" : "Mixed currencies" }
        return store.bills.reduce(.zero) { $0 + $1.amount }.formatted(.currency(code: code))
    }
    private var matchingCommitments: [CommitmentRecord] {
        store.commitments.filter { $0.currencyCode == balanceCurrency }.sorted { $0.date > $1.date }
    }

    /// One row per day from today through the next payday, mirroring the browser app's daily table.
    private var runwayRows: [RunwayRow] {
        guard store.currentBalanceCurrencyCode == balanceCurrency, let balance = Decimal(string: balanceDraft), balance > 0 else { return [] }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = calendar.startOfDay(for: store.nextPayDate)
        guard end >= start else { return [] }
        let dates = Array(DateRules.dates(from: start, through: end, calendar: calendar).prefix(45))
        let safeToday = balance / Decimal(max(1, dates.count))
        let bills = matchingBills
        var running = balance
        var cumulative: Decimal = .zero
        return dates.map { date in
            let starting = running
            let commitmentsToday = store.commitmentTotal(on: date, currencyCode: balanceCurrency, calendar: calendar)
            let billsToday = bills.reduce(Decimal.zero) { total, bill in
                guard let due = dueDate(for: bill, in: date, calendar: calendar), calendar.isDate(due, inSameDayAs: date) else { return total }
                return total + bill.amount
            }
            cumulative += commitmentsToday
            running -= safeToday + commitmentsToday + billsToday
            return RunwayRow(date: date, startingBalance: starting, safeToday: safeToday, commitmentToday: commitmentsToday,
                             cumulativeCommitments: cumulative, scheduledBills: billsToday, endingBalance: running)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Current month") {
                    LabeledContent("Recurring bills", value: "\(store.bills.count)")
                    LabeledContent("Bills in \(store.currentBalanceCurrencyCode)", value: monthlyBills.formatted(.currency(code: store.currentBalanceCurrencyCode)))
                    LabeledContent("All bills", value: obligationSummary)
                }
                Section("Available money and payday") {
                    TextField("Current amount available", text: $balanceDraft)
                    CurrencyPicker(selection: $balanceCurrency)
                    DatePicker("Next payday", selection: $payDate, displayedComponents: .date)
                    Button("Save balance and payday") {
                        guard let balance = Decimal(string: balanceDraft) else { return }
                        store.saveCurrentBalance(balance, currencyCode: balanceCurrency)
                        store.saveNextPayDate(payDate)
                    }.disabled(Decimal(string: balanceDraft) == nil)
                    if !runwayRows.isEmpty {
                        LabeledContent("Safe to commit each day", value: (runwayRows.first?.safeToday ?? .zero).formatted(.currency(code: balanceCurrency)))
                        LabeledContent("Projected at payday", value: (runwayRows.last?.endingBalance ?? .zero).formatted(.currency(code: balanceCurrency)))
                    }
                }
                if !runwayRows.isEmpty {
                    Section("Daily runway") {
                        RunwayTableView(rows: runwayRows, currencyCode: balanceCurrency)
                        Text("Safe today spreads the saved balance across the remaining days. Commitments are the named entries recorded below; bills are the recurring entries due on that date.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section("Commitments") {
                    if matchingCommitments.isEmpty { Text("No commitments in \(balanceCurrency) yet.").foregroundStyle(.secondary) }
                    ForEach(matchingCommitments) { commitment in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(commitment.displayName)
                                Text("\(commitment.date.formatted(.dateTime.month(.abbreviated).day().year())) • \(commitment.currencyCode)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(commitment.amount, format: .currency(code: commitment.currencyCode))
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { editingCommitment = commitment }
                    }
                    .onDelete { offsets in offsets.map { matchingCommitments[$0].id }.forEach { store.deleteCommitment(id: $0) } }
                    Button { showingAddCommitment = true } label: { Label("Add commitment", systemImage: "plus") }
                }
                Section("Recurring bills") {
                    if store.bills.isEmpty { Text("Add your first recurring bill with the + button.").foregroundStyle(.secondary) }
                    ForEach(store.bills) { bill in
                        HStack { VStack(alignment: .leading) { Text(bill.name); Text("\(bill.category) • Due day \(bill.dueDay)").font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(bill.amount, format: .currency(code: bill.currencyCode)) }
                            .contentShape(Rectangle()).onTapGesture { editingBill = bill }
                    }.onDelete(perform: store.deleteBill)
                }
            }
            .navigationTitle("Cash Flow")
            .toolbar { Button { showingAddBill = true } label: { Label("Add bill", systemImage: "plus") } }
            .sheet(isPresented: $showingAddBill) { AddBillView() }
            .sheet(isPresented: $showingAddCommitment) { AddCommitmentView(currencyCode: balanceCurrency) }
            .sheet(item: $editingBill) { EditBillView(bill: $0) }
            .sheet(item: $editingCommitment) { EditCommitmentView(commitment: $0) }
            .onAppear { balanceDraft = store.currentAvailableBalance == .zero ? "" : "\(store.currentAvailableBalance)"; balanceCurrency = store.currentBalanceCurrencyCode; payDate = store.nextPayDate }
        }
    }
}


// MARK: - Daily runway table

private struct RunwayRow: Identifiable {
    let date: Date
    let startingBalance: Decimal
    let safeToday: Decimal
    let commitmentToday: Decimal
    let cumulativeCommitments: Decimal
    let scheduledBills: Decimal
    let endingBalance: Decimal
    var id: Date { date }
}

private struct RunwayTableView: View {
    let rows: [RunwayRow]
    let currencyCode: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
                GridRow {
                    Text("Date").bold()
                    Text("Starting").bold()
                    Text("Safe today").bold()
                    Text("Commitments").bold()
                    Text("Cumulative").bold()
                    Text("Bills").bold()
                    Text("Ending").bold()
                }
                .font(.caption)
                Divider().gridCellColumns(7)
                ForEach(rows) { row in
                    GridRow {
                        Text(row.date, format: .dateTime.weekday(.abbreviated).day().month(.abbreviated))
                        Text(row.startingBalance, format: .currency(code: currencyCode))
                        Text(row.safeToday, format: .currency(code: currencyCode))
                        Text(row.commitmentToday, format: .currency(code: currencyCode))
                        Text(row.cumulativeCommitments, format: .currency(code: currencyCode))
                        Text(row.scheduledBills, format: .currency(code: currencyCode))
                        Text(row.endingBalance, format: .currency(code: currencyCode)).bold()
                    }
                    .font(.caption)
                }
            }
            .padding(.vertical, 4)
        }
    }
}


// MARK: - Position (accounts, assets, and liabilities)

private struct NetWorthView: View {
    @EnvironmentObject private var store: AppDataStore
    @State private var showingAdd = false
    @State private var showingAddSnapshot = false
    @State private var updatingEntry: NetWorthRecord?
    @State private var editingEntry: NetWorthRecord?
    @State private var editingSnapshot: NetWorthHistoryRecord?
    @State private var selectedSeries = allSeriesLabel
    @State private var historyCurrency = "USD"

    private var historyRecords: [NetWorthHistoryRecord] { store.netWorthHistory.filter { $0.currencyCode == historyCurrency } }
    private var seriesNames: [String] { Array(Set(store.netWorthHistory.map(\.series))).sorted() }
    private var latestBySeries: [SnapshotRow] {
        latestSnapshots(historyRecords.map { (series: $0.series, date: $0.date, value: $0.value) })
    }
    private var chartRecords: [NetWorthHistoryRecord] {
        let matching = selectedSeries == allSeriesLabel ? historyRecords : historyRecords.filter { $0.series == selectedSeries }
        return matching.sorted { $0.date < $1.date }
    }
    private var growthPoints: [(date: Date, value: Decimal)] {
        if selectedSeries == allSeriesLabel {
            let grouped = Dictionary(grouping: historyRecords) { Calendar.current.startOfDay(for: $0.date) }
            return grouped.map { (date: $0.key, value: $0.value.reduce(.zero) { $0 + $1.value }) }.sorted { $0.date < $1.date }
        }
        return chartRecords.map { (date: $0.date, value: $0.value) }
    }
    private var monthGrowth: String { growthText(previous: growthPoints.dropLast().last?.value, current: growthPoints.last?.value) }

    var body: some View {
        NavigationStack {
            List {
                Section("Current position") {
                    Text("Name every account so its value is tracked as a separate series, for example Barclays savings.")
                        .font(.caption).foregroundStyle(.secondary)
                    if store.netWorthEntries.isEmpty { Text("Add an account, asset, or liability with +.").foregroundStyle(.secondary) }
                    ForEach(store.netWorthEntries) { entry in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(entry.name)
                                Text("\(entry.institution.isEmpty ? entry.kind.rawValue : "\(entry.institution) • \(entry.kind.rawValue)") • \(entry.currencyCode)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(entry.value, format: .currency(code: entry.currencyCode))
                            Button("Update") { updatingEntry = entry }.buttonStyle(.borderless)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { editingEntry = entry }
                    }
                    .onDelete(perform: store.deleteNetWorth)
                }
                Section("Latest value by name") {
                    SeriesSummaryTable(rows: latestBySeries, currencyCode: historyCurrency, emptyMessage: "Record a dated snapshot to separate accounts by name.")
                }
                Section("History") {
                    if chartRecords.isEmpty {
                        Text("No snapshots in \(historyCurrency) yet.").foregroundStyle(.secondary)
                    } else {
                        Chart(chartRecords) { point in
                            LineMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.green)
                            PointMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.green)
                        }.frame(height: 210)
                        Text("Latest month-on-month growth: \(monthGrowth)").font(.caption).foregroundStyle(.secondary)
                    }
                    Picker("Name", selection: $selectedSeries) {
                        Text(allSeriesLabel).tag(allSeriesLabel)
                        ForEach(seriesNames, id: \.self) { Text($0).tag($0) }
                    }
                    CurrencyPicker(selection: $historyCurrency)
                    Button("Add snapshot for a date") { showingAddSnapshot = true }
                }
                Section("Saved snapshots") {
                    if historyRecords.isEmpty { Text("No saved snapshots in \(historyCurrency).").foregroundStyle(.secondary) }
                    ForEach(historyRecords.sorted { $0.date > $1.date }) { record in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(record.series)
                                Text(record.date, format: .dateTime.month(.abbreviated).day().year()).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(record.value, format: .currency(code: record.currencyCode))
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { editingSnapshot = record }
                    }
                    .onDelete { offsets in
                        let sorted = historyRecords.sorted { $0.date > $1.date }
                        offsets.map { sorted[$0].id }.forEach { store.deleteNetWorthHistory(id: $0) }
                    }
                }
            }
            .navigationTitle("Position")
            .toolbar { Button { showingAdd = true } label: { Label("Add position", systemImage: "plus") } }
            .sheet(isPresented: $showingAdd) { AddNetWorthView() }
            .sheet(isPresented: $showingAddSnapshot) {
                SnapshotEditorView(title: "Add snapshot", nameFieldLabel: "Account name", namePlaceholder: "Barclays savings", valueFieldLabel: "Value on this date",
                                   name: selectedSeries == allSeriesLabel ? "" : selectedSeries, date: Date(), value: nil, currency: historyCurrency) { series, date, value, currency in
                    store.addNetWorthHistory(series: series, date: date, value: value, currencyCode: currency)
                }
            }
            .sheet(item: $updatingEntry) { entry in
                ValueUpdateView(title: "Update value", subject: entry.name,
                                detail: entry.institution.isEmpty ? entry.kind.rawValue : "\(entry.institution) • \(entry.kind.rawValue)",
                                valueLabel: "Value on this date", currencyCode: entry.currencyCode) { value, date in
                    store.recordNetWorthUpdate(entryID: entry.id, value: value, date: date)
                }
            }
            .sheet(item: $editingEntry) { EditNetWorthView(entry: $0) }
            .sheet(item: $editingSnapshot) { record in
                SnapshotEditorView(title: "Update snapshot", nameFieldLabel: "Account name", namePlaceholder: "Barclays savings", valueFieldLabel: "Value on this date",
                                   name: record.series, date: record.date, value: record.value, currency: record.currencyCode,
                                   onDelete: { store.deleteNetWorthHistory(id: record.id) }) { series, date, value, currency in
                    store.updateNetWorthHistory(NetWorthHistoryRecord(id: record.id, series: series, date: date, value: value, currencyCode: currency))
                }
            }
            .onAppear {
                if historyRecords.isEmpty, let code = store.netWorthEntries.first?.currencyCode ?? store.netWorthHistory.first?.currencyCode { historyCurrency = code }
            }
        }
    }
}

// MARK: - Portfolio (named funds and investment accounts)

private struct PortfolioView: View {
    @EnvironmentObject private var store: AppDataStore
    @State private var showingAdd = false
    @State private var showingAddSnapshot = false
    @State private var updatingHolding: HoldingRecord?
    @State private var editingHolding: HoldingRecord?
    @State private var editingSnapshot: PortfolioHistoryRecord?
    @State private var selectedSeries = allSeriesLabel
    @State private var historyCurrency = "USD"
    @State private var growth = ""

    private var historyRecords: [PortfolioHistoryRecord] { store.portfolioHistory.filter { $0.currencyCode == historyCurrency } }
    private var seriesNames: [String] { Array(Set(store.portfolioHistory.map(\.series))).sorted() }
    private var latestBySeries: [SnapshotRow] { latestSnapshots(historyRecords.map { (series: $0.series, date: $0.date, value: $0.value) }) }
    private var chartRecords: [PortfolioHistoryRecord] {
        let matching = selectedSeries == allSeriesLabel ? historyRecords : historyRecords.filter { $0.series == selectedSeries }
        return matching.sorted { $0.date < $1.date }
    }
    private var growthPoints: [(date: Date, value: Decimal)] {
        if selectedSeries == allSeriesLabel {
            let grouped = Dictionary(grouping: historyRecords) { Calendar.current.startOfDay(for: $0.date) }
            return grouped.map { (date: $0.key, value: $0.value.reduce(.zero) { $0 + $1.value }) }.sorted { $0.date < $1.date }
        }
        return chartRecords.map { (date: $0.date, value: $0.value) }
    }
    private var monthGrowth: String { growthText(previous: growthPoints.dropLast().last?.value, current: growthPoints.last?.value) }
    private var currentValue: Decimal { store.holdings.filter { $0.currencyCode == historyCurrency }.reduce(.zero) { $0 + $1.marketValue } }

    var body: some View {
        NavigationStack {
            List {
                Section("Holdings") {
                    Text("Give each fund or account a name such as Fund 1 or ISA so its value is tracked separately.")
                        .font(.caption).foregroundStyle(.secondary)
                    if store.holdings.isEmpty { Text("Add a stock, fund, or ETF with +.").foregroundStyle(.secondary) }
                    ForEach(store.holdings) { holding in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(holding.seriesName)
                                Text("\(holding.symbol) • \(holding.type) • \(holding.quantity.formatted()) units • \(holding.currencyCode)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(holding.marketValue, format: .currency(code: holding.currencyCode))
                            Button("Update") { updatingHolding = holding }.buttonStyle(.borderless)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { editingHolding = holding }
                    }
                    .onDelete(perform: store.deleteHolding)
                }
                Section("Latest value by name") {
                    SeriesSummaryTable(rows: latestBySeries, currencyCode: historyCurrency, emptyMessage: "Record a dated snapshot to separate funds by name.")
                }
                Section("History") {
                    if chartRecords.isEmpty {
                        Text("No portfolio values in \(historyCurrency) yet.").foregroundStyle(.secondary)
                    } else {
                        Chart(chartRecords) { point in
                            LineMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.blue)
                        }.frame(height: 210)
                        Text("Latest month-on-month growth: \(monthGrowth)").font(.caption).foregroundStyle(.secondary)
                    }
                    Picker("Name", selection: $selectedSeries) {
                        Text(allSeriesLabel).tag(allSeriesLabel)
                        ForEach(seriesNames, id: \.self) { Text($0).tag($0) }
                    }
                    CurrencyPicker(selection: $historyCurrency)
                    Button("Add value for a date") { showingAddSnapshot = true }
                }
                Section("Saved snapshots") {
                    if historyRecords.isEmpty { Text("No saved values in \(historyCurrency).").foregroundStyle(.secondary) }
                    ForEach(historyRecords.sorted { $0.date > $1.date }) { record in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(record.series)
                                Text(record.date, format: .dateTime.month(.abbreviated).day().year()).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(record.value, format: .currency(code: record.currencyCode))
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { editingSnapshot = record }
                    }
                    .onDelete { offsets in
                        let sorted = historyRecords.sorted { $0.date > $1.date }
                        offsets.map { sorted[$0].id }.forEach { store.deletePortfolioHistory(id: $0) }
                    }
                }
                Section("Future projection") {
                    LabeledContent("Holdings value in \(historyCurrency)", value: currentValue.formatted(.currency(code: historyCurrency)))
                    TextField("Anticipated annual growth (%)", text: $growth)
                    Button("Save growth assumption") { if let rate = Decimal(string: growth) { store.saveGrowthRates(portfolio: rate / 100, pension: store.pensionGrowthRate) } }
                        .disabled(Decimal(string: growth) == nil)
                    Chart(projectionPoints(value: currentValue, annualRate: store.portfolioGrowthRate)) { point in
                        LineMark(x: .value("Date", point.date), y: .value("Value", point.value)).foregroundStyle(.orange).lineStyle(StrokeStyle(dash: [5, 4]))
                    }.frame(height: 180)
                    Text("Projection compounds the current holdings value annually.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Portfolio")
            .toolbar { Button { showingAdd = true } label: { Label("Add holding", systemImage: "plus") } }
            .sheet(isPresented: $showingAdd) { AddHoldingView() }
            .sheet(isPresented: $showingAddSnapshot) {
                SnapshotEditorView(title: "Add portfolio value", nameFieldLabel: "Fund or account name", namePlaceholder: "Fund 1", valueFieldLabel: "Value on this date",
                                   name: selectedSeries == allSeriesLabel ? "" : selectedSeries, date: Date(), value: nil, currency: historyCurrency) { series, date, value, currency in
                    store.addPortfolioHistory(series: series, date: date, value: value, currencyCode: currency)
                }
            }
            .sheet(item: $updatingHolding) { holding in
                ValueUpdateView(title: "Update unit price", subject: holding.seriesName,
                                detail: "\(holding.symbol) • \(holding.quantity) units • stored value is quantity × price",
                                valueLabel: "Unit price on this date", currencyCode: holding.currencyCode) { price, date in
                    store.recordHoldingUpdate(holdingID: holding.id, price: price, date: date)
                }
            }
            .sheet(item: $editingHolding) { EditHoldingView(holding: $0) }
            .sheet(item: $editingSnapshot) { record in
                SnapshotEditorView(title: "Update portfolio value", nameFieldLabel: "Fund or account name", namePlaceholder: "Fund 1", valueFieldLabel: "Value on this date",
                                   name: record.series, date: record.date, value: record.value, currency: record.currencyCode,
                                   onDelete: { store.deletePortfolioHistory(id: record.id) }) { series, date, value, currency in
                    store.updatePortfolioHistory(PortfolioHistoryRecord(id: record.id, series: series, date: date, value: value, currencyCode: currency))
                }
            }
            .onAppear {
                growth = "\(store.portfolioGrowthRate * 100)"
                if historyRecords.isEmpty, let code = store.holdings.first?.currencyCode ?? store.portfolioHistory.first?.currencyCode { historyCurrency = code }
            }
        }
    }
}

// MARK: - Pensions

private struct PensionView: View {
    @EnvironmentObject private var store: AppDataStore
    @State private var showingAdd = false
    @State private var showingAddSnapshot = false
    @State private var updatingPension: PensionRecord?
    @State private var editingPension: PensionRecord?
    @State private var editingSnapshot: PensionHistoryRecord?
    @State private var selectedSeries = allSeriesLabel
    @State private var historyCurrency = "USD"
    @State private var growth = ""

    private var historyRecords: [PensionHistoryRecord] { store.pensionHistory.filter { $0.currencyCode == historyCurrency } }
    private var seriesNames: [String] { Array(Set(store.pensionHistory.map(\.series))).sorted() }
    private var latestBySeries: [SnapshotRow] { latestSnapshots(historyRecords.map { (series: $0.series, date: $0.date, value: $0.value) }) }
    private var chartRecords: [PensionHistoryRecord] {
        let matching = selectedSeries == allSeriesLabel ? historyRecords : historyRecords.filter { $0.series == selectedSeries }
        return matching.sorted { $0.date < $1.date }
    }
    private var growthPoints: [(date: Date, value: Decimal)] {
        if selectedSeries == allSeriesLabel {
            let grouped = Dictionary(grouping: historyRecords) { Calendar.current.startOfDay(for: $0.date) }
            return grouped.map { (date: $0.key, value: $0.value.reduce(.zero) { $0 + $1.value }) }.sorted { $0.date < $1.date }
        }
        return chartRecords.map { (date: $0.date, value: $0.value) }
    }
    private var monthGrowth: String { growthText(previous: growthPoints.dropLast().last?.value, current: growthPoints.last?.value) }
    private var currentValue: Decimal { store.pensions.filter { $0.currencyCode == historyCurrency }.reduce(.zero) { $0 + $1.value } }

    var body: some View {
        NavigationStack {
            List {
                Section("Pension pots") {
                    Text("Name each pot separately, for example Workplace or SIPP, so values and growth stay apart.")
                        .font(.caption).foregroundStyle(.secondary)
                    if store.pensions.isEmpty { Text("Add a pension pot with +.").foregroundStyle(.secondary) }
                    ForEach(store.pensions) { pension in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(pension.seriesName)
                                Text("\(pension.provider.isEmpty ? "Provider not set" : pension.provider) • \(pension.currencyCode)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(pension.value, format: .currency(code: pension.currencyCode))
                            Button("Update") { updatingPension = pension }.buttonStyle(.borderless)
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { editingPension = pension }
                    }
                    .onDelete(perform: store.deletePension)
                }
                Section("Latest value by name") {
                    SeriesSummaryTable(rows: latestBySeries, currencyCode: historyCurrency, emptyMessage: "Record a dated valuation to separate pots by name.")
                }
                Section("History") {
                    if chartRecords.isEmpty {
                        Text("No pension values in \(historyCurrency) yet.").foregroundStyle(.secondary)
                    } else {
                        Chart(chartRecords) { point in
                            LineMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.purple)
                        }.frame(height: 210)
                        Text("Latest month-on-month growth: \(monthGrowth)").font(.caption).foregroundStyle(.secondary)
                    }
                    Picker("Name", selection: $selectedSeries) {
                        Text(allSeriesLabel).tag(allSeriesLabel)
                        ForEach(seriesNames, id: \.self) { Text($0).tag($0) }
                    }
                    CurrencyPicker(selection: $historyCurrency)
                    Button("Add valuation for a date") { showingAddSnapshot = true }
                }
                Section("Saved valuations") {
                    if historyRecords.isEmpty { Text("No saved valuations in \(historyCurrency).").foregroundStyle(.secondary) }
                    ForEach(historyRecords.sorted { $0.date > $1.date }) { record in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(record.series)
                                Text(record.date, format: .dateTime.month(.abbreviated).day().year()).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(record.value, format: .currency(code: record.currencyCode))
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { editingSnapshot = record }
                    }
                    .onDelete { offsets in
                        let sorted = historyRecords.sorted { $0.date > $1.date }
                        offsets.map { sorted[$0].id }.forEach { store.deletePensionHistory(id: $0) }
                    }
                }
                Section("Future projection") {
                    LabeledContent("Pots value in \(historyCurrency)", value: currentValue.formatted(.currency(code: historyCurrency)))
                    TextField("Anticipated annual growth (%)", text: $growth)
                    Button("Save growth assumption") { if let rate = Decimal(string: growth) { store.saveGrowthRates(portfolio: store.portfolioGrowthRate, pension: rate / 100) } }
                        .disabled(Decimal(string: growth) == nil)
                    Chart(projectionPoints(value: currentValue, annualRate: store.pensionGrowthRate)) { point in
                        LineMark(x: .value("Date", point.date), y: .value("Value", point.value)).foregroundStyle(.orange).lineStyle(StrokeStyle(dash: [5, 4]))
                    }.frame(height: 180)
                    Text("Projection compounds the current pension position annually.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Pensions")
            .toolbar { Button { showingAdd = true } label: { Label("Add pension", systemImage: "plus") } }
            .sheet(isPresented: $showingAdd) { AddPensionView() }
            .sheet(isPresented: $showingAddSnapshot) {
                SnapshotEditorView(title: "Add pension value", nameFieldLabel: "Pension pot name", namePlaceholder: "Pension 1", valueFieldLabel: "Value on this date",
                                   name: selectedSeries == allSeriesLabel ? "" : selectedSeries, date: Date(), value: nil, currency: historyCurrency) { series, date, value, currency in
                    store.addPensionHistory(series: series, date: date, value: value, currencyCode: currency)
                }
            }
            .sheet(item: $updatingPension) { pension in
                ValueUpdateView(title: "Update value", subject: pension.seriesName,
                                detail: pension.provider.isEmpty ? "Pension pot" : pension.provider,
                                valueLabel: "Value on this date", currencyCode: pension.currencyCode) { value, date in
                    store.recordPensionUpdate(pensionID: pension.id, value: value, date: date)
                }
            }
            .sheet(item: $editingPension) { EditPensionView(pension: $0) }
            .sheet(item: $editingSnapshot) { record in
                SnapshotEditorView(title: "Update pension value", nameFieldLabel: "Pension pot name", namePlaceholder: "Pension 1", valueFieldLabel: "Value on this date",
                                   name: record.series, date: record.date, value: record.value, currency: record.currencyCode,
                                   onDelete: { store.deletePensionHistory(id: record.id) }) { series, date, value, currency in
                    store.updatePensionHistory(PensionHistoryRecord(id: record.id, series: series, date: date, value: value, currencyCode: currency))
                }
            }
            .onAppear {
                growth = "\(store.pensionGrowthRate * 100)"
                if historyRecords.isEmpty, let code = store.pensions.first?.currencyCode ?? store.pensionHistory.first?.currencyCode { historyCurrency = code }
            }
        }
    }
}

// MARK: - Shared components

/// Label used by the history name pickers to chart every named series together.
private let allSeriesLabel = "All names"

/// Adds or edits one named, dated snapshot. Used for position, portfolio, pension, and commitment entries.
private struct SnapshotEditorView: View {
    let title: String
    let nameFieldLabel: String
    let namePlaceholder: String
    let valueFieldLabel: String
    var onDelete: (() -> Void)?
    let onSubmit: (String, Date, Decimal, String) -> Void

    @State private var name: String
    @State private var date: Date
    @State private var value: String
    @State private var currency: String
    @Environment(\.dismiss) private var dismiss

    init(title: String, nameFieldLabel: String, namePlaceholder: String, valueFieldLabel: String, name: String, date: Date, value: Decimal?, currency: String,
         onDelete: (() -> Void)? = nil, onSubmit: @escaping (String, Date, Decimal, String) -> Void) {
        self.title = title
        self.nameFieldLabel = nameFieldLabel
        self.namePlaceholder = namePlaceholder
        self.valueFieldLabel = valueFieldLabel
        self.onDelete = onDelete
        self.onSubmit = onSubmit
        _name = State(initialValue: name)
        _date = State(initialValue: date)
        _value = State(initialValue: value.map { "\($0)" } ?? "")
        _currency = State(initialValue: currency)
    }

    var body: some View {
        NavigationStack {
            Form {
                TextField(nameFieldLabel, text: $name, prompt: Text(namePlaceholder))
                DatePicker("Date", selection: $date, displayedComponents: .date)
                TextField(valueFieldLabel, text: $value)
                CurrencyPicker(selection: $currency)
                if let onDelete { Button("Delete this entry", role: .destructive) { onDelete(); dismiss() } }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let amount = Decimal(string: value) else { return }
                        onSubmit(name, date, amount, currency)
                        dismiss()
                    }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || Decimal(string: value) == nil)
                }
            }
        }
    }
}

/// Replaces the current value of a named item and stores a dated snapshot for the same name.
private struct ValueUpdateView: View {
    let title: String
    let subject: String
    let detail: String
    let valueLabel: String
    let currencyCode: String
    let onSubmit: (Decimal, Date) -> Void

    @State private var date = Date()
    @State private var value = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("Name", value: subject)
                if !detail.isEmpty { LabeledContent("Details", value: detail) }
                DatePicker("Date of this value", selection: $date, displayedComponents: .date)
                TextField(valueLabel, text: $value)
                Text("The current value is replaced and a dated snapshot is stored under \(subject) in \(currencyCode).")
                    .font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Update") {
                        guard let amount = Decimal(string: value) else { return }
                        onSubmit(amount, date)
                        dismiss()
                    }.disabled(Decimal(string: value) == nil)
                }
            }
        }
    }
}

/// One name with its most recent dated value.
private struct SnapshotRow: Identifiable {
    let series: String
    let date: Date
    let value: Decimal
    var id: String { series }
}

/// Keeps only the latest snapshot per name so separate accounts, funds, and pots stay visible side by side.
private func latestSnapshots(_ records: [(series: String, date: Date, value: Decimal)]) -> [SnapshotRow] {
    var latest: [String: (date: Date, value: Decimal)] = [:]
    for record in records {
        if let existing = latest[record.series], existing.date >= record.date { continue }
        latest[record.series] = (record.date, record.value)
    }
    return latest
        .map { SnapshotRow(series: $0.key, date: $0.value.date, value: $0.value.value) }
        .sorted { $0.series.localizedCaseInsensitiveCompare($1.series) == .orderedAscending }
}

private struct SeriesSummaryTable: View {
    let rows: [SnapshotRow]
    let currencyCode: String
    let emptyMessage: String

    var body: some View {
        if rows.isEmpty {
            Text(emptyMessage).foregroundStyle(.secondary)
        } else {
            ScrollView(.horizontal, showsIndicators: true) {
                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 6) {
                    GridRow { Text("Name").bold(); Text("Latest date").bold(); Text("Value").bold() }
                        .font(.caption)
                    Divider().gridCellColumns(3)
                    ForEach(rows) { row in
                        GridRow {
                            Text(row.series)
                            Text(row.date, format: .dateTime.month(.abbreviated).day().year())
                            Text(row.value, format: .currency(code: currencyCode)).bold()
                        }
                        .font(.caption)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
}

private struct CurrencyPicker: View { @Binding var selection: String; var body: some View { Picker("Currency", selection: $selection) { ForEach(SupportedCurrency.allCases) { currency in Text("\(currency.rawValue) - \(currency.displayName)").tag(currency.rawValue) } } } }

// MARK: - Shared helpers

private struct ProjectionPoint: Identifiable { let date: Date; let value: Double; var id: Date { date } }

private func projectionPoints(value: Decimal, annualRate: Decimal) -> [ProjectionPoint] {
    (0...12).compactMap { month in
        guard let date = Calendar.current.date(byAdding: .month, value: month, to: .now) else { return nil }
        let multiplier = pow(1 + NSDecimalNumber(decimal: annualRate).doubleValue, Double(month) / 12)
        return ProjectionPoint(date: date, value: NSDecimalNumber(decimal: value).doubleValue * multiplier)
    }
}

private func decimalDouble(_ value: Decimal) -> Double { NSDecimalNumber(decimal: value).doubleValue }

private func growthText(previous: Decimal?, current: Decimal?) -> String {
    guard let previous, let current, previous != 0 else { return "Not enough data" }
    let percentage = NSDecimalNumber(decimal: (current - previous) / previous).doubleValue * 100
    return String(format: "%+.2f%%", percentage)
}

/// Due date for a saved bill in the month of `month`, using the weekend rule from FinancialTrackingCore.
private func dueDate(for bill: BillRecord, in month: Date, calendar: Calendar) -> Date? {
    guard let range = calendar.range(of: .day, in: .month, for: month) else { return nil }
    var components = calendar.dateComponents([.year, .month], from: month)
    components.day = min(max(1, bill.dueDay), range.count)
    guard let raw = calendar.date(from: components) else { return nil }
    return DateRules.shiftedWeekendDate(raw, calendar: calendar)
}

// MARK: - Bill and commitment forms

private struct AddBillView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var category = "Utilities"; @State private var amount = ""; @State private var currencyCode = "USD"; @State private var dueDay = "1"
    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                TextField("Category", text: $category)
                TextField("Monthly amount", text: $amount)
                CurrencyPicker(selection: $currencyCode)
                TextField("Due day of month (1-31)", text: $dueDay)
                Text("This is the day of each month the bill is due. Weekend dates shift to Monday.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("Add recurring bill")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let amountValue = Decimal(string: amount), let day = Int(dueDay), !name.isEmpty, (1...31).contains(day) else { return }
                        store.addBill(name: name, category: category, amount: amountValue, currencyCode: currencyCode, dueDay: day)
                        dismiss()
                    }.disabled(name.isEmpty || Decimal(string: amount) == nil)
                }
            }
        }
    }
}

private struct EditBillView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var bill: BillRecord; @State private var amount: String; @State private var dueDay: String
    init(bill: BillRecord) { _bill = State(initialValue: bill); _amount = State(initialValue: "\(bill.amount)"); _dueDay = State(initialValue: "\(bill.dueDay)") }
    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $bill.name)
                TextField("Category", text: $bill.category)
                TextField("Monthly amount", text: $amount)
                CurrencyPicker(selection: $bill.currencyCode)
                TextField("Due day of month (1-31)", text: $dueDay)
                Text("This is the day of each month the bill is due. Weekend dates shift to Monday.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("Update recurring bill")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let value = Decimal(string: amount), let day = Int(dueDay), (1...31).contains(day) else { return }
                        bill.amount = value; bill.dueDay = day
                        store.updateBill(bill)
                        dismiss()
                    }.disabled(bill.name.isEmpty || Decimal(string: amount) == nil)
                }
            }
        }
    }
}

private struct AddCommitmentView: View {
    @EnvironmentObject private var store: AppDataStore
    let currencyCode: String
    var body: some View {
        SnapshotEditorView(title: "Add commitment", nameFieldLabel: "Commitment name", namePlaceholder: "Car service", valueFieldLabel: "Amount",
                           name: "", date: Date(), value: nil, currency: currencyCode) { name, date, amount, currency in
            store.addCommitment(name: name, date: date, amount: amount, currencyCode: currency)
        }
    }
}

private struct EditCommitmentView: View {
    @EnvironmentObject private var store: AppDataStore
    let commitment: CommitmentRecord
    var body: some View {
        SnapshotEditorView(title: "Update commitment", nameFieldLabel: "Commitment name", namePlaceholder: "Car service", valueFieldLabel: "Amount",
                           name: commitment.name, date: commitment.date, value: commitment.amount, currency: commitment.currencyCode,
                           onDelete: { store.deleteCommitment(id: commitment.id) }) { name, date, amount, currency in
            store.updateCommitment(CommitmentRecord(id: commitment.id, name: name, date: date, amount: amount, currencyCode: currency))
        }
    }
}

// MARK: - Position and portfolio forms

private struct AddNetWorthView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var institution = ""; @State private var kind: NetWorthKind = .asset; @State private var value = ""; @State private var currency = "USD"
    var body: some View {
        NavigationStack {
            Form {
                TextField("Account name", text: $name, prompt: Text("Barclays savings"))
                TextField("Institution", text: $institution)
                Picker("Type", selection: $kind) { ForEach(NetWorthKind.allCases) { Text($0.rawValue).tag($0) } }
                TextField("Current value", text: $value)
                CurrencyPicker(selection: $currency)
                Text("The account name keeps this account's dated snapshots in their own series.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("Add position")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let amount = Decimal(string: value) else { return }
                        store.addNetWorth(name: name, institution: institution, kind: kind, value: amount, currencyCode: currency)
                        dismiss()
                    }.disabled(name.isEmpty || Decimal(string: value) == nil)
                }
            }
        }
    }
}

private struct EditNetWorthView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var entry: NetWorthRecord; @State private var value: String
    init(entry: NetWorthRecord) { _entry = State(initialValue: entry); _value = State(initialValue: "\(entry.value)") }
    var body: some View {
        NavigationStack {
            Form {
                TextField("Account name", text: $entry.name)
                TextField("Institution", text: $entry.institution)
                Picker("Type", selection: $entry.kind) { ForEach(NetWorthKind.allCases) { Text($0.rawValue).tag($0) } }
                TextField("Current value", text: $value)
                CurrencyPicker(selection: $entry.currencyCode)
                Text("Rename the account to split or combine its dated snapshots.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("Update position")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let amount = Decimal(string: value) else { return }
                        entry.value = amount
                        store.updateNetWorth(entry)
                        dismiss()
                    }.disabled(entry.name.isEmpty || Decimal(string: value) == nil)
                }
            }
        }
    }
}

private struct AddHoldingView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var symbol = ""; @State private var type = "ETF"; @State private var quantity = ""; @State private var price = ""; @State private var currency = "USD"
    var body: some View {
        NavigationStack {
            Form {
                TextField("Fund or account name", text: $name, prompt: Text("Fund 1"))
                TextField("Symbol", text: $symbol)
                TextField("Type (Stock, Fund, ETF)", text: $type)
                TextField("Quantity", text: $quantity)
                TextField("Unit price", text: $price)
                CurrencyPicker(selection: $currency)
                Text("The name keeps this fund's dated values in their own series.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("Add holding")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let q = Decimal(string: quantity), let p = Decimal(string: price) else { return }
                        store.addHolding(name: name, symbol: symbol.uppercased(), type: type, quantity: q, price: p, currencyCode: currency)
                        dismiss()
                    }.disabled(name.isEmpty || symbol.isEmpty || Decimal(string: quantity) == nil || Decimal(string: price) == nil)
                }
            }
        }
    }
}

private struct EditHoldingView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var holding: HoldingRecord; @State private var quantity: String; @State private var price: String
    init(holding: HoldingRecord) { _holding = State(initialValue: holding); _quantity = State(initialValue: "\(holding.quantity)"); _price = State(initialValue: "\(holding.price)") }
    var body: some View {
        NavigationStack {
            Form {
                TextField("Fund or account name", text: $holding.name)
                TextField("Symbol", text: $holding.symbol)
                TextField("Type (Stock, Fund, ETF)", text: $holding.type)
                TextField("Quantity", text: $quantity)
                TextField("Unit price", text: $price)
                CurrencyPicker(selection: $holding.currencyCode)
            }
            .navigationTitle("Update holding")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let q = Decimal(string: quantity), let p = Decimal(string: price) else { return }
                        holding.quantity = q; holding.price = p
                        store.updateHolding(holding)
                        dismiss()
                    }.disabled(holding.name.isEmpty || Decimal(string: quantity) == nil || Decimal(string: price) == nil)
                }
            }
        }
    }
}

// MARK: - Pension forms

private struct AddPensionView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var provider = ""; @State private var value = ""; @State private var currency = "USD"
    var body: some View {
        NavigationStack {
            Form {
                TextField("Pension pot name", text: $name, prompt: Text("Pension 1"))
                TextField("Provider", text: $provider)
                TextField("Current value", text: $value)
                CurrencyPicker(selection: $currency)
                Text("The pot name keeps this pot's dated valuations in their own series.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("Add pension pot")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        guard let amount = Decimal(string: value) else { return }
                        store.addPension(name: name, provider: provider, value: amount, currencyCode: currency)
                        dismiss()
                    }.disabled(name.isEmpty || Decimal(string: value) == nil)
                }
            }
        }
    }
}

private struct EditPensionView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var pension: PensionRecord; @State private var value: String
    init(pension: PensionRecord) { _pension = State(initialValue: pension); _value = State(initialValue: "\(pension.value)") }
    var body: some View {
        NavigationStack {
            Form {
                TextField("Pension pot name", text: $pension.name)
                TextField("Provider", text: $pension.provider)
                TextField("Current value", text: $value)
                CurrencyPicker(selection: $pension.currencyCode)
                Text("Rename the pot to split or combine its dated valuations.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("Update pension pot")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let amount = Decimal(string: value) else { return }
                        pension.value = amount
                        store.updatePension(pension)
                        dismiss()
                    }.disabled(pension.name.isEmpty || Decimal(string: value) == nil)
                }
            }
        }
    }
}

