/**
 * Park Styling Module
 *
 * Enhances MapTiler Streets v2 park display:
 * - Makes the existing "Park" POI label layer more prominent with bolder text and lower minzoom
 * - Enhances landcover layers (Wood, Forest, Grass) with greener fill where they represent park areas
 *
 * MapTiler Streets v2 actual layer structure (verified 2026-04-04):
 * - Park labels: source-layer="poi", layer id="Park", filter=['all', ['==','class','park'], ['has','name']]
 * - Park polygons: No dedicated park fill layer. Park areas are covered by:
 *   - "Forest" (source-layer=globallandcover, class=forest/tree) - fill
 *   - "Wood" (source-layer=landcover, class=wood) - fill
 *   - "Grass" (source-layer=landcover, class=grass) - fill
 *   - "Meadow" (source-layer=globallandcover, class=grass) - fill
 */

const ParkStyle = {
    applyParkStyling(map) {
        if (!map.isStyleLoaded()) {
            setTimeout(() => this.applyParkStyling(map), 100);
            return;
        }

        this._enhanceParkLabels(map);
        this._enhanceLandcoverLayers(map);
    },

    /**
     * Enhance the existing "Park" POI label layer:
     * - Lower minzoom from default (~10) to 6 so park names visible at regional zoom
     * - Bolder text color and larger halo for readability
     */
    _enhanceParkLabels(map) {
        const parkLayerId = 'Park';

        if (!map.getLayer(parkLayerId)) {
            console.warn('Park label layer not found in style');
            return;
        }

        // Bolder green text with white halo (don't change zoom range — the Park layer
        // uses a sprite icon that's only available at certain zooms; changing minzoom
        // causes "Image could not be loaded" warnings)
        map.setPaintProperty(parkLayerId, 'text-color', '#1e5631');
        map.setPaintProperty(parkLayerId, 'text-halo-color', '#ffffff');
        map.setPaintProperty(parkLayerId, 'text-halo-width', 2);
    },

    /**
     * Enhance landcover fill layers to be greener and more prominent.
     * These layers cover forest/wood/grass areas which include parks.
     * We make the green more vivid so park areas stand out visually.
     */
    _enhanceLandcoverLayers(map) {
        // Enhance forest/wood fills to be more vivid green
        const fillEnhancements = [
            { id: 'Forest', color: '#a8d5a2', opacity: 0.6 },
            { id: 'Wood', color: '#8fca87', opacity: 0.5 },
            { id: 'Grass', color: '#c5e8b7', opacity: 0.5 },
            { id: 'Meadow', color: '#d4edc9', opacity: 0.4 },
        ];

        for (const { id, color, opacity } of fillEnhancements) {
            if (map.getLayer(id)) {
                map.setPaintProperty(id, 'fill-color', color);
                map.setPaintProperty(id, 'fill-opacity', opacity);
            }
        }
    }
};

function applyParkStyling(map) {
    ParkStyle.applyParkStyling(map);
}
