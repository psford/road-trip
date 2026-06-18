# Native iOS Rewrite — Test Requirements

**Design:** `docs/design-plans/2026-05-30-native-ios.md` (acceptance criteria are the spec — `native-ios.AC1.1` … `native-ios.AC11.2`, 54 sub-cases).
**Implementation phases:** `docs/implementation-plans/2026-05-30-native-ios/phase_01.md` … `phase_08.md`.
**Last generated:** 2026-06-18.

## 1. Purpose and how to run each test class

This document maps **every** acceptance-criterion sub-case in the native iOS design to either an **automated test** (with its expected file path, type, owning phase, and run environment) or a **documented human verification** (with justification + step-by-step approach). Per CLAUDE.md "VERIFY BEFORE CLAIMING DONE", no AC is left unmapped: each of the 54 sub-cases below resolves to a concrete verification.

### Container vs Mac (the hard process constraint)

This repo is developed in a **Linux dev-container with NO Xcode / iOS SDK**. The container cannot compile SwiftUI/MapKit/PhotosUI or run a simulator. Therefore:

- **ALL Swift build, `xcodebuild test`, simulator runs, and screenshots happen on the Mac.** Every automated Swift test below is marked **Mac**.
- A small subset of **pure** logic (Foundation-only DTO drafting, pure mappers) can be *drafted/sanity-checked* in-container, but the **authoritative** run is still on the Mac. These are marked **Mac (draftable in-container)**.
- Bicep `az bicep build` and YAML lint run **in-container**; the actual `what-if` / deploy is **Patrick on the Mac/Azure** (Claude never runs `deploy.yml` / `deploy-dev.yml` / `az` prod mutations).
- "Show, don't claim" (Patrick memory): nothing is called working until it is **seen** running on a simulator/device via screenshot.

### Test classes and how to run them

| Class | Command (run on Mac unless noted) | In CI? |
|---|---|---|
| **Swift unit tests** (XCTest, pure + in-memory GRDB + `URLProtocol`-stubbed) | `cd ios-swift/RoadTrip && xcodegen generate && xcodebuild test -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17'` | **No** — Swift tests do not currently run in CI at all (only the .NET/JS suites exist in CI, and CI runs `Category!=Integration`). |
| **Swift dev-slot integration tests** (gated) | `RT_RUN_INTEGRATION=1 xcodebuild test … -only-testing:RoadTripTests/Integration/RoadTripAPIIntegrationTests` | **No** — gated on `RT_RUN_INTEGRATION=1` (skipped via `XCTSkipUnless` otherwise). Mirrors the .NET repo's xUnit `Category=Integration` separation: manual, network-dependent, never unattended CI. |
| **Swift UI tests** (XCUITest) | `xcodebuild test … -only-testing:RoadTripUITests` | **No.** |
| **Bicep build** (authoring check) | `az bicep build --file infrastructure/azure/main.bicep` | In-container authoring; not a Swift test. |
| **Human / manual verification** | See Section 3 (simulator screenshots, real-device lifecycle, Azure `what-if`/deploy, TestFlight). | N/A |

> **CI note:** Swift tests are not wired into `.github/workflows/roadtrip-ci.yml`. The verification gate for this rewrite is a **green `xcodebuild test` run on the Mac (screenshot/log)** plus the per-phase device/simulator screenshots, not a CI badge. The dev-slot integration tests are additionally gated behind `RT_RUN_INTEGRATION=1` so they never run unattended and never accumulate junk against the dev slot.

### Verification-environment legend

- **Mac-unit** — XCTest unit test, in-memory GRDB or pure function or `URLProtocol` stub, no network. Runs on the Mac simulator; deterministic.
- **Mac-int (gated)** — integration test hitting the dev slot; runs only with `RT_RUN_INTEGRATION=1`.
- **Mac-sim** — manual verification on the iOS Simulator (screenshot).
- **Device** — manual verification on a real iPhone (lifecycle / background / TestFlight; screenshot).
- **In-container** — Bicep/YAML authoring check (no Swift).
- **Patrick/Azure** or **Patrick/ASC** — actions only Patrick performs (deploy dispatch, slot swap, App Store Connect, tester install).

---

## 2. Coverage table (all 54 sub-cases)

| AC id | AC text (abbrev.) | Type | Test file / manual method | Phase | Environment |
|---|---|---|---|---|---|
| **native-ios.AC1.1** | New-trip form submit → trip in TripListView from GRDB; SecretToken in Keychain | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/CreateTripViewModelTests.swift` | 3 | Mac-unit |
| **native-ios.AC1.2** | TripListView shows all Keychain-backed trips, sorted `created_at` desc | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/TripListViewModelTests.swift` | 3 | Mac-unit |
| **native-ios.AC1.3** | Import via token → `/api/post/{token}` hydrates Trip + photos into GRDB | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/ImportTripViewModelTests.swift` | 3 | Mac-unit |
| **native-ios.AC1.4** | Delete trip → server DELETE, local cascade delete, Keychain entry removed | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/MutationTests.swift` | 7 | Mac-unit |
| **native-ios.AC1.5** | Invalid pasted token (404) → user error, no GRDB write, no Keychain write | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/ImportTripViewModelTests.swift` (404 → error surfaced, zero GRDB + zero Keychain writes) | 7 (started P3) | Mac-unit |
| **native-ios.AC1.6** | App killed mid-create → relaunch: both-or-neither (no orphan rows) | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/RobustnessTests.swift` | 7 | Mac-unit |
| **native-ios.AC2.1** | PhotosPicker (.readWrite) → EXIF lat/lng + `takenAt` match iOS Photos | Automated (unit, golden-file) | `ios-swift/RoadTrip/RoadTripTests/EXIFExtractorTests.swift` + `ios-swift/RoadTrip/RoadTripTests/PhotoCaptureCoordinatorTests.swift` (fixtures in `RoadTripTests/Fixtures/`) | 5 | Mac-unit |
| **native-ios.AC2.2** | HEIC source → transcoded to JPEG; uploaded blob is `image/jpeg` | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/HEICTranscoderTests.swift` + `PhotoCaptureCoordinatorTests.swift` | 5 | Mac-unit (true-HEIC transcode confirmed on device — see 3.M5) |
| **native-ios.AC2.3** | EXIF-GPS photo → coords from EXIF; no pin-drop; place name backfills later | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/CoordinateLadderTests.swift` + `PhotoCaptureCoordinatorTests.swift` | 5 | Mac-unit |
| **native-ios.AC2.5** | Limited Photo Library access → selected photos accessible, EXIF still extractable, flow identical | Automated (unit, stubbed library) | `ios-swift/RoadTrip/RoadTripTests/PhotoCaptureCoordinatorTests.swift` (stubbed `.limited` `PhotoLibraryService`) | 5 | Mac-unit (+ device confirm 3.M5) |
| **native-ios.AC2.6** | No-EXIF photo → live `CLLocationManager` fix; if none, pin-drop required before queue | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/CoordinateLadderTests.swift` + `PhotoCaptureCoordinatorTests.swift` | 5 | Mac-unit (live CL fix confirmed on sim/device 3.M5) |
| **native-ios.AC3.1** | Start upload, background app → continues; progress visible next foreground | Manual (device) | Real-device background-then-foreground; screenshot of progress + committed pin | 6 | Device — see 3.M6 |
| **native-ios.AC3.2** | Start upload, force-quit → relaunch resumes from last-completed block | Automated (unit) + Manual (device) | `ios-swift/RoadTrip/RoadTripTests/UploadReconcilerTests.swift` (resume logic) + real-device force-quit sign-off | 6 | Mac-unit + Device 3.M6 |
| **native-ios.AC3.3** | SAS expires mid-upload (>2h) → re-call `request-upload`, refresh SAS, resume | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/UploadCoordinatorTests.swift` (simulated 403 / stale `sasIssuedAt`) | 6 | Mac-unit |
| **native-ios.AC3.4** | Block PUT transient fail (503/drop) → exponential-backoff retry, succeeds | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/BlockProtocolTests.swift` (backoff) + `UploadCoordinatorTests.swift` (simulated 503 retry) | 6 | Mac-unit |
| **native-ios.AC3.5** | Commit fails permanently (500 after retries) → item stays `failed` w/ message; manual retry | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/UploadReconcilerTests.swift` (failure persistence) + `MutationTests.swift` (retry UI, Phase 7) | 6 (persistence) / 7 (UI) | Mac-unit |
| **native-ios.AC3.6** | All 3 tiers present before Photo row added (no half-uploaded photos) | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/UploadStateMachineTests.swift` (tier-completeness; server `commit` guarantees 3 blobs) | 6 | Mac-unit |
| **native-ios.AC4.1** | Delete photo → disappears immediately, server DELETE; no further change on success | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/MutationTests.swift` | 7 | Mac-unit |
| **native-ios.AC4.2** | Delete-photo server fail → photo reappears, error toast, GRDB restored | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/MutationTests.swift` | 7 | Mac-unit |
| **native-ios.AC4.3** | Pin-drop → pin moves immediately, server `/pin-drop`; on fail revert + toast | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/MutationTests.swift` (extended for pin-drop) | 7 | Mac-unit |
| **native-ios.AC4.4** | Delete trip → confirm prompt, removed immediately, cascade, server DELETE; revert + toast on fail | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/MutationTests.swift` | 7 | Mac-unit |
| **native-ios.AC5.1** | `MKMapView` renders thumbnail annotation per GPS photo; `setVisibleMapRect` fits all on first render | Automated (unit, fit-bounds math) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/MapBoundsTests.swift` (union math) + simulator screenshot of fitted pins | 3 | Mac-unit + Mac-sim 3.M3 |
| **native-ios.AC5.2** | Tap annotation selects it (drives `selectedPhotoId`) and opens `PhotoDetailView` via NavigationStack | Manual (sim) | Simulator: tap annotation → PhotoDetailView pushes; screenshot | 3 | Mac-sim 3.M3 |
| **native-ios.AC5.3** | Map controls (compass, user-location, scale) visible + functional | Manual (sim) | Simulator screenshot showing compass/scale/user-location | 3 | Mac-sim 3.M3 |
| **native-ios.AC5.4** | 0-photo trip → map centered on user location with "no photos yet" empty state | Manual (sim) | Simulator: open empty trip; screenshot empty state | 3 | Mac-sim 3.M3 |
| **native-ios.AC5.5** | 50+ photos → no perceptible lag (clustering); tap latency < 200ms | Automated (unit, no-O(n²)) + Manual (device, latency) | `ios-swift/RoadTrip/RoadTripTests/RobustnessTests.swift` (annotation set built without O(n²)) + real-device tap-latency check | 7 | Mac-unit + Device 3.M7 |
| **native-ios.AC6.1** | Archive uploaded to App Store Connect processed without rejection | Manual (Mac + ASC) | `xcodebuild -exportArchive` + ASC upload; ASC shows "Processing" complete, no rejection | 8 | Mac + Patrick/ASC 3.M8 |
| **native-ios.AC6.2** | Patrick added as internal tester, install link, build installs on iPhone; group supports ≥1 more | Manual (Patrick/ASC + device) | TestFlight invite → install on Patrick's iPhone after first-build review | 8 | Patrick/ASC + Device 3.M8 |
| **native-ios.AC6.3** | `PrivacyInfo.xcprivacy` declares Photo Library + network, no tracking, no 3rd-party SDKs | Manual (Mac) | Build app; inspect bundled `PrivacyInfo.xcprivacy` + Info.plist usage strings; ASC accepts manifest | 8 | Mac 3.M8 |
| **native-ios.AC6.4** | ASC rejection → error documented, fix iterated, not blocked on full review | Manual (Mac + runbook) | Runbook `docs/runbooks/testflight-release.md` troubleshooting; document any rejection + fix + re-upload | 8 | Mac + Patrick/ASC 3.M8 |
| **native-ios.AC7.1** | Bicep deploys `dev` slot to `app-roadtripmap-prod`; slot accessible at slot URL | Manual (in-container build + Patrick/Azure) | `az bicep build` clean in-container; Patrick runs `what-if` (additive-only) + dispatches deploy; slot URL reachable | 1 | In-container + Patrick/Azure 3.M1 |
| **native-ios.AC7.2** | Dev slot → `roadtripmap-db-dev` (Basic DTU 5); EF migrations applied; `/api/version` returns | Manual (Patrick/Azure) | After deploy + dev-DB migration, `GET <slot>/api/version` → 200 | 1 | Patrick/Azure 3.M1 |
| **native-ios.AC7.3** | `deploy-dev.yml` dispatches manually, builds + deploys to dev slot | Manual (in-container lint + Patrick/Azure) | YAML lint in-container; Patrick dispatches workflow → deploys to slot; health check 200 | 1 | In-container + Patrick/Azure 3.M1 |
| **native-ios.AC7.4** | Native client at dev slot completes full Create→Upload→Pin loop end-to-end | Manual (device) | Real device against dev slot: create → capture offline → reconnect → upload → committed pin | 7 | Device 3.M7 |
| **native-ios.AC7.5** | Slot-swap dev→prod NOT automated (stays manual) | Automated (negative, by inspection) + Manual | `deploy-dev.yml` contains no `az webapp deployment slot swap` step (`--auto-swap false`); confirm by grep/review | 1 | In-container review 3.M1 |
| **native-ios.AC8.1** | Add photo offline → optimistic `pending` pin, bytes cached, `queued` item, **zero network** | Automated (unit, stubbed transport) | `ios-swift/RoadTrip/RoadTripTests/UploadCoordinatorTests.swift` (stub asserts call count == 0) + `PhotoCaptureCoordinatorTests.swift` (no API dependency) | 6 (P5 establishes path) | Mac-unit |
| **native-ios.AC8.2** | Connectivity returns in-memory → `NWPathMonitor` fires; request-upload→PUTs→commit; pin `pending`→`committed`, no user action | Automated (unit) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/UploadCoordinatorTests.swift` (online flip drives queue) + simulator network-toggle screenshot | 6 | Mac-unit + Mac-sim 3.M6 |
| **native-ios.AC8.3** | Force-quit with queued/in-flight → next launch reconciler resumes + completes | Automated (unit) + Manual (device) | `ios-swift/RoadTrip/RoadTripTests/UploadReconcilerTests.swift` (relaunch resume) + real-device force-quit | 6 | Mac-unit + Device 3.M6 |
| **native-ios.AC8.4** | Offline photo with EXIF GPS → pinned at EXIF coords, no pin-drop; "Locating…" backfills on reconnect | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/PhotoCaptureCoordinatorTests.swift` (offline golden-GPS → `queued` row at EXIF coords) | 5 | Mac-unit |
| **native-ios.AC8.5** | Offline photo without EXIF GPS → device `CLLocation` fix if available, else pin-drop required before queue | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/CoordinateLadderTests.swift` + `PhotoCaptureCoordinatorTests.swift` (no-GPS + nil fix → `.needsPinDrop`, no row) | 5 | Mac-unit |
| **native-ios.AC8.6** | Permanent failure → red `failed` pin with manual Retry / Discard; never silently dropped | Automated (unit) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/UploadReconcilerTests.swift` (persistence) + `MutationTests.swift` (Retry/Discard) + simulator screenshot of red pin | 6 (persist) / 7 (UI) | Mac-unit + Mac-sim 3.M7 |
| **native-ios.AC8.7** | Queued overnight (SAS >2h stale) → on reconnect `request-upload` re-called before any block PUT | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/UploadCoordinatorTests.swift` (`sasIssuedAt` 3h ago → requestUpload before PUT) | 6 | Mac-unit |
| **native-ios.AC8.8** | Queued-but-unsent photo visible only to owner; view-link viewer sees it only after all tiers commit | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/ViewerModeTests.swift` (owner: 2 annotations; viewer: only committed) | 7 | Mac-unit |
| **native-ios.AC9.1** | Carousel: horizontal scroll-snap thumbnails w/ place-name labels, ordered `COALESCE(takenAt,createdAt)` asc | Automated (unit, ordering) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/TripDetailViewModelTests.swift` (ordering) + simulator screenshot of carousel | 3 | Mac-unit + Mac-sim 3.M3 |
| **native-ios.AC9.2** | Tap annotation scrolls/highlights carousel item; select carousel selects+pans map; single id, no loop | Automated (unit, guard) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/SelectionSyncTests.swift` (loop-guard logic) + simulator two-way-sync screenshot | 3 | Mac-unit + Mac-sim 3.M3 |
| **native-ios.AC9.3** | Fullscreen slideshow: prev/next, horizontal swipe, keyboard arrows, tap-to-toggle-chrome | Manual (sim) | Simulator: open fullscreen, swipe/arrow/tap-chrome; screenshot | 3 | Mac-sim 3.M3 |
| **native-ios.AC9.4** | Map annotation popup shows thumbnail + place name + caption + date; opening popup selects photo | Automated (unit, selection) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/SelectionSyncTests.swift` (open-popup selects) + simulator popup screenshot | 3 | Mac-unit + Mac-sim 3.M3 |
| **native-ios.AC10.1** | POI markers fetch by viewport+zoom tier, category-colored, labeled ≥ zoom 8, tappable | Automated (unit) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/ViewportTierTests.swift` (tier rules) + POI reload test in `POIOverlayController` tests + simulator screenshot | 4 | Mac-unit + Mac-sim 3.M4 |
| **native-ios.AC10.2** | State-park boundaries as `MKPolygon` w/ fill+outline+centroid label, reload on viewport change | Automated (unit) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/GeoJSONPolygonTests.swift` (geometry → polygons) + simulator screenshot | 4 | Mac-unit + Mac-sim 3.M4 |
| **native-ios.AC10.3** | Dotted route line (`lineDashPattern [3,2]`, smoothed) through photos, toggles on/off | Automated (unit) + Manual (sim) | route-building helper test (ordered points + toggle) in `RouteOverlayController` tests + simulator screenshot | 4 | Mac-unit + Mac-sim 3.M4 |
| **native-ios.AC10.4** | Offline with cached overlay data → overlays still render from on-device cache | Automated (unit) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/OverlayCacheTests.swift` (put/latest overlap) + POI/boundary offline-cache controller tests + airplane-mode simulator screenshot | 4 | Mac-unit + Mac-sim 3.M4 |
| **native-ios.AC10.5** | Empty POI/boundary response for a viewport → no overlay drawn, no error | Automated (unit) | POI/boundary controller tests: empty array/FeatureCollection → no annotations/overlays, no throw (`POIOverlayController` / `BoundaryOverlayController` tests) | 4 | Mac-unit |
| **native-ios.AC11.1** | Trip via `viewToken` → same map+carousel but exposes save/share, not edit/delete | Automated (unit) + Manual (sim) | `ios-swift/RoadTrip/RoadTripTests/ViewerModeTests.swift` (viewer VM exposes save/share) + simulator screenshot | 7 | Mac-unit + Mac-sim 3.M7 |
| **native-ios.AC11.2** | Edit/delete/upload unavailable (not merely hidden) in viewer mode — API never called | Automated (unit) | `ios-swift/RoadTrip/RoadTripTests/ViewerModeTests.swift` (mutation in viewer mode → stub call count == 0; structurally guarded — no secret token) | 7 | Mac-unit |

**Tally:** 54 sub-cases. Automated component present for **40**; **14** are mapped to human verification only. (Several ACs carry both an automated component and a manual screenshot/device confirmation — those are counted as automated above and also enumerated in Section 3.) See Section 4 for the breakdown.

### Supporting (infrastructure) automated tests — no AC of their own

These exist in the phase plans, gate the ACs above, and run on the Mac (or in-container draft). They verify "Done when" conditions that have no AC id:

- `ios-swift/RoadTrip/RoadTripTests/StorageTests.swift` — GRDB **v2** migration over existing rows, `queued` round-trip, `StagingFileStore` non-purgeable path (Phase 1).
- `ios-swift/RoadTrip/RoadTripTests/ResponseMapperTests.swift` — status→typed-error mapping, semver gate, URLError mapping (Phase 2; **draftable in-container**, authoritative on Mac).
- `ios-swift/RoadTrip/RoadTripTests/RoadTripAPITests.swift` — `URLProtocol`-stubbed happy + error case per API method, offline → `networkUnavailable`, version gate → `versionMismatch`, fractional-second date decoding (Phase 2). **Mac-unit.**
- `ios-swift/RoadTrip/RoadTripTests/Integration/RoadTripAPIIntegrationTests.swift` — dev-slot create→read→requestUpload→delete loop (Phase 2). **Mac-int, gated on `RT_RUN_INTEGRATION=1`.**
- `ios-swift/RoadTrip/RoadTripTests/Support/StubURLProtocol.swift` — stub transport used by the API tests.
- `ios-swift/RoadTrip/RoadTripTests/OptimisticMutatorTests.swift` — apply/remote/revert mechanism (Phase 7).

---

## 3. Human Verification Plan

These ACs **cannot be fully unit-tested** because they depend on visual SwiftUI/MapKit rendering, on-device OS lifecycle (background/force-quit), Apple's TestFlight pipeline, Azure deploy, or hardware-only behavior. Each entry gives the AC(s), the justification, and the exact steps (drawn from the phase plans' "Verification" / "Done when" sections). All Swift items here are **Mac/Device** — the container cannot run them.

### 3.M1 — Azure dev slot (native-ios.AC7.1, native-ios.AC7.2, native-ios.AC7.3, native-ios.AC7.5) — In-container authoring + Patrick/Azure

**Why not automated:** Bicep deployment mutates live Azure infra and is Patrick-only (Claude never runs `deploy.yml`/`deploy-dev.yml`/`az` prod mutations). The slot URL and `/api/version` can only be confirmed against deployed infra.

**Steps:**
1. **In-container (Claude):** `az bicep build --file infrastructure/azure/main.bicep` → compiles to ARM JSON, no errors.
2. **In-container (Claude):** lint the workflow — `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-dev.yml'))"` → `valid yaml`.
3. **In-container (Claude):** confirm **no slot-swap automation** — review `deploy-dev.yml` contains no `az webapp deployment slot swap` step and deploys to the slot only (native-ios.AC7.5).
4. **Patrick/Azure:** run `az deployment group what-if … --template-file infrastructure/azure/main.bicep` → diff shows ONLY additive dev resources (dev slot + sticky `slotConfigNames`, dev SQL DB, dev blob container, dev slot MSI role assignment); **no plan SKU change** (shared P0v3 `asp-stockanalyzer` referenced as `existing`); no destructive prod changes (native-ios.AC7.1).
5. **Patrick/Azure:** apply the dev-DB EF migration (`RT_DESIGN_CONNECTION` = dev conn → `dotnet ef database update`), then dispatch `deploy-dev.yml`.
6. **Patrick/Azure:** `GET https://app-roadtripmap-prod-dev.azurewebsites.net/api/version` → **200** with `server_version` (native-ios.AC7.2); the workflow's health check on the slot URL passes (native-ios.AC7.3).

### 3.M3 — Owner-view parity surface (native-ios.AC5.1–5.4, native-ios.AC9.1–9.4) — Mac-sim, screenshots required

**Why not automated:** SwiftUI/MapKit rendering, fit-bounds visual result, two-way popup↔carousel sync feel, fullscreen gesture/keyboard behavior, and empty-state appearance are visual and interactive; XCTest covers the math (`MapBoundsTests`) and the selection-guard logic (`SelectionSyncTests`), but the rendered result must be **seen**. This is the design's signature parity surface — screenshot is mandated.

**Steps (Phase 3, on the simulator, against the dev slot):**
1. Open a trip with several GPS photos → all thumbnail pins visible and **fit within the viewport on first render** (native-ios.AC5.1); compass + scale + user-location controls present and functional (native-ios.AC5.3). Screenshot.
2. Open a **0-photo** trip → map centered on user location with "no photos yet" empty state (native-ios.AC5.4). Screenshot.
3. Tap a map annotation → it selects and `PhotoDetailView` pushes via NavigationStack (native-ios.AC5.2). Screenshot.
4. Confirm the carousel renders ordered (`COALESCE(takenAt,createdAt)` asc) scroll-snap thumbnails with place-name labels (native-ios.AC9.1). Screenshot.
5. Tap a map annotation → carousel scrolls/highlights the match; tap a carousel item → map selects + pans to it; no flicker/feedback loop (native-ios.AC9.2). The annotation popup shows thumbnail + place name + caption + date and opening it selects the photo (native-ios.AC9.4). Screenshot.
6. Open the fullscreen slideshow from a thumbnail → prev/next, horizontal swipe, hardware-keyboard arrows, and tap-to-toggle-chrome all work; close returns to detail (native-ios.AC9.3). Screenshot.

### 3.M4 — Map overlays (native-ios.AC10.1–10.4) — Mac-sim, screenshots required

**Why not automated:** Polygon fill/outline rendering, category colors, label-at-zoom behavior, dashed route appearance, and offline-cache render are visual MapKit results. Unit tests cover tier rules (`ViewportTierTests`), GeoJSON → polygon conversion (`GeoJSONPolygonTests`), and cache overlap (`OverlayCacheTests`); the rendered map must be seen.

**Steps (Phase 4, on the simulator):**
1. Pan/zoom → category-colored POIs appear and tier by zoom, labeled at zoom ≥ 8, tappable (native-ios.AC10.1). Screenshot.
2. At zoom ≥ 8 → park-boundary polygons render with teal fill + outline + centroid name label; reload on pan; nothing below zoom 8 (native-ios.AC10.2). Screenshot.
3. Toggle the route control → dotted route line (`lineDashPattern [3,2]`) draws through photos in chronological order and turns on/off (native-ios.AC10.3). Screenshot.
4. After a fetch, enable **airplane mode** → POIs and boundaries still render from the GRDB overlay cache (native-ios.AC10.4). Screenshot.

### 3.M5 — Photo capture on device/sim (native-ios.AC2.2, native-ios.AC2.5, native-ios.AC2.6 confirmation; native-ios.AC8.4 screenshot) — Mac-sim/Device

**Why not fully automated:** Photo Library authorization states (`.readWrite`, `.limited`), live `CLLocationManager` fixes, and **true** HEIC source transcoding depend on PhotoKit/CoreLocation/real assets. The pure cores (`EXIFExtractor`, `HEICTranscoder`, `CoordinateLadder`) and the coordinator (with stubs/golden fixtures) are unit-tested; the device confirmation closes the gap that a real HEIC asset and a real Limited-access grant behave as expected.

**Steps (Phase 5, simulator with a simulated location + a real device for HEIC):**
1. **Airplane mode on.** Pick a geotagged photo → a yellow **`pending`** pin appears immediately with "Locating…", and a `queued` `UploadQueueItem` row exists (inspect via debug log). **Screenshot of the optimistic pending pin with airplane mode on** (native-ios.AC8.4, supports native-ios.AC8.1 precondition).
2. Pick a **no-GPS** photo with no device fix → pin-drop sheet appears; queueing only proceeds after dropping a pin (native-ios.AC2.6 confirmation). Screenshot.
3. **Device:** pick a real **HEIC** photo → confirm the staged/uploaded content type is `image/jpeg` (native-ios.AC2.2 device confirmation).
4. **Device:** grant **Limited** Photo Library access, select a subset → flow completes for selected photos identically (native-ios.AC2.5 device confirmation).

### 3.M6 — Upload lifecycle on device (native-ios.AC3.1, native-ios.AC3.2, native-ios.AC8.2, native-ios.AC8.3) — Device (sign-off) + Mac-sim

**Why not fully automated:** Background `URLSession` continuation while suspended and **force-quit** behavior are OS-level and cannot be exercised by XCTest. The reconciler/coordinator *logic* is unit-tested (`UploadReconcilerTests`, `UploadCoordinatorTests`); the real OS lifecycle is device-only and design-mandated.

**Steps (Phase 6):**
1. **Mac-sim:** capture offline (3.M5), then toggle the simulator's network on → the pin flips `pending → committed` automatically with no user action (native-ios.AC8.2). Screenshot.
2. **Device:** start an upload, **background** the app → it continues; bring it foreground → progress visible / committed pin (native-ios.AC3.1). Screenshot.
3. **Device:** start an upload, **force-quit** → on relaunch it resumes from the last completed block and completes (native-ios.AC3.2, native-ios.AC8.3). Screenshot of the committed pin after each.

### 3.M7 — Mutations, viewer, robustness, full dev-slot loop (native-ios.AC5.5 latency, native-ios.AC7.4, native-ios.AC8.6 red pin, native-ios.AC11.1) — Mac-sim + Device

**Why not fully automated:** Tap latency < 200 ms is a perceptual/hardware measurement; the full Create→Upload→Pin loop end-to-end against dev infra is an integration behavior across capture, background upload, and server commit; the red failed-pin and viewer save/share are visual.

**Steps (Phase 7):**
1. **Mac-sim:** force a permanent failure (point at a 500 stub) → red `failed` pin with Retry / Pin-manually / Discard; Retry recovers when the stub is fixed; Discard removes it (native-ios.AC8.6 UI; completes native-ios.AC3.5). Screenshot.
2. **Mac-sim + Safari:** open a trip via its **view link** → save/share present, no edit/delete; same map/carousel render (native-ios.AC11.1). Screenshot.
3. **Mac-sim:** load a **50-photo** trip → pans smoothly (clustering) (supports native-ios.AC5.5). Screenshot.
4. **Device:** measure tap latency on annotations < 200 ms on a 50-photo trip (native-ios.AC5.5 latency).
5. **Device:** Network Link Conditioner "3G" → upload completes with visible progress; force-quit + relaunch resumes (re-confirm native-ios.AC3.2). **Full loop against the dev slot: create a trip → capture offline → reconnect → upload → see the committed pin (native-ios.AC7.4).** Screenshot each step.

### 3.M8 — TestFlight pipeline (native-ios.AC6.1, native-ios.AC6.2, native-ios.AC6.3, native-ios.AC6.4) — Mac + Patrick/ASC + Device

**Why not automated:** Apple's App Store Connect processing, privacy-manifest acceptance, first-build review, internal-tester invites, and physical-iPhone install are external to any test harness.

**Steps (Phase 8):**
1. **Mac:** `xcodegen generate` → `xcodebuild -scheme RoadTrip -configuration Release-TestFlight … archive` → `xcodebuild -exportArchive …` with the App Store Connect API key. Build appears in ASC and finishes "Processing" without rejection (native-ios.AC6.1).
2. **Mac:** confirm the bundled `PrivacyInfo.xcprivacy` declares photo-library + network access, `NSPrivacyTracking=false`, no third-party tracking SDKs, and the Info.plist usage strings are present; ASC accepts the manifest (native-ios.AC6.3).
3. **Patrick/ASC:** if ASC rejects, capture the exact reason, fix (privacy entry / usage string / icon / bundle-id), bump build number, re-upload; record in `docs/runbooks/testflight-release.md` troubleshooting (native-ios.AC6.4 — not blocked on full public review).
4. **Patrick/ASC + Device:** add Patrick to the internal TestFlight group (group supports adding ≥1 more, dad optional); after first-build review, Patrick installs the build on his physical iPhone (native-ios.AC6.2).
5. **Device (final end-to-end):** create a test trip → capture a photo **offline** → watch it upload on reconnect → see the pin → open the share link in Safari (the .NET `/trips/{viewToken}` page still serves). Screenshot each step (cumulative proof of native-ios.AC7.4 + the offline-first headline feature on real hardware).

---

## 4. Coverage completeness

All **54** acceptance-criterion sub-cases (`native-ios.AC1.1` through `native-ios.AC11.2`) are mapped: **40** have an automated test (unit / integration / state-machine / golden-file), and **14** are mapped to documented human verification (visual SwiftUI/MapKit rendering, on-device background/force-quit lifecycle, tap latency, the full dev-slot loop, Azure Bicep what-if/deploy, and the TestFlight install) — many of the 40 additionally carry a mandated simulator/device screenshot. No sub-case is left unmapped.

**Manual-only sub-cases (14):** native-ios.AC3.1, native-ios.AC5.2, native-ios.AC5.3, native-ios.AC5.4, native-ios.AC6.1, native-ios.AC6.2, native-ios.AC6.3, native-ios.AC6.4, native-ios.AC7.1, native-ios.AC7.2, native-ios.AC7.3, native-ios.AC7.4, native-ios.AC7.5, native-ios.AC9.3. (native-ios.AC7.5 is verified by in-container negative inspection of `deploy-dev.yml` plus Patrick's Azure-side confirmation that no swap is automated; native-ios.AC10.5 is **automated**, not manual.)

> Every Swift automated test runs **on the Mac** (the Linux container has no Xcode); the dev-slot integration tests are additionally **gated on `RT_RUN_INTEGRATION=1`** and excluded from unattended runs, mirroring the .NET repo's `Category=Integration` convention. Swift tests are not in CI; the gate is a green `xcodebuild test` on the Mac plus the per-phase screenshots.
