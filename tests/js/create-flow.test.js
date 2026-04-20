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

beforeEach(() => {
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
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('create-flow', () => {
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
        expect(history.pushState).toHaveBeenCalledWith({}, '', '/post/test-token');

        // Cleanup
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: originalDescriptor.value
        });
    });
});
