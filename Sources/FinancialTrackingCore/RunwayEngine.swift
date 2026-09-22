import Foundation

public enum RunwayEngine {
    public static func occurrences(
        bills: [RecurringBill],
        month: Date,
        calendar: Calendar = .autoupdatingCurrent
    ) -> [BillOccurrence] {
        bills.filter(\.active).compactMap { bill in
            guard let dueDate = DateRules.dueDate(for: bill, in: month, calendar: calendar) else { return nil }
            return BillOccurrence(
                id: UUID(), billID: bill.id, ownerID: bill.ownerID, dueDate: dueDate,
                amount: bill.amount, status: .unpaid
            )
        }.sorted { $0.dueDate < $1.dueDate }
    }

    public static func project(
        availableBalance: Money,
        occurrences: [BillOccurrence],
        today: Date,
        nextPayday: Date,
        actualSpendByDate: [Date: Money] = [:],
        calendar: Calendar = .autoupdatingCurrent
    ) -> RunwayProjection {
        let remainingBills = occurrences.filter { $0.status == .unpaid && $0.dueDate >= today }
            .reduce(Money(minorUnits: 0, currencyCode: availableBalance.currencyCode)) { $0 + $1.amount }
        let daysUntilPayday = max(1, calendar.dateComponents([.day], from: today, to: nextPayday).day ?? 1)
        let dailyBudget = Money(minorUnits: availableBalance.minorUnits / Int64(daysUntilPayday), currencyCode: availableBalance.currencyCode)
        let monthEnd = calendar.date(byAdding: DateComponents(month: 1, day: -1), to: today) ?? today
        let dates = DateRules.dates(from: today, through: monthEnd, calendar: calendar)
        var balance = availableBalance
        var points: [DailyRunwayPoint] = []
        var cumulativeActual = Money(minorUnits: 0, currencyCode: availableBalance.currencyCode)

        for date in dates {
            let billsDue = occurrences.filter { $0.status == .unpaid && calendar.isDate($0.dueDate, inSameDayAs: date) }
                .reduce(Money(minorUnits: 0, currencyCode: availableBalance.currencyCode)) { $0 + $1.amount }
            let actualSpend = actualSpendByDate[calendar.startOfDay(for: date)]
                ?? Money(minorUnits: 0, currencyCode: availableBalance.currencyCode)
            balance = balance - billsDue - actualSpend
            cumulativeActual = cumulativeActual + actualSpend
            let target = Money(minorUnits: dailyBudget.minorUnits * Int64(points.count + 1), currencyCode: dailyBudget.currencyCode)
            points.append(DailyRunwayPoint(date: date, projectedBalance: balance, targetSpendable: target, actualSpend: cumulativeActual))
        }
        return RunwayProjection(endOfMonthBalance: availableBalance - remainingBills, dailyBudget: dailyBudget, points: points)
    }
}