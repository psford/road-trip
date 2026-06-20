# Native iOS Sharing & Popup Polish — Phase 4: Dad's Trip Prod→Dev Migration (Ops)

**Goal:** Copy Dad's existing prod trip (rows + photo blobs, same tokens) into the dev slot so he can import it into the dev-slot app via its secret token.

**Architecture:** A one-time data migration, not app code. Copy his `TripEntity` row + `PhotoEntity` rows from the prod DB to `roadtripmap-db-dev` (preserving `SecretToken`/`ViewToken` so the existing token still imports), and `AzCopy` his photo blobs from the prod storage container to the dev container, preserving `BlobPath`. **Infrastructure phase — verified operationally (queries + a live fetch), not by unit tests.** Patrick pre-authorized Azure ops.

**Tech Stack:** Azure CLI (`az`), `AzCopy`, SQL (Azure SQL / sqlcmd), Azure Blob Storage.

**Scope:** Phase 4 of 4. Depends on Phase 3 (import flow ready end-to-end). **Verifies: operational** (AC5.1/AC5.2 by inspection; AC5.3 device/manual).

**Codebase verified:** 2026-06-19.

---

## Acceptance Criteria Coverage

### native-ios-sharing-polish.AC5: Dad's trip migration
- **native-ios-sharing-polish.AC5.1 Success:** Dad's `TripEntity` + `PhotoEntity` rows exist in the dev DB with the same secret/view tokens.
- **native-ios-sharing-polish.AC5.2 Success:** His photo blobs exist in the dev container at the same blob paths (the photo-serving endpoint resolves them).
- **native-ios-sharing-polish.AC5.3 Success:** On a fresh app, importing his secret token shows the trip with all photos and write access (device/manual).

These are verified operationally (DB queries + a live photo fetch + an on-device import), not by automated tests. **Do not invent unit tests for this phase.**

---

## Important: storage-tier nuance (verified 2026-06-19)

`PhotoEntity.StorageTier` determines the blob container (`Program.cs:702`):
- `"legacy"` → container **`road-trip-photos`** (prod) / **`road-trip-photos-dev`** (dev).
- `"per-trip"` → container **`trip-{secretToken}`** (lowercased), same name in both accounts.

Dad's trip predates the native rewrite, so its photos are almost certainly `legacy`. **Confirm his actual `StorageTier` first** (Task 2) and copy the correct container(s). The photo-serving endpoint reads `BlobPath` + `StorageTier` (+ derived container) — so preserving `BlobPath` and `StorageTier` verbatim is mandatory.

**Secrets handling:** pull connection strings / storage keys from Key Vault into shell variables; never echo a token or connection string into logs/output. Prod KV: `kv-roadtripmap-prod` (`DbConnectionString`, `BlobStorageConnection`). Dev KV: `kv-roadtripmap-dev` (same keys, dev targets).

---

<!-- START_TASK_1 -->
### Task 1: Identify Dad's trip in prod and capture its data

**Files:** None (read-only investigation against prod).

**Steps:**
1. Get Patrick's identifying info for the trip (trip name / slug — ask Patrick).
2. Pull the prod DB connection string from `kv-roadtripmap-prod` into a shell var (no echo).
3. Query prod for the trip row: `Id, Slug, Name, Description, SecretToken, ViewToken, CreatedAt, IsActive`. Save to a working file (local, gitignored — do not commit tokens).
4. Query prod for its photos: all `PhotoEntity` columns, especially `BlobPath`, `StorageTier`, `Status`, `Latitude`, `Longitude`, `PlaceName`, `Caption`, `TakenAt`, `CreatedAt`.
5. Record the **distinct `StorageTier`** values and, for `per-trip`, the `trip-{secretToken}` container name.

**Verification:** The trip row + photo rows are captured; you know the container(s) to copy. Confirm with Patrick that this is the right trip (name/photo count) before writing anything.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Copy photo blobs prod→dev (AzCopy), preserving paths

**Files:** None (Azure Storage operation).

**Steps:**
1. Pull prod + dev `BlobStorageConnection` (or generate short-lived SAS) into shell vars.
2. For `legacy` photos: `AzCopy` the specific blob paths from prod `road-trip-photos` → dev `road-trip-photos-dev`, **preserving the exact `BlobPath`** (and the per-size variants the server derives — original/display/thumb; confirm how `PhotoService.GetPhotoAsync` maps `BlobPath` + size to blob names, and copy all variants that exist).
3. For `per-trip` photos (if any): copy from prod `trip-{secretToken}` → a dev `trip-{secretToken}` container (create it if absent), same blob paths.
4. Copy only this trip's blobs (scope by path prefix), not the whole container.

**Verification:** List the destination blobs and confirm each source `BlobPath` (and its size variants) now exists in the dev container. (AC5.2 groundwork.)
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Insert the trip + photo rows into the dev DB (same tokens)

**Files:** None (dev DB write).

**Steps:**
1. Pull the dev DB connection string from `kv-roadtripmap-dev` into a shell var.
2. Insert the `TripEntity` row into `roadtripmap-db-dev` with the **same `SecretToken`, `ViewToken`, `Slug`, `Name`, `Description`, `CreatedAt`, `IsActive`**. Let the dev DB assign a new `Id` (identity); capture it.
3. Insert each `PhotoEntity` row with `TripId = <new dev trip Id>`, preserving `BlobPath`, `StorageTier`, `Status` (should be `committed`), `Latitude`, `Longitude`, `PlaceName`, `Caption`, `TakenAt`, `CreatedAt`. Let dev assign new photo `Id`s.
4. Guard against duplicates: if a trip with the same `SecretToken` already exists in dev, stop (idempotency).

**Verification:**
- Query dev: the trip row exists with the same tokens (AC5.1). 
- Query dev: photo count matches prod (AC5.1).
- Hit the **dev-slot** photo-serving endpoint for one photo: `GET https://app-roadtripmap-prod-dev.azurewebsites.net/api/photos/{devTripId}/{devPhotoId}/thumb` returns a JPEG 200 (AC5.2 — proves rows + blobs + container routing align). **Confirm this hostname is the dev slot before running** — App Service slot naming (`...-prod-dev.azurewebsites.net`) differs from the DB/container naming (`roadtripmap-db-dev` / `road-trip-photos-dev`), so verify via `az webapp deployment slot list` that `prod-dev` is the dev slot and NOT production. The prod host is `app-roadtripmap-prod.azurewebsites.net` (no `-dev`); never run the AC5.2 check against it.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: End-to-end device verification + record the migration

**Files:**
- Modify: `docs/device-test-checklist.md` (add: "Dad's trip — import his secret token on a fresh install → trip + all photos appear with write access").

**Steps:**
1. On a device/simulator running the dev-slot (Release-TestFlight) build, Import via Token using Dad's secret token.
2. Confirm the trip imports with all photos pinned, photos load (served from the dev container), and write access works (add a test photo, then remove it).
3. Add the checklist item so this is part of the batched device pass.

**Verification (AC5.3):** Trip + photos appear on import; photos render; write works. This is device/manual — record the result in the checklist during the batched pass.
<!-- END_TASK_4 -->

---

## Additional notes
- This phase touches **production data (read-only)** and **dev (writes)**. Double-check every destructive-looking step targets dev, never prod.
- Keep the captured trip data (tokens, connection strings) in a local gitignored scratch location; never commit it.
- If Dad's trip turns out to have `per-trip` storage with CORS/container specifics, confirm the dev shared storage account's container config matches before serving.
