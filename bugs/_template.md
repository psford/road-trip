---
id: 0
title: One-line title here
status: open                # open | in-progress | closed | wontfix | needs-design | needs-clarification
severity: important         # blocker | important | polish
surface: ios-app/post-page  # see surface taxonomy in README.md
opened: 2026-01-01
closed:                     # YYYY-MM-DD on resolution
fixed-by:                   # PR #N or commit SHA on resolution
regression-from:            # PR / commit / version where this last worked, if known
regression-test:            # path to the test that guards this once fixed (e.g. tests/playwright-layout/sticky-header.spec.js)
---

## Bug

One paragraph. What's broken from a user's perspective?

## Steps to reproduce

**This is the most important field in the report.** Assume the person reading it is on a different computer with no memory of the original session — they have to follow these steps verbatim to see the bug. Numbered, in execution order. Exact URLs / tokens / gestures (no "the test trip," no "scroll a bit"). State established up front. The final step produces a single observable outcome that matches "Actual results." See bugs/README.md → "Steps to reproduce: the most important field" for the full rubric.

1. ...
2. ...
3. ...

## Expected results

What should happen at the final step.

## Actual results

What does happen at the final step.

## Environment

- iOS app build: <git sha or PR # of last cap sync>
- Prod App Service deploy: <run id or date>
- Device: iPhone 16 Pro / Simulator iPhone 17 / etc.

## Screenshots / video

- bugs/assets/<id>-<short>.png

## Notes for Claude

- Suggested fix surface (file path, line)
- Related code links
- Design questions that block the fix (move status to `needs-design`)
