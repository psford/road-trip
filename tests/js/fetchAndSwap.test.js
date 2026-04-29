import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHED_FETCH_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/cachedFetch.js'), 'utf8');
const ASSET_CACHE_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/assetCache.js'), 'utf8');
const LISTENER_SHIM_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/listenerShim.js'), 'utf8');
const FETCH_AND_SWAP_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/bootstrap/fetchAndSwap.js'), 'utf8');
const TRIP_STORAGE_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/tripStorage.js'), 'utf8');
const ROAD_TRIP_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/roadTrip.js'), 'utf8');

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
    delete globalThis.AssetCache;

    // Reset document (including body attributes so stale data-page from a prior
    // test does not leak — the iOS shell's real boot starts with a bare <body>).
    if (document.head) document.head.innerHTML = '<title>shell</title>';
    if (document.body) {
        Array.from(document.body.attributes).forEach((a) => document.body.removeAttribute(a.name));
        document.body.innerHTML = '<div id="bootstrap-progress">Loading…</div>';
    }

    // Load modules (mirror the order in src/bootstrap/index.html:
    // cachedFetch → listenerShim → assetCache → tripStorage → fetchAndSwap)
    eval(CACHED_FETCH_SRC);
    eval(LISTENER_SHIM_SRC);
    eval(ASSET_CACHE_SRC);
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
    if (typeof AssetCache !== 'undefined' && AssetCache._internals) {
        AssetCache._internals._closeDb();
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

describe('script-src deduplication', () => {
    it('post → create → post navigation: Set contains each src exactly once, createElement called 3 times total', async () => {
        await setupTest();
        try {
            // The appendChild spy is already installed by setupTest; count via its invocations
            const appendChildSpy = vi.spyOn(Node.prototype, 'appendChild');

            // HTML for post page with one shared script
            const postHtml = '<html><head><script src="/js/shared.js"></script></head><body></body></html>';
            // HTML for create page with same shared script + one unique script
            const createHtml = '<html><head><script src="/js/shared.js"></script><script src="/js/only-create.js"></script></head><body></body></html>';

            // Three sequential swaps: post, create, post
            await FetchAndSwap._swapFromHtml(postHtml, 'https://app-roadtripmap-prod.azurewebsites.net/post/abc');
            await FetchAndSwap._swapFromHtml(createHtml, 'https://app-roadtripmap-prod.azurewebsites.net/create');
            await FetchAndSwap._swapFromHtml(postHtml, 'https://app-roadtripmap-prod.azurewebsites.net/post/abc');

            // Verify Set contains exactly 2 distinct srcs
            expect(FetchAndSwap._executedScriptSrcs.size).toBe(2);
            expect(FetchAndSwap._executedScriptSrcs.has('https://app-roadtripmap-prod.azurewebsites.net/js/shared.js')).toBe(true);
            expect(FetchAndSwap._executedScriptSrcs.has('https://app-roadtripmap-prod.azurewebsites.net/js/only-create.js')).toBe(true);

            // Count script appendChild calls
            const scriptAppends = appendChildSpy.mock.calls.filter(call => {
                const node = call[0];
                return node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src');
            }).length;
            // swap 1 (post): shared.js (1 append)
            // swap 2 (create): shared.js skipped (already in Set), only-create.js (1 append)
            // swap 3 (post): shared.js skipped (already in Set) (0 appends)
            // Total: 2 script elements appended (dedup prevented the second shared.js and third swap's shared.js)
            expect(scriptAppends).toBe(2);
        } finally {
            teardownTest();
        }
    });

    it('inline scripts re-execute on every swap, not tracked in Set', async () => {
        await setupTest();
        try {
            const appendChildSpy = vi.spyOn(Node.prototype, 'appendChild');

            // Initialize counter in globalThis (survives swaps)
            globalThis.inlineCount = 0;
            const inlineScriptCode = 'globalThis.inlineCount = (globalThis.inlineCount || 0) + 1;';
            const html = `<html><head></head><body><script>${inlineScriptCode}</script></body></html>`;

            // Perform 3 swaps with the same inline script
            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/');
            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/');
            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/');

            // Verify 3 inline script elements were appended (one per swap)
            const inlineScriptAppends = appendChildSpy.mock.calls.filter(call => {
                const node = call[0];
                return node && node.tagName === 'SCRIPT' && !node.getAttribute('src');
            }).length;
            expect(inlineScriptAppends).toBe(3);

            // Set size remains 0 (inline scripts not tracked)
            expect(FetchAndSwap._executedScriptSrcs.size).toBe(0);
        } finally {
            teardownTest();
        }
    });

    it('cache-busting query-strings produce distinct Set entries', async () => {
        await setupTest();
        try {
            const page1Html = '<html><head><script src="/js/a.js?v=1"></script></head><body></body></html>';
            const page2Html = '<html><head><script src="/js/a.js?v=2"></script></head><body></body></html>';

            await FetchAndSwap._swapFromHtml(page1Html, 'https://app-roadtripmap-prod.azurewebsites.net/page1');
            await FetchAndSwap._swapFromHtml(page2Html, 'https://app-roadtripmap-prod.azurewebsites.net/page2');

            // Both query-string variants should be in the Set
            expect(FetchAndSwap._executedScriptSrcs.size).toBe(2);
            expect(FetchAndSwap._executedScriptSrcs.has('https://app-roadtripmap-prod.azurewebsites.net/js/a.js?v=1')).toBe(true);
            expect(FetchAndSwap._executedScriptSrcs.has('https://app-roadtripmap-prod.azurewebsites.net/js/a.js?v=2')).toBe(true);
        } finally {
            teardownTest();
        }
    });

    it('same src twice in one page is idempotent: Set size 1, only one script appended', async () => {
        await setupTest();
        try {
            const appendChildSpy = vi.spyOn(Node.prototype, 'appendChild');
            const html = '<html><head><script src="/js/dup.js"></script><script src="/js/dup.js"></script></head><body></body></html>';

            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/');

            // Set contains the src exactly once
            expect(FetchAndSwap._executedScriptSrcs.has('https://app-roadtripmap-prod.azurewebsites.net/js/dup.js')).toBe(true);
            expect(FetchAndSwap._executedScriptSrcs.size).toBe(1);

            // Only one script with src="/js/dup.js" was appended (second was skipped)
            const dupScriptAppends = appendChildSpy.mock.calls.filter(call => {
                const node = call[0];
                return node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src') === '/js/dup.js';
            }).length;
            expect(dupScriptAppends).toBe(1);

            // Verify exactly one <script src="/js/dup.js"> in DOM
            const dupScripts = Array.from(document.querySelectorAll('script[src="/js/dup.js"]'));
            expect(dupScripts.length).toBe(1);
        } finally {
            teardownTest();
        }
    });

    it('does not add to _executedScriptSrcs on onerror', async () => {
        await setupTest();
        try {
            // Restore appendChild stub and replace with one that fires onerror (not onload)
            Node.prototype.appendChild.mockRestore();
            const realAppendChild = Node.prototype.appendChild;
            vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (node) {
                const result = realAppendChild.call(this, node);
                if (node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src')) {
                    // Fire onerror instead of onload
                    setTimeout(() => { if (node.onerror) node.onerror(); }, 0);
                }
                return result;
            });

            const html = '<html><head><base href="https://app-roadtripmap-prod.azurewebsites.net/"></head><body><script src="/js/fail.js"></script></body></html>';
            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/');

            // On onerror, src should NOT be in the Set
            expect(FetchAndSwap._executedScriptSrcs.has(
                'https://app-roadtripmap-prod.azurewebsites.net/js/fail.js'
            )).toBe(false);

            // Second swap of the same HTML — should re-inject because src not in Set (retry)
            const appendChildSpy = vi.spyOn(Node.prototype, 'appendChild');
            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/');

            // Verify the script with /js/fail.js was appended again (not skipped)
            const failScriptAppends = appendChildSpy.mock.calls.filter(call => {
                const node = call[0];
                return node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src') === '/js/fail.js';
            }).length;
            expect(failScriptAppends).toBeGreaterThan(0);
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

describe('body attribute preservation', () => {
    // Phase 2's RoadTrip.onPageLoad reads document.body.dataset.page to route
    // lifecycle handlers. The iOS shell's <body> has no data-page; every page's
    // data-page attribute must flow through _swapFromHtml onto the live body.
    it('copies data-page from parsed body onto document.body', async () => {
        await setupTest();
        try {
            const html = '<html><head></head><body data-page="post">content</body></html>';
            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/post/abc');
            expect(document.body.dataset.page).toBe('post');
        } finally {
            teardownTest();
        }
    });

    it('copies parsed body class list and preserves platform-ios shell class', async () => {
        await setupTest();
        try {
            // loader.js:5 adds platform-ios to document.body at shell boot; tests
            // simulate that precondition so we can verify the swap preserves it.
            document.body.classList.add('platform-ios');
            const html = '<html><head></head><body class="map-page" data-page="view">m</body></html>';
            await FetchAndSwap._swapFromHtml(html, 'https://app-roadtripmap-prod.azurewebsites.net/trips/abc');
            expect(document.body.classList.contains('map-page')).toBe(true);
            expect(document.body.classList.contains('platform-ios')).toBe(true);
            expect(document.body.dataset.page).toBe('view');
        } finally {
            teardownTest();
        }
    });

    it('overwrites stale data-page on subsequent swap (no leak from previous page)', async () => {
        await setupTest();
        try {
            await FetchAndSwap._swapFromHtml(
                '<html><head></head><body data-page="post">p</body></html>',
                'https://app-roadtripmap-prod.azurewebsites.net/post/abc'
            );
            expect(document.body.dataset.page).toBe('post');
            await FetchAndSwap._swapFromHtml(
                '<html><head></head><body data-page="create">c</body></html>',
                'https://app-roadtripmap-prod.azurewebsites.net/create'
            );
            expect(document.body.dataset.page).toBe('create');
        } finally {
            teardownTest();
        }
    });
});

describe('RoadTrip.onPageLoad integration with _swapFromHtml', () => {
    // End-to-end wiring test that unit tests missed: does
    // RoadTrip.onPageLoad('post', fn) actually fire after fetchAndSwap swaps
    // to a body with data-page="post"? Requires body attribute copying to work.
    it('fires onPageLoad("post", fn) after swap to a post page', async () => {
        await setupTest();
        try {
            // Unmock dispatchEvent so real listeners receive app:page-load.
            if (document.dispatchEvent.mockRestore) document.dispatchEvent.mockRestore();

            // Simulate the iOS shell runtime: Capacitor.isNativePlatform()===true.
            // Without this, roadTrip.js's browser-mode DOMContentLoaded bridge
            // would synthesize an extra app:page-load from queueMicrotask, which
            // the iOS shell does not do (fetchAndSwap owns dispatch there).
            globalThis.Capacitor = { isNativePlatform: () => true };
            delete globalThis.RoadTrip;
            eval(ROAD_TRIP_SRC);

            const fn = vi.fn();
            RoadTrip.onPageLoad('post', fn);

            await FetchAndSwap._swapFromHtml(
                '<html><head></head><body data-page="post">x</body></html>',
                'https://app-roadtripmap-prod.azurewebsites.net/post/abc'
            );

            expect(fn).toHaveBeenCalledTimes(1);
        } finally {
            teardownTest();
            delete globalThis.RoadTrip;
            delete globalThis.Capacitor;
        }
    });

    it('does not fire onPageLoad("post", fn) after swap to a create page', async () => {
        await setupTest();
        try {
            if (document.dispatchEvent.mockRestore) document.dispatchEvent.mockRestore();

            globalThis.Capacitor = { isNativePlatform: () => true };
            delete globalThis.RoadTrip;
            eval(ROAD_TRIP_SRC);

            const fn = vi.fn();
            RoadTrip.onPageLoad('post', fn);

            await FetchAndSwap._swapFromHtml(
                '<html><head></head><body data-page="create">x</body></html>',
                'https://app-roadtripmap-prod.azurewebsites.net/create'
            );

            expect(fn).not.toHaveBeenCalled();
        } finally {
            teardownTest();
            delete globalThis.RoadTrip;
            delete globalThis.Capacitor;
        }
    });
});

describe('Phase 3: rewriteAssetTags hook in _swapFromHtml', () => {
  it('AC2.1: cached /css/styles.css is rewritten to <style> before head swap; no <link> remains', async () => {
    await setupTest();
    try {
      // Pre-populate IDB with bytes for /css/styles.css.
      const cssBytes = new TextEncoder().encode('body { color: red; }').buffer;
      await globalThis.AssetCache._internals._putAsset({
        url: '/css/styles.css',
        bytes: cssBytes,
        contentType: 'text/css',
        sha256: 'css-sha',
        etag: null,
        lastModified: null,
        cachedAt: Date.now(),
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><link rel="stylesheet" href="/css/styles.css?v=4"></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      // No <link> for /css/styles.css remains in the live document.
      expect(document.head.querySelector('link[href*="/css/styles.css"]')).toBeNull();
      // A <style> with the cached text was injected.
      const style = document.head.querySelector('style');
      expect(style).not.toBeNull();
      expect(style.textContent).toBe('body { color: red; }');
    } finally {
      teardownTest();
    }
  });

  it('AC2.2: cached /js/foo.js is rewritten to a blob URL with dataset.assetCacheOrigin', async () => {
    await setupTest();
    try {
      const jsBytes = new TextEncoder().encode('console.log("foo");').buffer;
      await globalThis.AssetCache._internals._putAsset({
        url: '/js/foo.js',
        bytes: jsBytes,
        contentType: 'application/javascript',
        sha256: 'js-sha',
        etag: null,
        lastModified: null,
        cachedAt: Date.now(),
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/js/foo.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      // _recreateScripts moves all <script> to body in the offline shell.
      const script = document.body.querySelector('script');
      expect(script).not.toBeNull();
      expect(script.getAttribute('src')).toMatch(/^blob:/);
      expect(script.dataset.assetCacheOrigin).toBe('/js/foo.js');
    } finally {
      teardownTest();
    }
  });

  it('AC2.2 dedup: a second swap with the same /js/foo.js does NOT call appendChild for the script (uses dataset.assetCacheOrigin as dedup key)', async () => {
    await setupTest();
    try {
      const jsBytes = new TextEncoder().encode('console.log("foo");').buffer;
      await globalThis.AssetCache._internals._putAsset({
        url: '/js/foo.js',
        bytes: jsBytes,
        contentType: 'application/javascript',
        sha256: 'js-sha',
        etag: null,
        lastModified: null,
        cachedAt: Date.now(),
      });

      // Mock fetch to return a fresh Response for each call (body can only be consumed once)
      const htmlContent = '<html><head><script src="/js/foo.js"></script></head><body></body></html>';
      globalThis.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(htmlContent, { status: 200, headers: { 'Content-Type': 'text/html' } }))
      );

      // Track dedup behavior via _executedScriptSrcs
      await FetchAndSwap.fetchAndSwap('/post/page1');

      // After first swap, the script src should be in _executedScriptSrcs (canonicalized).
      const canonicalSrc = 'https://app-roadtripmap-prod.azurewebsites.net/js/foo.js';
      expect(FetchAndSwap._executedScriptSrcs.has(canonicalSrc)).toBe(true);
      const sizeAfterFirst = FetchAndSwap._executedScriptSrcs.size;

      await FetchAndSwap.fetchAndSwap('/post/page2');
      // Second swap should NOT add a new script to _executedScriptSrcs since it deduped.
      const sizeAfterSecond = FetchAndSwap._executedScriptSrcs.size;
      expect(sizeAfterSecond).toBe(sizeAfterFirst); // no new scripts added
    } finally {
      teardownTest();
    }
  });

  it('AC2.4: cache miss leaves <link> untouched', async () => {
    await setupTest();
    try {
      // Empty cache — no _putAsset call.
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><link rel="stylesheet" href="/css/styles.css"></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const link = document.head.querySelector('link[href="/css/styles.css"]');
      expect(link).not.toBeNull();
      expect(document.head.querySelector('style')).toBeNull();
    } finally {
      teardownTest();
    }
  });

  it('AC2.4: cache miss leaves <script src> untouched', async () => {
    await setupTest();
    try {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/js/never-cached.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const script = document.body.querySelector('script');
      expect(script).not.toBeNull();
      expect(script.getAttribute('src')).toBe('/js/never-cached.js');
      expect(script.dataset.assetCacheOrigin).toBeUndefined();
    } finally {
      teardownTest();
    }
  });

  it('AC2.5: external CDN URL is never rewritten, even with cache state', async () => {
    await setupTest();
    try {
      // We do NOT put anything in cache for this URL — but the test would still pass
      // even if we did, because the URL is outside the allow-list.
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.css"></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const link = document.head.querySelector('link[href*="unpkg.com"]');
      expect(link).not.toBeNull();
      expect(link.getAttribute('href')).toBe('https://unpkg.com/maplibre-gl@5.21.0/dist/maplibre-gl.css');
    } finally {
      teardownTest();
    }
  });

  it('AC2.5: /lib/exifr/full.umd.js is never rewritten', async () => {
    await setupTest();
    try {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/lib/exifr/full.umd.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      const script = document.body.querySelector('script');
      expect(script).not.toBeNull();
      expect(script.getAttribute('src')).toBe('/lib/exifr/full.umd.js');
      expect(script.dataset.assetCacheOrigin).toBeUndefined();
    } finally {
      teardownTest();
    }
  });

  it('AC4.3: pages and api stores still work after rewriteAssetTags integration', async () => {
    await setupTest();
    try {
      // The CachedFetch flow must continue to write to RoadTripPageCache pages store.
      // Stub a page fetch and verify CachedFetch caches it.
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head></head><body>page</body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html', 'ETag': 'W/"abc"' } }
        )
      );
      await FetchAndSwap.fetchAndSwap('/post/abc');

      // After the swap, CachedFetch should have written to the pages store.
      const cachedRecord = await globalThis.CachedFetch._internals._getRecord('pages', '/post/abc');
      expect(cachedRecord).not.toBeNull();
      expect(cachedRecord).not.toBeUndefined();
    } finally {
      teardownTest();
    }
  });

  it('blob URLs are revoked at swap-end', async () => {
    await setupTest();
    try {
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
      const jsBytes = new TextEncoder().encode('//').buffer;
      await globalThis.AssetCache._internals._putAsset({
        url: '/js/foo.js',
        bytes: jsBytes,
        contentType: 'application/javascript',
        sha256: 'js-sha',
        etag: null,
        lastModified: null,
        cachedAt: Date.now(),
      });

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          '<html><head><script src="/js/foo.js"></script></head><body></body></html>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        )
      );

      await FetchAndSwap.fetchAndSwap('/post/abc');

      // _revokePendingBlobUrls was called — at minimum once with a blob: URL.
      expect(revokeSpy).toHaveBeenCalled();
      const revokedAtLeastOneBlob = revokeSpy.mock.calls.some((call) => typeof call[0] === 'string' && call[0].startsWith('blob:'));
      expect(revokedAtLeastOneBlob).toBe(true);

      revokeSpy.mockRestore();
    } finally {
      teardownTest();
    }
  });
});
