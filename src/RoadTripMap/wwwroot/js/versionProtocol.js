/**
 * Client Version Protocol
 * Monitors API response headers for version mismatches and fires reload event
 * Implements AC8.2 (reload event on version mismatch) and AC8.3 (graceful missing headers)
 */

const VersionProtocol = {
    currentClientVersion: null,
    reloadFired: false,
    originalFetch: null,

    /**
     * Compare two semantic versions (X.Y.Z format)
     * @param {string} a - First version
     * @param {string} b - Second version
     * @returns {number} -1 if a < b, 0 if a === b, 1 if a > b
     */
    compareSemver(a, b) {
        const parseVersion = (v) => {
            const parts = v.split('.').map(p => parseInt(p, 10));
            return {
                major: parts[0] || 0,
                minor: parts[1] || 0,
                patch: parts[2] || 0
            };
        };

        const vA = parseVersion(a);
        const vB = parseVersion(b);

        // Compare major
        if (vA.major !== vB.major) {
            return vA.major < vB.major ? -1 : 1;
        }

        // Compare minor
        if (vA.minor !== vB.minor) {
            return vA.minor < vB.minor ? -1 : 1;
        }

        // Compare patch
        if (vA.patch !== vB.patch) {
            return vA.patch < vB.patch ? -1 : 1;
        }

        return 0;
    },

    /**
     * Fire version reload required event (once only)
     * @param {string} serverVersion - Server version from header
     * @param {string} clientMin - Minimum required client version
     */
    dispatchReload(serverVersion, clientMin) {
        if (this.reloadFired) {
            return;
        }

        this.reloadFired = true;

        document.dispatchEvent(new CustomEvent('version:reload-required', {
            detail: {
                serverVersion,
                clientMin,
                currentVersion: this.currentClientVersion
            }
        }));
    },

    /**
     * Wrap fetch to inspect response headers
     */
    wrapFetch() {
        this.originalFetch = globalThis.fetch;

        globalThis.fetch = async (...args) => {
            // Call original fetch
            const response = await this.originalFetch.apply(globalThis, args);

            // Only check headers if we have a current version
            if (this.currentClientVersion === null) {
                return response;
            }

            // Get headers (case-insensitive access via Headers object)
            const headers = response.headers;
            const serverVersion = headers.get('x-server-version');
            const clientMin = headers.get('x-client-min-version');

            // If either header is missing, skip check (AC8.3)
            if (!serverVersion || !clientMin) {
                return response;
            }

            // Check if client version is below required minimum (AC8.2)
            if (this.compareSemver(this.currentClientVersion, clientMin) < 0) {
                this.dispatchReload(serverVersion, clientMin);
            }

            return response;
        };
    },

    /**
     * Initialize the version protocol on page load
     */
    init() {
        // Read client version from meta tag
        const metaTag = document.querySelector('meta[name=client-version]');
        if (!metaTag) {
            console.warn('Client version meta tag not found; version checking disabled');
            this.currentClientVersion = null;
            return;
        }

        this.currentClientVersion = metaTag.content;

        // Wrap fetch to monitor responses
        this.wrapFetch();
    }
};

// Auto-initialize on every page load (cross-cutting). RoadTrip.onPageLoad
// handles the already-loaded case via a microtask catch-up on late registration.
RoadTrip.onPageLoad('*', () => {
    VersionProtocol.init();
});
