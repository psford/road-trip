// pattern: Imperative Shell
/**
 * Trip Storage - localStorage persistence for "My Trips"
 * Stores trip URLs so users can return to them without saving UUIDs.
 *
 * Idempotent install: the iOS shell loads src/bootstrap/tripStorage.js at boot
 * and also re-injects the wwwroot copy via fetchAndSwap on cross-page swaps,
 * so a top-level `const TripStorage = ...` would throw `Can't create duplicate
 * variable: 'TripStorage'` on the second injection. The `globalThis.X ??= {}`
 * pattern + `_installed` guard short-circuits re-execution safely.
 */
globalThis.TripStorage ??= {};

(function () {
    const TS = globalThis.TripStorage;
    if (TS._installed) return;
    TS._installed = true;

    TS.STORAGE_KEY = 'roadtripmap_trips';

    /**
     * Get all saved trips
     * @returns {Array<{name: string, postUrl: string, viewUrl: string, savedAt: string}>}
     */
    TS.getTrips = function getTrips() {
        try {
            return JSON.parse(localStorage.getItem(TS.STORAGE_KEY)) || [];
        } catch {
            return [];
        }
    };

    /**
     * Save a trip. Deduplicates by postUrl.
     * @param {string} name - Trip name
     * @param {string} postUrl - Upload/post URL path
     * @param {string} viewUrl - View URL path
     */
    TS.saveTrip = function saveTrip(name, postUrl, viewUrl) {
        const trips = TS.getTrips();
        const existing = trips.findIndex(t => t.postUrl === postUrl);
        const entry = { name, postUrl, viewUrl, savedAt: new Date().toISOString() };

        if (existing >= 0) {
            trips[existing] = entry;
        } else {
            trips.unshift(entry);
        }

        try {
            localStorage.setItem(TS.STORAGE_KEY, JSON.stringify(trips));
        } catch {
            // localStorage full or unavailable — silent fail
        }
    };

    /**
     * Save a trip when we only have the secret token (post page visit).
     * Fetches trip info from the API to get the name and view URL.
     * @param {string} secretToken - The post secret token
     */
    TS.saveFromPostPage = async function saveFromPostPage(secretToken) {
        const postUrl = '/post/' + secretToken;
        const trips = TS.getTrips();

        // Already saved — skip API call
        if (trips.some(t => t.postUrl === postUrl)) return;

        try {
            const trip = await API.getTripInfoBySecret(secretToken);
            TS.saveTrip(trip.name, postUrl, trip.viewUrl || '');
        } catch {
            // Can't fetch trip info — don't save
        }
    };

    /**
     * Remove a trip by postUrl
     * @param {string} postUrl
     */
    TS.removeTrip = function removeTrip(postUrl) {
        const trips = TS.getTrips().filter(t => t.postUrl !== postUrl);
        localStorage.setItem(TS.STORAGE_KEY, JSON.stringify(trips));
    };

    /**
     * Mark a trip as opened, updating lastOpenedAt to current timestamp.
     * Matches by postUrl or viewUrl.
     * @param {string} url - The URL to match against (postUrl or viewUrl)
     * @returns {boolean} True if a match was found and updated, false otherwise
     */
    TS.markOpened = function markOpened(url) {
        const trips = TS.getTrips();
        const idx = trips.findIndex(t => t.postUrl === url || t.viewUrl === url);
        if (idx < 0) return false;
        trips[idx] = { ...trips[idx], lastOpenedAt: Date.now() };
        try {
            localStorage.setItem(TS.STORAGE_KEY, JSON.stringify(trips));
        } catch {
            // localStorage unavailable — silent fail, matches saveTrip convention
        }
        return true;
    };

    /**
     * Classify a URL by role: owner (post pages) or viewer (trip pages).
     * Defensive: returns 'unknown' for non-strings, empty strings, malformed URLs.
     * @param {string|null|undefined} url - URL to classify (absolute or relative)
     * @returns {'owner'|'viewer'|'unknown'} The derived role
     */
    TS.getRoleForUrl = function getRoleForUrl(url) {
        if (typeof url !== 'string' || url.length === 0) return 'unknown';
        let pathname;
        try {
            pathname = new URL(url, 'https://app-roadtripmap-prod.azurewebsites.net').pathname;
        } catch {
            return 'unknown';
        }
        if (/^\/post\/[^/]+$/.test(pathname)) return 'owner';
        if (/^\/trips\/[^/]+$/.test(pathname)) return 'viewer';
        return 'unknown';
    };

    /**
     * Get the default trip for the user (the one most recently opened or added).
     * Returns the trip with the highest lastOpenedAt (or fallback to savedAt).
     * @returns {object|null} Trip record enriched with role field, or null if no trips
     */
    TS.getDefaultTrip = function getDefaultTrip() {
        const trips = TS.getTrips();
        if (trips.length === 0) return null;
        let best = null;
        let bestScore = -Infinity;
        for (const t of trips) {
            const score = typeof t.lastOpenedAt === 'number'
                ? t.lastOpenedAt
                : (Date.parse(t.savedAt) || 0);
            if (score > bestScore) {
                bestScore = score;
                best = t;
            }
        }
        return best ? { ...best, role: TS.getRoleForUrl(best.postUrl) } : null;
    };
})();
