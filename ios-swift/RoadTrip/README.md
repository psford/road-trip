# RoadTrip — Native iOS Client

Greenfield SwiftUI rewrite of the Road Trip iOS app, replacing the Capacitor
WKWebView shell. The .NET backend and its resilient upload protocol are
unchanged. Full design + acceptance criteria:
[`docs/design-plans/2026-05-30-native-ios.md`](../../docs/design-plans/2026-05-30-native-ios.md).

- **UI:** 100% SwiftUI, iOS 17+, `@Observable`, `NavigationStack`, MapKit
- **Local cache:** GRDB.swift (schema-versioned migrations)
- **Uploads:** bare background `URLSession` (survives backgrounding / force-quit)
- **Bundle ID:** `com.psford.roadtripmap.native` (installs side-by-side with the Capacitor app)
- **Distribution:** TestFlight internal

## How this project is built (container ↔ Mac split)

This repo is edited inside a Linux dev container that has **no Xcode/Swift
toolchain** — by design. The container authors `project.yml` and all Swift
sources; the **Mac** generates and builds via the Xcode MCP bridge.

The `.xcodeproj` is **generated from `project.yml` by [XcodeGen](https://github.com/yonaskolb/XcodeGen)**
and is **gitignored** — never edit or commit it. Add/remove files by editing
sources + `project.yml`, then regenerate.

### One-time, on the Mac
```bash
brew install xcodegen
```

### Generate + build (on the Mac / via the MCP bridge)
```bash
cd ios-swift/RoadTrip
xcodegen generate                 # writes RoadTrip.xcodeproj from project.yml
xcodebuild \
  -project RoadTrip.xcodeproj \
  -scheme RoadTrip \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  build                           # or `test` to run the unit + UI test targets
```

Open `RoadTrip.xcodeproj` in Xcode to run on the simulator interactively.

## Phase 1 status (scaffold)

- [x] `project.yml` — app + unit-test + UI-test targets, GRDB SPM dependency, iOS 17, team `GP2M7H6R3U`
- [x] Minimal SwiftUI app (`RoadTripApp` + placeholder `ContentView`)
- [x] Asset catalog (AppIcon / AccentColor placeholders)
- [x] Test targets compile (`RoadTripTests` smoke + `RoadTripUITests` launch test)
- [ ] **First `xcodegen generate` + build on simulator — runs on the Mac** (Phase 1 "Done when")
- [ ] Confirm/pin the resolved GRDB version (container can't resolve SPM)
- [ ] Azure dev-slot Bicep + `deploy-dev.yml` (separate, backend half of Phase 1)

Layout follows the design doc's module plan (`App/`, `Models/`, `Storage/`,
`Networking/`, `Upload/`, `Photos/`, `Views/`, `ViewModels/`); directories
arrive as their phases land.
