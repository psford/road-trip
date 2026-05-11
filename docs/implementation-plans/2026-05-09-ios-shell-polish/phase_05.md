# iOS Shell Polish — Phase 5: Cross-page motion and skeleton loaders

**Goal:** Polish the in-between. Page transitions on document swap (animate-out → fetch → swap → animate-in). Skeleton loaders for the photo carousel and trip list during fetch. Spring-feel timings via Phase 1 motion tokens. Reduced-motion users get instant swaps. Rapid back-to-back navigations don't stack or visually corrupt.

**Architecture:** Two independent sub-deliveries.

1. **Sequencing fix (Task 1, prerequisite):** The investigator confirmed the design plan's prescient warning ("Document-swap transition sequencing... If implementation reveals a sequencing problem, ship the no-transition version"). The current `_executedScriptSrcs` dedup in `fetchAndSwap.js` can be poisoned by stale-swap script onload callbacks under rapid navigation, causing later navigations to skip script injection and render broken pages. Phase 5 fixes this **first** — the fix benefits the project regardless of whether transitions ship.

2. **Transitions + skeletons (Tasks 2–6):** Pure-CSS animations scoped under `.platform-ios` so browsers stay instant. Body-level `transform` + `opacity` keyframes triggered by `_swapFromHtml` adding `.page-out` / `.page-in` classes. Reduced-motion handled in CSS (`@media (prefers-reduced-motion: reduce)` zeros animation duration). Skeleton placeholders injected by `postUI.js` and `mapUI.js` into their carousel containers before the data fetch resolves.

**De-scope ladder (per design plan):** if Tasks 2–3 reveal residual sequencing issues during implementation, ship Tasks 1 + 4–7 only (skeletons, no transitions). The design's de-scope ladder explicitly puts Phase 5 motion at the top of "what to cut." Skeletons are independent of the transition mechanic and ship regardless.

**Tech Stack:** vanilla JS in `src/bootstrap/fetchAndSwap.js`, vanilla CSS keyframes + `@media (prefers-reduced-motion)`, `globalThis.matchMedia` (no JS gating needed; CSS handles it).

**Scope:** Phase 5 of 6 from `docs/design-plans/2026-05-09-ios-shell-polish.md`.

**Codebase verified:** 2026-05-10. See discrepancies below.

**Discrepancies from design — read carefully:**
- **The design's "Skip animation when reduced-motion is preferred or when `Native` is unavailable"** is implemented in CSS by scoping all motion rules under `.platform-ios` (browsers without the iOS shell never get the rules) and under `@media not (prefers-reduced-motion: reduce)` (reduced-motion users skip). No runtime `globalThis.Native` check in JS — cleaner, fewer race conditions.
- **Animation surface:** `<body>` directly. Investigator confirmed body-level `transform`/`opacity` does not interfere with `position: fixed` chrome (`.toast-container`, `.fullscreen-overlay`) since `position: fixed` paints in the fixed-element layer with its own stacking context. No new wrapper-div markup needed.
- **`_executedScriptSrcs` race condition is real and pre-existing.** The investigator demonstrated the failure mode (rapid post→create→post: stale onload from swap 1 adds `/js/postUI.js` to the Set after swap 2 has already replaced the body, swap 3 then skips postUI.js injection → page renders without handlers). Fix: a swap-generation tracker (counter incremented on each `_swapFromHtml` call; script `dataset.swapGen` checked in onload before mutating Set). Implementation in Task 1.
- **No `prefers-reduced-motion` rules exist** anywhere in the codebase today (verified by grep). Phase 5 introduces the first such usage.
- **No skeleton/shimmer styles exist** today. Phase 5 introduces the first.
- **The carousel containers are JS-cleared before render** (`postUI.js:932`, `mapUI.js:127`). Skeleton placeholders are injected during the loading window and replaced on first render (no separate "remove skeleton" step needed — the existing `container.innerHTML = ''` clear takes care of removal).

**Recommended skills for executor (activate before starting):**
- `ed3d-plan-and-execute:test-driven-development` (the rapid-navigation race-condition fix in Task 1 has a clear failing test → fix → passing test arc)
- `ed3d-plan-and-execute:systematic-debugging` (Task 3's animate-out → swap → animate-in interaction with `app:page-load` ordering will need investigation if a regression appears)
- `ed3d-house-style:writing-good-tests`
- `ed3d-plan-and-execute:verification-before-completion`

---

## Acceptance Criteria Coverage

This phase implements and tests:

### ios-shell-polish.AC7: Cross-page motion and skeletons
- **ios-shell-polish.AC7.1 Success:** Cross-page navigation in the iOS shell shows an animate-out, swap, animate-in transition.
- **ios-shell-polish.AC7.2 Success:** With `prefers-reduced-motion: reduce`, transitions are bypassed; swap is instant.
- **ios-shell-polish.AC7.3 Success:** Initial fetch of the photo carousel and trip list shows skeleton placeholders that vanish when real content arrives.
- **ios-shell-polish.AC7.4 Failure:** Rapid back-to-back navigations do not stack or visually corrupt the transition.

---

<!-- START_SUBCOMPONENT_A (tasks 1) -->
<!-- START_TASK_1 -->
### Task 1: Fix `_executedScriptSrcs` race condition with swap-generation tracking

**Type:** Functionality (correctness fix; precondition for AC7.4 and broader rapid-nav reliability).

**Verifies:** ios-shell-polish.AC7.4 (rapid back-to-back navigations don't stack or visually corrupt — Tasks 2–3 layer the transitions on top of this stable substrate).

**Files:**
- Modify: `src/bootstrap/fetchAndSwap.js` — `_swapFromHtml` (lines ~70–155 per investigator) and `_recreateScripts` (the script-injection helper).
- Modify: `tests/js/fetchAndSwap.test.js` — add a `describe('Rapid-navigation race conditions')` block.

**Implementation:**

1. Add a module-scoped counter:
   ```javascript
   let _swapGeneration = 0;
   ```

2. Increment at the top of `_swapFromHtml`:
   ```javascript
   async function _swapFromHtml(html, url) {
       _swapGeneration += 1;
       const myGen = _swapGeneration;
       // ... existing body ...
   }
   ```

3. In `_recreateScripts` (or wherever each external script element is created and its onload handler attached), tag the script element and pass `myGen` through the closure:
   ```javascript
   function _recreateScripts(scripts, target, myGen) {
       // existing logic that builds Promises for each script.onload
       // For each script with src:
       script.dataset.swapGen = String(myGen);
       script.onload = () => {
           // Only mutate _executedScriptSrcs if THIS swap generation is still current
           // OR if the dataset.swapGen on this element matches what was current when
           // it was created.
           // The simpler check: only add to Set if the script's gen matches the
           // current generation. Stale onloads from earlier swaps (whose generation
           // is now < _swapGeneration) silently resolve without polluting the Set.
           if (Number(script.dataset.swapGen) === _swapGeneration) {
               _executedScriptSrcs.add(script.src);
           }
           resolve();
       };
   }
   ```

4. Pass `myGen` through `_swapFromHtml` to `_recreateScripts`:
   ```javascript
   // In _swapFromHtml:
   await _recreateScripts(extractedScripts, document.body, myGen);
   ```

**Why this works:**
- Each call to `_swapFromHtml` gets a unique generation number.
- Scripts attached during that call carry the generation tag.
- When a script's onload eventually fires (possibly long after the body has been re-swapped by a newer call), the check `Number(script.dataset.swapGen) === _swapGeneration` is FALSE for stale loads, so the Set is not polluted.
- The current generation's onloads still update the Set normally.

**Edge case — current generation changes mid-onload:** if a third swap fires between step 2 and step 3 (the onload), the generation has already moved on. The "current" onload becomes stale. This is correct: the third swap's `_recreateScripts` call will inject those same scripts fresh under the third generation, taking precedence.

**Tests** (`tests/js/fetchAndSwap.test.js`, new describe block):

- `it('a stale-swap script onload does not pollute _executedScriptSrcs')` —
  1. Stub fetch to return post.html on first call, create.html on second, post.html on third.
  2. Call `fetchAndSwap('/post/abc')` (Swap 1). Don't await yet — capture the in-flight script-onload promise.
  3. Call `fetchAndSwap('/create')` (Swap 2). Await it.
  4. Manually fire the captured Swap-1 script's onload now (simulating the stale callback firing late).
  5. Call `fetchAndSwap('/post/abc')` (Swap 3).
  6. Assert that during Swap 3, the post.html scripts WERE re-injected (not skipped because of Set pollution from the stale Swap-1 onload). Verify by spying on `appendChild` calls during Swap 3 and asserting `/js/postUI.js` was injected.

- `it('current-generation onload still adds to _executedScriptSrcs (dedup still works)')` —
  Single-swap scenario: load post.html, await, load post.html again — verify `/js/postUI.js` is NOT re-injected the second time (preserves the dedup invariant for non-rapid-navigation case).

- `it('three rapid swaps complete without crashing')` — fire three consecutive `fetchAndSwap` calls without awaiting; await all three together; assert all resolved successfully and no exceptions thrown.

**Verification:**

Run: `npm test -- tests/js/fetchAndSwap`
Expected: existing 1021-line suite still passes (no regression to current behavior); new tests pass.

**Commit:**

```bash
git add src/bootstrap/fetchAndSwap.js tests/js/fetchAndSwap.test.js
git commit -m "fix(fetchAndSwap): swap-generation tracker prevents stale-onload script-skip

Pre-existing race condition: when the user navigates rapidly (post -> create
-> post in quick succession), the _executedScriptSrcs dedup Set could be
poisoned by a script onload from an earlier swap firing AFTER a later swap
had already replaced the body. The third navigation would then find the
script in the Set and skip injection, leaving the page without handlers.

Fix: each _swapFromHtml call gets a generation number. Scripts created
during that call carry the gen as dataset.swapGen. The onload handler
only mutates the Set if its tagged generation still matches the current
generation; stale onloads silently resolve without polluting.

Pre-condition for Phase 5 transitions (Tasks 2-3) but a correctness win
on its own. The design plan flagged this exact sequencing risk."
```
<!-- END_TASK_1 -->
<!-- END_SUBCOMPONENT_A -->

---

<!-- START_SUBCOMPONENT_B (tasks 2-3) -->
<!-- START_TASK_2 -->
### Task 2: CSS keyframes + classes for page-out/page-in + skeleton shimmer

**Type:** Functionality (visual; class-based animation hooks for Task 3 to drive).

**Verifies:** ios-shell-polish.AC7.1 (animation rules ready), ios-shell-polish.AC7.2 (reduced-motion bypass in CSS), ios-shell-polish.AC7.3 (skeleton shimmer styles ready).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/css/styles.css` — append a `/* Phase 5: motion + skeletons */` section near the end.
- Modify: `src/RoadTripMap/wwwroot/ios.css` — append a `/* Phase 5: page transitions (iOS shell only) */` section.

**Implementation — `styles.css` (universal: skeleton styles + reduced-motion override):**

```css
/* Phase 5: skeleton placeholders — universal, used by postUI/mapUI */
@keyframes shimmer {
  0%   { opacity: 0.55; }
  50%  { opacity: 1; }
  100% { opacity: 0.55; }
}

.skeleton {
  background-color: var(--color-fill-secondary);
  border-radius: var(--radius-md);
  animation: shimmer 1.4s var(--motion-ease-standard) infinite;
}

.skeleton-carousel-item {
  width: 100px;
  height: 100px;
  flex-shrink: 0;
  margin-right: var(--space-sm);
}

.skeleton-photo-row {
  width: 100%;
  height: 80px;
  margin-bottom: var(--space-sm);
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
    opacity: 0.7;
  }
}
```

**Implementation — `ios.css` (iOS-only: page transitions):**

```css
/* Phase 5: page transitions — iOS shell only */
@keyframes page-out {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-8px); }
}

@keyframes page-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.platform-ios body.page-out {
  animation: page-out var(--motion-duration-fast) var(--motion-ease-accelerate) both;
  pointer-events: none; /* prevent accidental taps mid-animation */
}

.platform-ios body.page-in {
  animation: page-in var(--motion-duration-normal) var(--motion-ease-decelerate) both;
}

@media (prefers-reduced-motion: reduce) {
  .platform-ios body.page-out,
  .platform-ios body.page-in {
    animation-duration: 0.001ms !important; /* effectively instant; still fires animationend */
  }
}
```

Notes:
- `animation-duration: 0.001ms` (rather than `animation: none`) ensures the JS-side `animationend` listener still fires, so the Task 3 promise resolves promptly. `animation: none` would cause the listener never to fire — JS would hang forever waiting for `animationend`. The 0.001ms duration is invisible to humans but observable to the listener.
- `pointer-events: none` on `body.page-out` blocks tap-during-animation, preventing the user from queueing another navigation mid-fade. Combined with Task 1's generation tracker, this gives belt-and-suspenders rapid-nav safety.
- The `transform: translateY(±8px)` keeps motion subtle. iOS uses small vertical shifts on push-style transitions.

**Verification:**

Run: `npm test`
Expected: all tests pass (no JS changes yet).

Manual visual check: ❌ skeletons + transitions aren't wired yet — Tasks 3 + 4 add the JS.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/css/styles.css src/RoadTripMap/wwwroot/ios.css
git commit -m "feat(motion-css): page-transition + skeleton shimmer keyframes

styles.css adds .skeleton + .skeleton-carousel-item + .skeleton-photo-row
classes (universal — works in browser too) with shimmer keyframe and
reduced-motion fallback (no animation, fixed opacity).

ios.css adds .page-out / .page-in keyframes scoped under .platform-ios
body. Reduced-motion uses 0.001ms duration so the animationend listener
still fires (Task 3 awaits it). pointer-events: none during page-out
blocks accidental tap-during-fade."
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Wrap `_swapFromHtml` in animate-out → swap → animate-in

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC7.1, ios-shell-polish.AC7.2, ios-shell-polish.AC7.4 (with Task 1's generation tracker as the substrate).

**Files:**
- Modify: `src/bootstrap/fetchAndSwap.js` — wrap the existing `_swapFromHtml` body.

**Implementation:**

The wrapper must preserve the existing event-ordering contract (per design's Additional Considerations):
- Scripts must execute before `app:page-load` fires.
- `app:page-load` must fire before `markOpened`.
- The animate-in animation should start AFTER `app:page-load` is dispatched (so onPageLoad handlers run while the fade-in is happening — feels snappier).

```javascript
async function _swapFromHtml(html, url) {
    const myGen = ++_swapGeneration;

    // Skip animation entirely if NOT in the iOS shell — browsers get the
    // existing behavior (instant swap). The .platform-ios class is the
    // gate, but we also need to skip the JS animation choreography for
    // browsers to avoid unnecessary class-add/remove churn.
    const isShell = document.body.classList.contains('platform-ios');

    if (isShell) {
        await _animatePageOut(); // adds .page-out, awaits animationend, removes class
    }

    // ... existing _swapFromHtml body unchanged: parse, rewriteAssetTags,
    // strip scripts, swap head/body innerHTML, swap body attributes
    // (this re-adds .platform-ios since we copy class list from incoming body),
    // recreate scripts (passing myGen from Task 1), clearPageLifecycleListeners,
    // dispatchEvent('app:page-load'), markOpened, revoke blob URLs.
    // ...

    if (isShell) {
        // Fire-and-forget — don't await page-in. onPageLoad handlers can
        // start their own work in parallel; the user sees the fade-in
        // overlapping with content rendering, which feels native.
        void _animatePageIn();
    }
}

async function _animatePageOut() {
    return new Promise((resolve) => {
        const onEnd = () => {
            document.body.removeEventListener('animationend', onEnd);
            document.body.classList.remove('page-out');
            resolve();
        };
        // Safety net — if animationend doesn't fire (rare browser quirk),
        // resolve after the max expected duration + 50ms buffer.
        const safetyTimeout = setTimeout(() => {
            document.body.removeEventListener('animationend', onEnd);
            document.body.classList.remove('page-out');
            resolve();
        }, 250);
        document.body.addEventListener('animationend', () => {
            clearTimeout(safetyTimeout);
            onEnd();
        }, { once: true });
        document.body.classList.add('page-out');
    });
}

async function _animatePageIn() {
    return new Promise((resolve) => {
        const safetyTimeout = setTimeout(() => {
            document.body.removeEventListener('animationend', onEnd);
            document.body.classList.remove('page-in');
            resolve();
        }, 400);
        const onEnd = () => {
            clearTimeout(safetyTimeout);
            document.body.removeEventListener('animationend', onEnd);
            document.body.classList.remove('page-in');
            resolve();
        };
        document.body.addEventListener('animationend', onEnd, { once: true });
        document.body.classList.add('page-in');
    });
}
```

Notes:
- The body class list survives the swap because Task 1's swap routine copies the incoming body's class list and re-adds `platform-ios`. The `.page-out` class is removed BEFORE the swap (it was already removed by `_animatePageOut`'s resolve). The `.page-in` class is added AFTER the swap (by `_animatePageIn`).
- Edge case: if `_animatePageIn` is called and a NEW swap starts before the fade-in completes, the body class list is replaced by the new swap's body's classes. The old `.page-in` is gone; the new swap's animate-out runs cleanly. The old `setTimeout` safety net still fires harmlessly later (it just removes a class that's already gone).
- The `pointer-events: none` from Task 2's `.page-out` rule ensures the user can't tap during the 200ms fade-out window. After fade-out completes, the class is removed, pointer events re-enable. (The `.page-in` class doesn't disable pointer events because the user should be able to interact with the new page immediately.)

**Reduced-motion bypass:** purely CSS. The `0.001ms` animation duration in Task 2's reduced-motion media query means `animationend` fires almost immediately, both promises resolve immediately, the user perceives an instant swap. No JS changes needed.

**Verification:**

Tests in Task 6 cover lifecycle. Manual on-device verification in Task 8.

**Commit:**

```bash
git add src/bootstrap/fetchAndSwap.js
git commit -m "feat(fetchAndSwap): page-out / page-in animation around document swap

In the iOS shell only, _swapFromHtml now:
1. Awaits a page-out animation (200ms fade + slight translateY-8px)
2. Performs the existing parse/swap/scripts/dispatch sequence
3. Fires a page-in animation (300ms fade + translateY+8px → 0)

Browser path is unchanged (no .platform-ios class -> no JS animation
gating). Reduced-motion is handled in CSS by the Task 2 media query
(0.001ms duration ensures animationend still fires; user perceives
instant swap).

Animation classes are added/removed via animationend listeners with
safety-net setTimeouts. The Task 1 generation tracker provides the
underlying script-dedup safety for rapid-nav scenarios."
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_B -->

---

<!-- START_SUBCOMPONENT_C (tasks 4-5) -->
<!-- START_TASK_4 -->
### Task 4: Skeleton placeholder injection in `postUI.js` photo-list initial fetch

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC7.3 (post.html half).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/postUI.js` — `loadPhotoList` (lines ~898–943, executor verify with `grep -n "loadPhotoList\|listPhotos" src/RoadTripMap/wwwroot/js/postUI.js`).

**Implementation:**

Before `await PostService.listPhotos(secretToken)`, inject 3 skeleton placeholders into the carousel container. After the promise resolves, the existing `container.innerHTML = ''` clear (line ~932) removes them; `PhotoCarousel.init` renders the real items.

```javascript
async loadPhotoList() {
    const container = document.getElementById('photoCarousel');
    if (!container) return;

    // Skeleton placeholders during fetch (Phase 5)
    container.innerHTML =
        '<div class="skeleton skeleton-carousel-item"></div>' +
        '<div class="skeleton skeleton-carousel-item"></div>' +
        '<div class="skeleton skeleton-carousel-item"></div>';

    try {
        const photos = await PostService.listPhotos(this.secretToken);
        // existing render logic — first line is something like:
        // container.innerHTML = '';
        // PhotoCarousel.init(container, photos, { ... });
        // The clear automatically removes the skeletons.
    } catch (err) {
        // existing error path — likely renders an error state into the container
        // which also overwrites the skeletons.
    }
}
```

Notes:
- The existing error-path code already renders an error state by writing into the container, which naturally replaces skeletons.
- If the list is empty (zero photos), the existing render path produces an empty container — skeletons are still removed because `container.innerHTML = ''` runs unconditionally.
- 3 placeholders is an aesthetic choice; matches typical iOS Photos-grid placeholders.

**Tests** (extend `tests/js/postUI-upload.test.js` or create `tests/js/postUI-skeletons.test.js`):

- `it('injects skeleton placeholders before listPhotos resolves')` — stub `PostService.listPhotos` to return a never-resolving Promise; call `loadPhotoList`; query the container for `.skeleton-carousel-item`; assert 3 are present.
- `it('removes skeletons after listPhotos resolves with content')` — resolve listPhotos with a sample photo list; await; assert no `.skeleton-carousel-item` in the container; assert real carousel items rendered.
- `it('removes skeletons after listPhotos rejects')` — reject listPhotos; await; assert no `.skeleton-carousel-item` in the container.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/postUI.js tests/js/postUI-upload.test.js
git commit -m "feat(postUI): skeleton placeholders in photo carousel during fetch

3 .skeleton .skeleton-carousel-item divs injected before listPhotos
awaits. The existing render path's container.innerHTML = '' clear
removes them when content arrives (or when an error renders).

Reduced-motion users see static (non-shimmering) placeholders per
Task 2's @media (prefers-reduced-motion) override."
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Skeleton placeholder injection in `mapUI.js` view-carousel initial fetch

**Type:** Functionality.

**Verifies:** ios-shell-polish.AC7.3 (trips.html half).

**Files:**
- Modify: `src/RoadTripMap/wwwroot/js/mapUI.js` — the photo-list fetch entry point (around the `PhotoCarousel.init` call near line ~127, executor verify with `grep -n "viewCarousel\|getViewTripPhotos\|PhotoCarousel.init" src/RoadTripMap/wwwroot/js/mapUI.js`).

**Implementation:**

Same pattern as Task 4 but targeting `#viewCarousel`:

```javascript
async init(viewToken) {
    // ... existing setup ...

    const carousel = document.getElementById('viewCarousel');
    if (carousel) {
        carousel.innerHTML =
            '<div class="skeleton skeleton-carousel-item"></div>' +
            '<div class="skeleton skeleton-carousel-item"></div>' +
            '<div class="skeleton skeleton-carousel-item"></div>';
    }

    try {
        const photos = await MapService.getViewTripPhotos(viewToken);
        // existing render logic clears + populates the container
    } catch (err) {
        // existing error path overwrites the skeletons
    }
}
```

**Tests** (extend or create `tests/js/mapUI.test.js` from Phase 3):

- `it('mapUI.init injects skeletons in #viewCarousel before fetch resolves')` — same structure as Task 4 test.
- `it('mapUI.init removes skeletons after fetch resolves')`.
- `it('mapUI.init removes skeletons after fetch rejects')`.

**Commit:**

```bash
git add src/RoadTripMap/wwwroot/js/mapUI.js tests/js/mapUI.test.js
git commit -m "feat(mapUI): skeleton placeholders in view carousel during fetch

Same shape as postUI Task 4: 3 .skeleton .skeleton-carousel-item divs
in #viewCarousel before MapService.getViewTripPhotos awaits, replaced
on success or error path."
```
<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_C -->

---

<!-- START_SUBCOMPONENT_D (tasks 6) -->
<!-- START_TASK_6 -->
### Task 6: Extend `tests/js/fetchAndSwap.test.js` with transition lifecycle + reduced-motion + rapid-nav

**Type:** Functionality (test).

**Verifies:** ios-shell-polish.AC7.1 (animation lifecycle), ios-shell-polish.AC7.2 (reduced-motion bypass), ios-shell-polish.AC7.4 (rapid-nav safety, in concert with Task 1's tests).

**Files:**
- Modify: `tests/js/fetchAndSwap.test.js` — add a `describe('Phase 5: page transitions')` block.

**Test patterns:**

Mock `document.body.classList.add` and `removeEventListener` if needed; use jsdom's animation events. Since jsdom does not actually run CSS animations, the `animationend` event must be manually dispatched in tests. The safety-net `setTimeout` in Task 3 ensures the test finishes even without a manual dispatch — but tests should still verify the animationend path.

**Tests:**

1. **`describe('iOS-shell-only animation gating')`**
   - `it('adds .page-out class to body before swap when .platform-ios is present')` — set `document.body.classList.add('platform-ios')`; spy on classList; call `fetchAndSwap`; assert `.page-out` was added.
   - `it('does not add animation classes when .platform-ios is absent (browser)')` — clear classes; call fetchAndSwap; assert no `.page-out` class added.

2. **`describe('Animation lifecycle')`**
   - `it('removes .page-out after animationend fires')` — start a swap; manually dispatch `animationend` on body; assert `.page-out` is removed.
   - `it('removes .page-out via safety timeout if animationend never fires')` — use `vi.useFakeTimers()`, advance timers past 250ms; assert `.page-out` removed even without a real animationend.
   - `it('adds .page-in after the swap completes')` — assert classList sees `.page-in` after swap content is in place.
   - `it('app:page-load fires AFTER scripts execute and BEFORE page-in animation')` — order assertions: spy on script onload, spy on dispatchEvent('app:page-load'), spy on classList.add('page-in'); assert dispatch happens after all script onloads and (by virtue of being in `_swapFromHtml`) before `_animatePageIn` is invoked.

3. **`describe('Reduced-motion handling — CSS-only, smoke-tested')`**
   - jsdom doesn't honor `prefers-reduced-motion` natively. Skip a strict CSS-evaluation test; instead verify the JS doesn't gate on matchMedia (no JS check exists). Inspect the source: `it('source contains no matchMedia(prefers-reduced-motion) calls — handled in CSS only')` — read `src/bootstrap/fetchAndSwap.js` as text; assert it does NOT contain `'prefers-reduced-motion'`. If a future change adds JS-side gating, this test catches it.

4. **`describe('Rapid back-to-back navigations')`** (in addition to Task 1's tests)
   - `it('three rapid swaps do not leave .page-out / .page-in stuck on body')` — fire 3 swaps in quick succession; manually flush all `animationend` events; assert `document.body.classList` does not contain `.page-out` or `.page-in` after the dust settles.
   - `it('rapid swap during animate-out does not crash')` — trigger swap 1 (which awaits animate-out); before swap 1's animate-out resolves, trigger swap 2; assert no exception thrown.

**Verification:**

Run: `npm test -- tests/js/fetchAndSwap`
Expected: existing tests + Task 1 tests + new Phase 5 tests all pass.

**Commit:**

```bash
git add tests/js/fetchAndSwap.test.js
git commit -m "test(fetchAndSwap): cover Phase 5 transitions, reduced-motion, rapid-nav

New describe blocks:
- iOS-shell-only animation gating (no animation outside .platform-ios)
- Animation lifecycle (page-out before swap; page-in after; safety
  timeouts in case animationend doesn't fire)
- app:page-load ordering preserved (still fires after scripts)
- Reduced-motion: source-level check that no JS gating exists (CSS only)
- Rapid-nav: 3 swaps don't leave classes stuck; mid-animation re-entry
  doesn't crash"
```
<!-- END_TASK_6 -->
<!-- END_SUBCOMPONENT_D -->

---

<!-- START_SUBCOMPONENT_E (tasks 7-8) -->
<!-- START_TASK_7 -->
### Task 7: Build verification — regenerate asset-manifest and bundle

**Type:** Infrastructure verification.

**Step 1:** `npm run build:bundle` — clean run; `node --check` passes.
**Step 2:** Commit any regenerated artifacts (skip if no diff).
<!-- END_TASK_7 -->

<!-- START_TASK_8 -->
### Task 8: Final verification — full tests + browser smoke + .NET test

**Type:** Infrastructure verification.

**Verifies:** ios-shell-polish.AC8.1, ios-shell-polish.AC8.2, ios-shell-polish.AC8.3.

**Step 1:** `npm test` — full suite passes.
**Step 2:** `dotnet test RoadTripMap.sln` — passes.
**Step 3:** Browser smoke-test (executor):
- `dotnet run --project src/RoadTripMap`, navigate `/` → `/create` → `/post/{token}` (use a real seeded trip).
- In a desktop browser **no transitions appear** (no `.platform-ios` class) — full-page navigations or instant swaps. ✓ AC9.3 holds.
- Open `/post/{token}` — skeleton placeholders flash briefly in the photo carousel before real content appears. ✓ AC7.3 visible.
- DevTools → Rendering → Emulate `prefers-reduced-motion: reduce` — refresh — skeletons appear without shimmer (static opacity 0.7). ✓ AC7.2.
- Open `/trips/{viewToken}` — skeleton placeholders flash in the view carousel.
- No console errors during any navigation.

**Step 4:** Patrick's manual on-device check:

> "Phase 5 implementation complete. Patrick: please run `npx cap sync ios` locally and verify on device:
> - Cross-page navigation (e.g., index → create) shows a brief fade-out then fade-in. The transition is subtle — should feel like the page 'lifts' rather than slamming.
> - Tap rapidly between pages: post → create → trips → post → create. The app stays responsive; nothing visually corrupted; nothing 'sticky' (a transition that never finished).
> - Open Settings → Accessibility → Motion → 'Reduce Motion: ON'. Re-launch the app. Cross-page navigation is now instant — no fade.
> - On post.html and trips.html, the photo carousel briefly shows shimmering grey placeholder tiles before real photos appear. With Reduce Motion ON, the placeholders show but don't shimmer.
>
> KNOWN DE-SCOPE OPTION: if anything feels 'off' (transitions interfering with `app:page-load` handlers, scripts not re-running on rapid nav), Tasks 2–3 can be reverted while Task 1 (script-dedup race fix) and Tasks 4–5 (skeletons) stay shipped. The design's de-scope ladder explicitly anticipated this."
<!-- END_TASK_8 -->
<!-- END_SUBCOMPONENT_E -->

---

## Phase 5 done-when checklist

- [ ] Task 1: Swap-generation tracker prevents stale-onload Set pollution; rapid-nav tests pass.
- [ ] Task 2: CSS keyframes (`page-out`, `page-in`, `shimmer`), classes (`.page-out`, `.page-in`, `.skeleton`, `.skeleton-carousel-item`, `.skeleton-photo-row`), reduced-motion overrides.
- [ ] Task 3: `_swapFromHtml` wrapped with `_animatePageOut` (await) → swap → `_animatePageIn` (fire-and-forget); body-level animation; safety-timeout fallback.
- [ ] Task 4: postUI photo-list shows 3 skeletons during fetch; cleared on resolve/reject.
- [ ] Task 5: mapUI view-carousel shows 3 skeletons during fetch; cleared on resolve/reject.
- [ ] Task 6: fetchAndSwap test suite extended with transition lifecycle + reduced-motion source-check + rapid-nav coverage.
- [ ] Task 7: Asset manifest + bundle regenerated.
- [ ] Task 8: `npm test` + `dotnet test` pass; browser smoke-tested with reduced-motion emulation; Patrick on-device sign-off (incl. rapid-tap stress test).
