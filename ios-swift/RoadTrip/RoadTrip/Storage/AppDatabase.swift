import Foundation
import GRDB

/// Owns the app's single GRDB connection for its lifetime and runs migrations on init.
///
/// `DatabaseQueue` serializes all reads/writes onto one connection — simple and
/// correct for this app's access patterns. Use `makeShared()` in the app and
/// `makeInMemory()` in tests.
///
/// `@unchecked Sendable`: the only stored property is an immutable, thread-safe GRDB
/// `DatabaseQueue`, so sharing an `AppDatabase` across actors/tasks is safe.
final class AppDatabase: @unchecked Sendable {
    /// The migrated GRDB connection. Read with `dbQueue.read { db in ... }` and write
    /// with `dbQueue.write { db in ... }`.
    let dbQueue: DatabaseQueue

    /// Wraps an existing queue and applies all migrations. Throws if a migration fails.
    init(_ dbQueue: DatabaseQueue) throws {
        self.dbQueue = dbQueue
        try AppMigrator.makeMigrator().migrate(dbQueue)
    }

    /// On-disk database under Application Support (persists across launches, not purged
    /// by the system the way Caches can be).
    static func makeShared() throws -> AppDatabase {
        let fm = FileManager.default
        let appSupport = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
        let dbURL = appSupport.appendingPathComponent("roadtrip.sqlite")
        let dbQueue = try DatabaseQueue(path: dbURL.path)
        return try AppDatabase(dbQueue)
    }

    /// Throwaway in-memory database for unit tests (a path-less `DatabaseQueue`).
    static func makeInMemory() throws -> AppDatabase {
        try AppDatabase(try DatabaseQueue())
    }

    /// Test-only: clears every row so a `-uitest` launch starts from a known state
    /// (the on-disk DB otherwise persists created/imported trips across launches,
    /// making UI tests non-deterministic). SampleData reseeds afterward when empty.
    func wipeAllData() throws {
        try dbQueue.write { db in
            try Photo.deleteAll(db)
            try UploadQueueItem.deleteAll(db)
            try Trip.deleteAll(db)
        }
    }
}
