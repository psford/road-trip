// pattern: Imperative Shell
// CachedFetch: IndexedDB-backed cache layer for pages and API responses
// Implements AC3 (offline-first cache) with bypass classifier for mapCache.js exclusions

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
                console.warn('IndexedDB unavailable (may be private browsing)');
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
        console.warn('IndexedDB error:', err);
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
        req.onsuccess = () => {
            tx.oncomplete = () => resolve();
        };

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
        const tx = db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(url);

        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
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

// === CachedFetch Public API ===

/**
 * Fetch a URL with IndexedDB cache.
 * Options:
 *   asJson: true → use 'api' store; false (default) → use 'pages' store
 *   signal: AbortSignal for request cancellation
 * Returns: { response: Response, source: 'cache' | 'network' }
 *
 * Task 1: Stub implementation. Real logic added in Task 3.
 */
async function cachedFetch(url, opts) {
    throw new Error('cachedFetch NOT_IMPLEMENTED — see Task 3');
}

// === Module Exposure ===

globalThis.CachedFetch = {
    cachedFetch,
    isBypassed,
    _internals: {
        _getDb,
        _putRecord,
        _getRecord,
        _deleteRecord,
        DB_NAME,
        DB_VERSION,
        STORE_PAGES,
        STORE_API
    }
};
