# Native iOS — Real-Device Test Checklist

Everything deferred to a single on-device pass (per Patrick: batch device testing rather
than do it piecemeal). The simulator can't validate background-session survival, true pinch,
the tactile pin drag, or TestFlight — so those wait for here.

**Prerequisites**
- A physical iPhone (Patrick's + dad's for TestFlight).
- **First device build on a new Mac (signing):** add the Apple ID for team `GP2M7H6R3U`
  in Xcode → Settings → Accounts (Admin on the paid "Developer Team"), then build to the
  device with automatic signing — Xcode creates the Apple Development cert + profile on
  first build. Gotcha: a **pending Apple Developer Program License Agreement** blocks
  provisioning and shows up as "No profiles for 'com.psford.roadtripmap.native'" /
  "Failed to load provisioned devices" — accept it at developer.apple.com/account. On the
  phone, trust the dev cert under Settings → General → VPN & Device Management.
- Azure **dev slot** provisioned (design AC7) — until then, point at prod or a local backend
  reachable from the device.
- Build/install the **Release-TestFlight** configuration (targets the dev slot via the
  `DEVSLOT` flag → `APIEnvironment.defaultBaseURL`). For ad-hoc, the `API_BASE_URL` env var
  overrides on the simulator (not on-device).

---

## 1. Map & pin feel (new — `MKMapView` bridge, only testable on device)
- [ ] **Pinch-zoom** and rotate work with real fingers (simulator needs Option+drag; device should be natural).
- [ ] **Long-press the trip map** → "Post Here" sheet → choose a photo → pin lands at the long-pressed spot.
- [ ] **Drag the pin** in the picker (`PinDropView`) feels smooth; map still pans/zooms around it.
- [ ] **Move Pin** on a committed photo (popup → ⋯ → Move Pin) → drag → Confirm → pin moves; place name updates.
- [ ] **No-GPS photo** → "Where was this taken?" → long-press to drop + drag → "Pin & Upload" → uploads.
- [ ] Pin taps still open the photo popup (long-press gesture didn't steal taps).
- [ ] **Popup ⋯/✕ chrome** — controls render in a header bar on the card, legible over any photo, no overlap with the map compass.
- [ ] **Popup swipe-down** — swipe the card down past ~120pt to dismiss; below the threshold springs back. Horizontal swipes still page between photos. If the gesture feels bad, fall back to ✕ button or backdrop tap.

## 2. Photo capture (sim-confirmed; spot-check on device)
- [ ] HEIC photo from the camera roll uploads as JPEG with correct location/date.
- [ ] Limited Photo Library permission still works for selected photos.

## 3. Upload resilience — background `URLSession` (built, Slice B.2; replaces the old foreground path)
All uploads now run through `BackgroundUploadSession` (one `.background` session, file-based
block `uploadTask`s, delegate-driven). The async/foreground `UploadCoordinator` + `beginBackgroundTask`
grace are gone. The banner (ValueObservation) and Retry still surface progress/failures.
- [ ] Happy path against the dev slot: pick → progress banner → pin appears (commit + revalidate).
- [ ] Transient network blip (toggle Wi-Fi) → block retries with backoff, upload still completes.
- [ ] Force a failure (e.g. bad token) → banner shows **Retry**; tapping retries successfully; **X** dismisses (row + staged + block files deleted).

## 4. Upload survival — Slice B.2 (BUILT; verify on device — simulator can't prove force-quit survival)
- [ ] **Background** the app mid-upload (multi-block photo) → upload continues; reopen → it's done / progressed (AC3.1).
- [ ] **Force-quit** mid-upload → relaunch → `RoadTripApp.init` reconcile re-enqueues missing blocks and finishes (AC3.2).
      Already-accepted blocks are NOT re-uploaded (check `completedBlockIndices` persistence).
- [ ] **Airplane mode** on mid-upload → re-enable → queued upload resumes and commits.
- [ ] Long-queued upload (>1.75h, or temporarily lower `SASRefresher.refreshAfterSeconds`) → SAS refresh path runs on resume.

## 4a. Poor-service capture — optimistic pin + deferred upload (the headline B.2 ask)
- [ ] **No service from the start** (airplane mode / dead zone) → add a GPS photo → an **optimistic pin + filmstrip thumbnail appear immediately** (translucent, upload badge); NO "couldn't reach server" failure and NO stuck progress banner.
- [ ] **Tapping the optimistic photo** (pin or filmstrip) opens it in the popup like a posted one — the real photo shows (loaded from the local file), swipes among the others; only the upload badge differs. Move Pin / Delete are hidden until it commits.
- [ ] **Re-enable service** (or drive back into coverage) → the pending upload **starts on its own** (`NWPathMonitor` → `reconcile()`), commits, and the optimistic pin is replaced by the committed pin (no duplicate).
- [ ] **Force-quit while still offline** → relaunch (still offline) → optimistic pin is still there; regain service → it uploads.
- [ ] A genuine failure (bad token, server 4xx/5xx) still shows the **Retry** banner (only no-connectivity waits).

> Note: to exercise multi-block paths, a few-MB photo is usually a single 4 MB block. Use a
> large/burst photo (or temporarily shrink `maxBlockSizeBytes` server-side) to get ≥2 blocks
> so force-quit-resume actually has remaining blocks to re-enqueue.

## 5. Trip sharing (new — Phase 3 AC3)
- [ ] **Share button** appears in the toolbar on an owned trip (one with a secret token).
- [ ] **Share view link**: tapping "Share view link" opens the system share sheet; the link is the absolute URL to the read-only web view (e.g., `https://app-roadtripmap-prod-dev.azurewebsites.net/trips/{viewToken}`).
- [ ] **Web view page** opens on a device WITHOUT the app installed (web browser or another app); shows the trip's name and read-only pins without requiring authentication.
- [ ] **Invite to edit**: tapping "Invite to edit" opens the system share sheet; the shared text contains the secret token (UUID) and the formatted message `"Join my Road Trip \"{name}\" — open the app → Import via Token → paste: {token}"`.
- [ ] **SampleData trips**: the Share button is absent (no secret token).

## 6. Dad's trip — Prod→Dev migration (Phase 4 AC5)

> Migration done 2026-06-19: prod trip "Ford 2026 xcountry" (slug `ford-2026-xcountry`) copied into
> the dev slot as trip Id **105** with **120 photos** (all `legacy`/`committed`), tokens preserved
> verbatim. 360 blobs (original/display/thumb) copied `road-trip-photos` → `road-trip-photos-dev`.
> Verified: dev-slot endpoint serves all 3 sizes as JPEG 200. Import uses the **secret** token
> (the `a952bd97…` value Patrick had is the *view* token); grab the secret via the prod app's
> "Invite to edit" share.

- [ ] **Dad's trip import**: on a fresh install of the dev-slot (Release-TestFlight) build, Import via Token using Dad's **secret** token → the trip imports with all 120 photos pinned (AC5.3).
- [ ] **Photos render** on the map and in the popup (served from `road-trip-photos-dev`).
- [ ] **Write access** works: add a test photo, confirm it commits, then remove it.

## 7. Route curve feel (new — Phase 1 AC1.4, device-only)
- [ ] **AC1.4 (device):** On a real device, with a trip of clustered/irregular photo points, confirm the route curve looks smooth and playful and does NOT loop or overshoot. Toggle the route off/on and confirm it hides/shows. Confirm Apple Maps POIs remain visible (AC1.6).

## 8. TestFlight — Phase 8 (NOT BUILT YET)
- [ ] App Store Connect record for `com.psford.roadtripmap.native`.
- [ ] `PrivacyInfo.xcprivacy` (photo library, network, no tracking, no third-party SDKs).
- [ ] Archive **Release-TestFlight** → upload via `xcrun altool`/`notarytool` → processed without rejection.
- [ ] Patrick + dad enrolled as internal testers; build installs on both iPhones.
- [ ] End-to-end on device: create trip → upload real photo → pin on map → open share link in Safari (the .NET view page still serves).

## 9. Camera capture (Phase 4)
- [ ] **AC3.2/AC3.3 (device):** Take Photo → with Location allowed, the photo stages and uploads tagged with the current coordinate (pin appears at your location).
- [ ] **AC3.4 (device):** Take Photo with Location denied (or no fix) → the pin-drop sheet appears; setting a pin stages/uploads the capture; nothing is lost; no crash.
- [ ] **AC3.1/AC3.5 (device):** The `+` menu shows Take Photo + Choose from Library; library selection still stages as before.

## 10. Floating top bar (Phase 5)
- [ ] **AC4.1 (device):** Trip detail shows ONE floating inset bar over the map: back (left), trip name left-justified, then Share + +. Side margins look right; rounded; `.regularMaterial` legible over varied map content.
- [ ] **Safe area:** the bar clears the notch/Dynamic Island and is not clipped; the route-toggle overlay (Phase 1) and map controls don't collide with it.
- [ ] **AC4.2 (device):** Back returns to My Trips; Share hidden for SampleData (no secret token), shown for owned trips.
