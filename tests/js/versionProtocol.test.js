/**
 * Version Protocol Tests
 * Verifies AC8.2 (reload event on client version mismatch) and AC8.3 (graceful missing headers)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION_PROTOCOL_SRC = fs.readFileSync(
    path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/versionProtocol.js'),
    'utf8'
);

// Eval the module into globalThis and run init(). Phase 2 migrated the
// module-bottom auto-init from a raw `DOMContentLoaded` listener onto
// `RoadTrip.onPageLoad('*', ...)`, so RoadTrip must be stubbed before the
// module's own bottom call runs, and init() must be called manually because
// the onPageLoad handler doesn't fire on its own in this test harness.
function loadAndInit() {
    delete globalThis.VersionProtocol;
    if (!globalThis.RoadTrip) {
        globalThis.RoadTrip = { onPageLoad: vi.fn() };
    }
    const evalable = VERSION_PROTOCOL_SRC.replace(/^const VersionProtocol = /m, 'globalThis.VersionProtocol = ');
    eval(evalable);
    globalThis.VersionProtocol.init();
}

describe('VersionProtocol', () => {
    let reloadRequiredFired;
    let reloadRequiredDetail;
    let originalFetch;
    let originalDispatchEvent;

    beforeEach(() => {
        // Reset module state by removing it from globalThis
        delete globalThis.VersionProtocol;
        delete globalThis.RoadTrip;

        // Clear any listeners
        reloadRequiredFired = false;
        reloadRequiredDetail = null;

        // Mock document.querySelector for meta tag
        const metaTag = {
            content: '1.0.0'
        };
        vi.spyOn(document, 'querySelector').mockReturnValue(metaTag);

        // Mock document.dispatchEvent to capture events
        originalDispatchEvent = document.dispatchEvent;
        document.dispatchEvent = vi.fn(function(event) {
            if (event.type === 'version:reload-required') {
                reloadRequiredFired = true;
                reloadRequiredDetail = event.detail;
            }
            return true;
        });

        // Store original fetch
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        // Restore original fetch
        globalThis.fetch = originalFetch;

        // Restore document methods
        document.querySelector.mockRestore();
        document.dispatchEvent = originalDispatchEvent;

        // Clean up
        delete globalThis.VersionProtocol;
        delete globalThis.RoadTrip;
    });

    it('reads client version from meta tag on load', () => {
        loadAndInit();

        expect(globalThis.VersionProtocol).toBeDefined();
        expect(globalThis.VersionProtocol.currentClientVersion).toBe('1.0.0');
    });

    it('does not fire event when headers are missing', async () => {
        // Mock fetch to return response without headers
        globalThis.fetch = vi.fn(async (url, opts) => ({
            ok: true,
            status: 200,
            headers: new Headers({}),
            json: async () => ({})
        }));

        loadAndInit();

        // Make a fetch call
        await fetch('/api/test');

        // Event should not fire
        expect(reloadRequiredFired).toBe(false);
    });

    it('fires reload-required event when client version < client-min-version', async () => {
        // Mock fetch to return response with version headers
        globalThis.fetch = vi.fn(async (url, opts) => ({
            ok: true,
            status: 200,
            headers: new Headers({
                'x-server-version': '2.0.0',
                'x-client-min-version': '1.1.0'
            }),
            json: async () => ({})
        }));

        loadAndInit();

        // Make a fetch call
        await fetch('/api/test');

        // Event should fire
        expect(reloadRequiredFired).toBe(true);
        expect(reloadRequiredDetail).toBeDefined();
        expect(reloadRequiredDetail.serverVersion).toBe('2.0.0');
        expect(reloadRequiredDetail.clientMin).toBe('1.1.0');
        expect(reloadRequiredDetail.currentVersion).toBe('1.0.0');
    });

    it('does not fire event when client version >= client-min-version', async () => {
        // Mock fetch to return response with version headers where client is sufficient
        globalThis.fetch = vi.fn(async (url, opts) => ({
            ok: true,
            status: 200,
            headers: new Headers({
                'x-server-version': '2.0.0',
                'x-client-min-version': '1.0.0'
            }),
            json: async () => ({})
        }));

        loadAndInit();

        // Make a fetch call
        await fetch('/api/test');

        // Event should not fire
        expect(reloadRequiredFired).toBe(false);
    });

    it('fires reload-required event only once', async () => {
        let fireCount = 0;
        document.dispatchEvent = vi.fn(function(event) {
            if (event.type === 'version:reload-required') {
                fireCount++;
                reloadRequiredFired = true;
                reloadRequiredDetail = event.detail;
            }
            return true;
        });

        // Mock fetch to return response with version mismatch
        globalThis.fetch = vi.fn(async (url, opts) => ({
            ok: true,
            status: 200,
            headers: new Headers({
                'x-server-version': '2.0.0',
                'x-client-min-version': '1.1.0'
            }),
            json: async () => ({})
        }));

        loadAndInit();

        // Make multiple fetch calls
        await fetch('/api/test1');
        await fetch('/api/test2');
        await fetch('/api/test3');

        // Event should fire only once
        expect(fireCount).toBe(1);
    });

    it('handles case-insensitive headers correctly', async () => {
        // Mock fetch to return response with mixed-case headers
        globalThis.fetch = vi.fn(async (url, opts) => ({
            ok: true,
            status: 200,
            headers: new Headers({
                'X-Server-Version': '2.0.0',
                'X-Client-Min-Version': '1.1.0'
            }),
            json: async () => ({})
        }));

        loadAndInit();

        // Make a fetch call
        await fetch('/api/test');

        // Event should fire (headers should be case-insensitive)
        expect(reloadRequiredFired).toBe(true);
    });

    it('disables version check when meta tag is missing', () => {
        // Mock querySelector to return null (no meta tag)
        document.querySelector.mockReturnValue(null);

        loadAndInit();

        // Module should load without error
        expect(globalThis.VersionProtocol).toBeDefined();
        // currentClientVersion should be null
        expect(globalThis.VersionProtocol.currentClientVersion).toBeNull();
    });

    it('compareSemver returns correct values', () => {
        loadAndInit();

        // Test compareSemver
        expect(globalThis.VersionProtocol.compareSemver('1.0.0', '1.0.0')).toBe(0);
        expect(globalThis.VersionProtocol.compareSemver('1.0.0', '2.0.0')).toBe(-1);
        expect(globalThis.VersionProtocol.compareSemver('2.0.0', '1.0.0')).toBe(1);
        expect(globalThis.VersionProtocol.compareSemver('1.1.0', '1.0.0')).toBe(1);
        expect(globalThis.VersionProtocol.compareSemver('1.0.1', '1.0.0')).toBe(1);
    });
});
