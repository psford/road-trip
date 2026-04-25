/**
 * Regression test for versionProtocol.wrapFetch idempotency.
 *
 * Phase 2 of the iOS shell hardening plan migrated VersionProtocol.init()
 * from a one-shot DOMContentLoaded registration onto RoadTrip.onPageLoad('*', ...).
 * That made init re-fire on every cross-page swap — and wrapFetch()'s original
 * form stacked wrappers on each call, producing "Maximum call stack size
 * exceeded" inside any fetch chain a few navigations deep (postUI.loadTripInfo
 * → cachedFetch → fetch wrapper → previous wrapper → itself → itself → ...).
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

describe('VersionProtocol.wrapFetch idempotency', () => {
    let savedFetch;
    let savedRoadTrip;
    let savedVersionProtocol;
    let savedQuerySelector;

    beforeEach(() => {
        savedFetch = globalThis.fetch;
        savedRoadTrip = globalThis.RoadTrip;
        savedVersionProtocol = globalThis.VersionProtocol;
        savedQuerySelector = document.querySelector;

        // Stub RoadTrip so the module-bottom `RoadTrip.onPageLoad('*', ...)`
        // call doesn't throw during eval. We invoke init() manually per test.
        globalThis.RoadTrip = { onPageLoad: vi.fn() };

        // Pretend the current page has a <meta name="client-version">. Without
        // this, init returns early and wrapFetch never runs.
        document.querySelector = vi.fn().mockReturnValue({ content: '1.0.0' });

        // Fresh fetch we can assert against. Track invocation count.
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response('', { status: 200, headers: { 'Content-Type': 'text/plain' } })
        );

        delete globalThis.VersionProtocol;
        const evalable = VERSION_PROTOCOL_SRC.replace(/^const VersionProtocol = /m, 'globalThis.VersionProtocol = ');
        eval(evalable);
    });

    afterEach(() => {
        globalThis.fetch = savedFetch;
        globalThis.RoadTrip = savedRoadTrip;
        globalThis.VersionProtocol = savedVersionProtocol;
        document.querySelector = savedQuerySelector;
    });

    it('calling init() multiple times does not stack fetch wrappers', async () => {
        const nativeFetch = globalThis.fetch;

        globalThis.VersionProtocol.init();
        const wrapperAfterFirst = globalThis.fetch;
        expect(wrapperAfterFirst).not.toBe(nativeFetch);
        expect(globalThis.VersionProtocol.originalFetch).toBe(nativeFetch);

        // Simulate the iOS shell re-firing app:page-load after a cross-page swap.
        globalThis.VersionProtocol.init();
        expect(globalThis.fetch).toBe(wrapperAfterFirst);
        expect(globalThis.VersionProtocol.originalFetch).toBe(nativeFetch);

        globalThis.VersionProtocol.init();
        expect(globalThis.fetch).toBe(wrapperAfterFirst);
        expect(globalThis.VersionProtocol.originalFetch).toBe(nativeFetch);
    });

    it('fetch still works after many init() calls (no RangeError)', async () => {
        const nativeFetch = globalThis.fetch;

        // Simulate many page swaps in a row.
        for (let i = 0; i < 10; i++) {
            globalThis.VersionProtocol.init();
        }

        // Calling fetch must hit the native fetch once — not recurse through a
        // wrapper stack. Pre-fix this throws RangeError after enough init calls.
        const response = await globalThis.fetch('/api/trips/view/x/photos');
        expect(response.status).toBe(200);
        expect(nativeFetch).toHaveBeenCalledTimes(1);
    });
});
