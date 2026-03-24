/**
 * Road Trip Map UI Layer
 * Leaflet-specific rendering for map view — web-only, native apps would replace with MapKit/Google Maps
 * All data comes from MapService; UI handles DOM rendering and user interactions
 */

const MapUI = {
    map: null,
    markers: [],
    routeLayer: null,
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
     * Render Leaflet map with photo pins
     * @param {Array} photos - Array of PhotoResponse objects
     */
    renderMap(photos) {
        // Initialize Leaflet map with smooth panning
        this.map = L.map('map', {
            panAnimation: true,
            easeLinearity: 0.25
        });

        // Add OpenStreetMap tiles
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(this.map);

        // Handle empty trip
        if (photos.length === 0) {
            this.map.setView([39.8, -98.6], 4); // Center of USA
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
            const marker = L.marker([photo.lat, photo.lng]);
            marker.bindPopup(this.createPopupHtml(photo), {
                autoPan: true,
                autoPanPaddingTopLeft: L.point(10, headerHeight + 20),
                autoPanPaddingBottomRight: L.point(10, 20),
                autoPanAnimation: true
            });
            marker.addTo(this.map);
            this.markers.push(marker);

            // Build markerLookup for carousel-to-map sync
            this.markerLookup.set(photo.id, marker);

            // Add popupopen handler for map-to-carousel sync
            marker.on('popupopen', () => {
                if (this.carousel) {
                    this.carousel.selectPhoto(photo.id);
                }
            });
        });

        // Initialize carousel BEFORE single-photo early return
        const carouselContainer = document.getElementById('viewCarousel');
        this.carousel = PhotoCarousel.init(carouselContainer, photos, {
            canDelete: false,
            onDelete: null,
            onSelect: (photo) => this.onCarouselSelect(photo)
        });
        carouselContainer.classList.add('active');
        document.getElementById('routeToggle').classList.add('above-carousel');

        // Handle single photo
        if (photos.length === 1) {
            this.map.setView([photos[0].lat, photos[0].lng], 13);
            return;
        }

        // Handle multiple photos: auto-fit bounds with padding
        const group = new L.featureGroup(this.markers);
        this.map.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15 });

        // Setup route toggle for multiple photos
        this.setupRouteToggle(photos);
    },

    /**
     * Create HTML for marker popup
     * @param {Object} photo - PhotoResponse object
     * @returns {string} - HTML string for popup content
     */
    createPopupHtml(photo) {
        const date = new Date(photo.takenAt).toLocaleDateString();
        const escapedPlaceName = this.escapeHtml(photo.placeName);
        const escapedCaption = this.escapeHtml(photo.caption);
        const saveBtn = this.createSaveButton(photo);
        return `<div class="photo-popup">
            <img src="${photo.displayUrl}" class="photo-popup-img" loading="lazy">
            <div class="photo-popup-info">
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
            this.map.flyTo([photo.lat, photo.lng], 15);
            marker.openPopup();
        }
        PhotoCarousel.showFullscreen(photo);
    },

    /**
     * Setup route toggle button for multiple photos
     * @param {Array} photos - Array of PhotoResponse objects
     */
    setupRouteToggle(photos) {
        const coords = MapService.getRouteCoordinates(photos);
        this.routeLayer = L.polyline(coords, { color: '#3388ff', weight: 3, opacity: 0.8 });

        // Show route toggle button
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
        if (this.routeVisible) {
            this.map.removeLayer(this.routeLayer);
            const routeToggleBtn = document.getElementById('routeToggle');
            if (routeToggleBtn) {
                routeToggleBtn.textContent = 'Show Route';
            }
        } else {
            this.routeLayer.addTo(this.map);
            const routeToggleBtn = document.getElementById('routeToggle');
            if (routeToggleBtn) {
                routeToggleBtn.textContent = 'Hide Route';
            }
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
