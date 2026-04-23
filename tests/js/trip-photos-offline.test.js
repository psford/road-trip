import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHED_FETCH_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js'),
    'utf8'
);
const API_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/api.js'),
    'utf8'
);

/**
 * Delete an IndexedDB database by name.
 * Handles both onsuccess and onblocked callbacks with timeout fallback.
 */
async function deleteDb(name) {
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
 * Used to wait for fire-and-forget background operations.
 */
async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
    // Close previous database connection if it exists
    if (globalThis.CachedFetch?._internals?._closeDb) {
        try {
            globalThis.CachedFetch._internals._closeDb();
        } catch (err) {
            // Ignore errors
        }
    }

    // Clean up any previous state
    delete globalThis.CachedFetch;
    delete globalThis.API;

    // Delete the database
    try {
        await deleteDb('RoadTripPageCache');
    } catch (err) {
        // Ignore errors
    }

    // Small delay to ensure cleanup is complete
    await new Promise(r => setTimeout(r, 50));

    // Eval the sources to install globalThis.CachedFetch and globalThis.API with fresh state
    eval(CACHED_FETCH_SRC);

    // Rewrite api.js's top-level const binding for re-eval idempotency (test-harness only).
    const apiEvalable = API_SRC.replace(/^const API = /m, 'globalThis.API = ');
    eval(apiEvalable);
});

afterEach(async () => {
    // Close the database connection before cleaning up
    if (globalThis.CachedFetch?._internals?._closeDb) {
        try {
            globalThis.CachedFetch._internals._closeDb();
        } catch (err) {
            // Ignore errors
        }
    }

    delete globalThis.CachedFetch;
    delete globalThis.API;
});

describe('getTripPhotos offline caching', () => {
    it('AC5.1 — routes through CachedFetch.cachedFetch with { asJson: true } when CachedFetch is present', async () => {
        const photos = [
            { id: '1', caption: 'photo 1', url: 'https://example.com/1.jpg' },
            { id: '2', caption: 'photo 2', url: 'https://example.com/2.jpg' }
        ];

        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify(photos), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const result = await globalThis.API.getTripPhotos('abc-viewtoken');

        // Assert: returned value is the parsed JSON array
        expect(result).toEqual(photos);

        // Assert: IDB api store contains a record keyed by the absolute URL
        const { _internals } = globalThis.CachedFetch;
        const cachedRecord = await _internals._getRecord(
            _internals.STORE_API,
            '/api/trips/view/abc-viewtoken/photos'
        );
        expect(cachedRecord).toBeDefined();
        expect(cachedRecord.body).toBe(JSON.stringify(photos));
    });

    it('AC5.2 — second visit while offline renders cached photos', async () => {
        const photos = [
            { id: '1', caption: 'photo 1', url: 'https://example.com/1.jpg' },
            { id: '2', caption: 'photo 2', url: 'https://example.com/2.jpg' }
        ];

        // First call: seed the cache
        globalThis.fetch = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify(photos), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const result1 = await globalThis.API.getTripPhotos('abc-viewtoken');
        expect(result1).toEqual(photos);

        // Second call: offline (fetch rejects)
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'));

        const result2 = await globalThis.API.getTripPhotos('abc-viewtoken');

        // Assert: returned value equals the previously-cached photos. No rejection.
        expect(result2).toEqual(photos);

        // Flush promises to drain background revalidate
        await flushPromises();

        // Assert: background fetch was attempted (fetch was called)
        expect(globalThis.fetch).toHaveBeenCalled();

        // Assert: IDB state is unchanged (still the old cached record)
        const { _internals } = globalThis.CachedFetch;
        const cachedRecord = await _internals._getRecord(
            _internals.STORE_API,
            '/api/trips/view/abc-viewtoken/photos'
        );
        expect(cachedRecord).toBeDefined();
        expect(cachedRecord.body).toBe(JSON.stringify(photos));
    });

    it('AC5.3 — first visit while offline (cache miss) rejects with a network error', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'));

        // Assert: rejects with TypeError
        const promise = globalThis.API.getTripPhotos('abc-viewtoken');
        await expect(promise).rejects.toThrow(TypeError);

        // Assert: IDB api store has no record for this URL
        const { _internals } = globalThis.CachedFetch;
        const cachedRecord = await _internals._getRecord(
            _internals.STORE_API,
            '/api/trips/view/abc-viewtoken/photos'
        );
        expect(cachedRecord).toBeUndefined();
    });

    it('AC5.4 — online visit after cache-hit triggers background revalidate; cache updates on fresh 200', async () => {
        const photosV1 = [
            { id: '1', caption: 'photo 1', url: 'https://example.com/1.jpg' }
        ];
        const photosV2 = [
            { id: '1', caption: 'photo 1 updated', url: 'https://example.com/1.jpg' },
            { id: '2', caption: 'photo 2', url: 'https://example.com/2.jpg' }
        ];

        // Arrange: seed cache with photos v1 (first online call)
        globalThis.fetch = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify(photosV1), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        await globalThis.API.getTripPhotos('abc-viewtoken');

        // Act: second call with v2 response available
        globalThis.fetch = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify(photosV2), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        const result = await globalThis.API.getTripPhotos('abc-viewtoken');

        // Assert: immediate return is v1 (cache-first)
        expect(result).toEqual(photosV1);

        // Flush promises to wait for background revalidate
        await flushPromises();

        // Assert: IDB record body matches v2 (background revalidate wrote through)
        const { _internals } = globalThis.CachedFetch;
        const cachedRecord = await _internals._getRecord(
            _internals.STORE_API,
            '/api/trips/view/abc-viewtoken/photos'
        );
        expect(cachedRecord.body).toBe(JSON.stringify(photosV2));
    });

    it('regular-browser fallback — when CachedFetch is absent, raw fetch is called', async () => {
        delete globalThis.CachedFetch;

        const photos = [
            { id: '1', caption: 'photo 1', url: 'https://example.com/1.jpg' }
        ];

        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify(photos), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            })
        );

        await globalThis.API.getTripPhotos('xyz');

        // Assert: fetch called exactly once with the absolute URL
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/trips/view/xyz/photos');
    });

    it('regular-browser fallback — non-OK response throws the legacy error', async () => {
        delete globalThis.CachedFetch;

        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response('', { status: 404 })
        );

        await expect(
            globalThis.API.getTripPhotos('xyz')
        ).rejects.toThrow('Failed to load photos');
    });
});

describe('postUI photo-fetch catch copy', () => {
    const OFFLINE_ERROR_SRC = fs.readFileSync(
        path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/offlineError.js'),
        'utf8'
    );

    beforeEach(async () => {
        // Ensure OfflineError is available
        eval(OFFLINE_ERROR_SRC);

        // Stub PostService with listPhotos method
        globalThis.PostService = {
            listPhotos: vi.fn().mockResolvedValue([])
        };

        // Reset postUI's showToast to a spy
        globalThis.PostUI.showToast = vi.fn();

        // Set a valid secret token
        globalThis.PostUI.secretToken = 'test-token';

        // Navigator.onLine should default to true
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            writable: false,
            value: true
        });
    });

    afterEach(() => {
        // Restore navigator.onLine
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            writable: true,
            value: true
        });

        vi.clearAllMocks();
    });

    it('AC5.3 (offline: TypeError path) — toast shows friendly photo copy', async () => {
        // Arrange: PostService.listPhotos rejects with TypeError (network error)
        globalThis.PostService.listPhotos = vi.fn().mockRejectedValue(new TypeError('Load failed'));

        // Act: call loadPhotoList
        await globalThis.PostUI.loadPhotoList();

        // Assert: showToast called exactly once with the friendly offline message
        expect(globalThis.PostUI.showToast).toHaveBeenCalledTimes(1);
        expect(globalThis.PostUI.showToast).toHaveBeenCalledWith(
            'Photos unavailable offline. Reconnect to see the latest.',
            'error'
        );
    });

    it('AC5.3 (navigator.onLine=false path) — same copy even with a non-TypeError', async () => {
        // Arrange: simulate offline
        Object.defineProperty(navigator, 'onLine', {
            configurable: true,
            get: () => false
        });

        // PostService.listPhotos rejects with non-TypeError (e.g., "unknown" error)
        globalThis.PostService.listPhotos = vi.fn().mockRejectedValue(new Error('unknown'));

        // Act: call loadPhotoList
        await globalThis.PostUI.loadPhotoList();

        // Assert: toast shows the friendly offline copy (because navigator.onLine === false)
        expect(globalThis.PostUI.showToast).toHaveBeenCalledTimes(1);
        expect(globalThis.PostUI.showToast).toHaveBeenCalledWith(
            'Photos unavailable offline. Reconnect to see the latest.',
            'error'
        );
    });

    it('Regression — non-offline error preserves its message', async () => {
        // Arrange: navigator.onLine === true, error is not offline-related
        globalThis.PostService.listPhotos = vi.fn().mockRejectedValue(
            new Error('Server exploded')
        );

        // Act: call loadPhotoList
        await globalThis.PostUI.loadPhotoList();

        // Assert: toast shows the original error message (non-offline path)
        expect(globalThis.PostUI.showToast).toHaveBeenCalledTimes(1);
        expect(globalThis.PostUI.showToast).toHaveBeenCalledWith(
            'Server exploded',
            'error'
        );
    });
});
