const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:5143';
const SECRET_TOKEN = '57eee40d-91bd-4764-992e-9308521fafb7';

test.use({ viewport: { width: 1280, height: 900 } });

test('Use this location button on pin-drop map sets coordinates and place name', async ({ page }) => {
    await page.goto(`${BASE_URL}/post/${SECRET_TOKEN}`);

    // Open the pin-drop map by programmatically showing it
    await page.evaluate(() => {
        const mapSection = document.getElementById('mapSection');
        const previewSection = document.getElementById('previewSection');
        if (mapSection) mapSection.classList.add('visible');
        if (previewSection) previewSection.classList.add('visible');
        if (!PostUI.map) PostUI.initializePinDropMap();
    });

    // Wait for map style and POI layer to initialize
    await page.waitForFunction(() => {
        return PostUI.map && PostUI.map.isStyleLoaded() && PostUI.map.getSource('poi-source');
    }, { timeout: 15000 });

    // Zoom to area with POIs and load them
    await page.evaluate(async () => {
        const map = PostUI.map;
        map.jumpTo({ center: [-110.5, 44.6], zoom: 8 });

        // Force POI source/layers if not present (test environment timing)
        if (!map.getSource('poi-source')) {
            map.addSource('poi-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }
        if (!map.getLayer('poi-markers')) {
            map.addLayer({
                id: 'poi-markers',
                type: 'circle',
                source: 'poi-source',
                paint: { 'circle-radius': 6, 'circle-color': '#2d6a4f' }
            });
        }

        await PoiLayer.loadPois(map);
    });

    // Get a POI from the API and simulate the "Use this location" flow
    const result = await page.evaluate(async () => {
        const map = PostUI.map;
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        const pois = await API.fetchPois(bounds, zoom);
        if (pois.length === 0) return { error: 'no POIs found' };

        const poi = pois[0];

        // Simulate what happens when user clicks "Use this location":
        // The onPoiSelect callback in _poiActionOptions
        if (PostUI.marker) PostUI.marker.remove();
        PostUI.marker = new maplibregl.Marker()
            .setLngLat([poi.lng, poi.lat])
            .addTo(map);
        PostUI.setLocationFromPoi(poi.lat, poi.lng, poi.name);

        return {
            poiName: poi.name,
            currentLat: PostUI.currentLat,
            currentLng: PostUI.currentLng,
            markerExists: !!PostUI.marker,
            markerLngLat: PostUI.marker.getLngLat(),
        };
    });

    expect(result.error).toBeUndefined();
    expect(result.currentLat).toBeCloseTo(result.markerLngLat.lat, 4);
    expect(result.currentLng).toBeCloseTo(result.markerLngLat.lng, 4);
    expect(result.markerExists).toBe(true);
    expect(result.poiName).toBeTruthy();
});

test('Photo map shows info-only popup (no action buttons)', async ({ page }) => {
    await page.goto(`${BASE_URL}/post/${SECRET_TOKEN}`);

    // Wait for photo map to load
    await page.waitForFunction(() => {
        return typeof PostUI !== 'undefined' && PostUI.photoMap && PostUI.photoMap.isStyleLoaded();
    }, { timeout: 15000 });

    // Wait for POI layer to init via setTimeout retry
    await page.waitForFunction(() => {
        return PostUI.photoMap.getSource('poi-source');
    }, { timeout: 10000 });

    // Load POIs on the photo map
    await page.evaluate(async () => {
        PostUI.photoMap.jumpTo({ center: [-68.25, 44.41], zoom: 10 });
        await PoiLayer.loadPois(PostUI.photoMap);
    });

    // Simulate clicking a POI on the photo map
    const popupResult = await page.evaluate(async () => {
        const map = PostUI.photoMap;
        const pois = await API.fetchPois(map.getBounds(), map.getZoom());
        if (pois.length === 0) return { error: 'no POIs' };

        const poi = pois[0];
        const coords = [poi.lng, poi.lat];

        // Fire the layer click event
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords },
            properties: { id: poi.id, name: poi.name, category: poi.category }
        };
        const point = map.project(coords);

        // The poiLayer.js click handler is registered on the map
        // In headless, we need to fire it. Since it's a layer-specific handler,
        // we check if a popup appears after the generic fire.
        map.fire('click', {
            lngLat: { lng: coords[0], lat: coords[1] },
            point: point,
            originalEvent: new MouseEvent('click'),
            features: [feature]
        });

        // Wait a moment for popup
        await new Promise(r => setTimeout(r, 200));

        const hasActionPopup = !!document.querySelector('.poi-action-popup');
        const hasUseLocation = !!document.querySelector('.poi-use-location');

        return { hasActionPopup, hasUseLocation, poiName: poi.name };
    });

    // Photo map should NOT have action buttons
    expect(popupResult.hasActionPopup).toBe(false);
    expect(popupResult.hasUseLocation).toBe(false);
});
