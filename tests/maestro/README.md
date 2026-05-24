# Maestro on iOS Simulator (Layer 2) — STATUS: BLOCKED

Intended as Layer 2 of the graphical-boundary testing strategy:
[Maestro](https://maestro.mobile.dev/) flows driving a real iOS Simulator to
catch the class of bug Playwright's mobile WebKit can't reproduce — WKWebView
under Capacitor, native picker delegate binding, `contentInset: "always"`
interaction with sticky positioning, native bridge calls, etc.

**Currently not built.** Maestro 2.6.0 cannot discover iOS 26.x Simulators on
macOS 26 / Xcode 26 — `maestro list-devices` returns empty, `maestro test`
hangs silently. Filed as [`bugs/004-maestro-cannot-discover-ios-26-simulators.md`](../../bugs/004-maestro-cannot-discover-ios-26-simulators.md)
with full repro and a workaround menu.

This directory is kept as documentation of the intended testing layer and
the upstream blocker. When the blocker clears, build out the flows / runner
script here.

## What Layer 2 would catch that Layer 1 doesn't

| Bug class                                                  | Layer 1 (Playwright mobile WebKit) | Layer 2 (Maestro / Simulator) |
| ---------------------------------------------------------- | ---------------------------------- | ----------------------------- |
| CSS layout regressions in `.platform-ios` rules            | ✅                                 | ✅                            |
| File `<input>` not bound to WKWebView picker delegate (#84) | ❌ Playwright fires `change` directly | ✅ Real picker → real `change` |
| `contentInset: "always"` interaction with sticky pin (#89) | ❌ no notch / contentInset emulation | ✅ real safe-area inset       |
| App-bundle install / cold-launch failure                   | ❌ no native bundle                | ✅ install + launch every flow |
| Native bridge (Native.haptic, Native.share)                | ❌ shims to web fallbacks          | ✅ actual Capacitor plugins   |

## When the blocker clears

See bug 004 for the workaround menu. Once one of those resolves and `maestro list-devices` shows the booted simulator, build:

1. `flows/001-smoke-app-launches.yaml` — cold launch + home page render assertion
2. `flows/002-upload-photo-via-picker.yaml` — the actual value: create trip → tap Add Photo → pick photo → assert preview / pin-drop / location-prompt overlay appears. Guards against the WKWebView file-picker delegate regression that bug #84 fixed.
3. `scripts/run.sh` — boots a sim, locates most recent `App.app` from DerivedData (no `xcodebuild` — that's in the deny list), installs, runs flows.
4. `package.json` — `"test:simulator": "bash tests/maestro/scripts/run.sh"`.

Don't build any of that ahead of the blocker clearing. Maestro silent-hangs aren't worth scaffolding against.
