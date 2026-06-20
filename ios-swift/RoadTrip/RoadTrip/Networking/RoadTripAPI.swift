import Foundation
import GRDB

/// Typed entrypoint to the Road Trip backend (design Phase 3, `native-ios.AC1.3`).
///
/// Minimal first slice: import-by-token reads used to hydrate the local GRDB cache
/// from a real trip on the server. Base URL targets the local dev backend
/// (`dotnet run` on :5100); the simulator shares the host network so `localhost` works.
actor RoadTripAPI {
    static let shared = RoadTripAPI()

    /// Base URL per build configuration (local / dev slot / prod) — see `APIEnvironment`.
    let baseURL: URL

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL = APIEnvironment.baseURL) {
        self.baseURL = baseURL
        self.session = URLSession(configuration: .ephemeral)
        // Request bodies with dates (exif.takenAt → .NET DateTimeOffset) use ISO-8601.
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder
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

    /// `POST /api/trips` — creates a trip server-side and returns its slug + tokens.
    func createTrip(name: String, description: String?) async throws -> CreateTripResponse {
        try await post("/api/trips", body: CreateTripRequest(name: name, description: description))
    }

    /// `GET /api/post/{secretToken}` — trip metadata for an owned (upload) token.
    func tripForPost(secretToken: String) async throws -> TripResponse {
        try await get("/api/post/\(secretToken)")
    }

    /// `GET /api/post/{secretToken}/photos` — photos for an owned token.
    func photosForPost(secretToken: String) async throws -> [PhotoResponse] {
        try await get("/api/post/\(secretToken)/photos")
    }

    /// `DELETE /api/trips/{secretToken}` — deletes the trip server-side (204 No Content).
    /// Path-token auth: the server authorizes by matching the path's secret token.
    func deleteTrip(secretToken: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("/api/trips/\(secretToken)"))
        request.httpMethod = "DELETE"
        try await sendVoid(request)
    }

    /// `DELETE …/photos/{id}` — deletes one committed photo (204). Int photo id.
    func deletePhoto(secretToken: String, photoId: Int) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent(
            "/api/trips/\(secretToken.lowercased())/photos/\(photoId)"))
        request.httpMethod = "DELETE"
        try await sendVoid(request)
    }

    /// `PATCH …/photos/{id}/location` — moves a committed photo; the server reverse-geocodes
    /// and returns the updated `PhotoResponse`.
    func updatePhotoLocation(secretToken: String, photoId: Int, lat: Double, lng: Double) async throws -> PhotoResponse {
        try await send(jsonRequest(
            "/api/trips/\(secretToken.lowercased())/photos/\(photoId)/location",
            method: "PATCH", body: UpdateLocationRequest(lat: lat, lng: lng)))
    }

    // MARK: - Resilient upload (Phase 6). Path tokens lowercased for the case-sensitive auth.

    /// `POST …/photos/request-upload` — registers the upload and returns SAS URLs + block size.
    /// Idempotent on `uploadId`.
    func requestUpload(_ body: RequestUploadRequest, secretToken: String) async throws -> RequestUploadResponse {
        try await post("/api/trips/\(secretToken.lowercased())/photos/request-upload", body: body)
    }

    /// `POST …/photos/{photoId}/commit` — commits the uploaded block list. The server
    /// finalizes the original blob and regenerates any missing display/thumb tiers.
    func commitUpload(secretToken: String, photoId: String, blockIds: [String]) async throws {
        try await postVoid("/api/trips/\(secretToken.lowercased())/photos/\(photoId)/commit",
                           body: CommitRequest(blockIds: blockIds))
    }

    /// `POST …/photos/{photoId}/abort` — cancels an in-progress upload (idempotent, 204).
    func abortUpload(secretToken: String, photoId: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent(
            "/api/trips/\(secretToken.lowercased())/photos/\(photoId)/abort"))
        request.httpMethod = "POST"
        try await sendVoid(request)
    }

    /// PUTs one block to an Azure (or Azurite) SAS URL. Mirrors the web client's transport:
    /// `?comp=block&blockid=<b64>`, `x-ms-blob-type: BlockBlob`, 201 = success.
    /// The block id is percent-encoded so base64 `+`, `/`, `=` survive as query values.
    /// Throws `UploadTransportError` so the runner can retry / refresh / abort appropriately;
    /// a network-layer failure maps to `.retryable` (likely transient connectivity).
    func putBlock(sasUrl: String, blockId: String, data: Data) async throws {
        let encodedId = blockId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? blockId
        let separator = sasUrl.contains("?") ? "&" : "?"
        guard let url = URL(string: "\(sasUrl)\(separator)comp=block&blockid=\(encodedId)") else {
            throw UploadTransportError.permanent(status: -1)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("BlockBlob", forHTTPHeaderField: "x-ms-blob-type")
        request.httpBody = data
        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw UploadTransportError.retryable(status: -1)
            }
            if let error = UploadTransportError.classify(status: http.statusCode) { throw error }
        } catch let error as UploadTransportError {
            throw error
        } catch {
            throw UploadTransportError.retryable(status: -1)   // network drop → retry with backoff
        }
    }

    /// Absolute URL for a server-relative media path (e.g. `/api/photos/1/2/thumb`).
    nonisolated func absoluteURL(forPath path: String) -> String {
        if path.hasPrefix("http") { return path }
        return baseURL.absoluteString + path
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(URLRequest(url: baseURL.appendingPathComponent(path)))
    }

    private func post<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        return try await send(jsonRequest(path, method: "POST", body: body))
    }

    /// POST a JSON body where the response has no useful content to decode (2xx = success).
    private func postVoid<Body: Encodable>(_ path: String, body: Body) async throws {
        try await sendVoid(jsonRequest(path, method: "POST", body: body))
    }

    private func jsonRequest<Body: Encodable>(_ path: String, method: String, body: Body) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(body)
        return request
    }

    /// Shared transport for requests with no response body to decode (e.g. DELETE → 204).
    private func sendVoid(_ request: URLRequest) async throws {
        do {
            let (_, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw RoadTripAPIError.serverError("No HTTP response")
            }
            switch http.statusCode {
            case 200..<300: return
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

    /// Shared transport: runs the request, maps HTTP status to typed errors, decodes JSON.
    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)
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

struct CreateTripRequest: Encodable {
    let name: String
    let description: String?
}

struct CreateTripResponse: Codable {
    let slug: String
    let secretToken: String
    let viewToken: String
    let viewUrl: String
    let postUrl: String
}

struct ExifDTO: Encodable {
    let gpsLat: Double?
    let gpsLon: Double?
    let takenAt: Date?
}

struct RequestUploadRequest: Encodable {
    let uploadId: String
    let filename: String
    let contentType: String
    let sizeBytes: Int64
    let exif: ExifDTO?
}

struct RequestUploadResponse: Decodable {
    let photoId: String
    let sasUrl: String
    let displaySasUrl: String
    let thumbSasUrl: String
    let blobPath: String
    let maxBlockSizeBytes: Int
    let serverVersion: String
    let clientMinVersion: String
}

struct CommitRequest: Encodable {
    let blockIds: [String]
}

struct UpdateLocationRequest: Encodable {
    let lat: Double
    let lng: Double
}

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

// MARK: - Trip orchestration (API + Keychain + GRDB)
//
// These methods own the full write path for a trip: call the server, persist the
// SecretToken/ViewToken to the Keychain (never to GRDB), and upsert the local cache.
// Views/view models call these rather than juggling the three stores themselves.

extension RoadTripAPI {
    /// Pure parser: extracts a view token UUID from a server viewUrl path.
    /// Input: nil, empty, "/trips/{uuid}", "https://host/trips/{uuid}", "/trips/{uuid}?x=1", etc.
    /// Strips query strings (`?...`) and fragments (`#...`) before parsing.
    /// Returns: the UUID if the last path component is a valid UUID; nil otherwise.
    /// No I/O, deterministic, idempotent.
    nonisolated static func viewToken(fromViewUrl viewUrl: String?) -> UUID? {
        guard let viewUrl = viewUrl, !viewUrl.isEmpty else { return nil }
        // Strip query string and fragment before splitting
        let cleaned = viewUrl
            .split(separator: "?", maxSplits: 1)[0]  // Remove ?query...
            .split(separator: "#", maxSplits: 1)[0]  // Remove #fragment...
        let components = cleaned.split(separator: "/").map(String.init)
        guard let last = components.last, !last.isEmpty else { return nil }
        return UUID(uuidString: last)
    }

    /// AC4.2: Extract the first UUID found in arbitrary text (pure function).
    /// Handles messy paste: bare UUID, sentence with UUID, URL path with UUID, etc.
    /// Input: any string, may contain whitespace, newlines, other text.
    /// Returns: the first valid UUID found (canonical format: 8-4-4-4-12 hex), or nil.
    /// Implementation: uses regex to find the UUID pattern, then validates with UUID(uuidString:).
    /// No I/O, deterministic, idempotent.
    nonisolated static func firstUUID(in text: String) -> UUID? {
        let uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
        guard let range = text.range(of: uuidPattern, options: .regularExpression) else {
            return nil
        }
        let uuidString = String(text[range])
        return UUID(uuidString: uuidString)
    }

    /// Testable seam: stores a view token parsed from viewUrl, if present.
    /// Parses `viewUrl` using `viewToken(fromViewUrl:)` and stores the result if non-nil.
    /// No-ops silently if viewUrl is nil, empty, or contains no valid UUID (AC2.4).
    /// Never throws — best-effort writes to keychain.
    nonisolated func storeViewToken(from viewUrl: String?, tripId: UUID, keychain: KeychainStore) {
        guard let viewToken = Self.viewToken(fromViewUrl: viewUrl) else { return }
        try? keychain.setToken(viewToken, kind: .view, tripId: tripId)
    }

    /// AC1.1: create a trip on the server, store its tokens in the Keychain, and insert
    /// the local Trip row. Returns the inserted Trip. Throws on any server/Keychain error
    /// (the caller surfaces it; no partial local state is written on failure).
    func createTrip(name: String, description: String?,
                    into database: AppDatabase, keychain: KeychainStore) async throws -> Trip {
        let response = try await createTrip(name: name, description: description)
        let tripId = UUID()
        // Tokens are GUIDs from the server; tolerate either if the server ever changes format.
        if let secret = UUID(uuidString: response.secretToken) {
            try keychain.setToken(secret, kind: .secret, tripId: tripId)
        }
        if let view = UUID(uuidString: response.viewToken) {
            try keychain.setToken(view, kind: .view, tripId: tripId)
        }
        let trip = Trip(id: tripId, name: name, description: description,
                        slug: response.slug, photoCount: 0,
                        createdAt: Date(), cachedAt: Date())
        try await database.dbQueue.write { db in try trip.insert(db) }
        return trip
    }

    /// AC1.3: import a trip the device doesn't own yet via a pasted SecretToken. Fetches
    /// trip + photos, stores the token in the Keychain, and upserts a fresh local trip.
    /// `tokenString` must be a GUID; an invalid/unknown token surfaces as a thrown error
    /// (AC1.5) with no Keychain or GRDB write.
    /// AC2.2: Also parses and stores the view token from viewUrl if present; a missing
    /// viewUrl does not abort the import (AC2.4 — import still succeeds).
    /// AC4.2: Falls back to extracting the first UUID from messy pasted text if bare-UUID
    /// parse fails; throws .notFound if no UUID is found (AC4.3).
    func importTrip(tokenString: String,
                    into database: AppDatabase, keychain: KeychainStore) async throws -> Trip {
        let trimmed = tokenString.trimmingCharacters(in: .whitespacesAndNewlines)
        // AC4.1: Try bare-UUID parse first (the happy path).
        let secret = UUID(uuidString: trimmed) ?? Self.firstUUID(in: trimmed)
        guard let secret else { throw RoadTripAPIError.notFound }

        // Fetch first; only touch local stores once the server confirms the token is valid.
        let tripDTO = try await tripForPost(secretToken: trimmed)
        let photoDTOs = try await photosForPost(secretToken: trimmed)

        let tripId = UUID()
        try keychain.setToken(secret, kind: .secret, tripId: tripId)
        // AC2.2: Store view token if available; nil viewUrl is not an error (AC2.4).
        storeViewToken(from: tripDTO.viewUrl, tripId: tripId, keychain: keychain)
        let trip = Trip(id: tripId, name: tripDTO.name, description: tripDTO.description,
                        slug: nil, photoCount: tripDTO.photoCount,
                        createdAt: tripDTO.createdAt, cachedAt: Date())
        let photos = mapPhotos(photoDTOs, tripId: tripId)
        try await database.dbQueue.write { db in
            try trip.insert(db)
            for photo in photos { try photo.insert(db) }
        }
        return trip
    }

    /// Stale-while-revalidate: refresh one already-owned trip's metadata + photos in place.
    /// Best-effort — failures leave the existing cache untouched.
    /// AC2.3: If the trip lacks a view token, backfill it from the server's viewUrl.
    func revalidate(tripId: UUID, secretToken: String, into database: AppDatabase,
                    keychain: KeychainStore) async {
        do {
            let tripDTO = try await tripForPost(secretToken: secretToken)
            let photoDTOs = try await photosForPost(secretToken: secretToken)
            let photos = mapPhotos(photoDTOs, tripId: tripId)
            try await database.dbQueue.write { db in
                guard var trip = try Trip.fetchOne(db, key: tripId) else { return }
                trip.name = tripDTO.name
                trip.description = tripDTO.description
                trip.photoCount = tripDTO.photoCount
                trip.createdAt = tripDTO.createdAt
                trip.cachedAt = Date()
                try trip.update(db)
                try Photo.filter(Column("tripId") == tripId).deleteAll(db)
                for photo in photos { try photo.insert(db) }
            }
            // AC2.3: Backfill view token if missing (best-effort, swallow errors).
            let existingView = (try? keychain.token(kind: .view, tripId: tripId)) ?? nil
            if existingView == nil, let viewToken = Self.viewToken(fromViewUrl: tripDTO.viewUrl) {
                try? keychain.setToken(viewToken, kind: .view, tripId: tripId)
            }
        } catch {
            print("revalidate(\(tripId)): \(error)")
        }
    }

    /// AC1.4: delete a trip. For an owned trip (secret token in the Keychain) the server
    /// `DELETE` runs first; a 404 means it's already gone, so cleanup still proceeds. Then
    /// the local Trip row is removed (photos cascade via FK) and both Keychain tokens are
    /// cleared. Sample/local-only trips (no token) delete locally only. Any other server
    /// error throws with no local change, so the caller can surface it and retry.
    func deleteTrip(_ trip: Trip, from database: AppDatabase, keychain: KeychainStore) async throws {
        if let token = try? keychain.token(kind: .secret, tripId: trip.id) {
            do {
                // Server tokens are lowercase and its auth check is a case-sensitive string
                // compare; `UUID.uuidString` is uppercase, so send the canonical lowercase form.
                try await deleteTrip(secretToken: token.uuidString.lowercased())
            } catch RoadTripAPIError.notFound {
                // Already deleted server-side — fall through to local cleanup.
            }
        }
        try await Self.deleteLocally(tripId: trip.id, from: database, keychain: keychain)
    }

    /// Local-only cleanup for a deleted trip: removes the Trip row (photos cascade via the
    /// `onDelete: .cascade` FK) and both Keychain tokens. Split out so the local-state
    /// guarantee is unit-testable without a server.
    nonisolated static func deleteLocally(tripId: UUID, from database: AppDatabase,
                                          keychain: KeychainStore) async throws {
        try await database.dbQueue.write { db in
            _ = try Trip.deleteOne(db, key: tripId)
        }
        try keychain.removeAll(tripId: tripId)
    }

    /// Maps server photo DTOs to local records, resolving relative media paths to absolute URLs.
    private func mapPhotos(_ dtos: [PhotoResponse], tripId: UUID) -> [Photo] {
        let base = baseURL.absoluteString
        return dtos.map { p in
            Photo(id: p.id, tripId: tripId,
                  thumbnailUrl: base + p.thumbnailUrl,
                  displayUrl: base + p.displayUrl,
                  originalUrl: base + p.originalUrl,
                  lat: p.lat, lng: p.lng, placeName: p.placeName,
                  caption: p.caption, takenAt: p.takenAt, uploadId: nil)
        }
    }
}
