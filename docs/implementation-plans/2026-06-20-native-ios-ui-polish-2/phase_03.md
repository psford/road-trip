# Native iOS UI Polish (Round 2) — Phase 3: Archived view (restore + permanent delete)

**Goal:** Give archived trips a home: a new **Archived** view (reached from a My Trips toolbar item) that lists archived trips, **Restore**s them (`archivedAt = nil`), and **Delete permanently** — the ONLY path that performs the real server delete — behind a confirmation.

**Architecture:** A new SwiftUI view observes `Trip.filter(Column("archivedAt") != nil)` via `ValueObservation`. Restore reuses the Phase 2 write pattern. Delete permanently delegates to the existing `RoadTripAPI.deleteTrip(_:from:keychain:)` (server DELETE → local delete → Keychain cleanup) gated by the app's existing `.confirmationDialog` pattern. A toolbar entry in `TripListView` pushes the view.

**Tech Stack:** SwiftUI (`NavigationLink`/`NavigationStack`, `.confirmationDialog`, `List`), GRDB `ValueObservation`, existing `RoadTripAPI`, `KeychainStore`, XCTest.

**Scope:** Phase 3 of 5. Depends on **Phase 2** (the `archivedAt` flag).

**Codebase verified:** 2026-06-20 via codebase-investigator.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### native-ios-ui-polish-2.AC2: Soft archive (restore + permanent delete)
- **native-ios-ui-polish-2.AC2.3 Success:** The Archived view lists archived trips; Restore returns a trip to My Trips (and removes it from Archived).
- **native-ios-ui-polish-2.AC2.4 Success:** "Delete permanently" in the Archived view removes the trip server-side, locally, and clears its Keychain tokens.
- **native-ios-ui-polish-2.AC2.6 Failure:** "Delete permanently" requires confirmation; cancelling leaves the trip archived and present in the Archived view.

Also adds the end-to-end UI flow test for **AC2.1/AC2.2** (swipe-archive → disappears → appears in Archived → Restore → reappears) deferred from Phase 2.

---

## Findings that shape this phase (from investigation)

- **Permanent delete already exists** — `RoadTripAPI.deleteTrip(_ trip: Trip, from: AppDatabase, keychain: KeychainStore) async throws` at `Networking/RoadTripAPI.swift:431-442`:
  - calls server `DELETE /api/trips/{secretToken}` only if a `.secret` Keychain token exists (sends lowercased UUID; tolerates `notFound`),
  - then `Self.deleteLocally(tripId:from:keychain:)` (`:447-453`) which does `Trip.deleteOne(db, key:)` (photos cascade) and `keychain.removeAll(tripId:)`.
  - **Do not reimplement deletion** — call this function.
- For a **SampleData trip with no secret token**, `deleteTrip` skips the network entirely and only cleans up locally → safe to exercise in UI tests (the existing `testDeleteTripFlow` relies on this today).
- `KeychainStore` (`Storage/KeychainStore.swift`): `token(kind:tripId:)`, `setToken(_:kind:tripId:)`, `removeAll(tripId:)`. Tokens are per-`(kind, tripId)`.
- `TripListView.swift:31-42` toolbar: `.topBarLeading` = "Import via Token", `.topBarTrailing` = "New Trip". App uses `NavigationStack` (`:14`) + `NavigationLink` for push and `.sheet` for modals.
- Confirmation pattern (`TripDetailView.swift:133-138`): `.confirmationDialog("Delete this trip?", isPresented:..., titleVisibility: .visible) { Button("Delete", role: .destructive){...}; Button("Cancel", role: .cancel){} } message: { Text(...) }`. Error surfaced via `.alert` (`:139-146`).
- `observeTrips()` pattern (`TripListView.swift:58-69`) is the template for the Archived view's observation.
- This view needs `database` and `keychain` (same dependencies `TripListView` passes into `CreateTripView`/`PasteTokenView`).

---

<!-- START_TASK_1 -->
### Task 1: Create the `ArchivedTripsView`

**Verifies:** native-ios-ui-polish-2.AC2.3 (implementation), native-ios-ui-polish-2.AC2.4 (implementation), native-ios-ui-polish-2.AC2.6 (implementation)

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Views/Trips/ArchivedTripsView.swift`

**Implementation:**

Build a SwiftUI view that mirrors `TripListView`'s structure (same `database`/`keychain` injected dependencies, same `ValueObservation` + `@State var trips` pattern). Requirements:

1. **Observe archived trips** (reuse the `observeTrips()` shape from `TripListView.swift:58-69`, with the opposite filter):
   ```swift
   let observation = ValueObservation.tracking { db in
       try Trip.filter(Column("archivedAt") != nil)
               .order(Column("createdAt").desc)
               .fetchAll(db)
   }
   ```
   Drive it from `.task { await observeArchived() }`.

2. **Rows** reuse the existing `TripRow` look (or a local equivalent showing name + photo count + date). Do **not** make rows `NavigationLink` to `TripDetailView` (archived trips aren't opened for editing) — keep rows static with trailing action buttons / swipe actions.

3. **Restore (AC2.3):** a per-row action (swipe `.trailing` and/or a row button) labelled "Restore" that sets `archivedAt = nil`:
   ```swift
   private func restore(_ trip: Trip) {
       let id = trip.id
       Task {
           try? await database.dbQueue.write { db in
               guard var t = try Trip.fetchOne(db, key: id) else { return }
               t.archivedAt = nil
               try t.update(db)
           }
       }
   }
   ```
   `ValueObservation` removes it from Archived (and the My Trips observation re-includes it) automatically.

4. **Delete permanently (AC2.4 + AC2.6):** a `.destructive` per-row action labelled "Delete permanently" that opens a `.confirmationDialog` (mirror `TripDetailView.swift:133-138`). Track the pending trip in `@State private var pendingDelete: Trip?` and present with `.confirmationDialog(..., isPresented: Binding(pendingDelete != nil), ...)` or `.confirmationDialog(item:)` style consistent with the codebase. On confirm:
   ```swift
   private func deletePermanently(_ trip: Trip) {
       Task {
           do {
               try await RoadTripAPI.shared.deleteTrip(trip, from: database, keychain: keychain)
           } catch {
               deleteError = error.localizedDescription   // surface via .alert like TripDetailView
           }
       }
   }
   ```
   Cancel leaves the trip archived (no-op) — AC2.6.
   Give the confirm button accessibility-stable text "Delete permanently" (used by the UI test) and the destructive role.

5. **Empty state:** show a simple "No archived trips" message when `trips.isEmpty` (match the app's existing empty-state tone, e.g. `ContentUnavailableView` or a styled `Text`).

6. Title the view `"Archived"` via `.navigationTitle("Archived")`.

**Testing:** Tasks 3 (unit) and 4 (UI) cover behavior.

**Verification:**
Run: `xcodegen generate && xcodebuild ... build`
Expected: builds without errors.

**Commit:** `feat(ios): ArchivedTripsView with restore and permanent delete`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add the Archived entry point to My Trips

**Verifies:** native-ios-ui-polish-2.AC2.3

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripListView.swift` (toolbar `:31-42`)

**Implementation:**
Add a toolbar item that navigates to `ArchivedTripsView`. Use a `NavigationLink` in a `ToolbarItem` (push within the existing `NavigationStack`), e.g. on `.topBarLeading` next to "Import via Token", or fold both leading actions into a `Menu` if placement gets crowded — match the existing toolbar style:
```swift
ToolbarItem(placement: .topBarLeading) {
    NavigationLink {
        ArchivedTripsView(database: database, keychain: keychain)
    } label: {
        Label("Archived", systemImage: "archivebox")
    }
}
```
Ensure the control has a stable accessibility label "Archived" (used by the UI test).

**Verification:**
Run: `xcodebuild ... build`
Expected: builds; an "Archived" control is reachable from My Trips.

**Commit:** `feat(ios): My Trips toolbar entry to Archived view`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for restore and permanent-delete delegation

**Verifies:** native-ios-ui-polish-2.AC2.3, native-ios-ui-polish-2.AC2.4

**Files:**
- Modify/Create: `ios-swift/RoadTrip/RoadTripTests/ArchiveTests.swift` (or extend `StorageTests.swift`) — `AppDatabase.makeInMemory()` style.

**Testing:**
- **Restore (AC2.3):** insert an archived trip (`archivedAt != nil`); apply the restore write (`archivedAt = nil`); assert the active filter now returns it and the archived filter does not. Pull the restore mutation into a small testable function if the executor can do so cleanly; otherwise test the write directly against the in-memory DB to pin the contract.
- **Permanent delete — local cleanup (AC2.4):** using `AppDatabase.makeInMemory()` and a test `KeychainStore` (the existing `StorageTests` show how the Keychain is exercised with a unique service per test run), insert a trip + a `.secret`/`.view` token + a photo, then call `RoadTripAPI.deleteLocally(tripId:from:keychain:)` (the `nonisolated static` local-cleanup half, which needs no network) and assert: the trip row is gone, photos cascade-deleted, and `keychain.token(kind:.secret/.view, tripId:)` both return nil. This verifies the local + Keychain effects of permanent delete without standing up the server.
  - Note in a comment that the server-DELETE half of `deleteTrip(_:from:keychain:)` is exercised at the integration/device level (it requires a live backend, like the existing `UploadIntegrationTests`), and is covered by the human/device test plan for AC2.4.

**Verification:**
Run: `xcodebuild ... -only-testing:RoadTripTests/ArchiveTests test`
Expected: restore and permanent-delete-local cases pass.

**Commit:** `test(ios): restore filter flip + permanent-delete local/Keychain cleanup`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: UI test — archive → restore round trip (and permanent delete)

**Verifies:** native-ios-ui-polish-2.AC2.1, native-ios-ui-polish-2.AC2.2, native-ios-ui-polish-2.AC2.3, native-ios-ui-polish-2.AC2.6

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift`

**Testing:**
Add `testArchiveAndRestoreFlow` (deterministic `-uitest` seed):
- From My Trips, swipe the seed trip row left (`cells`/row element `.swipeLeft()`) and tap `app.buttons["Archive"]`.
- Assert the trip's row no longer exists in My Trips (`app.staticTexts["Pacific Coast Highway"]` gone from the list — wait for non-existence). (AC2.1, AC2.2)
- Tap the `app.buttons["Archived"]` toolbar control; assert the trip appears in the Archived list. (AC2.3)
- Swipe/tap **Restore**; navigate back; assert the trip is back in My Trips. (AC2.3)
- Attach screenshots (`AC2.3-archived-list`, `AC2.3-restored`).

Add `testPermanentDeleteRequiresConfirmation` (AC2.6) using the SampleData trip (no secret token → local-only delete, safe):
- Archive the trip, open Archived, invoke "Delete permanently", and on the confirmation dialog tap **Cancel**; assert the trip is still present in Archived. (AC2.6)
- Then invoke "Delete permanently" again and **confirm**; assert it disappears from Archived (and is not in My Trips). (contributes to AC2.4 at the UI level — local effect)

Keep these robust to swipe flakiness (use `waitForExistence`, hittable checks). If a swipe gesture proves flaky in CI, fall back to an explicit row action button and document it in the test comment.

**Verification:**
Run: `xcodebuild ... -only-testing:RoadTripUITests/RoadTripUITests/testArchiveAndRestoreFlow -only-testing:RoadTripUITests/RoadTripUITests/testPermanentDeleteRequiresConfirmation test`
Expected: both pass.

**Commit:** `test(ios): UI archive→restore round trip and delete-confirmation`
<!-- END_TASK_4 -->

---

## Phase 3 Done When
- Restore returns a trip to My Trips and removes it from Archived (AC2.3).
- "Delete permanently" delegates to `RoadTripAPI.deleteTrip` (server + local + Keychain), behind a confirmation; cancel is a no-op (AC2.4, AC2.6).
- The Archived view is reachable from a My Trips toolbar item (AC2.3).
- Unit tests verify the restore flip and local/Keychain delete cleanup; UI tests cover archive→restore and delete-confirmation.
- Full build succeeds; existing suite stays green (`testDeleteTripFlow` still passes — Delete is removed only in Phase 5).
