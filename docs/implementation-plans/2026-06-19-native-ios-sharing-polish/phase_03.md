# Native iOS Sharing & Popup Polish — Phase 3: Trip Sharing UI + Import Robustness

**Goal:** Owners can share a read-only view link and an edit invite from the trip; pasted invites import even when the text isn't a bare UUID.

**Architecture:** A single toolbar **Share** `Menu` in `TripDetailView` (shown only when the trip has a secret token) with "Share view link" (`ShareLink` of the absolute view URL) and "Invite to edit" (`ShareLink`/share sheet of the secret-token text). A pure URL builder constructs `<base host>/trips/{viewToken}`. A pure UUID extractor makes `importTrip` tolerate messy paste.

**Tech Stack:** SwiftUI `ShareLink` (iOS 16+; not yet used in the codebase), `Menu`, `KeychainStore`, `APIEnvironment`.

**Scope:** Phase 3 of 4. Depends on Phase 2 (view token must be stored to build the view link).

**Codebase verified:** 2026-06-19.

---

## Acceptance Criteria Coverage

### native-ios-sharing-polish.AC3: Trip sharing
- **native-ios-sharing-polish.AC3.1 Success:** Owned trips show a Share button in the toolbar offering "Share view link" and "Invite to edit" (device/manual).
- **native-ios-sharing-polish.AC3.2 Success:** The view link is the absolute URL `<base host>/trips/{viewToken}`.
- **native-ios-sharing-polish.AC3.3 Success:** Opening the shared view URL loads the read-only trip page without the app installed (device/manual).
- **native-ios-sharing-polish.AC3.4 Success:** "Invite to edit" presents a share sheet whose text contains the trip's secret token (device/manual).
- **native-ios-sharing-polish.AC3.5 Edge:** Sample/local-only trips (no secret token) hide the Share button.

### native-ios-sharing-polish.AC4: Import robustness
- **native-ios-sharing-polish.AC4.1 Success:** Pasting a bare secret-token UUID imports the trip with write access (regression guard).
- **native-ios-sharing-polish.AC4.2 Success:** Pasting text that contains a UUID (e.g. the invite message or a post URL) extracts the token and imports.
- **native-ios-sharing-polish.AC4.3 Failure:** Pasting text with no UUID shows the existing invalid-token error.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
<!-- START_TASK_1 -->
### Task 1: Pure UUID extractor for messy paste; wire into `importTrip`

**Verifies:** native-ios-sharing-polish.AC4.2, native-ios-sharing-polish.AC4.3, native-ios-sharing-polish.AC4.1

**Files:**
- Create: a pure helper (e.g. `static func firstUUID(in:) -> UUID?` on `RoadTripAPI`, or a small free function) that returns the first UUID found in arbitrary text.
- Modify: `ios-swift/RoadTrip/RoadTrip/Networking/RoadTripAPI.swift:324-344` (`importTrip`) — when `UUID(uuidString: trimmed)` fails, fall back to `firstUUID(in: tokenString)`; if still nil, throw `RoadTripAPIError.notFound` (preserves AC4.3's existing error path/message in `PasteTokenView`).
- Test: `ios-swift/RoadTrip/RoadTripTests/TokenPasteTests.swift` (unit)

**Implementation:**
- Extractor: scan for a substring matching the canonical UUID shape (8-4-4-4-12 hex) and return `UUID(uuidString:)` of the first match, else `nil`. A simple regex (`NSRegularExpression` or `String.range(of:options:.regularExpression)`) is fine; pure, no I/O.
- In `importTrip`, keep the existing bare-UUID happy path (AC4.1), then the extractor fallback (AC4.2). Continue to lowercase the token only where path tokens hit the server (existing convention) — extraction returns a `UUID`, and downstream calls already handle casing.

**Testing:**
Unit tests (pure-logic style):
- AC4.2: `"...paste: <uuid>."`, a `/post/<uuid>` URL, and surrounding whitespace/newlines all extract the UUID.
- AC4.3: text with no UUID → `nil` (→ `importTrip` throws `.notFound`).
- AC4.1: a bare `<uuid>` string still parses (regression).

**Verification:**
Run: `cd ios-swift/RoadTrip && xcodegen generate --spec project.yml --project . && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd test -only-testing:RoadTripTests/TokenPasteTests`
Expected: tests pass.

**Commit:** `feat(ios): tolerate messy paste when importing a trip token`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Pure share-view-URL builder

**Verifies:** native-ios-sharing-polish.AC3.2

**Files:**
- Create: a pure helper, e.g. `static func shareViewURL(viewToken: UUID, baseURL: URL) -> URL` (co-locate with `APIEnvironment` in `ios-swift/RoadTrip/RoadTrip/Networking/APIEnvironment.swift`, or a small `TripShareLinks` type in `Networking/`).
- Test: `ios-swift/RoadTrip/RoadTripTests/TripShareLinkTests.swift` (unit)

**Implementation:**
- Build `baseURL` (scheme+host, e.g. the dev slot) + path `/trips/{viewToken.uuidString}`. Use `URL`/`URLComponents` so the host from `APIEnvironment.baseURL` is reused and the path is appended cleanly (no double slashes). The view token's casing: the web view page lookup is case-insensitive (per the server view endpoints), but emit the token as-is from the stored UUID.

**Testing:**
Unit test (pure):
- AC3.2: given a known base URL + view token, the built URL equals `<host>/trips/<uuid>`. Test with both the dev-slot host and a `localhost:5100` host to prove it tracks `APIEnvironment`.

**Verification:**
Run: `cd ios-swift/RoadTrip && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd test -only-testing:RoadTripTests/TripShareLinkTests`
Expected: tests pass.

**Commit:** `feat(ios): pure builder for the shareable trip view URL`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_3 -->
### Task 3: Share menu in the trip toolbar (gated on owned trips)

**Verifies:** native-ios-sharing-polish.AC3.1, native-ios-sharing-polish.AC3.4, native-ios-sharing-polish.AC3.5

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift:87-103` (add a Share `ToolbarItem` alongside the existing Add Photo + Delete Trip items)
- Modify: `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` (assert the Share button is absent for a SampleData trip — AC3.5)

**Implementation:**
- Compute the tokens once (not in the body's hot path): on `.task`/`.onAppear`, set `@State private var shareViewToken: UUID?` and `@State private var secretToken: UUID?` from `try? keychain.token(kind: .view, tripId: trip.id)` and `.secret` (each is `UUID??` via `try?`; flatten with `?? nil`). Owned = `secretToken != nil`.
- Add the Share `ToolbarItem(placement: .topBarTrailing)` that renders nothing unless owned, and unwrap the optionals explicitly so the closure type-checks (both fields are `UUID?` — `UUID?.uuidString` does not exist, and `shareViewURL(viewToken: UUID, …)` won't accept a `UUID?`). Shape:
  ```swift
  ToolbarItem(placement: .topBarTrailing) {
      if let secretToken {                     // owned-trip gate (AC3.5: no token → no button)
          Menu {
              if let shareViewToken {          // older imports lacking a view token: item simply omitted
                  ShareLink(item: TripShareLinks.shareViewURL(viewToken: shareViewToken,
                                                              baseURL: APIEnvironment.baseURL)) {
                      Label("Share view link", systemImage: "link")
                  }
              }
              ShareLink(item: inviteText(name: trip.name, secret: secretToken)) {
                  Label("Invite to edit", systemImage: "person.badge.plus")
              }
          } label: { Label("Share", systemImage: "square.and.arrow.up") }
      }
  }
  ```
  where `inviteText(name:secret:)` returns e.g. `"Join my Road Trip \"\(name)\" — open the app → Import via Token → paste: \(secret.uuidString)"`. Per the design, share the **raw token text**.
- The `shareViewToken == nil` fallback is now expressed in code (the "Share view link" item is omitted), not just prose; "Invite to edit" always shows for an owned trip.
- `ShareLink` is new to this codebase (verified: none exists). `ShareLink(item:)` accepts a `URL` or a `String` (both `Transferable`); no UIKit bridge needed.
- Keep the existing Add Photo + Delete Trip toolbar items unchanged.

**Testing:**
- native-ios-sharing-polish.AC3.5: a `-uitest` SampleData trip (no secret token) must NOT show the Share button. Extend the UITests (which already navigate into a trip under `-uitest`) to assert the "Share" toolbar button does not exist for a SampleData trip. This is the unit-reachable AC; AC3.1 (shown for owned) + AC3.4 (invite text content) + AC3.3 (web page opens) are device/manual because an owned trip requires the live backend and `ShareLink` presents a system sheet.
- Add device-checklist items (in `docs/device-test-checklist.md`): Share button appears on an owned trip; "Share view link" opens the read-only web page on a device WITHOUT the app; "Invite to edit" share sheet text contains the token and a recipient can paste-import it.

**Verification:**
Run: `cd ios-swift/RoadTrip && xcodegen generate --spec project.yml --project . && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd build` then the SampleData-trip UI test.
Expected: BUILD SUCCEEDED; the AC3.5 UI assertion passes.

**Commit:** `feat(ios): share view link + invite-to-edit from the trip toolbar`
<!-- END_TASK_3 -->
