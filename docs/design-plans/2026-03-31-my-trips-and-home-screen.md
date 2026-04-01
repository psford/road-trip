# My Trips & Save to Home Screen Design

## Summary

This feature adds two client-side conveniences that make the app feel more like a native mobile application. The first is a "My Trips" section on the index page: trips a user creates or visits are quietly saved to localStorage, and the index page reads that list and renders clickable cards so users can return to any of their trips without remembering a URL. The second is a one-time instructional modal for iOS Safari users, which appears on the first visit to a post page and walks them through adding the trip to their home screen using the browser's native Share menu — the only mechanism iOS exposes for this action.

Both features are built entirely in the browser with no server changes. They share a common persistence layer through the existing `TripStorage` module, which already handles deduplication and localStorage error handling but has not yet been wired into any page. The implementation wires `TripStorage` into the create and post pages, adds the index-page rendering logic, and layers the iOS prompt on top as an independent concern. Graceful degradation is a first-class requirement throughout: if localStorage is unavailable for any reason, both features simply disappear rather than throwing errors.

## Definition of Done

1. Previously created trips appear on the index page, persisted in localStorage
2. Tapping a saved trip navigates to its post page
3. New trips are saved to localStorage on creation and on post page visit
4. iOS Safari users see a modal on first post page visit explaining how to save to home screen
5. The modal is easily dismissable and only shows once
6. A persistent "Save to Home Screen" link remains on the post page for users who dismissed the modal

## Acceptance Criteria

### my-trips-home-screen.AC1: Trips saved to localStorage
- **my-trips-home-screen.AC1.1 Success:** Creating a trip on create page saves `{name, postUrl, viewUrl, savedAt}` to localStorage
- **my-trips-home-screen.AC1.2 Success:** Visiting a post page for a trip not in localStorage adds it
- **my-trips-home-screen.AC1.3 Success:** Visiting a post page for an already-saved trip does not create duplicate
- **my-trips-home-screen.AC1.4 Edge:** localStorage unavailable — no error thrown, feature degrades silently

### my-trips-home-screen.AC2: My Trips section on index page
- **my-trips-home-screen.AC2.1 Success:** Saved trips appear on index page with trip name and link to post page
- **my-trips-home-screen.AC2.2 Success:** Tapping a trip navigates to the correct post URL
- **my-trips-home-screen.AC2.3 Success:** Multiple trips display in order (most recent first)
- **my-trips-home-screen.AC2.4 Edge:** No saved trips — My Trips section is not visible
- **my-trips-home-screen.AC2.5 Edge:** localStorage unavailable — section not visible, no error

### my-trips-home-screen.AC3: Home screen modal on iOS Safari
- **my-trips-home-screen.AC3.1 Success:** First visit to post page on iOS Safari shows modal with save instructions
- **my-trips-home-screen.AC3.2 Success:** Modal has prominent dismiss button
- **my-trips-home-screen.AC3.3 Success:** Dismissing modal sets localStorage flag, modal does not reappear
- **my-trips-home-screen.AC3.4 Success:** Modal does not appear on desktop browsers
- **my-trips-home-screen.AC3.5 Success:** Modal does not appear on Android browsers
- **my-trips-home-screen.AC3.6 Edge:** App already running in standalone mode (from home screen) — no modal

### my-trips-home-screen.AC4: Persistent home screen link
- **my-trips-home-screen.AC4.1 Success:** "Save to Home Screen" link visible on post page on iOS Safari
- **my-trips-home-screen.AC4.2 Success:** Clicking link shows home screen instructions
- **my-trips-home-screen.AC4.3 Success:** Link not visible on non-iOS browsers

## Glossary

- **localStorage**: Browser API that stores key-value string data persistently on the user's device, scoped to the origin. Survives page reloads but cleared when user clears site data.
- **TripStorage**: Existing JavaScript module in `wwwroot/js/tripStorage.js` that wraps localStorage with trip-specific read/write/deduplication logic.
- **postUrl / viewUrl**: Two distinct URLs per trip. `postUrl` is the owner-facing management URL (secret token). `viewUrl` is the public map view shared with followers.
- **secretToken**: URL parameter on the post page identifying the trip owner's session. Used by `TripStorage.saveFromPostPage()` to look up trip metadata.
- **standalone mode**: Display state when a home screen bookmark is launched as a full-screen app. Detected via `window.navigator.standalone` on iOS.
- **beforeinstallprompt**: Browser event on Android/Chrome for programmatic PWA install. Not available on iOS. Deferred to future work.
- **apple-touch-icon**: HTML `<link>` tag specifying the icon for iOS home screen bookmarks. Deferred.

## Architecture

Two independent features sharing a common persistence layer (localStorage via TripStorage).

### Feature 1: My Trips on Index Page

The existing `TripStorage` module (`wwwroot/js/tripStorage.js`) already implements localStorage persistence with deduplication. It's fully built but never wired into any page.

**Data flow:**
1. User creates trip on `create.html` → `TripStorage.saveTrip(name, postUrl, viewUrl)` before redirect
2. User visits post page → `TripStorage.saveFromPostPage(secretToken)` saves if not already present
3. User visits index page → `TripStorage.getTrips()` populates "My Trips" section
4. Section hidden when no trips exist

**Index page changes:** Add a "My Trips" section between the hero and "How It Works" card. Each trip renders as a clickable card/row with trip name and a "Continue" link to `postUrl`. Section is invisible when `getTrips()` returns empty array.

### Feature 2: Save to Home Screen Prompt

iOS Safari cannot programmatically trigger "Add to Home Screen." The best UX is an instructional modal.

**Data flow:**
1. Post page loads → check `localStorage.getItem('roadtripmap_homescreen_dismissed')`
2. If not dismissed AND iOS Safari detected → show modal
3. User dismisses → `localStorage.setItem('roadtripmap_homescreen_dismissed', 'true')`
4. Persistent link at bottom of post page reopens the instructions (always visible on iOS Safari)

**iOS detection:** Check for iPhone/iPad in user agent AND not standalone mode (already on home screen). No prompt for Android/desktop — Android PWA install deferred to future work.

**Modal content:**
- Heading: "Save this trip to your Home Screen"
- Body: "Get quick access without remembering the URL"
- Steps: 1. Tap the Share button (with icon) → 2. Scroll down and tap "Add to Home Screen" → 3. Tap "Add"
- Prominent "Got it" dismiss button

## Existing Patterns

- **Module pattern:** All JS modules (`PostUI`, `MapUI`, `PhotoCarousel`, `UploadQueue`) use the object literal module pattern with `init()`. New index page JS follows this pattern.
- **Toast notifications:** `PostUI.showToast()` for user feedback. The home screen modal is a new pattern (modal overlay) not yet used in the codebase.
- **CSS variables:** Styles use CSS custom properties (`--space-sm`, `--color-primary`, etc.) defined in `styles.css`. New styles follow existing conventions.
- **No build step:** All JS is vanilla, loaded via script tags. No bundler, no modules.
- **localStorage:** `TripStorage` already follows the codebase pattern. No new persistence patterns introduced.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Wire Up TripStorage

**Goal:** Save trips to localStorage on creation and post page visit

**Components:**
- `wwwroot/create.html` — add `tripStorage.js` script tag, call `TripStorage.saveTrip()` after successful creation
- `wwwroot/post.html` — add `tripStorage.js` script tag
- `wwwroot/js/postUI.js` — call `TripStorage.saveFromPostPage(secretToken)` in `init()`
- `wwwroot/js/tripStorage.js` — fix `saveFromPostPage` to store `viewUrl` from API response (currently stores empty string because `getTripInfoBySecret` returns `viewUrl`)

**Dependencies:** None

**Done when:** Creating a trip saves it to localStorage; visiting a post page saves it; `TripStorage.getTrips()` returns saved trips with name and postUrl
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: My Trips Section on Index Page

**Goal:** Show saved trips on the index page

**Components:**
- `wwwroot/index.html` — add "My Trips" section markup between hero and "How It Works", add `tripStorage.js` and inline script to populate
- `wwwroot/css/styles.css` — styles for trip list (cards or rows with trip name and continue link)

**Dependencies:** Phase 1 (trips must be saved to localStorage)

**Done when:** Index page shows saved trips when they exist, hides section when empty, tapping a trip navigates to post page
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Save to Home Screen Modal

**Goal:** iOS Safari users see instructions for saving to home screen on first post page visit

**Components:**
- `wwwroot/js/postUI.js` — iOS detection logic, modal creation, dismiss handling, localStorage flag
- `wwwroot/css/styles.css` — modal overlay styles (backdrop, centered card, step list, dismiss button)
- `wwwroot/post.html` — no structural changes needed (modal injected via JS)

**Dependencies:** None (independent of Phase 1/2)

**Done when:** Modal appears on first iOS Safari visit, dismisses on button click, doesn't reappear after dismissal, doesn't appear on non-iOS browsers
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Persistent Home Screen Link

**Goal:** Users who dismissed the modal can still access instructions

**Components:**
- `wwwroot/post.html` — add "Save to Home Screen" link below the Share This Trip section
- `wwwroot/js/postUI.js` — link click handler reopens the instruction content (not the auto-dismiss modal, just the instructions)
- `wwwroot/css/styles.css` — link styling consistent with existing secondary actions

**Dependencies:** Phase 3 (reuses modal content/styles)

**Done when:** Link visible on post page (iOS Safari only), clicking it shows the home screen instructions
<!-- END_PHASE_4 -->

## Additional Considerations

**No server changes required.** Both features are purely client-side.

**localStorage limitations:** Trips persist until cache is cleared. This is acceptable — it's a convenience feature, not a security boundary. If localStorage is unavailable, features degrade silently (no trips shown, no modal).

**Android/desktop:** Home screen prompt is iOS-only for now. Android PWA install (manifest.json, service worker, beforeinstallprompt) is a separate future effort.

**apple-touch-icon:** Adding an icon for the home screen bookmark is deferred — the current favicon will be used. A dedicated icon can be added later without architectural changes.
