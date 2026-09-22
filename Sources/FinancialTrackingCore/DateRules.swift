import Foundation

public enum DateRules {
    public static func shiftedWeekendDate(_ date: Date, calendar: Calendar = .autoupdatingCurrent) -> Date {
        let weekday = calendar.component(.weekday, from: date)
        switch weekday {
        case 7: return calendar.date(byAdding: .day, value: 2, to: date) ?? date
        case 1: return calendar.date(byAdding: .day, value: 1, to: date) ?? date
        default: return date
        }
    }

    public static func dueDate(for bill: RecurringBill, in month: Date, calendar: Calendar = .autoupdatingCurrent) -> Date? {
        guard let range = calendar.range(of: .day, in: .month, for: month) else { return nil }
        let day = min(bill.dueDay, range.count)
        var components = calendar.dateComponents([.year, .month], from: month)
        components.day = day
        guard let rawDate = calendar.date(from: components) else { return nil }
        return shiftedWeekendDate(rawDate, calendar: calendar)
    }

    public static func dates(from start: Date, through end: Date, calendar: Calendar = .autoupdatingCurrent) -> [Date] {
        guard start <= end else { return [] }
        var result: [Date] = []
        var date = calendar.startOfDay(for: start)
        let last = calendar.startOfDay(for: end)
        while date <= last {
            result.append(date)
            guard let next = calendar.date(byAdding: .day, value: 1, to: date) else { break }
            date = next
        }
        return result
    }
}