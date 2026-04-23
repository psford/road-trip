# iOS Shell Hardening — On-device Smoke Checklist

Run on an iPhone 12 or newer with a notch and home indicator. Best to run with the Xcode device console attached so you can observe console output. Test both Wi-Fi and airplane-mode flows. The branch under test is `ios-offline-shell` after Phases 1–7 have landed.

## Signoff metadata

- Device: ___________
- iOS version: ___________
- App build: ___________
- Tester: ___________
- Date: ___________

## Section 1 — Cascade-free navigation (AC1, AC2.event, AC2.scope, AC7)

- [ ] Launch app, observe console is clean.
- [ ] Navigate home → post (any saved trip) → create → post → home → post (5+ navigations).
- [ ] After each swap, console shows no `SyntaxError: Can't create duplicate variable` and no warning about duplicate listeners firing.
- [ ] On the post page, `PostUI.init` runs exactly once per visit (verify by setting `console.log` in DevTools if needed, or by confirming upload form is in initial state on each arrival).
- [ ] `versionProtocol.js` init runs on every page (confirm via any existing `x-client-min-version` logging).
- [ ] (AC7.1) With device in airplane mode, try to navigate to a trip URL that has NEVER been visited before. `fetchAndSwap` fails cleanly — console shows the failure but NO cascade of follow-up errors.

## Section 2 — Share-trip link (AC3.3)

- [ ] Navigate to a post page (as owner). Tap "Copy" on the share-view link.
- [ ] Paste the copied text into Messages (or any other app on the same device) — it reads `https://app-roadtripmap-prod.azurewebsites.net/trips/{viewGuid}`. It MUST NOT start with `capacitor://`.
- [ ] Paste into Safari on a SECOND device — Safari opens the trip view-only page (no auth prompt; trip renders).
- [ ] On the post page, tap a photo's share action (the native iOS share sheet). The URL passed to the share sheet is the same `https://app-roadtripmap-prod.azurewebsites.net/...` form.

## Section 3 — Offline create (AC4.3)

- [ ] Go to the create page while online. Confirm form loads normally.
- [ ] Turn on airplane mode.
- [ ] Fill out a trip name + description. Submit.
- [ ] The form displays `"Can't create a trip while offline. Try again when you're back online."` in the error area. The button is re-enabled. No raw `"Load failed"` or other internal error string is visible.

## Section 4 — Offline trip-page photos (AC5.2, AC5.3, post-page toast)

- [ ] While online, visit a trip view link (`/trips/{viewGuid}`). Photos load and render.
- [ ] Exit the app. Turn on airplane mode. Relaunch the app. Re-visit the SAME trip view link.
- [ ] The photo LIST renders (thumbs may show broken-image placeholders — this is the documented Azure-blob limitation).
- [ ] Still offline, visit a NEW trip view link that has never been cached. An offline-friendly message is shown (not a blank screen).
- [ ] Open a post page (owner) while offline. If the previous session cached no photos, the offline-friendly toast reads `"Photos unavailable offline. Reconnect to see the latest."`.

## Section 5 — Safe-areas (AC6.safeArea)

- [ ] On every page (`/`, `/create`, `/post/{token}`, `/trips/{viewToken}`), visually confirm no element is clipped by the notch or the home indicator.
- [ ] `.map-header` (trips.html) sits beneath the notch with full visibility.
- [ ] `.page-header` on create and post does not overlap the notch.
- [ ] `.hero` on index does not overlap the notch.
- [ ] `.resume-banner` (post page, when a paused upload exists) does not overlap the notch.
- [ ] `.toast-container` (post page) floats above the home indicator.
- [ ] `.view-carousel-container` (trips page, when a photo is open) floats above the home indicator.
- [ ] `.map-control` (trips page) floats above the home indicator.
- [ ] `.homescreen-modal-overlay` (post page modals) has visible margin above the notch and above the home indicator.

## Section 6 — HIG tap targets + momentum scroll (AC6.hig.1, AC6.hig.2)

- [ ] On the post page, every small button (`.copy-button`, `.carousel-action-btn`, `.photo-popup-delete`, `.upload-panel__toggle`, `.upload-panel__retry`/`pin-drop`/`discard`) feels at-least-44×44pt to tap — no near-misses, no needing a stylus.
- [ ] On the trips page, `.map-back` and `.poi-action-btn` buttons feel similarly full-sized.
- [ ] `.upload-panel__body` (the list of in-flight uploads on the post page) scrolls with native iOS momentum/inertia when flicked (not sticky/stuck).

## Section 7 — Keyboard attributes (AC6.hig.3, AC6.hig.4)

- [ ] On post, tap the `#captionInput` field. The iOS keyboard shows with auto-capitalization enabled — the first letter of a new sentence auto-capitalizes. Typing a misspelled word offers autocorrect suggestions.
- [ ] On create, tap the `#tripName` field. Auto-capitalization is in "words" mode — each word's first letter auto-capitalizes (title-case feel).
- [ ] On create, tap the `#tripDescription` field. Auto-capitalization is in "sentences" mode — first letter of each sentence capitalizes.

## Section 8 — Regression and sign-off

- [ ] The regular-browser experience (open `https://app-roadtripmap-prod.azurewebsites.net/` in Safari on a non-notched device or iPad) is visually unchanged: no `.platform-ios` styles leaking, no padding differences, no missing elements.
- [ ] No outstanding error toasts or console warnings on any page.
- [ ] Patrick's signoff: ___________  Date: ___________

## Follow-up (if any AC failed)

If Section 1's AC7.1 repro still produces a cascade after Phase 3 landed, open a new issue (title: "iOS shell: post-failure cascade persists after script-src dedup (AC7.2)") with the console trace attached, then mark Phase 8 checkable regardless — AC7.2 explicitly does not block plan completion.

Any other AC failure: open an issue tagged `ios-offline-shell`, link from the design plan's Definition of Done, and do NOT sign off Section 8 until resolved.
