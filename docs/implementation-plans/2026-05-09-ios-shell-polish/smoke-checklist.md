# iOS Shell Polish — On-device Smoke Checklist

Run on Patrick's iPhone with iOS 18+. Run in BOTH light and dark mode (Settings → Display & Brightness → Light / Dark). Run BOTH online and in airplane mode where indicated. The branch under test is `ios-shell-polish` after Phases 1–5 have landed.

## Signoff metadata

- Device: ___________
- iOS version: ___________
- App build: ___________
- Tester: ___________
- Date: ___________
- Light/Dark mode tested: ☐ Light ☐ Dark
- Online/Offline tested: ☐ Online ☐ Airplane mode

## Section 1 — Token foundation + dark mode (AC1, AC2)

- [ ] AC1.1: Headings, body, captions across all four pages use the new type scale (look for crisp, larger headings; subhead/footnote sizing on labels).
- [ ] AC1.2: Existing UI (toasts, brand-tinted CTAs, trip-card hovers) renders unchanged from before the polish.
- [ ] AC2.1: With OS in Dark Mode, all four pages render with dark surface, white text, brand-teal CTAs unchanged.
- [ ] AC2.1: With OS in Light Mode, all four pages render with the existing light palette.
- [ ] AC2.2: Toggle OS theme while the app is open — re-render shows the new theme on the next paint without a full reload.
- [ ] AC2.3: Open the immersive photo viewer in BOTH themes — backdrop is true-black in both (does not invert in light mode).

## Section 2 — Native plugin wiring (AC3)

- [ ] AC3.1: Tap Add-Photo / Cancel / Post — feel a light haptic on each.
- [ ] AC3.1: Successfully upload a photo — feel a medium haptic on commit.
- [ ] AC3.1: Force an upload failure (turn airplane mode on mid-upload) — feel an error haptic when the failure surfaces.
- [ ] AC3.3: Tap per-photo Share on post.html or trips.html — native iOS share sheet opens with title + URL prefilled. URL begins with `https://app-roadtripmap-prod.azurewebsites.net/...`, NOT `capacitor://...`.
- [ ] AC3.4: Tap per-photo Delete on post.html — native iOS confirm dialog appears with title "Delete photo?" and destructive "Delete" button.
- [ ] AC3.4: Cancel the dialog — photo is NOT deleted (AC4.6).
- [ ] AC3.4: Confirm the dialog — photo IS deleted; success toast.
- [ ] AC3.5: Open the immersive photo viewer — status bar text becomes light (visible against the true-black backdrop).
- [ ] AC3.5: Close the viewer (close button, Escape via external keyboard if available, swipe-down) — status bar text returns to dark.
- [ ] AC3.6: Idempotency — navigate away and back to a page multiple times — haptics do not stack (one buzz per action, not N).

## Section 3 — post.html chrome (AC4)

- [ ] AC4.1: `.page-header` is translucent + sticky on scroll. Status bar area visible above; content scrolls behind. iPhone notch/Dynamic Island has clear margin.
- [ ] AC4.2: All three top buttons (Add-Photo, Cancel, Post-Photo) buzz light on tap.
- [ ] AC4.3: Successful post buzzes medium; failed post buzzes error.
- [ ] AC4.4: Per-photo share opens iOS share sheet (also covered in AC3.3).
- [ ] AC4.5 + AC4.6: Per-photo delete shows native confirm; cancel keeps photo, confirm deletes.

## Section 4 — trips.html immersive viewer (AC5)

- [ ] AC5.1: `.map-header` is translucent. Trip name is visible (large + small forms both rendered).
- [ ] AC5.2: Tap a carousel thumbnail — viewer opens with true-black backdrop, light status bar.
- [ ] AC5.2: Tap on the overlay — chrome (close button, action buttons) fades out. Tap again — fades in. The image stays visible throughout.
- [ ] AC5.3: Swipe down on the open viewer — viewer dismisses with translate+fade animation.
- [ ] AC5.4: Status bar restores to dark on every dismiss path: close button, swipe-down, Escape (external keyboard).
- [ ] AC5.5: With Web Inspector attached, edit `closeOverlay` to throw a synthetic error (or trigger a real error path) — status bar still restores to dark (try/finally guarantee).

## Section 5 — index.html and create.html (AC6)

- [ ] AC6.1: index.html hero shows the trip-map title in large-title typography. Trip cards (if you have any in localStorage) render as Photos-tile cards (rounded, subtle shadow, press-in scale).
- [ ] AC6.2: create.html nav-bar header looks the same as post.html (translucent, sticky, safe-area-aware). Form inputs have iOS frosted-fill styling with system-blue focus outline.
- [ ] AC6.3: Submit a valid trip → success haptic before navigation. Submit an empty form (validation error) → error haptic + error banner.
- [ ] AC6.4: Tap targets are reliable for `.nav a` (back link), `.my-trip-card`, `.button-hero` — no near-misses.

## Section 6 — Cross-page motion + skeletons (AC7)

- [ ] AC7.1: Cross-page navigation (e.g., tap "Create a Trip" on home, then "← Back") shows a brief fade-out / fade-in transition.
- [ ] AC7.2: Settings → Accessibility → Motion → Reduce Motion ON. Re-launch the app. Cross-page navigation is now instant (no fade). Skeletons appear without shimmer.
- [ ] AC7.3: On post.html and trips.html (cold load), photo carousel briefly shows shimmering grey placeholder tiles before real photos appear.
- [ ] AC7.4: Tap rapidly between pages (post → create → trips → post → create, each tap within ~500ms of the last). The app stays responsive; no transitions get "stuck"; nothing visually corrupted; the third-and-later visit to post.html still renders the full page (Phase 5 Task 1's generation tracker holds).

## Section 7 — Existing functionality preserved (AC8)

- [ ] AC8.3: Resilient upload (large photo over a flaky network) — upload still recovers. The Phase 2 haptics on commit-success/failure don't change the underlying state machine.
- [ ] AC8.3: Offline shell — re-launch app in airplane mode, navigate to a previously-visited trip; cached page renders. The page-transition animation runs (or doesn't, if reduced motion); cached content is fine.
- [ ] AC8.3: MapLibre map renders pins, popups, route line, POIs, park boundaries — Phase 3 polish did not regress any layer.
- [ ] AC8.3: Trips list on index.html renders all stored trips with their owner/viewer role badge.
- [ ] AC8.4: Open Web Inspector → Network. Confirm response headers `x-server-version` and `x-client-min-version` still present on every request.
- [ ] AC8.4: Trigger an upload that fails on the server — confirm the server logs (via Patrick's normal log access) do NOT contain raw secret tokens, raw GPS coordinates, or full SAS URLs (LogSanitizer invariant).

## Section 8 — Subjective acceptance (AC10)

- [ ] AC10.1: Sign off below.
- [ ] AC10.2: After this run, on the upcoming trip, Patrick reaches for the iOS app instead of the website.

---

## Sign-off

I, Patrick, ran the full matrix above on the date, device, and OS version recorded in the metadata header. The unchecked items in each section above represent failures that need fixing before this branch ships.

Signed: ______________________ Date: __________
