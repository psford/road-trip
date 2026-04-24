import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/roadTrip.js'), 'utf8');

/**
 * Flush all pending promises and microtasks.
 */
async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => queueMicrotask(r));
}

beforeEach(() => {
    // Reset globalThis.RoadTrip completely - delete it so eval can reinstall fresh
    delete globalThis.RoadTrip;
    // Reset document body
    document.body.outerHTML = '<body data-page="home"></body>';
    // Remove any Capacitor mock
    delete globalThis.Capacitor;
    // Eval the source to install the module fresh (starts with _firedOnce = false, _installed = false)
    eval(SOURCE);
    // Verify module is installed correctly
    expect(globalThis.RoadTrip).toBeDefined();
    expect(globalThis.RoadTrip._installed).toBe(true);
    expect(globalThis.RoadTrip._firedOnce).toBe(false);
});

afterEach(() => {
    delete globalThis.RoadTrip;
    delete globalThis.Capacitor;
});

describe('AC2.scope.1 — onPageLoad("post", fn) fires iff data-page === "post"', () => {
    it('runs handler when data-page matches pageName', async () => {
        document.body.dataset.page = 'post';
        const fn = vi.fn();
        // Register handler
        globalThis.RoadTrip.onPageLoad('post', fn);

        // Flush microtasks to let the module's initial app:page-load dispatch fire
        // (in regular browsers with readyState 'complete', the module queues this in beforeEach)
        await flushPromises();

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not run handler when data-page changes to non-matching value', async () => {
        document.body.dataset.page = 'post';
        const fn = vi.fn();
        globalThis.RoadTrip.onPageLoad('post', fn);

        // Flush to get the initial app:page-load
        await flushPromises();
        expect(fn).toHaveBeenCalledTimes(1);

        // Change page and dispatch another event
        document.body.dataset.page = 'create';
        document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));
        await flushPromises();

        // Still only 1 call — the second dispatch didn't match the filter
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('AC2.scope.2 — onPageLoad("*", fn) fires on every dispatch regardless of data-page', () => {
    it('runs handler on every app:page-load regardless of data-page value', async () => {
        const fn = vi.fn();
        globalThis.RoadTrip.onPageLoad('*', fn);

        // Flush the initial microtask app:page-load (from beforeEach) with data-page = 'home'
        await flushPromises();
        expect(fn).toHaveBeenCalledTimes(1);

        // Now dispatch 4 more events with different pages
        const pages = ['create', 'post', 'view', 'map'];
        for (const page of pages) {
            document.body.dataset.page = page;
            document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));
            await flushPromises();
        }

        // 1 from initial + 4 from explicit dispatches = 5 total
        expect(fn).toHaveBeenCalledTimes(5);
    });
});

describe('AC2.scope.3 — In regular browser, onPageLoad("home", fn) fires on initial load via synthesized app:page-load', () => {
    it('synthesizes app:page-load when readyState is "loading"', async () => {
        // Start completely fresh: delete module, Capacitor, and reset DOM
        delete globalThis.RoadTrip;
        delete globalThis.Capacitor;
        // Create minimal DOM with the errorMessage element (needed by postUI)
        document.body.outerHTML = '<body data-page="home"><div id="errorMessage" class="hidden"></div></body>';

        // Force readyState to 'loading' BEFORE eval
        Object.defineProperty(document, 'readyState', {
            configurable: true,
            value: 'loading',
            writable: false
        });

        // Eval the module — it will install a DOMContentLoaded listener
        // because readyState === 'loading'
        eval(SOURCE);

        // Register handler AFTER module install but BEFORE DOMContentLoaded fires
        const fn = vi.fn();
        globalThis.RoadTrip.onPageLoad('home', fn);

        // Dispatch DOMContentLoaded — the module's listener should synthesize app:page-load
        document.dispatchEvent(new Event('DOMContentLoaded'));
        await flushPromises();

        // Handler should have fired because:
        // 1. DOMContentLoaded triggered the bridge
        // 2. Bridge dispatched app:page-load
        // 3. Handler matched 'home' === data-page
        expect(fn).toHaveBeenCalledTimes(1);

        // Restore readyState to its normal value
        Object.defineProperty(document, 'readyState', {
            configurable: true,
            value: 'complete',
            writable: false
        });
    });
});

describe('AC2.scope.4 — postUI handler does NOT fire on /create page', () => {
    it('does not run handler when data-page does not match pageName', async () => {
        document.body.dataset.page = 'create';
        const postInit = vi.fn();
        globalThis.RoadTrip.onPageLoad('post', postInit);

        document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));
        await flushPromises();

        expect(postInit).not.toHaveBeenCalled();
    });
});

describe('AC3.1 — appOrigin() returns baked-in host in iOS shell', () => {
    it('returns shell origin when Capacitor.isNativePlatform() is true', () => {
        delete globalThis.RoadTrip;
        globalThis.Capacitor = { isNativePlatform: vi.fn().mockReturnValue(true) };
        eval(SOURCE);

        expect(globalThis.RoadTrip.appOrigin()).toBe('https://app-roadtripmap-prod.azurewebsites.net');
    });
});

describe('AC3.2 — appOrigin() returns window.location.origin in regular browser', () => {
    it('returns window.location.origin when Capacitor is undefined', () => {
        delete globalThis.RoadTrip;
        delete globalThis.Capacitor;
        eval(SOURCE);

        expect(globalThis.RoadTrip.appOrigin()).toBe(window.location.origin);
    });
});

describe('Late-registration catch-up', () => {
    it('fires handler via microtask when registered after app:page-load has already fired', async () => {
        delete globalThis.RoadTrip;
        delete globalThis.Capacitor;
        document.body.outerHTML = '<body data-page="home"></body>';
        eval(SOURCE);

        // First, dispatch the event to set RT._firedOnce = true
        document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));
        await flushPromises();

        // Now register a handler AFTER the event already fired
        const fn = vi.fn();
        globalThis.RoadTrip.onPageLoad('home', fn);
        await flushPromises();

        // Handler should have been called once via microtask catch-up
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('Idempotent re-install', () => {
    it('does not double-register listeners on re-evaluation', async () => {
        document.body.dataset.page = 'post';
        const fn = vi.fn();
        globalThis.RoadTrip.onPageLoad('post', fn);

        // Flush initial app:page-load from beforeEach
        await flushPromises();
        expect(fn).toHaveBeenCalledTimes(1);

        // Re-eval the source (simulating a script re-execution in a swap)
        // Do NOT delete globalThis.RoadTrip — it should re-install idempotently
        eval(SOURCE);

        // Dispatch app:page-load again
        document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));
        await flushPromises();

        // Handler should only be called once more (1 + 1 = 2 total)
        // Re-eval should not have subscribed a second listener
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('TypeError guard', () => {
    it('throws TypeError when pageName is not a string', () => {
        expect(() => {
            globalThis.RoadTrip.onPageLoad(123, () => {});
        }).toThrow(TypeError);
    });

    it('throws TypeError when fn is not a function', () => {
        expect(() => {
            globalThis.RoadTrip.onPageLoad('post', 'not-a-function');
        }).toThrow(TypeError);
    });
});
