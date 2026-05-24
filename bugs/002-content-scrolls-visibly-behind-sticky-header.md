---
id: 2
title: Page content scrolls visibly behind sticky header — visual treatment isn't iOS-native
status: needs-design
severity: polish
surface: ios-app
opened: 2026-05-24
closed:
fixed-by:
regression-from: PR #89 (sticky-pin fix). Before #89 the header pinned behind the status bar and was effectively invisible during scroll, so the question of "what does content scrolling past the header look like?" didn't arise. After #89 the header is the visible nav-bar and the visual treatment of content passing behind it is now exposed.
regression-test:                   # blocked until design decision lands
---

## Summary

On any iOS-shell page with the sticky `.page-header` (post.html, trips.html, create.html), page content visibly scrolls behind the pinned header. The header has `backdrop-filter: var(--material-blur-regular)` set, but the visual result feels wrong — content underneath is still legible and the layering looks like "content punching through a half-transparent wall" rather than "content blurred behind a frosted iOS nav bar."

This is a polish / design issue, not a functional one. Filing for explicit resolution rather than letting it drift.

## Repro steps

1. Open the iOS app, navigate to any trip's `/trips/<viewToken>` or `/post/<secretToken>`.
2. Scroll down past where the sticky header has engaged.
3. Observe the area where content passes behind the header.

## Expected behavior

One of (pick one as part of design):

- (a) **Translucent + blur** (iOS-native, as currently attempted): the header has a translucent material-blur background; content scrolling behind is muted by the blur but still partially visible. The current CSS aims at this — figure out why it doesn't render as expected (blur strength too weak? bg color too transparent? backdrop-filter not supported by the WebView version?).
- (b) **Opaque header**: drop the translucent material; use a solid background so content visually stops at the header edge. Simpler, less iOS-native but consistent.

## Actual behavior

Content scrolls visibly behind the header, neither fully blurred (option a done well) nor cleanly blocked (option b). The middle ground reads as a bug rather than a design.

## Environment

- iOS app build: PR #92 (release of #89 + #90 + #91), cap-synced after deploy 26352263687
- Prod App Service deploy: 2026-05-24
- Device: iPhone 16 Pro

## Screenshots / video

- Screenshots provided in conversation 2026-05-24 (not yet saved to bugs/assets/). Visible on trips.html immediately after scroll.

## Notes for Claude

- Status `needs-design` because the fix surface depends on the design choice. Don't open a fix PR until the design answer is locked in.
- Current CSS for the relevant rule: `src/RoadTripMap/wwwroot/ios.css` lines ~161–195. Tokens: `--material-bg-light`, `--material-blur-regular`, defined in `src/RoadTripMap/wwwroot/css/styles.css` `:root`.
- If (a): investigate why the blur isn't rendering convincingly. Possible: `--material-blur-regular` value is `blur(8px)` or similar — try `blur(20px) saturate(180%)` (iOS uses much stronger blur + saturation). Confirm `-webkit-backdrop-filter` is present (it is).
- If (b): drop the blur, set `background-color` to an opaque value (`var(--color-surface)` or `var(--color-bg)`).
- Either resolution needs a Playwright layout test that asserts the chosen treatment (computed style check at minimum).
