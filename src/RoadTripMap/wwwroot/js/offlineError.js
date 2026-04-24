// pattern: Imperative Shell
/**
 * OfflineError — classify network failures and produce friendly copy.
 *
 * Public API:
 *   OfflineError.isOfflineError(err): boolean
 *     Returns true for TypeError (fetch network failure), DOMException
 *     NetworkError, or when navigator.onLine === false regardless of
 *     err shape.
 *
 *   OfflineError.friendlyMessage(err, context): string
 *     Returns a human-readable copy string for a given context. Known
 *     contexts: 'create', 'photos', 'generic'. Unknown contexts fall
 *     back to 'generic'. Non-offline errors fall through to a plain
 *     (err.message || 'Something went wrong.') to preserve diagnostic
 *     detail for validation failures etc.
 */
globalThis.OfflineError ??= {};

(function () {
    const OE = globalThis.OfflineError;
    if (OE._installed) return;
    OE._installed = true;

    const OFFLINE_COPY = {
        create: "Can't create a trip while offline. Try again when you're back online.",
        photos: "Photos unavailable offline. Reconnect to see the latest.",
        generic: "You're offline. Reconnect and try again.",
    };

    OE.isOfflineError = function isOfflineError(err) {
        // navigator.onLine is the strongest signal and wins regardless of err shape
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        // TypeError from fetch is the canonical "network unreachable" in browsers
        if (err instanceof TypeError) return true;
        // DOMException with name 'NetworkError' (WebKit dispatches this for XHR)
        if (err && typeof err === 'object' && err.name === 'NetworkError') return true;
        return false;
    };

    OE.friendlyMessage = function friendlyMessage(err, context) {
        if (OE.isOfflineError(err)) {
            const key = (context && Object.prototype.hasOwnProperty.call(OFFLINE_COPY, context)) ? context : 'generic';
            return OFFLINE_COPY[key];
        }
        return (err && err.message) ? err.message : 'Something went wrong.';
    };
})();
