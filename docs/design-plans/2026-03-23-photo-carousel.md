# Photo Carousel Design

## Summary

The photo carousel replaces the existing static photo grid on both the post page (where trips are created and photos are uploaded) and the view page (the public-facing trip map). Rather than a separate panel that competes with the map for screen space, photos surface as a horizontally scrollable thumbnail strip that lives alongside the map — floating over the bottom of the map on the view page, and sitting in normal document flow below the map on the post page.

The core of the work is a new shared `PhotoCarousel` module that both pages include. It handles rendering, scroll-snap behavior, item selection, and the save/delete actions. The map and carousel are kept in two-way sync: tapping a pin scrolls the carousel to that photo and highlights it; tapping a carousel thumbnail pans the map to that pin, opens its popup, and launches a fullscreen image viewer. Ordering throughout — both the carousel and the route polyline drawn between pins — changes from creation-time descending to `takenAt` ascending, so photos and the route trace the trip chronologically. The implementation is organized into four sequential phases: building the standalone carousel component, integrating it into the post page, integrating it into the view page, and finally switching the API sort order and removing the old grid code.

## Definition of Done
Replace the photo grid with a horizontal carousel on both the post page and view page. Carousel floats over the bottom of the map on the view page. Tapping a map pin scrolls the carousel to that photo and highlights it. Tapping a carousel photo opens fullscreen view and re-centers the map on that photo's pin. Save icon (OS-native style) on carousel photos and fullscreen view. Delete button on carousel items (post page only). Photos and route line ordered by `takenAt` (oldest first).

## Acceptance Criteria

### photo-carousel.AC1: Carousel renders as horizontal thumbnail strip
- **photo-carousel.AC1.1 Success:** Photos display as square thumbnails in a horizontal scrollable strip
- **photo-carousel.AC1.2 Success:** Scroll snaps to items on touch swipe and mouse scroll
- **photo-carousel.AC1.3 Success:** Selected photo has visible highlight (accent color border)
- **photo-carousel.AC1.4 Edge:** Single photo renders without scroll — no empty space or broken layout
- **photo-carousel.AC1.5 Edge:** No photos — carousel container is hidden

### photo-carousel.AC2: Pin tap scrolls carousel to photo
- **photo-carousel.AC2.1 Success:** Tapping a map pin scrolls the carousel to the corresponding photo and highlights it
- **photo-carousel.AC2.2 Success:** Previously highlighted photo is de-highlighted when a new pin is tapped
- **photo-carousel.AC2.3 Success:** Works on first click (no caching/timing issues)

### photo-carousel.AC3: Carousel tap pans map and opens fullscreen
- **photo-carousel.AC3.1 Success:** Tapping a carousel thumbnail pans the map to that photo's pin location
- **photo-carousel.AC3.2 Success:** Tapping a carousel thumbnail opens the marker popup on the map
- **photo-carousel.AC3.3 Success:** Tapping a carousel thumbnail opens the fullscreen image viewer
- **photo-carousel.AC3.4 Success:** Fullscreen viewer dismisses on tap anywhere or Escape key

### photo-carousel.AC4: Delete works from carousel (post page only)
- **photo-carousel.AC4.1 Success:** Delete button visible on carousel items on the post page
- **photo-carousel.AC4.2 Success:** Delete triggers confirmation dialog, removes photo from carousel, map, and route on confirm
- **photo-carousel.AC4.3 Failure:** Cancel on confirmation dialog leaves photo intact
- **photo-carousel.AC4.4 Success:** Delete button not visible on carousel items on the view page

### photo-carousel.AC5: Save icon with OS-adaptive behavior
- **photo-carousel.AC5.1 Success:** Save icon visible on carousel thumbnails and fullscreen viewer
- **photo-carousel.AC5.2 Success:** On mobile with Web Share API, tapping save triggers native share sheet
- **photo-carousel.AC5.3 Success:** On desktop without Web Share API, tapping save downloads the original image

### photo-carousel.AC6: Photos and route ordered by takenAt
- **photo-carousel.AC6.1 Success:** Carousel shows photos oldest-first by takenAt
- **photo-carousel.AC6.2 Success:** Route polyline connects pins in takenAt order
- **photo-carousel.AC6.3 Edge:** Photos with null takenAt sort to the end

### photo-carousel.AC7: View page floating carousel
- **photo-carousel.AC7.1 Success:** Carousel floats at bottom of map with blurred dark background
- **photo-carousel.AC7.2 Success:** Route toggle button sits above the carousel
- **photo-carousel.AC7.3 Success:** Map remains interactive behind/above the carousel

## Glossary

- **`takenAt`**: A timestamp stored with each photo, derived from the image's EXIF metadata, recording when the photo was actually taken. Distinct from `CreatedAt`, which records when the record was inserted into the database.
- **scroll-snap**: A CSS feature (`scroll-snap-type`, `scroll-snap-align`) that causes a scrollable container to snap to discrete positions — here, one carousel item at a time — on touch swipe and mouse scroll.
- **`backdrop-filter: blur`**: A CSS property that applies a visual blur effect to whatever is rendered behind an element. Used to give the floating carousel a frosted-glass appearance over the map.
- **Leaflet**: The open-source JavaScript mapping library used by this application to render the interactive map, place photo markers, and draw route polylines.
- **`popupopen` event**: A Leaflet event fired on the map when a marker popup is opened. Used as the hook to trigger carousel synchronization from a pin tap.
- **Web Share API**: A browser API (`navigator.share`) that triggers the operating system's native share sheet on mobile devices. Falls back to a direct file download on desktop browsers that do not support it.
- **`photoId → marker` lookup**: A JavaScript `Map` object built during marker creation that maps each photo's ID to its Leaflet marker instance, enabling the carousel to programmatically pan the map when a thumbnail is tapped.
- **Shared module**: A JavaScript file included via `<script>` tag on more than one HTML page. `PhotoCarousel` is the first shared module in this codebase.
- **CSS custom properties**: Variables defined in CSS using the `--name` syntax, referenced via `var(--name)`. Used throughout this codebase to centralize colors and spacing values.

## Architecture

Shared `PhotoCarousel` module renders a horizontal thumbnail strip on both the post page and view page. The carousel uses CSS `scroll-snap-type: x mandatory` with `display: flex` for native touch/mouse scrolling. Each item is a fixed-width card (~120px mobile, ~150px desktop) showing the photo as a square `object-fit: cover` thumbnail with the place name below and action icons overlaid.

Bidirectional sync between map and carousel:
- **Pin → carousel:** Leaflet `popupopen` event extracts the photo ID, calls `carousel.selectPhoto(id)` which scrolls to and highlights the item.
- **Carousel → map:** Tapping a carousel thumbnail pans the map to that photo's coordinates, opens the marker popup, and launches the fullscreen viewer. The carousel maintains a `photoId → marker` lookup built during marker creation.

The popup design stays as photo-with-overlaid-text (no buttons in popup). Save and delete controls live on carousel items only.

**View page:** Carousel floats at bottom of the full-viewport map with `position: fixed`, `backdrop-filter: blur(10px)`, dark semi-transparent background. Route toggle button repositions above it.

**Post page:** Carousel sits in normal document flow where the photo grid currently lives — below the map, above the "Share This Trip" section.

**Ordering:** Both carousel and route polyline sort by `takenAt` ascending (oldest first). API endpoints change from `OrderByDescending(CreatedAt)` to `OrderBy(TakenAt)`.

## Existing Patterns

Investigation found the current photo grid in `postUI.js` (`createPhotoElement`, `loadPhotoList`) and map popup rendering in both `postUI.js` and `mapUI.js`. Key patterns followed:

- **DOM construction in JS:** Both pages build HTML elements via `document.createElement` and template literals for popup HTML. The carousel follows this pattern.
- **Marker-to-photo linkage:** Markers reference photos by `data-photo-id` attribute. The carousel extends this with a `photoId → marker` Map object for reverse lookup.
- **CSS custom properties:** All colors and spacing use `var(--color-*)` and `var(--space-*)`. The carousel follows this.
- **Fullscreen viewer:** The `showFullscreenImage()` method and `.fullscreen-overlay` CSS already exist in `postUI.js`. The carousel reuses this, adding a save icon to the overlay.

New pattern introduced: **Shared module between pages.** Currently `postUI.js` and `mapUI.js` are independent. `PhotoCarousel` becomes the first shared component, included via `<script>` on both pages. This is a new pattern — justified because the carousel behavior is identical across pages (only `canDelete` config differs).

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: PhotoCarousel Module & CSS
**Goal:** Shared carousel component that renders a horizontal thumbnail strip with scroll-snap behavior.

**Components:**
- `src/RoadTripMap/wwwroot/js/photoCarousel.js` — `PhotoCarousel` module with `init(container, photos, config)`, `selectPhoto(id)`, `addPhoto(photo)`, `removePhoto(id)` methods
- `src/RoadTripMap/wwwroot/css/styles.css` — carousel CSS: `.carousel-strip`, `.carousel-item`, `.carousel-item.selected`, scroll-snap rules, responsive sizing
- SVG save icon inline in carousel items — `navigator.share` detection with download fallback

**Dependencies:** None

**Done when:** Carousel renders a list of photos as a horizontal scrollable strip, items snap on scroll, save icon triggers share/download, `selectPhoto` scrolls to and highlights an item. Covers photo-carousel.AC1.*, photo-carousel.AC5.*.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Post Page Integration
**Goal:** Replace the photo grid on the post page with the carousel, wire up map-carousel sync and delete.

**Components:**
- `src/RoadTripMap/wwwroot/post.html` — replace `#photoGrid` with carousel container, add `photoCarousel.js` script tag, remove `tripStorage.js` script tag
- `src/RoadTripMap/wwwroot/js/postUI.js` — replace `createPhotoElement`/grid rendering with `PhotoCarousel.init()`, wire `popupopen` to `carousel.selectPhoto()`, wire carousel tap to `marker.openPopup()` + fullscreen, wire delete callback to existing `PostService.deletePhoto()`, build `photoId → marker` lookup
- Delete `src/RoadTripMap/wwwroot/js/tripStorage.js`

**Dependencies:** Phase 1 (PhotoCarousel module)

**Done when:** Post page shows carousel instead of grid, pin tap scrolls carousel, carousel tap pans map + opens fullscreen, delete works from carousel items, new uploads appear in carousel in `takenAt` order. Covers photo-carousel.AC2.*, photo-carousel.AC3.*, photo-carousel.AC4.1-4.3.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: View Page Integration
**Goal:** Add floating carousel to the view page with map-carousel sync (no delete).

**Components:**
- `src/RoadTripMap/wwwroot/trips.html` — add carousel container and `photoCarousel.js` script tag
- `src/RoadTripMap/wwwroot/js/mapUI.js` — initialize carousel with `canDelete: false`, wire `popupopen` to `carousel.selectPhoto()`, wire carousel tap to map pan + popup open + fullscreen, build `photoId → marker` lookup
- `src/RoadTripMap/wwwroot/css/styles.css` — floating carousel styles for view page (`.map-page .carousel-strip` with `position: fixed`, `backdrop-filter`, dark background), route toggle repositioned above carousel

**Dependencies:** Phase 1 (PhotoCarousel module)

**Done when:** View page shows floating carousel at bottom of map, pin tap scrolls carousel, carousel tap pans map + opens fullscreen, no delete button visible, route toggle sits above carousel. Covers photo-carousel.AC3.*, photo-carousel.AC4.4.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: API Ordering & Cleanup
**Goal:** Change photo ordering to `takenAt` ascending, update route polyline, clean up removed code.

**Components:**
- `src/RoadTripMap/Program.cs` — change both photo list endpoints from `OrderByDescending(p => p.CreatedAt)` to `OrderBy(p => p.TakenAt)`
- `src/RoadTripMap/wwwroot/js/postUI.js` — remove old `createPhotoElement`, `photo-grid` references, `photo-list` section rendering
- `src/RoadTripMap/wwwroot/css/styles.css` — remove `.photo-grid`, `.photo-item`, `.photo-item-*` CSS rules
- Route polyline in both `postUI.js` and `mapUI.js` already uses the photo array order — changing the API sort handles this

**Dependencies:** Phases 2 and 3 (both pages using carousel)

**Done when:** Photos appear oldest-first in carousel and route line on both pages, old grid CSS/JS removed, no dead code. Covers photo-carousel.AC6.*.
<!-- END_PHASE_4 -->

## Additional Considerations

**Empty state:** When a trip has no photos, the carousel container is hidden. The view page shows the existing "No photos yet" overlay. The post page shows only the "Add Photo" button.

**Photo upload timing:** `takenAt` may be null if EXIF metadata is missing. Photos with null `takenAt` sort to the end (most recent upload position). This is acceptable for the MVP — the future interpolation work noted during clarification would address geographic ordering.

**Performance:** Thumbnails are 300px images (already generated server-side). The carousel loads all thumbnails eagerly since they're small and the count is typically low (road trip = tens of photos, not thousands).
