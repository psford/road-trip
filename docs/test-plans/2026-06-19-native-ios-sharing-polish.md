# Human Test Plan — Native iOS Sharing & Popup Polish

Generated from the implementation plan `docs/implementation-plans/2026-06-19-native-ios-sharing-polish/`.
Covers acceptance criteria that are not (or cannot be) verified by automated tests. Automated coverage
is green at 112/112 (`RoadTripTests`) plus the targeted `RoadTripUITests` cases.

## Prerequisites
- Physical iPhone with the **Release-TestFlight** build installed (targets the Azure dev slot via `DEVSLOT` flag). Dev cert trusted under Settings → General → VPN & Device Management.
- Azure dev slot reachable; Dad's trip already migrated (trip Id 105, 120 photos).
- Dad's **secret** token in hand (grab from the prod app's "Invite to edit" share — the `a952bd97…` value is the *view* token, not the secret).
- A second device with no app installed (for the web view link test).
- Automated suite green first: `cd ios-swift/RoadTrip && xcodebuild -project RoadTrip.xcodeproj -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath .build-dd test` (112/112 passing).

## Phase 1: Popup chrome & gesture feel (AC1.1, AC1.4, AC1.5)
| Step | Action | Expected |
|------|--------|----------|
| 1 | Open a trip with photos, tap a pin to open the photo popup over a busy/bright photo | ⋯ and ✕ render in a header bar on the card with a material/scrim behind them; legible over any photo; no overlap with the map compass |
| 2 | Swipe the card down ~120pt+ and release | Card dismisses |
| 3 | Reopen, swipe down a small amount (below threshold) and release | Card springs back into place |
| 4 | With swipe-down active, swipe horizontally on the photo | Photos page left/right; vertical dismiss still works on header/footer chrome (documented fallback) |

## Phase 3: Trip sharing (AC3.1, AC3.3, AC3.4)
| Step | Action | Expected |
|------|--------|----------|
| 1 | Open an **owned** trip (has a secret token), look at the toolbar | Share button present, offering "Share view link" and "Invite to edit" |
| 2 | Tap "Share view link" | System share sheet opens with absolute read-only URL, e.g. `https://app-roadtripmap-prod-dev.azurewebsites.net/trips/{viewToken}` |
| 3 | Open that view URL on the **device with no app installed** | Read-only `trips.html` SPA loads, showing trip name + pins, no auth required |
| 4 | Tap "Invite to edit" | Share sheet text contains the secret token UUID and message `Join my Road Trip "{name}" — open the app → Import via Token → paste: {token}` |
| 5 | On a second device, paste that invite text into Import via Token | Trip imports with write access |

## Phase 4: Dad's trip migration (AC5.1, AC5.2, AC5.3)
| Step | Action | Expected |
|------|--------|----------|
| 1 (ops) | Query `roadtripmap-db-dev` for trip Id 105 | `TripEntity` + `PhotoEntity` rows exist; secret/view tokens match prod; photo count = 120 |
| 2 (ops) | List blobs in `road-trip-photos-dev`; `GET /api/photos/{devTripId}/{devPhotoId}/thumb` against the dev host | 360 blobs present at preserved paths; thumb returns JPEG 200 |
| 3 | Fresh install of dev-slot build → Import via Token with Dad's **secret** token | Trip imports with all 120 photos pinned |
| 4 | Pan the map / open several photo popups | Photos render (served from `road-trip-photos-dev`) |
| 5 | Add a test photo, confirm it commits, then delete it | Write access works; photo commits and removes cleanly |

> Note: Phase 4 steps 1–2 (AC5.1/AC5.2) were already verified operationally during execution
> on 2026-06-19 (dev DB trip Id 105 / 120 rows; 360 blobs copied; dev-slot endpoint served
> thumb/display/original as JPEG 200). Re-running is optional confirmation; AC5.3 (the on-device
> import) remains for the device pass.

## End-to-End: Share-and-collaborate round trip
Purpose: validates that token storage (automated AC2.1–2.4) actually produces working share links and editable imports on real devices.

On device A, create a new trip → upload a photo → confirm pin appears. Tap Share → "Share view link" → open the link in Safari on device B (no app): the read-only page renders the pin. Back on device A, Share → "Invite to edit" → send to device C. On device C, Import via Token (paste the full message) → trip + photo appear → add a photo on C → confirm it appears for the owner on A after refresh.

## Traceability
| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | — | Phase 1.1 |
| AC1.2 | `testTappingMapPinOpensPhotoDetail` (close button) | — |
| AC1.3 | `testTappingMapPinOpensPhotoDetail` (backdrop) | — |
| AC1.4 | — | Phase 1.2–1.3 |
| AC1.5 | — | Phase 1.4 |
| AC1.6 | popup open/close UI flow | — |
| AC2.1 | `testCreateTripStoresViewToken` | E2E (create trip) |
| AC2.2 | ViewTokenParsing + `testImportTripsStoresViewToken` | E2E (import) |
| AC2.3 | `testRevalidateBackfillsViewToken` | — |
| AC2.4 | `testStoreViewTokenNil/GarbageViewUrl…`, `testImportSucceedsAndStoresSecretToken` | — |
| AC3.1 | — | Phase 3.1 |
| AC3.2 | TripShareLinkTests (7 cases) | Phase 3.2 (link form) |
| AC3.3 | — | Phase 3.3 |
| AC3.4 | — | Phase 3.4–3.5 |
| AC3.5 | `testSampleDataTripHidesShareButton` | — |
| AC4.1 | `testBareUUIDStringParses` | — |
| AC4.2 | TokenPaste extraction cases + `testImportTripsFromMessyPastedText` | — |
| AC4.3 | `testNoUUIDReturnsNil`, `testEmptyStringReturnsNil` | — |
| AC5.1 | — (operational, done 2026-06-19) | Phase 4.1 |
| AC5.2 | — (operational, done 2026-06-19) | Phase 4.2 |
| AC5.3 | — | Phase 4.3–4.5 |
