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
        try SampleData.seedIfEmpty(database)
        // Ensure the route toggle starts in a known state (shown) for deterministic test isolation.
        // This is a normal write and doesn't corrupt UserDefaults cache like removePersistentDomain would.
        UserDefaults.standard.set(true, forKey: "showRoute")
    }
}
