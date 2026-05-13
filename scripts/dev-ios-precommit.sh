#!/usr/bin/env bash
# Pre-commit guard: refuse to commit if local-dev-loop artifacts are present.
# Install: ln -s ../../scripts/dev-ios-precommit.sh .git/hooks/pre-commit
set -eu

staged=$(git diff --cached --name-only 2>/dev/null || true)

# Block if the dev meta tag landed in the staged index
if git diff --cached -- src/bootstrap/index.html 2>/dev/null | grep -q '^\+.*app-base-override'; then
  echo "Blocked: src/bootstrap/index.html still contains the dev <meta name=\"app-base-override\"> tag."
  echo "Run: node scripts/dev-ios-off.js  (then re-stage and commit)."
  exit 1
fi

# Block if server.url ended up in the staged capacitor.config.js
if git diff --cached -- capacitor.config.js 2>/dev/null | grep -qE '^\+\s*url\s*:'; then
  echo "Blocked: capacitor.config.js still contains a dev server.url."
  echo "Run: node scripts/dev-ios-off.js  (then re-stage and commit)."
  exit 1
fi

# Block if cleartext: true ended up staged
if git diff --cached -- capacitor.config.js 2>/dev/null | grep -qE '^\+\s*cleartext\s*:\s*true'; then
  echo "Blocked: capacitor.config.js has cleartext: true staged."
  echo "Run: node scripts/dev-ios-off.js  (then re-stage and commit)."
  exit 1
fi

exit 0
