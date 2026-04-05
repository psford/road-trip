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

    applyParkStyling(map, options) {
        if (!map.isStyleLoaded()) {
            setTimeout(() => this.applyParkStyling(map, options), 100);
            return;
        }

        this._options = options || {};
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

            // Add single label per park using centroid points
            if (!map.getSource('nps-label-points')) {
                const labelPoints = {
                    type: 'FeatureCollection',
                    features: this._boundaryData.features.map(f => ({
                        type: 'Feature',
                        properties: f.properties,
                        geometry: {
                            type: 'Point',
                            coordinates: this._computeCentroid(f.geometry)
                        }
                    }))
                };
                map.addSource('nps-label-points', { type: 'geojson', data: labelPoints });
            }

            // Green dot at centroid — matches POI marker styling
            if (!map.getLayer('nps-centroid-dot')) {
                map.addLayer({
                    id: 'nps-centroid-dot',
                    type: 'circle',
                    source: 'nps-label-points',
                    paint: {
                        'circle-radius': 6,
                        'circle-color': '#2d6a4f',
                        'circle-stroke-color': '#ffffff',
                        'circle-stroke-width': 1.5
                    },
                    minzoom: 7
                });

                // Click handler — same behavior as POI markers
                let npPopup = null;
                const hasActions = this._options.onPoiSelect || this._options.onPoiZoom;
                map.on('click', 'nps-centroid-dot', (e) => {
                    if (!e.features || !e.features.length) return;
                    const name = e.features[0].properties.UNIT_NAME;
                    const [lng, lat] = e.features[0].geometry.coordinates;
                    if (npPopup) npPopup.remove();

                    const escapedName = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    let html;
                    if (hasActions) {
                        html = `<div class="poi-action-popup">
                            <div class="poi-action-name">${escapedName}</div>
                            <small style="color:#666;display:block;margin-bottom:8px">national park</small>
                            <button class="poi-action-btn poi-use-location">Use this location</button>
                            <button class="poi-action-btn poi-pick-nearby">Pick nearby spot</button>
                        </div>`;
                    } else {
                        html = `<div style="padding:4px 8px"><strong>${escapedName}</strong><br><small style="color:#666">national park</small></div>`;
                    }

                    npPopup = new maplibregl.Popup({ closeOnClick: true, closeButton: false, maxWidth: '240px' })
                        .setLngLat([lng, lat])
                        .setHTML(html)
                        .addTo(map);

                    if (hasActions) {
                        const popupEl = npPopup.getElement();
                        if (popupEl) {
                            const useBtn = popupEl.querySelector('.poi-use-location');
                            const nearbyBtn = popupEl.querySelector('.poi-pick-nearby');
                            if (useBtn && this._options.onPoiSelect) {
                                useBtn.onclick = (evt) => {
                                    evt.stopPropagation();
                                    evt.preventDefault();
                                    npPopup.remove();
                                    this._options.onPoiSelect(lat, lng, name);
                                };
                            }
                            if (nearbyBtn && this._options.onPoiZoom) {
                                nearbyBtn.onclick = (evt) => {
                                    evt.stopPropagation();
                                    evt.preventDefault();
                                    npPopup.remove();
                                    this._options.onPoiZoom(lat, lng);
                                };
                            }
                        }
                    }
                });
                map.on('mouseenter', 'nps-centroid-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
                map.on('mouseleave', 'nps-centroid-dot', () => { map.getCanvas().style.cursor = ''; });
            }

            // Park name label below dot
            if (!map.getLayer('nps-boundary-labels')) {
                map.addLayer({
                    id: 'nps-boundary-labels',
                    type: 'symbol',
                    source: 'nps-label-points',
                    layout: {
                        'text-field': ['get', 'UNIT_NAME'],
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
                    minzoom: 7
                });
            }
        } catch (error) {
            console.error('Failed to load park boundaries:', error);
        }
    },

    /**
     * Compute the centroid of a GeoJSON geometry (Polygon or MultiPolygon)
     * by averaging all coordinates across all rings/polygons.
     */
    _computeCentroid(geometry) {
        const coords = [];
        const extractCoords = (rings) => {
            for (const ring of rings) {
                for (const pt of ring) coords.push(pt);
            }
        };

        if (geometry.type === 'Polygon') {
            extractCoords(geometry.coordinates);
        } else if (geometry.type === 'MultiPolygon') {
            for (const polygon of geometry.coordinates) extractCoords(polygon);
        }

        if (coords.length === 0) return [0, 0];

        let sumLng = 0, sumLat = 0;
        for (const [lng, lat] of coords) {
            sumLng += lng;
            sumLat += lat;
        }
        return [sumLng / coords.length, sumLat / coords.length];
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

function applyParkStyling(map, options) {
    ParkStyle.applyParkStyling(map, options);
}
