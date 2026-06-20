# Native iOS Sharing & Popup Polish — Phase 1: Photo Popup Chrome + Swipe-Down Dismiss

**Goal:** Move the photo popup's ⋯/✕ controls onto the card as chrome and add swipe-down-to-dismiss, eliminating the floating-controls/compass collision.

**Architecture:** Restructure `PhotoPopupView` so the card is a self-contained `VStack` (`[header bar] · [paged TabView] · [caption footer]`) and delete the screen-level floating-controls `VStack`. A vertical-dominant `DragGesture` drives a card offset + backdrop fade and dismisses past a threshold. ✕ and backdrop-tap dismissal are retained; swipe-down is the removable "device-feel" piece.

**Tech Stack:** SwiftUI (iOS 17+), `DragGesture`, `TabView(.page)`, `.regularMaterial`.

**Scope:** Phase 1 of 4.

**Codebase verified:** 2026-06-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### native-ios-sharing-polish.AC1: Photo popup chrome + dismissal
- **native-ios-sharing-polish.AC1.1 Success:** ⋯ and ✕ render in a header bar on the photo card, legible over any photo (material/scrim behind).
- **native-ios-sharing-polish.AC1.2 Success:** ✕ closes the popup.
- **native-ios-sharing-polish.AC1.3 Success:** Tapping the dimmed backdrop closes the popup.
- **native-ios-sharing-polish.AC1.4 Success:** Swiping the card down past the threshold closes it; releasing below threshold springs it back (device-verified).
- **native-ios-sharing-polish.AC1.5 Success:** Horizontal swipes still page between photos while swipe-down is active (gesture coexistence; device-verified).
- **native-ios-sharing-polish.AC1.6 Edge:** Controls no longer overlap the map compass (no screen-level floating controls).

**Verification note:** Phase 1 is a SwiftUI view restructure + gesture. SwiftUI layout/feel is not meaningfully unit-testable; this project verifies views with XCUITest (`RoadTripUITests`) and routes feel to the on-device checklist. So AC1.2 is covered by an XCUITest (tap ✕ → popup closes), AC1.1/AC1.6 by build + that UI test (controls live in the card hierarchy, nothing floats at screen top), and AC1.4/AC1.5 by the device checklist. No invented unit tests for view layout.

---

<!-- START_TASK_1 -->
### Task 1: Restructure the popup card so controls are chrome on the card

**Verifies:** native-ios-sharing-polish.AC1.1, native-ios-sharing-polish.AC1.6

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Photos/PhotoPopupView.swift:6-78` (full body restructure)

**Implementation:**
- Keep the public interface unchanged: `photos: [Photo]`, `@Binding var selection: Int`, `onClose: () -> Void`, `onMovePin: ((Photo) -> Void)? = nil`, `onDelete: ((Photo) -> Void)? = nil`.
- Keep the outer `ZStack` with the dimmed backdrop (`Color.black.opacity(0.55).ignoresSafeArea().onTapGesture { onClose() }`).
- **Delete** the screen-level `VStack` (current lines ~44-74) that floats the ⋯ `Menu` + ✕ `Button` at the top of the `ZStack`.
- Make the card a single `VStack(spacing: 0)` containing, top to bottom:
  1. **Header bar** — an `HStack`: ✕ `Button` (leading, calls `onClose()`), `Spacer()`, ⋯ `Menu` (trailing, same Move Pin / Delete Photo items, still gated on `onMovePin != nil || onDelete != nil`). Give the header a legible background over any photo: a thin `.regularMaterial` strip OR a top-edge dark gradient scrim behind the buttons. Buttons use SF Symbols (`xmark`, `ellipsis`) sized ≥ `.title3` for a 44pt tap target, `.foregroundStyle(.white)`/`.primary` as fits the scrim.
  2. **Paged photo** — the existing `TabView(selection:)` `.tabViewStyle(.page(...))`, height `imageHeight` (`min(360, max(220, geo.size.height * 0.46))`).
  3. **Caption footer** — the existing caption/place/date block (`captionHeight = 104`).
- Keep the card's `.regularMaterial` background + `shadow(radius: 14)` and centered placement.
- Header buttons must be in the card's view hierarchy (not the screen `ZStack`), so nothing renders at the screen's top-right where the MapKit compass sits.

**Testing:** None in this task (covered by Task 3's UI test + build). Do not invent unit tests for SwiftUI layout.

**Verification:**
Run: `cd ios-swift/RoadTrip && xcodegen generate --spec project.yml --project . && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd build`
Expected: BUILD SUCCEEDED, no new warnings.

**Commit:** `feat(ios): move photo popup controls onto card chrome`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add swipe-down-to-dismiss (vertical-dominant gesture)

**Verifies:** native-ios-sharing-polish.AC1.4, native-ios-sharing-polish.AC1.5 (device-verified)

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Photos/PhotoPopupView.swift` (card built in Task 1)

**Implementation:**
- Add `@State private var dragOffset: CGFloat = 0` (or `CGSize`) to the view.
- Attach a `DragGesture(minimumDistance:)` to the card that only claims **vertical-dominant downward** drags so the inner paged `TabView` keeps horizontal paging:
  - In `onChanged`, only track when `value.translation.height > 0` and `abs(value.translation.height) > abs(value.translation.width)`; set `dragOffset = value.translation.height`.
  - Fade the backdrop opacity by drag progress (e.g. `0.55 * (1 - min(dragOffset / dismissThreshold, 1))`).
  - In `onEnded`, if `dragOffset > dismissThreshold` (~120pt) **or** `value.predictedEndTranslation.height` exceeds a fast-flick threshold, call `onClose()`; otherwise animate `dragOffset` back to 0 with a spring.
- Apply `.offset(y: dragOffset)` to the card.
- Keep ✕ (`onClose`) and backdrop-tap (`onClose`) working as today — these are the fallbacks if swipe-down feels wrong on device.
- If gesture coexistence with the paged `TabView` proves fiddly on device, the documented fallback is to attach the drag only to the header + footer chrome (not the photo area). Note this in the device checklist, not here.

**Testing:** None (gesture feel is device-only — AC1.4/AC1.5 are on the device checklist).

**Verification:**
Run: same build command as Task 1.
Expected: BUILD SUCCEEDED.

**Commit:** `feat(ios): swipe-down to dismiss the photo popup`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: UI-test the close action + update the device checklist

**Verifies:** native-ios-sharing-polish.AC1.2, native-ios-sharing-polish.AC1.3

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Views/Photos/PhotoPopupView.swift` (add `.accessibilityIdentifier` to the ✕ button, e.g. `"popup-close"`, so the UI test can find it)
- Modify: `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` (extend the existing `testTappingMapPinOpensPhotoDetail` flow, which already opens the popup under `-uitest` SampleData)
- Modify: `docs/device-test-checklist.md` (§1 map/pin feel — add popup swipe-down + chrome items)

**Implementation:**
- Add an accessibility identifier to the ✕ button so it's addressable in XCUITest.
- Extend the existing popup UI test (it already taps a pin to open the popup) to: assert the ✕ button exists, tap it, and assert the popup is dismissed (the photo card / its identifier no longer present). This exercises AC1.2 end-to-end on the simulator. If practical, add a second assertion that tapping the backdrop also dismisses (AC1.3).
- In the device checklist, add: "Popup ⋯/✕ read as card chrome, legible over any photo, no compass overlap" and "Swipe the popup down to dismiss; horizontal swipe still pages photos; if it feels bad, fall back to ✕/backdrop."

**Testing:**
- native-ios-sharing-polish.AC1.2: UI test taps ✕ → popup gone.
- native-ios-sharing-polish.AC1.3: UI test taps backdrop → popup gone (if addressable; else leave to device checklist).
Follow the existing `RoadTripUITests` patterns (launch with `-uitest`, SampleData fixtures, `XCUIApplication` queries).

**Verification:**
Run: `cd ios-swift/RoadTrip && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd test -only-testing:RoadTripUITests/RoadTripUITests/testTappingMapPinOpensPhotoDetail`
Expected: test passes (popup opens and closes via ✕).
Note: other backend-dependent UITests may fail when the local backend on :5100 is down — that is pre-existing and unrelated.

**Commit:** `test(ios): UI-test photo popup close; device checklist for popup feel`
<!-- END_TASK_3 -->
