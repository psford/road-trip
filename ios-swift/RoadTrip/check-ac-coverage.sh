#!/usr/bin/env bash
# check-ac-coverage.sh
#
# Scans RoadTripUITests/RoadTripUITests.swift for test functions whose doc-comment
# references an AC (e.g. AC1.1, AC5.4) and flags any that contain ONLY existence
# assertions (waitForExistence / .exists / isHittable) with no behavioral assertion.
#
# A behavioral assertion is any of:
#   .tap()          typeText(      XCTAssertEqual    XCTAssertFalse
#   XCTAssertNil    XCTAssertNotNil  XCTWaiter.wait   NSPredicate expectation
#   waitForNonExistence  swipeLeft  swipeRight  press(forDuration  coordinate(
#
# Exit 0  → all AC-tagged tests have at least one behavioral assertion.
# Exit 1  → one or more AC-tagged tests are existence-only; list printed to stdout.
# Exit 2  → usage/config error.
#
# Usage: bash ios-swift/RoadTrip/check-ac-coverage.sh
#        (run from any directory; script resolves its own path)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE="$SCRIPT_DIR/RoadTripUITests/RoadTripUITests.swift"

if [[ ! -f "$TARGET_FILE" ]]; then
    echo "error: cannot find $TARGET_FILE" >&2
    exit 2
fi

# ─── Core logic via awk ───────────────────────────────────────────────────────
#
# awk is POSIX and available on macOS bash 3.2 without mapfile.
#
# Strategy:
#   - Track doc-comment lines immediately preceding each func declaration.
#   - When a "func test" line is encountered, record whether the preceding
#     doc block mentions an AC.
#   - Accumulate body lines from the opening brace until brace depth returns
#     to 0 (body_started = 1 ensures we wait for the first brace before counting
#     back down to 0).
#   - At function end, if the function is AC-tagged and has no behavioral
#     assertion, add it to the offenders list.

OFFENDERS=$(awk '
BEGIN {
    depth = 0
    in_func = 0
    body_started = 0
    func_name = ""
    has_ac = 0
    has_behavioral = 0
    doc_buf = ""
    offenders = ""
}

# Count occurrences of a single character c in string s (POSIX awk)
function count_char(s, c,    n, i) {
    n = 0
    for (i = 1; i <= length(s); i++) {
        if (substr(s, i, 1) == c) n++
    }
    return n
}

function contains(s, p) {
    return index(s, p) > 0
}

{
    line = $0

    # ── Outside a function: maintain the rolling doc-comment buffer ──────────
    if (!in_func) {
        if (line ~ /^[[:space:]]*\/\/\//) {
            doc_buf = doc_buf " " line
        } else if (line ~ /^[[:space:]]*func[[:space:]]+test[A-Za-z0-9_]+[[:space:]]*\(/) {
            # func line — process below; keep doc_buf intact
            ;
        } else if (line !~ /^[[:space:]]*$/) {
            # Non-blank, non-comment, non-func: reset doc buffer
            doc_buf = ""
        }
    }

    # ── Detect test function start ────────────────────────────────────────────
    if (!in_func && line ~ /^[[:space:]]*func[[:space:]]+test[A-Za-z0-9_]+[[:space:]]*\(/) {
        # Extract function name using POSIX sub (no 3-arg match)
        tmp = line
        sub(/.*func[[:space:]]+/, "", tmp)
        sub(/[[:space:](].*/, "", tmp)
        func_name = tmp

        # Does the preceding doc-comment reference an AC?
        has_ac = (doc_buf ~ /AC[0-9]+\.[0-9]+/) ? 1 : 0
        has_behavioral = 0
        body_started = 0
        depth = 0
        in_func = 1
        doc_buf = ""
    }

    # ── Track brace depth and body content once inside a function ────────────
    if (in_func) {
        opens  = count_char(line, "{")
        closes = count_char(line, "}")
        depth  = depth + opens - closes

        # Mark that the function body has begun (first { seen)
        if (opens > 0) body_started = 1

        # Check behavioral assertions (only needed for AC-tagged tests)
        if (has_ac && !has_behavioral) {
            if (contains(line, ".tap()"))                    has_behavioral = 1
            else if (contains(line, "typeText("))            has_behavioral = 1
            else if (contains(line, "XCTAssertEqual"))       has_behavioral = 1
            else if (contains(line, "XCTAssertFalse"))       has_behavioral = 1
            else if (contains(line, "XCTAssertNil"))         has_behavioral = 1
            else if (contains(line, "XCTAssertNotNil"))      has_behavioral = 1
            else if (contains(line, "XCTWaiter.wait"))       has_behavioral = 1
            else if (contains(line, "NSPredicate"))          has_behavioral = 1
            else if (contains(line, "wait(for:"))            has_behavioral = 1
            else if (contains(line, "waitForNonExistence"))  has_behavioral = 1
            else if (contains(line, "swipeLeft"))            has_behavioral = 1
            else if (contains(line, "swipeRight"))           has_behavioral = 1
            else if (contains(line, "swipeUp"))              has_behavioral = 1
            else if (contains(line, "swipeDown"))            has_behavioral = 1
            else if (contains(line, "press(forDuration"))    has_behavioral = 1
            else if (contains(line, "coordinate(withNormalizedOffset")) has_behavioral = 1
        }

        # Function ends when brace depth drops to 0 after the body opened
        if (body_started && depth <= 0) {
            in_func = 0
            body_started = 0
            if (has_ac && !has_behavioral) {
                offenders = offenders " " func_name
            }
            func_name = ""
        }
    }
}

END {
    sub(/^ /, "", offenders)
    print offenders
}
' "$TARGET_FILE")

# ─── Report ───────────────────────────────────────────────────────────────────

if [[ -z "$OFFENDERS" ]]; then
    echo "check-ac-coverage: OK — all AC-tagged tests have at least one behavioral assertion."
    exit 0
fi

echo "check-ac-coverage: FAIL — the following AC-tagged tests contain only existence assertions:"
echo ""
for name in $OFFENDERS; do
    echo "  - $name"
done
echo ""
echo "These tests reference an AC in their doc-comment but every assertion is"
echo "waitForExistence/.exists/isHittable only.  Add at least one behavioral"
echo "assertion (.tap(), typeText, XCTAssertEqual/False/Nil/NotNil, NSPredicate"
echo "expectation, waitForNonExistence, swipe, press) or document why the test"
echo "is intentionally existence-only."
exit 1
