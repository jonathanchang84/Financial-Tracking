import XCTest

final class FinancialTrackingCoreTests: XCTestCase {
    func testWeekendDueDateMovesToMonday() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let month = calendar.date(from: DateComponents(year: 2026, month: 9, day: 1))!
        let owner = UUID()
        let bill = RecurringBill(ownerID: owner, name: "Rent", category: "Housing", amount: Money(minorUnits: 100_00), dueDay: 5)

        let dueDate = DateRules.dueDate(for: bill, in: month, calendar: calendar)!

        XCTAssertEqual(calendar.component(.weekday, from: dueDate), 2)
        XCTAssertEqual(calendar.component(.day, from: dueDate), 7)
    }

    func testRunwaySubtractsRemainingBillsAndActualSpend() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let today = calendar.date(from: DateComponents(year: 2026, month: 9, day: 10))!
        let owner = UUID()
        let bill = RecurringBill(ownerID: owner, name: "Internet", category: "Utilities", amount: Money(minorUnits: 50_00), dueDay: 15)
        let occurrence = RunwayEngine.occurrences(bills: [bill], month: today, calendar: calendar)[0]
        let payday = calendar.date(byAdding: .day, value: 5, to: today)!
        let spendDate = calendar.startOfDay(for: today)

        let projection = RunwayEngine.project(
            availableBalance: Money(minorUnits: 500_00), occurrences: [occurrence], today: today,
            nextPayday: payday, actualSpendByDate: [spendDate: Money(minorUnits: 10_00)], calendar: calendar
        )

        XCTAssertEqual(projection.endOfMonthBalance.minorUnits, 450_00)
        XCTAssertEqual(projection.dailyBudget.minorUnits, 100_00)
        XCTAssertEqual(projection.points.first?.projectedBalance.minorUnits, 490_00)
    }

    func testSCDVersionClosesCurrentRecord() {
        var version = SCDVersion(ownerID: UUID())
        let closeDate = Date(timeIntervalSince1970: 100)

        version.close(at: closeDate)

        XCTAssertFalse(version.currentFlag)
        XCTAssertEqual(version.validTo, closeDate)
    }
}