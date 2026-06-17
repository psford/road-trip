# Native iOS rebuild — handoff to the Mac / Xcode environment

Status 2026-06-17. The native iOS rewrite is moving from the Linux dev-container
Claude (no Xcode — builds blind) to the native-Mac Claude (Xcode + simulator + MCP
bridge), because the UI work needs a build → run → SEE loop the container can't do.

## REAL — keep it (on `develop`, tested green on the iPhone 17 sim)
- Scaffold: `ios-swift/RoadTrip/` XcodeGen project (`project.yml`), GRDB 6.29.3, iOS 17.
- Storage layer (Phase 2): `Models/` (Trip, Photo, UploadQueueItem), `Storage/`
  (Migrator v1, AppDatabase, KeychainStore, PhotoFileCache). 8 unit + 1 UI test pass.
  Identity model: Trip = device UUID (tokens live in Keychain only); Photo keyed by
  server Int id; in-flight uploads in UploadQueueItem.

## FACADE — throw away / rebuild (branch `feat/native-ios-ui`, PR #108, NOT merged)
- `Views/*` (TripListView/TripDetailView/PhotoDetailView) + `App/SampleData.swift`.
- Built blind from a surface impression: a list, a basic map with static pins, a photo
  strip, fake sample data. NOT a faithful port. Reuse the storage layer; rebuild the
  UI for real. **Do not build on these views.**

## NOT built yet
- Phase 3 API client (RoadTripAPI actor + DTOs); Phase 5–7 (PhotosPicker/EXIF/HEIC,
  background URLSession upload, optimistic mutations); the entire rich map UI.

## Sources of truth — build against THESE, not impressions
- ACs + design: `docs/design-plans/2026-05-30-native-ios.md` (native-ios.AC1–AC7).
- The REAL app's behavior to port — `src/RoadTripMap/wwwroot/js/`:
  - `mapService.js` / `mapUI.js` — map build
  - `poiLayer.js` — POI markers, zoom-tier categories (<7 national_park; 7–9 + state_park/natural; 10+ + historic/tourism)
  - `stateParkLayer.js` + `parkStyle.js` — park boundary polygons
  - `postUI.js` — trip ("post") view incl. the dotted route line (`line-dasharray [3,2]`, smoothed, toggleable via `routeToggle`)
  - `photoCarousel.js` — scroll-snap strip + fullscreen swipe/arrow viewer that syncs to the map; tapping a map pin surfaces its thumbnail
  - `uploadQueue.js` / `uploadTransport.js` / `api.js` — resilient SAS upload + endpoints
- Server contract: the Contracts section of `CLAUDE.md` / `CLAUDE.local.md`.

## Backend
Live on Azure P0v3 (`app-roadtripmap-prod`, now in rg-stockanalyzer-prod), reachable at
`https://psfordtheriver.com` + `app-roadtripmap-prod.azurewebsites.net`. Read flows can
hit prod directly; the separate dev slot was descoped.

## The workflow that must change
Build feature-by-feature and VERIFY each on the simulator (screenshot) before calling
anything done. The failure to avoid: declaring blind-authored UI "done."
