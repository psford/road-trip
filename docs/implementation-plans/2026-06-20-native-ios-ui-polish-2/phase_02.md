# Native iOS UI Polish (Round 2) — Phase 2: Soft-archive data model + My Trips swipe

**Goal:** Add a local-only `archivedAt: Date?` flag to the `Trip` model via a GRDB migration, hide archived trips from the My Trips list, and add a swipe-left **Archive** action. No server change.

**Architecture:** A new GRDB migration (`v3`) adds a nullable `archivedAt` column. The `Trip` struct gains the matching property. The My Trips `ValueObservation` query filters `archivedAt == nil`; revalidation skips archived trips. A `.swipeActions` trailing button sets `archivedAt = now` via the established `dbQueue.write` pattern; `ValueObservation` then drops the row reactively.

**Tech Stack:** GRDB (migrations, `ValueObservation`, `Column`), SwiftUI `List` + `.swipeActions`, XCTest with `AppDatabase.makeInMemory()`.

**Scope:** Phase 2 of 5 from `docs/design-plans/2026-06-20-native-ios-ui-polish-2.md`. Independent of Phase 1.

**Codebase verified:** 2026-06-20 via codebase-investigator.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### native-ios-ui-polish-2.AC2: Soft archive (partial — archive side)
- **native-ios-ui-polish-2.AC2.1 Success:** Swiping a My Trips row left reveals an Archive action; invoking it archives the trip.
- **native-ios-ui-polish-2.AC2.2 Success:** An archived trip no longer appears in the My Trips list.
- **native-ios-ui-polish-2.AC2.5 Edge:** Archiving does not delete the server trip or its tokens — the shared view link still works and the trip restores intact.

> Restore + permanent delete (AC2.3, AC2.4, AC2.6) are Phase 3. The full archive→restore UI flow test lands in Phase 3 once the Archived view exists.

---

## Findings that shape this phase (from investigation)

- `Models/Trip.swift:13-34` — `struct Trip: Codable, Identifiable, Equatable` with `id, name, description, slug, photoCount, createdAt, cachedAt`; conforms to `FetchableRecord, PersistableRecord`; `static let databaseTableName = "trip"`. **No `archivedAt` yet.**
- `Storage/Migrator.swift` — migrations registered as `migrator.registerMigration("vN") { db in ... }`; existing `v1` (creates `trip`/`photo`/`UploadQueueItem`), `v2` (adds upload columns via `db.alter(table:)`). Latest is `v2`. The `v2` block is the template for adding a column.
- `Views/Trips/TripListView.swift:58-69` — `observeTrips()` runs `ValueObservation.tracking { db in try Trip.order(Column("createdAt").desc).fetchAll(db) }`. **No archive filter.**
- `Views/Trips/TripListView.swift:20-26` — `List(trips) { trip in NavigationLink { TripDetailView(...) } label: { TripRow(trip:) } }`. **No `.swipeActions`.**
- `Views/Trips/TripListView.swift:73-79` — `revalidateOwnedTrips()` fetches ALL trips and revalidates each owned one. Must skip `archivedAt != nil`.
- Mutation pattern (from `RoadTripAPI.swift`): `try await database.dbQueue.write { db in guard var t = try Trip.fetchOne(db, key: id) else { return }; t.field = ...; try t.update(db) }`.
- DB tests use `AppDatabase.makeInMemory()` (runs migrations automatically) — see `RoadTripTests/StorageTests.swift`.

**Design decision (follow the design, not the alternative):** use **`archivedAt: Date?`** (nil = active, non-nil = archived), NOT a `Bool`. This records *when* it was archived and matches the design's glossary and AC text.

**Build/test commands** (from `ios-swift/RoadTrip`): same as Phase 1; focused test target examples below.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Add `archivedAt` to the `Trip` model and a `v3` migration

**Verifies:** native-ios-ui-polish-2.AC2.1 (implementation), native-ios-ui-polish-2.AC2.2 (implementation), native-ios-ui-polish-2.AC2.5 (implementation)

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Models/Trip.swift:13-34` (add property)
- Modify: `ios-swift/RoadTrip/RoadTrip/Storage/Migrator.swift` (register `v3` after `v2`)

**Implementation:**

1. Add the property to `Trip`, declared with a default so the **synthesized memberwise initializer** gets a defaulted parameter. `Trip` has NO custom initializer — it relies on Swift's synthesized memberwise init. A bare `var archivedAt: Date?` does NOT get a default in that init, which would force EVERY existing `Trip(...)` call site to pass the new argument and break the build. Declaring `= nil` makes the synthesized init parameter default, so the three existing call sites compile unchanged:
   - `App/SampleData.swift` (~`:22`)
   - `Networking/RoadTripAPI.swift` (~`:353`, create) and (~`:385`, import)

   Add it (with the `= nil` default, keep it last in the struct):
   ```swift
   var archivedAt: Date? = nil   // nil = active; non-nil = locally archived (server is unaware)
   ```
   GRDB derives the column from the property name via `Codable`/`PersistableRecord`; confirm there are no hand-written `CodingKeys` in `Trip.swift` that would need the new key (the investigation found none). Do NOT add a custom initializer — the `= nil` default on the property is sufficient.

2. Register the migration after `v2`, mirroring the `v2` `db.alter` style:
   ```swift
   migrator.registerMigration("v3") { db in
       try db.alter(table: Trip.databaseTableName) { t in
           t.add(column: "archivedAt", .datetime)   // nullable; existing rows default to NULL = active
       }
   }
   ```

**Testing:** Task 2 covers schema + round-trip.

**Verification:**
Run: `xcodegen generate && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 15' build`
Expected: builds without errors (all `Trip(...)` call sites still compile).

**Commit:** `feat(ios): add archivedAt column + Trip.archivedAt (v3 migration)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Storage tests for the archive column and filtered query

**Verifies:** native-ios-ui-polish-2.AC2.2, native-ios-ui-polish-2.AC2.5

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTripTests/StorageTests.swift` (add archive cases) — or Create a focused `RoadTripTests/ArchiveTests.swift` if that reads cleaner alongside the existing files. Match the existing `AppDatabase.makeInMemory()` style.

**Testing:**
- **Migration/schema:** after `AppDatabase.makeInMemory()`, the `trip` table has an `archivedAt` column (assert via `db.columns(in: "trip")` containing `archivedAt`, or insert/fetch a Trip with a non-nil `archivedAt` and read it back equal).
- **Round-trip (AC2.5 integrity):** insert a Trip with `archivedAt = nil`, set `archivedAt = Date()`, `update`, fetch — assert it round-trips and ALL other fields (name, slug, photoCount, etc.) are unchanged. This proves archiving only flips the flag.
- **Filter query (AC2.2):** insert two trips (one with `archivedAt = nil`, one with `archivedAt = Date()`); assert the "active" query `Trip.filter(Column("archivedAt") == nil).order(Column("createdAt").desc).fetchAll(db)` returns only the active trip, and the "archived" query `Trip.filter(Column("archivedAt") != nil)...` returns only the archived one.

(These queries are exactly what Task 3 and Phase 3 wire into the views, so the test pins the contract.)

**Verification:**
Run: `xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:RoadTripTests/StorageTests test` (or `/ArchiveTests` if created)
Expected: archive cases pass.

**Commit:** `test(ios): archive column round-trip and active/archived filters`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Filter archived from My Trips, skip them in revalidation, and add the swipe action

**Verifies:** native-ios-ui-polish-2.AC2.1, native-ios-ui-polish-2.AC2.2, native-ios-ui-polish-2.AC2.5

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripListView.swift` — query `:58-69`, revalidation `:73-79`, list rows `:20-26`

**Implementation:**

1. **Filter the list query (`:58-69`):** add `.filter(Column("archivedAt") == nil)`:
   ```swift
   let observation = ValueObservation.tracking { db in
       try Trip.filter(Column("archivedAt") == nil)
               .order(Column("createdAt").desc)
               .fetchAll(db)
   }
   ```
   (`Column` is already imported via GRDB in this file — confirm the import is present.)

2. **Skip archived in revalidation (`:73-79`):** filter the fetched set so archived trips are not re-fetched from the server (they keep their Keychain tokens but shouldn't be network-revalidated):
   ```swift
   let known = (try? await database.dbQueue.read {
       try Trip.filter(Column("archivedAt") == nil).fetchAll($0)
   }) ?? []
   ```

3. **Add the swipe-to-archive action (`:20-26`):** attach `.swipeActions` to the row. Set `archivedAt = now` with the established write pattern. Keep the closure `@Sendable`-safe by capturing the immutable `trip.id`:
   ```swift
   List(trips) { trip in
       NavigationLink {
           TripDetailView(database: database, trip: trip)
       } label: {
           TripRow(trip: trip)
       }
       .swipeActions(edge: .trailing) {
           Button {
               archive(trip)
           } label: {
               Label("Archive", systemImage: "archivebox")
           }
           .tint(.orange)   // not .destructive — archive is recoverable
       }
   }
   ```
   Add the helper:
   ```swift
   private func archive(_ trip: Trip) {
       let id = trip.id
       Task {
           try? await database.dbQueue.write { db in
               guard var t = try Trip.fetchOne(db, key: id) else { return }
               t.archivedAt = Date()
               try t.update(db)
           }
       }
   }
   ```
   The list updates reactively because `ValueObservation` now excludes `archivedAt != nil`.

**Testing:** Query/mutation correctness is covered by Task 2 (unit). The end-to-end swipe→disappears→Archived→Restore UI flow is tested in **Phase 3** (`testArchiveAndRestoreFlow`) once the Archived view exists. Note this explicitly in a code comment so the executor doesn't add a redundant UI test here.

**Verification:**
Run: `xcodegen generate && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 15' build` then the full unit suite.
Expected: builds; existing tests still pass; swiping a row archives it (manual/simulator check — it disappears from My Trips).

**Commit:** `feat(ios): swipe-to-archive on My Trips; filter archived from list + revalidation`
<!-- END_TASK_3 -->

---

## Phase 2 Done When
- `v3` migration applies cleanly via `AppDatabase.makeInMemory()`.
- Unit tests verify the archive column round-trips, archiving preserves all other fields (AC2.5), and the active/archived filters partition correctly (AC2.2).
- Swiping a My Trips row reveals **Archive**; invoking it sets `archivedAt` and the row disappears from My Trips (AC2.1, AC2.2).
- Revalidation no longer re-fetches archived trips.
- Full build succeeds; existing suite stays green.
