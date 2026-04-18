# Phase 5 — Resume Point

Written 2026-04-18. Work paused before any Phase 5 task dispatched. No code changes made in this session.

## Why paused

User is setting up a new Mac and Apple developer environment (Xcode, CocoaPods, signing cert, App Store Connect). That scaffolding belongs outside this repo. Phase 5 needs some of it (Tasks 5 step 5, 10, 11) before it can finish.

## Current repo state

- Branch: `develop` (clean, tracking `origin/develop`).
- Phases 1–4 of `2026-04-13-resilient-uploads` are merged; feature flag removed (`c54d092`).
- The separate `2026-04-16-oversize-image-compression` plan (4 phases, client-side processing) is also shipped.
- No Capacitor scaffolding exists yet. `ios/` directory does not exist. `package.json` has no Capacitor deps.

## Environment mapping

This dev container is Linux on Docker Desktop (macOS host). Mapping the plan's shell labels to reality:

| Plan label | Runs in this container? | Notes |
|---|---|---|
| `[WSL]` | Yes | Node, .NET, bash, tests, git all present. Treat `[WSL]` as this container. |
| `[Mac — Terminal]` | No | Needs host Mac shell (CocoaPods, `pod install`). |
| `[Mac — Xcode]` | No | Needs Xcode on host. Signing, archive, simulator, device. |

## Task execution split for Phase 5

See `phase_05.md` for full details. Task numbers here match the `### Task N:` headings (note: the `<!-- START_TASK_0 -->` marker corresponds to `### Task 1:` — task markers are 0-indexed, task headings are 1-indexed).

Runnable in this container:
- Task 1 — Create `ios-mac-handoff.md` (NOTE: `mac-handoff.md` already exists and covers Phases 2–7 generally; Task 1's doc is iOS-session-specific. Confirmed both are intended to coexist.)
- Task 2 — Architectural decisions (**requires user answers; see below**)
- Task 3 — esbuild bundle script
- Task 4 — Bundle serving route + CORS
- Task 5 steps 1–4 — `npm install`, `npx cap init`, `npx cap add ios`
- Task 6 — Bootstrap loader
- Task 7 — Platform-adapter seams
- Task 8 — iOS CSS
- Task 9 — Bootstrap unit tests
- Task 12 — Deployment runbook extension

Needs host Mac Terminal (not this container):
- Task 5 step 5 — `pod install` in `ios/App/`

Needs host Mac + Xcode:
- Task 10 — TestFlight signing config + Info.plist + archive + upload
- Task 11 — Device smoke matrix on physical iPhone

## Decisions pending (Task 2)

These must be answered before Task 2 and anything downstream that depends on them. Resume session will ask again:

1. **Repo layout**: `/ios` subdir of this repo (plan recommendation) vs separate `road-trip-ios` repo.
2. **Bundle ID**: default `com.psford.roadtripmap` unless changed.
3. **Apple Developer Team ID**: from developer.apple.com membership details.
4. **TestFlight internal testers**: list of Apple IDs (default = Patrick + original reporter).
5. **Bundle hosting URL**: `https://roadtripmap.azurewebsites.net/bundle/` (App Service) vs dedicated CDN. Recommendation: App Service for Phase 5.
6. **iOS deployment target**: iOS 15 or 16 minimum (HEIC + background tasks require modern).
7. **CocoaPods in git**: plan recommends `.gitignore ios/App/Pods/` and `pod install` on each fresh Mac clone.

## Apple environment prerequisites (do these first, outside this repo)

This is the work the user is pausing Phase 5 to do. When complete, Phase 5 can run its Mac-only tasks. Minimum list to unblock Tasks 5 step 5, 10, 11:

- Xcode ≥ 15 installed from App Store. Verify: `xcodebuild -version`.
- Command Line Tools: `xcode-select --install`.
- Node 20+ on the host Mac (for `npx cap` commands run outside the container). Verify: `node -v`.
- CocoaPods: `sudo gem install cocoapods`. Verify: `pod --version`.
- Apple Developer Program active ($99/yr) — confirm at developer.apple.com.
- Apple Team ID recorded.
- Signing cert + provisioning profile set up in Xcode (Preferences → Accounts → Manage Certificates).
- `gh` CLI authenticated: `gh auth status`.
- App Store Connect app record created for Bundle ID (Apps → New App).
- Internal TestFlight tester group created with desired Apple IDs.

Once that's done, the Phase 1 of Task 1 in `phase_05.md` (the Mac handoff doc this session was about to write) becomes mostly a copy of the above plus project-specific commands.

## Command to resume

After clearing context, in this working directory (`/workspaces/road-trip/`):

```
/ed3d-plan-and-execute:execute-implementation-plan /workspaces/road-trip/docs/implementation-plans/2026-04-13-resilient-uploads/ /workspaces/road-trip/
```

Then in the opening message, tell Claude:

> Resume Phase 5. Read `/workspaces/road-trip/docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-resume.md` first. Only execute Phase 5 (Phases 1–4 are already merged to `develop`). Skip Tasks 10 and 11 — those run on the Mac host, not in this container. Ask me the Task 2 architectural decision questions before dispatching any subagents.

## Handoff note for Task 10/11 (Mac host, separately)

When ready to do the Xcode work on the Mac host:
- See `mac-handoff.md` (general) and the to-be-created `ios-mac-handoff.md` (iOS-specific).
- Pull latest on Mac, run `npm ci && npm run build:bundle && npx cap sync ios && cd ios/App && pod install && npx cap open ios`.
- Follow Task 10 (archive + upload) then Task 11 (device smoke matrix).
