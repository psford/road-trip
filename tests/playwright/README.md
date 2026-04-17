# Playwright E2E Tests for Resilient Uploads Phase 3

This directory contains end-to-end tests for the resilient-uploads Phase 3 UI (progress panel, resume banner, optimistic pins, and pin-drop fallback).

## Prerequisites

Before running Playwright tests, you must have:

1. **Docker and Docker Compose** — Required for Azurite (Azure Storage emulator) and SQL Server
   ```bash
   docker --version
   docker-compose --version
   ```

2. **.NET 8.0 SDK** — Required to run the ASP.NET Core app
   ```bash
   dotnet --version
   ```

3. **Node.js and npm** — Required for Playwright
   ```bash
   npm --version
   node --version
   ```

4. **Playwright browsers installed**
   ```bash
   npx playwright install
   ```

## Setup

### 1. Start Azurite and SQL Server

The test suite expects Azurite and SQL Server to be running. Use the provided docker-compose file:

```bash
cd /workspaces/road-trip
docker-compose -f tests/docker-compose.azurite.yml up -d
```

This starts:
- **Azurite** on `http://127.0.0.1:10000` (blob storage emulator)
- **SQL Server** on `localhost:1433` (with SA password in the file)

Verify they're running:
```bash
docker ps | grep -E "azurite|mcr.microsoft.com/mssql"
```

### 2. Configure ASP.NET Core for Test Mode

The tests expect the app to run with:
- **Feature flag `FeatureFlags:ResilientUploadsUI=true`** — Required for Phase 3 UI to appear
- **In-memory database** or test database — Not production
- **Azurite blob storage** — Points to local emulator

Set these via environment variables before running the app:

```bash
export ASPNETCORE_ENVIRONMENT=Development
export FeatureFlags__ResilientUploadsUI=true
export AZURITE_URL=http://127.0.0.1:10000
export AZURITE_ACCOUNT_NAME=devstoreaccount1
export AZURITE_ACCOUNT_KEY=Eby8vdM02xNOcqFlqUwJPLMRiipb+c1P3OxyKr5yYO+I2qqZ2IWsRr3ZM8M5eIVhC/ubS8vLOYPLl1xVKvEQEA==
```

Or set them in `appsettings.Development.json`:

```json
{
  "FeatureFlags": {
    "ResilientUploadsUI": true
  },
  "Azurite": {
    "BlobServiceUri": "http://127.0.0.1:10000/devstoreaccount1"
  }
}
```

### 3. Start the App

```bash
cd /workspaces/road-trip
dotnet run --project src/RoadTripMap
```

The app will start on `http://localhost:5100` (default).

Verify it's running:
```bash
curl -i http://localhost:5100/api/version
```

Expected response:
```
HTTP/1.1 200 OK
x-server-version: 1.0.0
x-client-min-version: 1.0.0

{"server_version":"1.0.0","client_min_version":"1.0.0"}
```

## Running Tests

### Run All Tests

```bash
npm run test:e2e
```

### Run a Specific Test

```bash
npx playwright test --grep "AC5.1"
```

### Run in Debug Mode

```bash
npx playwright test --debug
```

### Run in a Specific Browser

```bash
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit
```

## Test Structure

### `resilient-uploads.spec.js`

Contains 7 end-to-end test scenarios:

1. **AC5.1 + AC7.1: Batch upload with progress panel and optimistic pins**
   - Uploads 3 photos
   - Verifies progress panel shows 3 rows with filenames
   - Verifies optimistic pins appear on map with pending styling

2. **AC5.4 + AC7.3: Force-fail with 503, display retry exhausted, red pin**
   - Forces network failure (503) on all block uploads
   - Verifies "gave up after 6 attempts" message appears
   - Verifies red pin appears with retry/pin-drop/discard buttons

3. **AC5.3: Pin-drop on failed upload**
   - Forces a failure
   - Clicks "📍 Pin manually" button
   - Verifies pin-drop flow is triggered (no crash)

4. **AC4.1: Mid-batch resume**
   - Starts uploading 3 photos
   - Interrupts mid-batch (closes context)
   - Reloads the page
   - Verifies resume banner appears with pending count

5. **AC7.5: Discard all removes failed uploads and red pins**
   - Creates 2 failed uploads
   - Clicks "Discard all" (or individual discard buttons)
   - Verifies failed pins are removed from the map
   - Verifies progress panel rows are removed

6. **AC5.5: Collapse/expand progress panel persists state**
   - Uploads a photo
   - Collapses the progress panel
   - Reloads the page
   - Verifies the panel state is persisted in sessionStorage

7. **Setup/Teardown**
   - Each test creates a new trip via `POST /api/trips`
   - Navigates to the trip's upload page
   - Verifies feature flag is enabled (progress panel visible)

## Test Fixtures and Helpers

### `createTestJpegWithExif(filename, exifLat, exifLon)`

Creates a minimal JPEG buffer with EXIF GPS data. In production, this would use `piexif` library to inject real EXIF headers. For now, it creates a placeholder that passes file-type checks.

**Note:** To fully test EXIF parsing, the test app should be modified to accept file uploads and extract EXIF server-side (already implemented in Phase 1–2).

### Base URL

All tests use `http://localhost:5100` (hardcoded in tests). If your app runs on a different port, update the `BASE_URL` constant in `resilient-uploads.spec.js`.

## Known Limitations

1. **Playwright test files may not be fully runnable without the full server environment** — The tests are structurally correct but assume:
   - Azurite is reachable and functional
   - SQL Server is running
   - App is configured with test data
   - Feature flag is enabled

2. **EXIF handling** — The test helper `createTestJpegWithExif` creates a placeholder JPEG. Real EXIF injection requires `piexif` npm package or server-side handling.

3. **File upload size** — Tests upload small synthetic files. For real large-file testing, increase buffer sizes and test with multi-block uploads.

4. **Mock responses** — Tests use `page.route()` to intercept and abort blob uploads. Real network failures are harder to reproduce consistently.

## Troubleshooting

### Tests hang waiting for progress panel

**Cause:** Feature flag is off or app is not running.

**Fix:**
```bash
curl http://localhost:5100/api/version  # Verify app is running
echo "FeatureFlags__ResilientUploadsUI=true" # Verify flag is set
```

### Azurite connection refused

**Cause:** Docker container is not running.

**Fix:**
```bash
docker-compose -f tests/docker-compose.azurite.yml up -d
docker logs <container_id>
```

### Tests timeout on file input

**Cause:** Browser not finding file input element.

**Fix:**
```bash
# Add debug logging to the test:
await page.screenshot({ path: 'debug.png' });
console.log(await page.innerHTML('body'));
```

### Resume banner doesn't appear

**Cause:** IndexedDB is not persisting data between contexts.

**Fix:**
- Ensure app is using IndexedDB for upload queue persistence
- Verify `StorageAdapter.listNonTerminal()` is implemented
- Check browser DevTools → Application → IndexedDB

## CI/CD Integration

In `.github/workflows/roadtrip-ci.yml`, add:

```yaml
- name: Run Playwright e2e tests
  run: npm run test:e2e
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
```

**Note:** CI tests should run after unit tests and use a dedicated test database, not production.

## Next Steps

After Phase 3 UI implementation is complete:

1. **Populate app configuration** with real Trip/Photo data fixtures
2. **Mock EXIF extraction** via `piexif` library
3. **Add visual regression tests** (Playwright screenshots)
4. **Extend to API contract tests** (verify request/response shapes)
5. **Performance baselines** (measure upload time, progress update frequency)

## Reference

- [Playwright Documentation](https://playwright.dev)
- [Playwright Config Reference](https://playwright.dev/docs/test-configuration)
- [Test Assertions](https://playwright.dev/docs/test-assertions)
- [Fixture Documentation](https://playwright.dev/docs/test-fixtures)
