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
    },

    /**
     * Generate smooth curve coordinates from waypoints using Catmull-Rom interpolation.
     * Converts to cubic bezier segments sampled at regular intervals.
     * @param {Array<[lng, lat]>} points - Array of [lng, lat] coordinate pairs
     * @param {number} pointsPerSegment - Points to generate per segment (higher = smoother)
     * @returns {Array<[lng, lat]>} - Dense array of interpolated coordinates
     */
    smoothRoute(points, pointsPerSegment = 16) {
        if (points.length < 2) return points;
        if (points.length === 2) return points;

        const result = [];

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[Math.min(points.length - 1, i + 1)];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            for (let t = 0; t < pointsPerSegment; t++) {
                const f = t / pointsPerSegment;
                const f2 = f * f;
                const f3 = f2 * f;

                // Catmull-Rom basis functions
                const lng = 0.5 * (
                    (2 * p1[0]) +
                    (-p0[0] + p2[0]) * f +
                    (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * f2 +
                    (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * f3
                );
                const lat = 0.5 * (
                    (2 * p1[1]) +
                    (-p0[1] + p2[1]) * f +
                    (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * f2 +
                    (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * f3
                );
                result.push([lng, lat]);
            }
        }

        // Add the last point
        result.push(points[points.length - 1]);
        return result;
    }
};
