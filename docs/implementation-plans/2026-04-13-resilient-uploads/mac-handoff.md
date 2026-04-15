# Mac Handoff — Resilient Uploads Phases 2–7

Continuation guide for executing Phases 2–7 on a Mac after Phase 1 has landed on `main`.

**Status (2026-04-14, updated after deploy):**
- Phase 1 is merged (PRs #37, #38, #39, #40) and **deployed to prod**.
- `app-roadtripmap-prod` is serving `roadtripmap:prod-33`; `/api/version` returns `1.0.0` with headers.
- EF migration `AddUploadStatusColumns` is applied to `roadtripmap-db`.
- Storage Blob Data Contributor role granted to the App Service MSI on the shared `stockanalyzerblob` account.
- 39 per-trip containers (`trip-*`) were backfilled; `Backfill__RunOnStartup` is cleared.
- `main.bicep` is the faithful source of truth; `what-if` against prod shows no functional drift.
- Project docs (CLAUDE.md, TECHNICAL_SPEC 3.0, FUNCTIONAL_SPEC) are current as of merge of PR #39.

## Why a Mac

- Phase 5 introduces a Capacitor iOS shell. `npx cap sync ios` and Xcode builds run on macOS only.
- Phase 6 adds custom Swift plugins (`UploadTransport.swift`, `NativeExif.swift`). Xcode compiles them.
- Phase 7 is a TestFlight rollout — requires Xcode + Apple developer signing.

Phases 2–4 are web-only (plain JS + C#) and could in principle be done on WSL, but keeping them with Phases 5–7 on the Mac avoids reshaping the plan and keeps the bundle/build chain in one place.

## Prerequisites on the Mac

```
brew install dotnet@8                  # .NET 8 SDK
brew install docker                    # for Azurite-backed tests; Docker Desktop is fine too
brew install sqlcmd                    # optional, for local DB verification
brew install node                      # for esbuild in Phase 5
brew install azure-cli                 # for prod verification steps
xcode-select --install                 # command-line tools
# Xcode from the App Store (Phase 5+)
# Apple Developer signing certificate provisioned
```

Clone and bootstrap:

```
cd ~/projects
git clone git@github.com:psford/road-trip.git
cd road-trip
git checkout main
git pull --ff-only
```

Phase 1 is already merged — there's no outstanding branch to check out. Start Phase 2 directly off `main`.

Claude-env bootstrap is not strictly required on Mac (no WSL2 isolation needed), but the hooks and helpers under `claude-env` should be cloned to `~/projects/claude-env/` so the spec-staleness guard, endpoint registry guard, azure SP identity guard, etc. still fire during Phase 2 work. If the hooks aren't wired, the Mac session loses the guardrails that caught the docs drift on this Phase 1.

## Starting Phase 2 execution

Prereq: Phase 1 merged (it is). Create a feature branch off `main` and execute:

```
git checkout -b feat/resilient-uploads-phase2
/ed3d-plan-and-execute:execute-implementation-plan
  <absolute-path-to>/docs/implementation-plans/2026-04-13-resilient-uploads/
  <absolute-path-to>/
```

The skill will load `phase_02.md` and dispatch subagents for each subcomponent. Mac-specific notes for each remaining phase follow.

## Phase 2 — Web upload state machine & transport

Pure .NET + vanilla JS. No Mac-specific concerns beyond:

- IndexedDB tests use Playwright; `npx playwright install` on first run.
- Service-worker registration (if added) is the same on Mac/Windows; test via `safari-web-driver` in addition to Chromium.

## Phase 3 — Web UI

Same as Phase 2. The "Progress panel" map-marker work uses MapLibre GL JS — library already pinned in `package.json` or loaded via CDN (check `wwwroot/index.html`).

## Phase 4 — Web stabilization

- Playwright network simulation uses `route.fulfill` with synthetic delays.
- The acceptance document goes to `docs/acceptance/2026-04-14-resilient-uploads-web.md` (adjust date).

## Phase 5 — Capacitor shell

```
cd ~/projects/road-trip
npm install @capacitor/core @capacitor/ios @capacitor/cli
npx cap init road-trip com.psford.roadtrip
npx cap add ios
```

Bundle bootstrap lives at `src/bootstrap/`. The esbuild step concatenates `wwwroot/js/*.js` into a single `bundle.js` served under `/bundle/*`. The iOS WebView fetches this on first run and caches it in IndexedDB.

- Set `App Service` to serve `/bundle/*` via existing static-file middleware (or add a new endpoint). Hash-named assets for cache-busting.
- Run `npx cap sync ios` after every JS/CSS change. Commit `ios/` too so CI can detect drift.
- **DON'T** commit `ios/App/Pods/` or `ios/App/App.xcworkspace/xcuserdata/` — add to `.gitignore` if not already.

## Phase 6 — Swift plugins

Live under `ios/App/App/Plugins/`:

- `UploadTransport.swift` — wraps `URLSession` background configuration for upload-continuation-while-backgrounded.
- `NativeExif.swift` — reads EXIF via `ImageIO.CGImageSourceCopyPropertiesAtIndex`.

Plugin bridge (`Plugin.swift`) registers both with `CAPPlugin`. Capacitor's codegen:

```
cd ios/App
pod install                             # if CocoaPods is in the project
xcodebuild -workspace App.xcworkspace -scheme App -destination 'platform=iOS Simulator,name=iPhone 15' build
```

JS-side seams from Phase 5 (`transport-adapter.js`, `exif-adapter.js`) check `Capacitor.isNativePlatform()` and delegate to `Capacitor.Plugins.UploadTransport` / `NativeExif`.

## Phase 7 — TestFlight rollout

- Bump `CFBundleVersion` and `CFBundleShortVersionString` in `ios/App/App/Info.plist`.
- Archive: `Product > Archive` in Xcode.
- Distribute: `Window > Organizer > Distribute App > App Store Connect`.
- TestFlight build processing takes ~15 minutes; invite Patrick's tester account from App Store Connect.

Acceptance doc goes to `docs/acceptance/2026-04-XX-resilient-uploads-ios.md`.

## Environment variables on the Mac

These are NOT set in claude-env's `.env` template; either plumb them locally via shell profile or a per-project `.env` (gitignored):

```
export WSL_SQL_CONNECTION='Server=<local-dev-sql>;Database=RoadTripMap;...'
export RT_DESIGN_CONNECTION='<admin variant of above>'
export NPS_API_KEY='<from azure keyvault>'
```

For Azurite, the Phase 1 fixture already bakes in the well-known `devstoreaccount1` credentials — no extra env vars needed.

## What Phase 1 left on the table

See `overnight-report.md` and `deployment-log-2026-04-14.md` for the full trail. Carry-over to Phase 2+:

- `Status='failed'` client→server write path (Phase 2 concern — client sets row to failed after retry exhaustion; `OrphanSweeper` already filters to `status='pending'` only, so no follow-on change needed there).
- Full HTTP round-trip test of `PhotoServingEndpoint` fetching a per-trip photo via the API proxy (the storage-tier branch is code-verified in `PhotoService` and service-layer tested, but there is no WebApplicationFactory test that GETs `/api/photos/{tripId}/{photoId}/{size}` for a per-trip blob and asserts the bytes).
- Optional: wire EF migration + Bicep `what-if`/apply steps into `deploy.yml` so Phase 1-style manual runbook steps aren't repeated for every future migration or infra change.

## Runbook location

`docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md` — every step labeled by shell ([bash/WSL], [bash/Mac], [Azure Portal], [GitHub web]). Some steps currently say `[bash/WSL]` but work identically on Mac bash; update in place as you execute.

## Contact / context

- Phase 1 PRs: [#37](https://github.com/psford/road-trip/pull/37) (implementation), [#38](https://github.com/psford/road-trip/pull/38) (Bicep reconcile), [#39](https://github.com/psford/road-trip/pull/39) (docs refresh), [#40](https://github.com/psford/road-trip/pull/40) (settings pin) — all merged.
- Plan directory: `docs/implementation-plans/2026-04-13-resilient-uploads/`
  - `phase_01.md`–`phase_07.md` — per-phase implementation plans
  - `test-requirements.md` — acceptance-criteria test map
  - `deployment-runbook.md` — Phase 1 prod deploy playbook (followed 2026-04-14)
  - `deployment-log-2026-04-14.md` — filled-in execution log for the Phase 1 deploy
  - `overnight-report.md` — narrative of the autonomous Phase 1 implementation session
- Design: `docs/design-plans/2026-04-13-resilient-uploads.md`
- Tech reference: `docs/TECHNICAL_SPEC.md` v3.0 (current as of 2026-04-14)
- Prod infra reference in memory: `reference_roadtrip_prod_infra` (cross-RG topology, principal IDs, deploy pipeline)
