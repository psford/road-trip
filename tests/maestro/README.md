# Maestro on iOS Simulator (Layer 2)

End-to-end tests that drive a real iOS Simulator via [Maestro](https://maestro.mobile.dev/). Catches the class of bug that Playwright's mobile WebKit can't reproduce — WKWebView-specific behavior under Capacitor.

## What Layer 2 catches that Layer 1 doesn't

| Bug class                                          | Layer 1 (Playwright mobile WebKit)                  | Layer 2 (Maestro / Simulator)                |
| -------------------------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| CSS layout regressions in `.platform-ios` rules    | ✅ DOM geometry assertions                          | ✅ visual + tap targets                       |
| File `<input>` not bound to WKWebView picker delegate (#84) | ❌ Playwright fires `change` directly; no delegate gap | ✅ Real picker → real `change` event          |
| `contentInset: "always"` interaction with sticky pin (#89) | ❌ Playwright doesn't emulate notch / contentInset | ✅ Pinned position checked against real safe-area inset |
| App-bundle install / cold-launch failure           | ❌ no native bundle                                 | ✅ install + launch is step 1 of every flow   |
| Native bridge calls (Native.haptic, Native.share)  | ❌ shims to web fallbacks                           | ✅ actual Capacitor plugin invocations        |

## Layout

```
tests/maestro/
├── README.md                       ← this file
├── flows/                          ← Maestro YAML test flows
│   └── 001-smoke-app-launches.yaml ← cold launch + home page render
├── scripts/
│   └── run.sh                      ← boots sim, installs app, runs flows
└── fixtures/                       ← test data (committed; created as flows grow)
```

## ⚠️ Current blocker — Maestro + iOS 26 incompatibility (2026-05-24)

Maestro 2.6.0 (current) hardcodes **iOS 17.5** as the required Simulator runtime in its `start-device` command, and `maestro list-devices` does not discover iOS 26.x simulators on this Mac even when one is explicitly booted and passed via `--udid`. Effect: `maestro test` hangs silently waiting for a device.

Confirmed environment 2026-05-24: Maestro 2.6.0, macOS 26.4.1, Xcode 26.5, iOS 26.4 simulator runtime. `maestro start-device --platform=ios` errors with: *"Required runtime to create the simulator is not installed: iOS-17-5."*

**Unblock options:**

1. **Install the iOS 17.5 Simulator runtime via Xcode** → Settings → Platforms → `+` → iOS 17.5. Roughly 6 GB. After install, `maestro start-device --platform=ios` will create its own simulator on iOS 17.5 and `maestro test` should work there. The trade-off: tests then run against iOS 17.5, not the iOS 26 you ship to.
2. **Wait for a Maestro release that supports iOS 26** — tracked separately as `bugs/004-maestro-cannot-discover-ios-26-simulators.md`.
3. **Switch test runner** — XCUITest directly (heavyweight, written in Swift), Detox (RN-flavored), or Appium. Larger investment than waiting.

Until one of those is resolved, this directory is scaffolding only — the runner script, the smoke flow, and the npm-script wiring are in place, but `npm run test:simulator` will hang waiting for a device.

## One-time setup

### 1. Install Maestro

```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
```

This installs the Maestro CLI at `~/.maestro/bin/maestro`. Add to your PATH (or let `tests/maestro/scripts/run.sh` find it automatically).

**Don't use `brew install maestro`** — that's a different cask (a macOS audio app called Maestro by SoftPress). The mobile-testing Maestro is from Mobile.dev and only ships via the curl installer or its own Homebrew tap.

### 2. Install Java 17+ (Maestro requirement)

```bash
brew install openjdk@17
export JAVA_HOME="/opt/homebrew/opt/openjdk@17"
```

Add the `export` to your shell rc to persist.

### 3. Build the iOS app once

The runner script does NOT build — it picks up the most recent `App.app` from DerivedData. Build via Xcode (`Cmd+B`) or via Claude's xcode MCP `BuildProject` tool. Run script picks up the result automatically.

## Running flows locally

```bash
# Run all flows
npm run test:simulator

# Or run a single flow
MAESTRO_FLOW=tests/maestro/flows/001-smoke-app-launches.yaml npm run test:simulator

# Or use a different simulator
MAESTRO_DEVICE_NAME="iPhone 17 Pro" npm run test:simulator
```

The runner:
1. Boots the simulator (`iPhone 17` by default) if it isn't already
2. Installs the most recent `App.app` from `~/Library/Developer/Xcode/DerivedData`
3. Runs Maestro test against the flow(s)

## Writing a new flow

Maestro flows are YAML in `flows/`. Filename convention: `NNN-short-description.yaml`. Headers:

```yaml
appId: com.psford.roadtripmap
---
- launchApp:
    clearState: true       # cold launch (no cached IDB)
- assertVisible: "Some text on the screen"
- tapOn: "Button text"
- inputText: "literal string to type"
```

Reference: https://maestro.mobile.dev/api-reference/commands

**Tip for WKWebView content:** Maestro reaches WebView elements through the iOS accessibility tree. Standard `<button>` text and form labels work; complex web widgets may need explicit `aria-label` or `id` attributes. Test as you go — if `tapOn: "X"` doesn't find an element, fall back to coordinate-based `tapOn: { point: "50%,40%" }` and file a bug to add a stable selector.

## CI integration (not yet wired)

Future: a `macos-14` GitHub Actions job that builds the iOS app + runs Maestro. Currently this suite is local-run only. Wiring into CI requires:

- A macOS runner (GitHub provides; bigger minutes cost than Linux)
- Signing certs / provisioning for `xcodebuild` (or Capacitor-side stubs that bypass signing for sim-only builds)
- Maestro install step in the workflow

Defer until the suite is mature enough that the runner-minute cost is justified.

## What this is NOT

- A replacement for Layer 1. Layer 1 (Playwright DOM-measurement, `npm run test:layout`) runs fast in CI and catches most CSS regressions. Layer 2 is the slower, more authentic backstop for WKWebView-specific behavior.
- A replacement for the existing `tests/playwright/*.spec.js` E2E suite. That suite tests against the .NET dev server (requires DB / Azurite). Layer 2 tests against the iOS shell pointing at prod content (or wherever the build's `capacitor.config.json` configures).
