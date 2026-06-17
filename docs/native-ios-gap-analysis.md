# Native iOS — gap analysis (web app vs. iOS rebuild)

Compiled 2026-06-17 by **reading the actual web implementation** (`src/RoadTripMap/wwwroot/js/`),
not the design doc or screenshots. The point of this doc: the iOS app is ~5% of the
product, and "5%" isn't actionable — this is the real list.

## Where iOS actually is

- **Built + tested (on `develop`):** the *storage layer only* — GRDB records (`Trip`,
  `Photo`, `UploadQueueItem`), migrator, `AppDatabase`, `KeychainStore`, `PhotoFileCache`.
  No UI, no networking, no map, no upload.
- **Facade (branch `feat/native-ios-ui`, PR #108 — do NOT build on):** a trip list, a
  basic `Map` with static pins, a flat photo strip, a tap-to-open photo page, all on
  **fake sample data**. None of the real behavior below exists in it.

The web app is ~7,600 lines of JS across 27 modules + 23 API endpoints + 4 page flows.

## Pages / flows

| Flow | Web (real behavior) | iOS status |
|---|---|---|
| **Home / My Trips** (`trips.html`, `tripStorage.js`) | localStorage list of trips (postUrl/viewUrl), rendered list, remove-from-list. A trip is remembered when you create it or visit its post page. | **Missing.** (iOS keeps tokens in Keychain instead of localStorage — the store exists, no UI.) |
| **Create** (`create.html`) | name + description form → `API.createTrip` → save to My Trips → navigate to post page. | **Missing** (facade has no create at all). AC1.1 |
| **Import via token** | paste a SecretToken → hydrate trip + photos. | **Missing.** AC1.3 |
| **Owner view** (`post.html`, `postUI.js`, 1354 lines) | the entire upload + map + photo experience below. | **Facade only** (static map + strip). |
| **Read-only view** (`/trips/{viewToken}`, `mapUI.js`, `canDelete:false`) | same photo map + carousel, but actions are **save/share** instead of edit/delete. | **Missing.** AC1 |

## Photo display + carousel

| Feature | Web (real) | iOS status |
|---|---|---|
| Carousel strip (`photoCarousel.js`) | horizontal scroll-snap thumbnails with place-name labels; per-item **edit-location + delete** (owner) or **save/share** (viewer); `selectPhoto(id)` highlights + smooth-scrolls into view. | Facade: flat strip, no labels, no actions, no selection sync. |
| **Fullscreen slideshow** | overlay viewer with **prev/next buttons, keyboard arrows, horizontal-swipe nav, vertical swipe-to-dismiss (native), tap-to-toggle-chrome**, save/share/edit/delete, status-bar light/dark. | Facade: tap → static detail page. No slideshow, no gestures. |
| **Photo map** (`postUI.renderPhotoMap`) | MapLibre markers → popups (thumbnail + place + caption + date); **popup open ↔ carousel select** two-way sync; tap thumbnail → fullscreen; fit-bounds to all photos; pan-to-keep-popup-visible. | Facade: static `Annotation` pins, **not tappable to a thumbnail**, no carousel sync. |

## Map richness

| Feature | Web (real) | iOS status |
|---|---|---|
| **POI layer** (`poiLayer.js`) | viewport+zoom-based fetch of `/api/poi`; circle markers colored by category (national_park, state_park, …); text labels at zoom ≥ 8; click → popup; tap-to-pin; show/hide toggle. | **Missing entirely.** |
| **State-park boundaries** (`stateParkLayer.js`, 570 lines) | `/api/park-boundaries` GeoJSON → **fill + outline + centroid-dot + label** layers; debounced viewport reload; detail tiers; predictive prefetch; popup. | **Missing entirely.** |
| **Route line** (`postUI.setupRouteToggle`) | dotted polyline (`line-dasharray [3,2]`, `#2a9d8f`) through photos, **smoothed** (`MapService.smoothRoute`), **toggleable**. | **Missing.** |
| Park styling (`parkStyle.js`) + map cache (`mapCache.js`) | MapTiler park restyle; IndexedDB cache of POI/boundary data. | **Missing.** (MapKit equivalents: `.mapStyle`, native overlays, on-device cache.) |

## Photo capture + upload (the hard part)

| Feature | Web (real) | iOS status |
|---|---|---|
| Capture | file picker, single + **bulk**; bulk **triage** into GPS-tagged (upload now) vs no-GPS (sequential pin-drop, ≤5). | **Missing.** AC2 (design: PhotosPicker + PHAsset for EXIF). |
| **EXIF** (`exifUtil`, `PostService.extractPhotoMetadata`) | GPS + capture timestamp extraction. | **Missing** (design: PHAsset + CGImageSource). AC2.1 |
| **Image processing** (`imageProcessor.js`) | oversize compression, **HEIC→JPEG**, display/thumb tier generation, telemetry. | **Missing.** AC2.2 |
| Pin-drop (`postUI.initializePinDropMap`) | tap map → marker → **reverse geocode** (`/api/geocode`) → place name; POI tap-to-set; "use my location"; "pick nearby spot". | **Missing.** AC2.3 |
| **Resilient upload** (`uploadQueue.js` 728, `uploadTransport.js`, `uploadSemaphore.js`, `StorageAdapter`) | request-upload (3 SAS) → block PUTs → commit; **resumable across sessions**, concurrency-limited, SAS-refresh, telemetry. | **Missing.** (`UploadQueueItem` record exists; no coordinator.) AC3 |
| Upload UX (`progressPanel.js`, `resumeBanner.js`, `optimisticPins.js`) | live progress panel, resume banner, optimistic pins before commit. | **Missing.** |

## Photo actions

| Feature | Web (real) | iOS status |
|---|---|---|
| Delete | native confirm dialog → `DELETE …/photos/{id}` → refresh. | **Missing** (facade can't delete). AC4.1 |
| Edit location | modal pin-drop map → reverse geocode → `PATCH …/photos/{id}/location`. | **Missing.** AC4.3 |

## Cross-cutting

| Feature | Web (real) | iOS status |
|---|---|---|
| **API client** (`api.js`, 297) | every endpoint: createTrip, tripForPost/View, photos, delete, geocode, pin-drop, updateLocation, request-upload/commit/abort. | **Missing entirely.** This is the unblock for everything — design Phase 3. |
| Version gate (`versionProtocol.js`) | `x-server-version` / `x-client-min-version` enforcement. | **Missing.** |
| Offline (`offlineError.js`, `mapCache.js`) | friendly offline messaging; cached map data. | **Missing** (storage layer exists, not wired). |

## Honest build order (each VERIFIED on the simulator before "done")

1. **API client** (Phase 3) — nothing real renders without it; turns the facade's fake pins into real data. Verifiable with unit tests + one live read against prod.
2. **Owner view, real data** — trip list (real), photo map with **tappable thumbnail popups + carousel + map sync**, the dotted route toggle. (Port `postUI.renderPhotoMap` + `photoCarousel`.)
3. **Map overlays** — POI layer, then park boundaries (MapKit overlays from `/api/poi`, `/api/park-boundaries`).
4. **Capture + upload** — PhotosPicker → EXIF (PHAsset) → HEIC → pin-drop/geocode → background `URLSession` resilient upload + progress. (The biggest chunk; design Phases 5–6.)
5. **Actions** — delete, edit-location. Read-only view variant (save/share).

Server contract + endpoints: `CLAUDE.local.md` Contracts section. Design + ACs:
`docs/design-plans/2026-05-30-native-ios.md`. The behavior source of truth is the
`wwwroot/js/` modules above — port those, don't reinvent.
