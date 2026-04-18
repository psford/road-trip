# Phase 5 Architectural Decisions

**Decisions finalized on:** 2026-04-18 (Team ID deferred pending Apple Developer Program propagation — see Decision 3).

These values parameterize every reference in `phase_05.md` and `ios-mac-handoff.md`. When a placeholder like `<bundle-id>` appears in those docs, its value is defined here.

---

## 1. Repo layout — **subdirectory**

The iOS app lives under `ios/` inside the existing `road-trip` repository, not as a separate `road-trip-ios` repo.

- **Why:** single PR per feature (web and iOS changes land together); shared `wwwroot/js/*.js` modules are colocated with the iOS bootstrap that fetches them; one CI pipeline; one-developer team doesn't benefit from the repo split.
- **Cost accepted:** a Mac clone pulls the .NET backend and Bicep infra it won't build. Small fixed cost, not a recurring one.

## 2. Bundle Identifier — **`com.psford.roadtripmap`**

- Reverse-DNS under Patrick's `psford.com` domain.
- Matches the project's existing `com.psford.*` convention.
- Must be registered letter-for-letter in developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → App IDs before Task 10 on the Mac.

## 3. Apple Developer Team ID — **TBD**

- Apple Developer Program renewal paid 2026-04-18; propagation to developer.apple.com and App Store Connect not yet complete at time of writing.
- Fill this value in once the portal shows the paid team (typically <24h, sometimes up to 48h).
- Patrick pulls the Team ID from: developer.apple.com → Account → Membership details → Team ID (10 alphanumeric chars, e.g. `AB12CD34EF`).
- **Blocks:** Task 10 (TestFlight signing). Does NOT block Tasks 3–9 and 12.

## 4. TestFlight internal testers — **Patrick only, Phase 5**

- Apple ID used: `patrick_ford@me.com`.
- As the Developer Program Account Holder, Patrick is auto-granted access to any internal build and does **not** need to be added manually to the Internal Testing group — but the Apple ID is captured here for later phases and for any reference in the handoff doc.
- Additional testers join in Phase 6 or 7 as background-upload and native-EXIF work mature.

## 5. Bundle hosting URL — **`https://roadtripmap.azurewebsites.net/bundle/`**

- Served by the existing App Service via static-file middleware (configured in Task 4).
- No CDN for Phase 5 — global edge caching would add operational surface without measurable benefit while the app is one-developer-one-tester.
- If bandwidth becomes an issue, Phase 6 moves to Azure Front Door or a CDN profile; no client changes required (the bootstrap loader is URL-agnostic).

## 6. iOS deployment target — **iOS 16**

- **Floor rationale:**
  - HEIC support: iOS 11 (not a constraint).
  - `URLSessionConfiguration.background` stable behavior: iOS 13+.
  - PHPicker (Phase 6 native photo picker): iOS 14+.
  - Privacy manifests (App Store requirement as of 2024): easier on iOS 17, but iOS 16 apps still build and submit fine.
- iOS 16 is current-minus-three and excludes ~0% of target users (iPhone-8-era and older are already off trip-photo sharing).
- Locks out no Phase 6 or Phase 7 native API we plan to use.

## 7. iOS package manager — **Swift Package Manager (SPM)**

- Capacitor 8 default. Not a real user-facing decision — recorded here to preempt any stale CocoaPods references in older docs, and to anchor the Task 0 revisions applied on 2026-04-18.
- **No Podfile anywhere in this repo.**

## 8. Feature branch — **`feat/resilient-uploads-phase5`**

- Consistent with existing `feat/resilient-uploads-phase2` naming.
- Branches off `develop` per the project's Git Flow (develop → PR → main).

---

## Fill-in checklist (apply when Apple propagates)

When the developer portal shows Patrick's renewed membership:

- [ ] Replace `<apple-team-id>` in `ios-mac-handoff.md` Section 10 with the real Team ID.
- [ ] Register App ID `com.psford.roadtripmap` under developer.apple.com → Identifiers.
- [ ] Register Patrick's iPhone UDID under developer.apple.com → Devices (for non-TestFlight dev builds).
- [ ] Create the App Store Connect record for `Road Trip Map` bound to that App ID.
- [ ] Update this file's Decision 3 to replace TBD with the actual Team ID and strike the "Fill-in checklist" section.
- [ ] Commit: `docs(ios): fill in Team ID after Apple propagation`.
