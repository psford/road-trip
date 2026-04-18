# iOS Mac Handoff — Road Trip Phase 5

Operating manual for the Mac-native Claude Code session that executes the Xcode-only portions of Phase 5 (Tasks 10–11). Written for a first-time iOS publisher: every Xcode pane, every Apple portal screen, and every CLI command is named explicitly.

Companion to the broader `mac-handoff.md` (covers Phases 2–7 at a higher level). This doc is Phase 5 specific.

**Authoritative plan:** `docs/implementation-plans/2026-04-13-resilient-uploads/phase_05.md`. The plan is source of truth; if this doc diverges, fix this doc.

---

## 1. Prerequisites checklist

Run each verification command in Terminal.app on the Mac. All must pass before starting any Xcode work.

| Requirement | Verify | Install / fix |
|---|---|---|
| macOS 14.5+ | `sw_vers -productVersion` | System Settings → Software Update |
| Xcode ≥ 26.3 | `xcodebuild -version` | App Store → Xcode (~15 GB download) |
| Command Line Tools pointed at the installed Xcode | `xcode-select -p` should print `/Applications/Xcode.app/Contents/Developer` | `xcode-select --install`, then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` |
| Xcode license accepted | first-launch dialog, or | `sudo xcodebuild -license accept` |
| Node 20+ | `node -v` | `brew install node@20` (then link) |
| Apple Developer Program enrollment active | developer.apple.com → Account → Membership details | Pay $99/yr enrollment if expired |
| Apple ID added to Xcode | Xcode → Settings (⌘,) → Accounts tab shows your Apple ID with a Team listed | Settings → Accounts → `+` → Apple ID |
| `gh` CLI authenticated | `gh auth status` shows logged in to github.com | `gh auth login` |
| (Recommended) Xcode MCP bridge wired to Claude Code | `claude mcp list` lists `xcode` | `claude mcp add --transport stdio xcode -- xcrun mcpbridge` |

**MCP bridge note:** Xcode 26.3+ ships a native MCP server as `xcrun mcpbridge`. Wiring it up gives this Claude session ~20 tools for Xcode (build, run on simulator/device, capture SwiftUI previews, edit project files, search Apple docs). Tasks 10–11 assume it is available.

---

## 2. First-time clone + setup

```bash
# In Terminal.app on the Mac
mkdir -p ~/projects && cd ~/projects
git clone git@github.com:psford/road-trip.git
cd road-trip
git fetch origin
git checkout <feature-branch-name>     # from phase-5-decisions.md
npm ci
npm run build:bundle
npx cap sync ios
npx cap open ios                         # launches Xcode on ios/App/App.xcodeproj
```

No `pod install`. Capacitor 8 uses Swift Package Manager. Xcode resolves the SPM graph on first open; if it stalls, File → Packages → Reset Package Caches, then Resolve Package Versions.

---

## 3. Xcode signing config

One-time configuration per clone. In Xcode, with the `App` project selected in the left-sidebar project navigator:

1. Select the `App` **target** (under TARGETS, not PROJECT) in the editor.
2. **Signing & Capabilities** tab at the top of the editor.
3. **Team**: dropdown → pick the team whose Team ID equals `<apple-team-id>` (from `phase-5-decisions.md`). If your team doesn't appear, Xcode → Settings → Accounts → select your Apple ID → Download Manual Profiles, then come back.
4. **Bundle Identifier**: set to `<bundle-id>` (from `phase-5-decisions.md`). Must exactly match the App ID registered in developer.apple.com → Identifiers.
5. **Automatic Signing**: checkbox ON. Xcode will create an "Apple Development" certificate the first time you build to a device, and an "Apple Distribution" certificate the first time you archive.
6. If you see a red error bar "No matching provisioning profile": wait ~30 seconds; Xcode usually self-heals. If not, click **Try Again** in the error bar. If it still fails, see Troubleshooting below.

---

## 4. Simulator run

Smoke test that the app builds and renders at all.

- **In Xcode:** scheme selector in the top toolbar → **App** (scheme) / **iPhone 16** (or any simulator) → ▶ Run button (or ⌘R).
- **CLI alternative:** `npx cap run ios --target="iPhone 16"`.

Expected: simulator launches, app opens showing the bootstrap progress indicator briefly, then the road-trip UI renders. If stopped at a white screen, attach Safari Web Inspector (Safari → Develop → Simulator → Road Trip) and check the Console for loader errors.

---

## 5. Device run

You must run on a real device at least once to validate signing. Also required for Task 11 (device-smoke matrix).

1. Plug your iPhone in via USB; unlock it; tap "Trust This Computer" if prompted.
2. In Xcode: top-toolbar destination selector → pick your phone's name (NOT a simulator).
3. ▶ Run. First time: Xcode may prompt to enable Developer Mode on the device → iOS Settings → Privacy & Security → Developer Mode → ON → device reboots → re-plug.
4. On the device after install: iOS Settings → General → VPN & Device Management → your Apple ID → **Trust**. The app launches from this screen the first time.
5. Subsequent launches: just tap the app icon.

---

## 6. Build and archive for TestFlight

This is the path that produces a build App Store Connect (and eventually testers) can install.

1. Xcode → top-toolbar destination → **Any iOS Device (arm64)**. Archive will NOT run against a simulator destination.
2. **Product menu → Archive**. Takes 2–10 minutes. Project must have signing configured (Section 3) or this will fail.
3. When archive completes, the **Organizer** window opens (Window → Organizer if it doesn't).
4. Select the latest archive → **Distribute App** on the right.
5. Destination: **App Store Connect** → Next.
6. Options: leave defaults (Upload, Include bitcode if available, Upload symbols). Next.
7. Signing: **Automatically manage signing** → Next.
8. Review the content, then **Upload**.
9. Wait for the "processing complete" email (~10–15 min). Until you get it, the build won't be visible in TestFlight.

---

## 7. TestFlight distribution

1. Browser → https://appstoreconnect.apple.com → **My Apps** → **Road Trip Map** → **TestFlight** tab.
2. iOS Builds section → you should see the build you just uploaded; status transitions from "Processing" to "Ready to Test".
3. First build requires Export Compliance: click the build → answer "Does your app use encryption?" → almost always **No** for a road-trip photo app → Save.
4. Left nav → **Internal Testing** group (create if missing) → `+` under Builds → pick the build.
5. `+` under Testers → add each email from `phase-5-decisions.md` → Add.
6. Testers get an email and a TestFlight app install link. They install the TestFlight app, redeem, then install Road Trip.

---

## 8. Push results back to the repo

Only the following artifacts should change under `ios/` during a Mac session. Stage them explicitly; never `git add -A` from within `ios/` (Xcode sprays user-specific files into `xcuserdata/`).

```bash
# From repo root on the Mac
git add ios/App/App.xcodeproj/project.pbxproj
git add ios/App/App/Info.plist
git add docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-device-smoke.md
git add docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-screenshots/

git commit -m "chore(ios): <what this session accomplished>"
git push
```

`.gitignore` must exclude `ios/App/App.xcodeproj/xcuserdata/`, `ios/App/App.xcodeproj/project.xcworkspace/xcuserdata/`, and `DerivedData/`. If Task 5 didn't already add these, add them now.

---

## 9. Troubleshooting

| Symptom | First thing to try |
|---|---|
| "No account for team `<id>`" in Signing | Xcode → Settings → Accounts → your Apple ID → Download Manual Profiles; confirm Developer Program role is Agent or Admin |
| "No matching provisioning profile" after Download Manual Profiles | developer.apple.com → Identifiers → confirm Bundle ID exists and matches letter-for-letter; Devices → confirm your iPhone UDID is registered |
| SPM package resolution stalled / "Could not resolve packages" | Xcode → File → Packages → Reset Package Caches → Resolve Package Versions; if still stuck, `rm -rf ~/Library/Developer/Xcode/DerivedData` and reopen |
| Xcode MCP bridge not responding to Claude | `xcrun mcpbridge --version` in Terminal — if not found, reinstall Xcode additional components via Xcode → Settings → Platforms |
| Archive menu item is greyed out | Destination is a simulator — change to Any iOS Device (arm64) |
| Upload to App Store Connect fails with "Invalid bundle" | Most often a mismatched Bundle ID or an unregistered capability; check Info.plist entitlements match the App ID's enabled capabilities |
| Bootstrap loader shows white screen on device | Safari → Develop → `<your device>` → Road Trip — Console tab shows the JS error. Usually a missing/404 on `/bundle/manifest.json` |
| `xcodebuild -resolvePackageDependencies` hangs | Try with `-skipPackagePluginValidation` added; or just open in Xcode and let the UI resolve |
| "Developer Mode disabled" dialog on device | iOS Settings → Privacy & Security → Developer Mode → ON (device reboots) |
| TestFlight build stuck in "Processing" > 30 min | Check developer forums for current status; occasionally Apple's processing queue backs up. Re-upload is a last resort. |
| Team ID in Xcode doesn't match portal | Sign out and back in: Settings → Accounts → select Apple ID → `−` → `+` and re-add |

Anything unresolved after 15 minutes → commit what you have, push, and escalate to a WSL Claude session with a pointer to the error text.

---

## 10. Quick reference — the numbers you'll be asked for

Fill these in from `phase-5-decisions.md` before starting:

- Apple Team ID: `<apple-team-id>`
- Bundle Identifier: `<bundle-id>`
- Feature branch name: `<feature-branch-name>`
- Bundle hosting URL: `<bundle-hosting-url>`
- iOS deployment target: `<ios-deployment-target>`
- Internal testers (Apple IDs): `<tester-1>`, `<tester-2>`, …
