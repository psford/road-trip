# Remaining operator tasks

Two things left before the iOS Offline Shell can merge to `develop`:

1. **5-minute browser smoke** — confirm `create.html` still works for web users (Phase 4 leftover).
2. **Phase 7 on-device verification** — TestFlight build + iPhone matrix + sign-off.

That's it. The earlier Phase 3 spike and Phase 5 Simulator smoke are **subsumed by Phase 7** — they covered the same ACs on weaker evidence, so there's no value in doing them separately. Details at the bottom.

---

## Step 1 — browser smoke on create.html

**What it verifies:** The `else` branch of the create-trip flow (Phase 4 Task 5) still does `window.location.href = result.postUrl` when `FetchAndSwap` isn't loaded. Regular-browser users must not be broken by the iOS-shell conditional.

**Why this isn't covered by Phase 7:** Phase 7 runs the iOS shell, where `FetchAndSwap` IS loaded — so the iOS path is tested but the web-browser `else` path isn't. The create-flow automated tests (`tests/js/create-flow.test.js`, 2 tests) cover both branches in jsdom, but a quick real-browser smoke is cheap insurance.

**Prerequisites:**
- Your normal dev setup (Windows or WSL).
- `dotnet` installed.

**Steps:**

```bash
# From the repo root:
dotnet run --project src/RoadTripMap
```

In Chrome or Safari (NOT the iOS shell — a regular browser):

1. Go to `http://localhost:5100/create`.
2. Open DevTools → Application → Local Storage → `http://localhost:5100`. Note the current value of `roadtripmap_trips` (may be empty).
3. Fill in a trip name. Submit.
4. Confirm the browser redirects to `/post/{token}`.
5. Refresh DevTools → Local Storage. Confirm `roadtripmap_trips` now contains a new entry with the name you just typed.

**PASS:** redirect happens, trip saved to localStorage.

**FAIL:** if no redirect or localStorage unchanged, the create.html conditional broke the else branch. Check the console for errors. Revert `30ee79c` (`feat(ios-offline-shell): create-trip flow uses FetchAndSwap when in iOS shell`) and investigate.

No sign-off artifact required. If it works, move to Step 2.

**Estimated time:** 5 minutes.

---

## Step 2 — Phase 7 on-device verification

This is the real deliverable. Everything else was warm-up.

### Step 2a — build TestFlight

```bash
# From the repo root (on your Mac with Xcode):
npm run prepare:ios-shell    # sync src/bootstrap/tripStorage.js copy
npx cap sync ios
open ios/App/App.xcodeproj
```

In Xcode:
1. Scheme: `App`. Destination: "Any iOS Device (arm64)".
2. Product → Archive.
3. When Organizer opens: Distribute App → App Store Connect → Upload → Next → Upload.
4. Wait 2–10 min for App Store Connect to process.
5. In App Store Connect → TestFlight → iOS → Builds, add the new build to your Internal Testing group.

**Note the build number** (e.g., `1.0.0 (42)`) — you'll need it for the sign-off doc.

**Estimated time:** 15–30 minutes depending on processing.

### Step 2b — install on your iPhone

1. On your iPhone, open TestFlight.
2. Find Road Trip. Tap Install (or Update).
3. Confirm the installed build matches the number you noted.

**Estimated time:** 5 minutes.

### Step 2c — run the matrix

The matrix is already written: [docs/test-plans/2026-04-13-resilient-uploads.md](../../test-plans/2026-04-13-resilient-uploads.md). Work through it in order.

**Record results in:** `docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md` (you create this file). The template is in Phase 7 Task 3 of [phase_07.md](./phase_07.md) — copy-paste it and fill in PASS/FAIL plus evidence (screenshots, Web Inspector snippets, screencasts) for each row.

**Order of operations within the matrix:**

1. **Pre-flight 0.1–0.8** (Mac terminal, ~10 min). All must PASS before touching the phone.
2. **AC1.1–AC1.6** (iPhone, ~20 min). Covers script execution, base-href resolution, internal-click routing, external-link passthrough.
   - AC1.6 (modifier keys) isn't touch-testable; mark "PASS (by automated tests)" and link to `tests/js/intercept.test.js`.
3. **AC2.1, AC2.2, AC2.4** (iPhone, ~15 min). Covers boot routing + glasses indicator.
   - AC2.4 needs a hand-crafted view-only trip entry via Web Inspector → Storage → Local Storage. The procedure is inline in the test plan.
4. **AC3.1–AC3.7** (iPhone, ~45 min). The cache-first + revalidate + offline + bypass ACs. The meatiest section.
5. **AC4.1–AC4.3** (iPhone, ~20 min). Upload queue offline behavior. AC4.4/AC4.5 are already verified via `git diff` in pre-flight.
6. **End-to-end realistic scenario** (iPhone, ~15 min). One linear run-through: create trip, add photo, force-quit, offline re-launch, add another photo offline, reconnect, confirm pin promotion.

**If any AC fails:**
- Record the failure in the matrix row with full evidence (screencast + Web Inspector logs).
- STOP. Do not sign off.
- Surface the failure to yourself (the implementer is on vacation 🙂) and decide whether it's a known-issue waiver or a blocker.
- If blocker: the branch isn't ready to merge. Fix before proceeding.

**Estimated total on-device time:** 2–3 hours.

### Step 2d — sign off

Once every row is PASS (or explicitly waived), do these three things in order:

1. Append the sign-off line to `phase-7-device-smoke.md`:

   ```markdown
   ## Sign-off

   All matrix entries PASS on my iPhone (TestFlight build `1.0.0 (XX)`, iOS [version], [date]).

   The iOS Offline Shell ships. AC1.* through AC4.* are verified end-to-end on real WebKit. AC5.3 satisfied.

   Signed: Patrick YYYY-MM-DD.
   ```

2. Tick the checkboxes in the sign-off table at the bottom of `docs/test-plans/2026-04-13-resilient-uploads.md` (change `□` to `☑`) and fill in the "Signed off" line.

3. Commit both files:

   ```bash
   git add docs/implementation-plans/2026-04-19-ios-offline-shell/phase-7-device-smoke.md \
           docs/test-plans/2026-04-13-resilient-uploads.md
   git commit -m "docs(ios-offline-shell): sign off Phase 7 — iOS Offline Shell verified on-device"
   ```

Now you're ready to merge.

---

## Step 3 — open the PR

```bash
git push -u origin ios-offline-shell
gh pr create --base develop --title "iOS Offline Shell: server-first document-swap architecture" \
  --body "[use the existing summary in phase-7-device-smoke.md]"
```

Wait for CI. Merge via the GitHub web UI (not `gh pr merge` — per project policy).

---

## What's already covered (so you don't re-do it)

| Previously flagged | Status | Why you can skip it |
|---|---|---|
| Phase 3 Task 1 — on-device spike | ❌ Skip | The spike's purpose was to de-risk AC1.3 **before** building Phases 3–5. Those phases are built and unit-tested. AC1.3 gets definitive verification in Phase 7's matrix (`AC1.3 — scripts in fetched page execute`). If Phase 7 fails on AC1.3, the design needs revisiting — same outcome the spike would have produced, but on real end-to-end evidence. |
| Phase 5 Task 6 — Simulator smoke for AC4.1/4.2/4.3 | ❌ Skip (optional gut check) | Phase 7's matrix runs AC4.1/4.2/4.3 on a **real iPhone**, which is strictly stronger than the Simulator. Only do the Simulator version if you want a fast iteration before investing in TestFlight upload. |
| Phase 5 Task 6 — AC4.4 / AC4.5 git-diff check | ✅ DONE | Already PASS in `phase-5-smoke.md`. Pre-flight 0.7 in the matrix re-runs the same check. |
| Phase 6 — test plan rewrite | ✅ DONE | Committed. You'll be reading it during Step 2c. |

---

## Known latent items (no action needed for merge, but worth a thought later)

- `GET /bundle/*` route still serves `manifest.json` + `app.js` + `app.css` + `ios.css`. The iOS shell no longer consumes it. It stays live as a rollback lever but can be retired in a follow-up.
- `APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net'` is hardcoded in `src/bootstrap/fetchAndSwap.js` and `src/bootstrap/intercept.js`. A staging variant would need code changes. Documented in CLAUDE.md gotchas.
- The full plan directory `docs/implementation-plans/2026-04-19-ios-offline-shell/` has some untracked plan files (phase_00 through phase_07, test-requirements.md). `phase-5-smoke.md` and this file ARE tracked. If you want the rest tracked, `git add` them before the final sign-off commit.

---

## The critical path in one picture

```
[Step 1: browser smoke]  ~5 min
        ↓
[Step 2a: build TestFlight]  ~20 min
        ↓
[Step 2b: install on iPhone]  ~5 min
        ↓
[Step 2c: run matrix]  ~2-3 hr
        ↓
[Step 2d: sign off]  ~10 min
        ↓
[Step 3: PR + merge]  ~15 min + CI
```

Total: about half a day of focused work, mostly on the iPhone.
