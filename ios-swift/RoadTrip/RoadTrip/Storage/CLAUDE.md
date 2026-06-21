# Storage (native SwiftUI app)

Last verified: 2026-06-21

## Purpose
On-device persistence for the native iOS app: the GRDB SQLite cache (`AppDatabase`),
its schema migrations (`AppMigrator`), Keychain-backed token storage (`KeychainStore`),
and the on-disk photo/image caches. The DB holds non-secret trip/photo/upload state;
raw tokens live in the Keychain only.

## Contracts
- **`AppDatabase`** — owns the GRDB `DatabaseQueue`; applies all registered migrations on
  init. Views observe rows via `ValueObservation.tracking { ... }.values(in:dbQueue)`.
- **`AppMigrator.makeMigrator()`** — registers migrations in order; GRDB records which have
  applied. Current schema version is **`v3`**:
  - `v1` — `trip`, `photo`, `uploadQueueItem` tables.
  - `v2` (Phase 6 Slice B.2) — adds `blockSizeBytes` / `serverPhotoId` /
    `completedBlockIndices` to `uploadQueueItem` (force-quit resume support).
  - `v3` (this phase) — adds nullable `archivedAt` (`.datetime`) to `trip` (local soft-archive).
- **`KeychainStore`** — `token(...)`/store/delete for SecretToken + ViewToken, keyed by trip `id`.
  `token(...)` returns `UUID??` (flatten with `?? nil`).

## Dependencies
- **Uses**: GRDB.swift, Security (Keychain), Foundation.
- **Used by**: `Networking/*` (orchestration writes), `Views/Trips/*` and `Views/Photos/*`
  (ValueObservation reads), `Upload/*` (queue persistence), `Models/*` (record types).
- **Boundary**: tokens NEVER persisted to GRDB — Keychain only.

## Key Decisions
- **Soft-archive over delete (Phase 2)**: archiving sets `Trip.archivedAt = Date()` locally;
  the server is never told. All trip data stays intact so Restore is a pure local
  `archivedAt = nil` write. Server-side permanent delete is a separate, explicit action
  (see `Views/Trips` — only `ArchivedTripsView` performs it).
- **Migrations are append-only**: never edit a shipped migration; add a new `vN`. A device
  that already ran `vN` will not re-run it.

## Invariants
- Schema evolves only through new `AppMigrator` migrations (no raw `ALTER` outside a migration).
- `trip.archivedAt`: `nil` = active, non-nil = locally archived. The server has no archive concept.
- Photo / UploadQueueItem rows cascade-delete with their parent `trip` (FK `onDelete: .cascade`).
- Tokens (Secret + View) live in the Keychain, keyed by trip `id`; never in SQLite.

## Key Files
- `AppDatabase.swift` — DatabaseQueue owner; runs migrations on init.
- `Migrator.swift` — `AppMigrator`; v1–v3 migrations (append-only).
- `KeychainStore.swift` — token storage (SecretToken + ViewToken).
- `PhotoFileCache.swift` / `ImageLoader.swift` — on-disk image/photo caching.

## Gotchas
- `archivedAt` filtering happens in the queries, not the model: list views filter
  `Column("archivedAt") == nil`; `ArchivedTripsView` filters `!= nil`. A new trip-list query
  MUST decide its archive filter explicitly or it will show archived rows.
- The Xcode project is generated from `project.yml` by XcodeGen — adding a Storage file means
  editing sources + `project.yml`, then regenerating on the Mac (never edit `.xcodeproj`).
