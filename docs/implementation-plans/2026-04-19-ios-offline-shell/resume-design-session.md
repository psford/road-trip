# Resume — iOS Offline Shell architecture design session

**Paused:** 2026-04-21, mid-Phase-1 of `starting-a-design-plan` skill.
**Reason:** Approaching context compaction; want to resume with clean slate.
**Branch:** `ios-offline-shell` at `origin/ios-offline-shell` (50 commits ahead of `develop`, not merged).

---

## How to resume

1. `/clear` to reset context.
2. Run:
   ```
   /ed3d-plan-and-execute:start-design-plan
   ```
3. When the skill asks for context, paste a pointer to this doc:
   ```
   Design plan for iOS Offline Shell architecture fixes.
   Full context in docs/implementation-plans/2026-04-19-ios-offline-shell/resume-design-session.md
   ```
   The new session can read this file and pick up where we left off.

---

## What we're designing

Architectural fixes to the iOS Offline Shell (branch `ios-offline-shell`) before any more real-world testing. The shell works for the happy path but has latent issues that will break in non-trivial use.

## Branch state

- **Committed and pushed** to `origin/ios-offline-shell`
- **NOT merged** — no PR open, not ready
- 50 commits ahead of `develop`
- 6 on-device bugs fixed yesterday (see the commit log for `fix(ios-offline-shell)`)
- Phase 7 on-device sign-off never formally run; ad-hoc testing covered most AC rows

## Key docs to read when resuming

- [known-issues-and-followups.md](./known-issues-and-followups.md) — the 5 latent issues found yesterday, verified vs. unverified ACs, "Fix direction" sketches (starting points, not designed solutions)
- [phase_03.md](./phase_03.md) — "Known limitations" section called out `window.location.origin` leak in `postUI.js:232` and `mapUI.js:190` as deferred to Phase 5 / follow-up (never fixed)
- [/Users/patrickford/Documents/claudeProjects/road-trip/CLAUDE.md](/Users/patrickford/Documents/claudeProjects/road-trip/CLAUDE.md) — current project invariants; has a note about `storageAdapter.js` / `uploadTransport.js` swap seams that must not be collapsed

## Issues in scope for the design plan (as identified so far)

### Architectural

1. **Duplicate-`const` cascade on cross-page navigation.** `_swapFromHtml` removes `<script>` elements from DOM but JS realm retains their top-level `const` bindings. Every navigation between pages that share scripts (e.g. `api.js`, `tripStorage.js`) produces 15–20 redeclaration errors. First declaration wins, so the app works — but it's noise and fragile.
2. **`DOMContentLoaded` listener accumulation.** Page scripts register `document.addEventListener('DOMContentLoaded', init)`. Those stay attached across swaps. `fetchAndSwap` dispatches a synthetic `DOMContentLoaded` on every navigation — every accumulated handler fires on every page. `postUI.js` trying to wire `addPhotoButton` on `/create` page is a visible symptom.
3. **`window.location.origin` leaks `capacitor://localhost`.** Share-trip "view" link starts with `capacitor://` on iOS — unusable by recipients. Known callers: `postUI.js:232`, `mapUI.js:190`. Likely others.

### User-visible

4. **"Load failed" leaks into create.html error UI.** Offline submit shows Safari's raw `TypeError.message`. Pre-existing, made visible by iOS shell's offline story.
5. **"Failed to load photos" on trip page offline.** `postUI.js` calls `API.getTripPhotos` via raw `fetch`, not `CachedFetch.cachedFetch`. Photos JSON isn't cached; trip HTML renders but photo list shows error banner.
6. **iOS-specific CSS/UI issues.** User mentioned these exist but hasn't listed specifics yet. Likely `ios.css` concern: layout overflow, status-bar overlap, tap targets, safe-area handling.

### Partial / low-priority

7. **Duplicate-var cascade mystery.** After a failed offline `fetchAndSwap`, a cascade appears in console even though `_swapFromHtml` never ran. Not fully diagnosed; may share root cause with #1.

---

## Where we are in the design-plan skill

**Phase 1 (Context Gathering) — IN PROGRESS.** Assistant asked these 5 questions, user had not yet answered:

1. **Scope** — which of issues 1–6 are in scope for this design plan? All, or a subset?
2. **UI issues** — what specific problems has the user seen? (layout overflow, status-bar overlap, tap targets, safe-area, etc.)
3. **Constraints** — ship deadline vs. correctness-first? Fixes already ruled out? Backward compat with web version (since `wwwroot` pages serve both iOS shell and browsers)?
4. **Research** — has the user investigated anything between sessions? External references to consider (Turbo Drive's script-tracking strategy, Capacitor `server.hostname` docs, etc.)?
5. **Philosophy** — "aggressive" (idempotent scripts / `window.location` shim / tracked listener teardown — invasive, robust) vs. "minimal" (fix user-visible symptoms only, accept console noise) vs. somewhere between?

These questions should be re-asked on resume. They weren't answered, so no decisions are locked in yet.

---

## A lean set of likely-relevant fix directions (starter thoughts, not decisions)

Captured here so the resumed session can use them as ideation seeds:

- **For #1 (const cascade):** Track executed script sources in a `Set` in `_recreateScripts`; skip re-injection for already-executed `src` URLs. Or require `wwwroot/js` modules to use `globalThis.X ??= {...}` idempotent install. The former is less invasive.
- **For #2 (listener accumulation):** Proxy `document.addEventListener` via a wrapper that tracks listeners; clear all `DOMContentLoaded`/`load` handlers before each swap. Or re-architect page scripts to use a single global `RoadTrip.onReady(fn)` API (invasive).
- **For #3 (`window.location.origin`):** Define a `globalThis.APP_ORIGIN` constant in the shell (value = `APP_BASE`). Modify `postUI.js:232` and `mapUI.js:190` to prefer that when available, fall back to `window.location.origin` in regular browsers. Could also monkey-patch `Object.defineProperty(window.location, 'origin', ...)` but Safari may reject that.
- **For #4, #5:** Mostly localized code changes to copy/error-handling. Low design risk.
- **For #6 (CSS):** Needs the user's list of specific issues before we can design anything.

---

## Decisions and questions

None locked in yet. Design decisions will be made during the design-plan skill's brainstorming phase (Phase 4) with user validation.

---

**Resume command when ready:**

```
/clear
/ed3d-plan-and-execute:start-design-plan
```

Then paste: "Design plan for iOS Offline Shell architecture fixes. Read `docs/implementation-plans/2026-04-19-ios-offline-shell/resume-design-session.md` for full context before the context-gathering questions."
