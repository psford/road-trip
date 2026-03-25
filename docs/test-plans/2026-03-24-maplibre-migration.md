# MapLibre Migration — Human Test Plan

## Prerequisites

- Application running locally at `http://localhost:5143`
- At least one trip with 2+ photos (Maine + NJ trip with token `0aae6c68-2789-47b9-90a1-0cbc624c3a01`)
- At least one trip with 1 photo (for single-photo edge cases)
- All automated tests passing:
  - `bash tests/verify-no-leaflet.sh` (from project root)
  - `npx playwright test tests/popup-pan.spec.js`
  - `npx playwright test tests/pin-drop.spec.js`
  - `npx playwright test tests/route-toggle.spec.js`
  - `dotnet test RoadTripMap.sln` (125 backend tests)

## Phase 1: Map Rendering (AC1.1, AC1.2, AC1.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to `http://localhost:5143/post/{SECRET_TOKEN}`. Open browser DevTools Network tab. | Page loads without errors. |
| 2 | Observe the photo map area (the map showing existing photo markers). | Map renders with styled vector tiles (not raster squares). Streets, labels, and terrain should appear crisp at any zoom level. |
| 3 | Zoom in and out on the photo map using scroll wheel or pinch. | Tiles re-render smoothly as vectors (no pixelation at high zoom). |
| 4 | In the Network tab, filter for "maptiler". | Requests go to `api.maptiler.com`, not `tile.openstreetmap.org` or any Leaflet CDN. |
| 5 | Upload a photo without GPS data to trigger the pin-drop map. Observe the pin-drop map. | Pin-drop map also renders MapTiler vector tiles, same style as photo map. |
| 6 | Navigate to a trip view page (e.g., from trips list). Observe the trip map. | Trip view map also renders MapTiler vector tiles. |

## Phase 2: Coordinate Correctness (AC2.1 visual portion)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to `http://localhost:5143/post/{SECRET_TOKEN}` (trip with Maine + NJ photos). | Map loads with 2 markers. |
| 2 | Identify the markers on the map. | One marker should be in the Maine area (northeastern US), one in the New Jersey area (mid-Atlantic). Neither should be in the ocean, wrong hemisphere, or swapped positions. |
| 3 | Click each marker and check the popup text matches the expected location. | Maine photo popup shows Maine-related place name; NJ photo popup shows NJ-related place name. |

## Phase 3: Popup Styling (AC2.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | On the post page, click a marker to open a popup. | Popup appears with: photo thumbnail image, place name text, dark-colored tip/arrow pointing to marker. |
| 2 | Verify there is no close button (X) on the popup. | No close button visible. Popup closes via Escape key or clicking elsewhere. |
| 3 | Navigate to the trip view page. Click a marker. | Popup styling is consistent with the post page (same colors, layout, tip style). |

## Phase 4: Header-Aware Popups (AC3.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to a trip view page. | Page loads with fixed header at top and map below. |
| 2 | Click a marker that is near the top edge of the map. | Popup opens fully visible below the header. No part of the popup is hidden behind or clipped by the header. |
| 3 | If no marker is near the top, zoom or pan so a marker is close to the top, then click it. | Map auto-pans if needed so popup content is fully visible below the header. |

## Phase 5: Route Rendering (AC4.1, AC4.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to `http://localhost:5143/post/{SECRET_TOKEN}` (2+ photo trip). | Map loads, "Show Route" button visible. |
| 2 | Click "Show Route". | A blue line (#3388ff or similar blue) appears connecting the markers in chronological order. The line has visible width (not hairline). |
| 3 | Verify the route connects markers sequentially (first photo to second photo, etc.). | Line goes from Maine marker to NJ marker (or vice versa based on upload order), not through random points. |
| 4 | Click "Hide Route". | The blue line disappears. Button text returns to "Show Route". |

## Phase 6: Single Photo Edge Cases (AC4.4, AC5.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to a trip that has exactly 1 photo. | Map loads with a single marker. |
| 2 | Check for route toggle button. | No "Show Route" / "Hide Route" button is visible. |
| 3 | Check for any route line on the map. | No blue line visible. |
| 4 | Observe the zoom level. | Map is centered on the single marker at a reasonable zoom (approximately zoom 13 — neighborhood level, not zoomed to entire world or zoomed to a single building). |

## Phase 7: Bounds Fitting (AC5.1, AC5.3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to a trip with geographically spread photos (e.g., Maine + NJ). | Map loads and automatically fits all markers in the viewport. |
| 2 | Verify all markers are visible without scrolling or panning. | All markers visible with padding around them (not right at the edge of the map). |
| 3 | On the view page, check that the topmost marker is below the fixed header. | The topmost marker is not hidden behind the header. Padding accounts for header height. |

## Phase 8: Animated Navigation (AC5.2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Navigate to a trip view page with 2+ photos and a photo carousel. | Map and carousel both visible. |
| 2 | Click a carousel item for a different photo than the currently selected one. | Map smoothly animates (flyTo) to the corresponding marker location. The animation is visible (not an instant jump). |
| 3 | After animation completes, verify the popup opens at the target marker. | Popup with photo thumbnail and place name appears at the marker. |

## End-to-End: Full Trip Viewing Experience

**Purpose:** Validate the complete user journey through a multi-photo trip.

1. Navigate to `http://localhost:5143/post/{SECRET_TOKEN}`.
2. Verify map renders with vector tiles and all photo markers are positioned correctly.
3. Click the first marker — popup appears within viewport with photo and place name, no close button.
4. Press Escape to dismiss popup.
5. Click "Show Route" — blue line connects markers in order. Button text says "Hide Route".
6. Click "Hide Route" — line disappears. Button text says "Show Route".
7. If carousel is present, click a different carousel item — map animates to that marker and opens its popup.
8. Open DevTools console — no JavaScript errors, no 403s from MapTiler, no references to Leaflet.

## End-to-End: Pin-Drop Photo Upload

**Purpose:** Validate the pin-drop map workflow for photos without GPS metadata.

1. Navigate to `http://localhost:5143/post/{SECRET_TOKEN}`.
2. Click "Add Photo" and select an image file that has no EXIF GPS data.
3. Pin-drop map appears with MapTiler vector tiles.
4. Click on the map at a location — a single marker appears at the click point.
5. Click a different location on the map — the old marker is removed, a new marker appears at the new location (exactly 1 marker total).
6. Complete the upload. The photo should appear with the manually selected coordinates.

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | — | Phase 1, step 2 |
| AC1.2 | — | Phase 1, step 5 |
| AC1.3 | — | Phase 1, step 6 |
| AC1.4 | `tests/verify-no-leaflet.sh` | — |
| AC1.5 | — | Post-deployment: load prod URL, check for 403s |
| AC2.1 | `tests/popup-pan.spec.js` (marker presence) | Phase 2 (coordinate correctness) |
| AC2.2 | `tests/popup-pan.spec.js` (popup after click) | — |
| AC2.3 | — | Phase 3 |
| AC2.4 | `tests/pin-drop.spec.js` (first click) | E2E: Pin-Drop, step 4 |
| AC2.5 | `tests/pin-drop.spec.js` (second click) | E2E: Pin-Drop, step 5 |
| AC3.1 | `tests/popup-pan.spec.js` (fullyVisible check) | — |
| AC3.2 | `tests/popup-pan.spec.js` (mobile viewport) | — |
| AC3.3 | — | Phase 4 |
| AC3.4 | `tests/verify-no-leaflet.sh` | — |
| AC4.1 | — | Phase 5, step 3 |
| AC4.2 | — | Phase 5, step 2 |
| AC4.3 | `tests/route-toggle.spec.js` (text toggle) | — |
| AC4.4 | — | Phase 6, steps 2-3 |
| AC5.1 | — | Phase 7, steps 1-2 |
| AC5.2 | — | Phase 8 |
| AC5.3 | — | Phase 7, step 3 |
| AC5.4 | — | Phase 6, step 4 |
| AC6.1 | `tests/verify-no-leaflet.sh` | — |
| AC6.2 | `tests/verify-no-leaflet.sh` | — |
| AC6.3 | `tests/verify-no-leaflet.sh` | — |
