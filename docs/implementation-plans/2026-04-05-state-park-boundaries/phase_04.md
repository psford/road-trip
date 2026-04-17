# State Park Boundaries Implementation Plan — Phase 4

**Goal:** IndexedDB-backed persistent cache for map data

**Architecture:** New `mapCache.js` global namespace module using IndexedDB. Object store keyed by `{type}_{id}_{detailLevel}`. Provides `get`, `put`, `getIds`, and `clear` methods. No TTL or expiration — entries persist indefinitely. Designed for park boundaries now, extensible to POIs and NPS boundaries later via the `type` parameter.

**Tech Stack:** JavaScript / IndexedDB API / MapLibre GL JS

**Scope:** Phase 4 of 6 from original design

**Codebase verified:** 2026-04-05

---

## Acceptance Criteria Coverage

This phase implements and tests:

### state-park-boundaries.AC3: Adaptive detail and caching
- **state-park-boundaries.AC3.4 Success:** Fetched boundaries persist in IndexedDB across page reloads — revisiting same area loads from cache with no network request

---

<!-- START_TASK_1 -->
### Task 1: Create mapCache.js IndexedDB module

**Verifies:** state-park-boundaries.AC3.4

**Files:**
- Create: `src/RoadTripMap/wwwroot/js/mapCache.js`

**Implementation:**

Follow existing module pattern — global namespace object (`const MapCache = { ... }`). No ES modules, no imports.

**Database schema:**
- Database name: `roadtripmap-cache`
- Version: 1
- Object store: `map-data`
- Key path: composite string `{type}_{id}_{detailLevel}` (e.g., `park-boundary_123_moderate`)
- Indexed fields: `type` (for `getIds` filtering), `id`

**Module structure:**

```javascript
const MapCache = {
    _db: null,
    _dbName: 'roadtripmap-cache',
    _storeName: 'map-data',
    _version: 1,

    async _getDb() { ... },      // Lazy-open DB, cache in _db
    async get(type, id, detailLevel) { ... },    // → cached data or null
    async put(type, id, detailLevel, data) { ... }, // → stores entry
    async getIds(type, bounds) { ... },           // → Set of cached IDs in viewport
    async clear(type) { ... }                     // → clears all entries of type
};
```

**Method details:**

1. **`_getDb()`** — Opens IndexedDB lazily. On `onupgradeneeded`, creates object store with `keyPath: 'key'` and indexes on `type` and `id`. Caches DB reference in `_db` for subsequent calls.

2. **`get(type, id, detailLevel)`** — Builds key as `${type}_${id}_${detailLevel}`. Gets from object store by key. Returns the stored `data` field or `null`.

3. **`put(type, id, detailLevel, data)`** — Stores `{ key: '...', type, id, detailLevel, data }`. Uses `put` (not `add`) so it overwrites existing entries for the same key.

4. **`getIds(type, bounds)`** — Opens cursor on `type` index for the given type. For each entry, checks if the entry's stored centroid/bbox intersects with `bounds` (a `{minLat, maxLat, minLng, maxLng}` object). Returns a `Set` of matching IDs. The `data` field stored by `put` must include centroid or bbox for this check — the caller (stateParkLayer) is responsible for including it.

5. **`clear(type)`** — Opens cursor on `type` index, deletes all matching entries.

All methods are async and use IndexedDB transactions. Wrap in try/catch — if IndexedDB is unavailable (private browsing on some browsers), methods return gracefully (null/empty Set) without throwing.

**Verification:**

Run:
```bash
cd /home/patrick/projects/road-trip && dotnet build src/RoadTripMap/RoadTripMap.csproj
```
Expected: Build succeeds (static file served).

Manual verification: Open browser DevTools → Application → IndexedDB. After calling `MapCache.put('test', 1, 'full', {foo: 'bar'})` in console, verify entry appears. Reload page, call `MapCache.get('test', 1, 'full')` — verify data returns.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add mapCache.js script tag to HTML files

**Files:**
- Modify: `src/RoadTripMap/wwwroot/trips.html`
- Modify: `src/RoadTripMap/wwwroot/post.html`

**Implementation:**

Add `<script src="/js/mapCache.js"></script>` in both HTML files. Insert it after `api.js` and before `poiLayer.js` — the cache module has no dependencies on other app modules but must be available before `stateParkLayer.js` (added in Phase 5).

In `trips.html`, after the `api.js` script tag:
```html
<script src="/js/mapCache.js"></script>
```

In `post.html`, after the `api.js` script tag:
```html
<script src="/js/mapCache.js"></script>
```

**Verification:**

Open both pages in browser, open DevTools console, type `MapCache` — should show the module object. No console errors on page load.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/mapCache.js src/RoadTripMap/wwwroot/trips.html src/RoadTripMap/wwwroot/post.html
git commit -m "feat: add IndexedDB cache module for persistent map data storage"
```

<!-- END_TASK_2 -->
