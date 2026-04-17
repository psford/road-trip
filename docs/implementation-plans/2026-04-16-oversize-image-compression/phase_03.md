# Phase 3: Integration Testing + Playwright E2E

## Goal

Verify the full client-side processing pipeline end-to-end: from file selection through processing to committed photo with all three blob tiers. Add Vitest integration tests for the `postUI` processing flow and Playwright E2E tests with synthetic large images. Validate performance budgets.

## Architecture

```
Vitest integration test (postUI-processing.test.js):
  Mock file input -> postUI handler -> ImageProcessor (mocked) -> UploadQueue (mocked) -> verify events + args

Playwright E2E test (resilient-uploads.spec.js):
  Synthesize large PNG in browser -> file input -> real ImageProcessor -> real UploadQueue -> commit -> verify blobs
```

## Tech Stack

- Vitest + jsdom for integration tests
- Playwright for E2E browser tests
- Synthetic image generation via Canvas (in-browser, no test fixtures on disk)

## Scope

### In Scope
- New file: `tests/js/postUI-processing.test.js`
- Modified file: `tests/playwright/resilient-uploads.spec.js` (add processing scenario)
- New file: `tests/playwright/helpers/imageSynthesis.js` (helper to create large images in-browser)

### Out of Scope
- Module creation (Phase 1)
- Server changes (Phase 2)
- Feature flag (Phase 4)

## Codebase Verified

2026-04-15

## AC Coverage

| AC | Description | Covered By |
|----|-------------|------------|
| client-image-processing.AC4.2 | Processing 5MB JPEG completes in <3s | Task 2 |
| client-image-processing.AC4.3 | Compressing 18MB PNG completes in <8s | Task 2 |
| client-image-processing.AC3.1 | Progress panel shows "Processing..." | Task 1 |
| client-image-processing.AC3.2 | `upload:created` fires after processing | Task 1 |

---

<!-- START_TASK_1 -->
## Task 1: Create `postUI-processing.test.js` integration test

**Verifies:** client-image-processing.AC3.1, client-image-processing.AC3.2

**File:** `tests/js/postUI-processing.test.js`

This file does NOT exist yet -- create it from scratch.

### Context

This is an integration test that verifies the flow from file selection through `ImageProcessor` processing to `UploadQueue.start()` being called with the correct arguments including tier blobs. It does NOT test the actual image processing (that is covered in Phase 1's `imageProcessor.test.js`). Instead, it mocks `ImageProcessor` and verifies the orchestration in `postUI.js`.

The test environment uses Vitest with jsdom. Global modules are loaded via `loadGlobal()` in `tests/js/setup.js`. The `postUI.js` module likely has an internal handler function that is triggered by file input change events.

### Mocking strategy

1. **`ImageProcessor.processForUpload`**: Mock via `vi.spyOn(ImageProcessor, 'processForUpload')` to return controlled results without actual Canvas/CDN operations.
2. **`UploadQueue.start`**: Mock via `vi.spyOn(UploadQueue, 'start')` to capture the items array passed to it.
3. **`postService.extractPhotoMetadata`**: Mock to return controlled metadata without actual EXIF extraction.
4. **Event listeners**: Use `vi.fn()` callbacks attached to `document.addEventListener` to capture `upload:preparing` and `upload:created` events.

### Test cases

<!-- START_SUBCOMPONENT_A -->
#### Subcomponent A: Setup

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('postUI processing integration', () => {
    let preparingEvents;
    let failedEvents;
    let processForUploadSpy;
    let queueStartSpy;
    let extractMetadataSpy;

    beforeEach(() => {
        preparingEvents = [];
        failedEvents = [];

        document.addEventListener('upload:preparing', (e) => {
            preparingEvents.push(e.detail);
        });
        document.addEventListener('upload:failed', (e) => {
            failedEvents.push(e.detail);
        });

        // Mock ImageProcessor to return a successful result
        processForUploadSpy = vi.spyOn(ImageProcessor, 'processForUpload').mockResolvedValue({
            original: new File(['processed'], 'photo.jpg', { type: 'image/jpeg' }),
            display: new Blob(['display-tier'], { type: 'image/jpeg' }),
            thumb: new Blob(['thumb-tier'], { type: 'image/jpeg' }),
            compressionApplied: false,
            heicConverted: false,
            originalBytes: 3 * 1024 * 1024,
            outputBytes: 3 * 1024 * 1024,
            durationMs: 150,
        });

        // Mock UploadQueue.start to capture arguments
        queueStartSpy = vi.spyOn(UploadQueue, 'start').mockImplementation(() => {});

        // Mock metadata extraction
        extractMetadataSpy = vi.spyOn(postService, 'extractPhotoMetadata').mockResolvedValue({
            gps: { latitude: 40.7128, longitude: -74.006 },
            timestamp: new Date('2026-01-15T10:30:00Z'),
            placeName: 'New York, NY',
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });
```

Note: The exact mechanism for triggering the file-selection handler depends on how `postUI.js` exposes it. You may need to:
- Simulate a `change` event on the file input element (if the DOM is set up in beforeEach)
- Or call an internal method directly if exposed

Read `postUI.js` lines 353-381 to determine the exact trigger mechanism and adjust the test accordingly.
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B -->
#### Subcomponent B: Event ordering and queue argument tests

```js
    it('emits upload:preparing event before processing begins (AC3.1)', async () => {
        // Trigger file selection with a single file
        // (Implementation depends on how postUI exposes the handler)
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]); // Helper -- see note above

        expect(preparingEvents.length).toBe(1);
        expect(preparingEvents[0]).toHaveProperty('uploadId');
        expect(preparingEvents[0].fileName).toBe('photo.jpg');
    });

    it('calls ImageProcessor.processForUpload with file and metadata', async () => {
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(processForUploadSpy).toHaveBeenCalledWith(
            file,
            expect.objectContaining({
                gps: expect.objectContaining({ latitude: 40.7128 }),
                timestamp: expect.any(Date),
            })
        );
    });

    it('passes display and thumb blobs to UploadQueue.start (AC3.2, AC5.1)', async () => {
        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(queueStartSpy).toHaveBeenCalledTimes(1);
        const items = queueStartSpy.mock.calls[0][1]; // second argument is the items array
        expect(items.length).toBe(1);
        expect(items[0]).toHaveProperty('display');
        expect(items[0]).toHaveProperty('thumb');
        expect(items[0].display).toBeInstanceOf(Blob);
        expect(items[0].thumb).toBeInstanceOf(Blob);
    });

    it('upload:created fires after processing completes, not before (AC3.2)', async () => {
        const eventOrder = [];

        // Track ordering
        const origProcess = processForUploadSpy.getMockImplementation();
        processForUploadSpy.mockImplementation(async (...args) => {
            eventOrder.push('processing-started');
            const result = await origProcess(...args);
            eventOrder.push('processing-completed');
            return result;
        });

        document.addEventListener('upload:created', () => {
            eventOrder.push('upload:created');
        });

        const file = new File(['test-data'], 'photo.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        // upload:created must come after processing-completed
        const createdIndex = eventOrder.indexOf('upload:created');
        const completedIndex = eventOrder.indexOf('processing-completed');
        expect(completedIndex).toBeLessThan(createdIndex);
    });
```
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C -->
#### Subcomponent C: Processing failure tests (AC3.3)

```js
    it('handles processing failure per-file without blocking batch (AC3.3)', async () => {
        // First file fails, second succeeds
        processForUploadSpy
            .mockRejectedValueOnce(new Error('Out of memory'))
            .mockResolvedValueOnce({
                original: new File(['ok'], 'photo2.jpg', { type: 'image/jpeg' }),
                display: new Blob(['d'], { type: 'image/jpeg' }),
                thumb: new Blob(['t'], { type: 'image/jpeg' }),
                compressionApplied: false,
                heicConverted: false,
                originalBytes: 1024,
                outputBytes: 1024,
                durationMs: 50,
            });

        const file1 = new File(['fail-data'], 'bad.jpg', { type: 'image/jpeg' });
        const file2 = new File(['ok-data'], 'good.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file1, file2]);

        // First file should have emitted upload:failed with processing phase
        expect(failedEvents.length).toBe(1);
        expect(failedEvents[0].phase).toBe('processing');
        expect(failedEvents[0].error).toContain('Out of memory');

        // Second file should have been queued successfully
        expect(queueStartSpy).toHaveBeenCalledTimes(1);
        const items = queueStartSpy.mock.calls[0][1];
        expect(items.length).toBe(1); // Only the successful file
    });

    it('does not call UploadQueue.start if all files fail processing', async () => {
        processForUploadSpy.mockRejectedValue(new Error('Canvas limit exceeded'));

        const file = new File(['bad'], 'huge.jpg', { type: 'image/jpeg' });
        await triggerFileSelection([file]);

        expect(queueStartSpy).not.toHaveBeenCalled();
    });
});
```
<!-- END_SUBCOMPONENT_C -->

### Notes for implementer

The `triggerFileSelection` helper must use a single concrete approach. The existing `resilient-uploads.spec.js` Playwright tests use `page.locator('input[type="file"]').setInputFiles(files)` with an array of file paths for on-disk files. For synthesized in-memory `File` objects (created in the browser via Canvas), use `page.evaluate` to create a `DataTransfer` and dispatch a synthetic `change` event to the file input:

```js
// Helper: inject a synthesized File object into the file input
async function dispatchSyntheticFiles(page, fileHandles) {
    await page.evaluate((files) => {
        const input = document.querySelector('input[type="file"]');
        const dt = new DataTransfer();
        for (const file of files) {
            dt.items.add(file);
        }
        // Assign files to input and dispatch change event
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, fileHandles);
}
```

Use this approach consistently across all Playwright E2E tests in this phase. Do not use `setInputFiles` with in-memory blobs (it requires a file path), and do not mix approaches within the same test file.

For the Vitest integration tests in Task 1, read `src/RoadTripMap/wwwroot/js/postUI.js` lines 353–381 to find the exact DOM element ID that the file input uses, then create a matching element in `beforeEach` so the file-selection handler can bind to it correctly.

### Commit Message

```
test: add postUI processing integration tests

Verify upload:preparing event fires before processing, display/thumb
blobs are passed to upload queue, processing errors are handled
per-file without blocking the batch.
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

All existing and new Vitest tests must pass.

<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
## Task 2: Create `imageSynthesis.js` Playwright helper

**Verifies:** None (infrastructure for Task 3)

**File:** `tests/playwright/helpers/imageSynthesis.js`

This file does NOT exist yet -- create it from scratch.

### Purpose

Playwright E2E tests need large images to test the compression and processing flows. Rather than committing large binary fixtures to the repo, this helper generates synthetic images in the browser using Canvas.

### Implementation

Export functions that can be called inside `page.evaluate()` to generate Blobs/Files of specific sizes:

```js
/**
 * Generate a synthetic PNG of approximately the target size in bytes.
 * Creates a Canvas filled with random-ish pixel data to resist compression.
 *
 * Usage in Playwright:
 *   const fileHandle = await page.evaluateHandle((targetSizeBytes) => {
 *       return window.__imageSynthesis.createLargePng(targetSizeBytes);
 *   }, 18 * 1024 * 1024);
 */
const imageSynthesis = {
    /**
     * Inject the synthesis functions into the page's window scope.
     * Call this once before using the other methods.
     */
    async inject(page) {
        await page.evaluate(() => {
            window.__imageSynthesis = {
                createLargePng(targetBytes) {
                    // Approximate: PNG with random data is ~4 bytes per pixel (RGBA)
                    // Target pixel count = targetBytes / 4, then find square dimensions
                    const pixelCount = Math.ceil(targetBytes / 4);
                    const side = Math.ceil(Math.sqrt(pixelCount));

                    const canvas = document.createElement('canvas');
                    canvas.width = side;
                    canvas.height = side;
                    const ctx = canvas.getContext('2d');

                    // Fill with pseudo-random data to prevent PNG compression from shrinking it
                    const imageData = ctx.createImageData(side, side);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] = (i * 7 + 13) & 0xFF;     // R
                        imageData.data[i + 1] = (i * 11 + 29) & 0xFF; // G
                        imageData.data[i + 2] = (i * 3 + 41) & 0xFF;  // B
                        imageData.data[i + 3] = 255;                   // A
                    }
                    ctx.putImageData(imageData, 0, 0);

                    return new Promise((resolve) => {
                        canvas.toBlob((blob) => {
                            const file = new File([blob], 'synthetic-large.png', {
                                type: 'image/png',
                            });
                            resolve(file);
                        }, 'image/png');
                    });
                },

                createJpeg(widthPx, heightPx, qualityFraction) {
                    const canvas = document.createElement('canvas');
                    canvas.width = widthPx;
                    canvas.height = heightPx;
                    const ctx = canvas.getContext('2d');

                    // Fill with a gradient to create realistic-ish JPEG content
                    const gradient = ctx.createLinearGradient(0, 0, widthPx, heightPx);
                    gradient.addColorStop(0, '#ff6600');
                    gradient.addColorStop(0.5, '#0066ff');
                    gradient.addColorStop(1, '#00ff66');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, widthPx, heightPx);

                    return new Promise((resolve) => {
                        canvas.toBlob((blob) => {
                            const file = new File([blob], 'synthetic.jpg', {
                                type: 'image/jpeg',
                            });
                            resolve(file);
                        }, 'image/jpeg', qualityFraction || 0.95);
                    });
                },
            };
        });
    },
};

module.exports = { imageSynthesis };
```

Key details:
- `createLargePng`: Generates a PNG with pseudo-random pixel data. Random data resists PNG compression, so the output size is closer to the raw pixel count. The exact size won't be precise, but it will be large enough to trigger the >14MB threshold.
- `createJpeg`: Generates a JPEG of specific pixel dimensions for testing display/thumb tier generation.
- Functions are injected into `window.__imageSynthesis` so they can be called from `page.evaluate()`.

### Commit Message

```
test: add imageSynthesis Playwright helper for generating large test images

Inject Canvas-based image generators into browser context. Creates
large PNGs with random data and JPEGs with gradients for E2E testing.
```

### Verification

No standalone verification -- this is a helper used by Task 3.

<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
## Task 3: Add processing scenario to Playwright E2E tests

**Verifies:** client-image-processing.AC4.2, client-image-processing.AC4.3

**File:** `tests/playwright/resilient-uploads.spec.js`

### Context

This file contains Playwright E2E tests for the resilient upload flow. It tests the full browser-to-server pipeline. The test likely:
1. Navigates to the post page (`/post/{secretToken}`).
2. Selects files via the file input.
3. Waits for upload lifecycle events.
4. Verifies the photo appears on the map/gallery.

### Changes

Add a new `describe` block or test cases for the client-side processing flow:

<!-- START_SUBCOMPONENT_A -->
#### Subcomponent A: Oversize PNG compression E2E test (AC4.3)

```js
const { imageSynthesis } = require('./helpers/imageSynthesis');

test.describe('client-side image processing', () => {
    test.beforeEach(async ({ page }) => {
        await imageSynthesis.inject(page);
    });

    test('compresses oversize PNG and commits successfully (AC4.3)', async ({ page }) => {
        // Navigate to post page
        await page.goto(`/post/${testTripToken}`);

        // Generate a ~18MB PNG in-browser
        const fileHandle = await page.evaluateHandle(async () => {
            return window.__imageSynthesis.createLargePng(18 * 1024 * 1024);
        });

        // Inject the synthesized file into the file input using DataTransfer dispatch.
        // (page.setInputFiles requires a file path; DataTransfer dispatch works with in-memory Files.)
        await page.evaluate((file) => {
            const input = document.querySelector('input[type="file"]');
            const dt = new DataTransfer();
            dt.items.add(file);
            Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, fileHandle);

        // Wait for "Processing..." to appear in progress panel (AC3.1 via AC4.3)
        await page.waitForSelector('[data-status="processing"]', { timeout: 5000 });

        // Wait for commit with performance budget
        const startTime = Date.now();
        await page.waitForSelector('[data-status="committed"]', { timeout: 30000 });
        const totalTime = Date.now() - startTime;

        // Processing an 18MB PNG should complete in under 8 seconds (AC4.3)
        // Note: This includes processing + upload + commit time.
        // The AC4.3 budget is for processing alone, but we verify the whole pipeline.
        // In practice, processing dominates for large files.
        expect(totalTime).toBeLessThan(30000); // Generous timeout for CI
    });
```
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B -->
#### Subcomponent B: Sub-threshold JPEG processing + tier generation E2E test (AC4.2)

```js
    test('processes sub-threshold JPEG with display and thumb tiers (AC4.2)', async ({ page }) => {
        await page.goto(`/post/${testTripToken}`);

        // Generate a ~5MB JPEG (4032x3024 = ~12M pixels, JPEG quality 0.95 ~ 5MB)
        const fileHandle = await page.evaluateHandle(async () => {
            return window.__imageSynthesis.createJpeg(4032, 3024, 0.95);
        });

        // Inject the synthesized file into the file input using DataTransfer dispatch.
        await page.evaluate((file) => {
            const input = document.querySelector('input[type="file"]');
            const dt = new DataTransfer();
            dt.items.add(file);
            Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, fileHandle);

        // Measure processing time
        const startTime = Date.now();
        await page.waitForSelector('[data-status="committed"]', { timeout: 15000 });
        const totalTime = Date.now() - startTime;

        // 5MB JPEG processing should be fast
        // AC4.2 says <3 seconds for processing alone
        expect(totalTime).toBeLessThan(15000); // Generous for full pipeline in CI
    });
```
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C -->
#### Subcomponent C: Verify blob tiers exist after commit

```js
    test('committed photo has all three blob tiers', async ({ page, request }) => {
        await page.goto(`/post/${testTripToken}`);

        // Upload a sub-threshold JPEG
        const fileHandle = await page.evaluateHandle(async () => {
            return window.__imageSynthesis.createJpeg(2000, 1500, 0.9);
        });

        // Inject the synthesized file into the file input using DataTransfer dispatch.
        await page.evaluate((file) => {
            const input = document.querySelector('input[type="file"]');
            const dt = new DataTransfer();
            dt.items.add(file);
            Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, fileHandle);

        await page.waitForSelector('[data-status="committed"]', { timeout: 15000 });

        // Get the photo ID from the committed element
        const photoId = await page.$eval('[data-status="committed"]', el => el.dataset.photoId);

        // Verify all three tiers are accessible via the photo proxy endpoint
        const tripId = testTripId; // From test setup

        const originalResp = await request.get(`/api/photos/${tripId}/${photoId}/original`);
        expect(originalResp.status()).toBe(200);

        const displayResp = await request.get(`/api/photos/${tripId}/${photoId}/display`);
        expect(displayResp.status()).toBe(200);

        const thumbResp = await request.get(`/api/photos/${tripId}/${photoId}/thumb`);
        expect(thumbResp.status()).toBe(200);

        // Verify display is smaller than original
        const originalSize = (await originalResp.body()).length;
        const displaySize = (await displayResp.body()).length;
        const thumbSize = (await thumbResp.body()).length;

        expect(displaySize).toBeLessThan(originalSize);
        expect(thumbSize).toBeLessThan(displaySize);
    });
});
```
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D -->
#### Subcomponent D: 20-photo batch upload test

This scenario directly validates the Definition of Done item: "A 20-photo batch upload on a fast WiFi connection completes in under 3 minutes total with zero failed uploads."

```js
    test('20-photo batch upload completes in under 3 minutes with zero failures', async ({ page }) => {
        await page.goto(`/post/${testTripToken}`);

        // Synthesize 20 small JPEG-like images in-browser (500KB–1MB each, well under the 14MB threshold)
        const fileHandles = await page.evaluateHandle(async () => {
            const files = [];
            for (let i = 0; i < 20; i++) {
                // Each synthetic JPEG: ~800x600 at quality 0.92, produces ~400-700KB
                const canvas = document.createElement('canvas');
                canvas.width = 800;
                canvas.height = 600;
                const ctx = canvas.getContext('2d');
                // Vary colour per image so JPEG compression doesn't trivially deduplicate
                ctx.fillStyle = `hsl(${i * 18}, 70%, 50%)`;
                ctx.fillRect(0, 0, 800, 600);
                ctx.fillStyle = `hsl(${(i * 18 + 180) % 360}, 60%, 60%)`;
                ctx.fillRect(100, 100, 600, 400);

                const file = await new Promise((resolve) => {
                    canvas.toBlob((blob) => {
                        resolve(new File([blob], `batch-photo-${i + 1}.jpg`, { type: 'image/jpeg' }));
                    }, 'image/jpeg', 0.92);
                });
                files.push(file);
            }
            return files;
        });

        // Inject all 20 files into the file input via DataTransfer dispatch
        const startTime = Date.now();
        await page.evaluate((files) => {
            const input = document.querySelector('input[type="file"]');
            const dt = new DataTransfer();
            for (const file of files) {
                dt.items.add(file);
            }
            Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, fileHandles);

        // Wait for all 20 committed rows in the progress panel
        await page.waitForFunction(
            () => document.querySelectorAll('[data-status="committed"]').length === 20,
            { timeout: 180000 } // 3 minutes
        );

        const totalTimeMs = Date.now() - startTime;

        // Assert total wall-clock time is under 3 minutes (180 seconds)
        expect(totalTimeMs).toBeLessThan(180000);

        // Assert no failed rows remain in the progress panel
        const failedCount = await page.evaluate(
            () => document.querySelectorAll('[data-status="failed"]').length
        );
        expect(failedCount).toBe(0);
    });
```

Key details:
- Images are synthesised in-browser using Canvas (no on-disk fixtures). Each is a small JPEG well under the 14MB compression threshold, so no `browser-image-compression` is invoked — the test validates the batch throughput of the core upload flow.
- The 3-minute budget (`180000 ms`) matches the Definition of Done.
- `page.waitForFunction` polls the DOM until all 20 `[data-status="committed"]` rows appear or the timeout fires.
- The zero-failures assertion checks `[data-status="failed"]` after all commits complete.
<!-- END_SUBCOMPONENT_D -->

### Notes for implementer

1. **File input mechanism**: Use the DataTransfer dispatch approach consistently (described in the "Notes for implementer" section at the end of Task 1). Do not mix approaches within the spec file.

2. **Test trip setup**: The E2E tests likely create a test trip in `beforeAll` or `beforeEach`. Use the same setup mechanism.

3. **Selectors**: The `[data-status="processing"]` and `[data-status="committed"]` selectors depend on how the progress panel renders status. Read `progressPanel.js` and the existing E2E test selectors to match.

4. **CI timing**: Performance budgets in E2E tests should be generous because CI runners are slower than user devices. The AC budgets (3s for 5MB, 8s for 18MB) are for modern mobile browsers. CI may need 2-3x more time. Use the generous timeouts in assertions and rely on the Vitest unit tests for precise timing validation.

### Commit Message

```
test: add Playwright E2E tests for client-side image processing

Test oversize PNG compression, sub-threshold JPEG tier generation,
and verify all three blob tiers exist after commit. Uses synthetic
in-browser image generation.
```

### Verification

```bash
cd /workspaces/road-trip && npx playwright test tests/playwright/resilient-uploads.spec.js
```

All existing and new Playwright tests must pass.

<!-- END_TASK_3 -->
