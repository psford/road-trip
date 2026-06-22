# Native iOS UI Polish (Round 2) — Phase 5: Merged floating top bar

**Goal:** Replace the system navigation bar on the trip detail screen with a single **floating inset bar** over the map containing the back button, the left-justified trip name, the Share menu (owned-trip gated), and the `+` (Add-Photo) menu. Remove the Delete control entirely (deletion now lives only in the Archived view).

**Architecture:** Hide the system nav bar with `.toolbar(.hidden, for: .navigationBar)`, drop the `.navigationTitle`, and overlay a custom `.regularMaterial` rounded bar at the top, safe-area aware, with side margins. Back calls the existing `@Environment(\.dismiss)`. The Share menu (keeping its `secretToken != nil` gate) and the Phase 4 `addPhotoMenu` move into the bar. The Delete toolbar item is deleted. The existing `testDeleteTripFlow` (which tapped the old "Delete Trip" button) is rewritten to the new archive→permanent-delete path.

**Tech Stack:** SwiftUI (`.toolbar(.hidden:)`, `.overlay`, `.regularMaterial`, `safeAreaInset`/`safeAreaPadding`, `@Environment(\.dismiss)`), XCUITest.

**Scope:** Phase 5 of 5. Depends on **Phase 3** (Delete must have its alternative home — the Archived view) and **Phase 4** (the `+` menu lands in the bar).

**Codebase verified:** 2026-06-20 via codebase-investigator.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### native-ios-ui-polish-2.AC4: Merged floating top bar
- **native-ios-ui-polish-2.AC4.1 Success:** The trip detail screen shows a single floating inset bar containing the back control, the left-justified trip name, Share, and +.
- **native-ios-ui-polish-2.AC4.2 Success:** Back returns to My Trips; the Share control keeps its owned-trip gate (hidden when the trip has no secret token).
- **native-ios-ui-polish-2.AC4.3 Edge:** No Delete or Archive action appears on the trip detail screen (deletion lives only in the Archived view); the "Add Photo" control retains its accessible label/identifier for `RoadTripUITests.testSampleDataTripHidesShareButton`.

> **Device-verified:** the bar's layout/legibility over the map and safe-area behavior (notch/Dynamic Island/home indicator) → `docs/device-test-checklist.md` (Task 4).

---

## Findings that shape this phase (from investigation)

- `Views/Trips/TripDetailView.swift`:
  - Body is a `ZStack` (`~:39-168`) over `mapSection` + overlays. `.navigationTitle(trip.name)` + `.navigationBarTitleDisplayMode(.inline)` at `:87-88`.
  - `.toolbar { }` block at `:89-120` contains three `.topBarTrailing` items: Share menu (`:90-104`, gated `if let secretToken`), Add-Photo (`:105-111`, becomes Phase 4's menu), Delete (`:112-119`, **to remove**).
  - `@Environment(\.dismiss) private var dismiss` at `:19`, already used at `:321` after delete. Back button will call `dismiss()`.
  - Share tokens loaded by `loadShareTokens()` (`:170-174`) into `@State secretToken`/`shareViewToken` (`:36-37`).
  - **There is NO pre-existing floating action pill** — the new bar is built from scratch; only the toolbar items move into it.
  - `.regularMaterial` is already used in the app (toast `:81`, upload banner `:517`, popup) — match that styling.
- Navigation: `TripListView` pushes via `NavigationLink` in a `NavigationStack`, so there is a system back button today; hiding the nav bar removes it, so the floating bar MUST provide its own back control.
- `RoadTripUITests.swift`:
  - `testSampleDataTripHidesShareButton` (`:214-232`) waits on `app.buttons["Add Photo"]` and asserts `app.buttons["Share"]` does NOT exist for a SampleData (no-secret-token) trip. **Both must keep their labels.**
  - `testDeleteTripFlow` (`:82-109`) taps `app.buttons["Delete Trip"]` then confirms — **this breaks when Delete is removed here.** It must be rewritten (Task 3).
  - `testTappingMapPinOpensPhotoDetail` uses `app.buttons["popup-close"]` (unaffected).

---

<!-- START_TASK_1 -->
### Task 1: Build the floating inset bar and hide the system nav bar

**Verifies:** native-ios-ui-polish-2.AC4.1, native-ios-ui-polish-2.AC4.2

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift` (remove `:87-88` nav title; replace `.toolbar` block `:89-120`; add overlay)

**Implementation:**

1. **Hide the system nav bar and drop the title:**
   - Remove `.navigationTitle(trip.name)` and `.navigationBarTitleDisplayMode(.inline)` (`:87-88`).
   - Add `.toolbar(.hidden, for: .navigationBar)` to the view.

2. **Remove the entire `.toolbar { }` block** (`:89-120`) — Share, Add-Photo, and Delete all leave the system toolbar. (Delete is gone for good; Share and Add-Photo relocate to the bar in step 3.)

3. **Add the floating bar as a top overlay** on the root `ZStack`, safe-area aware with side margins, on `.regularMaterial`:
   ```swift
   .overlay(alignment: .top) {
       floatingTopBar
           .padding(.horizontal, 12)
           .padding(.top, 8)          // sits below the safe-area top inset
   }
   ```
   Implement `floatingTopBar` as a computed view:
   ```swift
   @ViewBuilder private var floatingTopBar: some View {
       HStack(spacing: 12) {
           Button { dismiss() } label: {
               Image(systemName: "chevron.backward")
                   .font(.headline)
           }
           .accessibilityLabel(Text("Back"))
           .accessibilityIdentifier("trip-back")

           Text(trip.name)
               .font(.headline)
               .lineLimit(1)
               .truncationMode(.tail)
               .frame(maxWidth: .infinity, alignment: .leading)   // left-justified title

           if secretToken != nil {
               shareMenu          // existing Share menu content, extracted (keeps the gate + "Share" label)
           }
           addPhotoMenu           // the Phase 4 reusable Add-Photo menu ("Add Photo" identifier preserved)
       }
       .padding(.horizontal, 14)
       .padding(.vertical, 10)
       .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
       .shadow(radius: 4, y: 2)
   }
   ```
   - Extract the existing Share `Menu` (`:90-104`) into a `@ViewBuilder private var shareMenu` so the gate (`secretToken != nil`), the `shareViewToken` inner conditional, the `ShareLink`s, and the `Label("Share", systemImage: "square.and.arrow.up")` are preserved verbatim. Keep the "Share" label so the UI test's `app.buttons["Share"]` check stays valid.
   - `addPhotoMenu` is the reusable menu created in Phase 4 (keeps the `"Add Photo"` accessibility identifier). If Phase 4 left a `PhotosPicker`/menu in the toolbar, ensure it now lives ONLY in the bar (no duplicate control).
   - The bar respects the top safe area because it's a `.top`-aligned overlay inside the safe area by default; verify it doesn't collide with the Dynamic Island (adjust `.padding(.top)` if needed during device check).

4. **Map content offset:** the bar floats over the map; ensure it doesn't permanently obscure map controls. The existing `.mapControls` and the Phase 1 route-toggle overlay sit elsewhere on the map; confirm no overlap (nudge paddings if the route toggle at top-trailing visually clashes with the bar — the bar spans the full width at the very top, the route toggle is below it; verify on device in Task 4).

**Verification:**
Run: `xcodegen generate && xcodebuild ... build`
Expected: builds; trip detail shows the floating bar; no system nav bar.

**Commit:** `feat(ios): floating inset top bar (back + title + Share + +); hide nav bar`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Remove Delete from trip detail (and its now-dead code)

**Verifies:** native-ios-ui-polish-2.AC4.3

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Trips/TripDetailView.swift`

**Implementation:**
- The Delete `ToolbarItem` (`:112-119`) is already gone with the toolbar removal in Task 1. Now remove its supporting code so nothing dead remains and no Delete/Archive action exists on this screen (AC4.3):
  - `@State private var showingDeleteConfirm`, `isDeleting`, `deleteError` (`~:24-26`) and the `.confirmationDialog("Delete this trip?", ...)` (`:133-138`) + the delete error `.alert` (`:139-146`) + the `deleteTrip()` function (which calls `dismiss()` at `:321`).
  - **Caution:** verify nothing else references these (e.g. `isDeleting` disabling other controls). Remove only what was exclusively for the trip-detail delete. The actual deletion capability now lives in `ArchivedTripsView` (Phase 3) — do not remove `RoadTripAPI.deleteTrip`.
- Confirm there is NO Archive action on the trip detail screen either (archiving is a My Trips swipe action only) — AC4.3.

**Verification:**
Run: `xcodebuild ... build`
Expected: builds with no unused-symbol or unreachable-code warnings related to delete; trip detail has no Delete/Archive control.

**Commit:** `refactor(ios): remove Delete from trip detail (lives in Archived view now)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Rewrite `testDeleteTripFlow` for the new deletion path

**Verifies:** native-ios-ui-polish-2.AC4.2, native-ios-ui-polish-2.AC4.3 (permanent-delete itself — AC2.4 — is owned by Phase 3's `testPermanentDeleteRequiresConfirmation`)

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift:82-109`

**Testing:**
NOTE on the existing test (verify before editing): the current `testDeleteTripFlow` (`:82-109`) does NOT open a SampleData trip — it creates a brand-new trip named `"Trip To Delete"` via the New Trip flow, opens it, taps `app.buttons["Delete Trip"]`, and confirms. That `"Delete Trip"` button no longer exists after Task 2, so the test must be rewritten.

Rewrite it to exercise the new contract (and assert the detail screen no longer offers Delete). Recommended shape — rename to `testTripDetailHasNoDeleteAndBackWorks` covering AC4.3 + AC4.2, and let Phase 3's `testPermanentDeleteRequiresConfirmation` own the actual permanent-delete assertion (avoid duplicating an identical end-to-end):
- Open the seed trip `"Pacific Coast Highway"` (the anchor the other detail tests already use). Assert the floating bar is present (`app.buttons["trip-back"]` exists) and that `app.buttons["Delete Trip"]` does NOT exist on the detail screen (AC4.3).
- Tap `app.buttons["trip-back"]`; assert you're back on My Trips (the list title / a known row is visible) (AC4.2).
- Document the consolidation choice in a comment so a reader knows permanent-delete is covered by the Phase 3 test, not here.
- (No live-server concern: this rewritten test never performs a delete; it only asserts UI structure + back navigation.)

**Verification:**
Run: `xcodebuild ... -only-testing:RoadTripUITests/RoadTripUITests test`
Expected: the rewritten test passes; `testSampleDataTripHidesShareButton` still passes; no test references a `"Delete Trip"` button on the detail screen.

**Commit:** `test(ios): replace detail Delete flow with back-button + no-delete assertions`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Device checklist for the floating bar

**Verifies:** native-ios-ui-polish-2.AC4.1 (device layout)

**Files:**
- Modify: the project's device checklist (same path as Phase 1/Phase 4).

**Implementation:** Add items:
- [ ] **AC4.1 (device):** Trip detail shows ONE floating inset bar over the map: back (left), trip name left-justified, then Share + `+`. Side margins look right; rounded; `.regularMaterial` legible over varied map content.
- [ ] **Safe area:** the bar clears the notch/Dynamic Island and is not clipped; the route-toggle overlay (Phase 1) and map controls don't collide with it.
- [ ] **AC4.2 (device):** Back returns to My Trips; Share hidden for SampleData (no secret token), shown for owned trips.

**Verification:** Markdown only.

**Commit:** `docs(ios): device checklist for floating top bar (AC4.1)`
<!-- END_TASK_4 -->

---

## Phase 5 Done When
- Trip detail shows a single floating inset bar: back + left-justified title + Share + `+`; the system nav bar is hidden (AC4.1).
- Back returns to My Trips; Share keeps its owned-trip gate (AC4.2).
- No Delete or Archive action on the trip detail screen; "Add Photo" identifier preserved (AC4.3).
- `testSampleDataTripHidesShareButton` passes; the former `testDeleteTripFlow` is rewritten and passes; no test references a detail-screen Delete button.
- Full build succeeds; full suite green; device checklist updated.
