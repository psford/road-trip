#!/usr/bin/env bash
# audit-failed-uploads.sh — Query prod DB for failed/pending uploads from last 30 days
#
# Usage: ./scripts/audit-failed-uploads.sh
#
# Prerequisites:
#   - az CLI logged in with access to kv-roadtripmap-prod
#   - sqlcmd installed (brew install sqlcmd)
#
# Output: TSV of photo_id, trip_id, status, last_activity_at, upload_id
# Each entry needs resolution: retry | pin-drop | discard | orphan-swept

set -euo pipefail

echo "Fetching prod connection string from Key Vault..."
CONN=$(az keyvault secret show \
  --vault-name kv-roadtripmap-prod \
  --name RoadTripDbConnection \
  --query value -o tsv)

if [ -z "$CONN" ]; then
  echo "ERROR: Could not fetch connection string from Key Vault."
  echo "Ensure you are logged in: az login"
  exit 1
fi

# Extract server and database from connection string
SERVER=$(echo "$CONN" | grep -oP 'Server=tcp:\K[^,;]+')
DATABASE=$(echo "$CONN" | grep -oP 'Database=\K[^;]+')

echo "Querying ${DATABASE} on ${SERVER} for failed/pending uploads (last 30 days)..."
echo ""

sqlcmd -S "$SERVER" -d "$DATABASE" -Q "
SELECT
  Id AS photo_id,
  TripId AS trip_id,
  Status AS status,
  LastActivityAt AS last_activity_at,
  UploadId AS upload_id
FROM roadtrip.Photos
WHERE Status IN ('failed', 'pending')
  AND LastActivityAt > DATEADD(day, -30, GETUTCDATE())
ORDER BY LastActivityAt DESC
" -s $'\t' -W

echo ""
echo "Resolution options for each entry:"
echo "  retry      - Use new UI to retry the upload"
echo "  pin-drop   - Use manual pin-drop to salvage location"
echo "  discard    - User explicitly discards"
echo "  orphan-swept - Will be cleaned by OrphanSweeper after 48h"
echo ""
echo "Record each resolution in phase-4-acceptance.md"
