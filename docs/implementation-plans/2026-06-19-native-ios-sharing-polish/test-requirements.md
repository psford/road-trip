# Test Requirements — Native iOS Sharing & Popup Polish

Maps every acceptance criterion (`native-ios-sharing-polish.AC1.1` through `AC5.3`) to either an automated test or documented human/on-device verification. Each AC appears in exactly one section.

Build/test command:
`cd ios-swift/RoadTrip && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd test`

Conventions: pure-logic ACs are unit-tested; backend-dependent integration tests `XCTSkip` when the local backend on `:5100` is down; SwiftUI view-feel, gesture, share-sheet presentation, and operational Azure checks are routed to `docs/device-test-checklist.md`.

---

## 1. Automated tests

| AC id | Type | Test file | Asserts |
| --- | --- | --- | --- |
| native-ios-sharing-polish.AC1.2 | UI | `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` | Opening the popup then tapping the ✕ button (`popup-close` identifier) dismisses it — the photo card is no longer present. |
| native-ios-sharing-polish.AC1.3 | UI | `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` | Tapping the dimmed backdrop dismisses the popup (if the backdrop is addressable in XCUITest; otherwise deferred to the device checklist). |
| native-ios-sharing-polish.AC1.6 | UI | `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` | Popup controls live in the card hierarchy (no screen-level floating controls) — covered by build green + the popup open/close UI flow exercising the card-chrome structure. |
| native-ios-sharing-polish.AC2.1 | integration | `ios-swift/RoadTrip/RoadTripTests/UploadIntegrationTests.swift` | Regression guard: creating a trip stores its `.view` token in the Keychain for the trip's local id (skips if backend down). |
| native-ios-sharing-polish.AC2.2 | unit + integration | `ios-swift/RoadTrip/RoadTripTests/ViewTokenParsingTests.swift`; `ios-swift/RoadTrip/RoadTripTests/UploadIntegrationTests.swift` | Parser extracts the view UUID from `/trips/{uuid}` (and an absolute `https://host/trips/{uuid}`), case-insensitively; integration: importing a trip by its secret token stores a `.view` token for the imported trip's local id. |
| native-ios-sharing-polish.AC2.3 | integration | `ios-swift/RoadTrip/RoadTripTests/UploadIntegrationTests.swift` | After deleting the `.view` token, running `revalidate` backfills it for the owned trip (skips if backend down). |
| native-ios-sharing-polish.AC2.4 | unit + integration | `ios-swift/RoadTrip/RoadTripTests/ViewTokenParsingTests.swift`; `ios-swift/RoadTrip/RoadTripTests/UploadIntegrationTests.swift` | Parser returns `nil` for `nil`/`""`/`"/trips/"`/`"/trips/not-a-uuid"`; import completes (no throw, no abort) when `viewUrl` is missing — trip keeps its `.secret` token with no `.view` token. |
| native-ios-sharing-polish.AC3.2 | unit | `ios-swift/RoadTrip/RoadTripTests/TripShareLinkTests.swift` | `shareViewURL(viewToken:baseURL:)` builds the absolute URL `<base host>/trips/{viewToken.uuidString}` (tested with both the dev-slot host and a `localhost:5100` host; no double slashes). |
| native-ios-sharing-polish.AC3.5 | UI | `ios-swift/RoadTrip/RoadTripUITests/RoadTripUITests.swift` | A `-uitest` SampleData trip (no secret token) does NOT show the Share toolbar button. |
| native-ios-sharing-polish.AC4.1 | unit | `ios-swift/RoadTrip/RoadTripTests/TokenPasteTests.swift` | Regression guard: a bare secret-token UUID string still parses to that UUID (import retains write access). |
| native-ios-sharing-polish.AC4.2 | unit | `ios-swift/RoadTrip/RoadTripTests/TokenPasteTests.swift` | `firstUUID(in:)` extracts the UUID from messy paste — an invite message, a `/post/{uuid}` URL, and surrounding whitespace/newlines. |
| native-ios-sharing-polish.AC4.3 | unit | `ios-swift/RoadTrip/RoadTripTests/TokenPasteTests.swift` | Text with no UUID returns `nil`, so `importTrip` throws `RoadTripAPIError.notFound` (preserving the existing invalid-token error in `PasteTokenView`). |

---

## 2. Human / on-device verification

| AC id | Why it can't be automated | Verification approach |
| --- | --- | --- |
| native-ios-sharing-polish.AC1.1 | SwiftUI layout/legibility over arbitrary photos is a visual judgment, not unit-testable; XCUITest can't assert "reads as legible chrome." | Device checklist (`docs/device-test-checklist.md` §1): confirm ⋯/✕ render as card chrome with a material/scrim behind, legible over any photo. |
| native-ios-sharing-polish.AC1.4 | Swipe-down threshold/spring-back is gesture feel; only meaningful on a real device. | `docs/device-test-checklist.md`: swipe the card down past threshold to dismiss; release below threshold springs it back. |
| native-ios-sharing-polish.AC1.5 | Coexistence of the vertical dismiss `DragGesture` with the paged `TabView` horizontal paging is gesture feel, device-only. | `docs/device-test-checklist.md`: horizontal swipe still pages photos while swipe-down is active; documented fallback is drag on header/footer chrome only. |
| native-ios-sharing-polish.AC3.1 | An owned trip requires the live backend, and the Share button presents a system menu; not reproducible under SampleData/XCUITest. | `docs/device-test-checklist.md`: owned trip shows the Share button offering "Share view link" and "Invite to edit." |
| native-ios-sharing-polish.AC3.3 | Requires opening the shared URL in a browser on a device WITHOUT the app installed — outside the test harness. | `docs/device-test-checklist.md`: open the shared view URL on a device with no app installed; the read-only trip page (`trips.html` SPA) loads. |
| native-ios-sharing-polish.AC3.4 | `ShareLink` presents a system share sheet whose contents can't be inspected by XCUITest. | `docs/device-test-checklist.md`: "Invite to edit" share sheet text contains the trip's secret token and a recipient can paste-import it. |
| native-ios-sharing-polish.AC5.1 | One-time Azure data migration (ops, not app code); verified by direct DB inspection. | Operational: query `roadtripmap-db-dev` — Dad's `TripEntity` + `PhotoEntity` rows exist with the same secret/view tokens and a matching photo count (Phase 4, Task 3). |
| native-ios-sharing-polish.AC5.2 | Blob presence + container routing is an infrastructure check; verified by a live photo fetch, not a unit test. | Operational: list dev-container blobs at the preserved `BlobPath`s and `GET` the dev-slot photo endpoint for one photo (`/api/photos/{devTripId}/{devPhotoId}/thumb` → JPEG 200), confirming the dev host first (Phase 4, Task 3). |
| native-ios-sharing-polish.AC5.3 | End-to-end import of real data on a fresh install against the dev slot; requires a device/build and live backend. | `docs/device-test-checklist.md` (Phase 4, Task 4): import Dad's secret token on a fresh install → trip + all photos appear, photos render, write access works (add then remove a test photo). |
