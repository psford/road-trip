/**
 * Park Polygon Restyling Module
 * Overrides MapTiler Streets v2 default park styles with bolder colors and adds park labels at lower zoom levels
 * Uses MapLibre GL JS setPaintProperty() to modify existing park layers and adds a custom symbol layer for labels
 */

const ParkStyle = {
    /**
     * Apply park restyling to a MapLibre GL JS map
     * Finds existing park layers (both park and landuse source-layers per OpenMapTiles schema),
     * overrides their fill/line colors, and adds park labels at zoom 6+
     *
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @returns {void}
     */
    applyParkStyling(map) {
        // Guard: check if style is loaded
        if (!map.isStyleLoaded()) {
            console.warn('Map style not loaded; skipping park styling');
            return;
        }

        // Find vector tile source name by inspecting sources
        const vectorSource = this._findVectorSource(map);
        if (!vectorSource) {
            console.warn('No vector tile source found; skipping park styling');
            return;
        }

        // Get all layers and filter for park polygons
        const parkLayers = this._findParkLayers(map);
        if (parkLayers.length === 0) {
            console.warn('No park layers found in map style');
            return;
        }

        // Override fill and line colors for each park layer
        this._overrideParkLayerStyles(map, parkLayers);

        // Add park label layer at zoom 6+
        this._addParkLabels(map, vectorSource);
    },

    /**
     * Find the vector tile source in the map style
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @returns {string|null} - Source ID (e.g., 'maptiler_planet' or 'openmaptiles') or null if not found
     */
    _findVectorSource(map) {
        const sources = map.getStyle().sources || {};
        for (const [sourceId, source] of Object.entries(sources)) {
            if (source.type === 'vector') {
                return sourceId;
            }
        }
        return null;
    },

    /**
     * Find all park layers in the style
     * Parks may appear in either 'park' or 'landuse' (with class='park') source-layers per OpenMapTiles
     *
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @returns {Array<Object>} - Array of layer objects with source-layer 'park' or landuse class 'park'
     */
    _findParkLayers(map) {
        const allLayers = map.getStyle().layers || [];

        return allLayers.filter(layer => {
            const sourceLayer = layer['source-layer'];

            // Include park source-layer
            if (sourceLayer === 'park') {
                return true;
            }

            // Include landuse source-layer if class filter indicates park
            if (sourceLayer === 'landuse' && this._isParkClassFilter(layer)) {
                return true;
            }

            return false;
        });
    },

    /**
     * Check if a layer's filter indicates it's a park (class='park')
     * Filter may be in various formats: ['==', ['get', 'class'], 'park'] or similar
     *
     * @param {Object} layer - MapLibre GL JS layer object
     * @returns {boolean}
     */
    _isParkClassFilter(layer) {
        const filter = layer.filter;
        if (!filter || !Array.isArray(filter)) {
            return false;
        }

        // Check for ['==', ['get', 'class'], 'park'] pattern
        if (filter[0] === '==' && Array.isArray(filter[1]) && filter[1][1] === 'class' && filter[2] === 'park') {
            return true;
        }

        return false;
    },

    /**
     * Override fill and line paint properties for park layers
     *
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @param {Array<Object>} parkLayers - Array of park layer objects
     * @returns {void}
     */
    _overrideParkLayerStyles(map, parkLayers) {
        parkLayers.forEach(layer => {
            const layerId = layer.id;
            const layerType = layer.type;

            // Override fill properties for fill layers
            if (layerType === 'fill') {
                map.setPaintProperty(layerId, 'fill-color', '#2ecc71');
                map.setPaintProperty(layerId, 'fill-opacity', 0.35);
            }

            // Override line properties for line layers
            if (layerType === 'line') {
                map.setPaintProperty(layerId, 'line-color', '#1e8449');
                map.setPaintProperty(layerId, 'line-width', 2);
            }
        });
    },

    /**
     * Add a symbol layer for park labels at zoom 6+
     * Uses text-field: ['get', 'name'] to display park names from vector tile data
     *
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @param {string} vectorSourceId - Vector tile source ID
     * @returns {void}
     */
    _addParkLabels(map, vectorSourceId) {
        // Guard: prevent duplicate layers
        if (map.getLayer('park-labels-custom')) {
            return;
        }

        map.addLayer({
            id: 'park-labels-custom',
            type: 'symbol',
            source: vectorSourceId,
            'source-layer': 'park',
            minzoom: 6,
            maxzoom: 24,
            layout: {
                'text-field': ['get', 'name'],
                'text-size': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    6, 10,
                    12, 14
                ],
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#1e5631',
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.5
            }
        });
    }
};

// Export function matching expected API: applyParkStyling(map)
function applyParkStyling(map) {
    ParkStyle.applyParkStyling(map);
}
