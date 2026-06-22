#!/usr/bin/env bash
# .githooks/install.sh
#
# Activates the committed git hooks in .githooks/ for this repository.
# Run once after cloning or checking out the branch:
#
#   bash .githooks/install.sh
#
# What it does:
#   1. Sets git config core.hooksPath to .githooks (so git uses the committed hooks).
#   2. Makes all hook scripts executable.
#
# The hooks are committed in .githooks/ so they are version-controlled and
# shared with all contributors. They are NOT active until install.sh is run
# (git does not auto-activate hooks from arbitrary paths).
#
# To disable the hooks for a single operation: git commit --no-verify / git push --no-verify
# To uninstall: git config --unset core.hooksPath

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

echo "Installing git hooks from .githooks/ ..."

# Set the hooks path to the committed .githooks/ directory
git -C "$REPO_ROOT" config core.hooksPath .githooks
echo "  set core.hooksPath = .githooks"

# Make all hook scripts executable
for hook in "$SCRIPT_DIR"/*; do
    if [[ -f "$hook" && "$(basename "$hook")" != "install.sh" ]]; then
        chmod +x "$hook"
        echo "  chmod +x $(basename "$hook")"
    fi
done

echo ""
echo "Git hooks installed. Active hooks:"
echo "  pre-commit  — blocks PhotosPicker missing photoLibrary:, removePersistentDomain,"
echo "                project.yml guard removal, and .md basename collisions."
echo "                Warns on new large helper files without companion tests."
echo "  pre-push    — runs xcodegen + build-for-testing when ios-swift/ changes."
echo ""
echo "To bypass a single operation: git commit --no-verify  /  git push --no-verify"
echo "To uninstall: git config --unset core.hooksPath"
