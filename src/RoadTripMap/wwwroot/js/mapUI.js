/**
 * Road Trip Map UI Layer
 * MapLibre GL JS rendering for map view — web-only, native apps would replace with MapKit/Google Maps
 * All data comes from MapService; UI handles DOM rendering and user interactions
 */

const MAPTILER_KEY = 'uctgdtdamYqEtDUPiPHB';
const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

const MapUI = {
    map: null,
    markers: [],
    routeVisible: false,
    carousel: null,
    markerLookup: null,

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text safe for HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Initialize map view for a trip
     * @param {string} viewToken - Trip view token
     */
    async init(viewToken) {
        try {
            const { trip, photos } = await MapService.loadTrip(viewToken);

            // Update page header with trip name
            const tripNameEl = document.getElementById('tripName');
            if (tripNameEl) {
                tripNameEl.textContent = trip.name;
            }

            // Render map
            this.renderMap(photos);
        } catch (error) {
            console.error('Failed to initialize map:', error);
            this.showError('Failed to load trip');
        }
    },

    /**
     * Render map with photo pins
     * @param {Array} photos - Array of PhotoResponse objects
     */
    renderMap(photos) {
        // Initialize MapLibre map
        this.map = new maplibregl.Map({
            container: 'map',
            style: MAP_STYLE,
            center: [-98.5795, 39.8283],
            zoom: 4
        });

        // Apply park restyling when map style loads
        this.map.on('load', () => {
            applyParkStyling(this.map);
            PoiLayer.init(this.map);
        });

        // Handle empty trip
        if (photos.length === 0) {
            this.map.jumpTo({ center: [-98.6, 39.8], zoom: 4 }); // Center of USA
            const emptyMsg = document.getElementById('emptyMessage');
            if (emptyMsg) {
                emptyMsg.style.display = 'block';
            }
            return;
        }

        // Header height for autopan offset (view page has fixed header)
        const headerHeight = document.querySelector('.map-header')?.offsetHeight || 0;

        // Build markerLookup and create markers for each photo
        this.markerLookup = new Map();
        photos.forEach(photo => {
            const popup = new maplibregl.Popup({
                offset: 25,
                closeButton: false,
                maxWidth: 'none',
                className: 'photo-map-popup'
            }).setHTML(this.createPopupHtml(photo));

            popup.on('open', () => {
                // Close all other popups (MapLibre allows multiple open)
                this.markers.forEach(m => {
                    if (m !== marker && m.getPopup().isOpen()) m.togglePopup();
                });
                if (this.carousel) {
                    this.carousel.selectPhoto(photo.id);
                }
                const popupEl = popup.getElement();
                if (popupEl) {
                    const img = popupEl.querySelector('.photo-popup-img');
                    if (img && !img.dataset.listenerAttached) {
                        img.dataset.listenerAttached = 'true';
                        img.style.cursor = 'pointer';
                        img.addEventListener('click', (e) => {
                            e.stopPropagation();
                            PhotoCarousel.showFullscreen(photo);
                        });
                    }
                    // Pan map to keep popup in view
                    this.panToFitPopup(this.map, popupEl);
                }
            });

            const marker = new maplibregl.Marker()
                .setLngLat([photo.lng, photo.lat])
                .setPopup(popup)
                .addTo(this.map);

            this.markers.push(marker);
            this.markerLookup.set(photo.id, marker);
        });

        // Initialize carousel BEFORE single-photo early return
        const carouselContainer = document.getElementById('viewCarousel');
        if (carouselContainer) {
            this.carousel = PhotoCarousel.init(carouselContainer, photos, {
                canDelete: false,
                onDelete: null,
                onSelect: (photo) => this.onCarouselSelect(photo)
            });
            carouselContainer.classList.add('active');
        }
        const routeToggleBtn = document.getElementById('routeToggle');
        if (routeToggleBtn) {
            routeToggleBtn.classList.add('above-carousel');
        }

        // Handle single photo
        if (photos.length === 1) {
            this.map.jumpTo({ center: [photos[0].lng, photos[0].lat], zoom: 13 });
            return;
        }

        // Handle multiple photos: auto-fit bounds with header-aware padding
        const bounds = new maplibregl.LngLatBounds();
        photos.forEach(p => bounds.extend([p.lng, p.lat]));
        this.map.fitBounds(bounds, {
            padding: { top: headerHeight + 50, bottom: 50, left: 50, right: 50 },
            maxZoom: 15
        });

        // Setup route toggle for multiple photos
        this.setupRouteToggle(photos);
    },

    /**
     * Create HTML for marker popup
     * @param {Object} photo - PhotoResponse object
     * @returns {string} - HTML string for popup content
     */
    createPopupHtml(photo) {
        const date = photo.takenAt ? new Date(photo.takenAt).toLocaleDateString() : 'Date unknown';
        const escapedPlaceName = this.escapeHtml(photo.placeName);
        const escapedCaption = this.escapeHtml(photo.caption);
        const saveBtn = this.createSaveButton(photo);
        return `<div class="photo-popup">
            <img src="${photo.displayUrl}" class="photo-popup-img">
            <div class="photo-popup-overlay">
                <div class="photo-popup-place">${escapedPlaceName}</div>
                ${escapedCaption ? `<div class="photo-popup-caption">${escapedCaption}</div>` : ''}
                <div class="photo-popup-date">${date}</div>
                ${saveBtn}
            </div>
        </div>`;
    },

    createSaveButton(photo) {
        if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
            return `<button class="photo-popup-save" onclick="MapUI.sharePhoto('${photo.originalUrl}', '${this.escapeHtml(photo.placeName)}')">Share</button>`;
        }
        return `<a href="${photo.originalUrl}" download class="photo-popup-save">Save</a>`;
    },

    async sharePhoto(url, title) {
        try {
            const fullUrl = window.location.origin + url;
            await navigator.share({ title: title || 'Photo', url: fullUrl });
        } catch (err) {
            if (err.name !== 'AbortError') console.warn('Share failed:', err);
        }
    },

    /**
     * Handle carousel selection: pan map, open popup, show fullscreen viewer
     * @param {Object} photo - PhotoResponse object
     */
    onCarouselSelect(photo) {
        const marker = this.markerLookup.get(photo.id);
        if (marker) {
            this.map.flyTo({ center: [photo.lng, photo.lat], zoom: 15 });
            if (!marker.getPopup().isOpen()) {
                marker.togglePopup();
            }
        }
        PhotoCarousel.showFullscreen(photo);
    },

    /**
     * Setup route toggle button for multiple photos
     * @param {Array} photos - Array of PhotoResponse objects
     */
    setupRouteToggle(photos) {
        if (photos.length < 2) return;
        const latLngCoords = MapService.getRouteCoordinates(photos);
        const coords = latLngCoords.map(([lat, lng]) => [lng, lat]);
        const smoothCoords = MapService.smoothRoute(coords);

        const addRoute = () => {
            if (this.map.getSource('route')) return;
            this.map.addSource('route', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: smoothCoords }
                }
            });
            this.map.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: { visibility: 'none' },
                paint: {
                    'line-color': '#2a9d8f',
                    'line-width': 2.5,
                    'line-opacity': 0.7,
                    'line-dasharray': [3, 2]
                }
            });
        };

        if (this.map.isStyleLoaded()) {
            addRoute();
        } else {
            this.map.once('idle', addRoute);
        }

        const routeToggleBtn = document.getElementById('routeToggle');
        if (routeToggleBtn) {
            routeToggleBtn.style.display = 'block';
            routeToggleBtn.addEventListener('click', () => this.toggleRoute());
        }
    },

    /**
     * Toggle route visibility
     */
    toggleRoute() {
        const routeToggleBtn = document.getElementById('routeToggle');
        if (this.routeVisible) {
            this.map.setLayoutProperty('route', 'visibility', 'none');
            if (routeToggleBtn) routeToggleBtn.textContent = 'Show Route';
        } else {
            this.map.setLayoutProperty('route', 'visibility', 'visible');
            if (routeToggleBtn) routeToggleBtn.textContent = 'Hide Route';
        }
        this.routeVisible = !this.routeVisible;
    },

    /**
     * Show error message
     * @param {string} message - Error message
     */
    showError(message) {
        const emptyMsg = document.getElementById('emptyMessage');
        if (emptyMsg) {
            emptyMsg.textContent = message;
            emptyMsg.style.display = 'block';
        }
    }
};
