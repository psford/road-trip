# Native iOS Sharing & Popup Polish — Phase 2: View-Token Capture for Imported Trips

**Goal:** Imported (and revalidated) trips store their view token locally, so every owned trip can build a shareable view link in Phase 3.

**Architecture:** The server already returns `viewUrl` (`/trips/{viewToken}`) from `GET /api/post/{secretToken}`. Add `viewUrl` to the iOS `TripResponse` DTO, a pure parser that extracts the view token from that path, and have `importTrip`/`revalidate` store it in the Keychain (`.view`) — mirroring how `createTrip` already stores both tokens.

**Tech Stack:** Swift, `Codable`, `KeychainStore`, GRDB.

**Scope:** Phase 2 of 4.

**Codebase verified:** 2026-06-19.

---

## Acceptance Criteria Coverage

### native-ios-sharing-polish.AC2: View-token availability
- **native-ios-sharing-polish.AC2.1 Success:** Creating a trip stores its view token in the Keychain (`.view`) — regression guard.
- **native-ios-sharing-polish.AC2.2 Success:** Importing a trip parses the view token from the server `viewUrl` and stores it (`.view`).
- **native-ios-sharing-polish.AC2.3 Success:** `revalidate` backfills the view token for an owned trip that lacks one.
- **native-ios-sharing-polish.AC2.4 Failure:** If the server omits `viewUrl`, import still succeeds (no crash); view-sharing is simply unavailable until a later revalidate provides it.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Pure view-token parser (the iOS DTO already decodes `viewUrl`)

**Verifies:** native-ios-sharing-polish.AC2.2, native-ios-sharing-polish.AC2.4 (parser-level)

**Files:**
- Verify (no change expected): the iOS `TripResponse` Codable struct **already has `let viewUrl: String?`** (`ios-swift/RoadTrip/RoadTrip/Networking/RoadTripAPI.swift:277`, added in commit `afb3575`), so it already decodes the server's `viewUrl`. Confirm it's present; if for some reason it's absent, add `let viewUrl: String?`. Do NOT add a duplicate.
- Create: a pure helper, e.g. `static func viewToken(fromViewUrl:) -> UUID?` on `RoadTripAPI` (or a small free function in the same file), that parses `/trips/{uuid}` and returns the UUID, or `nil` for a missing/garbage path.
- Test: `ios-swift/RoadTrip/RoadTripTests/ViewTokenParsingTests.swift` (unit)

**Implementation:**
- This task reduces to the parser + its tests (the DTO field already exists).
- Parser: take the last path component of the `viewUrl` string and attempt `UUID(uuidString:)`. Return `nil` if the input is `nil`, empty, or not a UUID. Pure — no I/O.

**Testing:**
Unit tests (no DB/network), following `APIEnvironmentTests`/`UploadResilienceTests` pure-logic style:
- native-ios-sharing-polish.AC2.2: `"/trips/<uuid>"` → that UUID; case-insensitive UUID accepted.
- native-ios-sharing-polish.AC2.4: `nil`, `""`, `"/trips/"`, `"/trips/not-a-uuid"`, and an absolute `https://host/trips/<uuid>` all handled (the absolute form should still extract the UUID; missing/garbage → `nil`).

**Verification:**
Run: `cd ios-swift/RoadTrip && xcodegen generate --spec project.yml --project . && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd test -only-testing:RoadTripTests/ViewTokenParsingTests`
Expected: tests pass.

**Commit:** `feat(ios): decode viewUrl + pure view-token parser`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Store the view token on import and backfill on revalidate

**Verifies:** native-ios-sharing-polish.AC2.2, native-ios-sharing-polish.AC2.3, native-ios-sharing-polish.AC2.4

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Networking/RoadTripAPI.swift:324-344` (`importTrip`) and `346-367` (`revalidate`)
- Test: `ios-swift/RoadTrip/RoadTripTests/UploadIntegrationTests.swift` (add an integration test) OR a focused new integration test file, following the skip-if-backend-down pattern.

**Implementation:**
- In `importTrip`, after the existing `keychain.setToken(secret, kind: .secret, tripId: tripId)`, if `Self.viewToken(fromViewUrl: tripDTO.viewUrl)` is non-nil, also `keychain.setToken(viewToken, kind: .view, tripId: tripId)`. A `nil` view token must NOT throw or abort import (AC2.4) — guard and continue.
- In `revalidate`, after fetching `tripDTO`, backfill the `.view` token only when one isn't already stored. `token(kind:tripId:)` returns `UUID?`, so `try?` produces `UUID??` — flatten it before comparing. Use an explicit form to avoid precedence ambiguity:
  ```swift
  let existingView = (try? keychain.token(kind: .view, tripId: tripId)) ?? nil
  if existingView == nil, let vt = Self.viewToken(fromViewUrl: tripDTO.viewUrl) {
      try? keychain.setToken(vt, kind: .view, tripId: tripId)
  }
  ```
  Revalidate is best-effort (already swallows errors) — keep that.
- `revalidate`'s current signature takes `into database:` but not `keychain:`. Add a `keychain: KeychainStore` parameter (the callers — `UploadCoordinator`/`BackgroundUploadSession` and `TripListView` revalidation — already have a `KeychainStore`; update call sites). Verify call sites during implementation and update them in this task so the build stays green.

**Testing:**
Integration test mirroring `UploadIntegrationTests` (skip via `XCTSkip` if the local backend on :5100 is unreachable; isolated Keychain service per test, in-memory DB):
- native-ios-sharing-polish.AC2.2: create a trip server-side, import it by its secret token, assert a `.view` token is now in the Keychain for the imported trip's local id.
- native-ios-sharing-polish.AC2.3: delete the `.view` token, run `revalidate`, assert it's restored.
- native-ios-sharing-polish.AC2.4 (MANDATORY assertion, not optional): prove import does not throw or abort when the view token is unavailable. Preferred: refactor the "store view token from a `viewUrl`" step into a small testable seam (e.g. the parser + a tiny `storeViewToken(from:tripId:)` that no-ops on nil) and unit-test that a nil/garbage `viewUrl` leaves the trip imported with its `.secret` token present and no `.view` token — no throw. If that seam isn't introduced, assert the same in the integration test by importing a trip and confirming a nil-`viewUrl` path completes successfully. Do not leave AC2.4 as prose-only.

**Verification:**
Run: `cd ios-swift/RoadTrip && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd test -only-testing:RoadTripTests`
Expected: all unit tests pass; the new integration test passes when the backend is up, skips when down.

**Commit:** `feat(ios): store view token on import; backfill on revalidate`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

---

**Note on AC2.1 (regression guard):** `createTrip` already stores the `.view` token (`RoadTripAPI.swift:311`). No change needed; if an existing test doesn't already cover it, the integration test added in Task 2 can assert created trips have a `.view` token too. Do not duplicate coverage unnecessarily.
