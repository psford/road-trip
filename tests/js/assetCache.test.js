import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSET_CACHE_SOURCE_PATH = path.resolve(__dirname, '../../src/bootstrap/assetCache.js');
const CACHED_FETCH_SOURCE_PATH = path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js');
const ASSET_CACHE_SOURCE = fs.readFileSync(ASSET_CACHE_SOURCE_PATH, 'utf8');
const CACHED_FETCH_SOURCE = fs.readFileSync(CACHED_FETCH_SOURCE_PATH, 'utf8');

/**
 * Delete an IndexedDB database by name.
 * Handles both onsuccess and onblocked callbacks with timeout fallback.
 */
async function deleteDb(name) {
    // Check if database exists first
    const dbs = await indexedDB.databases?.() || [];
    const exists = dbs.some(db => db.name === name);

    if (!exists) {
        return;
    }

    await Promise.race([
        new Promise((resolve, reject) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => resolve();
        }),
        new Promise((resolve) => setTimeout(resolve, 2000))
    ]);
}

/**
 * Flush all pending promises and macrotasks.
 */
async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
    // Close previous database connections
    try {
        if (globalThis.CachedFetch?._internals?._closeDb) {
            globalThis.CachedFetch._internals._closeDb();
        }
        if (globalThis.AssetCache?._internals?._closeDb) {
            globalThis.AssetCache._internals._closeDb();
        }
    } catch (err) {
        // Ignore
    }

    // Clean up any previous state
    delete globalThis.CachedFetch;
    delete globalThis.AssetCache;

    // Small delay to ensure cleanup is complete
    await new Promise(r => setTimeout(r, 5));

    // Eval both sources in order: cachedFetch first (establishes DB), then assetCache
    eval(CACHED_FETCH_SOURCE);
    eval(ASSET_CACHE_SOURCE);
}, 30000);

afterEach(async () => {
    // Close both database connections before cleaning up
    if (globalThis.CachedFetch?._internals?._closeDb) {
        try {
            globalThis.CachedFetch._internals._closeDb();
        } catch (err) {
            // Ignore
        }
    }
    if (globalThis.AssetCache?._internals?._closeDb) {
        try {
            globalThis.AssetCache._internals._closeDb();
        } catch (err) {
            // Ignore
        }
    }

    delete globalThis.CachedFetch;
    delete globalThis.AssetCache;

    // Restore all mocked globals
    vi.clearAllMocks();
});

// === Tests for _diffManifest (pure function) ===

describe('AssetCache._internals._diffManifest (pure)', () => {
    it('reports every manifest entry as missing when the cache is empty', () => {
        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/css/styles.css', sha256: 'AAAA' },
                { url: '/js/foo.js', sha256: 'BBBB' },
                { url: '/ios.css', sha256: 'CCCC' }
            ]
        };
        const cachedSummaries = new Map();

        const { toDownload, toDelete } = globalThis.AssetCache._internals._diffManifest(manifest, cachedSummaries);

        expect(toDownload).toHaveLength(3);
        expect(toDownload.map(d => d.url)).toEqual(['/css/styles.css', '/js/foo.js', '/ios.css']);
        expect(toDelete).toHaveLength(0);
    });

    it('reports stale entries when sha256 differs from cache', () => {
        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/css/styles.css', sha256: 'AAAA' }
            ]
        };
        const cachedSummaries = new Map([
            ['/css/styles.css', { sha256: 'BBBB' }]
        ]);

        const { toDownload, toDelete } = globalThis.AssetCache._internals._diffManifest(manifest, cachedSummaries);

        expect(toDownload).toHaveLength(1);
        expect(toDownload[0]).toEqual({ url: '/css/styles.css', sha256: 'AAAA' });
        expect(toDelete).toHaveLength(0);
    });

    it('skips entries whose sha256 matches the cache', () => {
        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/js/foo.js', sha256: 'KKKK' }
            ]
        };
        const cachedSummaries = new Map([
            ['/js/foo.js', { sha256: 'KKKK' }]
        ]);

        const { toDownload, toDelete } = globalThis.AssetCache._internals._diffManifest(manifest, cachedSummaries);

        expect(toDownload).toHaveLength(0);
        expect(toDelete).toHaveLength(0);
    });

    it('reports orphans (in cache, not in manifest) for deletion', () => {
        const manifest = {
            version: '1.0.0',
            files: []
        };
        const cachedSummaries = new Map([
            ['/js/old.js', { sha256: 'XXXX' }]
        ]);

        const { toDownload, toDelete } = globalThis.AssetCache._internals._diffManifest(manifest, cachedSummaries);

        expect(toDownload).toHaveLength(0);
        expect(toDelete).toEqual(['/js/old.js']);
    });

    it('ignores manifest entries with missing url or sha256 fields', () => {
        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/css/styles.css' },  // missing sha256
                { sha256: 'MMMM' },           // missing url
                { url: '/js/valid.js', sha256: 'VVVV' }
            ]
        };
        const cachedSummaries = new Map();

        const { toDownload, toDelete } = globalThis.AssetCache._internals._diffManifest(manifest, cachedSummaries);

        expect(toDownload).toHaveLength(1);
        expect(toDownload[0]).toEqual({ url: '/js/valid.js', sha256: 'VVVV' });
        expect(toDelete).toHaveLength(0);
    });

    it('ignores a non-array `files` field gracefully', () => {
        const manifest = {
            version: '1.0.0',
            files: 'not an array'
        };
        const cachedSummaries = new Map([
            ['/js/old.js', { sha256: 'XXXX' }]
        ]);

        const { toDownload, toDelete } = globalThis.AssetCache._internals._diffManifest(manifest, cachedSummaries);

        expect(toDownload).toHaveLength(0);
        expect(toDelete).toEqual(['/js/old.js']);
    });
});

// === Tests for IDB Layer ===

describe('AssetCache IDB layer (assets store)', () => {
    it('writes and reads back a record by url', async () => {
        const record = {
            url: '/css/styles.css',
            bytes: new Uint8Array([1, 2, 3]).buffer,
            contentType: 'text/css',
            sha256: 'aaaa1111',
            etag: 'W/"v1"',
            lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT',
            cachedAt: Date.now()
        };

        await globalThis.AssetCache._internals._putAsset(record);
        const retrieved = await globalThis.AssetCache._internals._getAsset('/css/styles.css');

        expect(retrieved).not.toBeNull();
        expect(retrieved.url).toBe('/css/styles.css');
        expect(retrieved.contentType).toBe('text/css');
        expect(retrieved.sha256).toBe('aaaa1111');
    });

    it('returns null for a url that was never written', async () => {
        const retrieved = await globalThis.AssetCache._internals._getAsset('/never-written.css');
        expect(retrieved).toBeNull();
    });

    it('deletes a record', async () => {
        const record = {
            url: '/js/app.js',
            bytes: new Uint8Array([7, 8, 9]).buffer,
            contentType: 'application/javascript',
            sha256: 'bbbb2222',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };

        await globalThis.AssetCache._internals._putAsset(record);
        let retrieved = await globalThis.AssetCache._internals._getAsset('/js/app.js');
        expect(retrieved).not.toBeNull();

        await globalThis.AssetCache._internals._deleteAsset('/js/app.js');
        retrieved = await globalThis.AssetCache._internals._getAsset('/js/app.js');
        expect(retrieved).toBeNull();
    });

    it('does not touch the pages store on writes', async () => {
        // Write a page record via CachedFetch
        const pageRecord = {
            html: '<html>test</html>',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.CachedFetch._internals._putRecord(
            globalThis.CachedFetch._internals.STORE_PAGES,
            '/pages/x',
            pageRecord
        );

        // Write an asset record
        const assetRecord = {
            url: '/css/styles.css',
            bytes: new Uint8Array([1, 2, 3]).buffer,
            contentType: 'text/css',
            sha256: 'cccc3333',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(assetRecord);

        // Read back the page record and verify it's unchanged
        const retrievedPage = await globalThis.CachedFetch._internals._getRecord(
            globalThis.CachedFetch._internals.STORE_PAGES,
            '/pages/x'
        );
        expect(retrievedPage).toEqual(pageRecord);
    });
});

// === Tests for precacheFromManifest (happy path) ===

describe('AssetCache.precacheFromManifest() — happy path (AC1.2)', () => {
    it('downloads every entry and writes records to the assets store', async () => {
        const manifest = {
            version: '1.0.0-abc',
            files: [
                { url: '/css/styles.css', sha256: 'AA', size: 5 },
                { url: '/js/foo.js', sha256: 'BB', size: 7 }
            ]
        };

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            if (url.includes('/css/styles.css')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'Content-Type': 'text/css' }),
                    arrayBuffer: () => Promise.resolve(new TextEncoder().encode('body{}').buffer)
                });
            }
            if (url.includes('/js/foo.js')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'Content-Type': 'application/javascript' }),
                    arrayBuffer: () => Promise.resolve(new TextEncoder().encode('console.log()').buffer)
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        await globalThis.AssetCache.precacheFromManifest();

        const css = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
        const js = await globalThis.AssetCache._internals._getAsset('/js/foo.js');

        expect(css).not.toBeNull();
        expect(css.sha256).toBe('AA');
        expect(new TextDecoder().decode(css.bytes)).toBe('body{}');
        expect(css.cachedAt).toBeDefined();
        expect(typeof css.cachedAt).toBe('number');

        expect(js).not.toBeNull();
        expect(js.sha256).toBe('BB');
        expect(new TextDecoder().decode(js.bytes)).toBe('console.log()');
    });

    it('skips assets whose cached sha256 matches the manifest', async () => {
        // Pre-populate IDB with a record
        const record = {
            url: '/css/styles.css',
            bytes: new TextEncoder().encode('cached').buffer,
            contentType: 'text/css',
            sha256: 'AA',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(record);

        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/css/styles.css', sha256: 'AA' }
            ]
        };

        let fetchCalled = false;
        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            if (url.includes('/css/styles.css')) {
                fetchCalled = true;
                return Promise.reject(new Error('Should not fetch /css/styles.css'));
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        await globalThis.AssetCache.precacheFromManifest();

        // Verify the fetch for the asset was never called
        expect(fetchCalled).toBe(false);

        // Verify the cached record is unchanged
        const retrieved = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
        expect(retrieved).not.toBeNull();
        expect(new TextDecoder().decode(retrieved.bytes)).toBe('cached');
    });

    it('refreshes assets whose cached sha256 differs from the manifest', async () => {
        // Pre-populate with old version
        const oldRecord = {
            url: '/css/styles.css',
            bytes: new TextEncoder().encode('old').buffer,
            contentType: 'text/css',
            sha256: 'OLD',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(oldRecord);

        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/css/styles.css', sha256: 'NEW' }
            ]
        };

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            if (url.includes('/css/styles.css')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'Content-Type': 'text/css' }),
                    arrayBuffer: () => Promise.resolve(new TextEncoder().encode('new').buffer)
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        await globalThis.AssetCache.precacheFromManifest();

        const retrieved = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
        expect(retrieved).not.toBeNull();
        expect(retrieved.sha256).toBe('NEW');
        expect(new TextDecoder().decode(retrieved.bytes)).toBe('new');
    });
});

// === Tests for precacheFromManifest (orphan deletion) ===

describe('AssetCache.precacheFromManifest() — orphan deletion (AC1.3)', () => {
    it('deletes urls present in IDB but absent from the manifest', async () => {
        // Pre-populate with an orphan
        const record = {
            url: '/js/old.js',
            bytes: new TextEncoder().encode('old').buffer,
            contentType: 'application/javascript',
            sha256: 'OLDDD',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(record);

        // Manifest does not include /js/old.js
        const manifest = {
            version: '1.0.0',
            files: []
        };

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        await globalThis.AssetCache.precacheFromManifest();

        const retrieved = await globalThis.AssetCache._internals._getAsset('/js/old.js');
        expect(retrieved).toBeNull();
    });

    it('does not delete urls still listed in the manifest (sha match)', async () => {
        // Pre-populate with a kept asset
        const record = {
            url: '/js/keep.js',
            bytes: new TextEncoder().encode('keep').buffer,
            contentType: 'application/javascript',
            sha256: 'K',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(record);

        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/js/keep.js', sha256: 'K' }
            ]
        };

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        await globalThis.AssetCache.precacheFromManifest();

        const retrieved = await globalThis.AssetCache._internals._getAsset('/js/keep.js');
        expect(retrieved).not.toBeNull();
    });
});

// === Tests for precacheFromManifest (failure modes) ===

describe('AssetCache.precacheFromManifest() — failure modes (AC1.4)', () => {
    it('resolves (does not reject) when the manifest fetch returns 404', async () => {
        // Pre-populate so we can verify it stays unchanged
        const record = {
            url: '/css/styles.css',
            bytes: new TextEncoder().encode('cached').buffer,
            contentType: 'text/css',
            sha256: 'AA',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(record);

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: false,
                    status: 404
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        // Should not throw or reject
        const result = await globalThis.AssetCache.precacheFromManifest();
        expect(result).toBeUndefined();

        // Verify state is unchanged
        const retrieved = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
        expect(retrieved).not.toBeNull();
        expect(new TextDecoder().decode(retrieved.bytes)).toBe('cached');
    });

    it('resolves (does not reject) when the network throws on the manifest fetch', async () => {
        // Pre-populate so we can verify it stays unchanged
        const record = {
            url: '/css/styles.css',
            bytes: new TextEncoder().encode('cached').buffer,
            contentType: 'text/css',
            sha256: 'AA',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(record);

        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.reject(new TypeError('Failed to fetch'));
        }));

        // Should not throw or reject
        const result = await globalThis.AssetCache.precacheFromManifest();
        expect(result).toBeUndefined();

        // Verify state is unchanged
        const retrieved = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
        expect(retrieved).not.toBeNull();
    });

    it('resolves (does not reject) when the manifest body is malformed JSON', async () => {
        // Pre-populate so we can verify it stays unchanged
        const record = {
            url: '/css/styles.css',
            bytes: new TextEncoder().encode('cached').buffer,
            contentType: 'text/css',
            sha256: 'AA',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(record);

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.reject(new SyntaxError('Unexpected token'))
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        // Should not throw or reject
        const result = await globalThis.AssetCache.precacheFromManifest();
        expect(result).toBeUndefined();

        // Verify state is unchanged
        const retrieved = await globalThis.AssetCache._internals._getAsset('/css/styles.css');
        expect(retrieved).not.toBeNull();
    });

    it('resolves when the manifest fetch succeeds but `files` is not an array', async () => {
        const manifest = {
            version: 'x',
            files: 'oops'
        };

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        // Should not throw or reject
        const result = await globalThis.AssetCache.precacheFromManifest();
        expect(result).toBeUndefined();
    });

    it('continues past an individual asset 404 without rejecting', async () => {
        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/css/A.css', sha256: 'AA' },
                { url: '/css/B.css', sha256: 'BB' }
            ]
        };

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            if (url.includes('/css/A.css')) {
                return Promise.resolve({
                    ok: false,
                    status: 404
                });
            }
            if (url.includes('/css/B.css')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'Content-Type': 'text/css' }),
                    arrayBuffer: () => Promise.resolve(new TextEncoder().encode('b-content').buffer)
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        // Should not throw or reject
        const result = await globalThis.AssetCache.precacheFromManifest();
        expect(result).toBeUndefined();

        // Verify A was not cached (404)
        const a = await globalThis.AssetCache._internals._getAsset('/css/A.css');
        expect(a).toBeNull();

        // Verify B was cached (200)
        const b = await globalThis.AssetCache._internals._getAsset('/css/B.css');
        expect(b).not.toBeNull();
        expect(b.sha256).toBe('BB');
        expect(new TextDecoder().decode(b.bytes)).toBe('b-content');
    });
});

// === Tests for non-blocking semantics ===

describe('AssetCache.precacheFromManifest() — non-blocking semantics (AC4.5 module half)', () => {
    it('returns a Promise instance', () => {
        vi.stubGlobal('fetch', vi.fn(() => {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ files: [] })
            });
        }));

        const result = globalThis.AssetCache.precacheFromManifest();
        expect(result).toBeInstanceOf(Promise);
    });

    it('fire-and-forget produces real I/O: writes asset record asynchronously without awaiting', async () => {
        const manifest = {
            version: '1.0.0',
            files: [
                { url: '/css/test.css', sha256: 'ABCD' }
            ]
        };

        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.includes('/asset-manifest.json')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(manifest)
                });
            }
            if (url.includes('/css/test.css')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    headers: new Headers({ 'Content-Type': 'text/css' }),
                    arrayBuffer: () => Promise.resolve(new TextEncoder().encode('test').buffer)
                });
            }
            return Promise.reject(new Error('Unexpected URL: ' + url));
        }));

        // Fire-and-forget the call without awaiting it
        void globalThis.AssetCache.precacheFromManifest();

        // Verify synchronously that no record exists yet (fire-and-forget was not awaited)
        let record = await globalThis.AssetCache._internals._getAsset('/css/test.css');
        expect(record).toBeNull();

        // Flush microtask queue to let the promise chain resolve
        await flushPromises();

        // Now verify the record was written asynchronously
        record = await globalThis.AssetCache._internals._getAsset('/css/test.css');
        expect(record).not.toBeNull();
        expect(record.sha256).toBe('ABCD');
        expect(new TextDecoder().decode(record.bytes)).toBe('test');
    });
});

// === Tests for getCachedText and getCachedBlobUrl ===

describe('AssetCache.getCachedText / getCachedBlobUrl', () => {
    it('getCachedText decodes cached bytes as UTF-8', async () => {
        const text = 'body { color: red; }';
        const record = {
            url: '/css/styles.css',
            bytes: new TextEncoder().encode(text).buffer,
            contentType: 'text/css',
            sha256: 'XXXXX',
            etag: null,
            lastModified: null,
            cachedAt: Date.now()
        };
        await globalThis.AssetCache._internals._putAsset(record);

        const retrieved = await globalThis.AssetCache.getCachedText('/css/styles.css');
        expect(retrieved).toBe(text);
    });

    it('getCachedText returns null when no record exists', async () => {
        const result = await globalThis.AssetCache.getCachedText('/missing.css');
        expect(result).toBeNull();
    });

    it('getCachedBlobUrl returns a blob: URL for a cached record', async () => {
        const fakeBlobUrl = 'blob:fake-url-12345';
        const originalCreateObjectURL = URL.createObjectURL;
        const mockCreateObjectURL = vi.fn(() => fakeBlobUrl);

        // Temporarily replace URL.createObjectURL
        URL.createObjectURL = mockCreateObjectURL;

        try {
            const record = {
                url: '/js/foo.js',
                bytes: new TextEncoder().encode('console.log()').buffer,
                contentType: 'application/javascript',
                sha256: 'YYYYY',
                etag: null,
                lastModified: null,
                cachedAt: Date.now()
            };
            await globalThis.AssetCache._internals._putAsset(record);

            const result = await globalThis.AssetCache.getCachedBlobUrl('/js/foo.js');
            expect(result).toBe(fakeBlobUrl);

            // Verify URL.createObjectURL was called with a Blob whose type matches
            expect(mockCreateObjectURL).toHaveBeenCalled();
            const callArgs = mockCreateObjectURL.mock.calls[0];
            expect(callArgs[0]).toBeInstanceOf(Blob);
            expect(callArgs[0].type).toBe('application/javascript');
        } finally {
            // Restore the original
            URL.createObjectURL = originalCreateObjectURL;
        }
    });

    it('getCachedBlobUrl returns null when no record exists', async () => {
        const result = await globalThis.AssetCache.getCachedBlobUrl('/missing.js');
        expect(result).toBeNull();
    });
});
