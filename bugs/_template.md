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

## Summary

One paragraph. What's broken from a user's perspective?

## Repro steps

Numbered, with exact URLs / taps / scrolls. Claude cannot reproduce from prose; it needs a recipe.

1. ...
2. ...
3. ...

## Expected behavior

What should happen at step N.

## Actual behavior

What does happen at step N.

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
