/**
 * Photo Carousel UI Module
 * Horizontal thumbnail strip with scroll-snap, selection highlighting, and save/delete actions.
 * Module pattern matching PostUI and MapUI; no build step required.
 */

const PhotoCarousel = {
    container: null,
    strip: null,
    photos: [],
    selectedPhotoId: null,
    config: {},
    itemMap: new Map(),

    /**
     * Initialize carousel in the given container
     * @param {HTMLElement} container - DOM element to render carousel into
     * @param {Array} photos - Array of photo objects
     * @param {Object} config - Configuration { canDelete: boolean, onDelete: function|null, onSelect: function|null }
     */
    init(container, photos, config) {
        this.container = container;
        this.photos = photos || [];
        this.config = config || {};
        this.itemMap.clear();
        this.selectedPhotoId = null;

        // Handle empty state: hide container and return early
        if (this.photos.length === 0) {
            this.container.style.display = 'none';
            return this;
        }

        this.container.style.display = '';
        this.container.innerHTML = '';

        // Create carousel strip container with scroll-snap
        this.strip = document.createElement('div');
        this.strip.className = 'carousel-strip';

        // Render each photo as a carousel item
        this.photos.forEach(photo => {
            const item = this.createCarouselItem(photo);
            this.strip.appendChild(item);
            this.itemMap.set(photo.id, item);
        });

        this.container.appendChild(this.strip);
        return this;
    },

    /**
     * Create a single carousel item element
     * @param {Object} photo - Photo object
     * @returns {HTMLElement} - Carousel item element
     */
    createCarouselItem(photo) {
        const item = document.createElement('div');
        item.className = 'carousel-item';
        item.dataset.photoId = photo.id;

        // Square thumbnail image
        const img = document.createElement('img');
        img.src = photo.thumbnailUrl;
        img.alt = photo.caption || photo.placeName || 'Photo';

        // Place name label below image
        const label = document.createElement('div');
        label.className = 'carousel-item-label';
        label.textContent = photo.placeName || 'Unknown';

        // Actions overlay container
        const actions = document.createElement('div');
        actions.className = 'carousel-item-actions';

        if (this.config.canDelete) {
            // Post page: show edit location + delete (no download)
            const editLocBtn = this.createEditLocationButton(photo);
            actions.appendChild(editLocBtn);
            const deleteBtn = this.createDeleteButton(photo);
            actions.appendChild(deleteBtn);
        } else {
            // View page: show download only
            const saveBtn = this.createSaveButton(photo);
            actions.appendChild(saveBtn);
        }

        // Assemble item
        item.appendChild(img);
        item.appendChild(actions);
        item.appendChild(label);

        // Selection handler
        item.addEventListener('click', () => {
            if (this.config.onSelect) {
                this.config.onSelect(photo);
            }
        });

        return item;
    },

    /**
     * Create save button with share/download fallback
     * @param {Object} photo - Photo object
     * @returns {HTMLElement} - Save button element
     */
    createSaveButton(photo) {
        const btn = document.createElement('button');
        btn.className = 'carousel-action-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Save photo');
        btn.title = 'Save or share';

        // Download icon SVG (download symbol)
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleSave(photo);
        });

        return btn;
    },

    /**
     * Handle save button click with Web Share API or download fallback
     * @param {Object} photo - Photo object
     */
    handleSave(photo) {
        if (typeof navigator.share === 'function') {
            navigator.share({
                title: photo.placeName || 'Photo',
                url: photo.originalUrl
            }).catch(err => {
                if (err.name !== 'AbortError') {
                    console.warn('Share failed:', err);
                }
            });
        } else {
            // Fallback: download the original image
            const link = document.createElement('a');
            link.href = photo.originalUrl;
            link.download = `photo-${photo.id}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    },

    /**
     * Create delete button
     * @param {Object} photo - Photo object
     * @returns {HTMLElement} - Delete button element
     */
    createDeleteButton(photo) {
        const btn = document.createElement('button');
        btn.className = 'carousel-action-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Delete photo');
        btn.title = 'Delete';

        // Trash icon SVG
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.config.onDelete) {
                this.config.onDelete(photo);
            }
        });

        return btn;
    },

    /**
     * Create edit location button
     * @param {Object} photo - Photo object
     * @returns {HTMLElement} - Edit location button element
     */
    createEditLocationButton(photo) {
        const btn = document.createElement('button');
        btn.className = 'carousel-action-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Edit location');
        btn.title = 'Edit location';

        // Map pin icon SVG
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.config.onEditLocation) {
                this.config.onEditLocation(photo);
            }
        });

        return btn;
    },

    /**
     * Select a photo by ID and scroll to it with highlight
     * @param {number} photoId - Photo ID to select
     */
    selectPhoto(photoId) {
        // Remove selected class from previously selected item
        if (this.selectedPhotoId !== null) {
            const prevItem = this.itemMap.get(this.selectedPhotoId);
            if (prevItem) {
                prevItem.classList.remove('selected');
            }
        }

        // Add selected class to new item
        const item = this.itemMap.get(photoId);
        if (item) {
            item.classList.add('selected');
            this.selectedPhotoId = photoId;

            // Smooth scroll into view
            item.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'center'
            });
        }
    },

    /**
     * Add a new photo to the carousel
     * @param {Object} photo - Photo object to add
     */
    addPhoto(photo) {
        // If container was hidden (empty state), show it
        if (this.container.style.display === 'none') {
            this.container.style.display = '';
        }

        // If strip doesn't exist, create it
        if (!this.strip) {
            this.strip = document.createElement('div');
            this.strip.className = 'carousel-strip';
            this.container.appendChild(this.strip);
        }

        // Create and add new item
        const item = this.createCarouselItem(photo);
        this.strip.appendChild(item);
        this.itemMap.set(photo.id, item);
        this.photos.push(photo);
    },

    /**
     * Remove a photo from the carousel by ID
     * @param {number} photoId - Photo ID to remove
     */
    removePhoto(photoId) {
        const item = this.itemMap.get(photoId);
        if (item) {
            item.remove();
        }

        this.itemMap.delete(photoId);
        this.photos = this.photos.filter(p => p.id !== photoId);

        // If no items remain, hide the container
        if (this.photos.length === 0) {
            this.container.style.display = 'none';
        }

        // Clear selection if deleted photo was selected
        if (this.selectedPhotoId === photoId) {
            this.selectedPhotoId = null;
        }
    },

    /**
     * Show a fullscreen image viewer overlay
     * @param {Object} photo - Photo object with displayUrl and originalUrl
     */
    showFullscreen(photo) {
        // Remove any existing overlay to prevent stacking
        const existing = document.querySelector('.fullscreen-overlay');
        if (existing) {
            existing.remove();
        }

        // Create the overlay container
        const overlay = document.createElement('div');
        overlay.className = 'fullscreen-overlay';

        // Create the image element using displayUrl (optimized for screen viewing)
        const img = document.createElement('img');
        img.src = photo.displayUrl;
        img.alt = photo.placeName || 'Photo';

        // Action buttons container
        const actions = document.createElement('div');
        actions.className = 'fullscreen-actions';

        // Save/download button (always shown)
        const saveBtn = document.createElement('button');
        saveBtn.className = 'fullscreen-action-btn carousel-action-btn';
        saveBtn.type = 'button';
        saveBtn.setAttribute('aria-label', 'Save photo');
        saveBtn.title = 'Save or share';
        saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            PhotoCarousel.handleSave(photo);
        });
        actions.appendChild(saveBtn);

        // Edit location + delete (post page only)
        if (this.config.canDelete) {
            const editLocBtn = document.createElement('button');
            editLocBtn.className = 'fullscreen-action-btn carousel-action-btn';
            editLocBtn.type = 'button';
            editLocBtn.setAttribute('aria-label', 'Edit location');
            editLocBtn.title = 'Edit location';
            editLocBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
            editLocBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                overlay.remove();
                if (this.config.onEditLocation) {
                    this.config.onEditLocation(photo);
                }
            });
            actions.appendChild(editLocBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'fullscreen-action-btn carousel-action-btn';
            deleteBtn.type = 'button';
            deleteBtn.setAttribute('aria-label', 'Delete photo');
            deleteBtn.title = 'Delete';
            deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                overlay.remove();
                if (this.config.onDelete) {
                    this.config.onDelete(photo);
                }
            });
            actions.appendChild(deleteBtn);
        }

        // Assemble overlay
        overlay.appendChild(img);
        overlay.appendChild(actions);

        // Handle close on background click (not on image or save button)
        const closeOverlay = () => {
            overlay.remove();
            document.removeEventListener('keydown', handleEscape);
        };

        overlay.addEventListener('click', (e) => {
            // Only close if clicking on the overlay background itself (not children)
            if (e.target === overlay) {
                closeOverlay();
            }
        });

        // Handle close on Escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeOverlay();
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Add to DOM
        document.body.appendChild(overlay);
    }
};
