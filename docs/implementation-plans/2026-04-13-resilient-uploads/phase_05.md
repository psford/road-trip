# Resilient Photo Uploads — Phase 5: Capacitor Shell, Bundled Bootstrap, Azure-Hosted Bundle

**Goal:** Ship a TestFlight build that loads the web UI natively via a hybrid bootstrap. iOS still uses `fetch`-based uploads (web transport) — native background uploads land in Phase 6.

**Architecture:** Capacitor iOS shell bundles a tiny loader (`src/bootstrap/`). The real app bundle (JS/CSS) is hosted by the existing App Service under `/bundle/*` and cached in IndexedDB on the device. Shared JS modules are packaged via a minimal esbuild concatenation step — no framework migration, same window-globals at runtime.

**Cross-machine sequencing:** Tasks 1–9 and 12 execute on WSL (this machine). Tasks 10–11 execute on Patrick's Mac. Every WSL task commits + pushes so the Mac can `git pull`; every Mac task commits artifacts back so WSL can resume.

**Tech Stack:** Capacitor 7.x, Swift 5.5+, Xcode ≥15, esbuild, IndexedDB.

**Scope:** Phase 5 of 7.

**Codebase verified:** 2026-04-13. No existing iOS or Capacitor work — Phase 5 is net-new.

---

## Acceptance Criteria Coverage

### resilient-uploads.AC9: Capacitor hybrid bootstrap and offline UI shell

- **resilient-uploads.AC9.1 Success:** First launch with internet fetches the web bundle from Azure, caches it in IndexedDB, and renders the trip UI.
- **resilient-uploads.AC9.2 Success:** Subsequent launch in airplane mode loads the cached bundle and renders the full trip UI.
- **resilient-uploads.AC9.3 Success:** Deploying a new web bundle to Azure is picked up on the next online launch (no TestFlight rebuild needed).
- **resilient-uploads.AC9.4 Failure:** First-ever launch with no connectivity renders the bundled `fallback.html` screen.
- **resilient-uploads.AC9.5 Edge:** A cached bundle incompatible with the current server triggers the "site updated — reload" alert before any broken API calls.

### resilient-uploads.AC10: iOS-specific CSS from Azure

- **resilient-uploads.AC10.1 Success:** On iOS, the `platform-ios` body class is set before paint; iOS-specific overrides apply without a visual flash.
- **resilient-uploads.AC10.2 Success:** Updating `ios.css` on Azure and redeploying is reflected on the next online launch.

---

## Shell Labels (Reading This Plan)

Every task lists the shell it runs in:

- **`[WSL]`** — runs on the project WSL machine. Node, .NET, bash, tests, git.
- **`[Mac — Terminal]`** — runs on Patrick's Mac in Terminal. Node, git, `npx cap` commands that don't open Xcode.
- **`[Mac — Xcode]`** — requires Xcode open (build, simulator, device, signing, Product → Archive, Transporter / `altool`).

**Hard rule:** WSL tasks MUST complete, commit, and push before any `[Mac — ...]` task begins. Mac tasks MUST commit and push artifacts (Info.plist changes, smoke test screenshots, build logs) before resuming WSL work.

---

## Notes for Implementers

- **Bundle versioning.** Server emits `FullyQualifiedBundleVersion` (e.g., `1.3.0+build.47`) into the `manifest.json` served at `/bundle/manifest.json`. The iOS loader compares cached vs manifest version; different = re-fetch.
- **Shared JS source of truth.** `wwwroot/js/*.js` remain the canonical modules. The esbuild step only concatenates — no transform, no minification initially (add minification in a later optimization pass).
- **No bundler for web path.** The web app continues to serve individual script tags. The bundle is produced ONLY for the iOS hybrid bootstrap and anyone who chooses to fetch it. This keeps Phase 2/3 web work unchanged.
- **Signing.** Automatic signing with Apple Developer Team ID per Task 10. Avoid committing `*.mobileprovision` files to git; committing Team ID + Bundle ID in `project.pbxproj` is acceptable and necessary.
- **Device-smoke artifacts.** Screenshots/video of launches should go to `docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-device-smoke.md` as markdown-embedded images (committed via git LFS if needed — configure LFS if not present).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->
## Subcomponent A: Docs and decisions (WSL)

<!-- START_TASK_0 -->
### Task 1: Create Mac handoff document

**Shell:** `[WSL]`

**Verifies:** None (enabling Mac session).

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/ios-mac-handoff.md`

**Implementation:**

This document is the Mac session's operating manual. Include:

1. **Prerequisites checklist**
   - Xcode ≥ 15 (verify: `xcodebuild -version`)
   - Command Line Tools (`xcode-select --install`)
   - Node 20+ (`node -v`)
   - CocoaPods (`sudo gem install cocoapods`, then `pod --version`)
   - Apple Developer Program enrollment (active)
   - `gh` CLI authenticated to GitHub (`gh auth status`)

2. **First-time clone + setup**
   ```bash
   git clone git@github.com:psford/road-trip.git
   cd road-trip
   git fetch origin
   git checkout <feature-branch-name>
   npm ci
   npm run build:bundle
   npx cap sync ios
   cd ios/App && pod install && cd ../..
   npx cap open ios
   ```

3. **Xcode signing config**
   - Target "App" → Signing & Capabilities.
   - Team: `<apple-team-id>` (from Task 2 decisions).
   - Bundle Identifier: `<bundle-id>` (from Task 2).
   - Automatic Signing: ON.
   - If provisioning profile errors: File → Sync → Sign in with Apple ID; ensure Developer Program role active.

4. **Simulator run**
   - In Xcode: Product → Destination → iPhone 15 (or any simulator) → Run.
   - Or CLI: `npx cap run ios --target=<simulator-name>`.

5. **Device run**
   - Plug in iPhone, trust computer.
   - Xcode → Destination → <device> → Run.
   - On device: Settings → General → VPN & Device Management → trust developer certificate.

6. **Build and archive for TestFlight**
   - Product → Archive (must target "Any iOS Device" — NOT simulator).
   - Organizer opens post-archive.
   - Distribute App → App Store Connect → Upload → automatic signing.
   - Wait for processing email (~10–15 min).

7. **TestFlight distribution**
   - appstoreconnect.apple.com → Apps → Road Trip → TestFlight tab.
   - Select the processed build.
   - Assign to internal testers list (from Task 2).

8. **Push results back to the repo**
   ```bash
   # From repo root on Mac
   git add ios/App/App.xcodeproj/project.pbxproj ios/App/App/Info.plist
   git add docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-device-smoke.md
   git commit -m "chore(ios): <summary of what this session accomplished>"
   git push
   ```

9. **Troubleshooting**
   - CocoaPods install errors → `pod repo update && pod install`.
   - Code signing error "No matching provisioning profile" → confirm Team ID matches in Xcode + Apple Developer portal.
   - Bundle load 404 → confirm App Service `/bundle/manifest.json` returns 200 in Safari.
   - White screen on launch → attach Safari Web Inspector to the device; check for bootstrap errors.
   - `pod install` fails on M1/M2 → `arch -x86_64 pod install` fallback.

**Verification:**

Doc is complete with every command the Mac user needs. Peer-review a "first time Mac user" reading: they should be able to follow it end-to-end without asking questions.

**Commit:** `docs(ios): comprehensive Mac handoff for Phase 5 iOS work`
<!-- END_TASK_0 -->

<!-- START_TASK_1 -->
### Task 2: Architectural decisions

**Shell:** `[WSL]` + Patrick consultation.

**Verifies:** None.

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-decisions.md`

**Implementation:**

Present to Patrick (in chat) and record final decisions in `phase-5-decisions.md`:

1. **Repo layout**: `/ios` subdirectory of `road-trip` vs separate `road-trip-ios` repo.
   - Subdirectory pro: single PR per feature (web + iOS together); shared `wwwroot/js` is colocated; simpler cross-ref.
   - Subdirectory con: `git clone` on the Mac pulls .NET + infra; developer may want a narrower checkout.
   - Separate-repo pro: clean separation of concerns; Mac dev can checkout just iOS.
   - Separate-repo con: bundle version coupling has to cross a repo boundary; CI pipeline harder.
   - Recommendation: subdirectory (simpler for one-developer team).

2. **Bundle ID**: e.g., `com.psford.roadtripmap`. Must match Apple Developer portal App ID.

3. **Apple Developer Team ID**: retrieved from developer.apple.com membership details.

4. **TestFlight internal testers**: list of Apple IDs. Initial = Patrick + original reporter (the tester).

5. **Bundle hosting URL**: `https://roadtripmap.azurewebsites.net/bundle/` (same App Service) or a dedicated CDN path. Recommendation: App Service for Phase 5; move to CDN if bandwidth becomes an issue.

6. **iOS deployment target**: minimum iOS version (design implies modern — iOS 15 or 16 minimum given HEIC support, background tasks).

Once Patrick signs off, the doc is committed and referenced from Task 1's handoff doc.

**Verification:**

Doc has "Decisions finalized on YYYY-MM-DD" line with each decision recorded.

**Commit:** `docs(ios): Phase 5 architectural decisions`
<!-- END_TASK_1 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->
## Subcomponent B: Shared JS bundle and serving (WSL)

<!-- START_TASK_2 -->
### Task 3: esbuild concatenation script for shared bundle

**Shell:** `[WSL]`

**Verifies:** Supports AC9.1, AC9.3, AC10.2.

**Files:**
- Modify: `package.json` (add `esbuild` devDep, `build:bundle` script)
- Create: `scripts/build-bundle.js`
- Create: `src/RoadTripMap/wwwroot/bundle/.gitkeep`
- Modify: `.gitignore` (ignore `wwwroot/bundle/*.js`, `*.css`, `manifest.json` — generated artifacts; keep `.gitkeep`)

**Implementation:**

`scripts/build-bundle.js`:
1. Read the ordered list of source files (same order as `Post.cshtml` script tags): `uploadUtils.js`, `uploadSemaphore.js`, `storageAdapter.js`, `uploadTransport.js`, `versionProtocol.js`, `uploadQueue.js`, `progressPanel.js`, `resumeBanner.js`, `optimisticPins.js`, `mapUI.js`, `postUI.js`, etc.
2. Concatenate into `wwwroot/bundle/app.js` wrapped in an IIFE `(() => { ... })()` to avoid polluting global scope — but preserve intentional globals (`UploadQueue`, `API`, `PostUI`, etc.) by explicitly attaching to `globalThis` at the end.
3. Concatenate CSS files into `wwwroot/bundle/app.css`.
4. Copy `wwwroot/ios.css` (Task 8) to `wwwroot/bundle/ios.css`.
5. Compute sha256 per file.
6. Read package version + git short SHA → write `wwwroot/bundle/manifest.json`:
   ```json
   {
     "version": "1.3.0+build.47-abc1234",
     "client_min_version": "1.0.0",
     "files": {
       "app.js": { "size": 12345, "sha256": "..." },
       "app.css": { "size": 2345, "sha256": "..." },
       "ios.css": { "size": 345, "sha256": "..." }
     }
   }
   ```

Add to `package.json` scripts: `"build:bundle": "node scripts/build-bundle.js"`.

CI: `.github/workflows/ci.yml` runs `npm run build:bundle` after `npm ci`, before `dotnet publish`, so the bundle lands in the published wwwroot.

**Verification:**

Run: `npm run build:bundle`
Expected: `wwwroot/bundle/{app.js,app.css,ios.css,manifest.json}` produced. `curl http://localhost:5000/bundle/manifest.json` returns valid JSON after `dotnet run`.

**Commit:** `feat(web): esbuild concatenation for shared JS/CSS bundle`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 4: Bundle-serving static route + CORS

**Shell:** `[WSL]`

**Verifies:** AC9.1, AC9.3, AC10.2.

**Files:**
- Modify: `src/RoadTripMap/Program.cs` (if not already serving `wwwroot/bundle/` via default static files, confirm it is)
- Modify: `infrastructure/azure/main.bicep` (extend Phase 2 blob CORS OR add an App Service CORS config for `capacitor://localhost`, `ionic://localhost`, `https://localhost`)

**Implementation:**

Minimal-API addition in `Program.cs` if custom headers needed for the iOS app origin:
```csharp
app.MapGet("/bundle/{**path}", async (HttpContext ctx, string path) =>
{
    ctx.Response.Headers["Access-Control-Allow-Origin"] = "capacitor://localhost";
    ctx.Response.Headers["Cache-Control"] = "public, max-age=300"; // short cache; loader does own cache
    await ctx.Response.SendFileAsync(Path.Combine(env.WebRootPath, "bundle", path));
});
```

(Or use `UseStaticFiles` with a CORS policy applied to the `/bundle` segment — simpler if the project already uses CORS middleware.)

Bicep: extend Phase 2 CORS rule on the storage account is NOT needed (bundle is served by App Service, not blob). Instead ensure App Service CORS allows `capacitor://localhost` and `ionic://localhost` if strict CORS is enabled. If App Service currently has no CORS restriction (common for small apps), no change needed.

**Verification:**

Run: `dotnet run`; from another terminal `curl -i -H "Origin: capacitor://localhost" http://localhost:5000/bundle/manifest.json`. Expect 200 + `Access-Control-Allow-Origin: capacitor://localhost`.

**Commit:** `feat(web): serve /bundle/* with CORS for iOS Capacitor origin`
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-8) -->
## Subcomponent C: Capacitor scaffold + bootstrap (mixed shells)

<!-- START_TASK_4 -->
### Task 5: Capacitor project scaffold

**Shell:** split — steps 1–4 on `[WSL]`; step 5 on `[Mac — Terminal]`.

**Verifies:** Enables AC9.1.

**Files:**
- Create: `capacitor.config.ts` at repo root
- Create: `package.json` updates (Capacitor deps)
- Create: `ios/` directory tree (generated by `npx cap add ios`)
- Create: `src/bootstrap/` (web_dir; contents in Task 6)

**Implementation:**

On `[WSL]` (commit + push each step):

1. `npm install --save-dev @capacitor/cli`
2. `npm install --save @capacitor/core @capacitor/ios`
3. `npx cap init "Road Trip" com.psford.roadtripmap --web-dir=src/bootstrap`
   - Edit generated `capacitor.config.ts` to set:
     ```ts
     export default {
       appId: 'com.psford.roadtripmap',
       appName: 'Road Trip',
       webDir: 'src/bootstrap',
       server: {
         iosScheme: 'capacitor',
         cleartext: false
       },
       ios: {
         contentInset: 'always'
       }
     };
     ```
4. `npx cap add ios` — this writes `ios/App/` scaffold (Xcode project, Podfile, AppDelegate.swift, Info.plist). Commit all of it.

On `[Mac — Terminal]` after WSL pushes:

5. `git pull`; `cd ios/App && pod install`. Commit `ios/App/Podfile.lock` + `ios/App/Pods/` (confirm .gitignore does NOT ignore Pods — Capacitor recommends committing them; but for team-of-one, committing them is fine). Actually, recommend adding `ios/App/Pods/` to `.gitignore` and running `pod install` on every fresh clone (per `ios-mac-handoff.md` step 2). Decision captured in `phase-5-decisions.md` (Task 2). Push.

**Verification:**

- `[WSL]`: `ls ios/App/App.xcodeproj` exists after steps 1–4.
- `[Mac — Terminal]`: `pod install` exits 0.
- `[Mac — Xcode]`: opening `ios/App/App.xcworkspace` (NOT .xcodeproj) shows the project without errors.

**Commit:** (WSL) `feat(ios): Capacitor scaffold + ios platform`; (Mac) `chore(ios): pod install lockfile`
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 6: Bundled bootstrap (src/bootstrap/)

**Shell:** `[WSL]`

**Verifies:** AC9.1, AC9.2, AC9.3, AC9.4, AC9.5, AC10.1.

**Files:**
- Create: `src/bootstrap/index.html`
- Create: `src/bootstrap/loader.js`
- Create: `src/bootstrap/fallback.html`

**Implementation:**

`src/bootstrap/index.html`:
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Road Trip</title>
  <script src="loader.js"></script>
</head>
<body>
  <div id="bootstrap-progress">Loading…</div>
  <div id="app-root"></div>
</body>
</html>
```

`src/bootstrap/loader.js` — the bootstrap protocol (AC9):

```js
const BUNDLE_URL = 'https://roadtripmap.azurewebsites.net/bundle';
const DB_NAME = 'RoadTripBundle';
const STORE = 'files';

(async function bootstrap() {
  // Set platform class before paint (AC10.1)
  document.body.classList.add('platform-ios');

  try {
    const cached = await readCache();
    let manifest;
    try {
      manifest = await fetchJson(BUNDLE_URL + '/manifest.json', 8000);
    } catch (e) {
      if (cached) return inject(cached); // offline + cached (AC9.2)
      return renderFallback();             // offline + no cache (AC9.4)
    }

    if (!cached || cached.version !== manifest.version) {
      // Fresh fetch (AC9.1, AC9.3)
      const files = await fetchAll(BUNDLE_URL, manifest);
      await writeCache({ version: manifest.version, files, client_min_version: manifest.client_min_version });
      return inject({ version: manifest.version, files });
    }

    // Version mismatch edge (AC9.5): if server's client_min_version moved forward
    if (manifest.client_min_version && cached.client_min_version &&
        compareSemver(cached.version, manifest.client_min_version) < 0) {
      alert('Site updated — reloading');
      const files = await fetchAll(BUNDLE_URL, manifest);
      await writeCache({ version: manifest.version, files, client_min_version: manifest.client_min_version });
      return inject({ version: manifest.version, files });
    }

    inject(cached);
  } catch (err) {
    console.error('Bootstrap failure', err);
    renderFallback();
  }
})();

// --- helpers (abbreviated) ---
function fetchJson(url, timeoutMs) { /* fetch with AbortSignal.timeout */ }
async function fetchAll(base, manifest) { /* fetch app.js, app.css, ios.css */ }
async function readCache() { /* IDB get */ }
async function writeCache(obj) { /* IDB put */ }
function inject({ files }) {
  // Inject CSS then JS; remove #bootstrap-progress
  const css = document.createElement('style'); css.textContent = files['app.css'] + '\n' + files['ios.css']; document.head.appendChild(css);
  const js = document.createElement('script'); js.textContent = files['app.js']; document.body.appendChild(js);
  document.getElementById('bootstrap-progress')?.remove();
}
function renderFallback() {
  fetch('fallback.html').then(r => r.text()).then(html => {
    document.body.innerHTML = html;
  });
}
function compareSemver(a, b) { /* X.Y.Z compare returning -1/0/1 */ }
```

`src/bootstrap/fallback.html`:
```html
<div style="padding:2rem;text-align:center;font-family:system-ui">
  <h1>Connect to the internet to finish setting up</h1>
  <p>Road Trip will download once your device is online.</p>
</div>
```

Full `loader.js` is written out completely (no abbreviations) during implementation — the snippet above is illustrative.

**Verification:**

Via Task 9 unit tests. Later: `[Mac — Xcode]` device smoke (Task 11).

**Commit:** `feat(ios): bundled bootstrap loader, index.html, fallback.html`
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 7: Platform-adapter seams in shared JS

**Shell:** `[WSL]`

**Verifies:** Enables Phase 6.

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/storageAdapter.js` (seam)
- Modify: `src/RoadTripMap/wwwroot/js/uploadTransport.js` (seam)
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/platform-adapters.md`

**Implementation:**

Add at module top:
```js
const _platform = (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';
```

`StorageAdapter` factory selects backend: `web` → IndexedDB; `ios` → IndexedDB for Phase 5 (native SQLite in Phase 6). The selection is wrapped so Phase 6 replaces just the factory contents:
```js
const StorageAdapter = _platform === 'ios' ? createIndexedDbAdapter() : createIndexedDbAdapter();
// Phase 6 changes the 'ios' branch to createSqliteAdapter()
```

`UploadTransport` similarly: `ios` → fetch-based for Phase 5, native `BackgroundUpload.enqueue` for Phase 6.

`platform-adapters.md` documents the seam contract so Phase 6 has a clear target: adapter interface, lifecycle, tests to keep passing.

**Verification:**

`npm test` — existing tests still pass with `_platform === 'web'`.

**Commit:** `feat(web): platform-adapter seams for iOS override in Phase 6`
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 8: iOS-specific CSS

**Shell:** `[WSL]`

**Verifies:** AC10.1, AC10.2.

**Files:**
- Create: `src/RoadTripMap/wwwroot/ios.css`

**Implementation:**

`.platform-ios`-scoped rules for:
- Safe-area insets on the map container: `padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);`
- Larger tap targets: `.upload-panel__retry, .upload-panel__discard, .resume-banner button { min-height: 44px; min-width: 44px; }`
- iOS system font override: `.platform-ios { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif; }`
- Disable rubber-band scrolling on body only (not map): `.platform-ios body { overscroll-behavior: none; }`

Ensure `build-bundle.js` (Task 3) copies this file into `wwwroot/bundle/ios.css`.

**Verification:**

Web dev test: add `document.body.classList.add('platform-ios')` in DevTools console; observe spacing and font changes.

**Commit:** `feat(web): iOS-specific CSS overrides`
<!-- END_TASK_7 -->
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D (task 9) -->
## Subcomponent D: Bootstrap tests (WSL)

<!-- START_TASK_8 -->
### Task 9: Bootstrap loader unit tests

**Shell:** `[WSL]`

**Verifies:** AC9.1, AC9.2, AC9.3, AC9.4, AC9.5.

**Files:**
- Create: `tests/js/bootstrap-loader.test.js`

**Implementation:**

`fake-indexeddb/auto`, stubbed `fetch`, stubbed `document` via jsdom. Test harness imports `loader.js` as a string and evals in a controlled scope so we can mock deps.

Scenarios:
- AC9.1: no cache + fetch OK → manifest + 3 file fetches; IndexedDB populated; `<script>` + `<style>` injected.
- AC9.2: cache present + `fetch` rejects → cached bundle injected; no network call for files.
- AC9.3: cache version differs from manifest version → new fetch; cache replaced.
- AC9.4: no cache + fetch rejects → `fallback.html` fetched and injected.
- AC9.5: `manifest.client_min_version > cached.version` → alert called once; re-fetch happens.

**Verification:**

Run: `npm test tests/js/bootstrap-loader.test.js`
Expected: Pass.

**Commit:** `test(ios): bootstrap loader scenarios AC9.1-9.5`
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E (tasks 10-11) -->
## Subcomponent E: Mac-only — TestFlight + device smoke

<!-- START_TASK_9 -->
### Task 10: TestFlight configuration

**Shell:** `[Mac — Xcode]`

**Prerequisite:** Tasks 1–9 committed + pushed; Mac has pulled latest.

**Verifies:** Enables AC9 validation on device.

**Files:**
- Modify: `ios/App/App.xcodeproj/project.pbxproj` (Team ID, Bundle ID, Deployment target — via Xcode UI, commits the file)
- Modify: `ios/App/App/Info.plist` (permissions copy for photos access — `NSPhotoLibraryUsageDescription`: "Road Trip needs access to Photos to attach images to your trip map.")

**Implementation:**

Per `ios-mac-handoff.md` steps 3 and 6:
1. Open `ios/App/App.xcworkspace` in Xcode.
2. Target App → Signing & Capabilities → set Team, toggle Automatic Signing.
3. General tab → set Deployment Target (per Task 2 decision).
4. Info tab → add `NSPhotoLibraryUsageDescription`.
5. Product → Archive (targeting Any iOS Device / arm64).
6. Organizer → Distribute App → App Store Connect → Upload.
7. Wait for processing email.
8. appstoreconnect.apple.com → TestFlight → add build to internal testers.

Artifacts to record in `phase-5-device-smoke.md` (Task 11):
- Build version + build number.
- TestFlight install link.
- Screenshot of archive success.

**Verification:**

TestFlight email "processed successfully" received; build visible to internal testers.

**Commit:** `chore(ios): TestFlight signing config + Info.plist permissions`
<!-- END_TASK_9 -->

<!-- START_TASK_10 -->
### Task 11: Device smoke matrix

**Shell:** `[Mac — Xcode]` + physical iPhone.

**Prerequisite:** Task 10 TestFlight build processed.

**Verifies:** AC9.1, AC9.2, AC9.3, AC9.4, AC9.5, AC10.1, AC10.2.

**Files:**
- Create: `docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-device-smoke.md`

**Implementation:**

On Patrick's iPhone, execute the AC matrix and record results with screenshots:

1. **AC9.1 — First online launch:**
   - Fresh install from TestFlight.
   - Online (cellular or wifi).
   - App launches → loader appears briefly → trip UI renders.
   - Verify `wwwroot/bundle/app.js` was fetched (Safari Web Inspector → Network, if attachable) OR check App Service logs for a `/bundle/manifest.json` hit from the device's IP.
   - Screenshot.

2. **AC9.2 — Offline second launch:**
   - Enable Airplane Mode.
   - Cold-launch the app.
   - Trip UI renders from cache.
   - Screenshot.

3. **AC9.3 — Deploy new bundle, next launch picks up:**
   - On WSL, bump `wwwroot/bundle/manifest.json` version, deploy.
   - On phone, disable Airplane Mode, cold-launch.
   - New bundle fetched (verify Safari Inspector or logs).

4. **AC9.4 — First-ever launch offline:**
   - Delete app, re-install from TestFlight, put in Airplane Mode BEFORE first open.
   - Launch → `fallback.html` shown.
   - Screenshot.

5. **AC9.5 — Version mismatch:**
   - Bump server `client_min_version` to a higher value than the currently cached version.
   - Online, cold-launch.
   - Alert "Site updated — reloading" shown; fresh bundle loaded.

6. **AC10.1 — iOS CSS without flash:**
   - Record screen video (or rapid screenshots) of launch.
   - Verify no unstyled flash; `platform-ios` class applied before first paint.

7. **AC10.2 — ios.css update picked up:**
   - On WSL, change `ios.css` (e.g., button min-height), redeploy.
   - On phone, cold-launch; verify new styling.

All 7 matrix entries go into `phase-5-device-smoke.md` with screenshots (PNG in `docs/.../phase-5-screenshots/`). Sign-off line at bottom.

**Verification:**

All 7 entries PASS; Patrick signs off.

**Commit:** `docs(ios): Phase 5 device smoke matrix with screenshots`
<!-- END_TASK_10 -->
<!-- END_SUBCOMPONENT_E -->

<!-- START_SUBCOMPONENT_F (task 12) -->
## Subcomponent F: Deployment runbook (WSL)

<!-- START_TASK_11 -->
### Task 12: Extend deployment-runbook.md with Phase 5 section

**Shell:** `[WSL]`

**Verifies:** Operational readiness.

**Files:**
- Modify: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

**Implementation:**

Append `## Phase 5 — Capacitor shell + bundle hosting`:

1. **Pre-flight**
   - `ios-mac-handoff.md` reviewed by Mac session.
   - `phase-5-decisions.md` finalized.
   - All WSL tasks (0–8) merged to main.

2. **Bundle deploy**
   - `[bash/WSL]` Confirm CI ran `npm run build:bundle` (check App Service wwwroot/bundle has the files).
   - `[bash/WSL]` `curl https://roadtripmap.azurewebsites.net/bundle/manifest.json` returns 200 with valid JSON.

3. **iOS build (on Mac)**
   - Refer to `ios-mac-handoff.md` Section 6 (Build and archive).
   - Capture build-log excerpt in `phase-5-device-smoke.md`.

4. **TestFlight submission**
   - Per Task 10.
   - Internal testers notified automatically.

5. **Device validation**
   - Per Task 11 matrix.
   - Sign-off line.

6. **Rollback**
   - iOS bundle: revert manifest version on App Service or pin `client_min_version` to force older cached bundle.
   - TestFlight build: mark build inactive (testers revert to previous build).
   - No Bicep rollback needed.

7. **Sign-off** — Patrick + Mac session initials.

**Verification:** Runbook reviewed before Task 10 Mac work.

**Commit:** `docs(uploads): deployment runbook — Phase 5 Capacitor + bundle`
<!-- END_TASK_11 -->
<!-- END_SUBCOMPONENT_F -->

---

## Phase 5 Done When

- 12 tasks (0–11) complete.
- Tasks 1–9, 12 committed + pushed from WSL.
- Tasks 10–11 executed on Mac; artifacts committed + pushed.
- `npm test tests/js/bootstrap-loader.test.js` green.
- TestFlight build processed and installed on Patrick's device.
- All 7 entries in `phase-5-device-smoke.md` matrix PASS.
- iOS-specific CSS confirmed visually (no flash).
- Deployment runbook Phase 5 section added and signed off.
