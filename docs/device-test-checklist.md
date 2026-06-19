# Native iOS — Real-Device Test Checklist

Everything deferred to a single on-device pass (per Patrick: batch device testing rather
than do it piecemeal). The simulator can't validate background-session survival, true pinch,
the tactile pin drag, or TestFlight — so those wait for here.

**Prerequisites**
- A physical iPhone (Patrick's + dad's for TestFlight).
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

## 2. Photo capture (sim-confirmed; spot-check on device)
- [ ] HEIC photo from the camera roll uploads as JPEG with correct location/date.
- [ ] Limited Photo Library permission still works for selected photos.

## 3. Upload resilience — foreground + grace (built) 
- [ ] Happy path against the dev slot: pick → progress banner → pin appears.
- [ ] Background the app mid-upload briefly → it finishes (≈30s `beginBackgroundTask` grace).
- [ ] Transient network blip (toggle Wi-Fi) → block retries with backoff, upload still completes.
- [ ] Force a failure → banner shows **Retry**; tapping retries successfully.

## 4. Upload survival — Slice B.2 (NOT BUILT YET; build, then verify here)
- [ ] Force-quit mid-upload → relaunch → upload **resumes** (needs background `URLSession` +
      `handleEventsForBackgroundURLSession` + file-based block tasks).
- [ ] Long-queued upload (>1.75h, or simulated) → SAS refresh kicks in (`SASRefresher`).
- [ ] Airplane mode → re-enable → queued upload completes.

## 5. TestFlight — Phase 8 (NOT BUILT YET)
- [ ] App Store Connect record for `com.psford.roadtripmap.native`.
- [ ] `PrivacyInfo.xcprivacy` (photo library, network, no tracking, no third-party SDKs).
- [ ] Archive **Release-TestFlight** → upload via `xcrun altool`/`notarytool` → processed without rejection.
- [ ] Patrick + dad enrolled as internal testers; build installs on both iPhones.
- [ ] End-to-end on device: create trip → upload real photo → pin on map → open share link in Safari (the .NET view page still serves).
