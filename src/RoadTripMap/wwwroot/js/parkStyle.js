/**
 * Park Styling Module
 *
 * Loads NPS national park boundary polygons from a static GeoJSON file
 * and renders them as a fill+outline layer on MapLibre GL JS maps.
 * Also enhances existing MapTiler park label styling.
 */

const ParkStyle = {
    _loaded: false,
    _boundaryData: null,

    applyParkStyling(map) {
        if (!map.isStyleLoaded()) {
            setTimeout(() => this.applyParkStyling(map), 100);
            return;
        }

        this._enhanceParkLabels(map);
        this._loadAndRenderBoundaries(map);
    },

    /**
     * Enhance the existing "Park" POI label layer from MapTiler
     */
    _enhanceParkLabels(map) {
        const parkLayerId = 'Park';
        if (!map.getLayer(parkLayerId)) return;

        map.setPaintProperty(parkLayerId, 'text-color', '#1e5631');
        map.setPaintProperty(parkLayerId, 'text-halo-color', '#ffffff');
        map.setPaintProperty(parkLayerId, 'text-halo-width', 2);
    },

    /**
     * Load NPS boundary GeoJSON and add fill + outline layers
     */
    async _loadAndRenderBoundaries(map) {
        try {
            // Load boundary data (cache across multiple map instances)
            if (!this._boundaryData) {
                const response = await fetch('/data/nps-boundaries.geojson');
                if (!response.ok) {
                    console.warn('Park boundaries not available:', response.status);
                    return;
                }
                this._boundaryData = await response.json();
            }

            // Add source if not already present
            if (!map.getSource('nps-boundaries')) {
                map.addSource('nps-boundaries', {
                    type: 'geojson',
                    data: this._boundaryData
                });
            }

            // Add fill layer — semi-transparent green
            if (!map.getLayer('nps-boundary-fill')) {
                map.addLayer({
                    id: 'nps-boundary-fill',
                    type: 'fill',
                    source: 'nps-boundaries',
                    paint: {
                        'fill-color': '#2d6a4f',
                        'fill-opacity': 0.15
                    }
                }, this._findFirstSymbolLayer(map));
            }

            // Add outline layer — solid green border
            if (!map.getLayer('nps-boundary-outline')) {
                map.addLayer({
                    id: 'nps-boundary-outline',
                    type: 'line',
                    source: 'nps-boundaries',
                    paint: {
                        'line-color': '#2d6a4f',
                        'line-width': 2,
                        'line-opacity': 0.7
                    }
                }, this._findFirstSymbolLayer(map));
            }

            // Add park name labels at centroids
            if (!map.getLayer('nps-boundary-labels')) {
                map.addLayer({
                    id: 'nps-boundary-labels',
                    type: 'symbol',
                    source: 'nps-boundaries',
                    layout: {
                        'text-field': ['get', 'UNIT_NAME'],
                        'text-size': 12,
                        'text-font': ['Open Sans Bold'],
                        'text-allow-overlap': false,
                        'text-padding': 10
                    },
                    paint: {
                        'text-color': '#1e5631',
                        'text-halo-color': '#ffffff',
                        'text-halo-width': 2
                    },
                    minzoom: 7
                });
            }
        } catch (error) {
            console.error('Failed to load park boundaries:', error);
        }
    },

    /**
     * Find the first symbol layer in the style to insert fill layers below labels
     */
    _findFirstSymbolLayer(map) {
        const layers = map.getStyle().layers;
        for (const layer of layers) {
            if (layer.type === 'symbol') return layer.id;
        }
        return undefined;
    }
};

function applyParkStyling(map) {
    ParkStyle.applyParkStyling(map);
}
