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

### Node.js 20 deprecation in GitHub Actions
`azure/login@v2` uses Node.js 20, deprecated June 2026. Update before forced migration. See memory: `project_node20_deprecation.md`.

### Key Vault for road-trip SQL credentials
Road-trip prod SQL password is hardcoded in App Service settings, not in Key Vault. See `docs/security-issues/2026-03-31-gh-token-scope.md`.
