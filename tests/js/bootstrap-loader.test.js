import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.resolve(__dirname, '../../src/bootstrap');
const SOURCES = {
    cachedFetch: fs.readFileSync(path.join(SHELL, 'cachedFetch.js'), 'utf8'),
    tripStorage: fs.readFileSync(path.join(SHELL, 'tripStorage.js'), 'utf8'),
    fetchAndSwap: fs.readFileSync(path.join(SHELL, 'fetchAndSwap.js'), 'utf8'),
    intercept: fs.readFileSync(path.join(SHELL, 'intercept.js'), 'utf8'),
    loader: fs.readFileSync(path.join(SHELL, 'loader.js'), 'utf8'),
};

let lsStore;
beforeEach(async () => {
    delete globalThis.CachedFetch;
    delete globalThis.TripStorage;
    delete globalThis.FetchAndSwap;
    delete globalThis.Intercept;

    await new Promise((r) => {
        const req = indexedDB.deleteDatabase('RoadTripPageCache');
        req.onsuccess = req.onerror = req.onblocked = () => r();
    });

    lsStore = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
        setItem: (k, v) => { lsStore.set(k, String(v)); },
        removeItem: (k) => { lsStore.delete(k); },
        clear: () => { lsStore.clear(); },
    });

    // Document event mocking - prevent postUI.js DOMContentLoaded from crashing
    const originalDispatchEvent = document.dispatchEvent.bind(document);
    vi.spyOn(document, 'dispatchEvent').mockImplementation((event) => {
        if (event.type === 'DOMContentLoaded' || event.type === 'load') {
            // Don't actually dispatch these events - they trigger postUI.js which crashes on simplified DOM
            return true;
        }
        return originalDispatchEvent(event);
    });

    vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);

    // Script appendChild stub — jsdom doesn't fire onload for remote scripts.
    const realAppendChild = Node.prototype.appendChild;
    vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function (node) {
        const result = realAppendChild.call(this, node);
        if (node && node.tagName === 'SCRIPT' && node.getAttribute && node.getAttribute('src')) {
            setTimeout(() => { if (node.onload) node.onload(); }, 0);
        }
        return result;
    });

    document.head.innerHTML = '<title>shell</title>';
    document.body.innerHTML = '<div id="bootstrap-progress">Loading…</div>';
    document.body.classList.remove('platform-ios');

    // Stub fetch BEFORE evaluating bootstrap modules so they use the stubbed version
    // Default mock returns a rejection so tests that don't set up the mock fail fast
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Mock not configured')));

    // Use eval with proper scope - this ensures all modules see globalThis changes
    eval(SOURCES.cachedFetch);
    const tripStorageCode = SOURCES.tripStorage.replace(/^const TripStorage = /m, 'globalThis.TripStorage = ');
    eval(tripStorageCode);
    eval(SOURCES.fetchAndSwap);
    eval(SOURCES.intercept);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (typeof CachedFetch !== 'undefined' && CachedFetch._internals && CachedFetch._internals._closeDb) {
        CachedFetch._internals._closeDb();
    }
});

async function runLoader() {
    eval(SOURCES.loader);
    // Let the async IIFE run; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
}

describe('boot routing', () => {
    it('AC2.1: 0 saved trips → fetches /', async () => {
        // No trips saved — TripStorage.getDefaultTrip() returns null
        globalThis.fetch = vi.fn().mockImplementation((url) => {
            return Promise.resolve(
                new Response('<html><body>home</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );
        });

        await runLoader();

        // Should fetch '/' as boot URL
        expect(globalThis.fetch).toHaveBeenCalled();
        const firstCall = globalThis.fetch.mock.calls[0];
        expect(firstCall[0]).toBe('/');

        // platform-ios class should be set
        expect(document.body.classList.contains('platform-ios')).toBe(true);

        // Page content should be swapped
        expect(document.body.textContent).toContain('home');
    });

    it('AC2.2: 1+ trips → fetches default trip postUrl', async () => {
        // Save a trip
        TripStorage.saveTrip({
            name: 'Trip A',
            postUrl: '/post/aaa',
            viewUrl: '/trips/aaa',
            createdAt: new Date().getTime(),
            lastOpenedAt: new Date().getTime()
        });

        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>trip-a</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        // Should fetch the trip's postUrl
        expect(globalThis.fetch).toHaveBeenCalled();
        const firstCall = globalThis.fetch.mock.calls[0];
        expect(firstCall[0]).toBe('/post/aaa');

        // Page content should reflect trip
        expect(document.body.textContent).toContain('trip-a');
    });

    it('AC2.2: most-recently-opened wins with multiple trips', async () => {
        // Save three trips with different lastOpenedAt
        const now = Date.now();
        TripStorage.saveTrip({
            name: 'Trip A',
            postUrl: '/post/aaa',
            viewUrl: '/trips/aaa',
            createdAt: now - 6000,
            lastOpenedAt: now - 6000  // Oldest
        });
        TripStorage.saveTrip({
            name: 'Trip B',
            postUrl: '/post/bbb',
            viewUrl: '/trips/bbb',
            createdAt: now - 3000,
            lastOpenedAt: now - 3000  // Middle
        });
        TripStorage.saveTrip({
            name: 'Trip C',
            postUrl: '/post/ccc',
            viewUrl: '/trips/ccc',
            createdAt: now,
            lastOpenedAt: now  // Most recent
        });

        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>trip-c</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        // Should fetch the most recently opened trip
        expect(globalThis.fetch).toHaveBeenCalled();
        const firstCall = globalThis.fetch.mock.calls[0];
        expect(firstCall[0]).toBe('/post/ccc');

        // Page content should reflect that trip
        expect(document.body.textContent).toContain('trip-c');
    });
});

describe('platform-ios + bootstrap-progress', () => {
    it('after successful boot, platform-ios class is set', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        expect(document.body.classList.contains('platform-ios')).toBe(true);
    });

    it('after successful boot, bootstrap-progress is removed', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        // Verify the progress element exists before running loader
        expect(document.getElementById('bootstrap-progress')).not.toBeNull();

        await runLoader();

        // After successful boot, it should be removed
        expect(document.getElementById('bootstrap-progress')).toBeNull();
    });
});

describe('ios.css injection', () => {
    it('after first swap, ios.css link is injected', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        const link = document.head.querySelector('link[data-ios-css]');
        expect(link).not.toBeNull();
        expect(link?.getAttribute('href')).toBe('/ios.css');
        expect(link?.rel).toBe('stylesheet');
    });

    it('after second manual swap, ios.css link still exists', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        // Verify link exists after first swap
        let link = document.head.querySelector('link[data-ios-css]');
        expect(link).not.toBeNull();

        // Perform a second manual swap
        await FetchAndSwap.fetchAndSwap('/post/abc');

        // Link should still exist (re-injected)
        link = document.head.querySelector('link[data-ios-css]');
        expect(link).not.toBeNull();
        expect(link?.getAttribute('href')).toBe('/ios.css');
    });

    it('ios.css link is not duplicated', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        await runLoader();

        // Perform multiple swaps
        await FetchAndSwap.fetchAndSwap('/post/page1');
        await FetchAndSwap.fetchAndSwap('/post/page2');

        // Should only have one link
        const links = document.head.querySelectorAll('link[data-ios-css]');
        expect(links.length).toBe(1);
    });
});

describe('AC3.6: offline + cache miss → fallback.html', () => {
    it('renders fallback.html when boot fetch fails', async () => {
        // First fetch (boot) rejects; second fetch (fallback.html) succeeds
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.reject(new TypeError('Network request failed'));
            }
            return Promise.resolve(
                new Response('<button id="bootstrap-retry">Retry</button>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );
        });

        await runLoader();

        // Fallback content should be rendered
        const retry = document.body.querySelector('#bootstrap-retry');
        expect(retry).not.toBeNull();
    });

    it('retry button reloads the page', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.reject(new TypeError('Network request failed'));
            }
            return Promise.resolve(
                new Response('<button id="bootstrap-retry">Retry</button>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );
        });

        // Mock location.reload
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { ...window.location, reload: vi.fn() }
        });

        await runLoader();

        const retry = document.body.querySelector('#bootstrap-retry');
        expect(retry).not.toBeNull();

        // Click retry and verify reload is called
        retry?.click();

        // Need to let the click handler run
        await new Promise((r) => setTimeout(r, 10));

        expect(window.location.reload).toHaveBeenCalled();
    });

    it('if both fetch calls fail, renders Unable to load fallback', async () => {
        // Both fetch calls reject
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.reject(new TypeError('Network request failed'))
        );

        await runLoader();

        // Should show generic fallback
        expect(document.body.innerHTML).toContain('Unable to load');
    });
});

describe('Intercept install', () => {
    it('after successful boot, Intercept.installIntercept is called', async () => {
        globalThis.fetch = vi.fn().mockImplementation(() =>
            Promise.resolve(
                new Response('<html><body>page</body></html>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            )
        );

        // Spy on Intercept.installIntercept
        const spy = vi.spyOn(Intercept, 'installIntercept');

        await runLoader();

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('after failed boot, Intercept.installIntercept is not called', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.reject(new TypeError('Network request failed'));
            }
            return Promise.resolve(
                new Response('<div>fallback</div>', {
                    status: 200,
                    headers: { 'Content-Type': 'text/html' }
                })
            );
        });

        // Spy on Intercept.installIntercept
        const spy = vi.spyOn(Intercept, 'installIntercept');

        await runLoader();

        expect(spy).not.toHaveBeenCalled();
    });
});
