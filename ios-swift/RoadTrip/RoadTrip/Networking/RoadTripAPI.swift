import Foundation

/// Typed entrypoint to the Road Trip backend (design Phase 3, `native-ios.AC1.3`).
///
/// Minimal first slice: import-by-token reads used to hydrate the local GRDB cache
/// from a real trip on the server. Base URL targets the local dev backend
/// (`dotnet run` on :5100); the simulator shares the host network so `localhost` works.
actor RoadTripAPI {
    static let shared = RoadTripAPI()

    /// Local dev backend. (Prod/dev-slot base URL config is a later step.)
    let baseURL: URL

    private let session: URLSession
    private let decoder: JSONDecoder

    init(baseURL: URL = URL(string: "http://localhost:5100")!) {
        self.baseURL = baseURL
        self.session = URLSession(configuration: .ephemeral)
        let decoder = JSONDecoder()
        // .NET serializes DateTime without a timezone (e.g. "2026-06-18T05:55:11.12"),
        // which Swift's .iso8601 rejects — parse flexibly so hydration doesn't silently fail.
        decoder.dateDecodingStrategy = .custom { d in
            let container = try d.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = RoadTripAPI.parseDate(raw) { return date }
            throw DecodingError.dataCorruptedError(in: container,
                debugDescription: "Unparseable date: \(raw)")
        }
        self.decoder = decoder
    }

    /// Parses ISO-8601 (with/without fractional seconds) and .NET's timezone-less format.
    nonisolated static func parseDate(_ s: String) -> Date? {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = iso.date(from: s) { return d }
        iso.formatOptions = [.withInternetDateTime]
        if let d = iso.date(from: s) { return d }
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(identifier: "UTC")
        for fmt in ["yyyy-MM-dd'T'HH:mm:ss.SSSSSSS", "yyyy-MM-dd'T'HH:mm:ss.SSS", "yyyy-MM-dd'T'HH:mm:ss"] {
            df.dateFormat = fmt
            if let d = df.date(from: s) { return d }
        }
        return nil
    }

    /// `GET /api/post/{secretToken}` — trip metadata for an owned (upload) token.
    func tripForPost(secretToken: String) async throws -> TripResponse {
        try await get("/api/post/\(secretToken)")
    }

    /// `GET /api/post/{secretToken}/photos` — photos for an owned token.
    func photosForPost(secretToken: String) async throws -> [PhotoResponse] {
        try await get("/api/post/\(secretToken)/photos")
    }

    /// Absolute URL for a server-relative media path (e.g. `/api/photos/1/2/thumb`).
    nonisolated func absoluteURL(forPath path: String) -> String {
        if path.hasPrefix("http") { return path }
        return baseURL.absoluteString + path
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse else {
                throw RoadTripAPIError.serverError("No HTTP response")
            }
            switch http.statusCode {
            case 200..<300:
                do { return try decoder.decode(T.self, from: data) }
                catch { throw RoadTripAPIError.serverError("Decode failed: \(error)") }
            case 401: throw RoadTripAPIError.unauthorized
            case 404: throw RoadTripAPIError.notFound
            default: throw RoadTripAPIError.serverError("HTTP \(http.statusCode)")
            }
        } catch let error as RoadTripAPIError {
            throw error
        } catch {
            throw RoadTripAPIError.networkUnavailable
        }
    }
}

enum RoadTripAPIError: Error, Equatable {
    case unauthorized
    case notFound
    case networkUnavailable
    case serverError(String)
}

// MARK: - DTOs (match the .NET server's camelCase JSON)

struct TripResponse: Codable {
    let name: String
    let description: String?
    let photoCount: Int
    let createdAt: Date
    let viewUrl: String?
}

struct PhotoResponse: Codable {
    let id: Int
    let thumbnailUrl: String
    let displayUrl: String
    let originalUrl: String
    let lat: Double
    let lng: Double
    let placeName: String
    let caption: String?
    let takenAt: Date?
}

// MARK: - Demo hydration (AC1.3 slice: import a real trip into the local cache)

extension RoadTripAPI {
    /// SecretToken of the trip seeded on the local backend, baked in for the demo so
    /// the app loads real server data on launch instead of `SampleData`.
    static let demoSecretToken = "e0213ab5-2018-4ecc-9c90-f0ab1533d4bc"

    /// Pulls the demo trip + photos from the backend and replaces the local cache so
    /// the UI shows real server data. Best-effort: on any failure the existing local
    /// cache (e.g. SampleData) is left untouched.
    func hydrateDemoTrip(into database: AppDatabase) async {
        do {
            let tripDTO = try await tripForPost(secretToken: Self.demoSecretToken)
            let photoDTOs = try await photosForPost(secretToken: Self.demoSecretToken)

            let tripId = UUID()
            let base = baseURL.absoluteString
            let trip = Trip(id: tripId, name: tripDTO.name, description: tripDTO.description,
                            slug: nil, photoCount: tripDTO.photoCount,
                            createdAt: tripDTO.createdAt, cachedAt: Date())
            let photos = photoDTOs.map { p in
                Photo(id: p.id, tripId: tripId,
                      thumbnailUrl: base + p.thumbnailUrl,
                      displayUrl: base + p.displayUrl,
                      originalUrl: base + p.originalUrl,
                      lat: p.lat, lng: p.lng, placeName: p.placeName,
                      caption: p.caption, takenAt: p.takenAt, uploadId: nil)
            }

            try await database.dbQueue.write { db in
                try Photo.deleteAll(db)
                try Trip.deleteAll(db)
                try trip.insert(db)
                for photo in photos { try photo.insert(db) }
            }
        } catch {
            print("hydrateDemoTrip: \(error)")
        }
    }
}
