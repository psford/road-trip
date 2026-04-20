import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHED_FETCH_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js'), 'utf8');
const FETCH_AND_SWAP_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/fetchAndSwap.js'), 'utf8');
const TRIP_STORAGE_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/tripStorage.js'), 'utf8');

function setupTest() {
    // Clean up globals
    delete globalThis.CachedFetch;
    delete globalThis.FetchAndSwap;
    delete globalThis.TripStorage;

    // Reset document
    if (document.head) document.head.innerHTML = '<title>shell</title>';
    if (document.body) document.body.innerHTML = '<div id="bootstrap-progress">Loading…</div>';

    // Load modules
    eval(CACHED_FETCH_SRC);
    const tripStorageCode = TRIP_STORAGE_SRC.replace(/^const TripStorage = /m, 'globalThis.TripStorage = ');
    eval(tripStorageCode);
    eval(FETCH_AND_SWAP_SRC);
}

function teardownTest() {
    vi.restoreAllMocks();
    if (typeof CachedFetch !== 'undefined' && CachedFetch._internals) {
        CachedFetch._internals._closeDb();
    }
}

describe('Task 2: fetchAndSwap skeleton', () => {
    it('injects <base href> when missing', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head><title>T</title></head><body>test</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            const baseEl = document.head.querySelector('base');
            expect(baseEl).not.toBeNull();
            expect(baseEl.getAttribute('href')).toBe('https://app-roadtripmap-prod.azurewebsites.net/');
        } finally {
            teardownTest();
        }
    });

    it('preserves existing <base href>', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head><base href="https://custom.com/"><title>T</title></head><body>test</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            const baseEl = document.head.querySelector('base');
            expect(baseEl).not.toBeNull();
            expect(baseEl.getAttribute('href')).toBe('https://custom.com/');
        } finally {
            teardownTest();
        }
    });

    it('swaps document head and body', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head><meta name="test"></head><body><p>new</p></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            // Verify initial state
            expect(document.body.querySelector('#bootstrap-progress')).not.toBeNull();

            await FetchAndSwap.fetchAndSwap('/post/abc');

            // Verify swap happened
            expect(document.body.querySelector('#bootstrap-progress')).toBeNull();
            expect(document.body.querySelector('p')).not.toBeNull();
            expect(document.head.querySelector('meta')).not.toBeNull();
        } finally {
            teardownTest();
        }
    });

    it('rejects on non-OK response', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('not found', { status: 404 })
            );

            await expect(FetchAndSwap.fetchAndSwap('/post/abc')).rejects.toThrow(/HTTP 404/);
        } finally {
            teardownTest();
        }
    });

    it('throws when CachedFetch not loaded', async () => {
        setupTest();
        delete globalThis.CachedFetch;
        eval(FETCH_AND_SWAP_SRC);
        try {
            await expect(FetchAndSwap.fetchAndSwap('/post/abc')).rejects.toThrow(/CachedFetch is not loaded/);
        } finally {
            teardownTest();
        }
    });
});

describe('script recreation', () => {
    it('recreates scripts with src attributes', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response(
                    '<html><head><script src="/api.js"></script></head><body></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html' } }
                )
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            const scripts = Array.from(document.querySelectorAll('script'));
            expect(scripts.length).toBe(1);
            expect(scripts[0].getAttribute('src')).toBe('/api.js');
        } finally {
            teardownTest();
        }
    });

    it('recreates inline scripts', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response(
                    '<html><head></head><body><script>window.x=1;</script></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html' } }
                )
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            const scripts = Array.from(document.querySelectorAll('script'));
            expect(scripts.length).toBe(1);
            expect(scripts[0].textContent).toBe('window.x=1;');
        } finally {
            teardownTest();
        }
    });

    it('preserves script order (head before body)', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response(
                    '<html><head><script src="/a.js"></script></head><body><script src="/b.js"></script></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html' } }
                )
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            const scripts = Array.from(document.querySelectorAll('script'));
            expect(scripts.length).toBe(2);
            expect(scripts[0].getAttribute('src')).toBe('/a.js');
            expect(scripts[1].getAttribute('src')).toBe('/b.js');
        } finally {
            teardownTest();
        }
    });

    it('handles zero scripts', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response(
                    '<html><head></head><body><p>no scripts</p></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html' } }
                )
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            expect(document.querySelectorAll('script').length).toBe(0);
        } finally {
            teardownTest();
        }
    });
});

describe('TripStorage.markOpened', () => {
    it('calls markOpened on saved trip', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            TripStorage.saveTrip('Trip A', '/post/abc', '/trips/view-abc');
            const before = TripStorage.getTrips()[0].lastOpenedAt;

            await FetchAndSwap.fetchAndSwap('/post/abc');

            const after = TripStorage.getTrips()[0].lastOpenedAt;
            expect(after).not.toEqual(before);
            expect(typeof after).toBe('number');
        } finally {
            teardownTest();
        }
    });

    it('handles markOpened for URL not in storage', async () => {
        setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            // URL not saved - markOpened returns false but doesn't throw
            await expect(FetchAndSwap.fetchAndSwap('/post/unknown')).resolves.toBeUndefined();
        } finally {
            teardownTest();
        }
    });

    it('handles missing TripStorage gracefully', async () => {
        setupTest();
        delete globalThis.TripStorage;
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            await expect(FetchAndSwap.fetchAndSwap('/post/abc')).resolves.toBeUndefined();
        } finally {
            teardownTest();
        }
    });

    it('handles markOpened throwing', async () => {
        setupTest();
        try {
            globalThis.TripStorage = {
                markOpened: () => { throw new Error('storage error'); }
            };

            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            // Should not throw
            await expect(FetchAndSwap.fetchAndSwap('/post/abc')).resolves.toBeUndefined();
        } finally {
            teardownTest();
        }
    });
});
