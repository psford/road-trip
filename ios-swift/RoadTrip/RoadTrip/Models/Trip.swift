import Foundation
import GRDB

/// A trip the device knows about. Mirrors the server's `TripResponse`, plus a local
/// identity and cache bookkeeping.
///
/// The SecretToken / ViewToken are deliberately **not** stored here — they live in
/// the Keychain (see `KeychainStore`), keyed by this `id`. That keeps raw tokens out
/// of the on-disk database.
///
/// Swift note: this is a `struct` (a value type — copied on assignment), conforming to
/// `Codable` (auto JSON/DB encode-decode) and GRDB's record protocols below.
struct Trip: Codable, Identifiable, Equatable {
    /// Device-generated stable identity. Exists for both created trips and trips
    /// imported via a pasted token (where the server returns no slug). Stored as a
    /// 16-byte blob in SQLite.
    var id: UUID

    var name: String
    var description: String?

    /// Server slug. Known when we create a trip (`CreateTripResponse.slug`); `nil`
    /// when the trip was imported via a pasted SecretToken (`TripResponse` has no slug).
    var slug: String?

    /// Number of photos the server reports for this trip (`TripResponse.photoCount`).
    var photoCount: Int

    /// Server-side creation time (`TripResponse.createdAt`). Drives list sort order.
    var createdAt: Date

    /// When this row was last refreshed from the server (stale-while-revalidate).
    var cachedAt: Date
}

// MARK: - GRDB persistence

extension Trip: FetchableRecord, PersistableRecord {
    static let databaseTableName = "trip"
}
