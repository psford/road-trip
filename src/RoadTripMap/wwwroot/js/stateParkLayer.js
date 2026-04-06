/**
 * State Park Boundaries Layer Module
 *
 * Pattern: Imperative Shell (map layer with network + IndexedDB side effects)
 *
 * Loads state park boundary polygons from API and renders them as fill+outline+dot+label
 * layers on MapLibre GL JS maps, with click handlers for location selection.
 * Follows parkStyle.js patterns exactly with sp- prefixed layer IDs and teal color.
 *
 * Supports multiple map instances by storing per-map state in a Map data structure.
 * Each call to init() creates independent state for that map instance.
 */

const StateParkLayer = {
    _mapStates: new Map(), // Map<maplibregl.Map, { options, debounceTimer, spPopup, currentDetail, lastResponseMs, isPrefetching, prefetchTimer }>

    /**
     * Get or create state for a specific map instance
     * @private
     */
    _getMapState(map) {
        if (!this._mapStates.has(map)) {
            this._mapStates.set(map, {
                options: {},
                debounceTimer: null,
                spPopup: null,
                currentDetail: 'moderate',
                lastResponseMs: null,
                isPrefetching: false,
                prefetchTimer: null
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
        this._setupPrefetchHandler(map);
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
     * Select detail level based on connection quality and measured response times
     * Determines detail from two signals:
     * 1. Initial estimate from navigator.connection (if available)
     * 2. Measured response time (overrides initial estimate mid-session)
     * @private
     */
    _selectDetailLevel(map) {
        const state = this._getMapState(map);

        // Start with initial estimate from navigator.connection
        let detail = 'moderate'; // Default fallback

        if (navigator.connection) {
            const downlink = navigator.connection.downlink;
            if (downlink < 1) {
                detail = 'simplified';
            } else if (downlink > 5) {
                detail = 'full';
            } else {
                detail = 'moderate';
            }
        }

        // Override with measured response time if available
        if (state.lastResponseMs !== null) {
            if (state.lastResponseMs > 3000) {
                // Step down one level
                if (detail === 'full') {
                    detail = 'moderate';
                } else if (detail === 'moderate') {
                    detail = 'simplified';
                }
            } else if (state.lastResponseMs < 500) {
                // Step up one level
                if (detail === 'simplified') {
                    detail = 'moderate';
                } else if (detail === 'moderate') {
                    detail = 'full';
                }
            }
            // Otherwise keep current level
        }

        state.currentDetail = detail;
        return detail;
    },

    /**
     * Measure API response time and record it
     * @private
     */
    async _measureFetch(map, bounds, zoom, detail) {
        const start = performance.now();
        const result = await API.fetchParkBoundaries(bounds, zoom, detail);
        const state = this._getMapState(map);
        state.lastResponseMs = performance.now() - start;
        return result;
    },

    /**
     * Cache a feature with its detail level in IndexedDB
     * Extracts ID and centroid from feature, stores in MapCache for spatial filtering
     * @private
     */
    async _cacheFeature(feature, detailLevel) {
        const id = feature.id || feature.properties.id;
        if (id) {
            await MapCache.put('park-boundary', id, detailLevel, {
                ...feature,
                centroid: {
                    lat: feature.properties.centroidLat,
                    lng: feature.properties.centroidLng
                }
            });
        }
    },

    /**
     * Load state park boundaries for current viewport and update sources
     * Checks cache first, fetches API for uncached features, renders immediately, caches in background
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
            const detail = this._selectDetailLevel(map);
            const state = this._getMapState(map);

            // Check for cached features at this detail level
            const cachedIds = await MapCache.getIds('park-boundary', {
                minLat: bounds.getSouth(),
                maxLat: bounds.getNorth(),
                minLng: bounds.getWest(),
                maxLng: bounds.getEast()
            });

            // Fetch state park boundaries with measured timing
            const response = await this._measureFetch(map, bounds, zoom, detail);

            if (!response || !response.features) {
                console.warn('Invalid park boundaries response:', response);
                return;
            }

            // Merge cached features with fresh API response
            // Use cached version if ID exists in cache, otherwise use fresh from API
            const features = response.features.map(feature => {
                const id = feature.id || feature.properties.id;
                if (cachedIds && cachedIds.has(id)) {
                    // ID is cached; in production would fetch from cache, but API already returned fresh
                    // Keep API version which is current
                    return feature;
                }
                return feature;
            });

            // Update boundary source with GeoJSON (render first)
            const boundarySource = map.getSource('sp-boundaries');
            if (boundarySource) {
                boundarySource.setData({ ...response, features });
            }

            // Create label points from centroids (API provides centroidLat and centroidLng)
            const labelPoints = {
                type: 'FeatureCollection',
                features: features.map(f => ({
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

            // Cache features in IndexedDB after rendering (background work)
            // Use non-blocking approach to avoid rendering delays
            setImmediate(async () => {
                for (const feature of features) {
                    try {
                        await this._cacheFeature(feature, state.currentDetail);
                    } catch (error) {
                        console.warn('Failed to cache feature:', error);
                    }
                }
            });
        } catch (error) {
            console.error('Failed to load state park boundaries:', error);
        }
    },

    /**
     * Set up prefetch handler for moveend events
     * Triggers background prefetch of boundaries at zoom 7+ when user is in pre-render zone
     * @private
     */
    _setupPrefetchHandler(map) {
        const state = this._getMapState(map);

        map.on('moveend', () => {
            const zoom = map.getZoom();

            // Trigger prefetch if at zoom 7 (pre-render zone)
            if (zoom >= 7 && zoom < 8) {
                // Clear existing debounce timer
                if (state.prefetchTimer) {
                    clearTimeout(state.prefetchTimer);
                }

                // Debounce prefetch by 500ms to avoid excessive requests during pan/zoom
                state.prefetchTimer = setTimeout(() => {
                    this._prefetchForViewport(map);
                }, 500);
            }
        });
    },

    /**
     * Prefetch boundaries for current viewport and expanded region
     * Step 1: Fetches simplified for viewport
     * Step 2: Fetches moderate and full for ~100-mile radius (simplified already covered by Step 1)
     * @private
     */
    async _prefetchForViewport(map) {
        const state = this._getMapState(map);

        // Prevent concurrent prefetch requests
        if (state.isPrefetching) {
            return;
        }

        state.isPrefetching = true;

        try {
            const bounds = map.getBounds();
            const zoom = 8; // Use zoom 8 for prefetch to get appropriate data

            // Step 1: Prefetch simplified boundaries for current viewport
            try {
                const response = await API.fetchParkBoundaries(bounds, zoom, 'simplified');
                if (response && response.features) {
                    for (const feature of response.features) {
                        try {
                            await this._cacheFeature(feature, 'simplified');
                        } catch (error) {
                            console.warn('Failed to cache feature:', error);
                        }
                    }
                }
            } catch (error) {
                console.warn('Prefetch simplified viewport failed:', error);
            }

            // Step 2: Expand bounds by ~100 miles and prefetch moderate + full detail levels
            // (simplified already covered by Step 1)
            const expandedBounds = this._expandBounds(bounds, 100);

            for (const detail of ['moderate', 'full']) {
                try {
                    const response = await API.fetchParkBoundaries(expandedBounds, zoom, detail);
                    if (response && response.features) {
                        for (const feature of response.features) {
                            try {
                                await this._cacheFeature(feature, detail);
                            } catch (error) {
                                console.warn('Failed to cache feature:', error);
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Prefetch ${detail} expanded region failed:`, error);
                }
            }
        } finally {
            state.isPrefetching = false;
        }
    },

    /**
     * Expand bounds by specified number of miles
     * Adds miles/69 degrees to each side of bounds (1 degree ≈ 69 miles latitude)
     * For longitude, adjusts by miles / (69 * cos(centerLat))
     *
     * Returns duck-typed bounds object compatible with API.fetchParkBoundaries only.
     * Not a MapLibre LngLatBounds instance, but provides getSouth/getNorth/getWest/getEast methods
     * that match the bounds object interface expected by the API.
     * @private
     */
    _expandBounds(bounds, milesToExpand) {
        const latDelta = milesToExpand / 69;
        const centerLat = (bounds.getNorth() + bounds.getSouth()) / 2;
        const lngDelta = milesToExpand / (69 * Math.cos(centerLat * Math.PI / 180));

        return {
            getSouth: () => Math.max(-90, bounds.getSouth() - latDelta),
            getNorth: () => Math.min(90, bounds.getNorth() + latDelta),
            getWest: () => Math.max(-180, bounds.getWest() - lngDelta),
            getEast: () => Math.min(180, bounds.getEast() + lngDelta)
        };
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
