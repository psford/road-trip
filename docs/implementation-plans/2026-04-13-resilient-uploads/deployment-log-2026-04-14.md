# Phase 1 Deployment Log — 2026-04-14

Tracks actual execution against `deployment-runbook.md`. Append status per step.

- **Commit deployed:** a71de69 (merge commit for PR #37)
- **Operator:** Patrick + Claude pairing session
- **Start:** 2026-04-14 afternoon (local)

## Section 1 — Pre-flight

| Check | Status | Evidence |
|---|---|---|
| Git on origin/main, nothing ahead | ✅ | HEAD=a71de69 |
| `.claude/azure-identity.json` matches SP | ℹ️ | Hook not blocking `patrick@psford.com` (Owner), proceeding as user identity |
| CI green on merge commit | ✅ | PR #37 pre-merge CI was green |
| Current `az` identity | ℹ️ | `patrick@psford.com` — subscription Owner |

## Section 2 — Database migration

| Step | Status | Notes |
|---|---|---|
| KV read: `kv-roadtripmap-prod/DbConnectionString` | ✅ | |
| Pre-apply: prod at `20260406012136_AddParkBoundaries` (target rollback) | ✅ | `dotnet ef migrations list` |
| `dotnet ef database update` against prod | ✅ | `Applying migration '20260414030652_AddUploadStatusColumns'. Done.` |
| Post-apply: all 6 migrations, none pending | ✅ | |
| Rollback command (if needed) | ℹ️ | `dotnet ef database update 20260406012136_AddParkBoundaries --project src/RoadTripMap --startup-project src/RoadTripMap --connection "$PROD_CONN"` |

## Section 3 — Storage Blob Data Contributor (narrow apply; Bicep deferred)

What-if on the full Bicep revealed significant drift beyond Phase 1 scope:
- `parameters.json` contains literal pipeline placeholders (`#{SQLAdminPassword}#`, `#{NpsApiKey}#`) — applying would overwrite KV secret values.
- `linuxFxVersion` hardcoded to `:latest` — would roll back the container image from `prod-32`.
- Duplicate KV role assignments (Bicep computes deterministic GUIDs that don't match existing out-of-band assignments).
- `storageAccount` resource referenced by Bicep does not exist (`storoadtripmapprod` vs real account `stockanalyzerblob` in `rg-stockanalyzer-prod`).

Decision: applied Phase 1 role via direct `az role assignment create`. Full Bicep reconcile tracked separately per Patrick's request.

| Step | Status | Notes |
|---|---|---|
| Bicep what-if reviewed | ✅ | |
| Drift documented (container tag, KV secret values, phantom storage account) | ✅ | |
| Narrow apply: `az role assignment create` → Storage Blob Data Contributor | ✅ | Role assignment name `8066a9a7-16a6-4d2d-a76a-46db1378beca`; scope `rg-stockanalyzer-prod/stockanalyzerblob`; principal `88fef096` (App Service MSI) |
| Rollback: `az role assignment delete --name 8066a9a7-16a6-4d2d-a76a-46db1378beca --scope <scope>` | ℹ️ | |
| Follow-up: Bicep reconcile PR | ⏭️ | In progress |

## Section 4 — App Service deploy

| Step | Status | Notes |
|---|---|---|
| GitHub Actions dispatch (run 24427862660) | ✅ | preflight/build/container/deploy all green |
| Workflow smoke: Homepage, Create, /api/health | ✅ | built-in in deploy.yml |
| Manual `curl /api/version` | ✅ | 200 with `x-server-version: 1.0.0` and `x-client-min-version: 1.0.0` |

## Section 5 — Container backfill

| Step | Status | Notes |
|---|---|---|
| `Backfill__RunOnStartup=true` set via `az webapp config appsettings set` | ✅ | Note: double-underscore form (Azure App Service convention for nested config keys) |
| App Service restart | ✅ | |
| Cold start after restart | ⚠️ | Took ~90s — first curl attempts (5s max-time) timed out; extending to 30s succeeded |
| `trip-*` container count post-backfill | ✅ | **39 containers** provisioned (one per existing trip) |
| `Backfill__RunOnStartup` cleared + restart | ✅ | App warm at t+15s |

## Section 6 — Post-deploy smoke

| Step | Status | Notes |
|---|---|---|
| Homepage / Create / Health (workflow smoke) | ✅ | Per deploy.yml output |
| `/api/version` returns version headers + body | ✅ | |
| Existing-trip regression (GET `/api/post/{token}/photos`) | ⏭️ | Skipped locally (no secret/view token on hand); deploy.yml smoke covers app responsiveness |
| New-upload round trip via curl | ⏭️ | Requires authentic secret token; defer to in-app validation on next real upload |
| Orphan sweeper log line within 1 hour | ℹ️ | Hosted service wired (`OrphanSweeperHostedService`), fires on `PeriodicTimer` |

## Deviations & rollback notes

(append here as they occur)
