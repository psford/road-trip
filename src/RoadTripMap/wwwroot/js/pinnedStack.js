// pattern: Imperative Shell
/**
 * PinnedStack — track header height and propagate via CSS variable.
 *
 * Idempotent install: re-evaluation (e.g., on a document swap) must not
 * re-install or throw.
 *
 * Public API:
 *   PinnedStack.install(): void
 *     Measures .pinned-stack height and syncs to --pinned-stack-height CSS variable.
 *     Idempotent: calling multiple times uses the same ResizeObserver.
 *
 *   PinnedStack._installed: boolean
 *     Internal: set to true once the IIFE has executed to prevent double-fire.
 *
 *   PinnedStack._ro: ResizeObserver | undefined
 *     Internal: the ResizeObserver instance, exposed for test inspection.
 */
globalThis.PinnedStack ??= {};

(function () {
    const P = globalThis.PinnedStack;

    // Guard against repeat install (idempotency)
    if (P._installed) return;
    P._installed = true;

    // Stub for now; replaced by Task 2
    P.install = function install() {
        /* Task 2 */
    };

    // Register with RoadTrip.onPageLoad if available
    if (globalThis.RoadTrip && typeof globalThis.RoadTrip.onPageLoad === 'function') {
        globalThis.RoadTrip.onPageLoad('*', function () { P.install(); });
    }
})();
