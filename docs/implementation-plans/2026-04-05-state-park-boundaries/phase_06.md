# State Park Boundaries Implementation Plan — Phase 6

**Goal:** Client selects detail level based on connection quality and prefetches data at lower zoom levels

**Architecture:** Extend `stateParkLayer.js` with adaptive detail selection and predictive prefetch. Detail level is chosen based on `navigator.connection.downlink` (initial estimate) and measured API response times (ongoing adaptation). At zoom >= 7, background prefetch fires for the current viewport (simplified detail) and all detail levels for a ~100-mile radius. Prefetched data is stored in IndexedDB via `mapCache.js` and checked before making network requests.

**Tech Stack:** JavaScript / MapLibre GL JS / IndexedDB (via mapCache.js) / Network Information API

**Scope:** Phase 6 of 6 from original design

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### state-park-boundaries.AC3: Adaptive detail and caching
- **state-park-boundaries.AC3.1 Success:** On slow connection (downlink < 1 Mbps or measured response > 3s), client requests `simplified` detail
- **state-park-boundaries.AC3.2 Success:** On fast connection (downlink > 5 Mbps and response < 500ms), client requests `full` detail; otherwise `moderate`
- **state-park-boundaries.AC3.3 Success:** Detail level adapts mid-session based on measured response times, not just initial connection check
- **state-park-boundaries.AC3.5 Success:** At zoom 7, client prefetches simplified boundaries for viewport and all levels for ~100-mile radius in background

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add adaptive detail selection to stateParkLayer.js

**Verifies:** state-park-boundaries.AC3.1, state-park-boundaries.AC3.2, state-park-boundaries.AC3.3

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/stateParkLayer.js`

**Implementation:**

Add connection quality tracking and detail level selection to `StateParkLayer`. New private state and methods:

```javascript
// New state
_currentDetail: 'moderate',
_lastResponseMs: null,

// New methods
_selectDetailLevel() { ... },
_measureFetch(bounds, zoom, detail) { ... },
```

**`_selectDetailLevel()`** — Determines detail level from two signals:

1. **Initial estimate** from `navigator.connection` (if available):
   - `downlink < 1` → `'simplified'`
   - `downlink > 5` → `'full'`
   - Otherwise → `'moderate'`

2. **Measured response time** (overrides initial estimate mid-session):
   - `_lastResponseMs > 3000` → step down one level (full→moderate, moderate→simplified)
   - `_lastResponseMs < 500` → step up one level (simplified→moderate, moderate→full)
   - Otherwise → keep current level

If `navigator.connection` is not supported (Firefox, Safari), start at `'moderate'` and adapt from measured times only.

Store result in `_currentDetail`.

**`_measureFetch(bounds, zoom, detail)`** — Wraps `API.fetchParkBoundaries()` with timing:
```javascript
async _measureFetch(bounds, zoom, detail) {
    const start = performance.now();
    const result = await API.fetchParkBoundaries(bounds, zoom, detail);
    this._lastResponseMs = performance.now() - start;
    return result;
}
```

**Update `_loadBoundaries()`** — Replace direct `API.fetchParkBoundaries()` call with:
1. Call `_selectDetailLevel()` to determine detail
2. Call `_measureFetch(bounds, zoom, this._currentDetail)` instead of direct API call
3. Response time is automatically recorded for next adaptation

**Verification:**

Manual verification via DevTools:
1. Open DevTools → Network → Throttle to "Slow 3G"
2. Zoom to park area — verify Network tab shows `detail=simplified` in request URL
3. Remove throttle — zoom/pan to new area — after fast response, verify next request uses `detail=moderate` or `detail=full`
4. In Console, check `StateParkLayer._currentDetail` changes between requests

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add IndexedDB caching and predictive prefetch

**Verifies:** state-park-boundaries.AC3.4 (cache integration), state-park-boundaries.AC3.5 (prefetch)

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/stateParkLayer.js`

**Implementation:**

**Cache integration in `_loadBoundaries()`:**

Before making an API request, check IndexedDB for cached boundaries:

1. Get known cached IDs for current viewport: `await MapCache.getIds('park-boundary', viewportBounds)`
2. Make API request for viewport (API returns up to 50 parks)
3. For each feature in response:
   - If ID is already in cached set AND detail level matches, use cached version
   - Otherwise, store in cache: `await MapCache.put('park-boundary', id, detailLevel, feature)`
4. Merge cached + fresh features for rendering

The `data` object stored in cache must include the feature's centroid (from `properties.centroidLat/Lng`) so `MapCache.getIds()` can filter by viewport bounds.

**Predictive prefetch:**

Add new methods:

```javascript
_prefetchTimer: null,
_isPrefetching: false,

_setupPrefetchHandler() { ... },
_prefetchForViewport() { ... },
_expandBounds(bounds, milesToExpand) { ... },
```

**`_setupPrefetchHandler()`** — Listen for `moveend` events. If zoom >= 7 and zoom < 8 (the pre-render zone), trigger prefetch after 500ms debounce. Only one prefetch in flight at a time.

**`_prefetchForViewport()`:**
1. If `_isPrefetching`, return immediately
2. Set `_isPrefetching = true`
3. Fetch **simplified** boundaries for current viewport at zoom=8 (tells API to return data even though user is at zoom 7)
4. Store all results in IndexedDB via `MapCache.put()`
5. Expand viewport bounds by ~100 miles (~1.5 degrees at mid-latitudes) using `_expandBounds()`
6. For expanded bounds, fetch all three detail levels sequentially (simplified, moderate, full) and cache each
7. Set `_isPrefetching = false`

**`_expandBounds(bounds, milesToExpand)`** — Adds `milesToExpand / 69` degrees to each side of the bounds (1 degree ≈ 69 miles latitude). For longitude, adjusts by `milesToExpand / (69 * Math.cos(centerLat * Math.PI / 180))`.

**Error handling:** Prefetch failures are silent (console.warn only). They should not affect normal boundary loading.

**Update `init()`** — Call `_setupPrefetchHandler()` during initialization.

**Verification:**

Manual verification via DevTools:
1. Open DevTools → Network tab
2. Zoom to level 7 near a state park area
3. Verify background requests fire for `detail=simplified` at zoom=8
4. Verify additional requests fire for expanded bounds at all detail levels
5. Zoom to level 8 — verify boundaries render immediately from cache (no new network request in Network tab)
6. Check Application → IndexedDB → `roadtripmap-cache` → `map-data` to see cached entries

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/stateParkLayer.js
git commit -m "feat: add adaptive detail selection and predictive prefetch for state park boundaries"
```

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
