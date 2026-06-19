import SwiftUI

/// App entry point. Opens the on-device database, seeds sample data on first run
/// (so the UI renders without the backend), and shows the trip list.
@main
struct RoadTripApp: App {
    @State private var database: AppDatabase

    init() {
        // makeShared() opens (and migrates) the on-disk SQLite database.
        let db = try! AppDatabase.makeShared()
        // SampleData is seeded only for UI tests (`-uitest`); real launches start empty
        // so users only see real, uploadable trips. See AppBootstrap.
        let isUITest = ProcessInfo.processInfo.arguments.contains("-uitest")
        try? AppBootstrap.prepare(db, isUITest: isUITest)
        _database = State(initialValue: db)
    }

    var body: some Scene {
        WindowGroup {
            TripListView(database: database)
        }
    }
}
