#!/usr/bin/env bash
#
# Poll Overpass API until it responds, then run the POI seeder.
#
# The Overpass public API (overpass-api.de) goes down for hours under load.
# This script pings it every INTERVAL seconds with a tiny test query.
# When it responds successfully, it runs the seeder with --overpass-only.
#
# Usage:
#   ./scripts/poll-overpass.sh                  # default: poll every 60s
#   ./scripts/poll-overpass.sh --interval 30    # poll every 30s
#   ./scripts/poll-overpass.sh --once           # try once, exit
#
# The script sources .env for NPS_API_KEY (needed by the seeder even in
# overpass-only mode due to the Program.cs structure).

set -euo pipefail
cd "$(dirname "$0")/.."

INTERVAL=60
ONCE=false
PROBE_TIMEOUT=15
PROBE_QUERY='[out:json][timeout:10];node["natural"="peak"](44.2,-71.4,44.3,-71.2);out body 1;'
OVERPASS_URL="https://overpass-api.de/api/interpreter"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --interval) INTERVAL="$2"; shift 2 ;;
        --once)     ONCE=true; shift ;;
        *)          echo "Unknown arg: $1"; exit 1 ;;
    esac
done

# Source .env if it exists
if [[ -f .env ]]; then
    set -a
    source .env
    set +a
fi

echo "Overpass poller started (interval: ${INTERVAL}s)"
echo "Probe query: peaks near Mt Washington (44.2-44.3, -71.4--71.2)"
echo ""

attempt=0
while true; do
    attempt=$((attempt + 1))
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    result=$(curl -s --max-time "$PROBE_TIMEOUT" -X POST "$OVERPASS_URL" \
        -H "User-Agent: RoadTripMap/1.0 (poll-overpass)" \
        --data-urlencode "data=$PROBE_QUERY" 2>&1 || true)

    if echo "$result" | grep -q '"elements"'; then
        # Parse element count
        count=$(echo "$result" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('elements',[])))" 2>/dev/null || echo "?")
        echo "[$timestamp] Attempt $attempt: SUCCESS — $count peaks returned"
        echo ""
        echo "Overpass is up. Running seeder with --overpass-only..."
        echo ""

        dotnet run --project src/RoadTripMap.PoiSeeder -- --overpass-only 2>&1

        echo ""
        echo "Seeder complete. Verifying POI count..."
        # Quick check via the API if the app is running
        poi_count=$(curl -s --max-time 5 "http://localhost:5143/api/poi?minLat=24&maxLat=50&minLng=-125&maxLng=-66&zoom=10" 2>/dev/null \
            | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "app not running")
        echo "POI API returns: $poi_count POIs (capped at 200)"
        exit 0
    else
        # Extract error type
        if echo "$result" | grep -q "timeout"; then
            reason="server overloaded (timeout)"
        elif echo "$result" | grep -q "429"; then
            reason="rate limited (429)"
        elif echo "$result" | grep -q "503"; then
            reason="service unavailable (503)"
        elif [[ -z "$result" ]]; then
            reason="no response"
        else
            reason="error ($(echo "$result" | head -1 | cut -c1-60))"
        fi

        echo "[$timestamp] Attempt $attempt: $reason"

        if $ONCE; then
            echo "Single attempt mode (--once). Exiting."
            exit 1
        fi

        sleep "$INTERVAL"
    fi
done
