/**
 * Road Trip Map Service
 * Data layer for map view — no DOM references, designed for native app portability
 * Handles API calls, state management, and coordinate transformations
 */

const MapService = {
    /**
     * Load trip and photos from API
     * @param {string} viewToken - Trip view token
     * @returns {Promise<{trip, photos}>}
     */
    async loadTrip(viewToken) {
        const [trip, photos] = await Promise.all([
            API.getTripInfo(viewToken),
            API.getTripPhotos(viewToken)
        ]);
        return { trip, photos };
    },

    /**
     * Extract route coordinates from photos for polyline rendering
     * @param {Array} photos - Array of PhotoResponse objects
     * @returns {Array<[lat, lng]>} - Array of coordinate pairs (lat, lng order)
     */
    getRouteCoordinates(photos) {
        return photos.map(p => [p.lat, p.lng]);
    }
};
