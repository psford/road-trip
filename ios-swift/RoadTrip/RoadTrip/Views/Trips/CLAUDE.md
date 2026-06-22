# Views/Trips (native SwiftUI app)

Last verified: 2026-06-21

## Purpose
SwiftUI screens for the trip lifecycle: the My Trips list, trip detail (map + photos),
the archived-trips manager, and create/import flows. These views own the archive/restore/
delete UX and the trip-route map rendering.

## Contracts
- **`TripListView`** — My Trips. Observes active trips only (`Column("archivedAt") == nil`),
  newest first. Trailing swipe → **Archive** (`archivedAt = Date()`). Toolbar "Archived" entry
  navigates to `ArchivedTripsView`. Background `revalidateOwnedTrips()` **skips archived trips**.
- **`ArchivedTripsView(database:keychain:)`** — lists archived trips (`archivedAt != nil`).
  Per-row swipe actions: **Restore** (`archivedAt = nil`, pure local write) and **Delete
  permanently** (behind a confirmation dialog). This is the **ONLY** screen that performs the
  real server delete, via `RoadTripAPI.shared.deleteTrip(_:from:keychain:)`.
- **`TripDetailView`** — map + photo detail. Custom **floating inset top bar** (system nav bar
  hidden via `.toolbar(.hidden, for: .navigationBar)`): back · left-justified title · Share
  menu · add-photo Menu. **No delete control** (removed this phase — deletion lives only in
  `ArchivedTripsView`). Add-photo is a `Menu` (Take Photo / Choose from Library).
- **`RouteCurve.curved(through:pointsPerSegment:) -> [CLLocationCoordinate2D]`** — pure
  (Functional Core, no I/O). Centripetal Catmull-Rom (alpha 0.5) smoothing of the route line.
  Passthrough when `< 3` points; never emits NaN/infinite coords (degenerate segments fall back
  to straight interpolation); ~`(N-1)*pointsPerSegment + 1` outputs, always incl. first + last.

## Dependencies
- **Uses**: `Storage/AppDatabase` + `KeychainStore` (ValueObservation reads, archive/restore
  writes), `Networking/RoadTripAPI` (revalidate, permanent delete, share-link builders),
  `Views/Photos/*` (PinDrop, CameraPicker), MapKit (`Map`, `MapPolyline`).
- **Used by**: `App/*` (root navigation).
- **Boundary**: only `ArchivedTripsView` may call the server delete; other trip views must not.

## Key Decisions
- **`@AppStorage("showRoute")` (first `@AppStorage` in the app)** — TripDetailView gates the
  curved dashed route line on this flag, toggled by an on-map overlay button. Persists across
  launches via `UserDefaults`. Route only draws when `showRoute && routeCoordinates.count >= 2`.
  Because it persists, UI tests need a known starting value: `AppBootstrap.prepare()` forces
  `UserDefaults.standard.set(true, forKey: "showRoute")` on `-uitest` launches (a plain write,
  not `removePersistentDomain`, to avoid corrupting the defaults cache). Route-toggle UI tests
  rely on this; don't remove it.
- **Permanent delete moved out of trip detail** — destructive server delete now lives behind the
  archive flow (archive → Archived list → confirm → delete). TripDetailView's prior Delete action
  is gone, so the map screen has no irreversible action.
- **Custom floating top bar over the system nav bar** — left-justified title + inset Share/+
  controls; the system bar is hidden.

## Invariants
- My Trips shows active trips only; `ArchivedTripsView` shows archived only — both filter on
  `archivedAt` explicitly.
- Archive and Restore are local-only GRDB writes (no network). Only "Delete permanently" hits
  the server.
- Route smoothing goes through `RouteCurve.curved(...)` (pure, unit-tested) — never inline the
  spline math in the view.

## Key Files
- `TripListView.swift` — My Trips list, swipe-to-archive, Archived toolbar entry, revalidation.
- `ArchivedTripsView.swift` — restore + permanent-delete (the only server-delete call site).
- `TripDetailView.swift` — map/photo detail, floating top bar, `showRoute` toggle, add-photo menu.
- `RouteCurve.swift` — pure Catmull-Rom route smoothing (test seam, like `MapFraming`).
- `MapFraming.swift` — pure map-region framing helper.

## Gotchas
- `keychain.token(...)` returns `UUID??` — flatten with `?? nil` (see `loadShareTokens`).
- The Share menu is gated on an owned trip (secret token present); "Share view link" is omitted
  when no view token exists yet (older imports) — the editor-invite text is offered instead.
- A new trip-list query MUST pick its `archivedAt` filter explicitly or it will leak archived
  trips into the active list.
