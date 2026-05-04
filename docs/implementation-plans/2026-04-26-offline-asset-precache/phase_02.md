# Offline Asset Pre-Cache — Phase 2: AssetCache module

**Goal:** Land the `src/bootstrap/assetCache.js` module — an IIFE exposing `globalThis.AssetCache` with `precacheFromManifest()`, `getCachedText(url)`, `getCachedBlobUrl(url)`, and `_internals` — that persists asset bytes in IndexedDB. No rendering changes yet. The module silently populates IDB so Phase 3 can read from it.

**Architecture:** Mirror `src/bootstrap/cachedFetch.js`'s IIFE / IDB / error-swallow conventions exactly — the codebase already has a working pattern; do not invent a new one. Add a third object store `assets` to the existing `RoadTripPageCache` IndexedDB database by bumping its version from 1 to 2. Because two modules (`cachedFetch.js` and the new `assetCache.js`) open the same database, **both modules' `onupgradeneeded` handlers must idempotently create all three stores** (so whichever module triggers the upgrade ends up with a complete schema). `precacheFromManifest()` fetches `/asset-manifest.json` (resolved against `APP_BASE`), diffs it against IDB, downloads sha256-mismatched entries in parallel, deletes orphaned URLs, and swallows every error class the design names.

**Tech Stack:** Vanilla ES2017 JavaScript (no transpilation), IndexedDB, `fetch`, `crypto.subtle.digest` (only as a defensive option — not required for the diff). Tests: vitest 1.x + JSDOM + `fake-indexeddb/auto` (already configured).

**Scope:** Phase 2 of 4 from `docs/design-plans/2026-04-26-offline-asset-precache.md`.

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### offline-asset-precache.AC1: Manifest produced and consumed
- **offline-asset-precache.AC1.2 Success:** `AssetCache.precacheFromManifest()` fetches `/asset-manifest.json`, downloads every listed asset whose cached `sha256` differs from the manifest, and writes them to the `assets` IDB store with `{ url, bytes, contentType, sha256, etag, lastModified, cachedAt }` populated.
- **offline-asset-precache.AC1.3 Success:** When the manifest version changes and a previously-cached URL is no longer present in the manifest, that URL is deleted from the `assets` IDB store on the next `precacheFromManifest()` call.
- **offline-asset-precache.AC1.4 Failure:** `precacheFromManifest()` resolves (does not reject) when the manifest fetch returns a non-2xx status, when the network throws, or when the manifest body is malformed JSON. The IDB store is unchanged in any of these cases.

### offline-asset-precache.AC4: Invariants preserved
- **offline-asset-precache.AC4.5 Success:** When `precacheFromManifest()` is invoked on bootstrap, it does not block the first paint: the eager pre-fetch fires after the first swap completes (i.e., the user-visible render proceeds without awaiting the manifest fetch). *(Phase 2 verifies the module-level half of this AC: `precacheFromManifest()` returns a Promise that can be safely fire-and-forgot via `void precacheFromManifest()` without throwing synchronously. Phase 4 verifies the wiring half — that loader.js actually fires it as fire-and-forget after the first swap.)*

---

## Codebase verification findings (2026-04-27)

These notes drove the task design below — read for context, skip for action items.

- ✓ `src/bootstrap/cachedFetch.js` (existing) defines `DB_NAME='RoadTripPageCache'`, `DB_VERSION=1`, `STORE_PAGES='pages'`, `STORE_API='api'`, `APP_BASE='https://app-roadtripmap-prod.azurewebsites.net'` — match these constants exactly in `assetCache.js`.
- ✓ Helper signatures to mirror from `cachedFetch.js`: `_getDb()` (lines 22-55), `_putRecord(storeName, url, value)` (lines 64-80), `_getRecord(storeName, url)`, `_deleteRecord(storeName, url)` — same shape, parallel naming `_putAsset(record)`, `_getAsset(url)`, `_deleteAsset(url)`.
- ✓ `cachedFetch.js`'s `onupgradeneeded` (lines 41-49) uses idempotent `if (!db.objectStoreNames.contains(...))` — copy that pattern.
- ⚠ **Both modules must agree on `DB_VERSION`.** Calling `indexedDB.open(name, n)` with `n` lower than the stored version throws `VersionError`. So `cachedFetch.js` MUST also be bumped to `DB_VERSION = 2`, and BOTH modules' `onupgradeneeded` handlers must create all three stores idempotently — otherwise whichever module opens first leaves the other module's stores missing.
- ✓ `src/bootstrap/index.html` script load order (lines 7-12): `cachedFetch.js` → `listenerShim.js` → `tripStorage.js` → `fetchAndSwap.js` → `intercept.js` → `loader.js`. New entry goes between line 7 (`cachedFetch.js`) and line 8 (`listenerShim.js`) — `assetCache.js` only depends on the IDB plumbing established by cachedFetch.
- ✓ `globalThis.AssetCache` is unused everywhere in the repo — name is available.
- ✓ `tests/js/cachedFetch.test.js` is the canonical test pattern: read the module source as a string, eval it inside `beforeEach` to reset module-scoped state (`_db`), use `globalThis.<Module>._internals` to inspect state, and use `fake-indexeddb`'s `indexedDB.deleteDatabase()` between tests. Adopt this pattern for `tests/js/assetCache.test.js`.
- ✓ `package.json` has `fake-indexeddb: ^6.0.0` and a `test` script that runs `vitest run`.
- ✓ `vitest.config.js`: environment `jsdom`, setup `./tests/js/setup.js`, include `tests/js/**/*.test.js`. The new file fits in by name.
- ✓ Project house-style relevant here: `pattern: Imperative Shell` comment at top of bootstrap IIFE files (cachedFetch.js:1), error-swallow semantics (catch + return silently for IDB and network errors), `globalThis.<Module> = { publicApi, _internals }` shape.

---

## Skills to activate before implementing

The implementor agent should activate these before writing code (per the `coding-effectively` skill catalog):
- `ed3d-house-style:coding-effectively` — always
- `ed3d-house-style:howto-functional-vs-imperative` — separate the IDB I/O (imperative shell) from the manifest-diff logic (pure function over inputs); makes the diff trivially unit-testable.
- `ed3d-house-style:writing-good-tests` — the test file is integration-style around real IndexedDB (`fake-indexeddb`); test behavior, not method calls.
- `ed3d-plan-and-execute:test-driven-development` — for the new module's behavior, write the assertion before the implementation.

`programming-in-react` and `howto-code-in-typescript` do NOT apply (this is plain ES2017 JS).

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Bump `RoadTripPageCache` to version 2 in `cachedFetch.js`

**Verifies:** Sets up the schema needed for the rest of Phase 2; on its own, this task moves no AC to "done" — Task 2's tests pin the upgrade behavior.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/cachedFetch.js` (lines 7-9 and 41-49)

**Step 1: Bump the version constant**

At line 7, change:

```javascript
  const DB_VERSION = 1;
```

to:

```javascript
  const DB_VERSION = 2;
```

**Step 2: Add the `STORE_ASSETS` constant**

Immediately after line 9 (`const STORE_API = 'api';`), insert:

```javascript
  const STORE_ASSETS = 'assets';
```

The asset store is owned by `assetCache.js` (Task 3) — but `cachedFetch.js` needs to know its name in case `cachedFetch.js` is the first module to trigger the v1→v2 upgrade.

**Step 3: Extend the `onupgradeneeded` handler to create the `assets` store idempotently**

The current `onupgradeneeded` block at lines 41-49 reads:

```javascript
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_PAGES)) {
            db.createObjectStore(STORE_PAGES);
          }
          if (!db.objectStoreNames.contains(STORE_API)) {
            db.createObjectStore(STORE_API);
          }
        };
```

Append a third `if (!db.objectStoreNames.contains(...))` clause for `STORE_ASSETS` so the block becomes:

```javascript
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_PAGES)) {
            db.createObjectStore(STORE_PAGES);
          }
          if (!db.objectStoreNames.contains(STORE_API)) {
            db.createObjectStore(STORE_API);
          }
          if (!db.objectStoreNames.contains(STORE_ASSETS)) {
            db.createObjectStore(STORE_ASSETS);
          }
        };
```

**Why this matters:** When `assetCache.js` (Task 3) calls `indexedDB.open('RoadTripPageCache', 2)` *first*, its handler runs and creates `pages` + `api` + `assets`. When `cachedFetch.js` opens *first*, its handler runs and creates the same three stores. Either module loading first leaves a complete schema. The `if (!contains())` guards ensure idempotency on already-upgraded databases.

**Step 4: Expose `STORE_ASSETS` on `_internals`**

`cachedFetch.js`'s `_internals` block (around line 314-324 per investigation) lists the constants used by tests. Add `STORE_ASSETS` to it so the upgrade test (Task 2) can read it. Locate the block:

```javascript
    _internals: {
      _getDb,
      _putRecord,
      _getRecord,
      _deleteRecord,
      _closeDb,
      DB_NAME,
      DB_VERSION,
      STORE_PAGES,
      STORE_API
    }
```

Add `STORE_ASSETS,` between `STORE_API` and the closing brace:

```javascript
    _internals: {
      _getDb,
      _putRecord,
      _getRecord,
      _deleteRecord,
      _closeDb,
      DB_NAME,
      DB_VERSION,
      STORE_PAGES,
      STORE_API,
      STORE_ASSETS
    }
```

**Step 5: Verify the change is contained**

```bash
git diff src/bootstrap/cachedFetch.js
```

Expected: **only** the `DB_VERSION` change, the `STORE_ASSETS` constant, the `onupgradeneeded` clause, and the `_internals` addition. No other lines touched.

**Do NOT commit yet.** Task 2 adds the test that proves the upgrade works; commit them together at the end of Task 2.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add upgrade tests to `tests/js/cachedFetch.test.js`

**Verifies:** That bumping the version preserves `pages` + `api` semantics (groundwork for `offline-asset-precache.AC4.3`, which Phase 3 fully verifies) and that the new `assets` store exists after the upgrade.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/cachedFetch.test.js` (add new `describe` block at the end)

**Step 1: Append a new `describe` block**

At the bottom of the existing test file, add the following block. The eval-the-source pattern is the existing convention in this file — copy whatever helper bootstrap (e.g., `deleteDb`, `flushPromises`, the `beforeEach` setup that re-evals the source) is already at the top of the file. **Critical:** the existing `beforeEach` at lines 30-33 of `tests/js/cachedFetch.test.js` already calls `indexedDB.deleteDatabase('RoadTripPageCache')` between tests — this is essential for clean v1→v2 boundary state. Do NOT introduce tests that bypass that cleanup, or you'll get test-ordering bugs where a stale v1 DB lingers and the upgrade fires unexpectedly.

```javascript
describe('RoadTripPageCache version 1 → 2 upgrade (assets store)', () => {
  it('opens the database at version 2', async () => {
    const db = await globalThis.CachedFetch._internals._getDb();
    expect(db).not.toBeNull();
    expect(db.version).toBe(2);
  });

  it('creates the assets object store on upgrade', async () => {
    const db = await globalThis.CachedFetch._internals._getDb();
    expect(db.objectStoreNames.contains('assets')).toBe(true);
  });

  it('preserves the pages object store across the upgrade', async () => {
    const db = await globalThis.CachedFetch._internals._getDb();
    expect(db.objectStoreNames.contains('pages')).toBe(true);
  });

  it('preserves the api object store across the upgrade', async () => {
    const db = await globalThis.CachedFetch._internals._getDb();
    expect(db.objectStoreNames.contains('api')).toBe(true);
  });

  it('exposes STORE_ASSETS in _internals', () => {
    expect(globalThis.CachedFetch._internals.STORE_ASSETS).toBe('assets');
  });

  it('reports DB_VERSION === 2 in _internals', () => {
    expect(globalThis.CachedFetch._internals.DB_VERSION).toBe(2);
  });
});
```

**Step 2: Run the test file**

```bash
npm test -- tests/js/cachedFetch.test.js
```

Expected: all existing tests still pass (the upgrade should be transparent to existing pages/api semantics) and the six new tests pass. If any existing test fails, the version bump introduced a regression — investigate before continuing.

**Step 3: Run the full JS test suite to confirm no cross-file regression**

```bash
npm test
```

Expected: all 29 existing test files pass. Any pre-existing failures should be unchanged (record them; do not "fix" them in this commit).

**Step 4: Commit**

```bash
git add src/bootstrap/cachedFetch.js tests/js/cachedFetch.test.js
git commit -m "$(cat <<'EOF'
feat(bootstrap): bump RoadTripPageCache to v2, add `assets` store

Bumps DB_VERSION from 1 to 2 and extends the onupgradeneeded handler in
cachedFetch.js to idempotently create the new `assets` object store
alongside the existing `pages` and `api` stores. This is the schema
groundwork for the new src/bootstrap/assetCache.js module landing in
the next commits (Phase 2 of the offline-asset-precache plan).

Both cachedFetch.js and assetCache.js need to agree on DB_VERSION
because they open the same database — whichever module triggers the
upgrade owns the migration, so both must create all three stores.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Scaffold `src/bootstrap/assetCache.js` (IIFE, IDB layer, `getCachedText`/`getCachedBlobUrl`, `_internals`)

**Verifies:** Sets up the module skeleton; AC verification happens in Task 5.

**Files:**
- Create: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/assetCache.js`

**Step 1: Create the file with the full IIFE + IDB layer**

Write exactly this content. The structure mirrors `cachedFetch.js` line-for-line where possible (so a human reader sees the parallel) — `precacheFromManifest()` is left as a stub here and filled in by Task 4.

```javascript
// pattern: Imperative Shell
// AssetCache: IndexedDB-backed pre-cache for static assets (CSS, JS, ios.css)
// consumed by the iOS Capacitor shell. See
// docs/design-plans/2026-04-26-offline-asset-precache.md.

(function() {
  if (globalThis.AssetCache) {
    return;
  }

  const DB_NAME = 'RoadTripPageCache';
  const DB_VERSION = 2;
  const STORE_PAGES = 'pages';
  const STORE_API = 'api';
  const STORE_ASSETS = 'assets';
  const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net';
  const MANIFEST_PATH = '/asset-manifest.json';

  // === IDB Layer ===
  // Mirrors src/bootstrap/cachedFetch.js _getDb() exactly so both modules
  // can open the same database without disagreeing on the version. See
  // Task 1 of phase_02 for the matching cachedFetch.js change.

  let _db = null;

  async function _getDb() {
    if (_db) {
      return _db;
    }

    try {
      return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
          _db = null;
          resolve(null);
        };

        request.onsuccess = () => {
          _db = request.result;
          resolve(_db);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_PAGES)) {
            db.createObjectStore(STORE_PAGES);
          }
          if (!db.objectStoreNames.contains(STORE_API)) {
            db.createObjectStore(STORE_API);
          }
          if (!db.objectStoreNames.contains(STORE_ASSETS)) {
            db.createObjectStore(STORE_ASSETS);
          }
        };
      });
    } catch (err) {
      _db = null;
      return null;
    }
  }

  function _closeDb() {
    if (_db) {
      try { _db.close(); } catch (err) { /* swallow */ }
      _db = null;
    }
  }

  // Asset record shape:
  //   { url, bytes (ArrayBuffer), contentType, sha256, etag, lastModified, cachedAt }
  // Stored with `url` as the explicit out-of-line key (matches cachedFetch.js).

  async function _putAsset(record) {
    const db = await _getDb();
    if (!db) {
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ASSETS], 'readwrite');
      const store = tx.objectStore(STORE_ASSETS);
      const req = store.put(record, record.url);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function _getAsset(url) {
    const db = await _getDb();
    if (!db) {
      return null;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ASSETS], 'readonly');
      const store = tx.objectStore(STORE_ASSETS);
      const req = store.get(url);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || null);
    });
  }

  async function _deleteAsset(url) {
    const db = await _getDb();
    if (!db) {
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ASSETS], 'readwrite');
      const store = tx.objectStore(STORE_ASSETS);
      const req = store.delete(url);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Returns map of url → { sha256 } for every cached asset record.
  // Used by _diffManifest to compute missing/stale/orphan sets.
  async function _listAssetSummaries() {
    const db = await _getDb();
    if (!db) {
      return new Map();
    }
    return new Promise((resolve) => {
      const tx = db.transaction([STORE_ASSETS], 'readonly');
      const store = tx.objectStore(STORE_ASSETS);
      const summaries = new Map();
      const req = store.openCursor();
      req.onerror = () => resolve(summaries);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve(summaries);
          return;
        }
        const value = cursor.value;
        if (value && value.url) {
          summaries.set(value.url, { sha256: value.sha256 || null });
        }
        cursor.continue();
      };
    });
  }

  // === URL helpers ===

  function _absoluteUrl(url) {
    try {
      return new URL(url, APP_BASE).href;
    } catch {
      return url;
    }
  }

  // === Public API: byte access ===

  async function getCachedText(url) {
    try {
      const record = await _getAsset(url);
      if (!record || !record.bytes) {
        return null;
      }
      return new TextDecoder('utf-8').decode(record.bytes);
    } catch (err) {
      return null;
    }
  }

  async function getCachedBlobUrl(url) {
    try {
      const record = await _getAsset(url);
      if (!record || !record.bytes) {
        return null;
      }
      return _mintBlobUrl(record);
    } catch (err) {
      return null;
    }
  }

  function _mintBlobUrl(record) {
    const blob = new Blob([record.bytes], {
      type: record.contentType || 'application/octet-stream',
    });
    return URL.createObjectURL(blob);
  }

  // === Public API: manifest pre-cache (Task 4 fills this in) ===

  async function precacheFromManifest() {
    // Stubbed in Task 3; implemented in Task 4.
    return;
  }

  // === Module export ===

  globalThis.AssetCache = {
    precacheFromManifest,
    getCachedText,
    getCachedBlobUrl,
    _internals: {
      _getDb,
      _closeDb,
      _putAsset,
      _getAsset,
      _deleteAsset,
      _listAssetSummaries,
      _absoluteUrl,
      _mintBlobUrl,
      DB_NAME,
      DB_VERSION,
      STORE_ASSETS,
      MANIFEST_PATH,
      APP_BASE,
    },
  };
})();
```

**Step 2: Smoke-check the file is syntactically valid**

```bash
node --check src/bootstrap/assetCache.js
```

Expected: no output (success). If syntax error, fix before proceeding.

**Step 3: Do NOT commit yet** — Task 4 adds `precacheFromManifest`'s real implementation; commit at the end of Task 5.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Implement `precacheFromManifest()` in `assetCache.js`

**Verifies (in concert with Task 5's tests):** `offline-asset-precache.AC1.2`, `offline-asset-precache.AC1.3`, `offline-asset-precache.AC1.4`, and the module-level half of `offline-asset-precache.AC4.5`.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/assetCache.js` (replace the `precacheFromManifest` stub from Task 3)

**Step 1: Add a pure diff function above `precacheFromManifest`**

Above the stub `async function precacheFromManifest()` line, insert:

```javascript
  // Pure (no I/O) — given a parsed manifest and a Map of cached summaries,
  // returns the URL sets that need download or deletion. Easy to unit-test
  // in isolation; no IDB / network coupling.
  function _diffManifest(manifest, cachedSummaries) {
    const toDownload = [];
    const manifestUrls = new Set();

    if (manifest && Array.isArray(manifest.files)) {
      for (const entry of manifest.files) {
        if (!entry || typeof entry.url !== 'string' || typeof entry.sha256 !== 'string') {
          continue;
        }
        manifestUrls.add(entry.url);
        const cached = cachedSummaries.get(entry.url);
        if (!cached || cached.sha256 !== entry.sha256) {
          toDownload.push({ url: entry.url, sha256: entry.sha256 });
        }
      }
    }

    const toDelete = [];
    for (const url of cachedSummaries.keys()) {
      if (!manifestUrls.has(url)) {
        toDelete.push(url);
      }
    }

    return { toDownload, toDelete };
  }
```

**Step 2: Add a single-asset download function above `precacheFromManifest`**

Below `_diffManifest`, insert:

```javascript
  // Downloads one asset and writes the new record to IDB. Returns silently
  // on any error (network, non-2xx, IDB write). The manifest's sha256 is
  // stored as-is — we trust the manifest as the source of truth.
  async function _downloadAsset(url, expectedSha256) {
    try {
      const response = await fetch(_absoluteUrl(url), {
        method: 'GET',
        cache: 'no-cache',
      });
      if (!response || !response.ok) {
        return;
      }
      const bytes = await response.arrayBuffer();
      const contentType = response.headers.get('Content-Type') || _guessContentType(url);
      const etag = response.headers.get('ETag');
      const lastModified = response.headers.get('Last-Modified');

      const record = {
        url,
        bytes,
        contentType,
        sha256: expectedSha256,
        etag: etag || null,
        lastModified: lastModified || null,
        cachedAt: Date.now(),
      };
      await _putAsset(record);
    } catch (err) {
      // Swallow — manifest fetch may succeed even if individual asset 404s.
    }
  }

  function _guessContentType(url) {
    if (url.endsWith('.css')) return 'text/css';
    if (url.endsWith('.js')) return 'application/javascript';
    return 'application/octet-stream';
  }
```

**Step 3: Replace the `precacheFromManifest` stub with the real implementation**

Replace:

```javascript
  async function precacheFromManifest() {
    // Stubbed in Task 3; implemented in Task 4.
    return;
  }
```

with:

```javascript
  // AC1.2 + AC1.3 + AC1.4 + module-level AC4.5.
  // Resolves silently on every error class — manifest fetch failure,
  // malformed JSON, individual asset failures, IDB write errors — so that
  // a broken manifest never blocks the bootstrap or other consumers.
  async function precacheFromManifest() {
    let manifest;
    try {
      const response = await fetch(_absoluteUrl(MANIFEST_PATH), {
        method: 'GET',
        cache: 'no-cache',
      });
      if (!response || !response.ok) {
        return;
      }
      // response.json() throws SyntaxError on malformed JSON — caught below.
      manifest = await response.json();
    } catch (err) {
      return;
    }

    if (!manifest || !Array.isArray(manifest.files)) {
      return;
    }

    let cachedSummaries;
    try {
      cachedSummaries = await _listAssetSummaries();
    } catch (err) {
      return;
    }

    const { toDownload, toDelete } = _diffManifest(manifest, cachedSummaries);

    // Parallelize. allSettled so one failure doesn't poison the rest.
    await Promise.allSettled(toDownload.map((d) => _downloadAsset(d.url, d.sha256)));
    await Promise.allSettled(toDelete.map((u) => _deleteAsset(u)));
  }
```

**Step 4: Add `_diffManifest` and `_downloadAsset` to `_internals`**

Update the `_internals` block of the module export:

```javascript
    _internals: {
      _getDb,
      _closeDb,
      _putAsset,
      _getAsset,
      _deleteAsset,
      _listAssetSummaries,
      _absoluteUrl,
      _mintBlobUrl,
      _diffManifest,
      _downloadAsset,
      _guessContentType,
      DB_NAME,
      DB_VERSION,
      STORE_ASSETS,
      MANIFEST_PATH,
      APP_BASE,
    },
```

**Step 5: Smoke-check syntax**

```bash
node --check src/bootstrap/assetCache.js
```

Expected: no output (success).

**Step 6: Do NOT commit yet** — Task 5 wires the script into `index.html` and Task 6 lands the test file. Commit at the end of Task 6.
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Wire `assetCache.js` into `src/bootstrap/index.html`

**Verifies:** None directly — operational wiring. Phase 4 covers the full bootstrap-time invocation; Phase 2 only adds the script tag so the module is available to subsequent phases.

**Files:**
- Modify: `/Users/patrickford/Documents/claudeProjects/road-trip/src/bootstrap/index.html` (insert one line after the `cachedFetch.js` script tag)

**Step 1: Insert the new `<script defer>` tag**

Find this block (around lines 7-12):

```html
<script src="cachedFetch.js" defer></script>
<script src="listenerShim.js" defer></script>
<script src="tripStorage.js" defer></script>
<script src="fetchAndSwap.js" defer></script>
<script src="intercept.js" defer></script>
<script src="loader.js" defer></script>
```

Replace with (one new line inserted):

```html
<script src="cachedFetch.js" defer></script>
<script src="assetCache.js" defer></script>
<script src="listenerShim.js" defer></script>
<script src="tripStorage.js" defer></script>
<script src="fetchAndSwap.js" defer></script>
<script src="intercept.js" defer></script>
<script src="loader.js" defer></script>
```

`assetCache.js` goes immediately after `cachedFetch.js` because:
- It depends on the IDB plumbing convention established by `cachedFetch.js` (no actual code import — same DB, agreed-upon constants).
- It has no dependency on `listenerShim`, `tripStorage`, `intercept`, or `loader`.
- Phase 3 will install a hook in `fetchAndSwap.js` that calls `await AssetCache.rewriteAssetTags(parsed)` — for that to work, `assetCache.js` must execute before `fetchAndSwap.js`.

**Step 2: Smoke-check there are no other `<script>` tags or inline scripts that would race with the new module**

```bash
grep -nE '^\s*<script' src/bootstrap/index.html
```

Expected: 7 lines, all `defer`-attributed, in the order `cachedFetch.js`, `assetCache.js`, `listenerShim.js`, `tripStorage.js`, `fetchAndSwap.js`, `intercept.js`, `loader.js`. If any inline `<script>` block is present at the top of the file, flag it — it would run before any `defer` script and potentially before `globalThis.AssetCache` is installed.

**Step 3: Do NOT commit yet** — Task 6 adds the tests; commit them all together.
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (task 6) -->

<!-- START_TASK_6 -->
### Task 6: Create `tests/js/assetCache.test.js`

**Verifies:** `offline-asset-precache.AC1.2`, `offline-asset-precache.AC1.3`, `offline-asset-precache.AC1.4`, and module-level `offline-asset-precache.AC4.5`.

**Files:**
- Create: `/Users/patrickford/Documents/claudeProjects/road-trip/tests/js/assetCache.test.js`

**Step 1: Look at the existing pattern**

Open `tests/js/cachedFetch.test.js` and copy its top-of-file scaffolding: the imports (`vitest`, `fs`, `path`), the helper to read+eval the source, the `deleteDb` helper, the `flushPromises` helper, and the per-test `beforeEach` that closes the prior DB, deletes it, and re-evals the module so `_db` resets. The new test file follows the same shape.

**Step 2: Generate the test file**

Use the structure below, but adapt the bootstrap helpers to match `cachedFetch.test.js`'s exact pattern (do not invent a new bootstrap — copy the working one). The describe blocks below specify *what each test must verify* — implement them using the project's existing arrange-act-assert style.

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// --- Bootstrap (mirror tests/js/cachedFetch.test.js) ---
// 1. Read src/bootstrap/assetCache.js and src/bootstrap/cachedFetch.js as strings.
// 2. In beforeEach, deleteDatabase('RoadTripPageCache'), then eval each source so
//    module-scoped state (`_db`) resets per test.
// 3. afterEach: close the cached db handles, restore fetch, restore URL.createObjectURL
//    if mocked, clear timers.

// Provide a tiny helper that builds a manifest object literal and a paired Map
// of `cachedSummaries` so _diffManifest can be called directly.

describe('AssetCache._internals._diffManifest (pure)', () => {
  it('reports every manifest entry as missing when the cache is empty', () => {
    // Build a manifest with one CSS, one JS, one ios.css entry; pass an empty Map.
    // Expect toDownload to contain all three URLs; toDelete to be [].
  });

  it('reports stale entries when sha256 differs from cache', () => {
    // Manifest entry for /css/styles.css with sha256 "aaaa..."; cache has same URL with "bbbb...".
    // Expect toDownload to include /css/styles.css; toDelete to be [].
  });

  it('skips entries whose sha256 matches the cache', () => {
    // Manifest and cache agree on sha256 for /js/foo.js.
    // Expect toDownload to be []; toDelete to be [].
  });

  it('reports orphans (in cache, not in manifest) for deletion', () => {
    // Cache has /js/old.js; manifest does not list it.
    // Expect toDelete to include /js/old.js.
  });

  it('ignores manifest entries with missing url or sha256 fields', () => {
    // Manifest contains a malformed entry { url: '/css/styles.css' } (no sha256).
    // Expect that entry to be skipped (not in toDownload, not in toDelete via orphan logic).
  });

  it('ignores a non-array `files` field gracefully', () => {
    // Manifest is { files: 'not an array' }; cache has one entry.
    // Expect toDownload === [] and toDelete === [the cached url].
    // (Reason: manifestUrls is empty, so every cached url is an orphan.)
  });
});

describe('AssetCache IDB layer (assets store)', () => {
  it('writes and reads back a record by url', async () => {
    // _putAsset({ url: '/css/styles.css', bytes: new Uint8Array([1,2,3]).buffer, contentType: 'text/css', sha256: 'aaaa...', etag: null, lastModified: null, cachedAt: Date.now() })
    // _getAsset('/css/styles.css') → resolves with the same record.
  });

  it('returns null for a url that was never written', async () => {
    // _getAsset('/never-written.css') → null.
  });

  it('deletes a record', async () => {
    // _putAsset → _deleteAsset → _getAsset → null.
  });

  it('does not touch the pages store on writes', async () => {
    // Write a /pages/x record via CachedFetch._internals._putRecord('pages', '/x', { ... }).
    // Then write an asset via AssetCache._internals._putAsset(...).
    // Then read /pages/x back via CachedFetch._internals._getRecord — assert unchanged.
    // (Verifies the AC4.3 invariant at the IDB-layer scope.)
  });
});

describe('AssetCache.precacheFromManifest() — happy path (AC1.2)', () => {
  it('downloads every entry and writes records to the assets store', async () => {
    // Stub globalThis.fetch:
    //   /asset-manifest.json → { version: '1.0.0-abc', files: [{ url: '/css/styles.css', size: 5, sha256: 'AA' }, { url: '/js/foo.js', size: 7, sha256: 'BB' }] }
    //   /css/styles.css → 'body{}', Content-Type 'text/css'
    //   /js/foo.js → 'console.log()', Content-Type 'application/javascript'
    // Call await AssetCache.precacheFromManifest().
    // Assert _getAsset('/css/styles.css') returns a record with sha256 === 'AA' and bytes decoding to 'body{}'.
    // Assert _getAsset('/js/foo.js') returns a record with sha256 === 'BB' and bytes decoding to 'console.log()'.
    // Assert all asset records have cachedAt set to a number close to Date.now().
  });

  it('skips assets whose cached sha256 matches the manifest', async () => {
    // Pre-populate IDB with /css/styles.css sha256='AA' bytes='cached'.
    // Manifest lists /css/styles.css sha256='AA'.
    // Stub fetch to throw for /css/styles.css (so any download attempt would fail).
    // Call precacheFromManifest. Expect /css/styles.css record bytes still === 'cached' (no overwrite).
  });

  it('refreshes assets whose cached sha256 differs from the manifest', async () => {
    // Pre-populate IDB with /css/styles.css sha256='OLD' bytes='old'.
    // Manifest lists /css/styles.css sha256='NEW'.
    // Stub fetch to return 'new' for /css/styles.css.
    // Call precacheFromManifest. Expect record now sha256='NEW' bytes='new'.
  });
});

describe('AssetCache.precacheFromManifest() — orphan deletion (AC1.3)', () => {
  it('deletes urls present in IDB but absent from the manifest', async () => {
    // Pre-populate /js/old.js in assets.
    // Stub /asset-manifest.json to omit /js/old.js.
    // Call precacheFromManifest. Expect _getAsset('/js/old.js') === null.
  });

  it('does not delete urls still listed in the manifest (sha match)', async () => {
    // Pre-populate /js/keep.js sha='K'.
    // Manifest lists /js/keep.js sha='K'.
    // Call precacheFromManifest. Expect _getAsset('/js/keep.js') still defined.
  });
});

describe('AssetCache.precacheFromManifest() — failure modes (AC1.4)', () => {
  it('resolves (does not reject) when the manifest fetch returns 404', async () => {
    // Pre-populate IDB with /css/styles.css.
    // Stub /asset-manifest.json fetch → response { ok: false, status: 404 }.
    // expect(precacheFromManifest()).resolves.toBeUndefined()
    // Assert /css/styles.css record is unchanged.
  });

  it('resolves (does not reject) when the network throws on the manifest fetch', async () => {
    // Stub /asset-manifest.json fetch to throw 'TypeError: Failed to fetch'.
    // Asset cache state must be unchanged.
  });

  it('resolves (does not reject) when the manifest body is malformed JSON', async () => {
    // Stub /asset-manifest.json fetch → response with body that throws on .json().
    // Asset cache state must be unchanged.
  });

  it('resolves when the manifest fetch succeeds but `files` is not an array', async () => {
    // Stub fetch to return { version: 'x', files: 'oops' }.
    // Asset cache state unchanged.
  });

  it('continues past an individual asset 404 without rejecting', async () => {
    // Manifest lists two assets, A and B. Stub A's fetch to 404, B's fetch to 200.
    // Call precacheFromManifest. Expect _getAsset(A) === null, _getAsset(B) defined.
  });
});

describe('AssetCache.precacheFromManifest() — non-blocking semantics (AC4.5 module half)', () => {
  it('returns a Promise', () => {
    expect(typeof globalThis.AssetCache.precacheFromManifest().then).toBe('function');
  });

  it('does not throw synchronously when fired-and-forgotten with `void`', () => {
    // Stub fetch to throw asynchronously.
    expect(() => { void globalThis.AssetCache.precacheFromManifest(); }).not.toThrow();
  });
});

describe('AssetCache.getCachedText / getCachedBlobUrl', () => {
  it('getCachedText decodes cached bytes as UTF-8', async () => {
    // _putAsset with bytes = TextEncoder.encode('body { color: red; }')
    // expect(await getCachedText('/css/styles.css')).toBe('body { color: red; }')
  });

  it('getCachedText returns null when no record exists', async () => {
    expect(await globalThis.AssetCache.getCachedText('/missing.css')).toBeNull();
  });

  it('getCachedBlobUrl returns a blob: URL for a cached record', async () => {
    // Stub URL.createObjectURL to return 'blob:fake-url'.
    // _putAsset with contentType 'application/javascript'.
    // expect(await getCachedBlobUrl('/js/foo.js')).toBe('blob:fake-url')
    // Confirm URL.createObjectURL was called with a Blob whose type === 'application/javascript'.
  });

  it('getCachedBlobUrl returns null when no record exists', async () => {
    expect(await globalThis.AssetCache.getCachedBlobUrl('/missing.js')).toBeNull();
  });
});
```

**Step 3: Run the new file**

```bash
npm test -- tests/js/assetCache.test.js
```

Expected: every test passes. If any test fails, the implementation in Task 3 / Task 4 is wrong — fix the implementation, not the test (the AC text is the spec).

**Step 4: Run the full JS suite**

```bash
npm test
```

Expected: all 30 test files pass (29 existing + the new `assetCache.test.js`). Pre-existing failures unrelated to Phase 2 should remain unchanged.

**Step 5: Commit Phase 2**

```bash
git add src/bootstrap/assetCache.js src/bootstrap/index.html tests/js/assetCache.test.js
git commit -m "$(cat <<'EOF'
feat(bootstrap): add AssetCache module for offline asset pre-cache

Adds src/bootstrap/assetCache.js — an IIFE that exposes
globalThis.AssetCache with precacheFromManifest, getCachedText,
getCachedBlobUrl, and _internals. Backed by the assets object store
in RoadTripPageCache (added in the prior commit's v1→v2 upgrade).

precacheFromManifest fetches /asset-manifest.json (resolved against
APP_BASE), diffs it against IDB by sha256, downloads stale/missing
entries in parallel, and deletes orphaned URLs. Every error class
named in the design AC1.4 (manifest fetch failure, network throw,
malformed JSON, individual asset 404) is swallowed so a broken
manifest cannot block the bootstrap.

Wires the new module into src/bootstrap/index.html immediately after
cachedFetch.js, so the IDB plumbing it depends on is in place but
fetchAndSwap.js (Phase 3 hook target) still loads after.

Verifies offline-asset-precache.AC1.2, AC1.3, AC1.4, and the
module-level half of AC4.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
<!-- END_TASK_6 -->

<!-- END_SUBCOMPONENT_C -->

---

## Phase 2 done when

- All six tasks above committed to `offline-asset-precache`.
- `npm test` passes for the new and existing JS test files.
- `RoadTripPageCache` opens at version 2 with the `assets` store present alongside `pages` and `api` (verified by Task 2's tests).
- `AssetCache.precacheFromManifest()` populates the `assets` store from `/asset-manifest.json` and silently survives every failure mode listed in `offline-asset-precache.AC1.4` (verified by Task 6's tests).
- No rendering changes yet — the rewrite hook lives in Phase 3.
