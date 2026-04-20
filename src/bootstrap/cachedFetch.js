// pattern: Imperative Shell
// CachedFetch: IndexedDB-backed cache layer for pages and API responses
// Implements AC3 (offline-first cache) with bypass classifier for mapCache.js exclusions

(function() {
  const DB_NAME = 'RoadTripPageCache';
  const DB_VERSION = 1;
  const STORE_PAGES = 'pages';
  const STORE_API = 'api';
  const BYPASS_REGEX = /^\/api\/(poi|park-boundaries)(?:[/?]|$)/;
  const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net';

  // === IDB Layer ===

  /**
   * Lazy-open IndexedDB connection. Returns null on private browsing.
   * Caches the database handle in _db; reuses it on subsequent calls.
   * Pattern matches mapCache.js:24-61.
   */
  let _db = null;

  async function _getDb() {
    if (_db) {
      return _db;
    }

    try {
      return new Promise((resolve, reject) => {
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
        };
      });
    } catch (err) {
      _db = null;
      return null;
    }
  }

  /**
   * Write a record to IndexedDB.
   * storeName: STORE_PAGES or STORE_API
   * url: the cache key
   * value: the record object
   * Resolves on success, rejects on transaction/request error.
   */
  async function _putRecord(storeName, url, value) {
    const db = await _getDb();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value, url);

      req.onerror = () => reject(req.error);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Read a record from IndexedDB.
   * storeName: STORE_PAGES or STORE_API
   * url: the cache key
   * Returns the record (undefined if not found), or null if IDB unavailable.
   */
  async function _getRecord(storeName, url) {
    const db = await _getDb();
    if (!db) {
      return null;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(url);

        req.onerror = () => reject(req.error);

        tx.oncomplete = () => {
          resolve(req.result);
        };

        tx.onerror = () => reject(tx.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Delete a record from IndexedDB. Test-only convenience.
   */
  async function _deleteRecord(storeName, url) {
    const db = await _getDb();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(url);

      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        tx.oncomplete = () => resolve();
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  // === Bypass Classifier ===

  /**
   * Check if a URL should bypass caching (i.e., handled by mapCache.js).
   * Returns true for /api/poi and /api/park-boundaries URLs.
   * Safely handles invalid URLs (returns false).
   */
  function isBypassed(url) {
    let pathname;
    try {
      pathname = new URL(url, APP_BASE).pathname;
    } catch {
      return false;
    }
    return BYPASS_REGEX.test(pathname);
  }

  // === Helpers (Task 3) ===

  /**
   * Convert a cached record to a Response object.
   * Reconstructs headers from etag and lastModified if present.
   */
  function _toResponse(cached, asJson) {
    const headers = new Headers();
    headers.set('Content-Type', asJson ? (cached.contentType || 'application/json') : 'text/html');
    if (cached.etag) headers.set('ETag', cached.etag);
    if (cached.lastModified) headers.set('Last-Modified', cached.lastModified);
    const body = asJson ? cached.body : cached.html;
    return new Response(body, { status: 200, headers });
  }

  /**
   * Write a network response to the cache after a cache miss.
   * Extracts body, content-type, etag, and last-modified headers.
   * Stores as either { html, ... } or { body, contentType, ... } depending on asJson.
   */
  async function _writeThrough(storeName, url, responseClone, asJson) {
    const text = await responseClone.text();
    const etag = responseClone.headers.get('etag') || null;
    const lastModified = responseClone.headers.get('last-modified') || null;
    const cachedAt = Date.now();
    if (asJson) {
      const contentType = responseClone.headers.get('content-type') || 'application/json';
      await _putRecord(storeName, url, { body: text, contentType, etag, lastModified, cachedAt });
    } else {
      await _putRecord(storeName, url, { html: text, etag, lastModified, cachedAt });
    }
  }

  /**
   * Background revalidate: fire-and-forget fetch with conditional headers.
   * Called on cache hit to check if the cached content is stale.
   * - Sends If-None-Match and/or If-Modified-Since only if the cached record has them.
   * - 304 Not Modified → keep stale cache, no write.
   * - 200 OK → write updated content to IDB via _writeThrough.
   * - Non-OK response → keep stale cache, no write.
   * - Network error → swallowed silently (AC3.5).
   * - IDB write error → swallowed silently.
   * Live document is NOT updated; Phase 3 enforces AC3.4 externally.
   */
  async function _backgroundRevalidate(url, asJson, cached) {
    try {
      const headers = {};
      if (cached.etag) headers['If-None-Match'] = cached.etag;
      if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;

      let response;
      try {
        response = await fetch(url, { headers });
      } catch {
        // AC3.5: network error is swallowed silently
        return;
      }

      if (!response || response.status === 304) {
        // Not Modified — keep stale cache
        return;
      }

      if (!response.ok) {
        // Server error — keep stale cache
        return;
      }

      const db = await _getDb();
      if (!db) {
        // IDB unavailable — silently skip write
        return;
      }

      const storeName = asJson ? STORE_API : STORE_PAGES;
      try {
        await _writeThrough(storeName, url, response, asJson);
      } catch {
        // IDB write error — swallowed silently
        return;
      }
    } catch {
      // Any unexpected error is swallowed
      return;
    }
  }

  // === CachedFetch Public API ===

  /**
   * Fetch a URL with IndexedDB cache.
   * Options:
   *   asJson: true → use 'api' store; false (default) → use 'pages' store
   *   signal: AbortSignal for request cancellation
   * Returns: { response: Response, source: 'cache' | 'network' }
   *
   * Cache-first read: returns immediately from cache if available.
   * Cache miss: fetches from network and writes successful responses (status 200+) to IDB.
   * Bypass: /api/poi and /api/park-boundaries pass through network without caching.
   */
  async function cachedFetch(url, opts = {}) {
    const { asJson = false, signal } = opts;

    // Bypass: never cache, never read cache. Per AC3.7, mapCache owns these.
    if (isBypassed(url)) {
      const response = await fetch(url, { signal });
      return { response, source: 'network' };
    }

    const storeName = asJson ? STORE_API : STORE_PAGES;
    const db = await _getDb();

    // Cache-first read
    if (db) {
      const cached = await _getRecord(storeName, url);
      if (cached) {
        void _backgroundRevalidate(url, asJson, cached);  // fire-and-forget; intentional un-awaited promise
        return { response: _toResponse(cached, asJson), source: 'cache' };
      }
    }

    // Cache miss: fetch from network and write through
    const response = await fetch(url, { signal });
    if (response.ok && db) {
      await _writeThrough(storeName, url, response.clone(), asJson);
    }
    return { response, source: 'network' };
  }

  // === Module Exposure ===

  /**
   * Test-only helper to close and reset the database connection.
   * Used between tests to ensure clean state.
   */
  function _closeDb() {
    if (_db) {
      _db.close();
      _db = null;
    }
  }

  globalThis.CachedFetch = {
    cachedFetch,
    isBypassed,
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
  };
})();
