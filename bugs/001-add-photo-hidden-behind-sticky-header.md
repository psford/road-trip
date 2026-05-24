---
id: 1
title: Add Photo button hidden behind sticky page header after scroll
status: open
severity: important
surface: ios-app/post-page
opened: 2026-05-24
closed:
fixed-by:
regression-from: PR #89 (sticky-pin fix). Before #89 the sticky header pinned at top: 0 (behind the status bar), so it didn't visually overlap content while scrolling. After #89 the header pins at top: env(safe-area-inset-top) and is now visible — but the layout doesn't account for the Add Photo button sitting in the area the pinned header overlaps.
regression-test: tests/playwright-layout/sticky-header-doesnt-cover-controls.spec.js   # not yet written
---

## Bug

On the iOS app's post page, after scrolling the photo list, the sticky page header (Back / [trip name]) covers the "Add Photo" button — making it unreachable until the user scrolls all the way back to the top. The Add Photo button needs to remain accessible regardless of scroll position, since "add a photo" is the primary action of this page.

## Steps to reproduce

1. Open the iOS app on an iPhone with a notch / Dynamic Island (verified iPhone 16 Pro).
2. Navigate to a trip with at least one existing photo (e.g., the "Test" trip — `/post/<secretToken>`).
3. Scroll down enough that the existing photo list / map fills the viewport (so the sticky header has actually engaged).
4. Try to tap "Add Photo".

## Expected results

The Add Photo button is reachable in any scroll state. Options for the resolution (pick one as part of the design decision — this can be re-classified as `needs-design` if there's disagreement):

- (a) Keep Add Photo in its current DOM position but make it sticky too (pinned just below the header).
- (b) Move Add Photo into the header itself (right-aligned next to the trip name, iOS-native compose-icon pattern).
- (c) Keep Add Photo in the page body but adjust page-header z-index / layout so the body content is never visually overlapped by the pinned header (i.e., add `scroll-padding-top: env(safe-area-inset-top)` or equivalent so scroll position never parks anything under the pinned region).

## Actual results

After scroll, the Add Photo button is occluded by the now-visible sticky header. Tapping where it logically is yields the header's tap handler (Back link, etc.) instead.

## Environment

- iOS app build: PR #92 (release of #89 + #90 + #91), cap-synced after deploy 26352263687 (2026-05-24)
- Prod App Service deploy: run 26352263687, succeeded 2026-05-24 ~12:55 UTC-4
- Device: iPhone 16 Pro

## Screenshots / video

- Screenshots provided in conversation 2026-05-24 (not yet saved to bugs/assets/). Reproduce by following the steps above; the issue is immediate.

## Notes for Claude

- The CSS rule is `.platform-ios .page-header` in `src/RoadTripMap/wwwroot/ios.css` (sticky block around line 161).
- The Add Photo button is `#addPhotoButton` in `src/RoadTripMap/wwwroot/post.html` line ~39, just below the `.page-header` element. CSS in `src/RoadTripMap/wwwroot/css/styles.css` `.add-photo-button` and `src/RoadTripMap/wwwroot/ios.css` `.platform-ios .add-photo-button`.
- Resolution (c) is the smallest change: set `scroll-padding-top` on the scroll container (`body.platform-ios` or `:root` per WebKit). Value: `calc(env(safe-area-inset-top) + var(--space-sm) + <pinned header height>)`. Verify the scroll container is actually `body` (not `.container`) on the post page first — `getComputedStyle(document.scrollingElement)` confirms.
- Resolution (b) is the most iOS-native and the largest design change.
- Write a Playwright layout test that asserts the Add Photo button's `getBoundingClientRect()` is never visually obscured by the pinned `.page-header` after scrolling.
