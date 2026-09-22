import SwiftUI

@main
struct FinancialTrackingApp: App {
    private let persistenceController = PersistenceController()
    @StateObject private var store = AppDataStore()

    var body: some Scene {
        WindowGroup {
            FeatureTabsView()
                .environment(\.managedObjectContext, persistenceController.container.viewContext)
                .environmentObject(store)
        }
    }
}