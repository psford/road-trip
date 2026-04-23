// pattern: Imperative Shell
// ListenerShim: Tracks page-lifecycle listeners (DOMContentLoaded, load) registered on document,
// enabling bulk removal before a new page-load event is dispatched. Prevents stale handlers
// from firing after an iOS-shell document swap.

(function () {
    const TRACKED_EVENTS = new Set(['DOMContentLoaded', 'load']);
    const tracked = new Map();
    let installed = false;
    let _originalAdd = null;
    let _originalRemove = null;

    function install() {
        if (installed) {
            return;
        }

        // Capture the real addEventListener and removeEventListener before wrapping
        _originalAdd = document.addEventListener.bind(document);
        _originalRemove = document.removeEventListener.bind(document);

        // Wrap document.addEventListener to track lifecycle events
        document.addEventListener = function (type, handler, options) {
            if (TRACKED_EVENTS.has(type)) {
                // Initialize the Set for this event type if needed
                if (!tracked.has(type)) {
                    tracked.set(type, new Set());
                }
                // Store { handler, options } tuple
                tracked.get(type).add({ handler, options });
            }
            // Always delegate to the real addEventListener
            _originalAdd(type, handler, options);
        };

        // Wrap document.removeEventListener to track removals
        document.removeEventListener = function (type, handler, options) {
            if (TRACKED_EVENTS.has(type) && tracked.has(type)) {
                // Find and remove the matching entry
                const entries = tracked.get(type);
                for (const entry of entries) {
                    if (entry.handler === handler) {
                        entries.delete(entry);
                        break;
                    }
                }
            }
            // Always delegate to the real removeEventListener
            _originalRemove(type, handler, options);
        };

        installed = true;
    }

    function clearPageLifecycleListeners() {
        if (!installed) {
            return;
        }

        // Iterate through all tracked event types and remove each handler
        for (const [type, entries] of tracked.entries()) {
            // Copy entries to array to avoid iterator invalidation during removal
            const entriesToRemove = Array.from(entries);
            for (const entry of entriesToRemove) {
                // Use the original removeEventListener to bypass our wrapper
                _originalRemove(type, entry.handler, entry.options);
            }
            // Clear the Set for this event type
            entries.clear();
        }
    }

    // Expose the module
    globalThis.ListenerShim = {
        install,
        clearPageLifecycleListeners,
        _internals: {
            TRACKED_EVENTS,
            _tracked: tracked,
            _isInstalled: () => installed,
        },
    };

    // Auto-invoke install() so the wrapper is in place immediately
    install();
})();
