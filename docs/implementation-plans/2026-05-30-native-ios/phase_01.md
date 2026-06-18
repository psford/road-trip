# Native iOS — Phase 1: Backend Dev Slot + Scaffold Reconciliation Implementation Plan

**Goal:** Stand up an Azure `dev` App Service slot (with dev DB, dev blob container, dev Key Vault secrets, slot-sticky settings) the native client can target, wire a `deploy-dev.yml` workflow, point the native client's dev config at the dev slot, and land the additive GRDB **v2** migration (front `queued`/`requesting` upload stages + `placeNamePending` on Photo + a durable non-purgeable staging cache).

**Architecture:** Additive Bicep change to the single source-of-truth template `infrastructure/azure/main.bicep` (no parallel template). The dev slot is a child of the existing `app-roadtripmap-prod` App Service and shares its plan; dev DB is a sibling database on the existing SQL server; the dev blob container is added to the shared cross-RG storage account; dev secrets are sticky so a slot swap never moves prod's DB/blob bindings. The Swift side reuses the already-merged Phase-1/2 scaffold + storage layer as-is and adds one migration version.

**Tech Stack:** Bicep (`Microsoft.Web/sites/slots`, `Microsoft.Web/sites/slots/config`, `Microsoft.Sql/servers/databases`, `Microsoft.Storage/.../containers`), GitHub Actions (`workflow_dispatch`), XcodeGen `.xcconfig`, Swift 5.9 / GRDB 6.29.3 `DatabaseMigrator`.

**Scope:** Phase 1 of 8.

**Codebase verified:** 2026-06-18 (codebase-investigator + internet-researcher).

---

## Verified codebase facts (read before implementing)

- **Prod runs on the shared P0v3 plan `asp-stockanalyzer`** (P-tier; 20 slots). The 2026-06-17 P0v3 consolidation is already in the Bicep on this branch: the App Service `app-roadtripmap-prod` is declared in **`infrastructure/azure/modules/app-service.bicep`** (NOT inline in `main.bicep`), runs **cross-RG in `rg-stockanalyzer-prod`** (deployed via `main.bicep`'s `scope: resourceGroup(sharedInfraResourceGroup)`), and attaches to the plan via `serverFarmId: sharedPlan.id` where `sharedPlan` is an `existing` reference to `asp-stockanalyzer` (owned by stock-analyzer's IaC, referenced read-only). **No App Service Plan SKU change is needed** (Patrick confirmed already-P0v3). road-trip's **SQL Server + Key Vault stay in `rg-roadtripmap-prod`** (`main.bicep`). The dev slot therefore lives cross-RG in `rg-stockanalyzer-prod` too, and `az webapp` slot commands target `--resource-group rg-stockanalyzer-prod --name app-roadtripmap-prod`.
- The App Service's current app settings (in `app-service.bicep`'s `appServiceSettings`) are: `WEBSITES_ENABLE_APP_SERVICE_STORAGE`, `ASPNETCORE_ENVIRONMENT`, `WEBSITES_PORT=5100`, `DOCKER_REGISTRY_SERVER_*`, `Blob__AccountName`, `Upload__ClientSideProcessingEnabled`, and the three `@Microsoft.KeyVault(...)` refs (`DbConnectionString`, `BlobStorageConnection`, `NpsApiKey`). The dev slot mirrors these with `-dev`-suffixed KV secret names + `ASPNETCORE_ENVIRONMENT=Development`.
- The merged scaffold + storage layer is real and complete on `develop` (now on `feat/native-ios`): `ios-swift/RoadTrip/` with `project.yml` (GRDB 6.29.3, iOS 17, bundle `com.psford.roadtripmap.native`, team `GP2M7H6R3U`), `Models/{Trip,Photo,UploadQueueItem}.swift`, `Storage/{AppDatabase,KeychainStore,Migrator,PhotoFileCache}.swift`, and green `RoadTripTests/StorageTests.swift`.
- **The design's "PR #108 facade UI (Views/*, SampleData.swift)" does NOT exist.** There is no `Views/` directory and no `SampleData.swift`. The only app UI is the minimal placeholder `ios-swift/RoadTrip/RoadTrip/App/ContentView.swift` (a `ContentUnavailableView`). **There is nothing to delete** — Task 4 only confirms this and is a no-op deletion.
- **`UploadStage` enum (current, v1)** in `ios-swift/RoadTrip/RoadTrip/Models/UploadQueueItem.swift` has 7 cases: `staged`, `uploadingOriginal` (="uploading_original"), `uploadingDisplay`, `uploadingThumb`, `committing`, `done`, `failed`. The design's target sequence is `queued → requesting → uploadingOriginal → uploadingDisplay → uploadingThumb → committing → done | failed`. **There is no `queued` or `requesting` yet, and there is a legacy `staged`.** Reconciliation: rename `staged`→`queued`, add `requesting`, and migrate any persisted `"staged"` rows to `"queued"`.
- **`Photo` already has `placeName` (NOT NULL).** It does NOT have `placeNamePending`. v2 adds only `placeNamePending`.
- `Migrator.swift` has a single `migrator.registerMigration("v1")`. GRDB stores enums as their `String` rawValue, so adding enum cases needs no schema change — but persisted `"staged"` strings need a data UPDATE.
- `PhotoFileCache` writes to `~/Library/Caches/Photos/...` which iOS may purge. The offline queue's source bytes must survive purge, so a **separate non-purgeable** staging directory is required (`~/Library/Application Support/...`).

---

## Acceptance Criteria Coverage

This phase implements and verifies:

### native-ios.AC7: Backend dev slot supports rewrite iteration
- **native-ios.AC7.1 Success:** Bicep deploys `dev` slot to existing `app-roadtripmap-prod` App Service; slot accessible at its slot URL
- **native-ios.AC7.2 Success:** Dev slot connects to `roadtripmap-db-dev` (Basic DTU 5 on same SQL server); EF migrations applied; `/api/version` returns successfully
- **native-ios.AC7.3 Success:** `deploy-dev.yml` GitHub Actions workflow dispatches manually, builds + deploys to dev slot
- **native-ios.AC7.5 Edge:** Slot-swap from `dev` → prod NOT automated (stays manual via Azure portal per Patrick's directive) — honored by `deploy-dev.yml` deploying to the slot only (`--auto-swap false`, no `az webapp deployment slot swap` step); no task automates a swap.

The GRDB v2 migration tasks are **infrastructure/storage** tasks with no AC of their own (the design's "Done when" requires "the v1→v2 migration applies cleanly over a database with existing rows and round-trips the `queued` stage"). They are verified by XCTest, not by an AC.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) — Azure dev slot infrastructure (in-container authoring; Patrick dispatches deploy) -->

<!-- START_TASK_1 -->
### Task 1: Additive Bicep for dev slot, dev DB, dev container, sticky settings

**Verifies:** native-ios.AC7.1, native-ios.AC7.2 (infrastructure — verified operationally after Patrick dispatches the deploy)

**Environment:** Authored **in-container**. Patrick runs `what-if` and dispatches the deploy (Claude must NEVER run `deploy.yml`/`deploy-dev.yml` or `az` production mutations).

**Files:**
- Modify: `infrastructure/azure/modules/app-service.bicep` (add the dev slot + sticky config as children of the existing `appService` resource; add params for the dev container tag if needed)
- Modify: `infrastructure/azure/main.bicep` (add the dev SQL database on the existing SQL server; pass any new params into the `appService` module invocation; invoke the new dev-blob-container module)
- Create: `infrastructure/azure/modules/dev-blob-container.bicep` (cross-RG scoped module for `road-trip-photos-dev`, mirroring the existing cross-RG storage module pattern)
- Modify: `infrastructure/azure/parameters.json` (only if a new non-secret param is needed)

**Implementation:**

1. **Read `infrastructure/azure/modules/app-service.bicep` first.** The App Service `appService` (`Microsoft.Web/sites`) and its `appServiceSettings` child are declared there; the plan is the `existing` shared `sharedPlan` (`asp-stockanalyzer`, P0v3). **No SKU change anywhere** — the slot attaches to the same shared plan via `serverFarmId: sharedPlan.id`. The module is deployed cross-RG into `rg-stockanalyzer-prod` by `main.bicep` (`scope: resourceGroup(sharedInfraResourceGroup)`), so the slot is added IN THIS MODULE.

2. **Add the dev deployment slot** as a child of the existing `appService` resource symbol in `app-service.bicep`, mirroring `appServiceSettings` with dev values (apiVersion `2024-11-01`, matching the file):

```bicep
resource appServiceDevSlot 'Microsoft.Web/sites/slots@2024-11-01' = {
  parent: appService                       // existing app-roadtripmap-prod in this module
  name: 'dev'
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }     // dev slot gets its own MSI
  properties: {
    serverFarmId: sharedPlan.id            // same shared P0v3 plan — no new plan
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acrLoginServer}/roadtripmap:dev-latest'
      alwaysOn: true
      ftpsState: 'FtpsOnly'
      numberOfWorkers: 1
    }
  }
}

resource appServiceDevSlotSettings 'Microsoft.Web/sites/slots/config@2024-11-01' = {
  parent: appServiceDevSlot
  name: 'appsettings'
  properties: {
    WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'false'
    ASPNETCORE_ENVIRONMENT: 'Development'
    WEBSITES_PORT: '5100'
    DOCKER_REGISTRY_SERVER_URL: 'https://${acrLoginServer}'
    DOCKER_REGISTRY_SERVER_USERNAME: acrUsername
    DOCKER_REGISTRY_SERVER_PASSWORD: acrPassword
    Blob__AccountName: blobAccountName
    Upload__ClientSideProcessingEnabled: clientSideProcessingEnabled
    ConnectionStrings__DefaultConnection: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=DbConnectionString-dev)'
    ConnectionStrings__AzureStorage: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=BlobStorageConnection-dev)'
    NPS_API_KEY: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=NpsApiKey)'
  }
}
```
   Reuse the module's existing params (`location`, `acrLoginServer`, `acrUsername`, `acrPassword`, `keyVaultName`, `blobAccountName`, `clientSideProcessingEnabled`) — do not invent names. Use a separate dev container-tag param if you want the slot pinned to `dev-latest` vs the prod tag.

3. **Mark dev settings slot-sticky** so a swap never moves them. Add a `slotConfigNames` config on the **parent site** (canonical sticky mechanism — declared on the production site, not the slot), in `app-service.bicep`:

```bicep
resource stickySettings 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: appService
  name: 'slotConfigNames'
  properties: {
    appSettingNames: [
      'ASPNETCORE_ENVIRONMENT'
      'ConnectionStrings__DefaultConnection'   // dev DB stays on dev slot across a swap
      'ConnectionStrings__AzureStorage'        // dev blob stays on dev slot across a swap
    ]
  }
}
```
   These are wired as **app settings** (`ConnectionStrings__*`), so they go under `appSettingNames` (NOT `connectionStringNames`). Match the mechanism `appServiceSettings` already uses.
   **Deviation note (resolve, don't double-configure):** the design (design §"Backend Changes", line ~255) describes sticky settings "via `Microsoft.Web/sites/slots/config` with `slotSetting: true`." This plan instead uses the parent-site `slotConfigNames` mechanism — the canonical, equivalent Azure way to mark app settings sticky, and the one that composes cleanly with the existing `appServiceSettings`. **Use `slotConfigNames` only; per-slot `slotSetting: true` is NOT separately required** (configuring both is redundant and confusing). State this choice in the commit message so it's not "fixed" back to the design's wording.

4. **Add the dev SQL database** as a child of the existing SQL server (`sql-roadtripmap-prod`), Basic DTU 5, matching the prod DB's collation/maxSize:

```bicep
resource sqlDatabaseDev 'Microsoft.Sql/servers/databases@2024-11-01-preview' = {
  parent: sqlServer
  name: 'roadtripmap-db-dev'
  location: location
  sku: { name: 'Basic', tier: 'Basic', capacity: 5 }
  properties: { collation: 'SQL_Latin1_General_CP1_CI_AS', maxSizeBytes: 2147483648 }
}
```

5. **Add the dev blob container `road-trip-photos-dev`** (private). The storage account `stockanalyzerblob` lives cross-RG in `rg-stockanalyzer-prod`, so this must go through a scoped module like the existing `storage-rbac.bicep` / `blob-cors.bicep` pattern. Create `modules/dev-blob-container.bicep` declaring `Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01` with `publicAccess: 'None'`, and invoke it from `main.bicep` with `scope: resourceGroup('rg-stockanalyzer-prod')`.

6. **Dev Key Vault secrets are created out-of-band** (Bicep never writes secret values; the prod template already treats KV secrets as externally managed). The deployment runbook (Task on Phase 2's side, but document it here) must `az keyvault secret set` `DbConnectionString-dev` and `BlobStorageConnection-dev` into the existing `kv-roadtripmap-prod`. The design names a separate `kv-roadtripmap-dev`; **simplify to reusing `kv-roadtripmap-prod` with `-dev`-suffixed secret names** since the prod App Service MSI and dev slot MSI both need access and the existing KV already has RBAC wired — UNLESS the executor finds the dev slot MSI cannot be granted access to the prod KV, in which case add a `kv-roadtripmap-dev` vault + role assignment for the dev slot MSI. Document the decision in the phase commit message. (Either way, ensure the dev slot's SystemAssigned MSI has a `Key Vault Secrets User` role assignment on whichever vault holds the `-dev` secrets — add the role assignment in Bicep mirroring the existing prod MSI→KV assignment.)

**Verification:**
Run (in-container, read-only — this does NOT deploy):
```bash
az bicep build --file infrastructure/azure/main.bicep
```
Expected: compiles to ARM JSON with no errors. 

Then hand off to Patrick to run `what-if`:
```
az deployment group what-if --resource-group rg-roadtripmap-prod --template-file infrastructure/azure/main.bicep --parameters @infrastructure/azure/parameters.json
```
Expected (Patrick observes): the diff shows ONLY additive dev resources (dev slot + dev slot settings in `rg-stockanalyzer-prod`, dev SQL DB in `rg-roadtripmap-prod`, dev blob container, dev slot MSI role assignment, the sticky `slotConfigNames` on the parent site). No SKU change (plan stays the shared P0v3 `asp-stockanalyzer`). No destructive changes to prod resources.

**Commit:** `feat(infra): add dev App Service slot + dev DB/container/sticky settings (native-ios native-ios.AC7.1/native-ios.AC7.2)`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: `deploy-dev.yml` GitHub Actions workflow (workflow_dispatch)

**Verifies:** native-ios.AC7.3

**Environment:** Authored **in-container**. Patrick dispatches it from the GitHub UI.

**Files:**
- Create: `.github/workflows/deploy-dev.yml`
- Read for reference: `.github/workflows/deploy.yml`

**Implementation:**
Author a parallel workflow that mirrors `deploy.yml` but targets the `dev` slot. Read `deploy.yml` first and copy its structure (preflight via the shared `psford/claude-env` reusable workflows, build & test, docker build/push, deploy). Differences:
- `on: workflow_dispatch` with the same `confirm_deploy` (must equal `"deploy"`) and `reason` inputs.
- Build & push container tagged `dev-{github.run_number}` and `dev-latest` (not `prod-*`/`latest`).
- Deploy step targets the slot — **note the App Service is cross-RG in `rg-stockanalyzer-prod`**: `az webapp config container set --resource-group rg-stockanalyzer-prod --name app-roadtripmap-prod --slot dev --container-image-name acrstockanalyzerer34ug.azurecr.io/roadtripmap:dev-${{ github.run_number }} --container-registry-url https://acrstockanalyzerer34ug.azurecr.io --container-registry-user ... --container-registry-password ...` then `az webapp restart --resource-group rg-stockanalyzer-prod --name app-roadtripmap-prod --slot dev`.
- Health check targets the slot URL: `https://app-roadtripmap-prod-dev.azurewebsites.net/api/health` (5 retries, 30s apart). Verify the exact slot hostname format — App Service slot hostnames are `{site}-{slot}.azurewebsites.net`.
- Use the GitHub deployment environment gate consistent with `deploy.yml` (a `dev` environment is fine; do not require the `Production` gate).
- Do NOT run Bicep or EF migrations in the workflow (matches prod pattern — those are manual per runbook). **EF migrations against the dev DB are applied manually**: document in the workflow's top comment that before first deploy, the dev DB must be migrated by setting `RT_DESIGN_CONNECTION` to the dev connection string and running `dotnet ef database update --project src/RoadTripMap`.

**Verification:**
```bash
# Lint the YAML (in-container)
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-dev.yml')); print('valid yaml')"
```
Expected: `valid yaml`. Full functional verification is native-ios.AC7.3: Patrick dispatches the workflow and it builds + deploys to the dev slot, and `/api/version` on the slot URL returns 200 (that satisfies native-ios.AC7.2's "/api/version returns successfully" once the dev DB is migrated).

**Commit:** `feat(ci): add deploy-dev.yml manual workflow targeting dev slot (native-ios native-ios.AC7.3)`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Native client base-URL configuration (prod vs dev slot)

**Verifies:** None directly (configuration scaffolding consumed by Phase 2's API client). Establishes the dev-slot iteration target chosen by Patrick.

**Environment:** Authored in-container; build-verified on **Mac**.

**Files:**
- Create: `ios-swift/RoadTrip/Config/Debug.xcconfig`
- Create: `ios-swift/RoadTrip/Config/Release.xcconfig`
- Modify: `ios-swift/RoadTrip/project.yml` (wire xcconfig files per build configuration)
- Create: `ios-swift/RoadTrip/RoadTrip/App/AppConfig.swift` (reads the base URL from the synthesized Info.plist)

**Implementation:**
- Add an `API_BASE_URL` build setting in each xcconfig. **Per Patrick's decision, Debug points at the dev slot:**
  - `Debug.xcconfig`: `API_BASE_URL = https:/$()/app-roadtripmap-prod-dev.azurewebsites.net` (the `/$()/` trick escapes the `//` so xcconfig doesn't treat it as a comment).
  - `Release.xcconfig`: `API_BASE_URL = https:/$()/app-roadtripmap-prod.azurewebsites.net` (prod). Phase 8 will introduce a `Release-TestFlight` variant that points at the dev slot; for now Release = prod.
- In `project.yml`, attach the xcconfig to the RoadTrip target's `configs:` (`Debug` and `Release`). Add a synthesized Info.plist key via `GENERATE_INFOPLIST_FILE` + an `INFOPLIST_KEY_*` or an explicit `info.properties` entry mapping `APIBaseURL` to `$(API_BASE_URL)`. Confirm the XcodeGen mechanism for injecting a custom Info.plist key (the project already uses `GENERATE_INFOPLIST_FILE: YES`; use `info: properties:` in project.yml to add `APIBaseURL: $(API_BASE_URL)`).
- `AppConfig.swift`: a tiny `enum AppConfig { static var apiBaseURL: URL { URL(string: Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as! String)! } }`. (Swift note: `Bundle.main.object(forInfoDictionaryKey:)` reads the synthesized Info.plist value; force-unwrap is acceptable for a build-time-guaranteed config key.)

**Verification (Mac):**
```bash
cd ios-swift/RoadTrip && xcodegen generate && xcodebuild -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17' build
```
Expected: builds. A throwaway log/print of `AppConfig.apiBaseURL` in Debug shows the dev-slot host.

**Commit:** `feat(ios): base-URL xcconfig (Debug=dev slot, Release=prod) + AppConfig`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_TASK_4 -->
### Task 4: Confirm there is no PR #108 facade to delete (no-op reconciliation)

**Verifies:** None (cleanup confirmation).

**Environment:** In-container.

**Implementation:**
The design says to delete `Views/*` and `App/SampleData.swift`. **Investigation confirmed neither exists.** Verify and record the finding; delete only if something is actually present.

**Verification:**
```bash
ls ios-swift/RoadTrip/RoadTrip/Views 2>/dev/null && echo "FACADE PRESENT — delete it" || echo "no Views/ — nothing to delete"
ls ios-swift/RoadTrip/RoadTrip/App/SampleData.swift 2>/dev/null && echo "SampleData PRESENT — delete it" || echo "no SampleData.swift — nothing to delete"
```
Expected: both report "nothing to delete". If either is present (codebase drifted), delete it and the references in `project.yml`, then re-run `xcodegen generate` on the Mac. No commit needed if nothing changed.
<!-- END_TASK_4 -->

<!-- START_SUBCOMPONENT_B (tasks 5-8) — GRDB v2 migration + durable staging cache (Mac-verified) -->

<!-- START_TASK_5 -->
### Task 5: Update `UploadStage` enum to the design's stage sequence

**Verifies:** None directly (storage model change; round-trip verified in Task 8).

**Environment:** Build on **Mac**.

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Models/UploadQueueItem.swift`

**Implementation:**
Replace the enum so the front stages exist and `staged` is renamed to `queued`. Keep String rawValues stable for the unchanged cases:

```swift
enum UploadStage: String, Codable {
    case queued                                   // net-new front stage: captured offline, bytes cached, NO network touched
    case requesting                               // net-new: request-upload in flight (mint/refresh SAS)
    case uploadingOriginal = "uploading_original"
    case uploadingDisplay  = "uploading_display"
    case uploadingThumb    = "uploading_thumb"
    case committing
    case done
    case failed
}
```
Note: the v1 `staged` case is removed in code; the v2 migration (Task 7) rewrites any persisted `"staged"` rows to `"queued"`, so no decode failures occur. New `queued`-stage items are the offline-capture entry point (Phase 5 inserts here).

**Verification (Mac):** `xcodebuild ... build` succeeds. (Behavior verified in Task 8.)

**Commit:** grouped with Task 8.
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Add `placeNamePending` to the `Photo` model

**Verifies:** None directly (round-trip verified in Task 8).

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Models/Photo.swift`

**Implementation:**
Add `var placeNamePending: Bool` after `placeName`. Semantics: `true` when coordinates are known but the human-readable place name has not been reverse-geocoded yet (offline capture); the carousel/popup show "Locating…" while `placeNamePending == true`. Default for hydrated server photos is `false` (server always sends a resolved `placeName`). Keep `Codable`/`Identifiable`/`Equatable` conformances. (Swift note: a non-optional `Bool` with a schema default keeps decoding of server `PhotoResponse` JSON safe only if the server sends the field — it does NOT, so when decoding the **server DTO** you map into `Photo` and set `placeNamePending = false` explicitly; GRDB decoding uses the column which the migration defaults to `0`.)

**Verification (Mac):** build succeeds. Behavior verified in Task 8.

**Commit:** grouped with Task 8.
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Migrator v2 — add `placeNamePending` column + migrate legacy `staged` rows

**Verifies:** None directly (verified in Task 8).

**Files:**
- Modify: `ios-swift/RoadTrip/RoadTrip/Storage/Migrator.swift`

**Implementation:**
Register a `"v2"` migration AFTER `"v1"` (never edit v1). It must be safe over a DB that already has rows:

```swift
migrator.registerMigration("v2") { db in
    // additive: place-name-pending flag, defaulting existing rows to false (server photos have resolved names)
    try db.alter(table: Photo.databaseTableName) { t in
        t.add(column: "placeNamePending", .boolean).notNull().defaults(to: false)
    }
    // reconcile any persisted legacy "staged" stage to the new "queued" front stage
    try db.execute(sql: "UPDATE \(UploadQueueItem.databaseTableName) SET stage = 'queued' WHERE stage = 'staged'")
}
```
GRDB runs registered migrations in order and records applied versions, so v1→v2 applies cleanly over existing data and is idempotent on re-launch.

**Verification (Mac):** build succeeds; full behavior in Task 8.

**Commit:** grouped with Task 8.
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Durable non-purgeable staging cache + v2 migration tests

**Verifies:** None (storage infrastructure; design "Done when": v1→v2 applies over existing rows and round-trips `queued`).

**Files:**
- Create: `ios-swift/RoadTrip/RoadTrip/Storage/StagingFileStore.swift`
- Modify: `ios-swift/RoadTrip/RoadTripTests/StorageTests.swift`

**Implementation:**
1. `StagingFileStore` — a sibling of `PhotoFileCache` but rooted in **Application Support**, not Caches, so iOS will not purge the offline queue's source bytes:
   - Root: `~/Library/Application Support/UploadStaging/{tripId.uuidString}/{uploadId.uuidString}.{ext}`
   - Methods: `stageURL(tripId:uploadId:ext:) -> URL`, `store(data:tripId:uploadId:ext:) throws -> URL`, `data(tripId:uploadId:ext:) -> Data?`, `remove(tripId:uploadId:) throws`, `removeAll(tripId:) throws`.
   - No LRU/eviction — these bytes are deleted only when their upload reaches `done` or the item is discarded/aborted. (Swift note: use `FileManager.default.url(for: .applicationSupportDirectory, ...)`, create intermediate dirs.)
2. Tests in `StorageTests.swift` (follow existing patterns: `AppDatabase.makeInMemory()`, fixed dates, temp dirs with cleanup):
   - **Migration applies over existing rows:** open an in-memory DB, run only v1 (insert a Trip + an `UploadQueueItem` with `stage` raw `"staged"` via raw SQL), then run the full migrator; assert v2 applied, the row's `stage` reads back as `.queued`, and `photo.placeNamePending` column exists and defaults `false` on an inserted-then-fetched Photo.
   - **`queued` round-trip:** insert an `UploadQueueItem` with `stage = .queued`, fetch it, assert `stage == .queued`.
   - **`StagingFileStore` round-trip + survives Caches semantics:** store bytes, read back equal; assert the path is under Application Support (string contains "Application Support"), not under "Caches".

**Verification (Mac):**
```bash
cd ios-swift/RoadTrip && xcodegen generate && xcodebuild test -scheme RoadTrip -destination 'platform=iOS Simulator,name=iPhone 17'
```
Expected: all StorageTests pass, including the new v2 + staging tests. **Screenshot/log of the green test run is the Phase-1 Swift sign-off** (Mac). Also confirm the existing app still launches empty on the simulator (UITest `testAppLaunches` green).

**Commit:** `feat(ios): GRDB v2 migration (queued/requesting stages, placeNamePending) + durable staging cache`
<!-- END_TASK_8 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase Done When
- `az bicep build` is clean in-container; Patrick's `what-if` shows only additive dev resources — no plan SKU change (the shared P0v3 plan is referenced as `existing`) (native-ios.AC7.1).
- After Patrick dispatches `deploy-dev.yml` and the dev DB is migrated, the dev slot URL returns 200 on `/api/version` (native-ios.AC7.2, native-ios.AC7.3).
- On the Mac: the scaffold still builds and launches empty on the simulator (facade confirmed absent); `xcodebuild test` passes including the new v2-migration + `StagingFileStore` tests, proving the migration applies over existing rows and round-trips the `queued` stage (design "Done when").
