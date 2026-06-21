# Networking (native SwiftUI app)

Last verified: 2026-06-21

## Purpose
Typed client for the .NET Road Trip backend plus the trip write-path orchestration
(API + Keychain + GRDB) for the native iOS app under `ios-swift/RoadTrip`. Views and view
models call the orchestration methods here rather than juggling the three stores themselves.

## Contracts
- **`RoadTripAPI` actor** (`RoadTripAPI.shared`): thin REST wrappers (`createTrip`,
  `tripForPost`, `photosForPost`, `requestUpload`/`commitUpload`/`abortUpload`, `putBlock`,
  `updatePhotoLocation`, `deleteTrip`, `deletePhoto`). HTTP status maps to typed
  `RoadTripAPIError` (`.unauthorized` 401, `.notFound` 404, `.networkUnavailable`, `.serverError`).
- **Trip orchestration** (extension, the full write path):
  - `createTrip(name:description:into:keychain:)` / `importTrip(tokenString:into:keychain:)` →
    `Trip`. Throw on server/Keychain error; no partial local state on failure.
  - `revalidate(tripId:secretToken:into:keychain:)` — best-effort stale-while-revalidate;
    failures leave the cache untouched. **Takes `keychain:` (added this phase)** so it can
    backfill a missing view token from the server's `viewUrl`. All call sites must pass it.
  - `deleteTrip(_:from:keychain:)` — server delete (404 = already gone) then local cleanup.
    The **only** caller is `Views/Trips/ArchivedTripsView` ("Delete permanently"); ordinary
    trip removal is a local soft-archive (`Trip.archivedAt`), never this call.
- **Pure helpers** (`nonisolated static`, no I/O, deterministic, idempotent — unit-test seams):
  - `viewToken(fromViewUrl:) -> UUID?` — parses the trailing UUID from a `/trips/{uuid}` path;
    strips `?query` and `#fragment`; nil on empty/invalid.
  - `firstUUID(in:) -> UUID?` — extracts the first canonical UUID from arbitrary messy text
    (tolerant paste for import). nil if none found.
  - `storeViewToken(from:tripId:keychain:)` — best-effort: parses `viewUrl`, stores the view
    token if present; silent no-op on nil/empty/no-UUID; never throws.
- **`TripShareLinks.shareViewURL(viewToken:baseURL:) -> URL`** (`APIEnvironment.swift`) — pure
  builder for the read-only share URL `<baseURL>/trips/{viewToken.uuidString}`.
- **`APIEnvironment.baseURL`** — per-build base URL (Debug → localhost:5100; `DEVSLOT` → Azure
  dev slot; Release → prod), overridable via `API_BASE_URL` env var (simulator/tests only).

## Dependencies
- **Uses**: `KeychainStore` (token storage — secret + view), `AppDatabase`/GRDB (local cache),
  `URLSession`. Server DTOs mirror the .NET camelCase JSON.
- **Used by**: `Views/Trips/*` (TripListView, TripDetailView), `Upload/BackgroundUploadSession`.
- **Boundary**: tokens (SecretToken, ViewToken) live in the Keychain ONLY — never persisted to GRDB.

## Key Decisions
- **Tolerant import (this phase)**: `importTrip` tries a bare-UUID parse, then falls back to
  `firstUUID(in:)` on messy paste, and sends the *resolved* lowercase UUID to the server.
- **View-token capture (this phase)**: stored on `importTrip` (from `TripResponse.viewUrl`) and
  backfilled on `revalidate` when absent — enables the "Share view link" feature without forcing
  a re-import of older trips.
- **Pure parsers split from I/O**: parsing/URL-building are `nonisolated static` so they unit-test
  without a server or actor hop.

## Invariants
- Server path tokens are lowercased before send (server auth is a case-sensitive string compare;
  `UUID.uuidString` is uppercase).
- `.NET` sends timezone-less datetimes; `RoadTripAPI.parseDate` parses ISO-8601 (±fractional) and
  the bare `yyyy-MM-dd'T'HH:mm:ss[.fff…]` form so hydration never silently fails.
- An owned trip has a SecretToken in the Keychain; a ViewToken may be absent on older imports.

## Key Files
- `RoadTripAPI.swift` — actor + DTOs + trip-orchestration extension + pure parsers
- `APIEnvironment.swift` — base-URL resolution + `TripShareLinks` share-URL builder
- `PhotoMutations.swift` / `OptimisticMutation.swift` — optimistic photo edit/delete helpers

## Gotchas
- `keychain.token(...)` returns `UUID??`; flatten with `?? nil` (see `TripDetailView.loadShareTokens`).
- The Share menu in `TripDetailView` is gated on an owned trip (secret token present); the
  "Share view link" item is omitted when no view token exists yet — `inviteText` carries the
  paste-this-token invite for editors instead.
