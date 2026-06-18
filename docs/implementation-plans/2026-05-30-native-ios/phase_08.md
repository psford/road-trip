# Native iOS — Phase 8: TestFlight Release Pipeline Implementation Plan

**Goal:** First TestFlight build accepted by Apple, installed on Patrick's iPhone (primary tester), full offline-Capture→Reconnect→Upload→Pin loop working on a real device against the dev slot. The pipeline supports adding ≥1 more internal tester (Patrick's dad, optional).

**Architecture:** A `PrivacyInfo.xcprivacy` manifest (photo library + network, no tracking, no third-party SDKs) and Info.plist usage strings ship in the app target. A `Release-TestFlight` build configuration points the client at the **dev slot** (per Patrick's Phase-1 decision) while `Release-Prod` points at prod, both distinct from `Debug`. Archive + upload is documented as a runbook and performed on the Mac via `xcodebuild archive` + App Store Connect upload; App Store Connect web steps (app record, tester invites) are Patrick's actions.

**Tech Stack:** Xcode `xcodebuild archive`/`-exportArchive`, App Store Connect API key (issuer id + key id + .p8) for upload, `PrivacyInfo.xcprivacy`, TestFlight internal testing, XcodeGen multi-config.

**Scope:** Phase 8 of 8 (final).

**Codebase verified:** 2026-06-18.

---

## Verified facts grounding this phase

- Bundle id `com.psford.roadtripmap.native`, team `GP2M7H6R3U`, installs side-by-side with the Capacitor app (`com.psford.roadtripmap`).
- **Upload tooling (research, 2026):** `xcrun altool --upload-app` is **still supported** for TestFlight uploads (the deprecation was the notarization service, not app upload). The modern recommended path is `xcodebuild -exportArchive` with an export options plist using **App Store Connect API key** auth (issuer id + key id + .p8), or Transporter. Document BOTH; prefer the App Store Connect API key flow for CLI.
- **`PrivacyInfo.xcprivacy` (required for TestFlight since iOS 17):** declare `NSPrivacyTracking = false`, empty `NSPrivacyTrackingDomains`, `NSPrivacyCollectedDataTypes` for photos (collected, not linked, not for tracking — the app uploads user photos to the user's own trip), and `NSPrivacyAccessedAPITypes` with required-reason API entries the app actually uses: **File timestamp** (`NSPrivacyAccessedAPICategoryFileTimestamp`, reason `C617.1` or `0A2A.1`), **User defaults** (`NSPrivacyAccessedAPICategoryUserDefaults`, reason `CA92.1`) if used, **Disk space** if checked. No third-party SDKs (GRDB is a Swift package compiled in, not a tracking SDK; it requires no privacy declaration but confirm).
- **Info.plist usage strings** (synthesized via XcodeGen `info: properties:`): `NSPhotoLibraryUsageDescription`, `NSLocationWhenInUseUsageDescription` (added Phase 1/5; confirm present). Add `NSPhotoLibraryAddUsageDescription` for the viewer "Save to Photos" action (Phase 7).
- **First build review:** a NEW bundle id's first TestFlight build undergoes 24–48h "first build review" even for internal testing; subsequent builds install immediately. Patrick must expect this.
- The dev slot (Phase 1) is the backend the TestFlight build talks to; the read-only `/trips/{viewToken}` web page stays in .NET and must still serve (verify in Safari).
- Background `URLSession` requires the app to have run at least once; the `UIBackgroundModes` may need no entry for background URLSession (it's allowed without the `fetch`/`processing` modes) — confirm no extra entitlement is needed (background URLSession does not require the Background Modes capability).

---

## Acceptance Criteria Coverage

### native-ios.AC6: TestFlight distribution
- **native-ios.AC6.1 Success:** Archive uploaded via `xcrun altool` (or API-key export) is processed by App Store Connect without rejection
- **native-ios.AC6.2 Success:** Patrick added as internal tester, receives install link, build installs on his iPhone; the tester group supports adding ≥1 more (dad optional)
- **native-ios.AC6.3 Success:** `PrivacyInfo.xcprivacy` declares Photo Library access, network access, no tracking, no third-party SDKs
- **native-ios.AC6.4 Failure:** App Store Connect rejection → error documented, fix iterated, not blocked on full App Store review (internal testing only)

**Environment:** **Mac** (archive + upload); Patrick performs App Store Connect web steps + installs on his iPhone.

---

<!-- START_TASK_1 -->
### Task 1: `PrivacyInfo.xcprivacy` privacy manifest + Info.plist usage strings

**Verifies:** native-ios.AC6.3

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Resources/PrivacyInfo.xcprivacy`
- Modify: `ios-swift/RoadTrip/project.yml` (include the manifest in the app target's resources; ensure `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSLocationWhenInUseUsageDescription` in synthesized Info.plist via `info: properties:`)

**Implementation:**
- `PrivacyInfo.xcprivacy` (plist) with:
  ```xml
  <dict>
    <key>NSPrivacyTracking</key><false/>
    <key>NSPrivacyTrackingDomains</key><array/>
    <key>NSPrivacyCollectedDataTypes</key>
    <array>
      <dict>
        <key>NSPrivacyCollectedDataType</key><string>NSPrivacyCollectedDataTypePhotosorVideos</string>
        <key>NSPrivacyCollectedDataTypeLinked</key><false/>
        <key>NSPrivacyCollectedDataTypeTracking</key><false/>
        <key>NSPrivacyCollectedDataTypePurposes</key>
        <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
      </dict>
    </array>
    <key>NSPrivacyAccessedAPITypes</key>
    <array>
      <dict>
        <key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
        <key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array>
      </dict>
      <!-- add UserDefaults (CA92.1) only if the app reads/writes UserDefaults -->
    </array>
  </dict>
  ```
  Audit the actual code before finalizing the `NSPrivacyAccessedAPITypes` list — declare ONLY the required-reason APIs the app uses (file timestamp from PhotoKit/file ops is likely; UserDefaults only if used; disk space only if checked). Over-declaring is harmless; under-declaring causes rejection.
- Confirm the three usage-description strings are present in the synthesized Info.plist for the app target (Photo Library read, Photo Library add, Location when-in-use).

**Verification (Mac):**
```bash
cd ios-swift/RoadTrip && xcodegen generate && xcodebuild -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' build
# confirm the manifest is bundled:
# (after build) find the .app and check PrivacyInfo.xcprivacy + Info.plist keys present
```
Expected: builds; manifest + usage strings present in the built `.app`. Full validation is Apple's processing in Task 3 (native-ios.AC6.3).

**Commit:** `feat(ios): PrivacyInfo.xcprivacy + Photo/Location usage strings (native-ios.AC6.3)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Release build configurations (Debug / Release-TestFlight=dev slot / Release-Prod)

**Verifies:** foundation for native-ios.AC6.1 (archive config)

**Files:**
- Create: `ios-swift/RoadTrip/Config/Release-TestFlight.xcconfig`
- Modify: `ios-swift/RoadTrip/Config/Release.xcconfig` → rename/clarify as `Release-Prod` (or keep `Release` = prod and add `Release-TestFlight`)
- Modify: `ios-swift/RoadTrip/project.yml` (declare the configurations + map xcconfigs; the archive scheme uses `Release-TestFlight`)

**Implementation:**
- Three configs: `Debug` (dev slot, from Phase 1), `Release-TestFlight` (**dev slot** — per Patrick's Phase-1 decision, TestFlight testers exercise dev infra, not prod trips), `Release-Prod` (prod, for the eventual cutover). Each sets `API_BASE_URL` accordingly (reuse the `https:/$()/host` xcconfig escaping from Phase 1).
- In `project.yml`, declare the configs under `configs:` and wire each target's `configFiles:`. Add/confirm a scheme whose Archive action uses `Release-TestFlight`.
- Bump `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` policy: document that each TestFlight upload needs a unique build number (`CURRENT_PROJECT_VERSION`); the runbook (Task 4) covers bumping it.

**Verification (Mac):**
```bash
cd ios-swift/RoadTrip && xcodegen generate
xcodebuild -scheme RoadTrip -configuration Release-TestFlight -destination 'generic/platform=iOS' archive -archivePath build/RoadTrip.xcarchive
```
Expected: archives successfully; the archived app's base URL is the dev slot (log/inspect). 

**Commit:** `feat(ios): Debug/Release-TestFlight(dev slot)/Release-Prod build configs`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Archive + upload to App Store Connect (first build)

**Verifies:** native-ios.AC6.1, native-ios.AC6.4

**Files:**
- Create: `ios-swift/RoadTrip/ExportOptions.plist` (App Store distribution export options)
- (Patrick action, documented in Task 4 runbook): App Store Connect app record for `com.psford.roadtripmap.native`; App Store Connect API key (.p8 + issuer id + key id)

**Implementation:**
- `ExportOptions.plist`: `method = app-store-connect` (or `app-store` for older Xcode), `teamID = GP2M7H6R3U`, `uploadSymbols = true`, automatic signing.
- Upload via App Store Connect API key (CLI, on Mac):
  ```bash
  xcodebuild -exportArchive -archivePath build/RoadTrip.xcarchive \
    -exportOptionsPlist ios-swift/RoadTrip/ExportOptions.plist \
    -exportPath build/export \
    -authenticationKeyPath ~/private_keys/AuthKey_XXXX.p8 \
    -authenticationKeyID <KEY_ID> -authenticationKeyIssuerID <ISSUER_ID>
  ```
  or the `xcrun altool --upload-app -f build/export/RoadTrip.ipa --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>` fallback. Document both in the runbook.
- **App Store metadata stubs** (Patrick, in App Store Connect web): placeholder name/description/icon sufficient for internal TestFlight (no public submission).
- **native-ios.AC6.4 handling:** if App Store Connect rejects the upload/processing, capture the exact rejection reason, fix (commonly: missing privacy manifest entry, missing usage string, invalid icon, bundle-id mismatch), bump build number, re-upload. Document each rejection + fix in the runbook. NOT blocked on full public App Store review — internal testing only.

**Verification (Mac, native-ios.AC6.1):** the export + upload command completes; the build appears in App Store Connect and finishes "Processing" without rejection. (First build also triggers the 24–48h first-build review before testers can install — that's native-ios.AC6.2 timing, not native-ios.AC6.1.)

**Commit:** `chore(ios): ExportOptions.plist + archive/upload tooling`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: TestFlight runbook + internal tester invite + on-device end-to-end sign-off

**Verifies:** native-ios.AC6.2, and the design's final end-to-end "Done when"

**Files:**
- Create: `docs/runbooks/testflight-release.md`

**Implementation:**
- Write `docs/runbooks/testflight-release.md` capturing the full repeatable flow (so future releases don't re-derive it):
  1. Bump `CURRENT_PROJECT_VERSION` (unique per upload) in `project.yml`.
  2. `xcodegen generate`.
  3. `xcodebuild -scheme RoadTrip -configuration Release-TestFlight ... archive`.
  4. `xcodebuild -exportArchive ...` with the App Store Connect API key (issuer/key/.p8 locations).
  5. Verify in App Store Connect: build processed, no rejection (native-ios.AC6.1); on first build, wait for first-build review (24–48h).
  6. Add Patrick to the **internal** TestFlight group; note the group supports adding ≥1 more tester (dad optional) (native-ios.AC6.2).
  7. Patrick installs via the TestFlight link on his iPhone.
- Include a troubleshooting section seeded with native-ios.AC6.4 (rejection → fix → re-upload), the build-number bump requirement, and the "background URLSession needs no Background Modes capability" note.
- Document that TestFlight builds point at the **dev slot** (Release-TestFlight config), so testers' uploads/deletes never touch prod trips.

**Verification (Patrick + device, the design's final sign-off):**
- native-ios.AC6.2: Patrick receives the TestFlight invite and the build installs on his physical iPhone (after first-build review).
- **End-to-end on device:** create a test trip → capture a photo **offline** → watch it upload on reconnect → see the pin on the map → open the share link in Safari (verifying the .NET `/trips/{viewToken}` view page still serves). Screenshot each step. This is the cumulative proof of native-ios.AC7.4 + the offline-first headline feature on real hardware.

**Commit:** `docs(ios): TestFlight release runbook (native-ios native-ios.AC6.2)`
<!-- END_TASK_4 -->

---

## Phase Done When
The build uploaded to App Store Connect is processed without rejection (native-ios.AC6.1); the `PrivacyInfo.xcprivacy` correctly declares photo-library + network access, no tracking, no third-party SDKs (native-ios.AC6.3); any rejection is documented + iterated, not blocked on public review (native-ios.AC6.4); Patrick installs the TestFlight build on his physical iPhone and the internal group supports adding ≥1 more tester (native-ios.AC6.2). End-to-end on device against the dev slot: create a trip, capture a photo offline, watch it upload on reconnect, see the pin, and open the share link in Safari (the .NET view page still serves). **Verified on Patrick's real iPhone with screenshots.**

---

## Cross-cutting reminders for the executor (all phases)
- **Container vs Mac:** design/porting/Bicep/workflow authoring happens in the Linux container; **every Swift build/run/screenshot happens on the Mac** (no Xcode in the container). Nothing is "done" until seen running on a simulator/device (screenshot) — per the design's process constraint and the `show-dont-claim-app-works` rule.
- **Simulator name:** every `xcodebuild -destination 'platform=iOS Simulator,name=iPhone 17'` in these phases is illustrative — substitute any iPhone simulator runtime actually installed on the Mac (e.g. `xcrun simctl list devices` to pick one). Don't fail a task just because that exact device name isn't present.
- **Git flow:** work on `feat/native-ios` (or per-phase feature branches → PR → `develop`, regular merge commits, never squash). NEVER merge to `main`, NEVER run `deploy.yml`/`deploy-dev.yml`, NEVER run `npx cap sync`/Xcode archive-to-prod — those are Patrick's actions. Claude opens PRs and gets CI green only.
- **LogSanitizer convention:** never log raw secret tokens, SAS URLs, blob paths, or GPS (code-review check).
- **Idempotency:** any `@Observable` `start()`/observation setup must be safe to call repeatedly (SwiftUI re-invokes lifecycle) — guard with an `_installed`/`_observing` flag, mirroring the web's hard-won idempotency lesson.
