---
id: 4
title: Maestro 2.6.0 cannot discover iOS 26 simulators — `list-devices` returns empty, `test` hangs silently
status: open
severity: important
surface: tooling
opened: 2026-05-24
closed:
fixed-by:
regression-from: N/A — first observed when setting up Layer 2 (Maestro / Simulator) test infrastructure. External tool defect, not in our code.
regression-test:
---

## Bug

Maestro 2.6.0 (the Mobile.dev mobile-testing CLI) cannot discover or drive iOS 26.x Simulator devices on macOS 26.4 with Xcode 26.5. `maestro list-devices` returns an empty list, `maestro test` hangs after planning the execution (no progress past "Created execution plan" in the log), and `maestro start-device --platform=ios` hardcodes a requirement for **iOS 17.5** runtime which is unrelated to and incompatible with what we ship to.

This blocks Layer 2 of the graphical-boundary testing strategy laid out in `tests/maestro/README.md`. Layer 1 (`tests/playwright-layout/`) is unaffected.

## Steps to reproduce

Set up environment matching ours:
1. macOS 26.x (verified 26.4.1).
2. Xcode 26.5 with iOS 26.x runtime installed (verified iOS 26.4 booted simulator: `iPhone 17 (EFE9F482-AB25-4D27-B38E-932604D55112)`).
3. Install Maestro 2.6.0: `curl -Ls "https://get.maestro.mobile.dev" | bash`.
4. Install JDK 17: `brew install openjdk@17`; `export JAVA_HOME=/opt/homebrew/opt/openjdk@17`.
5. Boot an iOS 26.x Simulator: `xcrun simctl boot <iPhone-17-or-similar UDID>`.
6. Run any Maestro command that needs the device:
   - `maestro list-devices`
   - `maestro hierarchy`
   - `maestro --udid=<booted UDID> test path/to/flow.yaml`

## Expected results

`maestro list-devices` shows the booted iOS 26 simulator. `maestro test` against a flow either runs to completion or fails with a clear error message inside the flow's first step.

## Actual results

- `maestro list-devices` prints the "Local Devices" header followed by an empty list — no devices detected. The booted iOS 26 simulator is invisible to Maestro.
- `maestro test` logs the system info, prints the parsed execution plan, then hangs indefinitely with no further output. `~/.maestro/tests/<run-timestamp>/maestro.log` confirms the hang point ("Created execution plan: ...") with no driver-setup messages following.
- `maestro start-device --platform=ios` errors: *"Required runtime to create the simulator is not installed: iOS-17-5."* Maestro 2.6 hardcodes iOS 17.5 for its auto-created device and will not fall back to discovered devices.
- Explicit `--udid=<booted-iOS-26-UDID>` flag is ignored / does not unblock; `list-devices` still returns empty.

No error to the user beyond the empty device list — the silent `test` hang is the worst failure mode because it looks like an infinite-loop bug rather than a missing-dependency.

## Environment

- macOS: 26.4.1 (Darwin 26.4)
- Xcode: 26.5
- iOS Simulator runtime: 26.4 (also 26.5 installed)
- Maestro CLI: 2.6.0 (installed from get.maestro.mobile.dev 2026-05-24)
- Java: OpenJDK 17 via Homebrew (`/opt/homebrew/opt/openjdk@17`)
- Architecture: aarch64 (Apple Silicon)

## Screenshots / video

- `~/.maestro/tests/2026-05-24_142602/maestro.log` — log shows hang point after execution-plan creation
- `~/.maestro/tests/2026-05-24_143322/maestro.log` — second confirmation

## Notes for Claude

**Workarounds, ranked by cost:**

1. **(Cheapest, Patrick-side)** Install the iOS 17.5 Simulator runtime via Xcode → Settings → Platforms → `+`. ~6 GB download. Then `maestro start-device --platform=ios` creates a Maestro-managed iOS 17.5 simulator and tests run there. Trade-off: tests run on iOS 17.5, two major versions behind what we ship to; iOS-26-specific regressions won't be caught.
2. **(External)** Wait for / track a Maestro release that supports iOS 26. Check https://github.com/mobile-dev-inc/maestro/issues for "iOS 26" or "Xcode 26" before opening one.
3. **(Heaviest)** Switch test runner — XCUITest directly (Swift), Detox, or Appium. All require significantly more setup than Maestro's YAML flows. Defer until #1 and #2 are confirmed dead ends.

**This is an external tool bug, not ours.** The fix surface (when it lands) is upstream in Maestro's iOS device-discovery code, not in this repo. Our part is: monitor upstream, and bump the Maestro pin in `tests/maestro/README.md` when a compatible release ships.

**Don't waste more session time** trying to coax Maestro 2.6.0 into seeing iOS 26 simulators — confirmed silent hang on multiple invocations (`maestro test`, `maestro hierarchy`, `maestro list-devices` with explicit `--udid`). The Layer 2 scaffolding in `tests/maestro/` is committed and ready for the moment one of the workarounds above clears.
