import Foundation

enum NetWorthEntryKind: String, CaseIterable, Identifiable {
    case asset
    case liability
    var id: Self { self }
}

struct NetWorthEntry: Identifiable, Hashable {
    let id: UUID
    let ownerID: UUID
    var name: String
    var institution: String
    var kind: NetWorthEntryKind
    var value: Money
    var asOf: Date
}

struct HoldingPosition: Identifiable, Hashable {
    let id: UUID
    let ownerID: UUID
    var symbol: String
    var assetType: String
    var quantity: Decimal
    var purchasePrice: Money
    var snapshotDate: Date
}

struct PensionPot: Identifiable, Hashable {
    let id: UUID
    let ownerID: UUID
    var name: String
    var provider: String
    var schemeType: String
}

struct PensionValuation: Identifiable, Hashable {
    let id: UUID
    let potID: UUID
    let ownerID: UUID
    var date: Date
    var value: Money
}