import Foundation

/// Launch-time database preparation.
///
/// `SampleData` trips are local-only fixtures with no Keychain token and no server
/// identity, so they can't accept uploads/mutations — presenting them in real runs made
/// "Add Photo" fail with "No upload token for this trip". They're therefore seeded ONLY
/// for UI tests (`-uitest`), which also reset to a deterministic state. Real launches
/// (incl. TestFlight) start empty; the user creates or imports real trips.
enum AppBootstrap {
    static func prepare(_ database: AppDatabase, isUITest: Bool) throws {
        guard isUITest else { return }   // real launches: no sample data
        try database.wipeAllData()
        // Reset UserDefaults so @AppStorage UI state is deterministic (e.g. showRoute, selected filters).
        // This runs BEFORE the first view renders, ensuring test isolation even across multiple test runs.
        UserDefaults.standard.removePersistentDomain(forName: Bundle.main.bundleIdentifier!)
        try SampleData.seedIfEmpty(database)
    }
}
