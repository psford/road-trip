# Issue: State Park Boundary Loading is Cache-Last, Not Cache-First

**Date:** 2026-04-06
**Severity:** Performance
**Status:** Open — next development item

## Problem

`stateParkLayer.js._loadBoundaries()` always makes an API call on every `moveend` event, even when the viewport's boundaries are already cached in IndexedDB. Panning from Blue Hills to Stony Brook and back causes a full API round-trip + DB query each time, despite having just loaded those boundaries seconds earlier.

## Root Cause

The cache integration (Phase 6) was designed as cache-augmented, not cache-first:

```
Current flow (line 334-406 of stateParkLayer.js):
1. Check cache for IDs in viewport (MapCache.getIds)     ← happens
2. ALWAYS call API (this._measureFetch)                   ← problem
3. For each API result, check if cached version exists    ← pointless
4. Prefer cached version over API version                 ← wrong direction
5. Cache non-cached features in background                ← works
```

Step 2 fires unconditionally. The cache check in step 1 is only used to select between cached vs API versions of the same features — but since we already have the API version, this adds no value.

## Required Fix

Cache-first flow:

```
Correct flow:
1. Check cache for features in viewport (MapCache.getIds)
2. If cache has features for this viewport:
   a. Load cached features directly (MapCache.get for each)
   b. Render from cache immediately (setData)
   c. SKIP API call entirely
   d. Optionally: background refresh if cache is stale (TTL-based)
3. If cache is empty/partial for this viewport:
   a. Fetch from API
   b. Cache all results
   c. Render
```

## Performance Impact

- Current: every pan/zoom fires `GET /api/park-boundaries` (~200-500ms round trip to Azure)
- Expected: revisiting cached viewport should render in <50ms from IndexedDB
- User-visible: boundaries disappear momentarily on every pan, then redraw after network response

## Additional Considerations

- Cache should have a TTL or version check (boundary data changes rarely — monthly PAD-US updates)
- Consider caching the full GeoJSON FeatureCollection per viewport tile, not individual features
- The `getIds` → individual `get` per feature pattern is N+1 reads from IndexedDB; a bulk read would be faster
- Prefetch at zoom 7 populates cache but the cache is never used as primary source at zoom 8+

## Files

- `src/RoadTripMap/wwwroot/js/stateParkLayer.js` lines 334-406 (`_loadBoundaries`)
- `src/RoadTripMap/wwwroot/js/mapCache.js` (IndexedDB module — works correctly, just underused)

## Discovered During

Production testing on 2026-04-06 after state park boundaries feature deployed. Boundaries render but performance is poor due to unnecessary API calls on every viewport change.
