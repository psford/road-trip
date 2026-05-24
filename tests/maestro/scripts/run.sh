#!/usr/bin/env bash
# Layer 2 (Maestro on iOS Simulator) test runner.
#
# Boots a simulator if needed, installs the most recently built App.app from
# DerivedData, then drives the Maestro flows in tests/maestro/flows.
#
# Assumes the iOS app has already been built. Build via:
#   - Xcode UI (Cmd+B), or
#   - the xcode MCP `BuildProject` tool from Claude
# This script does NOT invoke xcodebuild (Patrick's deny-list rule), and
# it does NOT run `cap sync` (also denied for Claude). If you've changed
# anything under src/bootstrap/ or capacitor.config.js, run `cap sync ios`
# yourself before re-running.
#
# Env overrides:
#   MAESTRO_DEVICE_NAME   Device name to boot/use (default: "iPhone 17")
#   MAESTRO_FLOW          Run a single flow file instead of the whole dir
#   MAESTRO_BIN           Path to maestro CLI (default: $HOME/.maestro/bin/maestro)
#   JAVA_HOME             Path to a JDK 17+ (required by Maestro)

set -euo pipefail

DEVICE_NAME="${MAESTRO_DEVICE_NAME:-iPhone 17}"
MAESTRO_BIN="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
FLOWS_DIR="$(cd "$(dirname "$0")/.." && pwd)/flows"
FLOW="${MAESTRO_FLOW:-$FLOWS_DIR}"
APP_BUNDLE_ID="com.psford.roadtripmap"

# --- 1. Tool prerequisites ---
if [ ! -x "$MAESTRO_BIN" ]; then
  echo "ERROR: maestro not found at $MAESTRO_BIN"
  echo "Install: curl -Ls \"https://get.maestro.mobile.dev\" | bash"
  exit 1
fi

if [ -z "${JAVA_HOME:-}" ]; then
  # Try common Homebrew paths
  for try in /opt/homebrew/opt/openjdk@17 /opt/homebrew/opt/openjdk@21 /usr/local/opt/openjdk@17; do
    if [ -d "$try" ]; then export JAVA_HOME="$try"; break; fi
  done
fi
if [ -z "${JAVA_HOME:-}" ] || [ ! -d "$JAVA_HOME" ]; then
  echo "ERROR: JAVA_HOME not set and no Homebrew JDK detected."
  echo "Install: brew install openjdk@17"
  echo "Then:    export JAVA_HOME=/opt/homebrew/opt/openjdk@17"
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"

# --- 2. Locate device + boot if needed ---
DEVICE_UDID=$(xcrun simctl list devices available \
  | grep -F "$DEVICE_NAME (" \
  | head -1 \
  | grep -oE '\([A-F0-9-]{36}\)' \
  | tr -d '()')

if [ -z "$DEVICE_UDID" ]; then
  echo "ERROR: no available simulator matching '$DEVICE_NAME'"
  echo "List: xcrun simctl list devices available"
  exit 1
fi

DEVICE_STATE=$(xcrun simctl list devices | grep -F "$DEVICE_UDID" | grep -oE '\((Booted|Shutdown)\)' | head -1 | tr -d '()')
if [ "$DEVICE_STATE" != "Booted" ]; then
  echo "Booting $DEVICE_NAME ($DEVICE_UDID)..."
  xcrun simctl boot "$DEVICE_UDID"
fi
open -a Simulator

# --- 3. Locate and install most recent App.app ---
APP_PATH=$(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -name "App.app" -path "*Debug-iphonesimulator*" -type d \
  -not -path "*Index.noindex*" \
  -print0 2>/dev/null \
  | xargs -0 ls -dt 2>/dev/null \
  | head -1)

if [ -z "$APP_PATH" ]; then
  echo "ERROR: no App.app found in DerivedData."
  echo "Build the iOS app first (Xcode Cmd+B or xcode MCP BuildProject)."
  exit 1
fi

echo "Installing $APP_PATH"
xcrun simctl install "$DEVICE_UDID" "$APP_PATH"

# --- 4. Run Maestro flow(s) ---
echo "Running Maestro flow: $FLOW"
exec "$MAESTRO_BIN" test "$FLOW"
