import Foundation

public struct Money: Codable, Hashable, Sendable {
    public let minorUnits: Int64
    public let currencyCode: String

    public init(minorUnits: Int64, currencyCode: String = "USD") {
        self.minorUnits = minorUnits
        self.currencyCode = currencyCode.uppercased()
    }

    public init(decimal: Decimal, currencyCode: String = "USD") {
        self.init(minorUnits: NSDecimalNumber(decimal: decimal * 100).int64Value, currencyCode: currencyCode)
    }

    public static let zero = Money(minorUnits: 0)

    public static func + (lhs: Money, rhs: Money) -> Money {
        precondition(lhs.currencyCode == rhs.currencyCode, "Cannot add different currencies")
        return Money(minorUnits: lhs.minorUnits + rhs.minorUnits, currencyCode: lhs.currencyCode)
    }

    public static func - (lhs: Money, rhs: Money) -> Money {
        precondition(lhs.currencyCode == rhs.currencyCode, "Cannot subtract different currencies")
        return Money(minorUnits: lhs.minorUnits - rhs.minorUnits, currencyCode: lhs.currencyCode)
    }
}