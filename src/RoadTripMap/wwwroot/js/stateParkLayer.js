/**
 * State Park Boundaries Layer Module
 *
 * Loads state park boundary polygons from API and renders them as fill+outline+dot+label
 * layers on MapLibre GL JS maps, with click handlers for location selection.
 * Follows parkStyle.js patterns exactly with sp- prefixed layer IDs and teal color.
 *
 * Supports multiple map instances by storing per-map state in a Map data structure.
 * Each call to init() creates independent state for that map instance.
 */

const StateParkLayer = {
    _mapStates: new Map(), // Map<maplibregl.Map, { options, debounceTimer, spPopup }>

    /**
     * Get or create state for a specific map instance
     * @private
     */
    _getMapState(map) {
        if (!this._mapStates.has(map)) {
            this._mapStates.set(map, {
                options: {},
                debounceTimer: null,
                spPopup: null
            });
        }
        return this._mapStates.get(map);
    },

    /**
     * Initialize state park layer on a MapLibre map
     * @param {maplibregl.Map} map - MapLibre GL JS map instance
     * @param {Object} [options] - Optional configuration
     * @param {function} [options.onPoiSelect] - Called with (lat, lng, name) when user clicks "Use this location"
     * @param {function} [options.onPoiZoom] - Called with (lat, lng) when user clicks "Pick nearby spot"
     */
    init(map, options) {
        if (!map.isStyleLoaded()) {
            setTimeout(() => this.init(map, options), 100);
            return;
        }

        const state = this._getMapState(map);
        state.options = options || {};

        this._addSources(map);
        this._addLayers(map);
        this._setupClickHandlers(map);
        this._setupMoveHandler(map);
        this._loadBoundaries(map);
    },

    /**
     * Add GeoJSON sources for state park boundaries and label points
     * @private
     */
    _addSources(map) {
        // Boundary polygons source
        if (!map.getSource('sp-boundaries')) {
            map.addSource('sp-boundaries', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
        }

        // Label points source (centroids)
        if (!map.getSource('sp-label-points')) {
            map.addSource('sp-label-points', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: []
                }
            });
        }
    },

    /**
     * Add fill, outline, dot, and label layers for state park boundaries
     * @private
     */
    _addLayers(map) {
        // Fill layer — semi-transparent teal
        if (!map.getLayer('sp-boundary-fill')) {
            map.addLayer({
                id: 'sp-boundary-fill',
                type: 'fill',
                source: 'sp-boundaries',
                paint: {
                    'fill-color': '#2a9d8f',
                    'fill-opacity': 0.15
                },
                minzoom: 8
            }, this._findFirstSymbolLayer(map));
        }

        // Outline layer — solid teal border
        if (!map.getLayer('sp-boundary-outline')) {
            map.addLayer({
                id: 'sp-boundary-outline',
                type: 'line',
                source: 'sp-boundaries',
                paint: {
                    'line-color': '#2a9d8f',
                    'line-width': 2,
                    'line-opacity': 0.7
                },
                minzoom: 8
            }, this._findFirstSymbolLayer(map));
        }

        // Centroid dot — teal circle with white stroke
        if (!map.getLayer('sp-centroid-dot')) {
            map.addLayer({
                id: 'sp-centroid-dot',
                type: 'circle',
                source: 'sp-label-points',
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#2a9d8f',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 1.5
                },
                minzoom: 8
            });
        }

        // Label layer — park name text
        if (!map.getLayer('sp-boundary-labels')) {
            map.addLayer({
                id: 'sp-boundary-labels',
                type: 'symbol',
                source: 'sp-label-points',
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 12,
                    'text-font': ['Open Sans Bold'],
                    'text-allow-overlap': false,
                    'text-padding': 10,
                    'text-offset': [0, 1.2],
                    'text-anchor': 'top'
                },
                paint: {
                    'text-color': '#1e5631',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 2
                },
                minzoom: 8
            });
        }
    },

    /**
     * Set up click handlers for state park centroid dots
     * Displays popup with park name and optional action buttons
     * @private
     */
    _setupClickHandlers(map) {
        const state = this._getMapState(map);
        const hasActions = state.options.onPoiSelect || state.options.onPoiZoom;

        map.on('click', 'sp-centroid-dot', (e) => {
            if (!e.features || !e.features.length) return;

            const feature = e.features[0];
            const name = feature.properties.name;
            const [lng, lat] = feature.geometry.coordinates;

            if (state.spPopup) state.spPopup.remove();

            const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            let html;

            if (hasActions) {
                html = `<div class="poi-action-popup">
                    <div class="poi-action-name">${escapedName}</div>
                    <small style="color:#666;display:block;margin-bottom:8px">state park</small>
                    <button class="poi-action-btn poi-use-location">Use this location</button>
                    <button class="poi-action-btn poi-pick-nearby">Pick nearby spot</button>
                </div>`;
            } else {
                html = `<div style="padding:4px 8px"><strong>${escapedName}</strong><br><small style="color:#666">state park</small></div>`;
            }

            state.spPopup = new maplibregl.Popup({ closeOnClick: true, closeButton: false, maxWidth: '240px' })
                .setLngLat([lng, lat])
                .setHTML(html)
                .addTo(map);

            if (hasActions) {
                const popupEl = state.spPopup.getElement();
                if (popupEl) {
                    const useBtn = popupEl.querySelector('.poi-use-location');
                    const nearbyBtn = popupEl.querySelector('.poi-pick-nearby');

                    if (useBtn && state.options.onPoiSelect) {
                        useBtn.onclick = (evt) => {
                            evt.stopPropagation();
                            evt.preventDefault();
                            state.spPopup.remove();
                            state.options.onPoiSelect(lat, lng, name);
                        };
                    }

                    if (nearbyBtn && state.options.onPoiZoom) {
                        nearbyBtn.onclick = (evt) => {
                            evt.stopPropagation();
                            evt.preventDefault();
                            state.spPopup.remove();
                            state.options.onPoiZoom(lat, lng);
                        };
                    }
                }
            }
        });

        // Pointer cursor on state park centroid hover
        map.on('mouseenter', 'sp-centroid-dot', () => {
            map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'sp-centroid-dot', () => {
            map.getCanvas().style.cursor = '';
        });
    },

    /**
     * Set up debounced moveend handler to reload boundaries when map moves
     * @private
     */
    _setupMoveHandler(map) {
        const state = this._getMapState(map);

        map.on('moveend', () => {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(() => {
                this._loadBoundaries(map);
            }, 300);
        });
    },

    /**
     * Load state park boundaries for current viewport and update sources
     * @private
     */
    async _loadBoundaries(map) {
        try {
            const zoom = map.getZoom();

            // Skip loading if zoom is less than 8 (AC1.4)
            if (zoom < 8) {
                const source = map.getSource('sp-boundaries');
                if (source) {
                    source.setData({
                        type: 'FeatureCollection',
                        features: []
                    });
                }
                const labelSource = map.getSource('sp-label-points');
                if (labelSource) {
                    labelSource.setData({
                        type: 'FeatureCollection',
                        features: []
                    });
                }
                return;
            }

            const bounds = map.getBounds();

            // Fetch state park boundaries from API
            const response = await API.fetchParkBoundaries(bounds, zoom);

            if (!response || !response.features) {
                console.warn('Invalid park boundaries response:', response);
                return;
            }

            // Update boundary source with GeoJSON
            // Note: Since the API response replaces full source data (not additive),
            // and MapCache integration is deferred to Phase 6, simply update source
            const boundarySource = map.getSource('sp-boundaries');
            if (boundarySource) {
                boundarySource.setData(response);
            }

            // Create label points from centroids (API provides centroidLat and centroidLng)
            const labelPoints = {
                type: 'FeatureCollection',
                features: response.features.map(f => ({
                    type: 'Feature',
                    properties: f.properties,
                    geometry: {
                        type: 'Point',
                        coordinates: [f.properties.centroidLng, f.properties.centroidLat]
                    }
                }))
            };

            const labelSource = map.getSource('sp-label-points');
            if (labelSource) {
                labelSource.setData(labelPoints);
            }
        } catch (error) {
            console.error('Failed to load state park boundaries:', error);
        }
    },

    /**
     * Find the first symbol layer in the style to insert fill/outline layers below it
     * @private
     */
    _findFirstSymbolLayer(map) {
        const layers = map.getStyle().layers;
        for (const layer of layers) {
            if (layer.type === 'symbol') return layer.id;
        }
        return undefined;
    }
};
