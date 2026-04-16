# Morning Runbook — 2026-04-16

This runbook covers the sequenced actions to complete Phase 4 of the resilient-uploads work and ship the new oversize-image-compression design. Every step is labeled with the shell where it runs.

**Labels:**
- `[container]` — runs in the current Claude Code container (dotnet, az, gh, npm all available)
- `[mac/local]` — runs on Patrick's Mac terminal (outside this container)
- `[mobile]` — runs on Patrick's phone (browser/camera, not a terminal)
- `[Azure Portal]` — browser UI in Azure Portal
- `[GitHub web]` — GitHub web UI

All commands assume cwd is `/workspaces/road-trip` unless otherwise stated.

---

## Pre-flight

Before anything else:

1. `[container]` **Confirm branch state and tests green.**
   ```bash
   git status               # expect clean working tree
   git log --oneline -5     # confirm latest commit is 965f1f0 (or newer)
   npm test 2>&1 | tail -3  # expect 173 tests passing
   ```

2. `[container]` **Confirm Azure auth is still alive** (the device-code session from last night may have rolled).
   ```bash
   az account show --query "{user: user.name, subscription: name}" -o table
   ```
   If it errors, re-authenticate:
   ```bash
   az login --use-device-code
   ```
   Then visit `https://login.microsoft.com/device` on your phone with the code printed.

3. `[container]` **Confirm prod app is still healthy.**
   ```bash
   curl -s https://app-roadtripmap-prod.azurewebsites.net/api/version
   ```
   Expect: `{"server_version":"1.0.0","client_min_version":"1.0.0"}` (or current version).

---

## Step 1 — Patrick's acceptance session (resilient-uploads Phase 4 Task 5)

This is the human-in-the-loop step that everything else depends on.

1. `[mobile]` On your iPhone, open `https://app-roadtripmap-prod.azurewebsites.net` — create a new trip or open an existing one using its post URL.

2. `[mobile]` Upload **20+ photos** on real cellular network. Use a mix:
   - Several normal-size JPEGs
   - At least one HEIC from the Camera app
   - At least one iPhone screenshot (PNG)
   - Ideally one very large photo (>15 MB — expect this to currently fail, note the error; compression ships after this session)

3. `[mobile]` Observe:
   - Progress panel shows each photo with live progress
   - Optimistic pins appear on the map in pending state
   - Pins transition to committed when upload finishes
   - Any failed uploads show retry/discard/pin-drop buttons
   - If you close the browser mid-batch and reopen, you see a "Resume" banner

4. `[container]` **Fill in the acceptance doc.** Open `/workspaces/road-trip/docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md` and replace the TBD values:
   - Date, device (e.g. "iPhone 15 Pro, iOS 17.4"), connection type ("T-Mobile LTE", "Verizon 5G", etc.)
   - Photo count attempted / committed / failed
   - Any retry counts visible in DevTools console (telemetry events `upload.block_retry`)
   - Any UI issues (screenshots welcome)

5. `[container]` **Sign off.** Replace `- [ ] Accepted by Patrick on YYYY-MM-DD` with the actual date and initial. If defects found, list them in the "Defects" section and **skip to the "Defects found" branch below**.

6. `[container]` **Commit.**
   ```bash
   git checkout feature/resilient-uploads
   git add docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md
   git commit -m "docs(uploads): Phase 4 acceptance session notes — Patrick sign-off"
   git push
   ```

**Defects found branch:** If anything is broken, stop here. File each as a separate commit on `feature/resilient-uploads` with a regression test. Do not proceed to Step 2 (flag removal) until the fix is deployed and re-verified on mobile.

---

## Step 2 — Legacy-trip audit (resilient-uploads Phase 4 Task 6)

Only after Step 1 sign-off.

1. `[container]` **Run the audit script against prod.**
   ```bash
   ./scripts/audit-failed-uploads.sh 2>&1 | tee /tmp/audit-output.txt
   ```
   The script pulls `DbConnectionString` from `kv-roadtripmap-prod` via your Azure session, then queries `roadtrip.Photos` for rows with `status IN ('failed', 'pending')` and `last_activity_at` within the last 30 days.

   Expected output: TSV with `photo_id`, `trip_id`, `status`, `last_activity_at`, `upload_id` columns.

2. `[container]` **Triage each row.** For each result:
   - If `status='pending'` and `last_activity_at < now - 48h` → will be auto-swept by `OrphanSweeper`. Annotate: `orphan-swept`.
   - If `status='failed'` on an active trip → `[mobile]` open the trip on mobile, click retry on the row, or use pin-drop if the file is gone. Annotate: `retry` or `pin-drop`.
   - If clearly junk (test uploads, dev cruft) → delete from the photo list UI. Annotate: `discard`.

3. `[container]` **Append to acceptance doc.** In `phase-4-acceptance.md`, under "Legacy-trip audit", list each `{photo_id}: {resolution}`.

4. `[container]` **Commit.**
   ```bash
   git add docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md
   git commit -m "docs(uploads): legacy-trip audit resolutions"
   git push
   ```

---

## Step 3 — Feature flag removal (resilient-uploads Phase 4 Task 7)

Only after Step 1 sign-off. Code changes are already reviewed in the design; this is executing them.

1. `[container]` **Create fix branch off main to ensure a clean base.**
   ```bash
   git fetch origin
   git checkout main
   git pull --ff-only
   git checkout -b chore/remove-resilient-uploads-flag
   ```

2. `[container]` **Remove the flag from JS.** Edit `src/RoadTripMap/wwwroot/js/postUI.js`:
   - Find the `FeatureFlags.isEnabled('resilient-uploads-ui')` branches
   - Keep only the "enabled" side; delete the `else` branches

3. `[container]` **Remove legacy stubs.** Edit `src/RoadTripMap/wwwroot/js/uploadQueue.js`:
   - Delete `createStatusBar`, `updateStatusBar`, `removeStatusBar` stub methods at the end of the module
   - Keep `featureFlags.js` file — still useful for future flags

4. `[container]` **Remove from app settings.**
   ```bash
   # Edit src/RoadTripMap/appsettings.json
   # Edit src/RoadTripMap/appsettings.Development.json
   # Edit src/RoadTripMap/appsettings.Production.json
   # Remove the "FeatureFlags": { "ResilientUploadsUI": ... } section from each
   ```

5. `[container]` **Remove legacy CSS.** Edit `src/RoadTripMap/wwwroot/css/styles.css`:
   - Delete `.upload-status-bar*` rules

6. `[container]` **Verify tests still pass.**
   ```bash
   npm test
   dotnet test RoadTripMap.sln --filter "FullyQualifiedName~Upload"
   ```

7. `[container]` **Commit, push, open PR.**
   ```bash
   git add -A
   git commit -m "chore(uploads): remove ResilientUploadsUI feature flag

Phase 4 acceptance signed off 2026-04-16. New UI is the only path."
   git push -u origin chore/remove-resilient-uploads-flag
   gh pr create --title "chore: remove ResilientUploadsUI feature flag" \
     --body "Phase 4 acceptance signed off; legacy path no longer needed." \
     --base main
   ```

8. `[GitHub web]` Patrick merges the PR after CI passes.

9. `[container]` **Trigger deploy.**
   ```bash
   gh workflow run deploy.yml --ref main \
     -f confirm_deploy=deploy \
     -f reason="Phase 4 flag removal after acceptance sign-off"
   ```
   Monitor: `gh run watch $(gh run list --workflow=deploy.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`

10. `[container]` **Remove the flag from App Service config.**
    ```bash
    az webapp config appsettings delete \
      --name app-roadtripmap-prod \
      --resource-group rg-roadtripmap-prod \
      --setting-names FeatureFlags__ResilientUploadsUI
    ```

11. `[container]` **Smoke-test prod.**
    ```bash
    curl -s https://app-roadtripmap-prod.azurewebsites.net/api/version
    ```
    Then `[mobile]` quick upload to confirm the new UI still works.

---

## Step 4 — Finalize Phase 4 runbook (resilient-uploads Phase 4 Task 8)

1. `[container]` **Edit the runbook.**
   - Open `/workspaces/road-trip/docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`
   - Navigate to the Phase 4 section (already drafted; needs final sign-off)
   - Tick all the sign-off checkboxes now that the work is done
   - Add dates and initials per section

2. `[container]` **Commit to main via PR (since main is protected).**
   ```bash
   git checkout -b docs/finalize-phase4-runbook
   git add docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md
   git commit -m "docs(uploads): finalize Phase 4 runbook sign-offs"
   git push -u origin docs/finalize-phase4-runbook
   gh pr create --title "docs: finalize Phase 4 runbook" --body "Sign-offs after acceptance + flag removal." --base main
   ```

3. `[GitHub web]` Merge.

---

## Step 5 — Build the compression plan + tests (oversize-image-compression Phase 3)

At this point the resilient uploads work is fully closed out. We pivot to the new compression design.

1. `[container]` **Branch off main.**
   ```bash
   git checkout main
   git pull --ff-only
   git checkout -b feat/oversize-compression
   ```

2. `[container]` **Generate the implementation plan.** Use the `/ed3d-plan-and-execute:start-implementation-plan` slash command (or invoke the `starting-an-implementation-plan` skill directly) pointing at `docs/design-plans/2026-04-16-oversize-image-compression.md`. It will produce `docs/implementation-plans/2026-04-16-oversize-image-compression/` with one phase file per design phase.

3. `[container]` **Execute the implementation plan.** Use the `/ed3d-plan-and-execute:execute-implementation-plan` command pointing at that directory. The plan will execute Phase 3 → Phase 4 → Phase 5 → Phase 6 of the design (Phases 1 and 2 of the design are already closed by Steps 1–4 above).

4. `[container]` **Code reviews** happen automatically at the end of each phase per the skill's workflow. Address issues before moving on.

---

## Step 6 — Dark-release deploy (oversize-image-compression Phase 6)

1. `[container]` **Merge PR to main** via GitHub web (CI must pass).

2. `[container]` **Verify flag is OFF in prod config.**
   ```bash
   az webapp config appsettings list \
     --name app-roadtripmap-prod \
     --resource-group rg-roadtripmap-prod \
     --query "[?name=='Upload__ClientSideCompressionEnabled']" -o table
   ```
   Expect either empty or `"false"`. If empty, set it explicitly:
   ```bash
   az webapp config appsettings set \
     --name app-roadtripmap-prod \
     --resource-group rg-roadtripmap-prod \
     --settings Upload__ClientSideCompressionEnabled=false
   ```

3. `[container]` **Trigger deploy.**
   ```bash
   gh workflow run deploy.yml --ref main \
     -f confirm_deploy=deploy \
     -f reason="Oversize compression code deploy (flag OFF)"
   ```

4. `[container]` **Smoke test with flag OFF.**
   `[mobile]` Upload a normal-size photo. Should work exactly as today. Upload an 18 MB photo. Should still fail with the 15 MB error (unchanged behavior).

5. `[container]` **Flip flag on staging slot.**
   ```bash
   az webapp config appsettings set \
     --name app-roadtripmap-prod \
     --resource-group rg-roadtripmap-prod \
     --slot staging \
     --settings Upload__ClientSideCompressionEnabled=true
   ```

6. `[mobile]` **Staging smoke test.** Upload an 18 MB iPhone photo against the staging slot URL (`https://app-roadtripmap-prod-staging.azurewebsites.net/post/<token>`). Expect:
   - Progress panel row with "Compressing…" status for a few seconds
   - Then normal block-upload progress
   - Photo ends up committed with correct GPS and thumbnail

7. `[container]` **Flip flag on prod.**
   ```bash
   az webapp config appsettings set \
     --name app-roadtripmap-prod \
     --resource-group rg-roadtripmap-prod \
     --settings Upload__ClientSideCompressionEnabled=true
   ```

8. `[mobile]` **Prod smoke test** — same flow against prod URL.

9. `[container]` **Set a reminder to re-check telemetry in 24 hours.**
   - Query App Insights (or tailed docker logs) for `upload.compression_failed` events
   - Zero tolerance on `reason: "out_of_memory"` or `reason: "decode_failure"` on common devices
   - If any appear, flip the flag back to `false` and triage before re-enabling

---

## Rollback procedures

### Rolling back feature flag removal (Step 3)
1. `[container]` Revert the merge commit on main. `gh pr create` a revert PR.
2. `[container]` Redeploy. The legacy path stubs are back in code.
3. `[container]` Set `FeatureFlags__ResilientUploadsUI=false` on App Service.

### Rolling back compression (Step 6)
1. `[container]` **Fastest rollback**: `az webapp config appsettings set --name app-roadtripmap-prod --resource-group rg-roadtripmap-prod --settings Upload__ClientSideCompressionEnabled=false`. Takes effect on next page load — no redeploy needed.
2. **If flag-flip doesn't fix it** (e.g. the compression code introduced an unrelated bug): revert the merge commit via PR, redeploy.

---

## Commands cheat-sheet

Paste-ready, in execution order, for the happy path:

```bash
# Pre-flight
git status && git log --oneline -5 && npm test 2>&1 | tail -3
az account show --query "{user: user.name, subscription: name}" -o table
curl -s https://app-roadtripmap-prod.azurewebsites.net/api/version

# After Patrick's acceptance session (Step 1)
git checkout feature/resilient-uploads
# (edit phase-4-acceptance.md with session notes + sign-off)
git add docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md
git commit -m "docs(uploads): Phase 4 acceptance session notes — Patrick sign-off"
git push

# Legacy-trip audit (Step 2)
./scripts/audit-failed-uploads.sh 2>&1 | tee /tmp/audit-output.txt
# (triage each row, annotate resolutions in phase-4-acceptance.md)
git add docs/implementation-plans/2026-04-13-resilient-uploads/phase-4-acceptance.md
git commit -m "docs(uploads): legacy-trip audit resolutions"
git push

# Feature flag removal (Step 3)
git fetch origin && git checkout main && git pull --ff-only
git checkout -b chore/remove-resilient-uploads-flag
# (edit postUI.js, uploadQueue.js, appsettings*.json, styles.css per Step 3)
npm test
dotnet test RoadTripMap.sln --filter "FullyQualifiedName~Upload"
git add -A
git commit -m "chore(uploads): remove ResilientUploadsUI feature flag"
git push -u origin chore/remove-resilient-uploads-flag
gh pr create --title "chore: remove ResilientUploadsUI feature flag" --body "..." --base main
# (merge via GitHub web; CI must pass)
gh workflow run deploy.yml --ref main -f confirm_deploy=deploy -f reason="Phase 4 flag removal"
az webapp config appsettings delete --name app-roadtripmap-prod --resource-group rg-roadtripmap-prod --setting-names FeatureFlags__ResilientUploadsUI

# Finalize runbook (Step 4)
git checkout -b docs/finalize-phase4-runbook
# (edit deployment-runbook.md Phase 4 section, tick sign-offs)
git add docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md
git commit -m "docs(uploads): finalize Phase 4 runbook sign-offs"
git push -u origin docs/finalize-phase4-runbook
gh pr create --title "docs: finalize Phase 4 runbook" --body "..." --base main

# Compression work (Step 5) — use skills, not inline commands
# /ed3d-plan-and-execute:start-implementation-plan docs/design-plans/2026-04-16-oversize-image-compression.md
# (review generated phase files)
# /ed3d-plan-and-execute:execute-implementation-plan docs/implementation-plans/2026-04-16-oversize-image-compression/

# Dark release (Step 6)
# (merge compression PR first)
az webapp config appsettings set --name app-roadtripmap-prod --resource-group rg-roadtripmap-prod --settings Upload__ClientSideCompressionEnabled=false
gh workflow run deploy.yml --ref main -f confirm_deploy=deploy -f reason="Compression code deploy (flag OFF)"
# (smoke test: sub-threshold upload works, oversize still fails same as before)
az webapp config appsettings set --name app-roadtripmap-prod --resource-group rg-roadtripmap-prod --slot staging --settings Upload__ClientSideCompressionEnabled=true
# (staging smoke test with 18 MB photo)
az webapp config appsettings set --name app-roadtripmap-prod --resource-group rg-roadtripmap-prod --settings Upload__ClientSideCompressionEnabled=true
# (prod smoke test)
# 24 hours later, check telemetry for compression failures
```
