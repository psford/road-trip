import SwiftUI

/// App entry point. Opens the on-device database, seeds sample data on first run
/// (so the UI renders without the backend), and shows the trip list.
@main
struct RoadTripApp: App {
    @State private var database: AppDatabase

    init() {
        // makeShared() opens (and migrates) the on-disk SQLite database.
        let db = try! AppDatabase.makeShared()
        try? SampleData.seedIfEmpty(db)
        _database = State(initialValue: db)
    }

    var body: some Scene {
        WindowGroup {
            TripListView(database: database)
        }
    }
}
