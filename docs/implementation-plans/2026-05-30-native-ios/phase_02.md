# Native iOS — Phase 2: Typed API Client (`RoadTripAPI`) Implementation Plan

**Goal:** One typed `actor RoadTripAPI` that is the single entrypoint to every server endpoint the native client consumes, with Codable DTOs, a `x-server-version`/`x-client-min-version` gate, and a typed error taxonomy. Every method has a `URLProtocol`-stubbed unit test for each error case and a happy-path integration test against the dev slot.

**Architecture:** Functional-core / imperative-shell: the actor owns `URLSession.shared` (the side-effecting shell), pure request-building and response-decoding helpers are testable in isolation. Two-token URL-path auth, unchanged from the server. The actor reads its base URL from `AppConfig.apiBaseURL` (Phase 1, Debug = dev slot). Foreground HTTP uses `async/await`; background block PUTs are NOT here (they belong to Phase 6's background `URLSession`).

**Tech Stack:** Swift 5.9 actor, `Foundation` `URLSession`/`Codable`/`URLProtocol` (Foundation compiles on Linux for draft unit testing, but the authoritative build + stubbed tests run on Mac), GRDB unaffected.

**Scope:** Phase 2 of 8.

**Codebase verified:** 2026-06-18.

---

## Verified contract facts (the server is fixed — match these exactly)

Source: `src/RoadTripMap/Program.cs`, `src/RoadTripMap/Endpoints/UploadEndpoints.cs`, `src/RoadTripMap/Models/UploadDtos.cs`. All routes are Minimal API. Auth = the GUID in the URL path (no Bearer). Responses carry `x-server-version`, `x-client-min-version`, `x-correlation-id`.

| Method | Route | Request body | Success | Errors |
|---|---|---|---|---|
| createTrip | `POST /api/trips` | `{name, description?}` | 200 `{slug, secretToken, viewToken, viewUrl, postUrl}` | 400 |
| tripForPost | `GET /api/post/{secretToken}` | — | 200 `{name, description?, photoCount, createdAt, viewUrl}` | 404 |
| tripForView | `GET /api/trips/view/{viewToken}` | — | 200 `{name, description?, photoCount, createdAt}` | 404 |
| deleteTrip | `DELETE /api/trips/{secretToken}` | — | 204 | 401, 404 |
| photosForPost | `GET /api/post/{secretToken}/photos` | — | 200 `PhotoResponse[]` | 404 |
| photosForView | `GET /api/trips/view/{viewToken}/photos` | — | 200 `PhotoResponse[]` | 404 |
| deletePhoto | `DELETE /api/trips/{secretToken}/photos/{id:int}` | — | 204 | 401, 404 |
| pinDrop | `POST /api/trips/{secretToken}/photos/{photoId:guid}/pin-drop` | `{gpsLat, gpsLon}` | 200 `PhotoResponse` | 400, 401, 404, **409** (only on committed photos) |
| requestUpload | `POST /api/trips/{secretToken}/photos/request-upload` | `{uploadId, filename, contentType, sizeBytes, exif:{gpsLat?, gpsLon?, takenAt?}}` | 200 `RequestUploadResponse` | 400, 401, 404 |
| commitUpload | `POST /api/trips/{secretToken}/photos/{photoId:guid}/commit` | `{blockIds:[string]}` | 200 `PhotoResponse` | 400 `{error:"BlockListMismatch"}`, 401, 404 |
| abortUpload | `POST /api/trips/{secretToken}/photos/{photoId:guid}/abort` | — | 204 (idempotent) | 401, 404 |
| poi | `GET /api/poi?minLat&maxLat&minLng&maxLng&zoom` | — | 200 `[{id,name,category,lat,lng}]` (max 200) | 400 |
| parkBoundaries | `GET /api/park-boundaries?minLat&maxLat&minLng&maxLng&zoom&detail?` | — | 200 GeoJSON FeatureCollection (empty if zoom<8; max 50) | 400 |
| version | `GET /api/version` | — | 200 `{server_version, client_min_version}` | — |

**Exact JSON shapes (match field names verbatim — server uses camelCase for trip/photo, snake_case for version):**

- **CreateTripResponse:** `{ "slug": string, "secretToken": string(uuid), "viewToken": string(uuid), "viewUrl": "/trips/{viewToken}", "postUrl": "/post/{secretToken}" }`
- **TripResponse (post):** `{ "name": string, "description": string?, "photoCount": int, "createdAt": iso8601, "viewUrl": string }` (view variant omits `viewUrl`).
- **PhotoResponse:** `{ "id": int, "uploadId": string(uuid)?, "thumbnailUrl": string, "displayUrl": string, "originalUrl": string, "lat": double, "lng": double, "placeName": string, "caption": string?, "takenAt": iso8601? }` — tier URLs are server-relative (`/api/photos/{tripId}/{photoId}/{size}`); the client prefixes `AppConfig.apiBaseURL`.
- **RequestUploadResponse:** `{ "photoId": string(uuid, == input uploadId), "sasUrl": string, "displaySasUrl": string?, "thumbSasUrl": string?, "blobPath": string, "maxBlockSizeBytes": int, "serverVersion": string, "clientMinVersion": string }`.
- **VersionResponse:** `{ "server_version": string, "client_min_version": string }`.

`takenAt`/`createdAt` are ISO-8601 UTC; the server may emit fractional seconds → use a custom decoding strategy that tolerates both `…Z` and `….SSSZ` (a `DateFormatter` chain or `ISO8601DateFormatter` with/without `.withFractionalSeconds`), not the bare `.iso8601` strategy which rejects fractional seconds.

---

## Acceptance Criteria Coverage

**Verifies: None directly** — this is the infrastructure networking layer. The design's "Done when" requires per-method dev-slot happy-path tests + `URLProtocol`-stubbed error-case unit tests (401→`unauthorized`, 404→`notFound`, 500→`serverError`, offline→`networkUnavailable`, version mismatch→`versionMismatch`). Endpoints here are exercised end-to-end by ACs in later phases (AC1, AC3, AC4, AC8, etc.).

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) — DTOs, error taxonomy, request/response core -->

<!-- START_TASK_1 -->
### Task 1: Codable DTOs

**Verifies:** None (types; the Swift compiler verifies these — no unit tests for the structs themselves).

**Environment:** Draftable in-container; built on Mac.

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/DTOs/TripDTOs.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/DTOs/PhotoDTOs.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/DTOs/UploadDTOs.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/DTOs/MapDTOs.swift` (POI + GeoJSON FeatureCollection + VersionResponse)
- Modify: `ios-swift/RoadTrip/project.yml` only if a new source group needs declaring (XcodeGen auto-includes files under the target's source path — verify the `Networking/` tree is picked up; it should be with `createIntermediateGroups: true`).

**Implementation:**
Define `Codable` structs matching the JSON above exactly. Key points:
- `CreateTripRequest { name: String; description: String? }`, `CreateTripResponse { slug; secretToken: UUID; viewToken: UUID; viewUrl; postUrl }` (decode UUID from the 36-char string — `UUID` is `Codable` and decodes from a UUID string).
- `TripResponse { name; description: String?; photoCount: Int; createdAt: Date; viewUrl: String? }` (one struct; `viewUrl` optional covers both post/view variants).
- `PhotoResponse { id: Int; uploadId: UUID?; thumbnailUrl; displayUrl; originalUrl: String; lat; lng: Double; placeName: String; caption: String?; takenAt: Date? }`.
- `RequestUploadRequest { uploadId: UUID; filename; contentType: String; sizeBytes: Int64; exif: ExifPayload }`, `ExifPayload { gpsLat: Double?; gpsLon: Double?; takenAt: Date? }`, `RequestUploadResponse { photoId: UUID; sasUrl: String; displaySasUrl: String?; thumbSasUrl: String?; blobPath: String; maxBlockSizeBytes: Int; serverVersion: String; clientMinVersion: String }`.
- `CommitRequest { blockIds: [String] }`, `PinDropRequest { gpsLat: Double; gpsLon: Double }`.
- `PoiDTO { id: Int; name: String; category: String; lat: Double; lng: Double }`.
- `VersionResponse` with `CodingKeys` mapping `server_version`/`client_min_version` (snake_case).
- GeoJSON: a minimal `FeatureCollection`/`Feature`/`Geometry` decoder (Phase 4 consumes it; define the structs here so the API method can return a typed value). Coordinates are `[[[Double]]]` (Polygon) or `[[[[Double]]]]` (MultiPolygon) — decode geometry as an enum with associated coordinate arrays, or keep `coordinates` as a `JSONValue`-ish type and parse in Phase 4. Simplest robust approach: `Geometry { type: String; coordinates: GeoCoordinates }` where `GeoCoordinates` is a custom `Decodable` that tries Polygon then MultiPolygon. Document the choice.

**Verification (Mac):** project builds. No standalone tests (types).

**Commit:** `feat(ios): Codable DTOs for RoadTripAPI`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Error taxonomy + response mapping core (pure, unit-tested)

**Verifies:** the error-mapping half of the design "Done when" (status→typed error).

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/RoadTripAPIError.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/ResponseMapper.swift` (pure functions)
- Create: `ios-swift/RoadTrip/RoadTripTests/ResponseMapperTests.swift`

**Implementation:**
```swift
enum RoadTripAPIError: Error, Equatable {
    case unauthorized            // 401
    case notFound                // 404
    case conflict                // 409 (pin-drop on non-committed)
    case blockListMismatch       // 400 with {"error":"BlockListMismatch"}
    case badRequest(String?)     // other 400
    case networkUnavailable      // URLError offline
    case serverError(String)     // 5xx
    case versionMismatch         // client < x-client-min-version
    case decodingFailed(String)
}
```
Pure mapper functions (Functional Core — no I/O, fully unit-testable on Linux or Mac):
- `mapStatus(_ status: Int, body: Data?) -> RoadTripAPIError?` → returns the typed error for non-2xx, `nil` for 2xx. 401→`.unauthorized`, 404→`.notFound`, 409→`.conflict`, 400→ parse body: if `{"error":"BlockListMismatch"}` → `.blockListMismatch` else `.badRequest(message)`, 5xx→`.serverError(message)`.
- `isVersionMismatch(clientVersion:, minVersionHeader:) -> Bool` → semantic-version compare; `true` when client < min. Include a small semver compare helper.
- `mapURLError(_ error: URLError) -> RoadTripAPIError` → `.notConnectedToInternet`/`.networkConnectionLost`/`.timedOut` → `.networkUnavailable`; else `.serverError(error.localizedDescription)`.

**Testing (ResponseMapperTests):**
- `mapStatus` returns `.unauthorized` for 401, `.notFound` for 404, `.conflict` for 409, `.blockListMismatch` for a 400 BlockListMismatch body, `.badRequest` for other 400s, `.serverError` for 500, `nil` for 200/204.
- `isVersionMismatch`: `("1.0.0", "1.1.0") == true`, `("1.1.0","1.1.0") == false`, `("2.0.0","1.5.0") == false`.
- `mapURLError(.notConnectedToInternet) == .networkUnavailable`.

**Verification (Mac, also runnable in-container with `swift test` if a Linux SwiftPM shim exists):**
```bash
cd ios-swift/RoadTrip && xcodebuild test -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:RoadTripTests/ResponseMapperTests
```
Expected: all mapper tests pass.

**Commit:** `feat(ios): RoadTripAPIError taxonomy + pure ResponseMapper (+tests)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: `RoadTripAPI` actor + request builder

**Verifies:** None alone (exercised by Tasks 4-5).

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/RoadTripAPI.swift`
- Create: `ios-swift/RoadTrip/RoadTrip/Networking/RequestBuilder.swift` (pure URLRequest construction)

**Implementation:**
- `RequestBuilder` (pure): `func makeRequest(baseURL:, method:, path:, query:[URLQueryItem]?, body:Encodable?) -> URLRequest` setting `Content-Type: application/json` for bodies, JSON-encoding with the shared encoder. Pure → unit-testable (assert URL, method, body bytes).
- `actor RoadTripAPI`:
  ```swift
  actor RoadTripAPI {
      private let baseURL: URL
      private let session: URLSession
      private let clientVersion: String           // from AppConfig (CURRENT_PROJECT_VERSION / MARKETING_VERSION)
      init(baseURL: URL = AppConfig.apiBaseURL, session: URLSession = .shared, clientVersion: String = AppConfig.clientVersion)
      // each method builds a request, awaits session.data(for:), checks the version header gate,
      // maps non-2xx via ResponseMapper, decodes the DTO on 2xx.
  }
  ```
  All 12 methods from the contract table. Signatures per the design:
  ```swift
  func createTrip(_ r: CreateTripRequest) async throws -> CreateTripResponse
  func tripForPost(secretToken: UUID) async throws -> TripResponse
  func tripForView(viewToken: UUID) async throws -> TripResponse
  func deleteTrip(secretToken: UUID) async throws
  func photosForPost(secretToken: UUID) async throws -> [PhotoResponse]
  func photosForView(viewToken: UUID) async throws -> [PhotoResponse]
  func deletePhoto(secretToken: UUID, photoId: Int) async throws
  func pinDrop(secretToken: UUID, photoId: UUID, lat: Double, lng: Double) async throws -> PhotoResponse
  func requestUpload(_ r: RequestUploadRequest, secretToken: UUID) async throws -> RequestUploadResponse
  func commitUpload(secretToken: UUID, photoId: UUID, blockIds: [String]) async throws -> PhotoResponse
  func abortUpload(secretToken: UUID, photoId: UUID) async throws
  func version() async throws -> VersionResponse
  func poi(bbox:..., zoom: Int) async throws -> [PoiDTO]          // Phase 4 also uses these two
  func parkBoundaries(bbox:..., zoom: Int, detail: String?) async throws -> FeatureCollection
  ```
- A single private `perform<T: Decodable>(_ request:) async throws -> T` that: awaits `session.data(for:)`, casts to `HTTPURLResponse`, runs the version-header gate (read `x-client-min-version`, compare to `clientVersion`, throw `.versionMismatch` if client is lower), maps non-2xx via `ResponseMapper.mapStatus`, and decodes `T` (throwing `.decodingFailed` on failure). A `performVoid` variant for 204 endpoints. Wrap `session.data` calls so a thrown `URLError` is mapped via `ResponseMapper.mapURLError`.
- **LogSanitizer convention:** do NOT `print`/`OSLog` raw secret tokens, SAS URLs, blob paths, or GPS. If logging, log only the path template and status. (Code-review check per CLAUDE.md.)

**Verification (Mac):** builds. Behavior in Tasks 4-5.

**Commit:** `feat(ios): RoadTripAPI actor + RequestBuilder`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) — stubbed unit tests + dev-slot integration tests -->

<!-- START_TASK_4 -->
### Task 4: `URLProtocol`-stubbed unit tests for every method + error case

**Verifies:** the design "Done when" error-case requirement for each endpoint.

**Files:**
- Create: `ios-swift/RoadTrip/RoadTripTests/Support/StubURLProtocol.swift`
- Create: `ios-swift/RoadTrip/RoadTripTests/RoadTripAPITests.swift`

**Implementation:**
- `StubURLProtocol: URLProtocol` — a classic stub that intercepts requests and returns a queued `(HTTPURLResponse, Data)` or throws a queued `URLError`. Register it on a `URLSessionConfiguration.ephemeral` via `protocolClasses = [StubURLProtocol.self]`; build the `RoadTripAPI` with `URLSession(configuration:)`. (Research note: this is the standard offline-deterministic way to test `URLSession` code — no network.)
- Tests (one happy + the relevant error cases per method):
  - `createTrip` decodes the response on 200; 400 → `.badRequest`.
  - `tripForPost`/`tripForView` decode on 200; 404 → `.notFound`.
  - `deleteTrip`/`deletePhoto`/`abortUpload` succeed on 204; 401 → `.unauthorized`; 404 → `.notFound`.
  - `pinDrop` decodes on 200; 409 → `.conflict`.
  - `commitUpload` decodes on 200; 400 BlockListMismatch body → `.blockListMismatch`.
  - `requestUpload` decodes on 200 (incl. null `displaySasUrl`/`thumbSasUrl`); 404 → `.notFound`.
  - **Offline:** stub throws `URLError(.notConnectedToInternet)` → method throws `.networkUnavailable`.
  - **Version gate:** stub returns 200 with header `x-client-min-version: 99.0.0` while client is `0.1.0` → throws `.versionMismatch`.
  - **Date decoding:** a `PhotoResponse` with `takenAt` `"2026-06-01T12:00:00.123Z"` (fractional) and another with `"2026-06-01T12:00:00Z"` both decode.

**Verification (Mac):**
```bash
cd ios-swift/RoadTrip && xcodebuild test -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:RoadTripTests/RoadTripAPITests
```
Expected: all stubbed API tests pass (no network used).

**Commit:** `test(ios): URLProtocol-stubbed RoadTripAPI tests for all methods + error cases`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Dev-slot integration tests (happy path per method)

**Verifies:** the design "Done when" dev-slot happy-path requirement.

**Files:**
- Create: `ios-swift/RoadTrip/RoadTripTests/Integration/RoadTripAPIIntegrationTests.swift`
- Modify: `ios-swift/RoadTrip/project.yml` if a separate test plan / scheme arg is needed to gate integration tests (see below).

**Implementation:**
- These hit the **dev slot** (`https://app-roadtripmap-prod-dev.azurewebsites.net`), so they are network-dependent and must NOT run in unattended CI. Gate them: skip unless an env var `RT_RUN_INTEGRATION=1` is set (`try XCTSkipUnless(ProcessInfo.processInfo.environment["RT_RUN_INTEGRATION"] == "1")` at the top of each test). This mirrors the .NET repo's `Category=Integration` separation (CLAUDE.md: integration tests run manually, not in CI).
- A self-contained lifecycle test that exercises the real loop against dev infra and cleans up after itself:
  1. `createTrip` → capture `secretToken`/`viewToken`.
  2. `tripForPost(secretToken)` and `tripForView(viewToken)` return the trip; `photosForPost` returns `[]`.
  3. `version()` returns non-empty `server_version`.
  4. `requestUpload` returns 3 SAS URLs + `maxBlockSizeBytes`. (Full block-PUT/commit loop is Phase 6; here just assert the SAS response shape.)
  5. `deleteTrip(secretToken)` → 204; subsequent `tripForPost` → `.notFound`.
- Keep these few and idempotent (each creates and deletes its own trip) so they never accumulate dev-slot junk. Per CLAUDE.md "Respect public APIs", no hammering.

**Verification (Mac, manual):**
```bash
cd ios-swift/RoadTrip && RT_RUN_INTEGRATION=1 xcodebuild test -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -only-testing:RoadTripTests/RoadTripAPIIntegrationTests
```
Expected: lifecycle test passes against the dev slot (requires the dev slot to be deployed + dev DB migrated from Phase 1). Capture the green run.

**Commit:** `test(ios): dev-slot integration tests for RoadTripAPI (gated on RT_RUN_INTEGRATION)`
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase Done When
Each public method has a passing `URLProtocol`-stubbed unit test covering its happy path + relevant error cases (401→`unauthorized`, 404→`notFound`, 400/BlockListMismatch, 409→`conflict`, 5xx→`serverError`, offline→`networkUnavailable`, version mismatch→`versionMismatch`), and the gated dev-slot integration test completes the create→read→requestUpload→delete loop. Verified by green `xcodebuild test` on the Mac (screenshot/log).
