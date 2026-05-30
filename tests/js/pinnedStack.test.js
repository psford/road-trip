import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../src/RoadTripMap/wwwroot/js/pinnedStack.js'), 'utf8');

// pinnedStack.js uses native `globalThis.PinnedStack ??= {}` so we can eval
// the raw source without setup.js's loadGlobal const→globalThis transform.
beforeEach(() => {
    // Reset globalThis.PinnedStack completely - delete it so eval can reinstall fresh
    delete globalThis.PinnedStack;
    // Reset document body and documentElement styles
    document.body.outerHTML = '<body data-page="home"></body>';
    document.documentElement.style.removeProperty('--pinned-stack-height');
    // Eval the source to install the module fresh
    eval(SOURCE);
});

afterEach(() => {
    // Clean up any observers BEFORE deleting the global
    if (globalThis.PinnedStack && globalThis.PinnedStack._ro) {
        globalThis.PinnedStack._ro.disconnect();
    }
    delete globalThis.PinnedStack;
});

describe('PinnedStack', () => {
    describe('AC1.6 — missing-element guard', () => {
        it('does not throw and does not write the var when .pinned-stack is absent', () => {
            document.body.innerHTML = '';
            expect(() => globalThis.PinnedStack.install()).not.toThrow();
            expect(document.documentElement.style.getPropertyValue('--pinned-stack-height')).toBe('');
        });
    });

    describe('AC1.5 — height measurement', () => {
        it('writes a px value to --pinned-stack-height when element is present', () => {
            document.body.innerHTML = '<div class="pinned-stack" style="height: 120px;"></div>';
            globalThis.PinnedStack.install();
            const value = document.documentElement.style.getPropertyValue('--pinned-stack-height');
            expect(value).toMatch(/^\d+px$/);
        });
    });

    describe('AC4.6 — single ResizeObserver across repeated calls', () => {
        it('does not create a second ResizeObserver on repeated install()', () => {
            document.body.innerHTML = '<div class="pinned-stack"></div>';
            globalThis.PinnedStack.install();
            const firstRo = globalThis.PinnedStack._ro;
            expect(firstRo).toBeDefined();

            globalThis.PinnedStack.install();
            const secondRo = globalThis.PinnedStack._ro;
            expect(secondRo).toBe(firstRo);
        });
    });

    describe('Idempotent re-evaluation', () => {
        it('does not double-register with RoadTrip.onPageLoad on re-evaluation', () => {
            document.body.innerHTML = '<div class="pinned-stack"></div>';
            globalThis.PinnedStack.install();

            // Spy on RoadTrip.onPageLoad before the second eval
            const spy = vi.spyOn(globalThis.RoadTrip, 'onPageLoad');

            // Re-eval the source (simulating a script re-execution in a swap)
            eval(SOURCE);

            // The _installed guard should have short-circuited, so onPageLoad should NOT have been called
            expect(spy).not.toHaveBeenCalled();

            // Verify that _installed is still true
            expect(globalThis.PinnedStack._installed).toBe(true);

            spy.mockRestore();
        });
    });
});
