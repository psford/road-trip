import Foundation
import GRDB

/// Optimistic photo mutations (design AC4): apply to the local cache for instant UI, call
/// the server, revert on failure. The view observes GRDB, so apply/revert reflect on the
/// map immediately.
struct PhotoMutations {
    let database: AppDatabase
    let keychain: KeychainStore
    var api: RoadTripAPI = .shared

    enum MutationError: Error, Equatable { case missingToken }

    private func token(for tripId: UUID) throws -> String {
        guard let token = (try? keychain.token(kind: .secret, tripId: tripId))?.uuidString.lowercased() else {
            throw MutationError.missingToken
        }
        return token
    }

    /// AC4.1/4.2: remove the photo immediately; re-insert it if the server delete fails.
    func deletePhoto(_ photo: Photo) async throws {
        let token = try token(for: photo.tripId)
        try await OptimisticMutation.run(
            apply: { try await database.dbQueue.write { db in _ = try Photo.deleteOne(db, key: photo.id) } },
            server: { try await api.deletePhoto(secretToken: token, photoId: photo.id) },
            revert: { try await database.dbQueue.write { db in try photo.insert(db) } })
    }

    /// AC4.3: move the pin immediately; revert on failure. On success applies the server's
    /// reverse-geocoded place name + coordinates.
    func moveLocation(_ photo: Photo, lat: Double, lng: Double) async throws {
        let token = try token(for: photo.tripId)
        let original = photo

        var optimistic = photo
        optimistic.lat = lat
        optimistic.lng = lng
        try await database.dbQueue.write { db in try optimistic.update(db) }

        do {
            let response = try await api.updatePhotoLocation(secretToken: token, photoId: photo.id, lat: lat, lng: lng)
            var updated = photo
            updated.lat = response.lat
            updated.lng = response.lng
            updated.placeName = response.placeName
            try await database.dbQueue.write { db in try updated.update(db) }
        } catch {
            try? await database.dbQueue.write { db in try original.update(db) }
            throw error
        }
    }
}
