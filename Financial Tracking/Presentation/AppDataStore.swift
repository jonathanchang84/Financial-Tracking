import Foundation
import SwiftUI

@MainActor
final class AppDataStore: ObservableObject {
    @Published var bills: [BillRecord] = []
    @Published var commitments: [CommitmentRecord] = []
    @Published var netWorthEntries: [NetWorthRecord] = []
    @Published var netWorthHistory: [NetWorthHistoryRecord] = []
    @Published var holdings: [HoldingRecord] = []
    @Published var portfolioHistory: [PortfolioHistoryRecord] = []
    @Published var pensions: [PensionRecord] = []
    @Published var pensionHistory: [PensionHistoryRecord] = []
    @Published var currentAvailableBalance: Decimal = .zero
    @Published var currentBalanceCurrencyCode = "USD"
    @Published var nextPayDate = Date()
    @Published var portfolioGrowthRate: Decimal = 0.05
    @Published var pensionGrowthRate: Decimal = 0.05

    private let defaults = UserDefaults.standard
    private let ownerID = UUID()

    private enum Key {
        static let bills = "bills"
        static let commitments = "commitments"
        static let legacySpendRecords = "spendRecords"
        static let netWorthEntries = "netWorthEntries"
        static let netWorthHistory = "netWorthHistory"
        static let holdings = "holdings"
        static let portfolioHistory = "portfolioHistory"
        static let pensions = "pensions"
        static let pensionHistory = "pensionHistory"
    }

    init() {
        bills = load([BillRecord].self, key: Key.bills)
        commitments = load([CommitmentRecord].self, key: Key.commitments)
        if commitments.isEmpty { commitments = load([CommitmentRecord].self, key: Key.legacySpendRecords) }
        netWorthEntries = load([NetWorthRecord].self, key: Key.netWorthEntries)
        netWorthHistory = load([NetWorthHistoryRecord].self, key: Key.netWorthHistory)
        holdings = load([HoldingRecord].self, key: Key.holdings)
        portfolioHistory = load([PortfolioHistoryRecord].self, key: Key.portfolioHistory)
        pensions = load([PensionRecord].self, key: Key.pensions)
        pensionHistory = load([PensionHistoryRecord].self, key: Key.pensionHistory)
        currentAvailableBalance = defaults.object(forKey: "currentAvailableBalance") as? Decimal ?? .zero
        currentBalanceCurrencyCode = defaults.string(forKey: "currentBalanceCurrencyCode") ?? "USD"
        nextPayDate = defaults.object(forKey: "nextPayDate") as? Date ?? Calendar.current.date(byAdding: .day, value: 14, to: .now) ?? .now
        portfolioGrowthRate = defaults.object(forKey: "portfolioGrowthRate") as? Decimal ?? 0.05
        pensionGrowthRate = defaults.object(forKey: "pensionGrowthRate") as? Decimal ?? 0.05
    }

    // MARK: - Recurring bills

    func addBill(name: String, category: String, amount: Decimal, currencyCode: String, dueDay: Int) {
        bills.append(BillRecord(ownerID: ownerID, name: name, category: category, amount: amount, currencyCode: currencyCode, dueDay: dueDay))
        save(bills, key: Key.bills)
    }
    func updateBill(_ bill: BillRecord) { replace(bill, in: &bills); save(bills, key: Key.bills) }
    func deleteBill(at offsets: IndexSet) { bills.remove(atOffsets: offsets); save(bills, key: Key.bills) }

    // MARK: - Commitments (previously "daily spend")

    func addCommitment(name: String, date: Date, amount: Decimal, currencyCode: String) {
        commitments.append(CommitmentRecord(name: name, date: date, amount: amount, currencyCode: currencyCode))
        save(commitments, key: Key.commitments)
    }
    func updateCommitment(_ commitment: CommitmentRecord) { replace(commitment, in: &commitments); save(commitments, key: Key.commitments) }
    func deleteCommitment(at offsets: IndexSet) { commitments.remove(atOffsets: offsets); save(commitments, key: Key.commitments) }
    func deleteCommitment(id: UUID) { commitments.removeAll { $0.id == id }; save(commitments, key: Key.commitments) }

    func commitments(on date: Date, currencyCode: String, calendar: Calendar = .current) -> [CommitmentRecord] {
        commitments.filter { $0.currencyCode == currencyCode && calendar.isDate($0.date, inSameDayAs: date) }
    }
    func commitmentTotal(on date: Date, currencyCode: String, calendar: Calendar = .current) -> Decimal {
        commitments(on: date, currencyCode: currencyCode, calendar: calendar).reduce(.zero) { $0 + $1.amount }
    }

    // MARK: - Position (accounts, assets, and liabilities)

    func addNetWorth(name: String, institution: String, kind: NetWorthKind, value: Decimal, currencyCode: String) {
        netWorthEntries.append(NetWorthRecord(ownerID: ownerID, name: name, institution: institution, kind: kind, value: value, currencyCode: currencyCode))
        save(netWorthEntries, key: Key.netWorthEntries)
    }
    func updateNetWorth(_ entry: NetWorthRecord) { replace(entry, in: &netWorthEntries); save(netWorthEntries, key: Key.netWorthEntries) }
    func deleteNetWorth(at offsets: IndexSet) { netWorthEntries.remove(atOffsets: offsets); save(netWorthEntries, key: Key.netWorthEntries) }

    func addNetWorthHistory(series: String, date: Date, value: Decimal, currencyCode: String) {
        netWorthHistory.append(NetWorthHistoryRecord(series: series, date: date, value: value, currencyCode: currencyCode))
        save(netWorthHistory, key: Key.netWorthHistory)
    }
    func updateNetWorthHistory(_ record: NetWorthHistoryRecord) { replace(record, in: &netWorthHistory); save(netWorthHistory, key: Key.netWorthHistory) }
    func deleteNetWorthHistory(at offsets: IndexSet) { netWorthHistory.remove(atOffsets: offsets); save(netWorthHistory, key: Key.netWorthHistory) }
    func deleteNetWorthHistory(id: UUID) { netWorthHistory.removeAll { $0.id == id }; save(netWorthHistory, key: Key.netWorthHistory) }

    /// Updates a named account's current value and records a dated snapshot for that same name.
    func recordNetWorthUpdate(entryID: UUID, value: Decimal, date: Date) {
        guard let index = netWorthEntries.firstIndex(where: { $0.id == entryID }) else { return }
        netWorthEntries[index].value = value
        addNetWorthHistory(series: netWorthEntries[index].seriesName, date: date, value: value, currencyCode: netWorthEntries[index].currencyCode)
        save(netWorthEntries, key: Key.netWorthEntries)
    }

    // MARK: - Portfolio (holdings)

    func addHolding(name: String, symbol: String, type: String, quantity: Decimal, price: Decimal, currencyCode: String) {
        holdings.append(HoldingRecord(ownerID: ownerID, name: name, symbol: symbol, type: type, quantity: quantity, price: price, currencyCode: currencyCode))
        save(holdings, key: Key.holdings)
    }
    func updateHolding(_ holding: HoldingRecord) { replace(holding, in: &holdings); save(holdings, key: Key.holdings) }
    func deleteHolding(at offsets: IndexSet) { holdings.remove(atOffsets: offsets); save(holdings, key: Key.holdings) }

    func addPortfolioHistory(series: String, date: Date, value: Decimal, currencyCode: String) {
        portfolioHistory.append(PortfolioHistoryRecord(series: series, date: date, value: value, currencyCode: currencyCode))
        save(portfolioHistory, key: Key.portfolioHistory)
    }
    func updatePortfolioHistory(_ record: PortfolioHistoryRecord) { replace(record, in: &portfolioHistory); save(portfolioHistory, key: Key.portfolioHistory) }
    func deletePortfolioHistory(at offsets: IndexSet) { portfolioHistory.remove(atOffsets: offsets); save(portfolioHistory, key: Key.portfolioHistory) }
    func deletePortfolioHistory(id: UUID) { portfolioHistory.removeAll { $0.id == id }; save(portfolioHistory, key: Key.portfolioHistory) }

    /// Updates a named fund's unit price and records a dated snapshot of that fund's market value.
    func recordHoldingUpdate(holdingID: UUID, price: Decimal, date: Date) {
        guard let index = holdings.firstIndex(where: { $0.id == holdingID }) else { return }
        holdings[index].price = price
        addPortfolioHistory(series: holdings[index].seriesName, date: date, value: holdings[index].marketValue, currencyCode: holdings[index].currencyCode)
        save(holdings, key: Key.holdings)
    }

    // MARK: - Pensions

    func addPension(name: String, provider: String, value: Decimal, currencyCode: String) {
        pensions.append(PensionRecord(ownerID: ownerID, name: name, provider: provider, value: value, currencyCode: currencyCode))
        save(pensions, key: Key.pensions)
    }
    func updatePension(_ pension: PensionRecord) { replace(pension, in: &pensions); save(pensions, key: Key.pensions) }
    func deletePension(at offsets: IndexSet) { pensions.remove(atOffsets: offsets); save(pensions, key: Key.pensions) }

    func addPensionHistory(series: String, date: Date, value: Decimal, currencyCode: String) {
        pensionHistory.append(PensionHistoryRecord(series: series, date: date, value: value, currencyCode: currencyCode))
        save(pensionHistory, key: Key.pensionHistory)
    }
    func updatePensionHistory(_ record: PensionHistoryRecord) { replace(record, in: &pensionHistory); save(pensionHistory, key: Key.pensionHistory) }
    func deletePensionHistory(at offsets: IndexSet) { pensionHistory.remove(atOffsets: offsets); save(pensionHistory, key: Key.pensionHistory) }
    func deletePensionHistory(id: UUID) { pensionHistory.removeAll { $0.id == id }; save(pensionHistory, key: Key.pensionHistory) }

    /// Updates a named pension pot's value and records a dated valuation for that same pot.
    func recordPensionUpdate(pensionID: UUID, value: Decimal, date: Date) {
        guard let index = pensions.firstIndex(where: { $0.id == pensionID }) else { return }
        pensions[index].value = value
        addPensionHistory(series: pensions[index].seriesName, date: date, value: value, currencyCode: pensions[index].currencyCode)
        save(pensions, key: Key.pensions)
    }

    // MARK: - Runway inputs

    func saveCurrentBalance(_ balance: Decimal, currencyCode: String) {
        currentAvailableBalance = balance
        currentBalanceCurrencyCode = currencyCode
        defaults.set(balance, forKey: "currentAvailableBalance")
        defaults.set(currencyCode, forKey: "currentBalanceCurrencyCode")
    }
    func saveNextPayDate(_ date: Date) { nextPayDate = date; defaults.set(date, forKey: "nextPayDate") }
    func saveGrowthRates(portfolio: Decimal, pension: Decimal) {
        portfolioGrowthRate = portfolio
        pensionGrowthRate = pension
        defaults.set(portfolio, forKey: "portfolioGrowthRate")
        defaults.set(pension, forKey: "pensionGrowthRate")
    }

    // MARK: - Persistence helpers

    private func load<T: Codable>(_ type: [T].Type, key: String) -> [T] {
        guard let data = defaults.data(forKey: key), let values = try? JSONDecoder().decode([T].self, from: data) else { return [] }
        return values
    }
    private func replace<T: Identifiable>(_ value: T, in values: inout [T]) where T.ID == UUID {
        guard let index = values.firstIndex(where: { $0.id == value.id }) else { return }
        values[index] = value
    }
    private func save<T: Codable>(_ values: [T], key: String) { defaults.set(try? JSONEncoder().encode(values), forKey: key) }
}
enum SupportedCurrency: String, CaseIterable, Identifiable {
    case usd = "USD"; case eur = "EUR"; case gbp = "GBP"; case cad = "CAD"; case aud = "AUD"; case jpy = "JPY"; case chf = "CHF"; case cny = "CNY"; case inr = "INR"
    var id: Self { self }
    var displayName: String { Locale.current.localizedString(forCurrencyCode: rawValue) ?? rawValue }
}

enum NetWorthKind: String, Codable, CaseIterable, Identifiable { case asset = "Asset"; case liability = "Liability"; var id: Self { self } }

struct BillRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var name: String; var category: String; var amount: Decimal; var currencyCode: String; var dueDay: Int
    init(id: UUID = UUID(), ownerID: UUID, name: String, category: String, amount: Decimal, currencyCode: String = "USD", dueDay: Int) { self.id = id; self.ownerID = ownerID; self.name = name; self.category = category; self.amount = amount; self.currencyCode = currencyCode; self.dueDay = dueDay }
    enum CodingKeys: String, CodingKey { case id, ownerID, name, category, amount, currencyCode, dueDay }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); name = try c.decode(String.self, forKey: .name); category = try c.decode(String.self, forKey: .category); amount = try c.decode(Decimal.self, forKey: .amount); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD"; dueDay = try c.decode(Int.self, forKey: .dueDay) }
}

/// A named commitment: money already promised for a given date, e.g. "Car service".
struct CommitmentRecord: Identifiable, Codable, Hashable {
    let id: UUID; var name: String; var date: Date; var amount: Decimal; var currencyCode: String
    init(id: UUID = UUID(), name: String = "", date: Date, amount: Decimal, currencyCode: String = "USD") { self.id = id; self.name = name; self.date = date; self.amount = amount; self.currencyCode = currencyCode }
    var displayName: String { name.trimmingCharacters(in: .whitespaces).isEmpty ? "Commitment" : name }
    enum CodingKeys: String, CodingKey { case id, name, date, amount, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""; date = try c.decode(Date.self, forKey: .date); amount = try c.decode(Decimal.self, forKey: .amount); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}


struct NetWorthRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var name: String; var institution: String; var kind: NetWorthKind; var value: Decimal; var currencyCode: String
    init(id: UUID = UUID(), ownerID: UUID, name: String, institution: String, kind: NetWorthKind, value: Decimal, currencyCode: String = "USD") { self.id = id; self.ownerID = ownerID; self.name = name; self.institution = institution; self.kind = kind; self.value = value; self.currencyCode = currencyCode }
    /// Stable label used to keep this account's dated snapshots in a separate series, e.g. "Barclays savings".
    var seriesName: String { name.trimmingCharacters(in: .whitespaces).isEmpty ? "Account" : name }
    enum CodingKeys: String, CodingKey { case id, ownerID, name, institution, kind, value, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); name = try c.decode(String.self, forKey: .name); institution = try c.decode(String.self, forKey: .institution); kind = try c.decode(NetWorthKind.self, forKey: .kind); value = try c.decode(Decimal.self, forKey: .value); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}

struct HoldingRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var name: String; var symbol: String; var type: String; var quantity: Decimal; var price: Decimal; var currencyCode: String
    init(id: UUID = UUID(), ownerID: UUID, name: String = "", symbol: String, type: String, quantity: Decimal, price: Decimal, currencyCode: String = "USD") { self.id = id; self.ownerID = ownerID; self.name = name; self.symbol = symbol; self.type = type; self.quantity = quantity; self.price = price; self.currencyCode = currencyCode }
    var marketValue: Decimal { quantity * price }
    /// Stable label for this fund or investment account, e.g. "Fund 1".
    var seriesName: String { name.trimmingCharacters(in: .whitespaces).isEmpty ? symbol : name }
    enum CodingKeys: String, CodingKey { case id, ownerID, name, symbol, type, quantity, price, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""; symbol = try c.decode(String.self, forKey: .symbol); type = try c.decode(String.self, forKey: .type); quantity = try c.decode(Decimal.self, forKey: .quantity); price = try c.decode(Decimal.self, forKey: .price); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}

struct PensionRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var name: String; var provider: String; var value: Decimal; var currencyCode: String
    init(id: UUID = UUID(), ownerID: UUID, name: String, provider: String, value: Decimal, currencyCode: String = "USD") { self.id = id; self.ownerID = ownerID; self.name = name; self.provider = provider; self.value = value; self.currencyCode = currencyCode }
    /// Stable label for this pension pot, e.g. "Pension 1".
    var seriesName: String { name.trimmingCharacters(in: .whitespaces).isEmpty ? "Pension pot" : name }
    enum CodingKeys: String, CodingKey { case id, ownerID, name, provider, value, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); name = try c.decode(String.self, forKey: .name); provider = try c.decode(String.self, forKey: .provider); value = try c.decode(Decimal.self, forKey: .value); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}


/// Dated snapshot of one named account or pot. Older installs stored no series name.
struct NetWorthHistoryRecord: Identifiable, Codable, Hashable {
    let id: UUID; var series: String; var date: Date; var value: Decimal; var currencyCode: String
    init(id: UUID = UUID(), series: String, date: Date, value: Decimal, currencyCode: String) { self.id = id; self.series = series; self.date = date; self.value = value; self.currencyCode = currencyCode }
    enum CodingKeys: String, CodingKey { case id, series, date, value, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); series = try c.decodeIfPresent(String.self, forKey: .series) ?? "Net worth"; date = try c.decode(Date.self, forKey: .date); value = try c.decode(Decimal.self, forKey: .value); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}

struct PortfolioHistoryRecord: Identifiable, Codable, Hashable {
    let id: UUID; var series: String; var date: Date; var value: Decimal; var currencyCode: String
    init(id: UUID = UUID(), series: String, date: Date, value: Decimal, currencyCode: String) { self.id = id; self.series = series; self.date = date; self.value = value; self.currencyCode = currencyCode }
    enum CodingKeys: String, CodingKey { case id, series, date, value, currencyCode }
    private enum LegacyKeys: String, CodingKey { case symbol }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let legacy = try decoder.container(keyedBy: LegacyKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        series = try c.decodeIfPresent(String.self, forKey: .series) ?? legacy.decodeIfPresent(String.self, forKey: .symbol) ?? "Portfolio"
        date = try c.decode(Date.self, forKey: .date); value = try c.decode(Decimal.self, forKey: .value); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD"
    }
}

struct PensionHistoryRecord: Identifiable, Codable, Hashable {
    let id: UUID; var series: String; var date: Date; var value: Decimal; var currencyCode: String
    init(id: UUID = UUID(), series: String, date: Date, value: Decimal, currencyCode: String) { self.id = id; self.series = series; self.date = date; self.value = value; self.currencyCode = currencyCode }
    enum CodingKeys: String, CodingKey { case id, series, date, value, currencyCode }
    private enum LegacyKeys: String, CodingKey { case name }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let legacy = try decoder.container(keyedBy: LegacyKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        series = try c.decodeIfPresent(String.self, forKey: .series) ?? legacy.decodeIfPresent(String.self, forKey: .name) ?? "Pension"
        date = try c.decode(Date.self, forKey: .date); value = try c.decode(Decimal.self, forKey: .value); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD"
    }
}

