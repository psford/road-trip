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
    /**
     * @param {maplibregl.Map} map
     * @param {Object} [options]
     * @param {function} [options.onPoiSelect] - Called with (lat, lng, name) when user clicks "Use this location"
     * @param {function} [options.onPoiZoom] - Called with (lat, lng) when user clicks "Pick nearby spot"
     */
    init(map, options) {
        if (!map.isStyleLoaded()) {
            setTimeout(() => this.init(map, options), 100);
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

        // POI popup on click — info-only or with action buttons depending on options
        let poiPopup = null;
        const hasActions = options && (options.onPoiSelect || options.onPoiZoom);

        map.on('click', 'poi-markers', (e) => {
            if (!e.features || !e.features.length) return;

            const feature = e.features[0];
            const { name, category } = feature.properties;
            const [lng, lat] = feature.geometry.coordinates;

            if (poiPopup) poiPopup.remove();

            const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            const categoryLabel = category.replace(/_/g, ' ');

            let html;
            if (hasActions) {
                html = `<div class="poi-action-popup">
                    <div class="poi-action-name">${escapedName}</div>
                    <small style="color:#666;display:block;margin-bottom:8px">${categoryLabel}</small>
                    <button class="poi-action-btn poi-use-location">Use this location</button>
                    <button class="poi-action-btn poi-pick-nearby">Pick nearby spot</button>
                </div>`;
            } else {
                html = `<div style="padding:4px 8px"><strong>${escapedName}</strong><br><small style="color:#666">${categoryLabel}</small></div>`;
            }

            poiPopup = new maplibregl.Popup({ closeOnClick: false, closeButton: true, maxWidth: '240px' })
                .setLngLat([lng, lat])
                .setHTML(html)
                .addTo(map);

            if (hasActions) {
                // Attach button handlers after popup is added to DOM
                const popupEl = poiPopup.getElement();
                if (popupEl) {
                    const useBtn = popupEl.querySelector('.poi-use-location');
                    const nearbyBtn = popupEl.querySelector('.poi-pick-nearby');

                    if (useBtn) {
                        useBtn.onclick = (evt) => {
                            evt.stopPropagation();
                            evt.preventDefault();
                            poiPopup.remove();
                            options.onPoiSelect(lat, lng, name);
                        };
                    }
                    if (nearbyBtn) {
                        nearbyBtn.onclick = (evt) => {
                            evt.stopPropagation();
                            evt.preventDefault();
                            poiPopup.remove();
                            options.onPoiZoom(lat, lng);
                        };
                    }
                }
            }
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
