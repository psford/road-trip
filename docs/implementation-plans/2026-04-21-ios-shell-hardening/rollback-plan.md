# iOS Shell Hardening — Deployment Rollback Plan

Deploy triggers [.github/workflows/deploy.yml](../../../.github/workflows/deploy.yml) which builds a Docker image, pushes it to ACR as `prod-{run_number}`, and sets App Service to serve it. Rollback is a one-command image-tag swap — no rebuild, no revert commit needed.

## Resource constants

| Name | Value |
|---|---|
| Webapp | `app-roadtripmap-prod` |
| Resource group | `rg-roadtripmap-prod` |
| ACR login server | `acrstockanalyzerer34ug.azurecr.io` |
| Image name | `roadtripmap` |

## Step 1: capture the current tag (before deploy)

Done on 2026-04-23 before the iOS-shell-hardening deploy.

```bash
az webapp config show \
  --name app-roadtripmap-prod \
  --resource-group rg-roadtripmap-prod \
  --query linuxFxVersion \
  -o tsv
```

Output:

```
DOCKER|acrstockanalyzerer34ug.azurecr.io/roadtripmap:prod-47
```

**Rollback target: `prod-47`.** If the upcoming deploy breaks the web app, Step 3 swaps the live image back to this tag.

Re-run this command before any future deploy to capture a fresh target.

## Step 2: deploy

Trigger the workflow via the GitHub UI (Actions → "Deploy to Azure Production" → Run workflow), or from the terminal:

```bash
gh workflow run deploy.yml \
  --ref ios-offline-shell \
  --field confirm_deploy=deploy \
  --field reason="iOS shell hardening Phases 1-8 + on-device cascade fixes (5819255, 2d5ea2b)"
```

The workflow's built-in smoke tests ([deploy.yml:219-252](../../../.github/workflows/deploy.yml#L219-L252)) hit `/`, `/create`, and `/api/health`. If they fail, the workflow exits non-zero and the deploy is marked failed — but the container image has already been swapped on App Service at that point. You still need to roll back manually.

## Step 3: rollback (if needed)

Swap the live image back to the previous tag. App Service reuses the registry credentials from the prior deploy, so no password is needed.

```bash
az webapp config container set \
  --name app-roadtripmap-prod \
  --resource-group rg-roadtripmap-prod \
  --container-image-name acrstockanalyzerer34ug.azurecr.io/roadtripmap:prod-47

az webapp restart \
  --name app-roadtripmap-prod \
  --resource-group rg-roadtripmap-prod
```

The restart takes 30–60 seconds.

## Step 4: verify rollback

```bash
# Confirm App Service is serving the old tag again.
az webapp config show \
  --name app-roadtripmap-prod \
  --resource-group rg-roadtripmap-prod \
  --query linuxFxVersion \
  -o tsv

# Confirm the live site is up.
curl -sS -o /dev/null -w "%{http_code}\n" https://app-roadtripmap-prod.azurewebsites.net/api/health
# Expect: 200
```

Browse to <https://app-roadtripmap-prod.azurewebsites.net/> in a regular browser (not the Capacitor shell) to confirm the home page renders.

## Troubleshooting

**`container set` fails with an auth error.** The App Service dropped the registry credentials. Re-set them with the ACR admin password:

```bash
ACR_PASSWORD=$(az acr credential show \
  --name acrstockanalyzerer34ug \
  --query "passwords[0].value" -o tsv)

az webapp config container set \
  --name app-roadtripmap-prod \
  --resource-group rg-roadtripmap-prod \
  --container-image-name acrstockanalyzerer34ug.azurecr.io/roadtripmap:prod-47 \
  --container-registry-url https://acrstockanalyzerer34ug.azurecr.io \
  --container-registry-user acrstockanalyzerer34ug \
  --container-registry-password "$ACR_PASSWORD"
```

**Previous tag isn't in ACR anymore.** Unlikely (ACR retains images indefinitely unless a cleanup policy is configured), but you can list what's available:

```bash
az acr repository show-tags \
  --name acrstockanalyzerer34ug \
  --repository roadtripmap \
  --orderby time_desc \
  --output table
```

Pick a known-good older `prod-N` and use that.

**App Service still serves the broken image after rollback.** The container runtime may have cached the previous image. Force a cold start:

```bash
az webapp stop --name app-roadtripmap-prod --resource-group rg-roadtripmap-prod
sleep 10
az webapp start --name app-roadtripmap-prod --resource-group rg-roadtripmap-prod
```

## Scope of this rollback

This only reverts the **server-side** container image (the .NET API + wwwroot files App Service serves). It does **not** touch:

- The iOS shell on your iPhone — that's whatever Xcode last installed. If the new shell has a bug the rollback can't fix, reinstall the old branch via `git checkout <previous-sha>` → `npx cap sync ios` → Xcode build.
- Azure SQL data, blob storage, POI tables, Key Vault secrets — none of those change during a deploy.
- EF migrations — the iOS shell hardening branch adds none. If a future deploy includes migrations, those are applied before the container swap per the existing runbook pattern, and they are NOT auto-rolled-back. Migrations need explicit `dotnet ef database update <previous-migration>` to revert.
