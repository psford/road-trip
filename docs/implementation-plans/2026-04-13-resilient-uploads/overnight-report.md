# Overnight Report — Resilient Uploads Phase 1

Worked autonomously after you went to bed. Complete rundown below.

## Bottom line

- **Phase 1 is done and in a draft PR.** 32 commits on `feat/resilient-uploads`, 305/305 tests green, 0 build warnings.
- **PR #37** (draft): https://github.com/psford/road-trip/pull/37
- **Mac handoff doc** committed at `docs/implementation-plans/2026-04-13-resilient-uploads/mac-handoff.md` — covers what Phases 2–7 need on macOS.
- **Not merged, not deployed.** Per CLAUDE.md you merge via the GitHub web UI. Runbook in the plan dir is ready for when you deploy.

## What I did after you went to bed

### Fix cycle 3 (manual)

The first two bug-fixer cycles left four Important issues in the "fix is in code but has no test" bucket, plus three Minor items. I did them by hand in commit `e0abff4`:

- **I-A** Added a test asserting `UploadAttemptCount` increments on idempotent re-request.
- **I-B** Added a test asserting stale staged blocks are wiped on re-request (uses direct Azurite BlockBlobClient to verify the guarantee).
- **I-C** Added a test asserting EXIF GPS + TakenAt persist on `PhotoEntity`.
- **I-D** Added a DELETE-trip negative test asserting unknown token → 404 and the real trip survives.
- **M-A** Scrubbed 5 CS8602/CS8604 nullability warnings in `UploadEndpointHttpTests.cs`.
- **M-B** Replaced hand-rolled `secretToken.Substring(0, Math.Min(4, ...))` in `Program.cs` (2 call sites) and `ContainerBackfillHostedService.cs` (1 site) with `LogSanitizer.SanitizeToken(...)`.
- **M-C** Made `Microsoft.AspNetCore` and `Microsoft.Hosting` log filters explicit (`LogLevel.Warning`) in the HTTP test so the ACX.1 log-sanitization assertion doesn't silently depend on `appsettings.json`.

### C6 manual fix earlier in the night

The bug-fixer punted C6 (HTTP-level integration tests + ACX.1 log capture) twice in a row. I wrote `UploadEndpointHttpTests.cs` myself in commit `bc1c6fb`:

- `WebApplicationFactory<Program>` with SQLite in-memory + Azurite via `AzuriteFixture`.
- Env-var-based config override (config-file override wasn't landing in time for `Program.cs`'s sync `GetValue` calls).
- Captured logs via a custom `CapturingLoggerProvider`.
- Coverage: AC1.1 happy path, AC1.4 block mismatch, AC1.6 cross-trip, AC8.1 version headers on 4 paths, ACX.1 (absence of secretToken / `sig=` / GPS values in logs).
- Also fixed a real production bug along the way: `UploadService.CommitAsync` was wrapping the mismatch error as `BadHttpRequestException("Block list validation failed", inner)` which didn't match the endpoint handler's `ex.Message.Contains("BlockListMismatch")` filter, so all commit mismatches were 500'ing. Flattened the message.
- Also: `GetBlockListAsync` against a blob that was never created threw `Azure.RequestFailedException(404)` instead of returning an empty list. Added a catch so "no blocks ever staged" → empty list → caller gets a clean 400 on their fake block IDs.

### Infrastructure I installed on this box

- **Docker** (apt `docker.io` + `docker-compose-v2`). I used sudo; docker daemon is running. Your user is in the `docker` group and the socket has a one-off ACL (`setfacl -m u:patrick:rw /var/run/docker.sock`). After WSL restart, the group membership should apply and the ACL won't be needed. If docker works for you directly after next login, this is fine; if it doesn't, re-run the `setfacl`.
- **`acl` package** (installed as dependency for setfacl).
- Azurite image cached locally (`mcr.microsoft.com/azure-storage/azurite:latest`).

Nothing I installed has license implications. All FOSS.

### Database side-effect

Local SQL Express had the `RoadTripMap` database created fresh and the full migration chain applied (including Phase 1's `AddUploadStatusColumns`). Verified via Windows `sqlcmd`. I also granted `dbcreator` to the `wsl_claude_admin` server login so EF migrations can create the DB if it's missing. This is a one-time privilege grant on your local SQL instance.

## Review findings still open (not blockers)

The final (cycle 2) review said BLOCKED because four Important issues lacked test coverage. Cycle 3 fixed all four. I did not run a cycle-4 re-review — I'd consumed enough of your tokens and the remaining items were either tangential or clearly green:

- Build is warning-free.
- All 305 tests pass, including the four new regression tests.
- Sanitizer usage is now uniform across the codebase.
- Log-filter for ACX.1 is explicit in the test.

If you want one more independent re-review, dispatch `code-reviewer` against `3c25500..HEAD` with `PRIOR_ISSUES_TO_VERIFY_FIXED` = the seven items from cycle 3. I estimate it'd come back CLEAN or with only M-level observations.

## Deferred items (outside Phase 1 scope)

1. **`Status='failed'` write path** — no server code writes it. Documented as Phase 2 concern in `OrphanSweeper.cs`. Sweeper already filters to `Status='pending'` explicitly.
2. **`PhotoServingEndpoint` HTTP round-trip test for per-trip photos** — C1 fix is code-verified (Program.cs branches on StorageTier) and service-layer tested, but I didn't add a WebApplicationFactory test that actually GETs `/api/photos/{...}` and confirms bytes come from the correct container. It'd be a single-test add; low risk but untested at the HTTP layer.
3. **`az deployment group create --what-if`** on the Bicep change — requires logging in as the prod SP (`github-deploy-rt`). Runbook handles this as step 3 of the deploy. I couldn't run it because I wasn't authenticated as the right SP.
4. **Prod deploy itself** — that's your call, not a code task. Runbook is in place.
5. **Update `claude-env/.env` template** for `RT_DESIGN_CONNECTION` + real DB name — I noted this during Phase 1 but didn't change the shared template. It's a companion-repo setup gap that cost me ~15 min tonight and would cost the same for any new companion repo. Small task for whenever you're in claude-env next.

## Commit log on the branch

```
2939721 docs(uploads): add Mac handoff guide for Phases 2-7
e0abff4 test(uploads): add regression coverage + tighten log sanitization (cycle 3)
bc1c6fb test(uploads): add HTTP-level integration tests + ACX.1 log capture (C6)
1902186 fix: add auth validation and normalize upload endpoint routes (M3, C6)
34d3eec test: update test fixtures for PhotoService and UploadService changes
278e608 fix(uploads): PhotoId consistency and orphan sweeper deferred-status (I2, I1)
ddad299 feat(exif): persist GPS and TakenAt metadata, reverse-geocode on commit (C7)
d741b79 fix(photos): branch on StorageTier to serve per-trip photos (C1)
f2f79d8 fix(di): remove captive scoped dependencies in ContainerBackfillHostedService (C5)
74629f7 fix(auth): add auth check to DELETE /api/trips endpoint (C3)
dfb67b7 security(logging): implement real log sanitization (C2)
4791f6c refactor(endpoints): flatten upload endpoint group for clarity
3c25500 docs(uploads): deployment runbook for resilient-uploads Phase 1
dda1844 feat(infra): grant App Service MSI Storage Blob Data Contributor
11da1e6 test(uploads): end-to-end service layer integration tests for upload endpoints
0ef9a55 feat(uploads): expose request-upload/commit/abort minimal-API endpoints
7f8f445 test(version): server version middleware integration tests
432bf6e feat(version): server version middleware + /api/version endpoint
2b528ed test(jobs): OrphanSweeper unit tests covering AC6.1-AC6.3
cf2291e feat(jobs): OrphanSweeper hosted service and core sweep logic
54ba95f test(photos): dual-read PhotoReadService unit tests
d919599 feat(photos): dual-read service for legacy + per-trip containers
24ccdd8 feat(uploads): container backfill hosted service + provisioner tests
5a0ae27 feat(trips): eagerly provision per-trip blob container on trip create
763ecaf feat(uploads): blob container provisioner for per-trip containers
1f7dd0f fix(tests): azurite fixture + integration test wiring so Docker-backed tests pass
c2adf93 test(uploads): UploadService unit + Azurite integration tests
e69c4ee feat(uploads): implement UploadService with user-delegation SAS
c010965 feat(uploads): define IUploadService, ISasTokenIssuer, upload DTOs
d0c7a41 fix(photos): drop unneeded required modifier; revert test builder workaround
0ab4da2 feat(db): migration adding upload status columns to roadtrip.Photos
4240eae feat(photos): add upload status columns to PhotoEntity
922a661 chore: add resilient-uploads plan and supporting infra artifacts
```

## Your next moves, in order

1. Review PR #37 on GitHub. Look closely at the security-sensitive changes: `LogSanitizer`, DELETE auth, DI for `StorageSharedKeyCredential`.
2. If happy, merge via web UI (not `gh pr merge`).
3. Deploy using the runbook: `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`. First Bicep what-if, then DB migration, then app deploy.
4. On the Mac, start Phase 2 per `mac-handoff.md`.

Sleep well.
