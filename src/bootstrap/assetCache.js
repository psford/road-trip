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
      try {
        const tx = db.transaction([STORE_ASSETS], 'readonly');
        const store = tx.objectStore(STORE_ASSETS);
        const req = store.get(url);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => {
          resolve(req.result || null);
        };
        tx.onerror = () => reject(tx.error);
      } catch (err) {
        reject(err);
      }
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

  // === Manifest pre-cache helpers ===

  // ===== Functional Core (within Imperative Shell module) =====
  // _diffManifest is a pure function over (manifest, cachedSummaries).
  // No I/O, no side effects, no globals. Trivially unit-testable in isolation
  // (see tests/js/assetCache.test.js — _diffManifest pure tests).
  // Kept inline because bootstrap-module convention is one IIFE per file;
  // a separate file would require a new <script> tag and break that pattern.
  // ===== End Functional Core =====
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

  // === Public API: manifest pre-cache ===

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
      _diffManifest,
      _downloadAsset,
      _guessContentType,
      DB_NAME,
      DB_VERSION,
      STORE_ASSETS,
      MANIFEST_PATH,
      APP_BASE,
    },
  };
})();
