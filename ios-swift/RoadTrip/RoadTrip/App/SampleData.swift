import Foundation
import GRDB

/// Seeds the local database with a couple of realistic trips + geotagged photos so
/// the UI renders a real, navigable app on the simulator without the backend.
/// Photo image URLs point at picsum.photos (deterministic by seed) — replaced by
/// real server URLs once the API client (Phase 3) lands.
enum SampleData {
    /// Inserts sample data only if the database has no trips yet (idempotent).
    static func seedIfEmpty(_ database: AppDatabase) throws {
        try database.dbQueue.write { db in
            guard try Trip.fetchCount(db) == 0 else { return }
            // Photo.id is the server's globally-unique photo id and the local primary key.
            // Sample photos use a high offset so they never collide with real photo ids
            // (which start at 1) when a real trip is imported alongside the samples.
            var photoId = 900_000_000

            func addTrip(name: String, description: String, slug: String,
                         createdDaysAgo: Int,
                         pins: [(lat: Double, lng: Double, place: String, caption: String)]) throws {
                let created = Date(timeIntervalSince1970: 1_718_000_000 - Double(createdDaysAgo) * 86_400)
                let trip = Trip(id: UUID(), name: name, description: description, slug: slug,
                                photoCount: pins.count, createdAt: created, cachedAt: Date(timeIntervalSince1970: 1_718_000_000))
                try trip.insert(db)
                for pin in pins {
                    let seed = "\(slug)\(photoId)"
                    let photo = Photo(
                        id: photoId,
                        tripId: trip.id,
                        thumbnailUrl: "https://picsum.photos/seed/\(seed)/200",
                        displayUrl: "https://picsum.photos/seed/\(seed)/600",
                        originalUrl: "https://picsum.photos/seed/\(seed)/1200",
                        lat: pin.lat, lng: pin.lng,
                        placeName: pin.place, caption: pin.caption,
                        takenAt: trip.createdAt, uploadId: nil)
                    try photo.insert(db)
                    photoId += 1
                }
            }

            try addTrip(
                name: "Pacific Coast Highway", description: "Big Sur in three days",
                slug: "pch", createdDaysAgo: 12,
                pins: [
                    (36.3615, -121.8563, "Bixby Bridge", "Classic stop on Highway 1"),
                    (36.5160, -121.9420, "Point Lobos", "Sea otters everywhere"),
                    (35.6580, -121.2530, "Piedras Blancas", "Elephant seal beach"),
                ])

            try addTrip(
                name: "Yellowstone Loop", description: "Geysers + wildlife",
                slug: "yellowstone", createdDaysAgo: 40,
                pins: [
                    (44.4605, -110.8281, "Old Faithful", "Erupted right on time"),
                    (44.7197, -110.6982, "Grand Prismatic", "Surreal colors"),
                    (44.8650, -110.4000, "Lamar Valley", "Bison herd at dusk"),
                    (44.7978, -110.7036, "Norris Basin", "Steam for miles"),
                ])

            // A trip with zero photos — exercises the TripDetailView "no photos yet"
            // empty-state + user-location framing (design AC5.4).
            try addTrip(
                name: "Weekend Getaway", description: "Planning in progress",
                slug: "weekend", createdDaysAgo: 200,
                pins: [])
        }
    }
}
