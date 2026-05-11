# Road Trip App Backlog

## High Priority

### Photo location edit interface
Allow poster to correct a photo's GPS coordinates after upload. Pin-drop map UI on the post page — tap a photo, tap "Edit Location", drop a pin.

### GPS deviation detection
Server-side check after upload: if a new photo's GPS is a large deviation from the prior path (based on TakenAt order), alert the user that the location may be wrong. May need to wait until 2+ photos exist to establish a baseline.

### Desktop carousel scroll
Carousel thumbnail strip doesn't scroll on desktop (no touch/swipe). Add horizontal scroll buttons or mouse wheel support.

### Local test environment
Localhost currently points at the StockAnalyzer database, not a road-trip DB. Need a reliable local dev environment that mirrors prod. Options to evaluate: local SQL with road-trip schema + Azurite for blob storage, Docker Compose with full stack, or a dedicated Azure dev environment. Goal: stop testing in production.

### Whimsical route lines
Replace straight lines between photos with curved/weaving dotted lines. Look into Bezier curve interpolation or spline algorithms to give routes a hand-drawn, playful feel instead of rigid point-to-point segments.

## Medium Priority

### Android PWA install prompt
Add manifest.json, service worker, and beforeinstallprompt handler for Android "Install App" button on post page.

### apple-touch-icon for home screen
Add a dedicated app icon so iOS home screen bookmarks look polished instead of using a page screenshot.

## Low Priority

### Key Vault for road-trip SQL credentials
Road-trip prod SQL password is hardcoded in App Service settings, not in Key Vault. See `docs/security-issues/2026-03-31-gh-token-scope.md`.

### CLAUDE.md gotcha-symbol validator (CI)
Add a CI step that grep's CLAUDE.md's Gotchas section for code symbols (e.g., `ApplyExifRotation`, `_executedScriptSrcs`, `processForUpload`) and fails if the referenced symbols don't appear under `src/`. Catches stale gotchas like the "EXIF rotation is TODO" entry that was wrong for months — it referenced `ApplyExifRotation()` as a no-op stub when the function had been a real implementation for some time. Same shape as `git-flow-guard`: turn a behavior rule (audit gotchas against code) into a mechanical check. From the 2026-05-09 collaboration retrospective.

### `/audit-conventions` slash command (design + implementation)
A skill or slash command that, when invoked, runs `git log --merges --oneline -20 origin/main`, lists existing test scaffolding patterns in the relevant area, dumps recent CI runs, and surfaces what the project *actually does* — distinct from what CLAUDE.md *claims*. Intended to be invoked (or auto-invoked) before Claude makes any "the standard fix is X" recommendation in a workflow/process area. Would have prevented the 2026-05-09 git-flow incident: the historical pattern was visible from `git log --merges` but Claude didn't run it before recommending squash for develop → main. Needs a design conversation: invocation surface, what it dumps, when it auto-fires.
