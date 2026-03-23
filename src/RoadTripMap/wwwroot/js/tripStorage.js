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
            // We need the view URL — get it from the trip info
            // The API doesn't return viewUrl from the secret endpoint,
            // so we store what we have and update later if needed
            this.saveTrip(trip.name, postUrl, '');
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
    }
};
