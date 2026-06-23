import SwiftUI

/// App entry point. Opens the on-device database, seeds sample data on first run
/// (so the UI renders without the backend), and shows the trip list.
@main
struct RoadTripApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var database: AppDatabase

    init() {
        // makeShared() opens (and migrates) the on-disk SQLite database.
        let db = try! AppDatabase.makeShared()
        // SampleData is seeded only for UI tests (`-uitest`); real launches start empty
        // so users only see real, uploadable trips. See AppBootstrap.
        let arguments = ProcessInfo.processInfo.arguments
        let isUITest = arguments.contains("-uitest")
        try? AppBootstrap.prepare(db, isUITest: isUITest,
                                  seedPendingUpload: arguments.contains("-uitest-pending-upload"))
        _database = State(initialValue: db)

        // Bind the background uploader to this database and resume any uploads left in flight
        // by a previous launch (backgrounded or force-quit) — runs on every cold start,
        // including a background relaunch. See BackgroundUploadSession / AppDelegate.
        BackgroundUploadSession.configureShared(database: db)
        BackgroundUploadSession.shared?.reconcile()
    }

    var body: some Scene {
        WindowGroup {
            TripListView(database: database)
        }
    }
}
