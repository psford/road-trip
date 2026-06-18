# Native iOS — execution handoff to the Mac/Xcode Claude

**Written 2026-06-18 by the Linux-container Claude, for the native-Mac Claude.**
Branch: `feat/native-ios` (tip `ac8c30e` = the reconciled implementation plan).

You're the native-Mac Claude (Xcode + simulator + device + MCP bridge). You own the
iOS **BUILD → RUN → SEE** loop — that's why this work is on you, not the Linux
container. This document is your starting prompt for executing the native-iOS rewrite.

## Orient first (read in this order, don't skip)

1. `git fetch && git checkout feat/native-ios && git pull` — commit `ac8c30e` is the
   tip; it's the reconciled implementation plan.
2. `CLAUDE.md` + `CLAUDE.local.md` — repo rules; they are hard blocks.
3. `docs/design-plans/2026-05-30-native-ios.md` — **AUTHORITATIVE spec** (revised
   2026-06-18). The acceptance criteria (`native-ios.AC1.1` … `AC11.2`) ARE the spec.
4. `docs/implementation-plans/2026-05-30-native-ios/` — the 8 phase files +
   `test-requirements.md` you will execute.

## Traps (a fresh instance gets these wrong)

- **IGNORE** `docs/native-ios-handoff.md` where it says "dev slot descoped." That doc
  is **stale**. The 2026-06-18 design plan supersedes it and **retains the dev slot**
  (Patrick upgraded Azure for it). Trust the newest commit, not old handoff notes.
- The **PR #108 facade UI** (`Views/*`, `App/SampleData.swift`) is **discarded** —
  rebuild for real, never build on it. (Phase 1 confirmed those files don't currently
  exist; only a placeholder `ContentView.swift` does.)
- **Reuse, don't recreate:** the storage layer on this branch is real and green on the
  iPhone 17 sim — `ios-swift/RoadTrip/` (`project.yml`, GRDB 6.29.3, iOS 17, bundle
  `com.psford.roadtripmap.native`; `Models/`, `Storage/{Migrator v1, AppDatabase,
  KeychainStore, PhotoFileCache}`). Phase 1 only **adds** a v2 migration.

## Non-negotiable rules

- **"Done" = SEEN on a simulator/device with a screenshot.** `xcodebuild test` passing
  is necessary, NOT sufficient. Never declare UI done from a green build alone.
- The phase files carry "Codebase verified: 2026-06-18" facts authored in the container
  **blind to the build**. Re-verify each against the real code before you implement —
  they may not compile as written.
- **Git:** `feat/native-ios` is your workspace — commit per task freely; you may open a
  PR to `develop`. **NEVER merge to `main`, NEVER run `deploy.yml`/`deploy-dev.yml`,
  NEVER run `npx cap sync ios`** — those are Patrick's. Azure mutations (dev-slot deploy,
  EF migration on the dev DB) are Patrick-dispatched: you author, he deploys.

## Execute

- Use the ed3d **`executing-an-implementation-plan`** skill, plan dir =
  `docs/implementation-plans/2026-05-30-native-ios/`. Load phases just-in-time,
  build + test + screenshot on the sim per task, review once per phase. *(If the ed3d
  plugins aren't installed after your tooling update, just drive phase-by-phase
  manually — the plan files are self-contained.)*
- **4 engineering decisions are deliberately LEFT OPEN** for you to settle **with build
  feedback** (search the phase files):
  1. `phase_06` — upload **original-tier-only** (server generates display/thumb) vs
     **all-3-tiers** client-side.
  2. `phase_07` — delete-trip revert: snapshot-restore vs mark-then-cascade-on-success.
  3. `phase_03` — FullscreenViewer array snapshot at open; and the `createdAt` strategy
     (call `tripForPost` after create vs. device-time).
  4. `phase_02` — `poi`/`parkBoundaries`/`version` method + error-enum scope (forward
     stubs beyond the design's Phase 2 contract — keep or trim).
- **Phase 1 is the start:** author the dev-slot Bicep + `deploy-dev.yml` (hand to Patrick
  to `what-if`/deploy), and do the GRDB **v2** migration + `StagingFileStore` on the Mac
  (this part you build + test). Then proceed phase by phase.

## Parity values already pinned (don't re-derive)

- Route line = **Catmull-Rom spline @ 16 pts/segment** (`mapService.js:smoothRoute`).
- Park-boundary detail tier = **network-quality adaptive, NOT zoom**
  (`stateParkLayer.js:_selectDetailLevel`).
- Everything else: **port behavior** from `src/RoadTripMap/wwwroot/js/`, don't reinvent.

## First action

Confirm the branch + scaffold builds clean on the iPhone 17 sim (**screenshot**), then
begin Phase 1.
