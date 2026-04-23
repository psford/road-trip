// pattern: Imperative Shell
/**
 * RoadTrip — unified shell-aware lifecycle + origin helper.
 *
 * Idempotent install: re-evaluation (e.g., on a document swap before
 * Phase 3 dedup lands) must not re-register listeners or throw.
 *
 * Public API:
 *   RoadTrip.appOrigin(): string            — "https://app-roadtripmap-prod.azurewebsites.net" in iOS shell, window.location.origin in browser.
 *   RoadTrip.isNativePlatform(): boolean    — sugar over Capacitor.isNativePlatform().
 *   RoadTrip.onPageLoad(pageName, fn): void — run fn on every app:page-load where
 *                                             document.body.dataset.page === pageName
 *                                             (or pageName === '*').
 */
globalThis.RoadTrip ??= {};

(function () {
    const RT = globalThis.RoadTrip;

    // Guard against repeat install (idempotency)
    if (RT._installed) return;
    RT._installed = true;

    const SHELL_ORIGIN = 'https://app-roadtripmap-prod.azurewebsites.net';

    // Has app:page-load fired at least once in this realm?
    // Used so late registrations (after the regular-browser synthesizer already fired)
    // still get a callback via microtask.
    RT._firedOnce = false;
    document.addEventListener('app:page-load', () => { RT._firedOnce = true; });

    function isNative() {
        const cap = globalThis.Capacitor;
        return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
    }

    // Regular-browser-only: bridge the real DOMContentLoaded to our custom event once.
    // In the iOS shell, fetchAndSwap dispatches app:page-load directly; doing it here
    // too would double-fire handlers.
    if (!isNative()) {
        const dispatchAppPageLoad = () => {
            document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', dispatchAppPageLoad, { once: true });
        } else {
            // Already interactive/complete — schedule microtask so any synchronous
            // RoadTrip.onPageLoad() calls made immediately after load register first.
            queueMicrotask(dispatchAppPageLoad);
        }
    }

    RT.appOrigin = function appOrigin() {
        return isNative() ? SHELL_ORIGIN : window.location.origin;
    };

    RT.isNativePlatform = function isNativePlatform() {
        return isNative();
    };

    RT.onPageLoad = function onPageLoad(pageName, fn) {
        if (typeof pageName !== 'string' || typeof fn !== 'function') {
            throw new TypeError('RoadTrip.onPageLoad(pageName: string, fn: function)');
        }
        const handler = function () {
            const currentPage = (document.body && document.body.dataset && document.body.dataset.page) || null;
            if (pageName === '*' || currentPage === pageName) {
                try { fn(); } catch (err) { console.error('[RoadTrip.onPageLoad:' + pageName + ']', err); }
            }
        };
        document.addEventListener('app:page-load', handler);
        // Late-registration catch-up: if the event already fired in this realm
        // (regular browser, script loaded after DOMContentLoaded), schedule one run.
        if (RT._firedOnce) queueMicrotask(handler);
    };
})();
