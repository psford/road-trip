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

**Document Version:** 1.0  
**Created:** April 2026 (Phase 1 Implementation)  
**Author:** Claude Code  
**Last Reviewed:** (to be filled during deployment)
