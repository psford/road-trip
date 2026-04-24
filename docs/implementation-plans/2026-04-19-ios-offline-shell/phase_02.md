# iOS Offline Shell — Phase 2: `TripStorage` extension

**Goal:** Backward-compatible extension to existing `TripStorage` adding default-trip selection and role-derivation helpers consumed by Phases 3 (after-swap hook) and 5 (loader boot routing + glasses indicator rendering).

**Architecture:** Three additive methods on the existing `TripStorage` object literal — `markOpened(url)` writes a `lastOpenedAt` numeric timestamp on a matching record, `getDefaultTrip()` returns the most-recently-opened trip enriched with a derived `role` field, and `getRoleForUrl(url)` is a static utility for URL-pattern role classification. Existing `getTrips()` / `saveTrip()` / `removeTrip()` / `saveFromPostPage()` are untouched. Existing record shape `{name, postUrl, viewUrl, savedAt}` is preserved; `lastOpenedAt` is added as an additive optional field after the first `markOpened`.

**Tech Stack:** Vanilla JS, browser localStorage, vitest 4.0.0 + jsdom (`tests/js/`).

**Scope:** Phase 2 of 8 from the iOS Offline Shell design.

**Codebase verified:** 2026-04-19.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-offline-shell.AC2: Saved-trips routing and home screen
- **ios-offline-shell.AC2.3 Success:** `fetchAndSwap` of a saved trip URL calls `TripStorage.markOpened(url)`, updating `lastOpenedAt`. *(Phase 2 ships the `markOpened(url)` method; Phase 3 wires the call from `fetchAndSwap`.)*
- **ios-offline-shell.AC2.5 Edge:** Legacy `TripStorage` entries without `lastOpenedAt` use `addedAt` as fallback for default-trip selection. *(Implementation note: actual field name is `savedAt`, not `addedAt`. See Codebase divergences below.)*
- **ios-offline-shell.AC2.6 Failure:** `TripStorage.getTrips()` continues to return entries in the existing shape; existing web `index.html` rendering does not break.

(AC2.1, AC2.2, AC2.4 are verified in Phase 5 once the loader and rendering hook exist.)

---

## Codebase divergences from design (resolved in this plan)

The Phase 2 design contains two assumptions that don't match the current codebase. The implementation uses the actual codebase shape; the design AC text is preserved verbatim above for traceability.

1. **Page URL pattern for viewers.** Design Phase 2 ([line 200](../../../docs/design-plans/2026-04-19-ios-offline-shell.md#L200)) says the viewer page URL is `/trips/view/{viewToken}`. The actual route in [src/RoadTripMap/Program.cs](../../../src/RoadTripMap/Program.cs) maps `/trips/{viewToken}` to `trips.html` (no `/view/` segment). The API endpoint at `/api/trips/view/{viewToken}` does have `/view/`, but the page URL — what `TripStorage` actually stores — does not. **Implementation uses `^/trips/[^/]+$` for viewer.**
2. **Field name in AC2.5.** AC2.5 references `addedAt`. The actual field name in [src/RoadTripMap/wwwroot/js/tripStorage.js](../../../src/RoadTripMap/wwwroot/js/tripStorage.js) is `savedAt` (ISO 8601 string set by `new Date().toISOString()`). **Implementation uses `savedAt`** (parsed via `Date.parse()` for ordering).

---

## Module contract additions

| Method | Signature | Behavior | AC |
|---|---|---|---|
| `markOpened(url)` | `(url: string) → boolean` | Find record where `postUrl === url` OR `viewUrl === url`. Set `lastOpenedAt = Date.now()`. Persist. Return `true` on match, `false` otherwise. Silent fail on `localStorage.setItem` (matches `saveTrip` convention). | AC2.3 |
| `getDefaultTrip()` | `() → object \| null` | Iterate `getTrips()`. Score each as `record.lastOpenedAt ?? Date.parse(record.savedAt) ?? 0`. Return clone of the highest-scored record, enriched with `role: getRoleForUrl(record.postUrl)`. Return `null` for empty storage. | AC2.5 |
| `getRoleForUrl(url)` | `(url: string \| null \| undefined) → 'owner' \| 'viewer' \| 'unknown'` | Pure function. Defensive: returns `'unknown'` for non-strings, empty strings, malformed URLs. Matches against pathname only (works for absolute and relative URLs). | (used by Phases 3 + 5) |

`getTrips()`, `saveTrip()`, `removeTrip()`, `saveFromPostPage()` are unchanged. AC2.6.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Wire `tripStorage.js` into the test runner

**Verifies:** None (test infrastructure setup).

**Files:**
- Modify: `tests/js/setup.js` — add `tripStorage.js` to the wwwroot module loader list.

**Implementation:**

[tests/js/setup.js:79-92](../../../tests/js/setup.js#L79-L92) lists the wwwroot/js modules loaded into `globalThis` via the eval+regex transform. Insert `'tripStorage.js'` into that array. Pick the position that matches the file's existing convention (alphabetical or grouped near other storage modules — read the actual array first to decide).

Example diff (executor adapts to the actual file content):
```diff
   const modules = [
       'api.js',
       'mapCache.js',
+      'tripStorage.js',
       'storageAdapter.js',
       ...
   ];
```

**Verification:**
Run: `node --check src/RoadTripMap/wwwroot/js/tripStorage.js`
Expected: no output, exit 0.

Run: `npm test` (full suite)
Expected: passes; no regressions. If a test newly fails after adding the module to the loader, investigate (likely a globalThis name collision) before continuing.

**Commit:** `test(ios-offline-shell): load tripStorage.js into vitest globalThis`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Baseline tests for current `TripStorage` behavior

**Verifies:** `ios-offline-shell.AC2.6` (locks the existing shape via baseline tests; future tasks must keep these green).

**Files:**
- Create: `tests/js/tripStorage.test.js`

**Implementation:**

Note on localStorage: [tests/js/setup.js:71-75](../../../tests/js/setup.js#L71-L75) stubs `localStorage` globally with `vi.fn()` no-ops. For TripStorage tests we need a Map-backed implementation that round-trips:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let store;
beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});
```

Tests required:

**`describe('getTrips')`:**
- Empty localStorage → returns `[]`.
- Single saved record → returns `[{name, postUrl, viewUrl, savedAt}]`.
- Corrupt JSON in localStorage (set raw `'not json'`) → returns `[]` (does not throw).
- Two saved records → returns array in insertion order (most-recent first per `unshift` in current `saveTrip`).

**`describe('saveTrip')`:**
- New trip → record persists in localStorage. Verify by reading the raw stored value via `localStorage.getItem(TripStorage.STORAGE_KEY)` and `JSON.parse`.
- Stored shape matches: `{name, postUrl, viewUrl, savedAt}`. `Date.parse(savedAt)` returns a finite number.
- Same `postUrl` already stored → record is REPLACED (`trips.length === 1` after two `saveTrip` calls with the same `postUrl`).
- Different `postUrl` → record is PREPENDED (most-recent first), array length grows.
- localStorage.setItem throws (simulate by overriding the stub mid-test) → silent fail (no exception propagated).

**`describe('removeTrip')`:**
- Removes the record matching `postUrl`. Other records survive.
- No-op if no record matches.

**`describe('saveFromPostPage')`:**
- Mock `globalThis.API = { getTripInfoBySecret: vi.fn().mockResolvedValue({ name: 'X', viewUrl: '/trips/v1' }) }` (adjust to actual shape returned by `API.getTripInfoBySecret` — executor verifies in `api.js`).
- First call → API is invoked, record is saved.
- Second call with same `secretToken` → API is NOT invoked (dedup-before-fetch). Verify via `expect(API.getTripInfoBySecret).toHaveBeenCalledTimes(1)`.

**Verification:**
Run: `npm test -- tripStorage`
Expected: all tests pass against the unmodified `tripStorage.js`. If any baseline test fails, the test is wrong (not the module) — adjust the test, do not modify `tripStorage.js` yet.

**Commit:** `test(ios-offline-shell): baseline coverage for TripStorage existing behavior`
<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: `markOpened(url)` + `lastOpenedAt` field

**Verifies:** `ios-offline-shell.AC2.3`, `ios-offline-shell.AC2.6`.

**Files:**
- Modify: `tests/js/tripStorage.test.js` — add `describe('markOpened')` block (TDD: failing tests first).
- Modify: `src/RoadTripMap/wwwroot/js/tripStorage.js` — add `markOpened` method (additive only).

**Implementation (TDD: tests before code):**

Tests:

```js
describe('markOpened', () => {
    it('AC2.3: sets lastOpenedAt to Date.now() on the matching postUrl record', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        const before = Date.now();
        const matched = TripStorage.markOpened('/post/abc');
        const after = Date.now();
        expect(matched).toBe(true);
        const trip = TripStorage.getTrips()[0];
        expect(trip.lastOpenedAt).toBeGreaterThanOrEqual(before);
        expect(trip.lastOpenedAt).toBeLessThanOrEqual(after);
    });

    it('matches by viewUrl as well as postUrl', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        const matched = TripStorage.markOpened('/trips/aaa');
        expect(matched).toBe(true);
        expect(typeof TripStorage.getTrips()[0].lastOpenedAt).toBe('number');
    });

    it('returns false and does not modify storage when no record matches', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        const before = JSON.stringify(TripStorage.getTrips());
        const matched = TripStorage.markOpened('/post/never-saved');
        expect(matched).toBe(false);
        expect(JSON.stringify(TripStorage.getTrips())).toBe(before);
    });

    it('only updates the matched record, not siblings', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        TripStorage.saveTrip('Trip B', '/post/def', '/trips/bbb');
        TripStorage.markOpened('/post/abc');
        const tripsByPost = Object.fromEntries(TripStorage.getTrips().map(t => [t.postUrl, t]));
        expect(typeof tripsByPost['/post/abc'].lastOpenedAt).toBe('number');
        expect(tripsByPost['/post/def'].lastOpenedAt).toBeUndefined();
    });

    it('AC2.6: existing fields preserved after markOpened', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        const before = TripStorage.getTrips()[0];
        TripStorage.markOpened('/post/abc');
        const after = TripStorage.getTrips()[0];
        expect(after.name).toBe(before.name);
        expect(after.postUrl).toBe(before.postUrl);
        expect(after.viewUrl).toBe(before.viewUrl);
        expect(after.savedAt).toBe(before.savedAt);
    });
});
```

Implementation in `tripStorage.js` (additive — do NOT modify existing methods):

```js
markOpened(url) {
    const trips = this.getTrips();
    const idx = trips.findIndex(t => t.postUrl === url || t.viewUrl === url);
    if (idx < 0) return false;
    trips[idx] = { ...trips[idx], lastOpenedAt: Date.now() };
    try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trips));
    } catch {
        // localStorage unavailable — silent fail, matches saveTrip convention
    }
    return true;
},
```

**Verification:**
Run: `npm test -- tripStorage`
Expected: all `markOpened` tests pass; all baseline tests still pass.

**Commit:** `feat(ios-offline-shell): TripStorage.markOpened(url) sets lastOpenedAt`
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: `getDefaultTrip()` + `getRoleForUrl(url)` helper

**Verifies:** `ios-offline-shell.AC2.5`, `ios-offline-shell.AC2.6`.

**Files:**
- Modify: `tests/js/tripStorage.test.js` — add `describe('getDefaultTrip')` and `describe('getRoleForUrl')` blocks.
- Modify: `src/RoadTripMap/wwwroot/js/tripStorage.js` — add `getDefaultTrip` and `getRoleForUrl` methods.

**Implementation (TDD: tests before code):**

Tests:

```js
describe('getRoleForUrl', () => {
    it.each([
        ['/post/abc', 'owner'],
        ['/post/abc?query=x', 'owner'],
        ['https://app-roadtripmap-prod.azurewebsites.net/post/abc', 'owner'],
        ['/trips/xyz', 'viewer'],
        ['/trips/xyz?query=y', 'viewer'],
        ['https://app-roadtripmap-prod.azurewebsites.net/trips/xyz', 'viewer'],
        ['/', 'unknown'],
        ['/api/trips/view/xyz', 'unknown'],   // API URL, not a page URL
        ['/post/', 'unknown'],                 // empty token segment
        ['/trips/', 'unknown'],
        ['not a url', 'unknown'],              // defensive — must not throw
        ['', 'unknown'],
        [null, 'unknown'],
        [undefined, 'unknown'],
    ])('classifies %s as %s', (input, expected) => {
        expect(TripStorage.getRoleForUrl(input)).toBe(expected);
    });
});

describe('getDefaultTrip', () => {
    it('returns null when no trips are saved', () => {
        expect(TripStorage.getDefaultTrip()).toBeNull();
    });

    it('AC2.5 success: returns the trip with greatest lastOpenedAt', () => {
        TripStorage.saveTrip('Trip A', '/post/aaa', '/trips/aaa');
        TripStorage.saveTrip('Trip B', '/post/bbb', '/trips/bbb');
        TripStorage.markOpened('/post/aaa');
        // Wait one tick so subsequent timestamp is strictly greater
        const t = Date.now();
        while (Date.now() === t) { /* spin briefly */ }
        TripStorage.markOpened('/post/bbb');
        expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/bbb');
    });

    it('AC2.5 fallback: legacy entry without lastOpenedAt uses savedAt', () => {
        const legacy = [
            { name: 'Old', postUrl: '/post/old', viewUrl: '/trips/old', savedAt: '2026-01-01T00:00:00.000Z' },
            { name: 'New', postUrl: '/post/new', viewUrl: '/trips/new', savedAt: '2026-04-01T00:00:00.000Z' },
        ];
        localStorage.setItem(TripStorage.STORAGE_KEY, JSON.stringify(legacy));
        expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/new');
    });

    it('AC2.5 mixed: lastOpenedAt beats savedAt fallback', () => {
        const records = [
            { name: 'A', postUrl: '/post/a', viewUrl: '/trips/a', savedAt: '2026-04-01T00:00:00.000Z' },
            { name: 'B', postUrl: '/post/b', viewUrl: '/trips/b', savedAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: Date.now() },
        ];
        localStorage.setItem(TripStorage.STORAGE_KEY, JSON.stringify(records));
        expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/b');
    });

    it('returned record is enriched with role field', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        expect(TripStorage.getDefaultTrip().role).toBe('owner');
    });

    it('AC2.6: returned record preserves existing fields', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        const defaultTrip = TripStorage.getDefaultTrip();
        expect(defaultTrip).toMatchObject({
            name: 'Trip A',
            postUrl: '/post/abc',
            viewUrl: '/trips/aaa',
        });
        expect(typeof defaultTrip.savedAt).toBe('string');
    });

    it('handles unparseable savedAt by treating as 0 (lowest priority)', () => {
        const records = [
            { name: 'A', postUrl: '/post/a', viewUrl: '/trips/a', savedAt: 'not-a-date' },
            { name: 'B', postUrl: '/post/b', viewUrl: '/trips/b', savedAt: '2026-01-01T00:00:00.000Z' },
        ];
        localStorage.setItem(TripStorage.STORAGE_KEY, JSON.stringify(records));
        expect(TripStorage.getDefaultTrip().postUrl).toBe('/post/b');
    });

    it('returns a clone (mutating result does not affect storage)', () => {
        TripStorage.saveTrip('Trip A', '/post/abc', '/trips/aaa');
        const defaultTrip = TripStorage.getDefaultTrip();
        defaultTrip.name = 'Mutated';
        expect(TripStorage.getTrips()[0].name).toBe('Trip A');
    });
});
```

Implementation:

```js
getRoleForUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return 'unknown';
    let pathname;
    try {
        pathname = new URL(url, 'https://app-roadtripmap-prod.azurewebsites.net').pathname;
    } catch {
        return 'unknown';
    }
    if (/^\/post\/[^/]+$/.test(pathname)) return 'owner';
    if (/^\/trips\/[^/]+$/.test(pathname)) return 'viewer';
    return 'unknown';
},

getDefaultTrip() {
    const trips = this.getTrips();
    if (trips.length === 0) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const t of trips) {
        const score = typeof t.lastOpenedAt === 'number'
            ? t.lastOpenedAt
            : (Date.parse(t.savedAt) || 0);
        if (score > bestScore) {
            bestScore = score;
            best = t;
        }
    }
    return best ? { ...best, role: this.getRoleForUrl(best.postUrl) } : null;
},
```

Notes for executor:
- Both methods are additive. No existing method's signature or behavior changes (AC2.6).
- `getDefaultTrip()` returns a *clone* (object spread) so callers can mutate without affecting storage — verified by the "returns a clone" test.
- The role is derived from `postUrl`. For future view-only saved trips (no `postUrl`), Phase 5 rendering will call `getRoleForUrl(record.viewUrl)` directly; the helper is generic over any URL.

**Verification:**
Run: `npm test -- tripStorage`
Expected: all new tests pass; baseline + markOpened tests still pass.

Run: `npm test`
Expected: full suite passes.

```bash
# Confirm no consumer file changed unexpectedly
git diff --stat src/RoadTripMap/wwwroot/index.html src/RoadTripMap/wwwroot/create.html src/RoadTripMap/wwwroot/js/postUI.js
# Expected: empty (Phase 2 only modifies tripStorage.js + setup.js + tripStorage.test.js)
```

**Commit:** `feat(ios-offline-shell): TripStorage.getDefaultTrip() + getRoleForUrl() helpers`
<!-- END_TASK_4 -->
<!-- END_SUBCOMPONENT_B -->
