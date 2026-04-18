# Phase 1 Deployment Runbook: Resilient Uploads

**Last Updated:** April 2026  
**Phase:** Phase 1 (Subcomponents A–I, Tasks 1–18)  
**Scope:** Enable per-trip blob containers, implement resilient upload service, add backfill job, provision infrastructure role assignment, and deploy to production.

---

## Prerequisites

Before starting deployment:

- **PR merged:** The Phase 1 feature branch PR is merged to `main` with all CI checks passing.
- **Local tooling (WSL bash):**
  - `az` CLI 2.50+
  - `.NET 8` SDK (or later)
  - `sqlcmd` (SQL Server command-line utility)
  - `git`
- **Azure credentials:**
  - Service principal: `github-deploy-rt` (object ID `5693632f-69d8-4482-9820-355c3bea04c3`)
  - Must be logged in via `az login --service-principal` or via federated identity
  - Verify identity matches `.claude/azure-identity.json` in the repo
- **Deployment slots:**
  - App Service `app-roadtripmap-prod` is deployed via staging slot (blue/green pattern) for safe rollback

---

## 1. Pre-flight Checks

### [Azure Portal] Verify Service Principal Identity

1. Navigate to Azure Portal.
2. Open **Azure Active Directory** → **App registrations** (or **Enterprise applications**).
3. Search for `github-deploy-rt`.
4. Note the **Object ID** (must match `5693632f-69d8-4482-9820-355c3bea04c3`).

### [bash/WSL] Confirm Git State

```bash
cd /home/patrick/projects/road-trip
git fetch origin
git log origin/main..develop --oneline
```

**Expected outcome:** No output (develop is not ahead of main; PR is merged).

### [bash/WSL] Confirm Azure SP Login

```bash
az account show --query "{subscriptionId: subscriptionId, tenantId: tenantId, user: user.name}" -o json
```

**Expected output:** JSON showing subscription, tenant, and user matching the `github-deploy-rt` SP.

### [GitHub web] Verify PR Merge and CI

1. Navigate to the resilient-uploads Phase 1 feature branch PR.
2. Confirm status: **MERGED** (not open, not draft).
3. Confirm the last commit has a green ✅ **CI passed** badge on all checks.

**Deviation log entry (if PR status differs):**  
[ ] PR is merged  
[ ] All CI checks passed  

---

## 2. Database Migration

### [bash/WSL] Retrieve Prod Connection String

```bash
az keyvault secret show \
  --vault-name kv-roadtripmap-prod \
  --name DbConnectionString \
  --query value -o tsv
```

**Expected:** A connection string starting with `Server=sql-roadtripmap-prod.database.windows.net;...`

Save this value as `$PROD_CONN` for the next steps:

```bash
PROD_CONN="$(az keyvault secret show --vault-name kv-roadtripmap-prod --name DbConnectionString --query value -o tsv)"
```

### [bash/WSL] Apply EF Core Migration

```bash
cd /home/patrick/projects/road-trip
dotnet ef database update \
  --project src/RoadTripMap \
  --startup-project src/RoadTripMap \
  --connection "$PROD_CONN"
```

**Expected output:** Migration applied successfully; log shows migrations applied.

### [bash/WSL] Verify Schema Changes

Extract the SQL Server hostname from the connection string and verify all required columns exist:

```bash
# Extract host from connection string (format: Server=<host>;Database=...)
HOST=$(echo "$PROD_CONN" | sed -n 's/.*Server=\([^;]*\).*/\1/p')

# Query SQL Server for new columns in Photos table
sqlcmd -S "$HOST" -d RoadTripMap -U "$(whoami)@$(echo $HOST | cut -d. -f1)" -Q \
  "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('roadtrip.Photos') AND name IN ('Status','StorageTier','UploadId','LastActivityAt','UploadAttemptCount') ORDER BY name"
```

**Expected output:** Five rows: `LastActivityAt`, `Status`, `StorageTier`, `UploadAttemptCount`, `UploadId`.

### [bash/WSL] Rollback (if needed)

To revert the migration to the prior state, find the previous migration name in the codebase:

```bash
cd /home/patrick/projects/road-trip
dotnet ef migrations list | tail -2  # List last two migrations
```

Then revert:

```bash
dotnet ef database update <previous-migration-name> --connection "$PROD_CONN"
```

**Rollback sign-off:** [ ] Complete  

---

## 3. Infrastructure Deployment (Bicep Role Assignment)

### [bash/WSL] Prepare Bicep What-If

```bash
cd /home/patrick/projects/road-trip

# Confirm you're still logged in as the correct SP
az account show --query "user.name" -o tsv

# Run what-if to preview changes
az deployment group create \
  --resource-group rg-roadtripmap-prod \
  --template-file infrastructure/azure/main.bicep \
  --parameters @infrastructure/azure/parameters.json \
  --what-if
```

**Expected output:** Diff preview showing:
- **NEW:** `Microsoft.Authorization/roleAssignments` resource for `storageAccount` scope
- **Resource:** Storage Blob Data Contributor role
- **Principal:** App Service identity (`app-roadtripmap-prod`)
- **NO OTHER CHANGES** (no storage account modifications, no SQL changes, etc.)

If the what-if shows unexpected changes, **STOP and investigate** before proceeding.

### [bash/WSL] Apply Bicep Deployment

```bash
# Remove --what-if to actually deploy
az deployment group create \
  --resource-group rg-roadtripmap-prod \
  --template-file infrastructure/azure/main.bicep \
  --parameters @infrastructure/azure/parameters.json
```

**Expected output:** Deployment completes with status `"Succeeded"`.

### [Azure Portal] Verify IAM Role Assignment

1. Navigate to [Azure Portal](https://portal.azure.com).
2. Open **Resource groups** → **rg-roadtripmap-prod**.
3. Open **Storage accounts** → **storoadtripmapprod**.
4. Open **Access Control (IAM)** (left sidebar).
5. Search for the App Service identity: `app-roadtripmap-prod`.
6. Confirm **Role:** `Storage Blob Data Contributor`.

**Deviation log entry:**  
[ ] Bicep deployment succeeded  
[ ] IAM role assignment confirmed in portal  

### [bash/WSL] Rollback (if needed)

Revert to the previous Bicep template (before the role assignment was added):

```bash
# Obtain the previous template from git history
git show HEAD~1:infrastructure/azure/main.bicep > /tmp/main.bicep.prev

# Redeploy with the previous template
az deployment group create \
  --resource-group rg-roadtripmap-prod \
  --template-file /tmp/main.bicep.prev \
  --parameters @infrastructure/azure/parameters.json
```

The old role assignment resource will remain in the subscription (harmless); it is not re-created.

---

## 4. App Service Deploy

### [GitHub web] Trigger Manual Deployment Workflow

1. Navigate to the [road-trip repository on GitHub](https://github.com/psford/road-trip).
2. Open **Actions** tab.
3. Select **Deploy to Azure Production** workflow.
4. Click **Run workflow** (right side).
5. **Inputs:**
   - **Type "deploy" to confirm:** `deploy`
   - **Reason:** `Phase 1: resilient uploads, per-trip containers, and backfill job`
6. Click **Run workflow**.

**Expected:** Workflow job `preflight` starts and validates the confirmation string.

### [GitHub web] Monitor Workflow Completion

1. Click on the running workflow to open the job log.
2. Wait for all steps to complete (typically 5–10 minutes):
   - `preflight` — validates input
   - `build` — builds Docker image
   - `push-to-acr` — pushes to Azure Container Registry
   - `deploy-to-app-service` — deploys to staging slot
3. Confirm final status: **✅ All steps passed**.

**Note:** If MFA is required for `az login` on your machine, you may need to perform the login in PowerShell on Windows and wait for the refresh token to propagate to WSL. The workflow will retry automatically.

**Workflow run link:** https://github.com/psford/road-trip/actions/workflows/deploy.yml

### [bash/WSL] Verify Server Version Endpoint

Wait 30 seconds for the new deployment to stabilize, then test the version endpoint:

```bash
curl -i https://app-roadtripmap-prod.azurewebsites.net/api/version
```

**Expected output:**
- **HTTP Status:** `200 OK`
- **Response body:** JSON with `server_version` and `client_min_version`
- **Headers:** `x-server-version` and `x-client-min-version` present

Example:
```
HTTP/2 200
x-server-version: 1.0.0
x-client-min-version: 1.0.0

{"server_version":"1.0.0","client_min_version":"1.0.0"}
```

**Deviation log entry:**  
[ ] Workflow deployment succeeded  
[ ] `/api/version` responds with correct headers and version numbers  

### [bash/WSL] Rollback (if needed)

Revert to the previous App Service deployment slot:

```bash
# Swap staging (new) and production (old) slots to restore previous version
az webapp deployment slot swap \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --slot staging
```

App Service will resume running the prior container image.

---

## 5. Container Backfill

### [bash/WSL] Enable Backfill Startup Job

Set the `Backfill:RunOnStartup` configuration flag and restart the App Service:

```bash
# Set the app setting
az webapp config appsettings set \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --settings Backfill:RunOnStartup=true

# Restart the app
az webapp restart \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod
```

**Expected output:** Restart command returns successfully.

### [bash/WSL] Monitor Backfill Log Output

Wait 30–60 seconds for the app to start, then tail the App Service logs to confirm the backfill job ran:

```bash
az webapp log tail \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --follow
```

Look for a log entry matching:

```
ContainerBackfillHostedService: Backfill completed. Created or verified N containers for N trips.
```

Once you see this message, press `Ctrl+C` to stop tailing.

### [bash/WSL] Verify Container Count in Storage Account

Query the storage account to count per-trip containers (named `trip-*`):

```bash
az storage container list \
  --account-name storoadtripmapprod \
  --auth-mode login \
  --query "[?starts_with(name, 'trip-')].name" -o tsv | wc -l
```

**Expected outcome:** A positive integer equal to the number of trips currently in the database.

To verify this count matches the DB, run:

```bash
PROD_CONN="$(az keyvault secret show --vault-name kv-roadtripmap-prod --name DbConnectionString --query value -o tsv)"
HOST=$(echo "$PROD_CONN" | sed -n 's/.*Server=\([^;]*\).*/\1/p')

sqlcmd -S "$HOST" -d RoadTripMap -U "$(whoami)@$(echo $HOST | cut -d. -f1)" -Q \
  "SELECT COUNT(*) FROM roadtrip.Trips"
```

The container count should match the trip count.

### [bash/WSL] Disable Backfill Startup Job

After confirming all containers are created, disable the startup job to prevent re-running on every restart:

```bash
az webapp config appsettings set \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --settings Backfill:RunOnStartup=false

# Restart the app
az webapp restart \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod
```

**Deviation log entry:**  
[ ] Backfill startup job completed  
[ ] Container count verified (matches trip count)  
[ ] Backfill startup job disabled  

---

## 6. Post-Deploy Smoke Tests

### [bash/WSL] Regression Test: Existing Trip Photo List

1. Obtain a real secret token from a pre-existing trip (ask Patrick or check logs).
2. Query the photos endpoint:

```bash
curl https://app-roadtripmap-prod.azurewebsites.net/api/trips/<secret-token>/photos \
  -H "Accept: application/json"
```

**Expected:** HTTP 200 with a JSON array of photos. The count and structure should match pre-deploy baseline (compare against a screenshot or note taken before deploy).

### [bash/WSL] New Upload Round Trip

1. Create a test trip:

```bash
TEST_TRIP_JSON=$(curl -s -X POST \
  https://app-roadtripmap-prod.azurewebsites.net/api/trips \
  -H "Content-Type: application/json" \
  -d '{"name": "Deploy smoke test"}')

TEST_TOKEN=$(echo "$TEST_TRIP_JSON" | jq -r '.secret_token')
echo "Created test trip with token: $TEST_TOKEN"
```

2. Request an upload:

```bash
UPLOAD_JSON=$(curl -s -X POST \
  https://app-roadtripmap-prod.azurewebsites.net/api/trips/$TEST_TOKEN/photos/request-upload \
  -H "Content-Type: application/json" \
  -d '{"upload_id": "'"$(uuidgen)"'"}')

SAS_URL=$(echo "$UPLOAD_JSON" | jq -r '.sas_url')
PHOTO_ID=$(echo "$UPLOAD_JSON" | jq -r '.photo_id')
echo "Received SAS URL (first 80 chars): ${SAS_URL:0:80}..."
echo "Photo ID: $PHOTO_ID"
```

3. Upload a small test block (use a temporary file):

```bash
# Create a small test file (1 MB)
dd if=/dev/zero bs=1M count=1 of=/tmp/test-block.bin

# Upload as a block using the SAS URL
curl -X PUT \
  "$SAS_URL?comp=block&blockid=YmxvY2sxMDA=" \
  -H "Content-Length: 1048576" \
  --data-binary "@/tmp/test-block.bin"

rm /tmp/test-block.bin
```

4. Commit the upload:

```bash
COMMIT_JSON=$(curl -s -X POST \
  https://app-roadtripmap-prod.azurewebsites.net/api/trips/$TEST_TOKEN/photos/$PHOTO_ID/commit \
  -H "Content-Type: application/json" \
  -d '{"block_ids": ["YmxvY2sxMDA="]}')

echo "Commit response: $(echo $COMMIT_JSON | jq '.') "
```

5. Verify the photo appears in the trip's photo list:

```bash
curl -s https://app-roadtripmap-prod.azurewebsites.net/api/trips/$TEST_TOKEN/photos \
  | jq 'length'
```

**Expected:** Output shows `1` (or more if other photos exist in the test trip).

### [bash/WSL] Monitor Orphan Sweeper (Optional, takes up to 1 hour)

The `OrphanSweeperHostedService` runs every hour. To confirm it is active, check logs:

```bash
az webapp log tail \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --follow
```

Look for log entries matching:

```
OrphanSweeperHostedService: Sweep cycle completed. Deleted N rows with status='pending' and last_activity_at < threshold.
```

This entry should appear approximately hourly. If it does not appear within 2 hours of deployment, investigate the hosted service registration in `Program.cs`.

**Deviation log entry:**  
[ ] Existing trip photos regression test passed  
[ ] New upload round trip succeeded  
[ ] Orphan sweeper log entry verified (or deferred to next hour)  

---

## 7. Rollback Procedure

If any critical issue arises after deployment, execute the following steps **in reverse order** (bottom to top):

### Rollback Step 1: Revert App Service

```bash
# Swap staging and production slots to restore the previous version
az webapp deployment slot swap \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --slot staging
```

Wait 2–3 minutes for the swap to complete, then re-test the `/api/version` endpoint to confirm the old version is running.

### Rollback Step 2: Revert Bicep Role Assignment

```bash
# Obtain the previous Bicep template and redeploy it
git show HEAD~1:infrastructure/azure/main.bicep > /tmp/main.bicep.prev

az deployment group create \
  --resource-group rg-roadtripmap-prod \
  --template-file /tmp/main.bicep.prev \
  --parameters @infrastructure/azure/parameters.json
```

The old role assignment remains; re-running the old template does not delete it. To clean up (optional), manually delete the role assignment via the Azure Portal.

### Rollback Step 3: Revert Database Migration

```bash
PROD_CONN="$(az keyvault secret show --vault-name kv-roadtripmap-prod --name DbConnectionString --query value -o tsv)"

# List migrations and find the one prior to the Phase 1 migration
cd /home/patrick/projects/road-trip
dotnet ef migrations list | tail -2

# Revert to the previous migration
dotnet ef database update <previous-migration-name> --connection "$PROD_CONN"
```

Wait for the migration to complete. Confirm via SQL query (see section 2).

---

## 8. Sign-Off and Deviation Log

### Approval Chain

After completing all sections above, obtain sign-off from Patrick:

| Section | Status | Signed By | Timestamp (UTC) |
|---------|--------|-----------|-----------------|
| 1. Pre-flight | ☐ Pass / ☐ Deviation | | |
| 2. DB Migration | ☐ Pass / ☐ Deviation | | |
| 3. Bicep Deploy | ☐ Pass / ☐ Deviation | | |
| 4. App Service Deploy | ☐ Pass / ☐ Deviation | | |
| 5. Container Backfill | ☐ Pass / ☐ Deviation | | |
| 6. Post-Deploy Smoke | ☐ Pass / ☐ Deviation | | |

### Deviation Log

Record any deviations from the runbook below:

| Step | Expected | Actual | Resolution | Sign-off |
|------|----------|--------|------------|----------|
| | | | | |
| | | | | |
| | | | | |

**Final Status:** ☐ **DEPLOYMENT SUCCEEDED** / ☐ **DEPLOYMENT ROLLED BACK**

**Patrick's Final Sign-Off:**

```
Initials: _____
UTC Timestamp: _____
Commit this runbook with any deviations recorded.
```

---

## Appendix: Commands by Shell

All commands are annotated with the required shell. Quick reference:

- **[bash/WSL]** — Execute in WSL2 bash shell (Linux environment)
- **[Windows PowerShell]** — Execute in Windows PowerShell (if needed for MFA or Windows-specific tools)
- **[Azure Portal]** — Use Azure web portal at https://portal.azure.com
- **[GitHub web]** — Use GitHub web interface at https://github.com/psford/road-trip

---

## Appendix: Key Azure Resources

| Resource | Value |
|----------|-------|
| Subscription | (varies per Azure tenant) |
| Resource Group | `rg-roadtripmap-prod` |
| App Service | `app-roadtripmap-prod` |
| Storage Account | `storoadtripmapprod` |
| Key Vault | `kv-roadtripmap-prod` |
| SQL Server | `sql-roadtripmap-prod.database.windows.net` |
| SQL Database | `RoadTripMap` |
| Service Principal | `github-deploy-rt` (object ID `5693632f-69d8-4482-9820-355c3bea04c3`) |
| Prod Base URL | `https://app-roadtripmap-prod.azurewebsites.net` |

---

---

## Phase 2 — Web upload rollout

**Phase:** Phase 2 (Subcomponents A–H, Tasks 1–16)  
**Scope:** Deploy browser-based direct-to-blob upload state machine, IndexedDB persistence, retry policy, and CORS configuration. No user-visible UI changes; Phase 3 adds the progress panel and resume banner.

### Prerequisites

Before starting Phase 2 deployment:

- **Phase 1 deployed and healthy**: Verify via `curl https://app-roadtripmap-prod.azurewebsites.net/api/version` returning 200 with version headers.
- **PR merged**: The Phase 2 feature branch is merged to `main` with all CI checks passing.
- **Local tooling (WSL bash)**:
  - `az` CLI 2.50+
  - `curl`
  - `jq` (for JSON parsing)
  - `git`

---

### 1. Pre-flight

#### [bash/WSL] Confirm Git State

```bash
cd /home/patrick/projects/road-trip
git fetch origin
gh pr list --head develop --base main --state open
```

**Expected outcome:** Exactly one open PR (the Phase 2 feature branch). Review and confirm readiness.

#### [bash/WSL] Verify Phase 1 Healthy

```bash
curl -i https://app-roadtripmap-prod.azurewebsites.net/api/version
```

**Expected output:**
- **HTTP Status:** `200 OK`
- **Headers:** `x-server-version` and `x-client-min-version` present
- **Response body:** JSON with `server_version` and `client_min_version`

**Deviation log entry:**  
[ ] Phase 2 PR open and reviewed  
[ ] Phase 1 production healthy  

---

### 2. CORS Deploy

#### [bash/WSL] Snapshot Current CORS Configuration

Before deploying, snapshot the current state (should be empty or missing):

```bash
az storage account blob-service-properties show \
  --account-name storoadtripmapprod \
  --query cors
```

**Expected outcome:** `null` or empty CORS rules (Phase 1 had no CORS).

#### [bash/WSL] Preview Bicep Changes

```bash
cd /home/patrick/projects/road-trip

az deployment group create \
  --resource-group rg-roadtripmap-prod \
  --template-file infrastructure/azure/main.bicep \
  --parameters @infrastructure/azure/parameters.json \
  --what-if
```

**Expected output:** Diff preview showing:
- **NEW:** `Microsoft.Storage/storageAccounts/blobServices` resource
- **Properties:** CORS rules with origins `https://roadtripmap.azurewebsites.net` and `https://localhost:5001`
- **Methods:** `GET`, `PUT`, `HEAD`, `OPTIONS`
- **NO OTHER CHANGES** (no role assignments, SQL, key vault modifications)

If the what-if shows unexpected changes, **STOP and investigate** before proceeding.

#### [bash/WSL] Apply Bicep Deployment

```bash
# Remove --what-if to actually deploy
az deployment group create \
  --resource-group rg-roadtripmap-prod \
  --template-file infrastructure/azure/main.bicep \
  --parameters @infrastructure/azure/parameters.json
```

**Expected output:** Deployment completes with status `"Succeeded"`.

#### [bash/WSL] Verify CORS Configuration

```bash
az storage account blob-service-properties show \
  --account-name storoadtripmapprod \
  --query "cors.corsRules[0]" -o json
```

**Expected output:** JSON showing:
```json
{
  "allowedOrigins": [
    "https://roadtripmap.azurewebsites.net",
    "https://localhost:5001"
  ],
  "allowedMethods": ["GET", "PUT", "HEAD", "OPTIONS"],
  "allowedHeaders": ["*"],
  "exposedHeaders": ["x-ms-*"],
  "maxAgeInSeconds": 3600
}
```

#### [bash/WSL] CORS Preflight Smoke Test

Test that the CORS preflight succeeds:

```bash
curl -i -X OPTIONS \
  -H 'Origin: https://roadtripmap.azurewebsites.net' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-length' \
  'https://storoadtripmapprod.blob.core.windows.net/road-trip-photos/'
```

**Expected output:**
- **HTTP Status:** `200 OK`
- **Header:** `Access-Control-Allow-Methods` containing `PUT`
- **Header:** `Access-Control-Allow-Origin: https://roadtripmap.azurewebsites.net`

**Deviation log entry:**  
[ ] Current CORS snapshot saved  
[ ] Bicep what-if validated (only blobServices resource)  
[ ] Bicep deployment succeeded  
[ ] CORS configuration verified  
[ ] Preflight smoke test passed  

---

### 3. App Service Deploy

#### [GitHub web] Merge Phase 2 PR and Trigger CI/CD

1. Navigate to the Phase 2 feature branch PR on GitHub.
2. Confirm status: all CI checks passing.
3. Click **Merge pull request** (via GitHub web, not CLI).
4. Confirm the merge to `main`.

Expected: The `roadtrip-ci.yml` workflow on the `main` branch will auto-trigger, then the manual deploy workflow becomes available.

#### [bash/WSL] Verify Static Assets Deployed

Wait 30 seconds for the new deployment to stabilize, then verify new JS files are served:

```bash
# Check uploadUtils.js is served (Task 1)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/uploadUtils.js

# Check uploadSemaphore.js is served (Task 2)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/uploadSemaphore.js

# Check storageAdapter.js is served (Task 4)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/storageAdapter.js

# Check uploadTransport.js is served (Task 6)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/uploadTransport.js

# Check versionProtocol.js is served (Task 11)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/versionProtocol.js
```

**Expected output:** All return **HTTP 200**.

**Deviation log entry:**  
[ ] Phase 2 PR merged to main  
[ ] All static JS files deployed (200 OK)  

---

### 4. Smoke Tests

#### [Browser] Manual Upload Round Trip

1. Navigate to `https://app-roadtripmap-prod.azurewebsites.net`.
2. Create a new trip (or use an existing test trip).
3. Open **DevTools** → **Network** tab (to observe requests).
4. Upload a single small photo (< 4 MB, with EXIF GPS data).

**Observe in Network tab:**
- `POST /api/trips/{token}/photos/request-upload` → HTTP 200 with `sas_url` and `photo_id`
- `PUT https://storoadtripmapprod.blob.core.windows.net/trip-{token}/...?comp=block&blockid=...` → HTTP 201 (block upload)
- `POST /api/trips/{token}/photos/{photoId}/commit` → HTTP 200
- Page auto-refreshes photo list (or manually refresh)

**Expected outcome:** Photo appears in the trip's photo carousel.

#### [Browser] Large File Multi-Block Upload

1. Upload a 15 MB photo.

**Observe in Network tab:**
- Multiple block PUT requests (4 × 4 MB blocks, one 3 MB block)
- All PUTs return HTTP 201
- Single commit POST with all block IDs
- Photo appears in list

**Expected outcome:** Large file successfully split, uploaded in blocks, and committed.

#### [Browser] Mid-Upload Interruption and Resume

1. Start uploading a photo.
2. While blocks are uploading (mid-flight), close the browser tab.
3. Re-open the trip page.

**Observe:**
- Open DevTools → **Application** → **IndexedDB** → **RoadTripUploadQueue**
- Check `upload_items` and `block_state` stores contain the interrupted upload
- **Note:** Phase 2 does not surface a resume UI banner; the queue auto-resumes on page load. (Phase 3 will add the banner.)
- Check Network tab: new block PUTs for remaining blocks (starting from where it stopped)

**Expected outcome:** Upload resumes automatically; interrupted upload continues without user action.

#### [Browser] Version Protocol Event (Optional, for Phase 2 foundation)

If you have access to change server version headers (e.g., via a test endpoint), verify:

1. Request any API endpoint.
2. Inspect response headers: `x-server-version` and `x-client-min-version`.
3. Open DevTools **Console** and check for any `version:reload-required` events logged (if Phase 2 wires the listener).

**Expected outcome:** No errors or exceptions related to missing version headers (AC8.3 graceful degradation).

**Deviation log entry:**  
[ ] Single-photo upload round trip succeeded  
[ ] 15 MB multi-block upload succeeded  
[ ] Mid-upload interruption + auto-resume confirmed in IndexedDB  
[ ] Version protocol headers present (no crashes on missing headers)  

---

### 5. Rollback

If any critical issue arises after Phase 2 deployment, execute the following steps **in reverse order** (bottom to top):

#### Rollback Step 1: Revert App Service

```bash
# Swap staging and production slots to restore Phase 1 version
az webapp deployment slot swap \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --slot staging
```

Wait 2–3 minutes for the swap to complete, then re-test the `/api/version` endpoint and manual upload flow.

#### Rollback Step 2: Remove CORS Configuration

```bash
# Obtain the pre-Phase-2 Bicep template (from git history)
git show HEAD~1:infrastructure/azure/main.bicep > /tmp/main.bicep.prev

# Redeploy without CORS
az deployment group create \
  --resource-group rg-roadtripmap-prod \
  --template-file /tmp/main.bicep.prev \
  --parameters @infrastructure/azure/parameters.json
```

The CORS configuration will be removed from blob services.

---

### 6. Sign-Off and Deviation Log

#### Approval Chain

After completing all sections above, obtain sign-off from Patrick:

| Section | Status | Signed By | Timestamp (UTC) |
|---------|--------|-----------|-----------------|
| 1. Pre-flight | ☐ Pass / ☐ Deviation | | |
| 2. CORS Deploy | ☐ Pass / ☐ Deviation | | |
| 3. App Service Deploy | ☐ Pass / ☐ Deviation | | |
| 4. Smoke Tests | ☐ Pass / ☐ Deviation | | |

#### Deviation Log

Record any deviations from the runbook below:

| Step | Expected | Actual | Resolution | Sign-off |
|------|----------|--------|------------|----------|
| | | | | |
| | | | | |
| | | | | |

**Final Status:** ☐ **PHASE 2 DEPLOYMENT SUCCEEDED** / ☐ **PHASE 2 DEPLOYMENT ROLLED BACK**

**Patrick's Final Sign-Off:**

```
Initials: _____
UTC Timestamp: _____
Commit this runbook with any deviations recorded.
```

---

## Phase 3 — Resilient uploads UI (dark release)

**Phase:** Phase 3 (Subcomponents A–H, Tasks 1–13)  
**Scope:** Deploy browser-based progress panel, resume banner, optimistic map pins, and pin-drop fallback. Feature-flagged dark release: deploy with flag OFF, validate in staging with flag ON, cutover to production.

### Prerequisites

Before starting Phase 3 deployment:

- **Phase 2 deployed and healthy**: Verify via `curl https://app-roadtripmap-prod.azurewebsites.net/api/version` returning 200 with version headers.
- **UI visual design approved**: `docs/implementation-plans/2026-04-13-resilient-uploads/ui-review-notes.md` contains Patrick's approval with timestamp (ACX.4).
- **PR merged**: The Phase 3 feature branch is merged to `main` with all CI checks passing.
- **Local tooling (WSL bash)**:
  - `az` CLI 2.50+
  - `curl`
  - `jq` (for JSON parsing)
  - `git`

---

### 1. Pre-flight

#### [bash/WSL] Confirm Git State

```bash
cd /home/patrick/projects/road-trip
git fetch origin
git log --oneline origin/main -1
```

**Expected outcome:** Latest commit is the Phase 3 PR merge.

#### [bash/WSL] Verify Phase 2 Healthy

```bash
curl -i https://app-roadtripmap-prod.azurewebsites.net/api/version
```

**Expected output:**
- **HTTP Status:** `200 OK`
- **Headers:** `x-server-version` and `x-client-min-version` present
- **Response body:** JSON with `server_version` and `client_min_version`

#### [bash/WSL] Verify UI Design Review Approved

```bash
cat docs/implementation-plans/2026-04-13-resilient-uploads/ui-review-notes.md | grep -i "approved"
```

**Expected outcome:** File contains "Approved on YYYY-MM-DD by Patrick" with a date before today.

**Deviation log entry:**  
[ ] Phase 2 production healthy  
[ ] UI review approved and recorded in ui-review-notes.md  

---

### 2. Deploy with Feature Flag OFF

#### [bash/WSL] Snapshot Current Feature Flag Setting

```bash
az webapp config appsettings list \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --query "[?name=='FeatureFlags__ResilientUploadsUI'].value" -o tsv
```

**Expected outcome:** Output is empty, `false`, or not present (flag defaults to false in Production).

#### [bash/WSL] Verify Bicep Configuration

Inspect `infrastructure/azure/parameters.json` or `appsettings.Production.json` to confirm:
- `FeatureFlags:ResilientUploadsUI` is set to `false` (default)

If not already false, you must set it explicitly:

```bash
az webapp config appsettings set \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --settings FeatureFlags__ResilientUploadsUI=false

# Restart the app for changes to take effect
az webapp restart \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod
```

#### [GitHub web] Merge Phase 3 PR and Trigger CI/CD

1. Navigate to the Phase 3 feature branch PR on GitHub.
2. Confirm status: all CI checks passing.
3. Click **Merge pull request** (via GitHub web, not CLI).
4. Confirm the merge to `main`.

**Expected:** The `roadtrip-ci.yml` workflow on the `main` branch will auto-trigger, then the manual deploy workflow becomes available.

#### [bash/WSL] Verify Static Assets Deployed

Wait 30 seconds for the new deployment to stabilize, then verify new JS files are served:

```bash
# Check progressPanel.js is served (Task 3)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/progressPanel.js

# Check optimisticPins.js is served (Task 8)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/optimisticPins.js

# Check resumeBanner.js is served (Task 5)
curl -I https://app-roadtripmap-prod.azurewebsites.net/js/resumeBanner.js
```

**Expected output:** All return **HTTP 200**.

#### [bash/WSL] Smoke Test: Legacy Status Bar Still Works

1. Create a test trip (or use an existing one with a known token):

```bash
curl -s -X POST \
  https://app-roadtripmap-prod.azurewebsites.net/api/trips \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase 3 flag=OFF smoke test"}' | jq '.secret_token'
```

2. Open a browser to `/post/{token}` and upload a small photo (or simulate via API).

3. **Verify in DevTools Console:** No JavaScript errors.

4. **Verify in DevTools Elements:** The **legacy** status bar appears (not the new progress panel). If the flag is off correctly, you should NOT see `<div class="upload-panel" role="region">`.

**Deviation log entry:**  
[ ] Feature flag confirmed OFF in production  
[ ] New JS files deployed (200 OK)  
[ ] Legacy status bar renders (flag OFF verified)  

---

### 3. Staging Validation with Feature Flag ON

#### [Azure Portal] Flip Feature Flag to ON in Staging Slot

1. Navigate to [Azure Portal](https://portal.azure.com).
2. Open **App Services** → **app-roadtripmap-prod** → **Configuration** (left sidebar).
3. Open **Application settings** tab.
4. Click **+ New application setting**.
5. **Name:** `FeatureFlags__ResilientUploadsUI`
6. **Value:** `true`
7. Click **OK**.
8. Click **Save** at the top.

Wait 30 seconds for the setting to propagate.

#### [Azure Portal] Restart Staging Slot (Optional)

If the app does not pick up the setting immediately:

1. Open **App Services** → **app-roadtripmap-prod**.
2. Open **Deployment slots** (left sidebar) → **staging**.
3. Click **Restart**.

Wait 2–3 minutes for restart to complete.

#### [Browser] Validate UI in Staging

1. Create a test trip in staging: `https://app-roadtripmap-prod-staging.azurewebsites.net/api/trips`

```bash
STAGING_TOKEN=$(curl -s -X POST \
  https://app-roadtripmap-prod-staging.azurewebsites.net/api/trips \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase 3 staging validation"}' | jq -r '.secret_token')

echo "Staging test trip: $STAGING_TOKEN"
```

2. Navigate to `https://app-roadtripmap-prod-staging.azurewebsites.net/post/{token}` in a browser.

3. **Verify in DevTools Elements:** The **new** progress panel appears:
   - `<div class="upload-panel" role="region" aria-label="Upload progress">`
   - Per-file rows with status icons
   - Collapse toggle
   - Action buttons (retry, pin-drop, discard)

4. **Upload a photo** and verify:
   - Progress panel shows the row with filename, size, progress bar
   - Optimistic pin appears on the map (pending styling if EXIF GPS is present)
   - On success, pin turns green and progress panel shows "committed" status

5. **Force a failure** (or simulate via API) and verify:
   - Failed row shows retry affordances
   - Pin turns red
   - "gave up after 6 attempts" message visible if retries exhausted

6. **Patrick visually inspects** the UI against the approved mockups in `ui-review-notes.md`.

#### [bash/WSL] Patrick Signs Off in ui-review-notes.md

Once Patrick approves the staging validation:

```bash
# Edit the file to record staging approval
cat >> docs/implementation-plans/2026-04-13-resilient-uploads/ui-review-notes.md << 'EOF'

## Staging Validation Sign-Off

Staging validation completed on YYYY-MM-DD at HH:MM UTC.
All UI elements match approved design. Ready for production cutover.

Patrick: _____ (Initials)
EOF
```

**Deviation log entry:**  
[ ] Feature flag toggled to ON in staging  
[ ] UI renders correctly (new progress panel visible)  
[ ] Upload flow tested (photo uploads with new UI)  
[ ] Patrick approved staging validation  

---

### 4. Production Cutover

#### [bash/WSL] Flip Feature Flag to ON in Production

```bash
az webapp config appsettings set \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --settings FeatureFlags__ResilientUploadsUI=true

# Restart the app for changes to take effect
az webapp restart \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod
```

Wait 2–3 minutes for the restart to complete.

#### [bash/WSL] Verify Flag Is Set

```bash
az webapp config appsettings list \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --query "[?name=='FeatureFlags__ResilientUploadsUI'].value" -o tsv
```

**Expected output:** `true`

#### [Browser] Production Smoke Test

1. Navigate to a real production trip: `https://app-roadtripmap-prod.azurewebsites.net/post/{token}`

2. **Verify in DevTools Elements:** The **new** progress panel is visible.

3. **Verify in DevTools Network:** Observe upload requests:
   - `POST /api/trips/{token}/photos/request-upload` → 200 (SAS URL issued)
   - `PUT blob.core.windows.net/trip-{token}/...` → 201 (block upload)
   - `POST /api/trips/{token}/photos/{photoId}/commit` → 200 (photo committed)

4. **Verify in DevTools Console:** No JavaScript errors.

5. **Upload a real photo** and observe:
   - Progress panel renders with filename, size, progress bar
   - On success, row transitions to "committed" status
   - Photo appears in the carousel (Phase 1–2 behavior unchanged)

**Deviation log entry:**  
[ ] Feature flag set to ON in production  
[ ] New progress panel visible in production  
[ ] Real photo upload succeeded with new UI  
[ ] No console errors  

---

### 5. Rollback (if needed)

If a critical issue arises after production cutover, execute the following steps **immediately**:

#### Rollback Step 1: Flip Feature Flag to OFF

```bash
az webapp config appsettings set \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --settings FeatureFlags__ResilientUploadsUI=false

# Restart the app
az webapp restart \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod
```

Wait 2–3 minutes for the restart. Users will immediately see the legacy status bar again. No code revert needed; the flag flip is the rollback.

#### Rollback Step 2: Code Revert (Optional)

If the flag flip alone is insufficient (e.g., back-end endpoint crashes), revert to Phase 2 code:

```bash
# Swap staging and production slots to restore Phase 2 version
az webapp deployment slot swap \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --slot staging
```

Wait 2–3 minutes for the swap. Re-test the `/api/version` endpoint and manual upload flow.

---

### 6. Sign-Off

#### Approval Chain

After completing all sections above, obtain sign-off from Patrick:

| Section | Status | Signed By | Timestamp (UTC) |
|---------|--------|-----------|-----------------|
| 1. Pre-flight | ☐ Pass / ☐ Deviation | | |
| 2. Deploy with flag OFF | ☐ Pass / ☐ Deviation | | |
| 3. Staging validation with flag ON | ☐ Pass / ☐ Deviation | | |
| 4. Production cutover | ☐ Pass / ☐ Deviation | | |

#### Deviation Log

Record any deviations from the runbook below:

| Step | Expected | Actual | Resolution | Sign-off |
|------|----------|--------|------------|----------|
| | | | | |
| | | | | |
| | | | | |

**Final Status:** ☐ **PHASE 3 DEPLOYMENT SUCCEEDED** / ☐ **PHASE 3 DEPLOYMENT ROLLED BACK**

**Patrick's Final Sign-Off:**

```
Initials: _____
UTC Timestamp: _____
Commit this runbook with any deviations recorded.
```

---

## Phase 4 — Stabilization + flag removal

**Phase:** Phase 4 (Subcomponents A–E, Tasks 1–8)  
**Scope:** Validate resilient-upload pipeline under real-world conditions with Patrick's active trip, add structured telemetry with correlation IDs, conduct legacy-trip audit, and remove the feature flag after acceptance sign-off.

### Prerequisites

Before starting Phase 4 deployment:

- **Phase 3 deployed and healthy**: Verify via `curl https://app-roadtripmap-prod.azurewebsites.net/api/version` returning 200 with version headers.
- **PR merged**: The Phase 4 feature branch is merged to `main` with all CI checks passing.
- **Acceptance artifacts ready**:
  - `docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md` contains Patrick's sign-off.
  - Legacy-trip audit (`Task 6`) is complete with zero unresolved entries.
- **Local tooling (WSL bash)**:
  - `az` CLI 2.50+
  - `curl`
  - `jq` (for JSON parsing)
  - `git`

---

### 1. Pre-flight

#### [bash/WSL] Confirm Git State

```bash
cd /home/patrick/projects/road-trip
git fetch origin
gh pr list --head develop --base main --state open
```

**Expected outcome:** Exactly one open PR (the Phase 4 feature branch) or zero if already merged.

#### [bash/WSL] Verify Phase 3 Healthy

```bash
curl -i https://app-roadtripmap-prod.azurewebsites.net/api/version
```

**Expected output:**
- **HTTP Status:** `200 OK`
- **Headers:** `x-server-version` and `x-client-min-version` present
- **Response body:** JSON with `server_version` and `client_min_version`

#### [File] Verify Patrick's Sign-Off in Acceptance Document

```bash
cd /home/patrick/projects/road-trip
grep -i "Accepted by Patrick on" docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md
```

**Expected outcome:** A line matching `Accepted by Patrick on YYYY-MM-DD` (no defect list blocking progression).

#### [File] Verify Legacy-Trip Audit Closed

```bash
grep -i "all flagged rows resolved\|audit.*closed\|zero unresolved" docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md
```

**Expected outcome:** An entry confirming all legacy-trip failed uploads have been resolved (retried, pin-dropped, or marked orphan-swept).

**Deviation log entry:**  
[ ] Phase 4 PR merged (or verified ready)  
[ ] Phase 3 production healthy  
[ ] Patrick's acceptance sign-off confirmed  
[ ] Legacy-trip audit closed with zero unresolved entries  

---

### 2. Deploy Code Change (Feature Flag Removal)

#### [GitHub web] Verify Phase 4 Code Merged

1. Navigate to the [road-trip repository on GitHub](https://github.com/psford/road-trip).
2. Open **Commits** on the `main` branch.
3. Verify the most recent commit message includes `Phase 4` and `flag removal`.
4. Confirm CI status: **✅ All checks passed**.

#### [bash/WSL] Build and Test Locally (Optional, for verification)

If desired, verify the flag-removal code locally:

```bash
cd /home/patrick/projects/road-trip

# Build
dotnet build RoadTripMap.sln --configuration Release

# Run tests
dotnet test RoadTripMap.sln --configuration Release --no-build
```

**Expected output:** All tests pass; no flag-related code errors.

#### [bash/WSL] Smoke Test: Page Load without Feature Flag

Wait 30 seconds for the production deployment to stabilize (if auto-deployed via CI/CD), then verify:

```bash
curl -I https://app-roadtripmap-prod.azurewebsites.net/post/<valid-trip-token>
```

**Expected:**
- HTTP 200 OK
- No `data-resilient-uploads-ui` attribute in the HTML (flag removed from POST.cshtml)
- DevTools Elements shows the new resilient-upload UI is the only path (no legacy status bar code)

#### [Browser] Manual Verification

1. Navigate to `https://app-roadtripmap-prod.azurewebsites.net/post/<valid-trip-token>` in a browser.
2. Open **DevTools** → **Elements**.
3. Search for `data-resilient-uploads-ui` — **should NOT be found**.
4. Search for `.upload-status-bar` CSS class — **should NOT be found** (only new `.upload-progress-panel` should be present).
5. Upload one test photo.
6. Verify the upload succeeds with the new progress panel UI (no legacy status bar).

**Deviation log entry:**  
[ ] Phase 4 code merged and CI passed  
[ ] Page loads without feature flag attribute  
[ ] New UI is the only code path (legacy dead code removed)  
[ ] Test photo upload succeeded  

---

### 3. Remove the Feature Flag from App Service Config

#### [bash/WSL] Delete the Feature Flag Setting

```bash
az webapp config appsettings delete \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --setting-names FeatureFlags__ResilientUploadsUI
```

**Expected output:** Deletion succeeds without error.

#### [bash/WSL] Verify Deletion

```bash
az webapp config appsettings list \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --query "[?name=='FeatureFlags__ResilientUploadsUI']"
```

**Expected output:** Empty array `[]` (setting no longer exists).

**Deviation log entry:**  
[ ] Feature flag deleted from App Service config  
[ ] Deletion verified (empty query result)  

---

### 4. Observability Check

#### [bash/WSL] Query Structured Logs for Upload Failures

Query the App Service logs or Application Insights for the last 24 hours of upload telemetry:

```bash
# Option A: If using Application Insights, query via CLI
az monitor app-insights query \
  --app kv-roadtripmap-prod \
  --analytics-query "
    customEvents
    | where name == 'upload.failed'
    | where timestamp > ago(24h)
    | summarize Count = count() by tostring(customDimensions['reason'])
  "
```

Alternatively, tail the App Service logs and look for structured JSON events:

```bash
az webapp log tail \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --follow
```

Look for log entries matching:
```json
{"event":"upload.failed","reason":"...","uploadId":"...","ts":"..."}
```

**Expected:**
- Zero `upload.failed` events with `reason='silent'` (indicating an unexpected, unhandled failure).
- Any `upload.failed` entries should have a documented reason (e.g., `"SAS refresh failure"`, `"permanent network error"`).
- All failure events are paired with corresponding user-visible error messages or telemetry events.

**Deviation log entry:**  
[ ] Structured logs queried for last 24 hours  
[ ] Zero "silent" failures detected  
[ ] All failure reasons are expected and documented  

---

### 5. Rollback Procedure

Feature-flag removal is a heavier rollback than earlier phases. The new resilient-upload path is now the only code path. Rollback requires reverting the code change entirely.

#### Rollback Step 1: Create Revert Commit

```bash
cd /home/patrick/projects/road-trip

# Create a new branch off main
git checkout main
git pull origin main
git checkout -b rollback/phase-4-flag-removal

# Revert the Phase 4 flag-removal commit (do NOT revert the entire Phase 4 PR)
# Find the commit hash for "chore: remove ResilientUploadsUI feature flag after Phase 4 acceptance"
git log --oneline --all | grep -i "remove.*feature flag"

# Revert it (replace <commit-hash> with the hash from above)
git revert <commit-hash>

# Verify the revert restored the flag usage
git show HEAD | grep -A5 -B5 "FeatureFlags:ResilientUploadsUI"
```

**Expected:** The revert commit shows the flag conditionals and settings restored.

#### Rollback Step 2: Push and Create PR

```bash
git push origin rollback/phase-4-flag-removal

# Create a PR via GitHub web (faster than gh CLI)
# Or via CLI:
gh pr create \
  --base main \
  --head rollback/phase-4-flag-removal \
  --title "rollback: Phase 4 flag removal — revert to flag-gated path" \
  --body "Emergency rollback of Phase 4 flag removal. Restores feature flag conditionals and App Service configuration."
```

#### Rollback Step 3: Merge and Redeploy

Wait for CI to pass, then merge the PR via GitHub web. The App Service deployment workflow will trigger automatically (if enabled) or manually via:

```bash
gh workflow run deploy.yml \
  --ref main \
  -f confirm_deploy="deploy" \
  -f reason="Phase 4 rollback: flag removal reverted"
```

Wait for deployment to complete (5–10 minutes). Then restore the feature flag in App Service config:

```bash
az webapp config appsettings set \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod \
  --settings FeatureFlags__ResilientUploadsUI=false

# Restart the app
az webapp restart \
  --resource-group rg-roadtripmap-prod \
  --name app-roadtripmap-prod
```

**Staging can flip the flag back to `true` for further testing**, or leave it `false` to serve the legacy UI path.

**Note:** Accepting Phase 4 and removing the feature flag is a commitment to the new resilient-upload path. Rollback requires code revert and is not a simple configuration flip like earlier phases.

---

### 6. Sign-Off

#### Approval Chain

After completing all sections above, obtain sign-off from Patrick:

| Section | Status | Signed By | Timestamp (UTC) |
|---------|--------|-----------|-----------------|
| 1. Pre-flight | ☐ Pass / ☐ Deviation | | |
| 2. Deploy code change (flag removal) | ☐ Pass / ☐ Deviation | | |
| 3. Remove flag from App Service config | ☐ Pass / ☐ Deviation | | |
| 4. Observability check | ☐ Pass / ☐ Deviation | | |

#### Deviation Log

Record any deviations from the runbook below:

| Step | Expected | Actual | Resolution | Sign-off |
|------|----------|--------|------------|----------|
| | | | | |
| | | | | |
| | | | | |

**Final Status:** ☐ **PHASE 4 DEPLOYMENT SUCCEEDED** / ☐ **PHASE 4 DEPLOYMENT ROLLED BACK**

**Patrick's Final Sign-Off:**

```
Initials: _____
UTC Timestamp: _____
Commit this runbook with deviations and final sign-off recorded.
```

---

### Deferred acceptance note (added 2026-04-16)

**Phase 4 sign-off is deferred pending the client-side processing fix.**

The acceptance session and legacy-trip audit (design Phases 1–2) cannot proceed until the oversize image compression plan (`docs/implementation-plans/2026-04-16-oversize-image-compression/`) is fully deployed and verified. Rationale: the current server-side tier generation bottleneck causes 6/20 photo uploads to fail in a 20-photo batch under load, which would invalidate any acceptance session run against the unpatched server.

**Phase 4 sign-off conditions:**

1. The oversize compression plan's Phases 1–4 are deployed to production with `Upload:ClientSideProcessingEnabled = true`.
2. A 20-photo batch smoke test on prod completes with zero failed uploads and total time under 3 minutes (matching the Playwright scenario in `docs/implementation-plans/2026-04-16-oversize-image-compression/phase_03.md`, Task 3, Subcomponent D).
3. Server logs confirm `GenerateDerivedTiersAsync` is **not** called during the smoke test (client tiers used).

Only after these three conditions are met should the Phase 4 acceptance session and legacy-trip audit proceed.

---

## Phase 5: Client-Side Image Processing

### Pre-deployment checklist

- [ ] All Vitest tests pass: `npm test`
- [ ] All .NET tests pass: `dotnet test RoadTripMap.sln`
- [ ] Playwright E2E tests pass locally: `npx playwright test`
- [ ] `appsettings.Production.json` has `Upload:ClientSideProcessingEnabled: false`
- [ ] Code reviewed and merged to develop

### Deployment steps

1. **Deploy code** with processing disabled (default production config):
   - Follow standard deploy workflow (`.github/workflows/deploy.yml`)
   - Processing code is inert because `ClientSideProcessingEnabled = false`

2. **Verify inert deployment**:
   - Upload a photo from web UI
   - Verify it commits successfully (server-side tier generation, normal flow)
   - Check browser console: no `imageProcessor.js` CDN fetch activity
   - Check server logs: `GenerateDerivedTiersAsync` IS called (normal, processing off)

3. **Enable on staging** (if available) or **canary on prod**:
   - Azure Portal > App Service > Configuration > Application Settings
   - Add: `Upload__ClientSideProcessingEnabled = true`
   - Restart App Service (setting takes effect on next page load)

4. **Smoke test with processing enabled**:
   - [ ] Upload a small JPEG (< 14 MB): commits, all 3 tiers visible
   - [ ] Upload a large PNG (> 14 MB): compresses client-side, commits, all 3 tiers
   - [ ] Upload 10 photos batch: all commit, no failures
   - [ ] Check server logs: `GenerateDerivedTiersAsync` NOT called (tiers uploaded by client)
   - [ ] Check commit timing: should be < 500ms per photo
   - [ ] Check browser console: `browser-image-compression` loaded from jsDelivr (only on first upload)

5. **Monitor for 24 hours**:
   - Watch for: commit failures, tier blob missing warnings, CDN load errors
   - Expected telemetry events: `processing:applied` for every upload

### Rollback

**If issues found at any step:**

1. Azure Portal > App Service > Configuration
2. Set `Upload__ClientSideProcessingEnabled = false`
3. Restart App Service
4. Takes effect on next page load -- no code deploy needed
5. Server-side `GenerateDerivedTiersAsync` fallback activates automatically
6. All uploads continue to work (just slower, with server-side tier gen)

### Sign-off

- [ ] 24-hour monitoring period passed with zero processing-related failures
- [ ] Commit times consistently < 500ms (verified via server logs)
- [ ] No `GenerateDerivedTiersAsync` calls in server logs for web uploads
- [ ] Sign-off: _________________ Date: _________

---

## Phase 5 — Capacitor shell + bundle hosting

**Phase:** Phase 5 (Subcomponents A–F, Tasks 0–12)  
**Scope:** Deploy Capacitor iOS app with bundled bootstrap loader, Azure-hosted shared JS/CSS bundle, TestFlight distribution, and device validation matrix.

### Prerequisites

Before starting Phase 5 deployment:

- **Phases 1–4 deployed and healthy**: Verify via `curl https://app-roadtripmap-prod.azurewebsites.net/api/version` returning 200 with version headers.
- **All WSL tasks (0–8) merged to main** with CI passing.
- **Mac session prerequisites met**: See `docs/implementation-plans/2026-04-13-resilient-uploads/ios-mac-handoff.md` Section 1.
- **Architectural decisions finalized**: See `docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-decisions.md`.
- **Local tooling (WSL bash)**:
  - `az` CLI 2.50+
  - `curl`
  - `jq` (for JSON parsing)
  - `git`

---

### 1. Pre-flight

#### [bash/WSL] Confirm Git State

```bash
cd /workspaces/road-trip
git fetch origin
git log origin/main..develop --oneline
```

**Expected outcome:** No output (all WSL tasks 0–8 merged to main).

#### [bash/WSL] Verify Phase 4 Healthy

```bash
curl -i https://app-roadtripmap-prod.azurewebsites.net/api/version
```

**Expected output:**
- **HTTP Status:** `200 OK`
- **Headers:** `x-server-version` and `x-client-min-version` present

#### [File] Verify Handoff and Decisions Documents

```bash
# Check handoff document
ls -lh docs/implementation-plans/2026-04-13-resilient-uploads/ios-mac-handoff.md

# Check decisions document
ls -lh docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-decisions.md
```

**Expected outcome:** Both files exist and contain final settings.

**Deviation log entry:**  
[ ] WSL tasks (0–8) merged to main  
[ ] Phase 4 production healthy  
[ ] Handoff and decisions documents finalized  

---

### 2. Bundle Deploy

#### [bash/WSL] Confirm CI Built Bundle

Check that the App Service has the bundle files deployed:

```bash
curl -I https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json
```

**Expected output:**
- **HTTP Status:** `200 OK`

#### [bash/WSL] Validate Bundle Manifest

Fetch and inspect the manifest JSON structure:

```bash
curl -s https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json | jq '.'
```

**Expected output:**
```json
{
  "version": "<semver>+build.<number>-<short-sha>",
  "client_min_version": "1.0.0",
  "files": {
    "app.js": {
      "size": <bytes>,
      "sha256": "<hash>"
    },
    "app.css": {
      "size": <bytes>,
      "sha256": "<hash>"
    },
    "ios.css": {
      "size": <bytes>,
      "sha256": "<hash>"
    }
  }
}
```

#### [bash/WSL] Verify Bundle Files Accessible

Test that all three bundle files are served:

```bash
# Test app.js
curl -I https://app-roadtripmap-prod.azurewebsites.net/bundle/app.js

# Test app.css
curl -I https://app-roadtripmap-prod.azurewebsites.net/bundle/app.css

# Test ios.css
curl -I https://app-roadtripmap-prod.azurewebsites.net/bundle/ios.css
```

**Expected output:** All return **HTTP 200**.

**Deviation log entry:**  
[ ] Bundle manifest endpoint returns 200 with valid JSON  
[ ] Bundle files (app.js, app.css, ios.css) all accessible  
[ ] Manifest version and file hashes recorded  

---

### 3. iOS Build (on Mac)

#### [Mac — Xcode] Follow Handoff Build Steps

On Patrick's Mac, execute the build and archive steps per `ios-mac-handoff.md` Section 6 (Build and archive):

```bash
# From Mac Terminal
cd /path/to/road-trip
git pull origin main

# Open in Xcode (or use CLI)
npx cap open ios

# In Xcode:
# 1. Product → Destination → select "Any iOS Device (arm64)"
# 2. Product → Archive
# 3. Wait for archive to complete
```

#### [Mac] Capture Build Log Excerpt

After the archive succeeds, save a log excerpt to `phase-5-device-smoke.md`:

```bash
# Example: extract archive success timestamp and build info
# This will be added during the device smoke steps (Task 11)
```

**Deviation log entry:**  
[ ] Archive created successfully in Xcode Organizer  
[ ] Build version and number recorded  

---

### 4. TestFlight Submission

#### [Mac — Xcode] Distribute to App Store Connect

Per `ios-mac-handoff.md` Section 6 and Task 10 of phase_05.md:

1. Archive complete and Organizer is open.
2. Click **Distribute App**.
3. Select **App Store Connect** → **Upload**.
4. Confirm automatic signing.
5. Click **Upload**.

#### [browser] Confirm Build Processed

Wait for the processing email (typically 10–15 minutes), then verify:

```bash
# Navigate to appstoreconnect.apple.com in browser
# Apps → Road Trip → TestFlight tab
# Confirm the build appears in the list with status "Ready to Test"
```

**Expected outcome:** Build visible to internal testers; no blockers noted.

**Deviation log entry:**  
[ ] Build distributed to App Store Connect  
[ ] Processing email received  
[ ] Build status "Ready to Test" in TestFlight dashboard  

---

### 5. Device Validation

#### [Mac — iPhone] Execute Smoke Matrix

On Patrick's iPhone, run through the acceptance criteria matrix per Task 11 of phase_05.md. Record results in `docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-device-smoke.md`:

- **AC9.1** — First online launch: fetch bundle, render UI
- **AC9.2** — Offline second launch: load from cache
- **AC9.3** — New bundle deployment: picked up on next launch
- **AC9.4** — First-ever offline launch: fallback.html shown
- **AC9.5** — Version mismatch: alert shown, re-fetch triggered
- **AC10.1** — iOS CSS applied before paint (no flash)
- **AC10.2** — ios.css update picked up on next launch

#### [File] Verify Smoke Test Document

Check that all 7 matrix entries are complete with sign-off:

```bash
ls -lh docs/implementation-plans/2026-04-13-resilient-uploads/phase-5-device-smoke.md
```

**Expected outcome:** File exists with all 7 entries marked PASS and signed by Patrick.

**Deviation log entry:**  
[ ] AC9.1 (first online) — PASS  
[ ] AC9.2 (offline second) — PASS  
[ ] AC9.3 (new bundle) — PASS  
[ ] AC9.4 (first offline) — PASS  
[ ] AC9.5 (version mismatch) — PASS  
[ ] AC10.1 (iOS CSS no flash) — PASS  
[ ] AC10.2 (ios.css update) — PASS  
[ ] Patrick signed off on matrix  

---

### 6. Rollback

If a critical issue is discovered during device validation or post-deployment:

#### Rollback Step 1: Redeploy Previous Container Image

The bundle is baked into the App Service container (wwwroot/bundle) at build time. To roll back the iOS bundle, redeploy a prior container image.

**Option A (Primary): Redeploy Previous Container Image**

Find the prior image tag from the container registry:

```bash
# List recent images for roadtripmap
az acr repository show-tags \
  --registry acrstockanalyzerer34ug \
  --repository roadtripmap \
  --orderby time_desc \
  --top 5
```

Example output (pick the image before the current one):
```
v1.0.0-abc1234  (current bad build)
v1.0.0-def5678  (previous good build)
```

Redeploy the previous good image:

```bash
az webapp config container set \
  --name app-roadtripmap-prod \
  --resource-group rg-roadtripmap-prod \
  --container-image-name acrstockanalyzerer34ug.azurecr.io/roadtripmap:v1.0.0-def5678 \
  --container-registry-url https://acrstockanalyzerer34ug.azurecr.io \
  --container-registry-username <username> \
  --container-registry-password <password>
```

Wait for the App Service to restart with the previous image. Verify:

```bash
curl -I https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json
```

**Option B (Client-side workaround): Force Re-fetch via Version Pin**

If a new App Service container image is not readily available, you can temporarily force all iOS clients to use an older cached bundle by increasing `client_min_version` in the manifest. This does NOT roll back the code — it only delays app load time by one refresh cycle while the issue is being fixed. Not recommended as a permanent solution.

```bash
# This requires access to App Service Kudu console or direct file upload
# Step 1: Retrieve current manifest
curl -s https://app-roadtripmap-prod.azurewebsites.net/bundle/manifest.json > /tmp/manifest.json

# Step 2: Edit the manifest to increase client_min_version higher than any cached version
# (e.g., change "1.0.0" to "99.0.0" temporarily)

# Step 3: Re-deploy via CI or manual upload (this method is complex; prefer Option A)
```

#### Rollback Step 2: TestFlight Build

Mark the TestFlight build as inactive so testers revert to the previous build:

1. Navigate to appstoreconnect.apple.com.
2. Apps → Road Trip → TestFlight tab.
3. Select the problematic build.
4. Click **Deactivate** (or **Remove from Testing**).
5. Internal testers will revert to the prior build on next app launch.

#### Rollback Step 3: Code Revert (if needed)

If the issue is code-level (e.g., bootstrap loader bug), revert the Phase 5 commit and redeploy:

```bash
cd /workspaces/road-trip
git log --oneline origin/main | head -5  # Find Phase 5 merge commit

# Create rollback branch
git checkout -b rollback/phase-5-issue
git revert <phase-5-commit-hash>
git push origin rollback/phase-5-issue

# Open PR and merge
gh pr create --base main --title "rollback: Phase 5 iOS bundle issue"
```

**Note:** No Bicep rollback needed for Phase 5 (only App Service container + bundle files).

---

### 7. Sign-Off

#### Approval Chain

After completing all sections above, obtain sign-off from Patrick + Mac session:

| Section | Status | Signed By | Timestamp (UTC) |
|---------|--------|-----------|-----------------|
| 1. Pre-flight | ☐ Pass / ☐ Deviation | | |
| 2. Bundle Deploy | ☐ Pass / ☐ Deviation | | |
| 3. iOS Build (Mac) | ☐ Pass / ☐ Deviation | | |
| 4. TestFlight Submission | ☐ Pass / ☐ Deviation | | |
| 5. Device Validation | ☐ Pass / ☐ Deviation | | |

#### Deviation Log

Record any deviations from the runbook below:

| Step | Expected | Actual | Resolution | Sign-off |
|------|----------|--------|------------|----------|
| | | | | |
| | | | | |
| | | | | |

**Final Status:** ☐ **PHASE 5 DEPLOYMENT SUCCEEDED** / ☐ **PHASE 5 DEPLOYMENT ROLLED BACK**

**Patrick + Mac Session Final Sign-Off:**

```
Initials: _____
UTC Timestamp: _____
Commit this runbook with deviations and sign-off recorded.
```

---

**Document Version:** 1.4  
**Created:** April 2026 (Phase 1 Implementation)  
**Author:** Claude Code  
**Last Reviewed:** (to be filled during Phase 5 deployment)
