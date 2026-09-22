import Foundation

public struct OwnerScope: Hashable, Codable, Sendable {
    public let id: UUID

    public init(id: UUID) { self.id = id }
}

public struct SCDVersion: Codable, Hashable, Sendable {
    public let logicalID: UUID
    public let ownerID: UUID
    public let validFrom: Date
    public var validTo: Date?
    public var currentFlag: Bool

    public init(logicalID: UUID = UUID(), ownerID: UUID, validFrom: Date = .now) {
        self.logicalID = logicalID
        self.ownerID = ownerID
        self.validFrom = validFrom
        self.validTo = nil
        self.currentFlag = true
    }

    public mutating func close(at date: Date) {
        validTo = date
        currentFlag = false
    }
}

public enum BillPaymentStatus: String, Codable, CaseIterable, Sendable {
    case unpaid
    case paid
}

public struct RecurringBill: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public let ownerID: UUID
    public var name: String
    public var category: String
    public var amount: Money
    public var dueDay: Int
    public var active: Bool
    public var version: SCDVersion

    public init(
        id: UUID = UUID(),
        ownerID: UUID,
        name: String,
        category: String,
        amount: Money,
        dueDay: Int,
        active: Bool = true,
        version: SCDVersion? = nil
    ) {
        precondition((1...31).contains(dueDay), "dueDay must be between 1 and 31")
        self.id = id
        self.ownerID = ownerID
        self.name = name
        self.category = category
        self.amount = amount
        self.dueDay = dueDay
        self.active = active
        self.version = version ?? SCDVersion(logicalID: id, ownerID: ownerID)
    }
}

public struct BillOccurrence: Identifiable, Hashable, Sendable {
    public let id: UUID
    public let billID: UUID
    public let ownerID: UUID
    public let dueDate: Date
    public var amount: Money
    public var status: BillPaymentStatus
}

public struct DailyRunwayPoint: Identifiable, Hashable, Sendable {
    public let date: Date
    public let projectedBalance: Money
    public let targetSpendable: Money
    public let actualSpend: Money
    public var id: Date { date }
}

public struct RunwayProjection: Hashable, Sendable {
    public let endOfMonthBalance: Money
    public let dailyBudget: Money
    public let points: [DailyRunwayPoint]
}