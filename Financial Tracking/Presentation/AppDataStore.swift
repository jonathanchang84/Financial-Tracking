import Foundation
import SwiftUI

@MainActor
final class AppDataStore: ObservableObject {
    @Published var bills: [BillRecord] = []
    @Published var netWorthEntries: [NetWorthRecord] = []
    @Published var holdings: [HoldingRecord] = []
    @Published var pensions: [PensionRecord] = []
    @Published var currentAvailableBalance: Decimal = .zero
    @Published var currentBalanceCurrencyCode = "USD"
    @Published var nextPayDate = Date()
    @Published var spendRecords: [SpendRecord] = []
    @Published var netWorthHistory: [NetWorthHistoryRecord] = []
    @Published var portfolioHistory: [PortfolioHistoryRecord] = []
    @Published var pensionHistory: [PensionHistoryRecord] = []
    @Published var portfolioGrowthRate: Decimal = 0.05
    @Published var pensionGrowthRate: Decimal = 0.05

    private let defaults = UserDefaults.standard
    private let ownerID = UUID()

    init() {
        bills = load(BillRecord.self, key: "bills")
        netWorthEntries = load(NetWorthRecord.self, key: "netWorthEntries")
        holdings = load(HoldingRecord.self, key: "holdings")
        pensions = load(PensionRecord.self, key: "pensions")
        currentAvailableBalance = defaults.object(forKey: "currentAvailableBalance") as? Decimal ?? .zero
        currentBalanceCurrencyCode = defaults.string(forKey: "currentBalanceCurrencyCode") ?? "USD"
        nextPayDate = defaults.object(forKey: "nextPayDate") as? Date ?? Calendar.current.date(byAdding: .day, value: 14, to: .now)!
        spendRecords = load(SpendRecord.self, key: "spendRecords")
        netWorthHistory = load(NetWorthHistoryRecord.self, key: "netWorthHistory")
        portfolioHistory = load(PortfolioHistoryRecord.self, key: "portfolioHistory")
        pensionHistory = load(PensionHistoryRecord.self, key: "pensionHistory")
        portfolioGrowthRate = defaults.object(forKey: "portfolioGrowthRate") as? Decimal ?? 0.05
        pensionGrowthRate = defaults.object(forKey: "pensionGrowthRate") as? Decimal ?? 0.05
    }

    func addBill(name: String, category: String, amount: Decimal, currencyCode: String, dueDay: Int) {
        bills.append(BillRecord(ownerID: ownerID, name: name, category: category, amount: amount, currencyCode: currencyCode, dueDay: dueDay)); save(bills, key: "bills")
    }
    func addNetWorth(name: String, institution: String, kind: NetWorthKind, value: Decimal, currencyCode: String) {
        netWorthEntries.append(NetWorthRecord(ownerID: ownerID, name: name, institution: institution, kind: kind, value: value, currencyCode: currencyCode)); save(netWorthEntries, key: "netWorthEntries")
    }
    func addHolding(symbol: String, type: String, quantity: Decimal, price: Decimal, currencyCode: String) {
        holdings.append(HoldingRecord(ownerID: ownerID, symbol: symbol, type: type, quantity: quantity, price: price, currencyCode: currencyCode)); save(holdings, key: "holdings")
    }
    func addPension(name: String, provider: String, value: Decimal, currencyCode: String) {
        pensions.append(PensionRecord(ownerID: ownerID, name: name, provider: provider, value: value, currencyCode: currencyCode)); save(pensions, key: "pensions")
    }
    func updateBill(_ bill: BillRecord) { replace(bill, in: &bills); save(bills, key: "bills") }
    func updateNetWorth(_ entry: NetWorthRecord) { replace(entry, in: &netWorthEntries); save(netWorthEntries, key: "netWorthEntries") }
    func updateHolding(_ holding: HoldingRecord) { replace(holding, in: &holdings); save(holdings, key: "holdings") }
    func updatePension(_ pension: PensionRecord) { replace(pension, in: &pensions); save(pensions, key: "pensions") }
    func saveCurrentBalance(_ balance: Decimal, currencyCode: String) {
        currentAvailableBalance = balance
        currentBalanceCurrencyCode = currencyCode
        defaults.set(balance, forKey: "currentAvailableBalance")
        defaults.set(currencyCode, forKey: "currentBalanceCurrencyCode")
    }
    func saveNextPayDate(_ date: Date) { nextPayDate = date; defaults.set(date, forKey: "nextPayDate") }
    func addSpend(date: Date, amount: Decimal, currencyCode: String) { spendRecords.append(SpendRecord(date: date, amount: amount, currencyCode: currencyCode)); save(spendRecords, key: "spendRecords") }
    func addNetWorthHistory(date: Date, value: Decimal, currencyCode: String) { netWorthHistory.append(NetWorthHistoryRecord(date: date, value: value, currencyCode: currencyCode)); save(netWorthHistory, key: "netWorthHistory") }
    func addPortfolioHistory(symbol: String, date: Date, value: Decimal, currencyCode: String) { portfolioHistory.append(PortfolioHistoryRecord(symbol: symbol, date: date, value: value, currencyCode: currencyCode)); save(portfolioHistory, key: "portfolioHistory") }
    func addPensionHistory(name: String, date: Date, value: Decimal, currencyCode: String) { pensionHistory.append(PensionHistoryRecord(name: name, date: date, value: value, currencyCode: currencyCode)); save(pensionHistory, key: "pensionHistory") }
    func saveGrowthRates(portfolio: Decimal, pension: Decimal) { portfolioGrowthRate = portfolio; pensionGrowthRate = pension; defaults.set(portfolio, forKey: "portfolioGrowthRate"); defaults.set(pension, forKey: "pensionGrowthRate") }
    func deleteBill(at offsets: IndexSet) { bills.remove(atOffsets: offsets); save(bills, key: "bills") }
    func deleteNetWorth(at offsets: IndexSet) { netWorthEntries.remove(atOffsets: offsets); save(netWorthEntries, key: "netWorthEntries") }
    func deleteHolding(at offsets: IndexSet) { holdings.remove(atOffsets: offsets); save(holdings, key: "holdings") }
    func deletePension(at offsets: IndexSet) { pensions.remove(atOffsets: offsets); save(pensions, key: "pensions") }

    private func load<T: Codable>(_ type: T.Type, key: String) -> [T] {
        guard let data = defaults.data(forKey: key), let value = try? JSONDecoder().decode([T].self, from: data) else { return [] }
        return value
    }
    private func replace<T: Identifiable>(_ value: T, in values: inout [T]) where T.ID == UUID {
        guard let index = values.firstIndex(where: { $0.id == value.id }) else { return }
        values[index] = value
    }
    private func save<T: Codable>(_ value: [T], key: String) { defaults.set(try? JSONEncoder().encode(value), forKey: key) }
}

enum SupportedCurrency: String, CaseIterable, Identifiable {
    case usd = "USD"; case eur = "EUR"; case gbp = "GBP"; case cad = "CAD"; case aud = "AUD"; case jpy = "JPY"; case chf = "CHF"; case cny = "CNY"; case inr = "INR"
    var id: Self { self }
    var displayName: String { Locale.current.localizedString(forCurrencyCode: rawValue) ?? rawValue }
}

struct BillRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var name: String; var category: String; var amount: Decimal; var currencyCode: String; var dueDay: Int
    init(id: UUID = UUID(), ownerID: UUID, name: String, category: String, amount: Decimal, currencyCode: String = "USD", dueDay: Int) { self.id = id; self.ownerID = ownerID; self.name = name; self.category = category; self.amount = amount; self.currencyCode = currencyCode; self.dueDay = dueDay }
    enum CodingKeys: String, CodingKey { case id, ownerID, name, category, amount, currencyCode, dueDay }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); name = try c.decode(String.self, forKey: .name); category = try c.decode(String.self, forKey: .category); amount = try c.decode(Decimal.self, forKey: .amount); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD"; dueDay = try c.decode(Int.self, forKey: .dueDay) }
}
enum NetWorthKind: String, Codable, CaseIterable, Identifiable { case asset = "Asset"; case liability = "Liability"; var id: Self { self } }
struct NetWorthRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var name: String; var institution: String; var kind: NetWorthKind; var value: Decimal; var currencyCode: String
    init(id: UUID = UUID(), ownerID: UUID, name: String, institution: String, kind: NetWorthKind, value: Decimal, currencyCode: String = "USD") { self.id = id; self.ownerID = ownerID; self.name = name; self.institution = institution; self.kind = kind; self.value = value; self.currencyCode = currencyCode }
    enum CodingKeys: String, CodingKey { case id, ownerID, name, institution, kind, value, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); name = try c.decode(String.self, forKey: .name); institution = try c.decode(String.self, forKey: .institution); kind = try c.decode(NetWorthKind.self, forKey: .kind); value = try c.decode(Decimal.self, forKey: .value); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}
struct HoldingRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var symbol: String; var type: String; var quantity: Decimal; var price: Decimal; var currencyCode: String
    init(id: UUID = UUID(), ownerID: UUID, symbol: String, type: String, quantity: Decimal, price: Decimal, currencyCode: String = "USD") { self.id = id; self.ownerID = ownerID; self.symbol = symbol; self.type = type; self.quantity = quantity; self.price = price; self.currencyCode = currencyCode }
    enum CodingKeys: String, CodingKey { case id, ownerID, symbol, type, quantity, price, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); symbol = try c.decode(String.self, forKey: .symbol); type = try c.decode(String.self, forKey: .type); quantity = try c.decode(Decimal.self, forKey: .quantity); price = try c.decode(Decimal.self, forKey: .price); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}
struct PensionRecord: Identifiable, Codable, Hashable {
    let id: UUID; let ownerID: UUID; var name: String; var provider: String; var value: Decimal; var currencyCode: String
    init(id: UUID = UUID(), ownerID: UUID, name: String, provider: String, value: Decimal, currencyCode: String = "USD") { self.id = id; self.ownerID = ownerID; self.name = name; self.provider = provider; self.value = value; self.currencyCode = currencyCode }
    enum CodingKeys: String, CodingKey { case id, ownerID, name, provider, value, currencyCode }
    init(from decoder: Decoder) throws { let c = try decoder.container(keyedBy: CodingKeys.self); id = try c.decode(UUID.self, forKey: .id); ownerID = try c.decode(UUID.self, forKey: .ownerID); name = try c.decode(String.self, forKey: .name); provider = try c.decode(String.self, forKey: .provider); value = try c.decode(Decimal.self, forKey: .value); currencyCode = try c.decodeIfPresent(String.self, forKey: .currencyCode) ?? "USD" }
}

struct SpendRecord: Identifiable, Codable, Hashable { let id: UUID; var date: Date; var amount: Decimal; var currencyCode: String; init(id: UUID = UUID(), date: Date, amount: Decimal, currencyCode: String) { self.id = id; self.date = date; self.amount = amount; self.currencyCode = currencyCode } }
struct NetWorthHistoryRecord: Identifiable, Codable, Hashable { let id: UUID; var date: Date; var value: Decimal; var currencyCode: String; init(id: UUID = UUID(), date: Date, value: Decimal, currencyCode: String) { self.id = id; self.date = date; self.value = value; self.currencyCode = currencyCode } }
struct PortfolioHistoryRecord: Identifiable, Codable, Hashable { let id: UUID; var symbol: String; var date: Date; var value: Decimal; var currencyCode: String; init(id: UUID = UUID(), symbol: String, date: Date, value: Decimal, currencyCode: String) { self.id = id; self.symbol = symbol; self.date = date; self.value = value; self.currencyCode = currencyCode } }
struct PensionHistoryRecord: Identifiable, Codable, Hashable { let id: UUID; var name: String; var date: Date; var value: Decimal; var currencyCode: String; init(id: UUID = UUID(), name: String, date: Date, value: Decimal, currencyCode: String) { self.id = id; self.name = name; self.date = date; self.value = value; self.currencyCode = currencyCode } }