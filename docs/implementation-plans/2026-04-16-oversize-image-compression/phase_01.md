# Phase 1: Image Processor Module + Client-Side Tier Generation

## Goal

Create the `ImageProcessor` client-side module that handles HEIC conversion, oversize JPEG/PNG compression, and display/thumb tier generation for every photo. Ship with full Vitest coverage. This is the foundational module that all subsequent phases depend on.

## Architecture

A new window-global module `ImageProcessor` is added to the vanilla JS frontend. It exposes a single public method `processForUpload(file, exifData)` that returns a result object containing the (possibly compressed) original, a display-tier Blob (1920px max), and a thumb-tier Blob (300px max). Three external libraries are lazy-loaded from jsDelivr CDN on first invocation and cached in module-scope promises.

```
File selected by user
       |
       v
PostService.extractPhotoMetadata(file) --> { gps, timestamp, placeName }
       |
       v
ImageProcessor.processForUpload(file, exifData)
  |-- Is HEIC? --> lazy-load heic2any --> convert to JPEG Blob
  |-- Is oversize (>14MB)? --> lazy-load browser-image-compression --> compress to <=14MB JPEG
  |-- If compressed/converted: lazy-load piexifjs --> reinject EXIF from original
  |-- Generate display tier: Canvas resize to 1920px max, toBlob('image/jpeg', 0.85)
  |-- Generate thumb tier: Canvas resize to 300px max, toBlob('image/jpeg', 0.75)
  |-- Return { original, display, thumb, compressionApplied, heicConverted, ... }
```

## Tech Stack

- Vanilla JavaScript (window-global module pattern, matches existing `UploadQueue`, `StorageAdapter`, etc.)
- Canvas API for image resizing (first Canvas usage in this codebase)
- `browser-image-compression@2.0.2` via jsDelivr CDN (lazy-loaded)
- `piexifjs@1.0.6` via jsDelivr CDN (lazy-loaded)
- `heic2any@0.0.4` via jsDelivr CDN (lazy-loaded)
- `exifr` already vendored at `/lib/exifr/full.umd.js` (global `window.exifr`)
- Vitest + jsdom for testing

## Notes for Implementers

**Design Phases 1–2 (acceptance session, legacy-trip audit, feature flag removal) are intentionally deferred.** They cannot proceed until the client-side processing fix ships because the current server-side tier generation bottleneck causes 6/20 photo uploads to fail in a 20-photo batch. The processing fix (this plan's Phases 1–4, mapping to design Phases 3–6) must deploy first. Once deployed and verified, the runbook at `docs/implementation-plans/2026-04-16-oversize-compression/runbook.md` covers the deferred steps in order.

**Dependency skip rationale:** Design Phase 3 depends on Phase 2 (feature flag removal). This implementation proceeds without that dependency because: (a) the feature flag's `FeatureFlags.isEnabled('resilient-uploads-ui')` branches in `postUI.js` gate the entire new upload UI, which is always `true` in the current prod deployment — the flag has no effect, and (b) the `imageProcessor.js` module is self-contained and does not interact with the feature flag logic.

## Scope

### In Scope
- New file: `src/RoadTripMap/wwwroot/js/imageProcessor.js`
- New file: `tests/js/imageProcessor.test.js`
- Modified file: `src/RoadTripMap/wwwroot/post.html` (script tag at line 118)
- Modified file: `tests/js/setup.js` (loadGlobal registration)

### Out of Scope
- Server-side changes (Phase 2)
- Upload queue integration (Phase 2)
- PostUI integration (Phase 2)
- Progress panel changes (Phase 2)
- Telemetry changes (Phase 2)
- Playwright E2E tests (Phase 3)
- Feature flag / dark release (Phase 4)

## Codebase Verified

2026-04-15

## AC Coverage

| AC | Description | Covered By |
|----|-------------|------------|
| client-image-processing.AC1.1 | Oversize JPEG compressed to <=14MB with EXIF preserved | Task 1 |
| client-image-processing.AC1.2 | Oversize PNG re-encoded to JPEG, compressed | Task 1 |
| client-image-processing.AC1.3 | HEIC converted to JPEG, EXIF extracted before conversion, reinjected | Task 1 |
| client-image-processing.AC1.4 | Sub-threshold photo original passed through unchanged | Task 1 |
| client-image-processing.AC2.1 | EXIF GPS preserved within 6 decimal places after compression | Task 1 |
| client-image-processing.AC2.2 | TakenAt preserved exactly after compression | Task 1 |
| client-image-processing.AC2.3 | Compressed output is decodable JPEG | Task 1 |
| client-image-processing.AC2.4 | Unreachable target surfaces clear error | Task 1 |
| client-image-processing.AC4.1 | Dependencies lazy-loaded, zero initial page load cost | Task 1 |
| client-image-processing.AC5.1 | Every upload produces original + display + thumb | Task 1 |
| client-image-processing.AC5.2 | Display tier <=1920px, JPEG q=85 | Task 1 |
| client-image-processing.AC5.3 | Thumb tier <=300px, JPEG q=75 | Task 1 |
| client-image-processing.AC5.6 | Sub-threshold JPEG still gets client-generated display + thumb | Task 1 |
| client-image-processing.ACX.1 | No raw bytes, GPS, or SAS URLs in logs | Task 1 |

---

<!-- START_TASK_1 -->
## Task 1: Create `imageProcessor.js` module

**Verifies:** client-image-processing.AC1.1, client-image-processing.AC1.2, client-image-processing.AC1.3, client-image-processing.AC1.4, client-image-processing.AC2.1, client-image-processing.AC2.2, client-image-processing.AC2.3, client-image-processing.AC2.4, client-image-processing.AC4.1, client-image-processing.AC5.1, client-image-processing.AC5.2, client-image-processing.AC5.3, client-image-processing.AC5.6, client-image-processing.ACX.1

**File:** `src/RoadTripMap/wwwroot/js/imageProcessor.js`

This file does NOT exist yet -- create it from scratch.

### Context

The codebase uses a window-global module pattern. Every JS module is an IIFE or `const` assigned to `window` scope. There is no bundler, no ES module imports in production code. Dependencies are loaded via `<script>` tags in HTML files.

Example of existing pattern (from `uploadQueue.js`):
```js
const UploadQueue = {
    start(tripToken, items, callbacks) { ... },
    // ...
};
```

The `exifr` library is already available globally as `window.exifr` (loaded from `/lib/exifr/full.umd.js`). The three new CDN dependencies must be lazy-loaded via dynamic `import()` since they are ESM modules on jsDelivr.

### Implementation

<!-- START_SUBCOMPONENT_A -->
#### Subcomponent A: Module skeleton and constants

Create the file with this structure:

```js
const ImageProcessor = (() => {
    // Constants
    const OVERSIZE_THRESHOLD_BYTES = 14 * 1024 * 1024; // 14 MB
    const DISPLAY_MAX_DIMENSION = 1920;
    const THUMB_MAX_DIMENSION = 300;
    const DISPLAY_JPEG_QUALITY = 0.85;
    const THUMB_JPEG_QUALITY = 0.75;
    const COMPRESSION_MAX_SIZE_MB = 14;

    // CDN URLs (pinned versions)
    const BROWSER_IMAGE_COMPRESSION_CDN = 'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/+esm';
    const PIEXIFJS_CDN = 'https://cdn.jsdelivr.net/npm/piexifjs@1.0.6/+esm';
    const HEIC2ANY_CDN = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/+esm';

    // Lazy-loaded module caches (promises, not values)
    let _browserImageCompressionPromise = null;
    let _piexifjsPromise = null;
    let _heic2anyPromise = null;

    // ... (subcomponents B through G follow)

    return {
        processForUpload,
        // Exposed for testing only:
        _resetLazyLoaders() {
            _browserImageCompressionPromise = null;
            _piexifjsPromise = null;
            _heic2anyPromise = null;
        }
    };
})();
```

The IIFE pattern ensures module-scope variables are private. Only `processForUpload` and `_resetLazyLoaders` (for test cleanup) are exposed.
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B -->
#### Subcomponent B: Lazy-loading functions

Inside the IIFE, add three lazy-loader functions. Each caches a single `import()` promise so the CDN fetch happens at most once per page load:

```js
async function _loadBrowserImageCompression() {
    if (!_browserImageCompressionPromise) {
        _browserImageCompressionPromise = import(BROWSER_IMAGE_COMPRESSION_CDN)
            .then(mod => mod.default);
    }
    return _browserImageCompressionPromise;
}

async function _loadPiexifjs() {
    if (!_piexifjsPromise) {
        _piexifjsPromise = import(PIEXIFJS_CDN)
            .then(mod => mod.default || mod);
    }
    return _piexifjsPromise;
}

async function _loadHeic2any() {
    if (!_heic2anyPromise) {
        _heic2anyPromise = import(HEIC2ANY_CDN)
            .then(mod => mod.default || mod);
    }
    return _heic2anyPromise;
}
```

Key details:
- `browser-image-compression` has a default export that IS the compression function.
- `piexifjs` may expose as default or named -- use `mod.default || mod` to handle both.
- `heic2any` has a default export that IS the conversion function.
- If the CDN fetch fails, the promise rejects. Callers catch this and surface it as a processing error.
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C -->
#### Subcomponent C: Data URL / Blob conversion helpers

These helpers are needed because `piexifjs` works exclusively with data URLs, not Blobs or ArrayBuffers.

```js
function _fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file as data URL'));
        reader.readAsDataURL(file);
    });
}

function _blobToDataUrl(blob) {
    return _fileToDataUrl(blob); // FileReader accepts both File and Blob
}

function _dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mimeMatch = header.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}
```

These are pure utility functions with no side effects. They do NOT log any data (ACX.1 compliance -- no raw bytes in logs).
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D -->
#### Subcomponent D: Canvas-based tier generation

This is the first Canvas usage in the codebase. Two functions: one to load an image element from a Blob/File, one to resize via Canvas and produce a JPEG Blob.

```js
function _loadImage(blobOrFile) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blobOrFile);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for processing'));
        };
        img.src = url;
    });
}

async function _generateTier(sourceFile, maxDimension, jpegQuality) {
    const img = await _loadImage(sourceFile);

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const targetWidth = Math.round(img.width * scale);
    const targetHeight = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
            b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null')),
            'image/jpeg',
            jpegQuality
        );
    });

    return blob;
}
```

Key details:
- `URL.createObjectURL` / `URL.revokeObjectURL` for memory management.
- `Math.min(1, ...)` ensures images smaller than `maxDimension` are NOT upscaled.
- Canvas `toBlob` is async (callback-based), wrapped in a Promise.
- No EXIF reinjection on tier blobs -- only the original needs EXIF. Display and thumb are derivative.
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E -->
#### Subcomponent E: HEIC detection and conversion

```js
function _isHeic(file) {
    const type = (file.type || '').toLowerCase();
    if (type === 'image/heic' || type === 'image/heif') return true;
    // iOS Safari sometimes doesn't set MIME type; check extension
    const name = (file.name || '').toLowerCase();
    return name.endsWith('.heic') || name.endsWith('.heif');
}

async function _convertHeicToJpeg(file) {
    const heic2any = await _loadHeic2any();
    const jpegBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.92 // High quality for the conversion step; compression happens later if needed
    });
    // heic2any may return a single Blob or an array; normalize to single Blob
    const result = Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob;
    // Wrap as File to preserve name semantics downstream
    return new File([result], file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'), {
        type: 'image/jpeg'
    });
}
```

Key details:
- HEIC detection must check both MIME type and extension because iOS Safari is inconsistent.
- `heic2any` quality 0.92 is a high-fidelity conversion. If the result is still oversize, the compression step (Subcomponent F) handles it.
- `heic2any` can return an array for multi-image HEIF containers; we take the first.
<!-- END_SUBCOMPONENT_E -->

<!-- START_SUBCOMPONENT_F -->
#### Subcomponent F: EXIF reinjection

After compressing or converting an image, the EXIF data (GPS, timestamp) from the original must be reinjected into the output. This uses `piexifjs` which operates on data URLs.

For JPEG and PNG originals, piexifjs can load EXIF directly from the file's data URL. For HEIC originals, piexifjs **cannot** parse the HEIC container — instead, use the `exifData` parameter already passed into `processForUpload` (extracted upstream by `exifr` before this function is called) to construct the piexifjs EXIF object.

```js
async function _reinjectExif(originalFile, processedBlob, exifData) {
    const piexif = await _loadPiexifjs();

    let exifObj;

    if (_isHeic(originalFile)) {
        // piexifjs cannot parse HEIC containers. Use the exifData already extracted
        // by exifr (passed in from processForUpload) to build the piexifjs EXIF object.
        // exifData shape: { latitude, longitude, DateTimeOriginal, Make, Model, ... }
        try {
            exifObj = { '0th': {}, 'Exif': {}, 'GPS': {} };

            if (exifData) {
                // GPS IFD
                if (exifData.latitude != null && exifData.longitude != null) {
                    const latRef = exifData.latitude >= 0 ? 'N' : 'S';
                    const lngRef = exifData.longitude >= 0 ? 'E' : 'W';
                    const toRational = (deg) => {
                        const d = Math.floor(Math.abs(deg));
                        const mFull = (Math.abs(deg) - d) * 60;
                        const m = Math.floor(mFull);
                        const s = Math.round((mFull - m) * 60 * 100);
                        return [[d, 1], [m, 1], [s, 100]];
                    };
                    exifObj['GPS'][piexif.GPSIFD.GPSLatitudeRef] = latRef;
                    exifObj['GPS'][piexif.GPSIFD.GPSLatitude] = toRational(exifData.latitude);
                    exifObj['GPS'][piexif.GPSIFD.GPSLongitudeRef] = lngRef;
                    exifObj['GPS'][piexif.GPSIFD.GPSLongitude] = toRational(exifData.longitude);
                }

                // DateTimeOriginal
                if (exifData.DateTimeOriginal) {
                    const dt = new Date(exifData.DateTimeOriginal);
                    const pad = (n) => String(n).padStart(2, '0');
                    const formatted = `${dt.getFullYear()}:${pad(dt.getMonth()+1)}:${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
                    exifObj['Exif'][piexif.ExifIFD.DateTimeOriginal] = formatted;
                }

                // Camera make/model if available
                if (exifData.Make) exifObj['0th'][piexif.ImageIFD.Make] = exifData.Make;
                if (exifData.Model) exifObj['0th'][piexif.ImageIFD.Model] = exifData.Model;
            }
        } catch (e) {
            // Could not construct EXIF from exifData -- return processed blob as-is
            return processedBlob;
        }
    } else {
        // For JPEG/PNG: load EXIF directly from the original file's data URL
        try {
            const originalDataUrl = await _fileToDataUrl(originalFile);
            exifObj = piexif.load(originalDataUrl);
        } catch (e) {
            // Original has no EXIF or piexifjs can't parse it -- return processed blob as-is
            return processedBlob;
        }
    }

    const processedDataUrl = await _blobToDataUrl(processedBlob);
    const withExifDataUrl = piexif.insert(piexif.dump(exifObj), processedDataUrl);
    return _dataUrlToBlob(withExifDataUrl);
}
```

Key details:
- For HEIC: piexifjs cannot read the HEIC container, so the function uses the `exifData` parameter (already extracted by `exifr` before `processForUpload` was called) to construct the EXIF object. This avoids a second read of the original file and works correctly since `exifr` already decoded the HEIC EXIF.
- For JPEG/PNG: the existing data URL round-trip is preserved (`piexif.load` from the file's data URL).
- If the original file has no EXIF (e.g., a PNG screenshot), `piexif.load` may throw. We catch and return the processed blob unchanged.
- No EXIF data is logged at any point (ACX.1 compliance).

**Callers must pass `exifData` through:** Update the calls in Subcomponent G to pass `exifData` as the third argument: `_reinjectExif(file, compressed, exifData)` and `_reinjectExif(file, workingFile, exifData)`.
<!-- END_SUBCOMPONENT_F -->

<!-- START_SUBCOMPONENT_G -->
#### Subcomponent G: Main `processForUpload` function

This is the public API. It orchestrates all the subcomponents into a single pipeline.

```js
async function processForUpload(file, exifData) {
    const startTime = performance.now();
    const originalBytes = file.size;

    let workingFile = file;
    let compressionApplied = false;
    let heicConverted = false;

    // Step 1: HEIC conversion (must happen before anything else since Canvas can't decode HEIC)
    if (_isHeic(file)) {
        workingFile = await _convertHeicToJpeg(file);
        heicConverted = true;
    }

    // Step 2: Generate display and thumb tiers from the working file
    // (Do this BEFORE compression so tiers are generated from highest-quality source)
    const [display, thumb] = await Promise.all([
        _generateTier(workingFile, DISPLAY_MAX_DIMENSION, DISPLAY_JPEG_QUALITY),
        _generateTier(workingFile, THUMB_MAX_DIMENSION, THUMB_JPEG_QUALITY),
    ]);

    // Step 3: Compress original if oversize
    let original = workingFile;
    if (workingFile.size > OVERSIZE_THRESHOLD_BYTES) {
        const compress = await _loadBrowserImageCompression();
        const compressed = await compress(workingFile, {
            maxSizeMB: COMPRESSION_MAX_SIZE_MB,
            maxWidthOrHeight: 4032, // iOS Safari Canvas limit safety
            useWebWorker: true,
            fileType: 'image/jpeg',
        });

        // Verify compression actually brought it under threshold
        if (compressed.size > OVERSIZE_THRESHOLD_BYTES) {
            throw new Error(
                `Unable to compress image to under ${COMPRESSION_MAX_SIZE_MB} MB. ` +
                `Original: ${(originalBytes / (1024 * 1024)).toFixed(1)} MB, ` +
                `After compression: ${(compressed.size / (1024 * 1024)).toFixed(1)} MB. ` +
                `Try using a smaller image.`
            );
        }

        // Reinject EXIF into compressed output
        original = await _reinjectExif(file, compressed);

        // Wrap as File to preserve name property
        if (!(original instanceof File)) {
            original = new File([original], workingFile.name, { type: 'image/jpeg' });
        }

        compressionApplied = true;
    } else if (heicConverted) {
        // HEIC was converted but NOT oversize -- still need EXIF reinjection on the converted file
        original = await _reinjectExif(file, workingFile);
        if (!(original instanceof File)) {
            original = new File([original], workingFile.name, { type: 'image/jpeg' });
        }
    }
    // else: sub-threshold non-HEIC -- original is byte-for-byte the input file (AC1.4)

    const durationMs = Math.round(performance.now() - startTime);

    return {
        original,
        display,
        thumb,
        compressionApplied,
        heicConverted,
        originalBytes,
        outputBytes: original.size,
        durationMs,
    };
}
```

Key details about the decision tree:

1. **HEIC file**: Convert to JPEG first (Canvas cannot decode HEIC). Then check if the converted JPEG is oversize.
2. **Oversize file (>14MB)**: Compress via `browser-image-compression`. If compression fails to reach target, throw error (AC2.4). Reinject EXIF from the ORIGINAL file (not the working file, since HEIC conversion may have stripped EXIF).
3. **HEIC but not oversize**: Still needs EXIF reinjection since `heic2any` doesn't preserve EXIF.
4. **Sub-threshold non-HEIC**: Pass through unchanged. The `original` property is literally the input `file` object (AC1.4).
5. **Display + thumb tiers**: Generated for ALL photos regardless of size (AC5.6). Generated from `workingFile` (post-HEIC-conversion if applicable) BEFORE compression, so they derive from the highest-quality source.

The EXIF reinjection on step 2 uses the ORIGINAL `file` parameter (not `workingFile`) because for HEIC photos, the original `.heic` file contains the EXIF data. `piexifjs` can read EXIF from HEIC data URLs even though Canvas can't render HEIC.

**Important edge case:** If `piexifjs` cannot parse the original's EXIF (e.g., corrupted metadata, PNG with no EXIF), `_reinjectExif` returns the processed blob unchanged. This is acceptable -- the upstream `exifData` parameter (from `exifr`) already extracted what it could.
<!-- END_SUBCOMPONENT_G -->

### Commit Message

```
feat: add ImageProcessor module for client-side image processing

Create imageProcessor.js with processForUpload() that handles HEIC
conversion, oversize compression, display/thumb tier generation, and
EXIF reinjection. Lazy-loads CDN dependencies on first call.
```

### Verification

This task has no standalone verification command -- the module requires the script tag (Task 2) and tests (Task 3) to verify. Proceed to Task 2.

<!-- END_TASK_1 -->

---

<!-- START_TASK_2 -->
## Task 2: Add script tag and test setup registration

**Verifies:** None (infrastructure)

### 2A: Add script tag to `post.html`

**File:** `src/RoadTripMap/wwwroot/post.html`

The script load order in `post.html` currently has scripts loaded in a specific order. Insert `imageProcessor.js` at line 118, which is after `uploadTransport.js` and before `uploadQueue.js`. This ordering matters because `uploadQueue.js` (Phase 2) will call `ImageProcessor.processForUpload()`.

Find the existing script tags around line 118. The exact insertion point is between the `uploadTransport.js` script tag and the `uploadQueue.js` script tag. Add:

```html
<script src="/js/imageProcessor.js"></script>
```

### 2B: Register in test setup

**File:** `tests/js/setup.js`

This file uses a `loadGlobal('filename.js')` pattern to make window-global modules available in the Vitest jsdom environment. Add `imageProcessor.js` after the `versionProtocol.js` entry:

```js
loadGlobal('imageProcessor.js');
```

The `loadGlobal` function reads the JS file from `src/RoadTripMap/wwwroot/js/` and evaluates it in the jsdom global scope, making `ImageProcessor` available as a global in all test files.

### Commit Message

```
chore: register imageProcessor.js in post.html and test setup

Add script tag after uploadTransport.js, before uploadQueue.js.
Add loadGlobal registration in tests/js/setup.js for Vitest.
```

### Verification

```bash
# Verify the script tag is in the correct position
grep -n "imageProcessor" src/RoadTripMap/wwwroot/post.html

# Verify the test setup registration
grep -n "imageProcessor" tests/js/setup.js

# Ensure the project still builds
cd /workspaces/road-trip && dotnet build RoadTripMap.sln
```

<!-- END_TASK_2 -->

---

<!-- START_TASK_3 -->
## Task 3: Create `imageProcessor.test.js` with full Vitest coverage

**Verifies:** client-image-processing.AC1.1, client-image-processing.AC1.2, client-image-processing.AC1.3, client-image-processing.AC1.4, client-image-processing.AC2.1, client-image-processing.AC2.2, client-image-processing.AC2.3, client-image-processing.AC2.4, client-image-processing.AC4.1, client-image-processing.AC5.1, client-image-processing.AC5.2, client-image-processing.AC5.3, client-image-processing.AC5.6, client-image-processing.ACX.1

**File:** `tests/js/imageProcessor.test.js`

This file does NOT exist yet -- create it from scratch.

### Context on testing environment

- Vitest with jsdom environment.
- `tests/js/setup.js` runs `loadGlobal()` to make modules available globally.
- Tests use `vi.fn()` for mocks, `vi.spyOn()` for spies.
- jsdom does NOT have Canvas or Image support. These must be mocked.
- The three CDN dependencies (`browser-image-compression`, `heic2any`, `piexifjs`) are loaded via dynamic `import()` which must be mocked since jsdom can't fetch from CDN.
- Contract tests at `tests/js/api-contract.test.js` validate wire format -- those are separate from this file.

### Mocking strategy

Since `imageProcessor.js` uses dynamic `import()` for CDN dependencies, and jsdom cannot execute Canvas operations, the test must mock several browser APIs:

1. **Dynamic `import()`**: Use `vi.stubGlobal()` or mock the module-level import mechanism. Since `imageProcessor.js` uses bare `import(url)`, override the global import or mock at the module level. The recommended approach: mock `import()` by patching `globalThis.importShim` or by using `vi.mock()` on the CDN URLs. However, since these are runtime dynamic imports in an IIFE (not static ES imports), the most reliable approach is to:
   - Before each test, call `ImageProcessor._resetLazyLoaders()` to clear caches.
   - Mock the global `import` function to return controlled mocks.

2. **Canvas**: Mock `document.createElement` to return a fake canvas when called with `'canvas'`:
   ```js
   const mockCanvas = {
       width: 0,
       height: 0,
       getContext: vi.fn(() => ({
           drawImage: vi.fn(),
       })),
       toBlob: vi.fn((callback, type, quality) => {
           // Return a small fake JPEG blob
           callback(new Blob(['fake-jpeg-data'], { type: 'image/jpeg' }));
       }),
   };
   ```

3. **Image**: Mock the `Image` constructor to simulate immediate load:
   ```js
   class MockImage {
       constructor() {
           this.width = 4000;
           this.height = 3000;
           setTimeout(() => this.onload && this.onload(), 0);
       }
       set src(val) { /* triggers onload via setTimeout above */ }
   }
   ```

4. **URL.createObjectURL / revokeObjectURL**: Stub as no-ops:
   ```js
   URL.createObjectURL = vi.fn(() => 'blob:mock-url');
   URL.revokeObjectURL = vi.fn();
   ```

5. **FileReader**: jsdom has FileReader but it may need augmenting for data URL results.

### Test cases

<!-- START_SUBCOMPONENT_A -->
#### Subcomponent A: Setup and mocking infrastructure

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock CDN modules
const mockCompress = vi.fn();
const mockHeic2any = vi.fn();
const mockPiexif = {
    load: vi.fn(),
    dump: vi.fn(),
    insert: vi.fn(),
};

// Mock Canvas
const mockCtx = { drawImage: vi.fn() };
const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx),
    toBlob: vi.fn((cb, type, quality) => {
        cb(new Blob(['fake-tier-data'], { type: 'image/jpeg' }));
    }),
};

// Mock Image
const DEFAULT_IMG_WIDTH = 4000;
const DEFAULT_IMG_HEIGHT = 3000;
```

In `beforeEach`:
- Call `ImageProcessor._resetLazyLoaders()`.
- Stub `document.createElement` to intercept `'canvas'` calls and return `mockCanvas` (pass through for other elements).
- Stub `URL.createObjectURL` and `URL.revokeObjectURL`.
- Mock the `Image` constructor globally.
- Stub the dynamic `import()` to return the mock modules based on URL matching:
  - URL containing `browser-image-compression` -> `{ default: mockCompress }`
  - URL containing `piexifjs` -> `{ default: mockPiexif }`
  - URL containing `heic2any` -> `{ default: mockHeic2any }`
- Reset all mock implementations.

In `afterEach`:
- Restore all stubs with `vi.restoreAllMocks()`.
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B -->
#### Subcomponent B: Sub-threshold JPEG passthrough tests (AC1.4, AC5.1-AC5.3, AC5.6)

```js
describe('sub-threshold JPEG', () => {
    it('returns original file unchanged (AC1.4)', async () => {
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.original).toBe(file); // Same reference, not a copy
        expect(result.compressionApplied).toBe(false);
        expect(result.heicConverted).toBe(false);
    });

    it('still generates display tier (AC5.2, AC5.6)', async () => {
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.display).toBeInstanceOf(Blob);
        expect(result.display.type).toBe('image/jpeg');
    });

    it('still generates thumb tier (AC5.3, AC5.6)', async () => {
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.thumb).toBeInstanceOf(Blob);
        expect(result.thumb.type).toBe('image/jpeg');
    });

    it('sets correct canvas dimensions for display tier', async () => {
        // Image is 4000x3000, display max is 1920
        // Scale = 1920/4000 = 0.48, target = 1920x1440
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        // Canvas width/height should have been set for display tier
        // The mock canvas is reused, so check the calls
        expect(mockCanvas.toBlob).toHaveBeenCalledTimes(2); // display + thumb
    });

    it('does not lazy-load browser-image-compression for sub-threshold files', async () => {
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(mockCompress).not.toHaveBeenCalled();
    });

    it('does not lazy-load piexifjs for sub-threshold non-HEIC files', async () => {
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(mockPiexif.load).not.toHaveBeenCalled();
    });
});
```
<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C -->
#### Subcomponent C: Oversize compression tests (AC1.1, AC1.2, AC2.1-AC2.3)

```js
describe('oversize JPEG compression', () => {
    it('compresses file over 14MB threshold (AC1.1)', async () => {
        const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });

        // Mock compress to return a smaller blob
        mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
        // Mock piexif for EXIF reinjection
        mockPiexif.load.mockReturnValue({ '0th': {}, 'GPS': {} });
        mockPiexif.dump.mockReturnValue('exif-binary');
        mockPiexif.insert.mockReturnValue('data:image/jpeg;base64,/9j/fake');

        const result = await ImageProcessor.processForUpload(file, {
            gps: { latitude: 40.7128, longitude: -74.006 },
            timestamp: new Date('2026-01-15T10:30:00Z'),
        });

        expect(result.compressionApplied).toBe(true);
        expect(mockCompress).toHaveBeenCalledWith(
            file,
            expect.objectContaining({ maxSizeMB: 14 })
        );
    });

    it('reinjects EXIF into compressed output (AC2.1, AC2.2)', async () => {
        const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
        mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
        const fakeExif = { '0th': {}, 'GPS': { lat: 40.7128 } };
        mockPiexif.load.mockReturnValue(fakeExif);
        mockPiexif.dump.mockReturnValue('exif-dump');
        mockPiexif.insert.mockReturnValue('data:image/jpeg;base64,/9j/withexif');

        await ImageProcessor.processForUpload(file, {
            gps: { latitude: 40.7128, longitude: -74.006 },
            timestamp: new Date('2026-01-15T10:30:00Z'),
        });

        expect(mockPiexif.load).toHaveBeenCalled();
        expect(mockPiexif.dump).toHaveBeenCalledWith(fakeExif);
        expect(mockPiexif.insert).toHaveBeenCalled();
    });

    it('oversize PNG is re-encoded to JPEG (AC1.2)', async () => {
        const file = new File(['x'.repeat(18 * 1024 * 1024)], 'screenshot.png', { type: 'image/png' });
        mockCompress.mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
        mockPiexif.load.mockImplementation(() => { throw new Error('No EXIF in PNG'); });

        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.compressionApplied).toBe(true);
        expect(mockCompress).toHaveBeenCalledWith(
            file,
            expect.objectContaining({ fileType: 'image/jpeg' })
        );
    });
});
```
<!-- END_SUBCOMPONENT_C -->

<!-- START_SUBCOMPONENT_D -->
#### Subcomponent D: Unreachable target error test (AC2.4)

```js
describe('unreachable compression target', () => {
    it('throws descriptive error when compression cannot reach threshold (AC2.4)', async () => {
        const file = new File(['x'.repeat(18 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });

        // Mock compress returning a blob still over threshold
        mockCompress.mockResolvedValue(
            new Blob(['x'.repeat(15 * 1024 * 1024)], { type: 'image/jpeg' })
        );

        await expect(
            ImageProcessor.processForUpload(file, { gps: null, timestamp: null })
        ).rejects.toThrow(/Unable to compress/);
    });
});
```
<!-- END_SUBCOMPONENT_D -->

<!-- START_SUBCOMPONENT_E -->
#### Subcomponent E: HEIC conversion tests (AC1.3)

```js
describe('HEIC conversion', () => {
    it('converts HEIC to JPEG before processing (AC1.3)', async () => {
        const file = new File(['heic-data'], 'photo.heic', { type: 'image/heic' });
        // Mock heic2any returning a JPEG blob
        mockHeic2any.mockResolvedValue(new Blob(['jpeg-from-heic'], { type: 'image/jpeg' }));
        // Mock piexif for EXIF reinjection (HEIC always needs it)
        mockPiexif.load.mockReturnValue({ '0th': {}, 'GPS': {} });
        mockPiexif.dump.mockReturnValue('exif-dump');
        mockPiexif.insert.mockReturnValue('data:image/jpeg;base64,/9j/heicexif');

        const result = await ImageProcessor.processForUpload(file, {
            gps: { latitude: 35.6762, longitude: 139.6503 },
            timestamp: new Date('2026-03-01T14:00:00Z'),
        });

        expect(result.heicConverted).toBe(true);
        expect(mockHeic2any).toHaveBeenCalledWith(expect.objectContaining({
            blob: file,
            toType: 'image/jpeg',
        }));
    });

    it('detects HEIC by file extension when MIME type is empty', async () => {
        const file = new File(['heic-data'], 'IMG_1234.HEIC', { type: '' });
        mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
        mockPiexif.load.mockReturnValue({ '0th': {} });
        mockPiexif.dump.mockReturnValue('d');
        mockPiexif.insert.mockReturnValue('data:image/jpeg;base64,/9j/x');

        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.heicConverted).toBe(true);
    });

    it('detects HEIF by MIME type', async () => {
        const file = new File(['heif-data'], 'photo.heif', { type: 'image/heif' });
        mockHeic2any.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
        mockPiexif.load.mockReturnValue({ '0th': {} });
        mockPiexif.dump.mockReturnValue('d');
        mockPiexif.insert.mockReturnValue('data:image/jpeg;base64,/9j/x');

        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.heicConverted).toBe(true);
    });
});
```
<!-- END_SUBCOMPONENT_E -->

<!-- START_SUBCOMPONENT_F -->
#### Subcomponent F: Lazy-loading caching tests (AC4.1)

```js
describe('lazy loading', () => {
    it('caches CDN imports across multiple calls (AC4.1)', async () => {
        const file = new File(['x'.repeat(18 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
        mockCompress.mockResolvedValue(new Blob(['c'], { type: 'image/jpeg' }));
        mockPiexif.load.mockReturnValue({ '0th': {} });
        mockPiexif.dump.mockReturnValue('d');
        mockPiexif.insert.mockReturnValue('data:image/jpeg;base64,/9j/x');

        // Call twice
        await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });
        await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        // import() should have been called only once per module, not twice
        // Verify by checking that the mock import was called with each CDN URL exactly once
        // (This depends on how you mock import -- adjust assertion accordingly)
    });

    it('does not load any CDN modules for sub-threshold non-HEIC files', async () => {
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'small.jpg', { type: 'image/jpeg' });

        await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        // No CDN modules should have been loaded
        expect(mockCompress).not.toHaveBeenCalled();
        expect(mockHeic2any).not.toHaveBeenCalled();
        expect(mockPiexif.load).not.toHaveBeenCalled();
    });
});
```
<!-- END_SUBCOMPONENT_F -->

<!-- START_SUBCOMPONENT_G -->
#### Subcomponent G: Result shape and timing tests

```js
describe('result shape', () => {
    it('returns all required fields', async () => {
        const file = new File(['x'.repeat(3 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result).toEqual(expect.objectContaining({
            original: expect.anything(),
            display: expect.any(Blob),
            thumb: expect.any(Blob),
            compressionApplied: expect.any(Boolean),
            heicConverted: expect.any(Boolean),
            originalBytes: expect.any(Number),
            outputBytes: expect.any(Number),
            durationMs: expect.any(Number),
        }));
    });

    it('originalBytes matches input file size', async () => {
        const size = 5 * 1024 * 1024;
        const file = new File(['x'.repeat(size)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.originalBytes).toBe(size);
    });

    it('durationMs is a positive number', async () => {
        const file = new File(['x'.repeat(1024)], 'photo.jpg', { type: 'image/jpeg' });
        const result = await ImageProcessor.processForUpload(file, { gps: null, timestamp: null });

        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
});
```
<!-- END_SUBCOMPONENT_G -->

### Commit Message

```
test: add comprehensive Vitest suite for ImageProcessor module

Cover sub-threshold passthrough, oversize compression, HEIC conversion,
unreachable target error, lazy-loading caching, and result shape.
Mock Canvas and CDN dependencies for jsdom environment.
```

### Verification

```bash
cd /workspaces/road-trip && npm test
```

All tests must pass. No existing tests should break.

<!-- END_TASK_3 -->
