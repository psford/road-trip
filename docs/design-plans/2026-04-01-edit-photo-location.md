# Edit Photo Location Design

## Summary
<!-- TO BE GENERATED after body is written -->

## Definition of Done

1. Post page carousel shows two action buttons per photo: edit location (pin icon) and delete (trash icon) — download removed from carousel
2. Fullscreen view shows all three: edit location, download, and delete
3. Tapping edit location opens the pin-drop map centered on the photo's current GPS coordinates
4. User drops a new pin, sees geocoded place name
5. User confirms → coordinates and place name update in the database
6. Map markers and carousel labels reflect the updated location immediately

## Acceptance Criteria

### edit-photo-location.AC1: Carousel action buttons
- **edit-photo-location.AC1.1 Success:** Post page carousel shows pin icon and trash icon per photo
- **edit-photo-location.AC1.2 Success:** Download button removed from post page carousel
- **edit-photo-location.AC1.3 Success:** View page carousel unchanged (still shows download only, no edit/delete)

### edit-photo-location.AC2: Fullscreen action buttons
- **edit-photo-location.AC2.1 Success:** Fullscreen view on post page shows edit location, download, and delete
- **edit-photo-location.AC2.2 Success:** Fullscreen view on view page unchanged (download only)

### edit-photo-location.AC3: Pin-drop map for location edit
- **edit-photo-location.AC3.1 Success:** Tapping edit location opens pin-drop map centered on photo's current coordinates
- **edit-photo-location.AC3.2 Success:** User can tap map to place new marker
- **edit-photo-location.AC3.3 Success:** Geocoded place name displays after pin placement
- **edit-photo-location.AC3.4 Success:** Cancel closes map without saving
- **edit-photo-location.AC3.5 Edge:** Photo with (0,0) coordinates — map centers on default location

### edit-photo-location.AC4: Save updated location
- **edit-photo-location.AC4.1 Success:** Confirming save sends PATCH request with new lat/lng
- **edit-photo-location.AC4.2 Success:** Backend updates photo coordinates and reverse geocodes new place name
- **edit-photo-location.AC4.3 Success:** Carousel label and map marker update immediately after save
- **edit-photo-location.AC4.4 Failure:** Invalid coordinates rejected by backend
- **edit-photo-location.AC4.5 Failure:** Invalid secret token returns 401

## Glossary

- **pin-drop map**: Existing MapLibre map UI in postUI.js where users tap to place a marker. Currently used for no-GPS photo uploads.
- **carousel actions**: Overlay buttons on carousel thumbnail items (save, delete, and now edit location).

## Architecture

Reuses the existing pin-drop map (`initializePinDropMap`) with minor adaptation. New PATCH endpoint on backend. Frontend adds edit location button to carousel and fullscreen, with a modal flow for the map.

### Backend
New endpoint: `PATCH /api/trips/{secretToken}/photos/{id}/location`
- Request body: `{ lat: number, lng: number }`
- Validates coordinates, authenticates via secret token
- Updates photo's Latitude, Longitude
- Re-geocodes via existing GeocodingService → updates PlaceName
- Returns updated PhotoResponse

### Frontend
- `photoCarousel.js`: Replace download button with edit location (pin icon) in carousel. Keep delete. Add `onEditLocation` config callback.
- `photoCarousel.js`: Fullscreen view gets all three buttons (edit location, download, delete).
- `postUI.js`: New `onEditLocationFromCarousel(photo)` method — opens pin-drop map centered on photo's current coords, with Save/Cancel buttons. On save, calls new `API.updatePhotoLocation()`, then refreshes photo list.
- `api.js`: New `updatePhotoLocation(secretToken, photoId, lat, lng)` method.

## Existing Patterns

- Pin-drop map initialization and click handling in `postUI.initializePinDropMap()` — reuse map instance, just re-center and swap the confirm action.
- Carousel action buttons pattern in `photoCarousel.createCarouselItem()` — add edit location alongside existing delete.
- API pattern in `api.js` — follows same fetch + error handling as other endpoints.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Backend PATCH endpoint

**Goal:** API endpoint to update photo location

**Components:**
- `src/RoadTripMap/Program.cs` — new PATCH endpoint with coordinate validation, auth, geocoding
- `tests/RoadTripMap.Tests/Endpoints/PhotoEndpointTests.cs` — tests for the new endpoint

**Dependencies:** None

**Done when:** PATCH endpoint accepts valid coordinates, rejects invalid ones, updates DB and returns updated photo
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Frontend carousel and fullscreen button changes

**Goal:** Restructure action buttons — pin + trash in carousel, all three in fullscreen

**Components:**
- `wwwroot/js/photoCarousel.js` — replace download with edit location in `createCarouselItem`, add all three to `showFullscreen`, add `onEditLocation` config callback
- `wwwroot/css/styles.css` — pin icon styling if needed

**Dependencies:** None (can parallel with Phase 1)

**Done when:** Carousel shows pin + trash on post page, fullscreen shows all three on post page, view page unchanged
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Edit location flow

**Goal:** Pin-drop map opens for location editing, saves via API

**Components:**
- `wwwroot/js/postUI.js` — `onEditLocationFromCarousel(photo)` method, reuses pin-drop map
- `wwwroot/js/api.js` — `updatePhotoLocation()` method
- `wwwroot/css/styles.css` — edit location modal/overlay styling if needed

**Dependencies:** Phase 1 (backend endpoint), Phase 2 (button wiring)

**Done when:** Full flow works — tap pin icon → map centered on photo → drop new pin → save → list refreshes with new location
<!-- END_PHASE_3 -->

## Additional Considerations

**No blob changes.** Location edit only updates coordinates and place name in the database. Photos stay in blob storage unchanged.
