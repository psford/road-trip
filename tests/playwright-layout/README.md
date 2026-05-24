# Layout tests (Layer 1)

Graphical-boundary tests for UI deploys, focused on the iOS shell's CSS rendering and DOM-structure invariants.

## What this covers

Layer 1 catches the kinds of UI bugs that:
- jsdom unit tests can't see (no layout / no rendering)
- CSS-text grep tests can't see (the rule exists but is broken in computed style)
- A code reviewer can't reliably catch by reading the diff

Specific regressions guarded today:
- Header drawn at the wrong y-position (gap above content, pinned into status bar)
- File input not replaced by the WKWebView createElement workaround
- `.page-header` regressed off `position: sticky`

## What this does NOT cover

- **WKWebView-specific behavior.** Playwright's mobile WebKit is not the same as a real Capacitor WKWebView for things like file picker delegate binding, `contentInset: "always"` interactions, or iOS-only CSS quirks. That coverage belongs in Layer 2 (Maestro driving a real iOS Simulator).
- **Absolute safe-area math.** Playwright doesn't simulate notch / Dynamic Island, so `env(safe-area-inset-*)` evaluates to its fallback (0). Tests assert structural and behavioral invariants instead of absolute pixel offsets.

## How to run

```bash
# Install Playwright browsers once
npx playwright install webkit

# Run the layout tests
npm run test:layout
```

A tiny Node static server (`static-server.js`) is started automatically by Playwright's `webServer` config. It serves `src/RoadTripMap/wwwroot` and rewrites the same URL patterns App Service does (`/post/<token>` → `post.html`, etc.). No .NET, no SQL, no Azurite required.

API endpoints (`/api/*`) are stubbed per-test via `page.route()` — pages render against a fake-but-shaped backend response.

## Adding a test

1. Write a new spec file under `tests/playwright-layout/*.spec.js` or add a case to `layout.spec.js`.
2. Call `applyIosShell(page)` after `page.goto(...)` to apply the `.platform-ios` class and inject `/ios.css`. This is the runtime hook the real iOS shell does in `src/bootstrap/loader.js`.
3. Stub any /api/* endpoints your page touches via `stubApi(page)` or your own `page.route()` setup.
4. Assert DOM geometry (`element.getBoundingClientRect()`), computed styles (`getComputedStyle`), or DOM mutations (data attributes, element identity).

## Relationship to other tests

| Suite                                    | Runs              | Catches                                       |
| ---------------------------------------- | ----------------- | --------------------------------------------- |
| `tests/js/*.test.js` (vitest + jsdom)    | `npm test`        | JS unit logic, DOM-mutation behavior, CSS-text grep |
| `tests/playwright-layout/*.spec.js`      | `npm run test:layout` | DOM geometry + computed styles in mobile WebKit |
| `tests/playwright/*.spec.js`             | requires .NET + DB | Full E2E flows (resilient uploads, etc.) |
| Maestro Simulator flows (Layer 2 — TBD)  | macOS runner      | WKWebView-specific behavior (file picker, contentInset) |
