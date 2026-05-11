// pattern: Imperative Shell
/**
 * Native bridge — Capacitor plugin wrapper with web fallbacks.
 *
 * Idempotent install: re-evaluation (e.g., on a document swap) must not
 * re-install or throw.
 *
 * Public API:
 *   Native.haptic(label): Promise<void>
 *   Native.share(payload): Promise<void>
 *   Native.dialogConfirm(payload): Promise<{ value: boolean }>
 *   Native.dialogAlert(payload): Promise<void>
 *   Native.statusBar(intent): Promise<void>
 *   Native.install(): void
 */
globalThis.Native ??= {};

(function () {
    const N = globalThis.Native;

    // Guard against repeat install (idempotency)
    if (N._installed) return;
    N._installed = true;

    // Internal seam for tests to override the dynamic import.
    N._internals = N._internals || { import: (spec) => import(spec) };

    // Detect native platform: true if iOS shell, false if regular browser
    N._isNative = !!(globalThis.RoadTrip && globalThis.RoadTrip.isNativePlatform && globalThis.RoadTrip.isNativePlatform());

    // Haptic feedback with 6 labels: light, medium, heavy (impact) + success, warning, error (notification)
    N.haptic = async function (label) {
        if (!N._isNative) {
            // Web: no-op
            return Promise.resolve();
        }

        try {
            const modules = await N._internals.import('@capacitor/haptics');
            const { Haptics, ImpactStyle, NotificationType } = modules;

            const impactMap = {
                light: ['impact', 'Light'],
                medium: ['impact', 'Medium'],
                heavy: ['impact', 'Heavy']
            };

            const notificationMap = {
                success: ['notification', 'Success'],
                warning: ['notification', 'Warning'],
                error: ['notification', 'Error']
            };

            if (impactMap[label]) {
                const [, style] = impactMap[label];
                return Haptics.impact({ style: ImpactStyle[style] });
            } else if (notificationMap[label]) {
                const [, type] = notificationMap[label];
                return Haptics.notification({ type: NotificationType[type] });
            }

            // Unknown label: silently resolve
            return Promise.resolve();
        } catch (e) {
            // Import failure: swallow and resolve (best-effort)
            return Promise.resolve();
        }
    };

    // Share with fallback to navigator.share or clipboard
    N.share = async function (payload) {
        if (N._isNative) {
            try {
                const modules = await N._internals.import('@capacitor/share');
                const { Share } = modules;
                return Share.share(payload);
            } catch (e) {
                // Plugin import/call failed: fall through to web path
            }
        }

        // Web path: try navigator.share first
        if (typeof navigator.share === 'function') {
            try {
                return await navigator.share(payload);
            } catch (err) {
                // AbortError means user cancelled — resolve silently
                if (err instanceof DOMException && err.name === 'AbortError') {
                    return Promise.resolve();
                }
                // Other errors: continue to clipboard fallback
            }
        }

        // Clipboard fallback if url is present
        if (payload && payload.url && typeof navigator.clipboard?.writeText === 'function') {
            try {
                return await navigator.clipboard.writeText(payload.url);
            } catch (e) {
                // Clipboard error: swallow and resolve silently
                return Promise.resolve();
            }
        }

        return Promise.resolve();
    };

    // Dialog confirm: iOS Dialog.confirm or window.confirm
    N.dialogConfirm = async function (payload) {
        if (N._isNative) {
            try {
                const modules = await N._internals.import('@capacitor/dialog');
                const { Dialog } = modules;
                return Dialog.confirm(payload);
            } catch (e) {
                // Plugin failed: fall through to web path
            }
        }

        // Web path: use window.confirm
        const message = payload && (payload.message || payload.title);
        const result = window.confirm(message || 'Confirm?');
        return Promise.resolve({ value: result });
    };

    // Dialog alert: iOS Dialog.alert or window.alert
    N.dialogAlert = async function (payload) {
        if (N._isNative) {
            try {
                const modules = await N._internals.import('@capacitor/dialog');
                const { Dialog } = modules;
                return Dialog.alert(payload);
            } catch (e) {
                // Plugin failed: fall through to web path
            }
        }

        // Web path: use window.alert
        const message = payload && (payload.message || payload.title);
        window.alert(message || '');
        return Promise.resolve();
    };

    // Status bar style: iOS StatusBar.setStyle with intent-to-Style translation
    // Intent labels: 'dark' = dark text on light bg, 'light' = light text on dark bg
    // Plugin enums: Style.Light = dark text, Style.Dark = light text (inverted!)
    N.statusBar = async function (intent) {
        if (!N._isNative) {
            // Web: no-op
            return Promise.resolve();
        }

        try {
            const modules = await N._internals.import('@capacitor/status-bar');
            const { StatusBar, Style } = modules;

            // Translate intent to plugin Style: 'dark' intent → Style.Light, 'light' intent → Style.Dark
            const styleMap = {
                dark: 'Light',   // dark text on light bg = Style.Light
                light: 'Dark'    // light text on dark bg = Style.Dark
            };

            const styleName = styleMap[intent] || 'Light';
            return StatusBar.setStyle({ style: Style[styleName] });
        } catch (e) {
            // Import or call failure: swallow and resolve (status-bar is cosmetic)
            return Promise.resolve();
        }
    };

    // Explicit install: no-op (the IIFE already completed the install)
    N.install = function () {
        // Already true after IIFE; idempotent reassignment for explicit-call safety.
        N._installed = true;
    };
})();
