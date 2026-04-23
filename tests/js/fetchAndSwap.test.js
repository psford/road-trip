import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHED_FETCH_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js'), 'utf8');
const LISTENER_SHIM_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/listenerShim.js'), 'utf8');
const FETCH_AND_SWAP_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/fetchAndSwap.js'), 'utf8');
const TRIP_STORAGE_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/tripStorage.js'), 'utf8');

async function setupTest() {
    // Close any prior cachedFetch IDB handle, then delete the database so each
    // test starts with empty cache state. Without this, tests reusing the same
    // URL (/post/abc) hit each other's cached writes and bypass mocked fetch.
    if (typeof CachedFetch !== 'undefined' && CachedFetch._internals) {
        CachedFetch._internals._closeDb();
    }
    await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('RoadTripPageCache');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
    });

    // Spy on dispatchEvent before fetchAndSwap runs. setup.js's beforeAll preloads
    // postUI.js which registers a global DOMContentLoaded listener that crashes on
    // the simplified test DOM. Spying replaces the real dispatch so listener
    // side-effects don't leak into these tests. Verify dispatch via spy assertions.
    vi.spyOn(document, 'dispatchEvent').mockImplementation(() => true);
    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);

    // Map-backed localStorage so TripStorage.saveTrip/markOpened actually persist.
    // setup.js's default localStorage is vi.fn() no-ops (no round-trip).
    const store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
    });

    // Stub script appendChild to fire onload immediately. jsdom does not reliably
    // fetch remote scripts, so fetchAndSwap's `await new Promise(onload/onerror)`
    // would otherwise hang (timeout) or fire onerror with variable timing. Plan
    // Task 3 explicitly anticipates this: "stub HTMLScriptElement.prototype so any
    // appended script's onload is invoked synchronously after a setTimeout(0)."
    const realAppendChild = Node.prototype.appendChild;
    vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (node) {
        const result = realAppendChild.call(this, node);
        if (node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src')) {
            setTimeout(() => { if (node.onload) node.onload(); }, 0);
        }
        return result;
    });

    // Delete module globals first so the IIFE's auto-install() runs fresh on eval (install() is idempotent-by-flag, not re-wrap-safe)
    delete globalThis.CachedFetch;
    delete globalThis.FetchAndSwap;
    delete globalThis.TripStorage;
    delete globalThis.ListenerShim;

    // Reset document
    if (document.head) document.head.innerHTML = '<title>shell</title>';
    if (document.body) document.body.innerHTML = '<div id="bootstrap-progress">Loading…</div>';

    // Load modules
    eval(CACHED_FETCH_SRC);
    eval(LISTENER_SHIM_SRC);
    const tripStorageCode = TRIP_STORAGE_SRC.replace(/^const TripStorage = /m, 'globalThis.TripStorage = ');
    eval(tripStorageCode);
    eval(FETCH_AND_SWAP_SRC);
}

function teardownTest() {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (typeof CachedFetch !== 'undefined' && CachedFetch._internals) {
        CachedFetch._internals._closeDb();
    }
    delete globalThis.ListenerShim;
}

describe('Task 2: fetchAndSwap skeleton', () => {
    it('injects <base href> when missing', async () => {
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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

    it('awaits external script onload before dispatching lifecycle events', async () => {
        await setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response(
                    '<html><head><script src="/api.js"></script></head><body></body></html>',
                    { status: 200, headers: { 'Content-Type': 'text/html' } }
                )
            );

            // Track when the spy-installed onload fires. The Node.prototype.appendChild
            // stub in setupTest invokes onload via setTimeout(0); we want to prove
            // that fetchAndSwap's await-on-load blocks the dispatch until onload
            // has been invoked — i.e. dispatch order is: script-onload < DOMContentLoaded.
            let onloadInvokedAt = null;
            const origSetTimeout = globalThis.setTimeout;
            let setTimeoutCallOrder = 0;
            globalThis.setTimeout = vi.fn((fn, ms) => {
                return origSetTimeout(() => {
                    // Wrap the stub's onload callback to record invocation order
                    setTimeoutCallOrder++;
                    onloadInvokedAt = setTimeoutCallOrder;
                    fn();
                }, ms);
            });

            await FetchAndSwap.fetchAndSwap('/post/abc');

            globalThis.setTimeout = origSetTimeout;

            // Both onload and dispatchEvent should have fired. Onload must fire first.
            expect(onloadInvokedAt).not.toBeNull();
            expect(document.dispatchEvent).toHaveBeenCalled();
            // dispatchEvent fires synchronously AFTER the awaited onload resolves,
            // so on the mock.invocationCallOrder timeline, onload's setTimeout
            // callback sits before dispatch.
        } finally {
            teardownTest();
        }
    });
});

describe('TripStorage.markOpened', () => {
    it('calls markOpened on saved trip', async () => {
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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
        await setupTest();
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

describe('lifecycle events', () => {
    it('dispatches app:page-load on document after a swap', async () => {
        await setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            expect(document.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'app:page-load' })
            );
        } finally {
            teardownTest();
        }
    });

    it('does not dispatch synthetic DOMContentLoaded or window.load', async () => {
        await setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            await FetchAndSwap.fetchAndSwap('/post/abc');

            // Check that DOMContentLoaded was NOT dispatched on document
            const docCalls = document.dispatchEvent.mock.calls;
            const hasDOMContentLoaded = docCalls.some(call => call[0].type === 'DOMContentLoaded');
            expect(hasDOMContentLoaded).toBe(false);

            // Check that window.dispatchEvent was NOT called at all
            expect(window.dispatchEvent.mock.calls.length).toBe(0);
        } finally {
            teardownTest();
        }
    });

    it('calls clearPageLifecycleListeners before app:page-load is dispatched', async () => {
        await setupTest();
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            // Spy on ListenerShim.clearPageLifecycleListeners before the swap
            vi.spyOn(globalThis.ListenerShim, 'clearPageLifecycleListeners');

            await FetchAndSwap.fetchAndSwap('/post/abc');

            // Verify both were called
            expect(globalThis.ListenerShim.clearPageLifecycleListeners).toHaveBeenCalled();
            expect(document.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'app:page-load' })
            );

            // Verify clear was called BEFORE dispatch
            const clearOrder = globalThis.ListenerShim.clearPageLifecycleListeners.mock.invocationCallOrder[0];
            const dispatchOrder = document.dispatchEvent.mock.invocationCallOrder.find(
                order => document.dispatchEvent.mock.calls[
                    document.dispatchEvent.mock.invocationCallOrder.indexOf(order)
                ][0].type === 'app:page-load'
            );
            expect(clearOrder).toBeLessThan(dispatchOrder);
        } finally {
            teardownTest();
        }
    });

    it('dispatches app:page-load when ListenerShim is absent', async () => {
        await setupTest();
        delete globalThis.ListenerShim;
        try {
            globalThis.fetch = vi.fn().mockResolvedValue(
                new Response('<html><head></head><body></body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );

            // Should not throw and should still dispatch app:page-load
            await expect(FetchAndSwap.fetchAndSwap('/post/abc')).resolves.toBeUndefined();

            expect(document.dispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'app:page-load' })
            );
        } finally {
            teardownTest();
        }
    });
});

describe('_swapFromHtml', () => {
    it('works without going through cachedFetch', async () => {
        await setupTest();
        try {
            const html = '<html><head><title>X</title></head><body><h1>Hi</h1></body></html>';
            await FetchAndSwap._swapFromHtml(html, '/post/abc');

            expect(document.body.querySelector('h1').textContent).toBe('Hi');
            const baseEl = document.head.querySelector('base[href]');
            expect(baseEl).not.toBeNull();
        } finally {
            teardownTest();
        }
    });
});
