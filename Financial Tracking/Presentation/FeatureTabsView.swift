import Charts
import SwiftUI

struct FeatureTabsView: View {
    var body: some View {
        TabView {
            CashFlowView().tabItem { Label("Cash Flow", systemImage: "calendar") }
            NetWorthView().tabItem { Label("Net Worth", systemImage: "chart.pie") }
            PortfolioView().tabItem { Label("Portfolio", systemImage: "chart.line.uptrend.xyaxis") }
            PensionView().tabItem { Label("Pensions", systemImage: "figure.walk") }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct CashFlowView: View {
    @EnvironmentObject private var store: AppDataStore
    @State private var showingAdd = false
    @State private var showingSpend = false
    @State private var editingBill: BillRecord?
    @State private var balanceDraft = ""
    @State private var balanceCurrency = "USD"
    @State private var payDate = Date()

    private var matchingBills: [BillRecord] { store.bills.filter { $0.currencyCode == store.currentBalanceCurrencyCode } }
    private var obligationSummary: String {
        let codes = Set(store.bills.map(\.currencyCode))
        guard codes.count == 1, let code = codes.first else { return codes.isEmpty ? "-" : "Mixed currencies" }
        return store.bills.reduce(.zero) { $0 + $1.amount }.formatted(.currency(code: code))
    }
    private var dailyPoints: [DailyCashPoint] {
        guard store.currentBalanceCurrencyCode == balanceCurrency, let balance = Decimal(string: balanceDraft), store.nextPayDate >= Date() else { return [] }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        let end = calendar.startOfDay(for: store.nextPayDate)
        let dayCount = max(1, calendar.dateComponents([.day], from: start, to: end).day ?? 1)
        let dailyBudget = balance / Decimal(dayCount)
        var running = balance
        var points: [DailyCashPoint] = []
        for offset in 0...dayCount {
            guard let date = calendar.date(byAdding: .day, value: offset, to: start) else { continue }
            let spend = store.spendRecords.filter { $0.currencyCode == balanceCurrency && calendar.isDate($0.date, inSameDayAs: date) }.reduce(.zero) { $0 + $1.amount }
            let due = matchingBills.filter { bill in
                let day = calendar.component(.day, from: date)
                return bill.dueDay == day
            }.reduce(.zero) { $0 + $1.amount }
            running -= dailyBudget + spend + due
            points.append(DailyCashPoint(date: date, balance: running, cumulativeSpend: balance - running, targetSpend: dailyBudget * Decimal(offset + 1)))
        }
        return points
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Current month") {
                    LabeledContent("Recurring bills", value: "\(store.bills.count)")
                    LabeledContent("Monthly obligations", value: obligationSummary)
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
                    if let balance = Decimal(string: balanceDraft), !dailyPoints.isEmpty {
                        let dayCount = max(1, Calendar.current.dateComponents([.day], from: Date(), to: payDate).day ?? 1)
                        LabeledContent("Daily available budget", value: (balance / Decimal(dayCount)).formatted(.currency(code: balanceCurrency)))
                        LabeledContent("Projected at payday", value: dailyPoints.last?.balance.formatted(.currency(code: balanceCurrency)) ?? "-")
                    }
                }
                if !dailyPoints.isEmpty {
                    Section("Daily runway") {
                        Chart(dailyPoints) { point in
                            LineMark(x: .value("Date", point.date), y: .value("Balance", decimalDouble(point.balance))).foregroundStyle(.blue).interpolationMethod(.catmullRom)
                            LineMark(x: .value("Date", point.date), y: .value("Cumulative spend", decimalDouble(point.cumulativeSpend))).foregroundStyle(.orange).lineStyle(StrokeStyle(dash: [5, 4]))
                            PointMark(x: .value("Date", point.date), y: .value("Balance", decimalDouble(point.balance))).foregroundStyle(.blue)
                        }.chartYAxisLabel(balanceCurrency).frame(height: 220)
                        Text("Blue: projected available balance. Orange: cumulative spend including listed bills and recorded daily spend.").font(.caption).foregroundStyle(.secondary)
                        Button("Record daily spend") { showingSpend = true }
                    }
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
            .toolbar { Button { showingAdd = true } label: { Label("Add bill", systemImage: "plus") } }
            .sheet(isPresented: $showingAdd) { AddBillView() }
            .sheet(isPresented: $showingSpend) { AddSpendView() }
            .sheet(item: $editingBill) { EditBillView(bill: $0) }
            .onAppear { balanceDraft = store.currentAvailableBalance == .zero ? "" : "\(store.currentAvailableBalance)"; balanceCurrency = store.currentBalanceCurrencyCode; payDate = store.nextPayDate }
        }
    }
}

private struct DailyCashPoint: Identifiable { let date: Date; let balance: Decimal; let cumulativeSpend: Decimal; let targetSpend: Decimal; var id: Date { date } }

private struct AddSpendView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var date = Date(); @State private var amount = ""; @State private var currency = "USD"
    var body: some View { NavigationStack { Form { DatePicker("Spend date", selection: $date, displayedComponents: .date); TextField("Amount spent", text: $amount); CurrencyPicker(selection: $currency) }.navigationTitle("Record daily spend").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let value = Decimal(string: amount) else { return }; store.addSpend(date: date, amount: value, currencyCode: currency); dismiss() }.disabled(Decimal(string: amount) == nil) } }.frame(minHeight: 280) } }
}

private struct AddBillView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var name = ""; @State private var category = "Utilities"; @State private var amount = ""; @State private var currencyCode = "USD"; @State private var dueDay = "1"
    var body: some View { NavigationStack { Form { TextField("Name", text: $name); TextField("Category", text: $category); TextField("Monthly amount", text: $amount); CurrencyPicker(selection: $currencyCode); TextField("Due day of month (1-31)", text: $dueDay); Text("This is the day of each month the bill is due. Weekend dates shift to Monday.").font(.caption).foregroundStyle(.secondary) }.navigationTitle("Add recurring bill").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let amountValue = Decimal(string: amount), let day = Int(dueDay), !name.isEmpty, (1...31).contains(day) else { return }; store.addBill(name: name, category: category, amount: amountValue, currencyCode: currencyCode, dueDay: day); dismiss() }.disabled(name.isEmpty || Decimal(string: amount) == nil) } }.frame(minHeight: 300) } }
}

private struct EditBillView: View {
    @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss
    @State private var bill: BillRecord; @State private var amount: String; @State private var dueDay: String
    init(bill: BillRecord) { _bill = State(initialValue: bill); _amount = State(initialValue: "\(bill.amount)"); _dueDay = State(initialValue: "\(bill.dueDay)") }
    var body: some View { NavigationStack { Form { TextField("Name", text: $bill.name); TextField("Category", text: $bill.category); TextField("Monthly amount", text: $amount); CurrencyPicker(selection: $bill.currencyCode); TextField("Due day of month (1-31)", text: $dueDay); Text("This is the day of each month the bill is due. Weekend dates shift to Monday.").font(.caption).foregroundStyle(.secondary) }.navigationTitle("Edit recurring bill").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Save") { guard let value = Decimal(string: amount), let day = Int(dueDay), (1...31).contains(day) else { return }; bill.amount = value; bill.dueDay = day; store.updateBill(bill); dismiss() }.disabled(Decimal(string: amount) == nil) } } } }
}

private struct NetWorthView: View {
    @EnvironmentObject private var store: AppDataStore; @State private var showingAdd = false; @State private var showingHistory = false; @State private var showingEdit = false; @State private var historyValue = ""; @State private var historyDate = Date(); @State private var historyCurrency = "USD"
    private var historyPoints: [NetWorthHistoryRecord] { store.netWorthHistory.filter { $0.currencyCode == historyCurrency }.sorted { $0.date < $1.date } }
    private var monthGrowth: String { growthText(previous: historyPoints.dropLast().last?.value, current: historyPoints.last?.value) }
    var body: some View { NavigationStack { List { Section("Current position") { Text("Values are kept in their original currencies. Add history to compare dates.").font(.caption).foregroundStyle(.secondary) }; Section("Historical trend") { if historyPoints.isEmpty { Text("No historical snapshots yet.").foregroundStyle(.secondary) } else { Chart(historyPoints) { point in LineMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.green); PointMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.green) }.frame(height: 210); Text("Latest month-on-month growth: \(monthGrowth)").font(.caption).foregroundStyle(.secondary) }; CurrencyPicker(selection: $historyCurrency); Button("Add historical snapshot") { showingHistory = true } }; Section("Accounts, assets, and liabilities") { if store.netWorthEntries.isEmpty { Text("Add an account, asset, or liability with +.").foregroundStyle(.secondary) }; ForEach(store.netWorthEntries) { entry in HStack { VStack(alignment: .leading) { Text(entry.name); Text("\(entry.institution) • \(entry.kind.rawValue)").font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(entry.value, format: .currency(code: entry.currencyCode)) } } .onDelete(perform: store.deleteNetWorth) } }.navigationTitle("Net Worth").toolbar { Button { showingAdd = true } label: { Label("Add position", systemImage: "plus") } }.sheet(isPresented: $showingAdd) { AddNetWorthView() }.sheet(isPresented: $showingHistory) { AddNetWorthHistoryView() } } }
}

private struct AddNetWorthView: View { @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss; @State private var name = ""; @State private var institution = ""; @State private var kind: NetWorthKind = .asset; @State private var value = ""; @State private var currency = "USD"; var body: some View { NavigationStack { Form { TextField("Name", text: $name); TextField("Institution", text: $institution); Picker("Type", selection: $kind) { ForEach(NetWorthKind.allCases) { Text($0.rawValue).tag($0) } }; TextField("Value", text: $value); CurrencyPicker(selection: $currency) }.navigationTitle("Add position").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let amount = Decimal(string: value) else { return }; store.addNetWorth(name: name, institution: institution, kind: kind, value: amount, currencyCode: currency); dismiss() }.disabled(name.isEmpty || Decimal(string: value) == nil) } }.frame(minHeight: 300) } } }
private struct AddNetWorthHistoryView: View { @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss; @State private var date = Date(); @State private var value = ""; @State private var currency = "USD"; var body: some View { NavigationStack { Form { DatePicker("Snapshot date", selection: $date, displayedComponents: .date); TextField("Net worth on this date", text: $value); CurrencyPicker(selection: $currency) }.navigationTitle("Add net-worth history").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let amount = Decimal(string: value) else { return }; store.addNetWorthHistory(date: date, value: amount, currencyCode: currency); dismiss() }.disabled(Decimal(string: value) == nil) } }.frame(minHeight: 280) } } }

private struct PortfolioView: View {
    @EnvironmentObject private var store: AppDataStore; @State private var showingAdd = false; @State private var showingHistory = false; @State private var growth = ""; @State private var historyCurrency = "USD"
    private var historyPoints: [PortfolioHistoryRecord] { store.portfolioHistory.filter { $0.currencyCode == historyCurrency }.sorted { $0.date < $1.date } }
    private var monthGrowth: String { growthText(previous: historyPoints.dropLast().last?.value, current: historyPoints.last?.value) }
    private var currentValue: Decimal { store.holdings.filter { $0.currencyCode == historyCurrency }.reduce(.zero) { $0 + ($1.quantity * $1.price) } }
    var body: some View { NavigationStack { List { Section("Historical performance") { if historyPoints.isEmpty { Text("No historical portfolio values yet.").foregroundStyle(.secondary) } else { Chart(historyPoints) { point in LineMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.blue) }.frame(height: 210); Text("Latest month-on-month growth: \(monthGrowth)").font(.caption).foregroundStyle(.secondary) }; CurrencyPicker(selection: $historyCurrency); Button("Add historical portfolio value") { showingHistory = true } }; Section("Future projection") { TextField("Anticipated annual growth (%)", text: $growth); Button("Save growth assumption") { if let rate = Decimal(string: growth) { store.saveGrowthRates(portfolio: rate / 100, pension: store.pensionGrowthRate) } }.disabled(Decimal(string: growth) == nil); Text("Projection uses compound annual growth from current holdings in the selected currency.").font(.caption).foregroundStyle(.secondary); Chart(projectionPoints(value: currentValue, annualRate: store.portfolioGrowthRate)) { point in LineMark(x: .value("Date", point.date), y: .value("Value", point.value)).foregroundStyle(.orange).lineStyle(StrokeStyle(dash: [5, 4])) }.frame(height: 180) }; Section("Holdings") { if store.holdings.isEmpty { Text("Add a stock, fund, or ETF with +.").foregroundStyle(.secondary) }; ForEach(store.holdings) { holding in HStack { VStack(alignment: .leading) { Text(holding.symbol).font(.headline); Text("\(holding.type) • \(holding.quantity) units • \(holding.currencyCode)").font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(holding.quantity * holding.price, format: .currency(code: holding.currencyCode)) } } .onDelete(perform: store.deleteHolding) } }.navigationTitle("Portfolio").toolbar { Button { showingAdd = true } label: { Label("Add holding", systemImage: "plus") } }.sheet(isPresented: $showingAdd) { AddHoldingView() }.sheet(isPresented: $showingHistory) { AddPortfolioHistoryView() }.onAppear { growth = "\(store.portfolioGrowthRate * 100)" } } }
}

private struct AddHoldingView: View { @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss; @State private var symbol = ""; @State private var type = "ETF"; @State private var quantity = ""; @State private var price = ""; @State private var currency = "USD"; var body: some View { NavigationStack { Form { TextField("Symbol", text: $symbol); TextField("Type (Stock, Fund, ETF)", text: $type); TextField("Quantity", text: $quantity); TextField("Purchase price", text: $price); CurrencyPicker(selection: $currency) }.navigationTitle("Add holding").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let q = Decimal(string: quantity), let p = Decimal(string: price) else { return }; store.addHolding(symbol: symbol.uppercased(), type: type, quantity: q, price: p, currencyCode: currency); dismiss() }.disabled(symbol.isEmpty || Decimal(string: quantity) == nil || Decimal(string: price) == nil) } }.frame(minHeight: 300) } } }
private struct AddPortfolioHistoryView: View { @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss; @State private var symbol = "Portfolio"; @State private var date = Date(); @State private var value = ""; @State private var currency = "USD"; var body: some View { NavigationStack { Form { TextField("Series name", text: $symbol); DatePicker("Snapshot date", selection: $date, displayedComponents: .date); TextField("Portfolio value on this date", text: $value); CurrencyPicker(selection: $currency) }.navigationTitle("Add portfolio history").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let amount = Decimal(string: value) else { return }; store.addPortfolioHistory(symbol: symbol, date: date, value: amount, currencyCode: currency); dismiss() }.disabled(Decimal(string: value) == nil) } }.frame(minHeight: 300) } } }

private struct PensionView: View {
    @EnvironmentObject private var store: AppDataStore; @State private var showingAdd = false; @State private var showingHistory = false; @State private var growth = ""; @State private var historyCurrency = "USD"
    private var historyPoints: [PensionHistoryRecord] { store.pensionHistory.filter { $0.currencyCode == historyCurrency }.sorted { $0.date < $1.date } }; private var currentValue: Decimal { store.pensions.filter { $0.currencyCode == historyCurrency }.reduce(.zero) { $0 + $1.value } }
    private var monthGrowth: String { growthText(previous: historyPoints.dropLast().last?.value, current: historyPoints.last?.value) }
    var body: some View { NavigationStack { List { Section("Historical trajectory") { if historyPoints.isEmpty { Text("No historical pension values yet.").foregroundStyle(.secondary) } else { Chart(historyPoints) { point in LineMark(x: .value("Date", point.date), y: .value("Value", decimalDouble(point.value))).foregroundStyle(.purple) }.frame(height: 210); Text("Latest month-on-month growth: \(monthGrowth)").font(.caption).foregroundStyle(.secondary) }; CurrencyPicker(selection: $historyCurrency); Button("Add historical pension value") { showingHistory = true } }; Section("Future projection") { TextField("Anticipated annual growth (%)", text: $growth); Button("Save growth assumption") { if let rate = Decimal(string: growth) { store.saveGrowthRates(portfolio: store.portfolioGrowthRate, pension: rate / 100) } }.disabled(Decimal(string: growth) == nil); Text("Projection compounds the current pension position annually.").font(.caption).foregroundStyle(.secondary); Chart(projectionPoints(value: currentValue, annualRate: store.pensionGrowthRate)) { point in LineMark(x: .value("Date", point.date), y: .value("Value", point.value)).foregroundStyle(.orange).lineStyle(StrokeStyle(dash: [5, 4])) }.frame(height: 180) }; Section("Pension pots") { if store.pensions.isEmpty { Text("Add a pension pot with +.").foregroundStyle(.secondary) }; ForEach(store.pensions) { pension in HStack { VStack(alignment: .leading) { Text(pension.name); Text("\(pension.provider) • \(pension.currencyCode)").font(.caption).foregroundStyle(.secondary) }; Spacer(); Text(pension.value, format: .currency(code: pension.currencyCode)) } } .onDelete(perform: store.deletePension) } }.navigationTitle("Pensions").toolbar { Button { showingAdd = true } label: { Label("Add pension", systemImage: "plus") } }.sheet(isPresented: $showingAdd) { AddPensionView() }.sheet(isPresented: $showingHistory) { AddPensionHistoryView() }.onAppear { growth = "\(store.pensionGrowthRate * 100)" } } }
}

private struct AddPensionView: View { @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss; @State private var name = ""; @State private var provider = ""; @State private var value = ""; @State private var currency = "USD"; var body: some View { NavigationStack { Form { TextField("Pension pot name", text: $name); TextField("Provider", text: $provider); TextField("Current value", text: $value); CurrencyPicker(selection: $currency) }.navigationTitle("Add pension pot").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let amount = Decimal(string: value) else { return }; store.addPension(name: name, provider: provider, value: amount, currencyCode: currency); dismiss() }.disabled(name.isEmpty || Decimal(string: value) == nil) } }.frame(minHeight: 300) } } }
private struct AddPensionHistoryView: View { @EnvironmentObject private var store: AppDataStore; @Environment(\.dismiss) private var dismiss; @State private var name = "Pension"; @State private var date = Date(); @State private var value = ""; @State private var currency = "USD"; var body: some View { NavigationStack { Form { TextField("Series name", text: $name); DatePicker("Snapshot date", selection: $date, displayedComponents: .date); TextField("Pension value on this date", text: $value); CurrencyPicker(selection: $currency) }.navigationTitle("Add pension history").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Add") { guard let amount = Decimal(string: value) else { return }; store.addPensionHistory(name: name, date: date, value: amount, currencyCode: currency); dismiss() }.disabled(Decimal(string: value) == nil) } }.frame(minHeight: 300) } } }

private struct ProjectionPoint: Identifiable { let date: Date; let value: Double; var id: Date { date } }
private func projectionPoints(value: Decimal, annualRate: Decimal) -> [ProjectionPoint] { (0...12).compactMap { month in guard let date = Calendar.current.date(byAdding: .month, value: month, to: .now) else { return nil }; let multiplier = pow(1 + NSDecimalNumber(decimal: annualRate).doubleValue, Double(month) / 12); return ProjectionPoint(date: date, value: NSDecimalNumber(decimal: value).doubleValue * multiplier) } }
private func decimalDouble(_ value: Decimal) -> Double { NSDecimalNumber(decimal: value).doubleValue }
private func growthText(previous: Decimal?, current: Decimal?) -> String { guard let previous, let current, previous != 0 else { return "Not enough data" }; let percentage = (NSDecimalNumber(decimal: (current - previous) / previous).doubleValue) * 100; return String(format: "%+.2f%%", percentage) }

private struct CurrencyPicker: View { @Binding var selection: String; var body: some View { Picker("Currency", selection: $selection) { ForEach(SupportedCurrency.allCases) { currency in Text("\(currency.rawValue) - \(currency.displayName)").tag(currency.rawValue) } } } }
