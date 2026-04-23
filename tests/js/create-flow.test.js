import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read create.html and extract the inline script body
const CREATE_HTML_PATH = path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/create.html');
const CREATE_HTML = fs.readFileSync(CREATE_HTML_PATH, 'utf8');

// Extract the inline script content between <script> tags (the submit handler)
const scriptMatch = CREATE_HTML.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
if (!scriptMatch) {
    throw new Error('Could not find inline script in create.html');
}

const INLINE_SCRIPT = scriptMatch[1];

// Load module sources for offline tests
const ROAD_TRIP_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/roadTrip.js'), 'utf8');
const OFFLINE_ERROR_SRC = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/offlineError.js'), 'utf8');

// Shared setup for happy-path tests (no module loads to avoid test isolation)
const setupHappyPath = () => {
    // Clear globals
    delete globalThis.API;
    delete globalThis.TripStorage;
    delete globalThis.FetchAndSwap;

    // Mock DOM
    document.body.innerHTML = `
        <div id="errorMessage" class="message error hidden"></div>
        <form id="createTripForm">
            <input type="text" id="tripName" name="name" value="Test Trip" />
            <textarea id="tripDescription" name="description">Test Description</textarea>
            <button type="submit" id="createButton">Create Trip</button>
        </form>
    `;
};

// Setup for offline tests (includes module loads)
const setupOfflineTests = () => {
    // Clear globals and module caches
    delete globalThis.API;
    delete globalThis.TripStorage;
    delete globalThis.FetchAndSwap;
    delete globalThis.RoadTrip;
    delete globalThis.OfflineError;

    // Mock DOM with page marker
    document.body.innerHTML = `
        <div id="errorMessage" class="message error hidden"></div>
        <form id="createTripForm">
            <input type="text" id="tripName" name="name" value="Test Trip" />
            <textarea id="tripDescription" name="description">Test Description</textarea>
            <button type="submit" id="createButton">Create Trip</button>
        </form>
    `;
    document.body.dataset.page = 'create';

    // Load modules BEFORE inline script
    eval(ROAD_TRIP_SRC);
    eval(OFFLINE_ERROR_SRC);
};

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.RoadTrip;
    delete globalThis.OfflineError;
    // Restore navigator.onLine to default (true)
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: true
    });
});

describe('create-flow', () => {
    describe('happy path', () => {
        beforeEach(() => setupHappyPath());

        it('Browser branch (FetchAndSwap undefined) → window.location.href setter called', async () => {
            // Set up API and TripStorage mocks
            globalThis.API = {
                createTrip: vi.fn().mockResolvedValue({
                    postUrl: '/post/test-token',
                    viewUrl: '/trips/view-token'
                })
            };

            globalThis.TripStorage = {
                saveTrip: vi.fn().mockResolvedValue(undefined)
            };

            // FetchAndSwap is NOT defined
            delete globalThis.FetchAndSwap;

            // Mock window.location.href setter
            let hrefSetValue = null;
            const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: {
                    href: 'http://localhost/create',
                    get href() { return this._href; },
                    set href(val) { hrefSetValue = val; }
                }
            });

            // Eval the script in this scope
            eval(INLINE_SCRIPT);

            // Trigger the form submit
            const form = document.getElementById('createTripForm');
            const evt = new SubmitEvent('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(evt);

            // Await async operations
            await new Promise(r => setTimeout(r, 20));

            // Verify FetchAndSwap was never called and window.location.href was set
            expect(hrefSetValue).toBe('/post/test-token');

            // Cleanup
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: originalDescriptor.value
            });
        });

        it('Shell branch (FetchAndSwap defined) → FetchAndSwap.fetchAndSwap called, window.location.href NOT called', async () => {
            // Set up API and TripStorage mocks
            globalThis.API = {
                createTrip: vi.fn().mockResolvedValue({
                    postUrl: '/post/test-token',
                    viewUrl: '/trips/view-token'
                })
            };

            globalThis.TripStorage = {
                saveTrip: vi.fn().mockResolvedValue(undefined)
            };

            // FetchAndSwap IS defined
            globalThis.FetchAndSwap = {
                fetchAndSwap: vi.fn().mockResolvedValue(undefined)
            };

            // Mock window.location.href setter to detect any calls
            let hrefSetValue = null;
            const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: {
                    href: 'http://localhost/create',
                    pathname: '/create',
                    search: '',
                    get href() { return this._href || 'http://localhost/create'; },
                    set href(val) { hrefSetValue = val; }
                }
            });

            // Mock history.pushState
            vi.spyOn(history, 'pushState').mockImplementation(() => {});

            // Eval the script in this scope
            eval(INLINE_SCRIPT);

            // Trigger the form submit
            const form = document.getElementById('createTripForm');
            const evt = new SubmitEvent('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(evt);

            // Await async operations
            await new Promise(r => setTimeout(r, 20));

            // Verify FetchAndSwap.fetchAndSwap was called and window.location.href was NOT set
            expect(FetchAndSwap.fetchAndSwap).toHaveBeenCalledWith('/post/test-token');
            expect(hrefSetValue).toBeNull();
            // pushState receives a same-origin absolute URL; only the path portion is stable.
            expect(history.pushState).toHaveBeenCalledWith(
                {},
                '',
                expect.stringMatching(/\/post\/test-token$/)
            );

            // Cleanup
            Object.defineProperty(window, 'location', {
                configurable: true,
                value: originalDescriptor.value
            });
        });
    });

    describe('offline submit', () => {
        beforeEach(() => setupOfflineTests());

        it('AC4.3 (offline: TypeError path) — renders the friendly copy', async () => {
            // Arrange: TypeError from fetch indicates offline
            globalThis.API = {
                createTrip: vi.fn().mockRejectedValue(new TypeError('Load failed'))
            };

            globalThis.TripStorage = {
                saveTrip: vi.fn().mockResolvedValue(undefined)
            };

            // Eval the script with modules loaded
            eval(INLINE_SCRIPT);

            // Act: Submit the form
            const form = document.getElementById('createTripForm');
            const evt = new SubmitEvent('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(evt);

            // Await async operations
            await new Promise(r => setTimeout(r, 20));

            // Assert: Friendly offline message is displayed
            const errorEl = document.getElementById('errorMessage');
            expect(errorEl.textContent).toBe("Can't create a trip while offline. Try again when you're back online.");
            expect(errorEl.classList.contains('hidden')).toBe(false);

            // Assert: Button re-enabled with original text
            const btn = document.getElementById('createButton');
            expect(btn.disabled).toBe(false);
            expect(btn.textContent).toBe('Create Trip');
        });

        it('AC4.3 (offline: navigator.onLine === false path) — renders the friendly copy regardless of error shape', async () => {
            // Arrange: Stub navigator.onLine to false (offline signal)
            Object.defineProperty(navigator, 'onLine', {
                configurable: true,
                value: false
            });

            globalThis.API = {
                createTrip: vi.fn().mockRejectedValue(new Error('Any non-TypeError'))
            };

            globalThis.TripStorage = {
                saveTrip: vi.fn().mockResolvedValue(undefined)
            };

            // Eval the script with modules loaded
            eval(INLINE_SCRIPT);

            // Act: Submit the form
            const form = document.getElementById('createTripForm');
            const evt = new SubmitEvent('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(evt);

            // Await async operations
            await new Promise(r => setTimeout(r, 20));

            // Assert: Friendly offline message is displayed
            const errorEl = document.getElementById('errorMessage');
            expect(errorEl.textContent).toBe("Can't create a trip while offline. Try again when you're back online.");
            expect(errorEl.classList.contains('hidden')).toBe(false);
        });

        it('Regression — non-offline validation error still shows its original message', async () => {
            // Arrange: Validation error with navigator.onLine === true (online)
            // Explicitly restore navigator.onLine to true
            Object.defineProperty(navigator, 'onLine', {
                configurable: true,
                value: true
            });

            globalThis.API = {
                createTrip: vi.fn().mockRejectedValue(
                    Object.assign(new Error('Trip name required'), { name: 'ValidationError', status: 400 })
                )
            };

            globalThis.TripStorage = {
                saveTrip: vi.fn().mockResolvedValue(undefined)
            };

            // Eval the script with modules loaded
            eval(INLINE_SCRIPT);

            // Act: Submit the form
            const form = document.getElementById('createTripForm');
            const evt = new SubmitEvent('submit', { bubbles: true, cancelable: true });
            form.dispatchEvent(evt);

            // Await async operations
            await new Promise(r => setTimeout(r, 20));

            // Assert: Original validation message is preserved
            const errorEl = document.getElementById('errorMessage');
            expect(errorEl.textContent).toBe('Trip name required');
        });
    });
});
