# Native iOS — Photo-Popup Polish & Trip Sharing Design

## Summary

This design delivers two complementary improvements to the iOS app: a polished photo-popup experience and first-class trip sharing. The popup's action controls — close and overflow menu — are moved off the screen surface and onto the photo card itself, where they render legibly over any image using a material scrim. A swipe-down gesture is added so the card can be flicked away naturally, while the existing horizontal photo paging continues to work alongside it. Together these changes remove the only significant visual roughness in the current build.

The sharing work surfaces read-only trip access that the server already supports but the app has never exposed. Every trip on the system has two tokens: a secret token that grants full write access and a view token that grants anonymous read-only access. The app already stores the secret token in the Keychain at create and import time; this design extends import and revalidate to also capture and store the view token, then wires a Share button into the trip toolbar that offers both sharing modes — a browser-openable view link and a copyable edit invite. Import is also hardened so that pasting an entire invite message or a URL (rather than a bare UUID) still extracts the token and works. A one-time ops migration copies an existing user's prod trip and photo blobs into the dev slot so the end-to-end import flow can be exercised on a real device against real data before TestFlight.

## Definition of Done
- The photo popup's ⋯ (menu) and ✕ (close) controls render as **chrome on the card itself**, legible over any photo, and no longer float at the screen top or collide with the map compass.
- The popup can be dismissed by **swiping the card down** (with ✕ and backdrop-tap retained as fallbacks). Swipe-down is removable if it doesn't feel good on device.
- `TripDetailView` has a single **Share** button (next to +/trash) offering **"Share view link"** (opens the read-only web page, no app needed) and **"Invite to edit"** (shares the secret token for paste-import). Hidden for sample/local-only trips.
- **Imported trips store their view token**, so they can be view-shared like created trips.
- **Import accepts messy paste** — a UUID is extracted from pasted text or a URL, not just a bare token.
- **Dad's existing trip is copied prod→dev** (rows + photo blobs, same tokens) so he can import it into the app on the dev slot.

## Acceptance Criteria

### native-ios-sharing-polish.AC1: Photo popup chrome + dismissal
- **native-ios-sharing-polish.AC1.1 Success:** ⋯ and ✕ render in a header bar on the photo card, legible over any photo (material/scrim behind).
- **native-ios-sharing-polish.AC1.2 Success:** ✕ closes the popup.
- **native-ios-sharing-polish.AC1.3 Success:** Tapping the dimmed backdrop closes the popup.
- **native-ios-sharing-polish.AC1.4 Success:** Swiping the card down past the threshold closes it; releasing below threshold springs it back (device-verified).
- **native-ios-sharing-polish.AC1.5 Success:** Horizontal swipes still page between photos while swipe-down is active (gesture coexistence; device-verified).
- **native-ios-sharing-polish.AC1.6 Edge:** Controls no longer overlap the map compass (no screen-level floating controls).

### native-ios-sharing-polish.AC2: View-token availability
- **native-ios-sharing-polish.AC2.1 Success:** Creating a trip stores its view token in the Keychain (`.view`) — regression guard.
- **native-ios-sharing-polish.AC2.2 Success:** Importing a trip parses the view token from the server `viewUrl` and stores it (`.view`).
- **native-ios-sharing-polish.AC2.3 Success:** `revalidate` backfills the view token for an owned trip that lacks one.
- **native-ios-sharing-polish.AC2.4 Failure:** If the server omits `viewUrl`, import still succeeds (no crash); view-sharing is simply unavailable until a later revalidate provides it.

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

### native-ios-sharing-polish.AC5: Dad's trip migration
- **native-ios-sharing-polish.AC5.1 Success:** Dad's `TripEntity` + `PhotoEntity` rows exist in the dev DB with the same secret/view tokens.
- **native-ios-sharing-polish.AC5.2 Success:** His photo blobs exist in the dev container at the same blob paths (the photo-serving endpoint resolves them).
- **native-ios-sharing-polish.AC5.3 Success:** On a fresh app, importing his secret token shows the trip with all photos and write access (device/manual).

## Glossary

- **secret token**: A UUID stored on a `TripEntity` row that grants full read/write access to a trip. Possession of the token is the only credential — there is no user account or login. Shared as plain text in "Invite to edit."
- **view token**: A second UUID on the same row that grants anonymous read-only access. Used to construct the public view link; never gives write access.
- **token-bearer model**: The app's authorization scheme: whoever holds a token is treated as authorized for the corresponding access level. No server-side identity, sessions, or OAuth — just the token value in an HTTP header or URL path.
- **Keychain**: Apple's encrypted on-device credential store. The app uses `KeychainStore.swift` to persist secret and view tokens keyed by local trip ID, so they survive app restarts without being stored in plain UserDefaults or the database.
- **`TokenKind`**: A Swift enum (`secret` / `view`) used as a dimension when reading or writing a token in the Keychain, so the two tokens for one trip don't collide.
- **`viewUrl`**: A field in the server's `TripResponse` JSON DTO — the absolute URL path `/trips/{viewToken}`. The app parses the view token out of this field and stores it locally.
- **revalidate**: An app operation that re-fetches a trip from the server and refreshes its local state, including backfilling the view token if it was missing from an earlier import.
- **dev slot**: An Azure App Service deployment slot (distinct from the production slot) used during active development. It has its own database (`roadtripmap-db-dev`) and blob storage container (`road-trip-photos-dev`).
- **blob / blob path**: A binary file stored in Azure Blob Storage (here, a photo). The "blob path" is the storage-relative path that both the prod and dev containers use to locate a photo file; the migration preserves these paths so existing URLs keep working in dev.
- **AzCopy**: Microsoft's command-line tool for bulk-copying data between Azure Storage containers. Used in Phase 4 to transfer photo blobs from the prod container to the dev container.
- **`ShareLink`**: A SwiftUI view that presents the system share sheet for a given item (URL, text, image, etc.). Used here to share the view link and the edit-invite text via the native iOS share sheet.
- **`DragGesture`**: A SwiftUI gesture recognizer that tracks a finger drag. Used to drive the vertical card offset and backdrop fade during swipe-down dismiss.
- **`TabView`** (paged): A SwiftUI container used in paged/carousel mode to swipe horizontally between photos inside the popup. Its horizontal gesture must coexist with the vertical `DragGesture` without conflict.
- **`.regularMaterial`**: A SwiftUI background style that renders a blurred, translucent frosted-glass effect — used as a scrim behind the popup header controls so they remain legible over any photo.
- **MapKit compass**: The compass rose that MapKit renders in the corner of a map view. The existing popup placed controls at the screen level that overlapped this compass; moving controls onto the card eliminates the collision.
- **SPA (Single-Page Application)**: The `trips.html` web app already served by the ASP.NET backend at `/trips/{viewToken}`. A reviewer opening the shared view link lands here — no native app required.
- **`APIEnvironment`**: A Swift type that holds environment-specific configuration such as `baseURL`. The view link is constructed from its host so the correct URL is produced in both dev-slot and future prod builds.

## Architecture

Three user-facing changes plus one one-time data migration, all on the existing **token-bearer** model (no server-side identity, no schema change). Decisions made during brainstorming (2026-06-19): write-sharing shares the full-access **secret token** (no contributor tier); no trip-recovery/identity system (re-import via token); the native app stays on the **Azure dev slot**. Deferred items (Universal Links, contributor tier, recovery/identity) are recorded in `docs/design-plans/native-ios-deferred-enhancements.md`.

**Photo popup (`Views/Photos/PhotoPopupView.swift`).** Restructure the card into a self-contained `VStack` — `[header bar] · [paged photo TabView] · [caption/place/date footer]` — and delete the screen-level floating-controls `VStack`. The header bar holds ✕ (leading) and the ⋯ `Menu` (trailing) over a `.regularMaterial`/gradient scrim. A `DragGesture` on the card drives a vertical offset (with the dimmed backdrop fading by drag progress) and dismisses past a threshold, springing back otherwise. The drag must only claim vertical-dominant gestures so the inner paged `TabView` keeps its horizontal photo paging. `PhotoPopupView`'s inputs (`photos`, `selection`, `onClose`, `onMovePin`, `onDelete`) are unchanged — an internal restructure.

**Sharing (`Views/Trips/TripDetailView.swift` + `Networking/RoadTripAPI.swift`).** A toolbar **Share** `Menu` shown only when the trip has a secret token. "Share view link" uses `ShareLink` with an absolute URL built as `APIEnvironment.baseURL` host + `/trips/{viewToken}` (the same ASP.NET app serves both the API and the view SPA). "Invite to edit" shares plain text containing the secret token. The view token comes from the Keychain (`.view` kind) for created trips; for imported trips it is captured from the server's `TripResponse.viewUrl` and stored in the Keychain, so the source is uniform.

**Import robustness (`Networking/RoadTripAPI.swift`, `Views/Trips/PasteTokenView.swift`).** `importTrip` extracts the first UUID from the pasted string when a direct `UUID(uuidString:)` parse fails, so pasting the whole invite message or a post URL works.

**Dad's trip migration (ops, not app code).** Copy his `TripEntity` row, `PhotoEntity` rows, and photo blobs from prod to the dev slot's DB + storage container, preserving tokens and blob paths.

## Existing Patterns

Investigation (2026-06-19) confirmed the model this design follows:

- **Token-bearer ownership, no server identity.** `src/RoadTripMap/Entities/TripEntity.cs` stores only `Slug, Name, Description, SecretToken, ViewToken, CreatedAt, IsActive`. The single auth strategy is `Services/SecretTokenAuthStrategy.cs` (case-sensitive token compare). This design adds nothing here.
- **Tokens in the Keychain, keyed by local `Trip.id`.** `Storage/KeychainStore.swift` already defines `TokenKind.secret` and `.view`; create-trip stores both (`RoadTripAPI.createTrip`). This design extends import to also store `.view` — following the existing create pattern, not inventing one.
- **Path tokens lowercased for the case-sensitive server auth** (existing convention in `RoadTripAPI`). Share/import touch read endpoints; the lowercasing rule continues to apply to any path-token call.
- **View-only server infra already exists.** `Program.cs` serves `/trips/{viewToken}` (the `trips.html` SPA) backed by `GET /api/trips/view/{viewToken}` + `/photos` (UUID-validated, no secret needed). The public photo endpoint `GET /api/photos/{tripId}/{photoId}/{size}` needs no token. This design surfaces existing endpoints rather than adding any.
- **MapKit/UIKit bridge precedent.** The pin picker already favors native feel over SwiftUI workarounds (`Views/Photos/LocationPickerMap.swift`). The popup stays SwiftUI; the swipe-down gesture is the one piece flagged for on-device feel validation.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Photo popup chrome + swipe-down dismiss
**Goal:** Controls live on the card and read as native; the card can be flicked down to dismiss; the compass collision is gone.

**Components:**
- `Views/Photos/PhotoPopupView.swift` — restructure into `[header bar] · [paged TabView] · [footer]`; header `HStack` with ✕ + ⋯ `Menu` over a material/scrim; remove the screen-level floating-controls `VStack`. Add a vertical-dominant `DragGesture` driving card offset + backdrop fade, dismiss past threshold, spring back otherwise. Keep ✕ and backdrop-tap dismissal.
- `Views/Trips/TripDetailView.swift` — drop the now-unused floating-controls wiring; popup callbacks unchanged.

**Dependencies:** None.

**Done when:** Tests verify `native-ios-sharing-polish.AC1.2`/`AC1.6` (close action and controls-not-floating, via the logic/structure that's unit-reachable); the swipe-down feel (`AC1.4`/`AC1.5`) is on the device checklist. Build green.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: View-token capture for imported trips
**Goal:** Every owned trip — created or imported — has its view token available locally for view-link sharing.

**Components:**
- `Networking/RoadTripAPI.swift` — add `viewUrl` to the `TripResponse` DTO if absent; in `importTrip` and `revalidate`, parse the view token from `viewUrl` (`/trips/{viewToken}`) and store it via `KeychainStore.setToken(_, kind: .view, tripId:)`.
- A small pure helper to extract a view token from a `viewUrl` path (unit-tested).

**Dependencies:** None (independent of Phase 1).

**Done when:** Tests verify `native-ios-sharing-polish.AC2.2`/`AC2.3`/`AC2.4` — import stores the view token; revalidate backfills it; a missing `viewUrl` doesn't break import. Build green.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Trip sharing UI + import robustness
**Goal:** Owners can share a view link and an edit invite from the trip; pasted invites import even when not a bare UUID.

**Components:**
- `Views/Trips/TripDetailView.swift` — toolbar Share `Menu` (shown only with a secret token): "Share view link" (`ShareLink`, absolute view URL) + "Invite to edit" (share-sheet text with the secret token).
- `Networking/APIEnvironment.swift` (or a small URL builder) — absolute view URL = base host + `/trips/{viewToken}` (pure, unit-tested).
- `Networking/RoadTripAPI.swift` — `importTrip` extracts the first UUID from messy paste before failing.

**Dependencies:** Phase 2 (view token must be stored to build the view link).

**Done when:** Tests verify `native-ios-sharing-polish.AC3.2` (view-URL construction), `AC3.5` (button hidden without a token), `AC4.2`/`AC4.3` (messy-paste extraction + no-UUID error). `ShareLink` presentation, the web page opening, and the edit-invite text are on the device checklist (`AC3.1`/`AC3.3`/`AC3.4`). Build green.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Dad's trip prod→dev migration (ops)
**Goal:** Dad's existing prod trip is importable into the dev-slot app.

**Components:**
- A one-time migration: copy his `TripEntity` row + `PhotoEntity` rows from prod DB → `roadtripmap-db-dev` (same secret/view tokens), and his photo blobs from prod `road-trip-photos` → dev `road-trip-photos-dev` (via `AzCopy`), preserving blob paths. Source connection strings from prod Key Vault, target from dev (Patrick pre-authorized Azure ops).

**Dependencies:** Phase 3 (import flow ready to receive the token end-to-end). Schema/blob-path parity check (dev came from the same Bicep/migrations).

**Done when:** `native-ios-sharing-polish.AC5.1`/`AC5.2` verified (rows + blobs present in dev, photo endpoint resolves); `AC5.3` (fresh-app import shows trip + photos) on the device checklist.
<!-- END_PHASE_4 -->

## Additional Considerations

**Token in share text.** "Invite to edit" puts a full-access secret token in plain shared text — consistent with the existing web `/post/{secretToken}` URL and the accepted "secret token = full access" model. No new exposure.

**Environment coupling.** The view link's host is whatever `APIEnvironment.baseURL` resolves to (today the dev slot). When the app graduates to prod, shared links and the deferred Universal Links domain shift with it — see `native-ios-deferred-enhancements.md`.

**Verification split.** Logic (URL building, token/paste extraction, import-stores-view-token, popup close action) is unit-tested; feel and presentation (swipe-down, `ShareLink`, web-page open, dad's trip end-to-end) join the batched on-device pass in `docs/device-test-checklist.md` ahead of Phase 8 TestFlight.
