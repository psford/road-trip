/**
 * POI Layer Module
 * Manages a dynamic GeoJSON layer of Points of Interest (POIs) on MapLibre GL JS maps
 * Loads POIs based on current map viewport and zoom level, with category-based styling
 */

const PoiLayer = {
    /**
     * Initialize POI layer on a MapLibre map
     * Sets up GeoJSON source, circle marker layer, and label layer
     * Attaches debounced moveend handler to update POIs dynamically
     *
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @returns {void}
     */
    init(map) {
        // If style isn't loaded yet, defer with a short retry.
        // We can't use once('styledata') because it may have already fired
        // by the time this is called from map.on('load').
        if (!map.isStyleLoaded()) {
            setTimeout(() => this.init(map), 100);
            return;
        }

        // Create GeoJSON source with empty FeatureCollection
        const poiSource = {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        };

        // Add source if not already present
        if (!map.getSource('poi-source')) {
            map.addSource('poi-source', poiSource);
        }

        // Add circle marker layer
        if (!map.getLayer('poi-markers')) {
            map.addLayer({
                id: 'poi-markers',
                type: 'circle',
                source: 'poi-source',
                paint: {
                    'circle-radius': 6,
                    'circle-color': [
                        'match',
                        ['get', 'category'],
                        'national_park', '#2d6a4f',      // dark green
                        'state_park', '#52b788',          // light green
                        'natural_feature', '#7b2d26',     // brown
                        'historic_site', '#6c4ab6',       // purple
                        'tourism', '#d4a017',             // gold
                        '#666666'                         // default gray
                    ],
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1.5
                }
            });
        }

        // Add text label layer (labels only at higher zoom to reduce clutter)
        if (!map.getLayer('poi-labels')) {
            map.addLayer({
                id: 'poi-labels',
                type: 'symbol',
                source: 'poi-source',
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 11,
                    'text-offset': [0, 1.2],
                    'text-anchor': 'top',
                    'text-allow-overlap': false
                },
                paint: {
                    'text-color': '#333333',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 1
                },
                minzoom: 8
            });
        }

        // POI info popup on click — shows name and category for any map
        let poiPopup = null;
        map.on('click', 'poi-markers', (e) => {
            if (!e.features || !e.features.length) return;

            const feature = e.features[0];
            const { name, category } = feature.properties;
            const [lng, lat] = feature.geometry.coordinates;

            if (poiPopup) poiPopup.remove();

            const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const categoryLabel = category.replace(/_/g, ' ');

            poiPopup = new maplibregl.Popup({ closeOnClick: true, maxWidth: '240px' })
                .setLngLat([lng, lat])
                .setHTML(`<div style="padding:4px 8px"><strong>${escapedName}</strong><br><small style="color:#666">${categoryLabel}</small></div>`)
                .addTo(map);
        });

        // Pointer cursor on POI hover
        map.on('mouseenter', 'poi-markers', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'poi-markers', () => {
            map.getCanvas().style.cursor = '';
        });

        // Setup debounced moveend handler
        let moveendTimeout;
        const debouncedLoadPois = () => {
            clearTimeout(moveendTimeout);
            moveendTimeout = setTimeout(() => {
                this.loadPois(map);
            }, 300);
        };

        map.on('moveend', debouncedLoadPois);

        // Initial load of POIs
        this.loadPois(map);
    },

    /**
     * Fetch POIs for current map viewport and update the GeoJSON source
     * Converts API response to GeoJSON FeatureCollection and updates the map source
     *
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @returns {Promise<void>}
     */
    async loadPois(map) {
        try {
            const bounds = map.getBounds();
            const zoom = map.getZoom();

            // Fetch POI data from API
            const pois = await API.fetchPois(bounds, zoom);

            // Convert to GeoJSON FeatureCollection
            const geojson = {
                type: 'FeatureCollection',
                features: pois.map(p => ({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [p.lng, p.lat]
                    },
                    properties: {
                        id: p.id,
                        name: p.name,
                        category: p.category
                    }
                }))
            };

            // Update map source with new data
            const source = map.getSource('poi-source');
            if (source) {
                source.setData(geojson);
            }
        } catch (error) {
            console.error('Failed to load POIs:', error);
        }
    }
};
