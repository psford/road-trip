# Phase 4: Deployment Runbook + Dark-Release Flag

## Goal

Add a config-driven kill switch (`ClientSideProcessingEnabled`) that allows disabling client-side image processing without a code deploy. When the flag is off, the client skips processing entirely and uploads only the original -- the server falls back to server-side tier generation via `GenerateDerivedTiersAsync`. Ship with tests covering both flag states and extend the deployment runbook.

## Architecture

```
appsettings.Production.json
  "Upload": { "ClientSideProcessingEnabled": false }
       |
       v
Program.cs middleware
  Injects <meta name="client-processing-enabled" content="false"> into post.html response
       |
       v
imageProcessor.js
  Reads meta tag on first call. If "false", processForUpload() returns passthrough result
  (original unchanged, no display/thumb, no CDN loads)
       |
       v
postUI.js
  Detects null display/thumb in processResult, passes to UploadQueue without tier blobs
       |
       v
uploadQueue.js
  Skips _uploadTiers() if display/thumb are null
       |
       v
Server CommitAsync
  Detects missing tier blobs, falls back to GenerateDerivedTiersAsync (ACX.3)
```

## Tech Stack

- ASP.NET Core 8.0 configuration + middleware
- Vanilla JavaScript (`<meta>` tag reading)
- xUnit for .NET tests
- Vitest for JS tests

## Scope

### In Scope
- Modified file: `src/RoadTripMap/wwwroot/js/imageProcessor.js` (read meta tag, skip if disabled)
- Modified file: `src/RoadTripMap/Program.cs` (inject meta tag from config)
- Modified file: `src/RoadTripMap/appsettings.Production.json` (add config key, default false)
- Modified file: `src/RoadTripMap/appsettings.json` (add config key, default true for dev)
- New/modified tests verifying both flag states
- Extended deployment runbook

### Out of Scope
- Module creation (Phase 1)
- Server contract changes (Phase 2)
- E2E tests (Phase 3)

## Codebase Verified

2026-04-15

## AC Coverage

| AC | Description | Covered By |
|----|-------------|------------|
| (deployment safety) | Config-only kill switch for rollback without redeploy | Task 1-4 |

This phase does not map to specific functional ACs -- it is a deployment safety mechanism. When the flag is ON, all ACs from Phases 1-3 are active. When OFF, the system degrades gracefully to the pre-feature state (server-side tier generation).

---

<!-- START_TASK_1 -->
## Task 1: Add configuration key to appsettings files

**Verifies:** None (infrastructure)

### 1A: Production config (default OFF)

**File:** `src/RoadTripMap/appsettings.Production.json`

Add the `ClientSideProcessingEnabled` key under the existing `Upload` section. If no `Upload` section exists, create it. The production default is `false` -- processing is disabled until explicitly enabled after smoke testing.

Find the existing JSON structure and add:

```json
{
  "Upload": {
    "ClientSideProcessingEnabled": false
  }
}
```

If the `Upload` section already exists with other keys (like `SasTokenTtl`, `MaxBlockSizeBytes`), add `ClientSideProcessingEnabled` alongside them:

```json
{
  "Upload": {
    "SasTokenTtl": "...",
    "MaxBlockSizeBytes": ...,
    "ClientSideProcessingEnabled": false
  }
}
```

### 1B: Development config (default ON)

**File:** `src/RoadTripMap/appsettings.json`

Same structure, but default `true` so developers and local testing always exercise the processing code path:

```json
{
  "Upload": {
    "ClientSideProcessingEnabled": true
  }
}
```

Again, merge into the existing `Upload` section if one exists.

### Commit Message

```
chore: add Upload:ClientSideProcessingEnabled config key

Default false in production (dark release), true in development.
Controls whether client-side image processing is active.
```

### Verification

```bash
cd /workspaces/road-trip && dotnet build RoadTripMap.sln
```

<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
## Task 2: Add middleware to inject `<meta>` tag into post.html

**Verifies:** None (infrastructure)

**File:** `src/RoadTripMap/Program.cs`

### Context

`Program.cs` contains all endpoint definitions (Minimal API) and middleware configuration. It already has middleware that injects version headers (`x-server-version`, `x-client-min-version`) on every response. The existing pattern for configuration injection uses `IConfiguration` or `IOptions<T>`.

### Implementation

`Program.cs` already has a response body rewriting middleware for the feature flag meta tag injection (around line 197). It intercepts `/post/{token}` page requests, buffers the response body in a `MemoryStream`, mutates the HTML, and writes the modified bytes back. **Extend that exact middleware** to also inject the `client-processing-enabled` meta tag — do not add a second middleware.

The existing middleware (lines 197–230) currently does:

```csharp
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    var isPostPage = path.StartsWith("/post/", StringComparison.OrdinalIgnoreCase)
        && !path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);

    if (isPostPage)
    {
        var originalBodyStream = context.Response.Body;
        var memoryStream = new MemoryStream();
        context.Response.Body = memoryStream;

        await next();

        memoryStream.Position = 0;
        var reader = new StreamReader(memoryStream);
        var content = await reader.ReadToEndAsync();

        // Inject feature flags into the meta tag
        var resilientUploadsUI = app.Configuration.GetValue<bool>("FeatureFlags:ResilientUploadsUI");
        content = content.Replace(
            """<meta id="featureFlags" data-resilient-uploads-ui="">""",
            $"""<meta id="featureFlags" data-resilient-uploads-ui="{resilientUploadsUI.ToString().ToLower()}">""");

        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        context.Response.ContentLength = bytes.Length;
        await originalBodyStream.WriteAsync(bytes, 0, bytes.Length);
        context.Response.Body = originalBodyStream;
    }
    else
    {
        await next();
    }
});
```

Add the `ClientSideProcessingEnabled` injection **inside the same `if (isPostPage)` block**, immediately after the existing `content.Replace(...)` call and before computing `bytes`:

The modified middleware (showing only the changed `if (isPostPage)` body) becomes:

```csharp
    if (isPostPage)
    {
        var originalBodyStream = context.Response.Body;
        var memoryStream = new MemoryStream();
        context.Response.Body = memoryStream;

        await next();

        memoryStream.Position = 0;
        var reader = new StreamReader(memoryStream);
        var content = await reader.ReadToEndAsync();

        // Inject feature flags into the meta tag (existing)
        var resilientUploadsUI = app.Configuration.GetValue<bool>("FeatureFlags:ResilientUploadsUI");
        content = content.Replace(
            """<meta id="featureFlags" data-resilient-uploads-ui="">""",
            $"""<meta id="featureFlags" data-resilient-uploads-ui="{resilientUploadsUI.ToString().ToLower()}">""");

        // Inject client-processing-enabled meta tag (NEW -- added in this phase)
        var clientProcessingEnabled = app.Configuration.GetValue<bool>("Upload:ClientSideProcessingEnabled", false);
        content = content.Replace(
            "</head>",
            $"""<meta name="client-processing-enabled" content="{clientProcessingEnabled.ToString().ToLower()}"></head>""");

        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        context.Response.ContentLength = bytes.Length;
        await originalBodyStream.WriteAsync(bytes, 0, bytes.Length);
        context.Response.Body = originalBodyStream;
    }
```

Key details:
- Do not create a new middleware. Extend the existing one at lines 197–230 of `Program.cs` with the two lines for `clientProcessingEnabled` shown above.
- The `</head>` replacement inserts the meta tag just before the closing `</head>` in the static HTML. This is the same injection point used by other implementations (e.g., Approach D in the original plan).
- `GetValue<bool>("Upload:ClientSideProcessingEnabled", false)` defaults to `false` if the key is absent, matching the production default.
- `ToString().ToLower()` produces `"true"` or `"false"` — matching the format that `_isProcessingEnabled()` in `imageProcessor.js` (Task 3) checks.

### Commit Message

```
feat: inject client-processing-enabled meta tag into post.html

Read Upload:ClientSideProcessingEnabled from config and inject as
meta tag. Enables config-only kill switch for client-side processing.
```

### Verification

```bash
cd /workspaces/road-trip && dotnet build RoadTripMap.sln && dotnet run --project src/RoadTripMap &
sleep 3
curl -s http://localhost:5100/post/test-token | grep -o 'client-processing-enabled[^"]*"[^"]*"'
kill %1
```

The grep should show `client-processing-enabled" content="true"` (or `false` depending on which appsettings takes priority).

<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
## Task 3: Add flag check to `imageProcessor.js`

**Verifies:** None (infrastructure, enables safe rollout)

**File:** `src/RoadTripMap/wwwroot/js/imageProcessor.js`

### Changes

At the beginning of the `processForUpload` function (inside the IIFE), add a check for the meta tag. If processing is disabled, return a passthrough result immediately without loading any CDN dependencies or performing any Canvas operations.

Add a module-scope variable to cache the flag value:

```js
let _processingEnabled = null; // null = not yet checked

function _isProcessingEnabled() {
    if (_processingEnabled === null) {
        const meta = document.querySelector('meta[name="client-processing-enabled"]');
        _processingEnabled = meta ? meta.getAttribute('content') === 'true' : true;
        // Default to true if meta tag is missing (dev environment, tests)
    }
    return _processingEnabled;
}
```

Then at the top of `processForUpload`:

```js
async function processForUpload(file, exifData) {
    if (!_isProcessingEnabled()) {
        // Processing disabled by server config -- passthrough
        return {
            original: file,
            display: null,
            thumb: null,
            compressionApplied: false,
            heicConverted: false,
            originalBytes: file.size,
            outputBytes: file.size,
            durationMs: 0,
        };
    }

    // ... rest of existing processForUpload code
}
```

Key details:
- When disabled, `display` and `thumb` are `null`. The upload queue (modified in Phase 2, Task 2, Subcomponent D) already handles null tiers by skipping `_uploadTiers()`.
- When disabled, no CDN dependencies are loaded (AC4.1 -- zero cost when off).
- The meta tag is read once and cached. No repeated DOM queries.
- Default is `true` when the meta tag is missing. This is important because:
  - In dev, the meta tag may not be injected if the middleware isn't running.
  - In tests, the meta tag won't exist in jsdom unless explicitly added.
  - This means all Phase 1 tests continue to pass without modification.

Also add a test-only reset for the cached flag:

```js
// In the return statement, add:
_resetProcessingFlag() {
    _processingEnabled = null;
}
```

### Commit Message

```
feat: add config flag check to ImageProcessor for dark-release control

Read client-processing-enabled meta tag on first call. When false,
return passthrough result with null display/thumb. Default true when
meta tag is missing (dev/test environments).
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

All Phase 1 tests must still pass (meta tag absent = default true = processing enabled).

<!-- END_TASK_3 -->

---

<!-- START_TASK_4 -->
## Task 4: Add tests for flag-on and flag-off states

**Verifies:** None (infrastructure, validates rollback safety)

**File:** `tests/js/imageProcessor.test.js` (extend existing file from Phase 1)

### Changes

Add a new `describe` block for the feature flag behavior:

```js
describe('feature flag (client-processing-enabled meta tag)', () => {
    afterEach(() => {
        // Remove any injected meta tags
        const meta = document.querySelector('meta[name="client-processing-enabled"]');
        if (meta) meta.remove();
        ImageProcessor._resetProcessingFlag();
        ImageProcessor._resetLazyLoaders();
    });

    it('processes normally when meta tag is absent (default enabled)', async () => {
        // No meta tag injected -- should default to enabled
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.display).toBeInstanceOf(Blob); // Tiers generated
        expect(result.thumb).toBeInstanceOf(Blob);
    });

    it('processes normally when meta tag is "true"', async () => {
        const meta = document.createElement('meta');
        meta.name = 'client-processing-enabled';
        meta.content = 'true';
        document.head.appendChild(meta);

        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.display).toBeInstanceOf(Blob);
        expect(result.thumb).toBeInstanceOf(Blob);
    });

    it('returns passthrough result when meta tag is "false"', async () => {
        const meta = document.createElement('meta');
        meta.name = 'client-processing-enabled';
        meta.content = 'false';
        document.head.appendChild(meta);

        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.original).toBe(file); // Same reference, passthrough
        expect(result.display).toBeNull();
        expect(result.thumb).toBeNull();
        expect(result.compressionApplied).toBe(false);
        expect(result.heicConverted).toBe(false);
        expect(result.durationMs).toBe(0);
    });

    it('does not load any CDN dependencies when flag is off', async () => {
        const meta = document.createElement('meta');
        meta.name = 'client-processing-enabled';
        meta.content = 'false';
        document.head.appendChild(meta);

        // Even with an oversize file, no CDN loading should occur
        const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        // Verify no imports were attempted
        expect(mockCompress).not.toHaveBeenCalled();
        expect(mockHeic2any).not.toHaveBeenCalled();
        expect(mockPiexif.load).not.toHaveBeenCalled();

        // File is passed through unchanged even though it's oversize
        expect(result.original).toBe(file);
        expect(result.originalBytes).toBe(file.size);
    });

    it('caches the flag value across calls', async () => {
        const meta = document.createElement('meta');
        meta.name = 'client-processing-enabled';
        meta.content = 'false';
        document.head.appendChild(meta);

        const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
        await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        // Change the meta tag (simulate config update without page reload)
        meta.content = 'true';

        // Should still return passthrough (cached value)
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });
        expect(result.display).toBeNull(); // Still using cached "false"
    });
});
```

### Also add .NET test for meta tag injection

**File:** `tests/RoadTripMap.Tests/` (extend existing test file or create new)

Add a test that verifies the middleware injects the meta tag correctly:

```csharp
[Fact]
public async Task PostPage_ContainsClientProcessingMetaTag()
{
    // Arrange: configure ClientSideProcessingEnabled = true
    // Use WebApplicationFactory or similar test host

    // Act: GET /post/{someToken}
    var response = await _client.GetAsync($"/post/{testToken}");
    var html = await response.Content.ReadAsStringAsync();

    // Assert
    html.Should().Contain("client-processing-enabled");
    html.Should().Contain("content=\"true\"");
}

[Fact]
public async Task PostPage_MetaTagReflectsConfig_WhenDisabled()
{
    // Arrange: configure ClientSideProcessingEnabled = false
    // Override config in test host

    // Act
    var response = await _client.GetAsync($"/post/{testToken}");
    var html = await response.Content.ReadAsStringAsync();

    // Assert
    html.Should().Contain("content=\"false\"");
}
```

### Commit Message

```
test: verify feature flag enables/disables client-side processing

Test meta tag absent (default on), meta tag true (on), meta tag false
(off with passthrough, no CDN loads). Test .NET middleware injects
meta tag from config.
```

### Verification

```bash
cd /workspaces/road-trip && npm test && dotnet test RoadTripMap.sln
```

All tests must pass.

<!-- END_TASK_4 -->

---

<!-- START_TASK_5 -->
## Task 5: Extend deployment runbook

**Verifies:** None (documentation/operations)

**File:** `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

### Context

The deployment runbook already has Phase 1-4 sections for the resilient upload pipeline. Add a Phase 5 section for the client-side processing deployment.

### Changes

Add the following section after the existing Phase 4 section:

```markdown
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
```

### Commit Message

```
docs: add Phase 5 client-side processing section to deployment runbook

Cover pre-deployment checklist, staged rollout with flag, smoke tests,
monitoring period, and config-only rollback procedure.
```

### Verification

No code verification needed. Review the runbook section for completeness.

<!-- END_TASK_5 -->

---

<!-- START_TASK_6 -->
## Task 6: Finalize deferred-work notes in the resilient-uploads deployment runbook

**Verifies:** None (documentation/operations)

**File:** `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md`

### Context

The resilient-uploads deployment runbook has a Phase 4 section covering the original acceptance and sign-off steps for the resilient upload pipeline. Because the client-side processing fix (this plan, Phases 1–4) must ship before the deferred design Phases 1–2 can proceed (see the "Notes for Implementers" section in phase_01.md of this plan), the Phase 4 section of that runbook needs an explicit note acknowledging that its sign-off is conditional.

### Changes

Open `docs/implementation-plans/2026-04-13-resilient-uploads/deployment-runbook.md` and locate the Phase 4 section. Append the following note at the end of that section (before any Phase 5 section, or at the end of the file if Phase 4 is the last section):

```markdown
### Deferred acceptance note (added 2026-04-16)

**Phase 4 sign-off is deferred pending the client-side processing fix.**

The acceptance session and legacy-trip audit (design Phases 1–2) cannot proceed until the oversize image compression plan (`docs/implementation-plans/2026-04-16-oversize-image-compression/`) is fully deployed and verified. Rationale: the current server-side tier generation bottleneck causes 6/20 photo uploads to fail in a 20-photo batch under load, which would invalidate any acceptance session run against the unpatched server.

**Phase 4 sign-off conditions:**

1. The oversize compression plan's Phases 1–4 are deployed to production with `Upload:ClientSideProcessingEnabled = true`.
2. A 20-photo batch smoke test on prod completes with zero failed uploads and total time under 3 minutes (matching the Playwright scenario in `docs/implementation-plans/2026-04-16-oversize-image-compression/phase_03.md`, Task 3, Subcomponent D).
3. Server logs confirm `GenerateDerivedTiersAsync` is **not** called during the smoke test (client tiers used).

Only after these three conditions are met should the Phase 4 acceptance session and legacy-trip audit proceed.
```

### Commit Message

```
docs: add deferred acceptance note to resilient-uploads Phase 4 runbook

Document that Phase 4 sign-off is conditional on the oversize
compression fix shipping first, and specify the exact conditions
(20-photo batch test, processing flag enabled, server-side gen bypassed).
```

### Verification

No code verification needed. Review the updated runbook section for completeness and accuracy against the conditions described in phase_01.md of this plan.

<!-- END_TASK_6 -->
