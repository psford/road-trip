#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_PROJECT="${PROJECT_ROOT}/src/RoadTripMap"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*" >&2; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

FAILED=0

echo "--- Worktree context ---"
GIT_TOPLEVEL="$(git -C "${PROJECT_ROOT}" rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "${GIT_TOPLEVEL}" ]]; then
    fail "Not inside a git repository."
    exit 1
fi
CURRENT_BRANCH="$(git -C "${PROJECT_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
pass "Branch: ${CURRENT_BRANCH} (${GIT_TOPLEVEL})"

echo "--- Toolchain ---"
if ! command -v dotnet &>/dev/null; then
    fail "dotnet SDK not found."
    FAILED=1
else
    pass "dotnet SDK: $(dotnet --version 2>/dev/null)"
fi

echo "--- Build ---"
if dotnet build "${APP_PROJECT}" --nologo -v quiet 2>&1 | tail -3; then
    pass "Build succeeded"
else
    fail "Build failed."
    FAILED=1
fi

echo "--- Environment ---"
if [[ -z "${WSL_SQL_CONNECTION:-}" ]]; then
    warn "WSL_SQL_CONNECTION not set — app will use appsettings fallback"
else
    pass "WSL_SQL_CONNECTION is set"
fi

if [[ "${SKIP_DB_CHECKS:-0}" != "1" ]] && command -v dotnet &>/dev/null; then
    echo "--- EF Core migration check ---"
    if dotnet ef migrations list --project "${APP_PROJECT}" --no-build 2>&1 | grep -q "Pending"; then
        warn "Pending migrations detected. They will run on app startup."
        warn "If migrations fail, check schema permissions (ALTER on roadtrip schema)."
    else
        pass "No pending migrations"
    fi
fi

echo ""
if [[ "${FAILED}" == "0" ]]; then
    echo -e "${GREEN}WORKTREE READY${NC}"
else
    echo -e "${RED}WORKTREE NOT READY — fix failures above${NC}"
    exit 1
fi
