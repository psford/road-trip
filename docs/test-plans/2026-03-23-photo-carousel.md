# Human Test Plan: Photo Carousel

**Feature:** Photo carousel with bidirectional map sync, fullscreen viewer, delete, and chronological ordering
**Implementation plan:** `docs/implementation-plans/2026-03-23-photo-carousel/`
**Date:** 2026-03-23

---

## Prerequisites

- Road-trip application running locally (Azurite for blob storage, SQLite or configured database)
- At least one trip created with 10+ photos uploaded (various `takenAt` dates, including 1-2 photos without EXIF date data)
- A second trip with exactly 1 photo
- A third trip with 0 photos
- Browser DevTools available (Chrome recommended for mobile emulation)
- `dotnet test tests/RoadTripMap.Tests` passing (all 125 automated tests green)

---

## Phase 1: Carousel Layout and Display (AC1)

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Navigate to the post page for the trip with 10+ photos | Page loads with map and carousel visible |
| 1.2 | Inspect the carousel strip at the bottom of the page | Photos appear as square thumbnails in a single horizontal row. No vertical stacking. |
| 1.3 | Right-click a thumbnail, Inspect Element. Check the `<img>` CSS | `object-fit: cover` is applied. Image fills the square without letterboxing or stretching. |
| 1.4 | Scroll the carousel horizontally using mouse wheel or trackpad | Strip scrolls horizontally, revealing more thumbnails beyond the viewport |
| 1.5 | Release the scroll mid-motion | Carousel snaps so a thumbnail is aligned (not stuck halfway between two items). This verifies `scroll-snap-type`. |
| 1.6 | Navigate to the trip with exactly 1 photo | Single thumbnail displayed. No horizontal scrollbar visible. No trailing empty space or layout breakage. |
| 1.7 | Navigate to the trip with 0 photos (post page) | No carousel container visible. Only the "Add Photo" button is shown. |
| 1.8 | Navigate to the trip with 0 photos (view page) | No carousel container visible. "No photos yet" overlay is displayed. |

## Phase 2: Map-to-Carousel Sync (AC2)

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | On the 10+ photo trip, scroll the carousel to the far right | Carousel shows the last photos; early photos are off-screen to the left |
| 2.2 | Click a map pin corresponding to a photo near the beginning of the trip (far left of carousel) | Carousel scrolls smoothly to that photo. The thumbnail gains an accent-color border highlight. |
| 2.3 | Click a different map pin | Previous thumbnail loses its highlight border. New thumbnail gains the highlight. Carousel scrolls to the new photo if needed. |
| 2.4 | Click a third map pin | No stale highlights remain -- only the most recently clicked pin's photo is highlighted |
| 2.5 | Hard refresh the page (Ctrl+Shift+R). Immediately click any map pin without waiting. | Carousel scrolls to and highlights the correct photo on the very first click. No double-click required. |

## Phase 3: Carousel-to-Map Sync (AC3)

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Pan the map so a known photo's pin is off-screen | Pin is no longer visible in the viewport |
| 3.2 | Tap that photo's carousel thumbnail | Map pans/flies to center on the pin location. The marker popup opens showing the photo and place name. |
| 3.3 | Observe the fullscreen viewer | A fullscreen overlay appears with the photo at full resolution, using `object-fit: contain` (no cropping). |
| 3.4 | Click the dark background area of the fullscreen overlay (not on the image itself) | Overlay closes |
| 3.5 | Open fullscreen viewer again by tapping another thumbnail. Press Escape. | Overlay closes |
| 3.6 | Open fullscreen viewer again. Click directly on the image. | Overlay does NOT close (click on image should not dismiss) |

## Phase 4: Delete Functionality (AC4)

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | On the post page, inspect carousel thumbnails | Each thumbnail has a trash/delete icon button overlaid |
| 4.2 | Note the current photo count. Click the delete button on a thumbnail. | Browser confirmation dialog appears ("Delete this photo?") |
| 4.3 | Click Cancel on the confirmation dialog | Photo remains in carousel, map pin remains, route polyline unchanged |
| 4.4 | Click the delete button again, then click OK | Photo removed from carousel strip. Map pin removed. Route polyline no longer includes that location. Success toast appears. |
| 4.5 | Navigate to the public view page for the same trip | Carousel thumbnails have NO delete/trash icon. The save icon IS still present. |

## Phase 5: Save/Share Functionality (AC5)

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | On both the post page and view page, inspect carousel thumbnails | Each thumbnail has a save/download icon overlaid |
| 5.2 | Open the fullscreen viewer | A save icon is visible (top-right corner area) |
| 5.3 | On a desktop browser (Chrome/Firefox/Edge), click the save icon on a carousel thumbnail | Browser initiates a file download |
| 5.4 | Check the downloaded file | File is the original full-resolution image (not the thumbnail) |
| 5.5 | Click the save icon from within the fullscreen viewer | Same behavior -- original image downloads |
| 5.6 | Open Chrome DevTools, toggle Device Toolbar (mobile emulation), enable Share API override. Tap the save icon. | Native share sheet appears with the image URL (or a simulated share dialog in DevTools) |

## Phase 6: Chronological Ordering (AC6 -- visual confirmation)

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | On a trip with photos taken on different dates, inspect the carousel left-to-right | Photos appear in chronological order (oldest on the left, newest on the right). This should match the API ordering verified by automated tests. |
| 6.2 | Inspect the route polyline on the map | Polyline connects pins in the same left-to-right order as the carousel (chronological by takenAt) |
| 6.3 | If any photos lack EXIF date data (null takenAt), confirm they appear at the end (rightmost) of the carousel | Null-takenAt photos are last, after all dated photos |

## Phase 7: View Page Layout (AC7)

| Step | Action | Expected |
|------|--------|----------|
| 7.1 | Open the public view page for a trip with photos | Carousel strip appears at the very bottom of the viewport, overlaying the map |
| 7.2 | Inspect the carousel background | Dark, semi-transparent, blurred appearance (frosted glass / `backdrop-filter: blur`) |
| 7.3 | Resize the browser window (narrow and wide) | Carousel stays fixed at the bottom of the viewport |
| 7.4 | Locate the route toggle button | Button is visible above the carousel, not hidden behind it |
| 7.5 | Click the route toggle button | Route polyline shows/hides correctly; button is still functional |
| 7.6 | Click and drag the map area above the carousel | Map pans normally |
| 7.7 | Zoom in/out on the map | Zoom works as expected |
| 7.8 | Click a map pin that is above the carousel area | Popup opens normally |
| 7.9 | Click and drag on the carousel strip itself | Carousel scrolls horizontally. The map does NOT pan (carousel intercepts pointer events). |

---

## End-to-End: Full Trip Lifecycle

**Purpose:** Validate that photo upload, carousel rendering, map sync, deletion, and view page all work together as a coherent flow.

1. Create a new trip at the post page.
2. Upload 5 photos with known GPS coordinates and varying dates (ensure at least one has no EXIF date).
3. Confirm carousel populates in chronological order, with the no-date photo last.
4. Confirm all 5 pins appear on the map and the route polyline connects them in order.
5. Click each map pin -- verify carousel scrolls and highlights correctly each time.
6. Click each carousel thumbnail -- verify map pans to the pin and fullscreen viewer opens.
7. Delete one photo from the middle of the sequence. Confirm carousel, map, and route update.
8. Copy the view page URL and open it in an incognito/private window.
9. Confirm the view page shows 4 remaining photos in the floating carousel with frosted background.
10. Confirm no delete buttons are visible on the view page.
11. Confirm save icons work (download on desktop).
12. Confirm map interaction works above and behind the carousel.

## End-to-End: Single Photo Edge Case

**Purpose:** Validate correct layout when a trip has only one photo.

1. Navigate to the trip with 1 photo (post page).
2. Confirm single thumbnail renders without scrollbar or empty space.
3. Click the map pin -- verify the thumbnail highlights.
4. Click the thumbnail -- verify map pans and fullscreen opens.
5. Open the view page -- confirm floating carousel shows one item, route toggle is above it.

---

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 -- Square thumbnails | -- | Phase 1: 1.1-1.4 |
| AC1.2 -- Scroll snap | -- | Phase 1: 1.5 |
| AC1.3 -- Selected highlight | -- | Phase 2: 2.2-2.4 |
| AC1.4 -- Single photo layout | -- | Phase 1: 1.6 |
| AC1.5 -- No photos hidden | -- | Phase 1: 1.7-1.8 |
| AC2.1 -- Pin scrolls carousel | -- | Phase 2: 2.1-2.2 |
| AC2.2 -- De-highlight | -- | Phase 2: 2.3 |
| AC2.3 -- First click works | -- | Phase 2: 2.5 |
| AC3.1 -- Thumbnail pans map | -- | Phase 3: 3.1-3.2 |
| AC3.2 -- Thumbnail opens popup | -- | Phase 3: 3.2 |
| AC3.3 -- Thumbnail opens fullscreen | -- | Phase 3: 3.3 |
| AC3.4 -- Fullscreen dismiss | -- | Phase 3: 3.4-3.6 |
| AC4.1 -- Delete button visible | -- | Phase 4: 4.1 |
| AC4.2 -- Delete removes photo | -- | Phase 4: 4.2, 4.4 |
| AC4.3 -- Cancel preserves photo | -- | Phase 4: 4.3 |
| AC4.4 -- Delete hidden on view | -- | Phase 4: 4.5 |
| AC5.1 -- Save icon visible | -- | Phase 5: 5.1-5.2 |
| AC5.2 -- Mobile share | -- | Phase 5: 5.6 |
| AC5.3 -- Desktop download | -- | Phase 5: 5.3-5.5 |
| AC6.1 -- Oldest-first ordering | `GetPhotosEndpoint_OrdersByTakenAtAscending` | Phase 6: 6.1 |
| AC6.2 -- Route polyline order | `GetPhotosEndpoint_OrdersByTakenAtAscending` | Phase 6: 6.2 |
| AC6.3 -- Null takenAt last | `GetPhotosEndpoint_WithNullTakenAt_SortsNullsLast` | Phase 6: 6.3 |
| AC7.1 -- Floating carousel | -- | Phase 7: 7.1-7.3 |
| AC7.2 -- Toggle above carousel | -- | Phase 7: 7.4-7.5 |
| AC7.3 -- Map interactive | -- | Phase 7: 7.6-7.9 |
