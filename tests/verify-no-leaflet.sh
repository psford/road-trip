#!/bin/bash

# verify-no-leaflet.sh
# Verifies zero Leaflet remnants after migration to MapLibre GL JS
# Exit non-zero if any Leaflet references are found

set -e

FAILED=0

# AC1.4: No "leaflet" in post.html
echo "Checking AC1.4: post.html for 'leaflet'..."
if grep -rni "leaflet" src/RoadTripMap/wwwroot/post.html 2>/dev/null; then
    echo "FAIL: Found 'leaflet' in post.html"
    FAILED=1
else
    echo "PASS: No 'leaflet' found in post.html"
fi

# AC1.4: No "leaflet" in trips.html
echo "Checking AC1.4: trips.html for 'leaflet'..."
if grep -rni "leaflet" src/RoadTripMap/wwwroot/trips.html 2>/dev/null; then
    echo "FAIL: Found 'leaflet' in trips.html"
    FAILED=1
else
    echo "PASS: No 'leaflet' found in trips.html"
fi

# AC3.4: No Leaflet-specific methods in postUI.js
echo "Checking AC3.4: postUI.js for Leaflet methods (overflowTop, panBy, _adjustPan)..."
if grep -n "overflowTop\|panBy\|_adjustPan" src/RoadTripMap/wwwroot/js/postUI.js 2>/dev/null; then
    echo "FAIL: Found Leaflet methods in postUI.js"
    FAILED=1
else
    echo "PASS: No Leaflet methods found in postUI.js"
fi

# AC6.1: No "leaflet" anywhere in src/
echo "Checking AC6.1: src/ for 'leaflet' references..."
if grep -ri "leaflet" src/ --include="*.js" --include="*.html" --include="*.css" 2>/dev/null | grep -v node_modules; then
    echo "FAIL: Found 'leaflet' references in src/"
    FAILED=1
else
    echo "PASS: No 'leaflet' references found in src/"
fi

# AC6.2: No ".leaflet" in styles.css
echo "Checking AC6.2: styles.css for '.leaflet' selectors..."
if grep -n "\.leaflet" src/RoadTripMap/wwwroot/css/styles.css 2>/dev/null; then
    echo "FAIL: Found '.leaflet' CSS selectors in styles.css"
    FAILED=1
else
    echo "PASS: No '.leaflet' CSS selectors found in styles.css"
fi

# AC6.3: No Leaflet API calls (L.map, L.marker, L.polyline, L.tileLayer)
echo "Checking AC6.3: JS files for Leaflet API calls (L.map, L.marker, L.polyline, L.tileLayer)..."
if grep -rn "L\.map\|L\.marker\|L\.polyline\|L\.tileLayer" src/RoadTripMap/wwwroot/js/ 2>/dev/null; then
    echo "FAIL: Found Leaflet API calls in JS files"
    FAILED=1
else
    echo "PASS: No Leaflet API calls found in JS files"
fi

if [ $FAILED -ne 0 ]; then
    echo ""
    echo "VERIFICATION FAILED: Leaflet remnants detected"
    exit 1
fi

echo ""
echo "VERIFICATION PASSED: No Leaflet remnants found"
exit 0
