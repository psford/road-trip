/**
 * Trip Storage - localStorage persistence for "My Trips"
 * Stores trip URLs so users can return to them without saving UUIDs.
 */

const TripStorage = {
    STORAGE_KEY: 'roadtripmap_trips',

    /**
     * Get all saved trips
     * @returns {Array<{name: string, postUrl: string, viewUrl: string, savedAt: string}>}
     */
    getTrips() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
        } catch {
            return [];
        }
    },

    /**
     * Save a trip. Deduplicates by postUrl.
     * @param {string} name - Trip name
     * @param {string} postUrl - Upload/post URL path
     * @param {string} viewUrl - View URL path
     */
    saveTrip(name, postUrl, viewUrl) {
        const trips = this.getTrips();
        const existing = trips.findIndex(t => t.postUrl === postUrl);
        const entry = { name, postUrl, viewUrl, savedAt: new Date().toISOString() };

        if (existing >= 0) {
            trips[existing] = entry;
        } else {
            trips.unshift(entry);
        }

        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trips));
        } catch {
            // localStorage full or unavailable — silent fail
        }
    },

    /**
     * Save a trip when we only have the secret token (post page visit).
     * Fetches trip info from the API to get the name and view URL.
     * @param {string} secretToken - The post secret token
     */
    async saveFromPostPage(secretToken) {
        const postUrl = '/post/' + secretToken;
        const trips = this.getTrips();

        // Already saved — skip API call
        if (trips.some(t => t.postUrl === postUrl)) return;

        try {
            const trip = await API.getTripInfoBySecret(secretToken);
            this.saveTrip(trip.name, postUrl, trip.viewUrl || '');
        } catch {
            // Can't fetch trip info — don't save
        }
    },

    /**
     * Remove a trip by postUrl
     * @param {string} postUrl
     */
    removeTrip(postUrl) {
        const trips = this.getTrips().filter(t => t.postUrl !== postUrl);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trips));
    },

    /**
     * Mark a trip as opened, updating lastOpenedAt to current timestamp.
     * Matches by postUrl or viewUrl.
     * @param {string} url - The URL to match against (postUrl or viewUrl)
     * @returns {boolean} True if a match was found and updated, false otherwise
     */
    markOpened(url) {
        const trips = this.getTrips();
        const idx = trips.findIndex(t => t.postUrl === url || t.viewUrl === url);
        if (idx < 0) return false;
        trips[idx] = { ...trips[idx], lastOpenedAt: Date.now() };
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trips));
        } catch {
            // localStorage unavailable — silent fail, matches saveTrip convention
        }
        return true;
    },

    /**
     * Classify a URL by role: owner (post pages) or viewer (trip pages).
     * Defensive: returns 'unknown' for non-strings, empty strings, malformed URLs.
     * @param {string|null|undefined} url - URL to classify (absolute or relative)
     * @returns {'owner'|'viewer'|'unknown'} The derived role
     */
    getRoleForUrl(url) {
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
    },

    /**
     * Get the default trip for the user (the one most recently opened or added).
     * Returns the trip with the highest lastOpenedAt (or fallback to savedAt).
     * @returns {object|null} Trip record enriched with role field, or null if no trips
     */
    getDefaultTrip() {
        const trips = this.getTrips();
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
        return best ? { ...best, role: this.getRoleForUrl(best.postUrl) } : null;
    }
};
