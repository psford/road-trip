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

    P.install = function install() {
        // Short-circuit on missing element (AC1.6)
        const el = document.querySelector('.pinned-stack');
        if (!el) return;

        // Writes initial height synchronously before first paint
        const writeHeight = function () {
            const h = Math.round(el.getBoundingClientRect().height);
            document.documentElement.style.setProperty('--pinned-stack-height', h + 'px');
        };
        writeHeight();

        // Attaches ResizeObserver once (AC4.6 — P._ro is owned by the module and not recreated)
        if (P._ro) {
            P._ro.disconnect();
            P._ro.observe(el);
            return;
        }
        P._ro = new ResizeObserver(function () { writeHeight(); });
        P._ro.observe(el);
    };

    // Register with RoadTrip.onPageLoad if available
    if (globalThis.RoadTrip && typeof globalThis.RoadTrip.onPageLoad === 'function') {
        globalThis.RoadTrip.onPageLoad('*', function () { P.install(); });
    }
})();
