// pattern: Imperative Shell
(function () {
    // Prod App Service origin. The iOS shell only ships against prod; dev/staging
    // variants are out of scope for the offline-shell design (see plan Phase 3 §
    // Module contract). Exposed as _APP_BASE for test inspection, not configuration.
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net/';

    // Module-scoped registry of external script srcs that have been injected
    // into this JS realm. Phase 3 (ios-shell-hardening.AC1) — prevents duplicate-
    // const cascade when a cross-page swap tries to re-inject an already-executed
    // script. Inline scripts are NOT tracked here (by design — they can be page-
    // local and have no identity to dedup against).
    const _executedScriptSrcs = new Set();

    function _absolutizeSrc(src) {
        try { return new URL(src, APP_BASE).href; } catch { return src; }
    }

    async function _recreateScripts(scriptsInOrder, parentNode) {
        for (const oldScript of scriptsInOrder) {
            const rawSrc = oldScript.getAttribute('src');

            // External script path (has a non-empty src attribute)
            if (rawSrc) {
                // Phase 3: when rewriteAssetTags has substituted a blob: URL, the canonical
                // path lives in dataset.assetCacheOrigin. Use it as the dedup key so blob URLs
                // (which are unique per swap) don't defeat the _executedScriptSrcs invariant.
                const dedupKey = oldScript.dataset.assetCacheOrigin
                    ? _absolutizeSrc(oldScript.dataset.assetCacheOrigin)
                    : _absolutizeSrc(rawSrc);
                if (_executedScriptSrcs.has(dedupKey)) {
                    // Already executed in this realm (previous page, or earlier in this page).
                    // Skip recreation to avoid the duplicate-const cascade.
                    continue;
                }
                const fresh = document.createElement('script');
                for (const attr of oldScript.attributes) {
                    fresh.setAttribute(attr.name, attr.value);
                }
                // Carry the dataset annotation onto the fresh element so a future
                // _recreateScripts call sees the canonical path even if the blob URL changed.
                if (oldScript.dataset.assetCacheOrigin) {
                    fresh.dataset.assetCacheOrigin = oldScript.dataset.assetCacheOrigin;
                }
                await new Promise((resolve) => {
                    fresh.onload = () => {
                        // Only add on successful load. onerror does not guarantee the
                        // script's top-level declarations executed, so we allow retry.
                        _executedScriptSrcs.add(dedupKey);
                        resolve();
                    };
                    fresh.onerror = () => resolve();
                    parentNode.appendChild(fresh);
                });
                continue;
            }

            // Inline script path (no src). Re-executes on every swap by design —
            // wwwroot pages must avoid top-level const/let in inline <script> (see
            // Subcomponent B in this phase for the two pages we fixed up-front).
            const fresh = document.createElement('script');
            for (const attr of oldScript.attributes) {
                fresh.setAttribute(attr.name, attr.value);
            }
            fresh.textContent = oldScript.textContent;
            parentNode.appendChild(fresh);
        }
    }

    async function _swapFromHtml(html, url) {
        const parsed = new DOMParser().parseFromString(html, 'text/html');

        // Inject <base href> if not already present (AC1.4)
        if (!parsed.head.querySelector('base[href]')) {
            const base = parsed.createElement('base');
            base.setAttribute('href', APP_BASE);
            parsed.head.insertBefore(base, parsed.head.firstChild);
        }

        // Phase 3: rewrite cached <link rel="stylesheet"> → <style> and cached
        // <script src> → blob: URL BEFORE scripts are extracted, so the
        // scriptsInOrder array picks up the rewritten src + dataset annotation.
        // Defensive: AssetCache may not be loaded in test environments that
        // eval fetchAndSwap.js without first eval'ing assetCache.js.
        if (typeof globalThis.AssetCache !== 'undefined' && typeof globalThis.AssetCache.rewriteAssetTags === 'function') {
            try {
                await globalThis.AssetCache.rewriteAssetTags(parsed);
            } catch (err) {
                // Never block render on a rewrite failure — fall through with the
                // unmutated parsed doc. The browser will fetch from the network
                // (online) or fail silently (offline; acceptable per AC scope).
            }
        }

        // Strip scripts from the parsed doc — they'd be inert if included via innerHTML
        // (parser-inserted + already-started). They're recreated in Task 3.
        const scriptsInOrder = Array.from(parsed.querySelectorAll('script'));
        scriptsInOrder.forEach((s) => s.remove());

        // Swap document content
        document.head.innerHTML = parsed.head.innerHTML;
        document.body.innerHTML = parsed.body.innerHTML;

        // Also swap body ATTRIBUTES (data-page, class, etc.). The shell's
        // <body> in src/bootstrap/index.html starts bare, and setting only
        // innerHTML leaves body.dataset.page permanently undefined — which
        // would silently break RoadTrip.onPageLoad(pageName, fn) scope
        // filtering for every non-wildcard page script. Clear stale attrs
        // from a prior swap first, then copy parsed body's attrs, then
        // re-add the shell-owned `platform-ios` class (loader.js:5 sets it
        // once at boot but a class replacement here would strip it).
        Array.from(document.body.attributes).forEach((attr) => {
            document.body.removeAttribute(attr.name);
        });
        for (const attr of parsed.body.attributes) {
            document.body.setAttribute(attr.name, attr.value);
        }
        document.body.classList.add('platform-ios');

        // Task 3: Recreate scripts. All scripts are appended to document.body
        // regardless of their original parent. Browsers execute scripts synchronously
        // on append in source order, so execution semantics are preserved. The DOM
        // shape differs from the fetched page (head-origin scripts live in body
        // post-swap); this is acceptable for the offline-shell's current consumers
        // (postUI.js, mapUI.js) which do not query `head > script`.
        await _recreateScripts(scriptsInOrder, document.body);

        // Clear lifecycle handlers accumulated from prior swaps BEFORE dispatching the
        // new page-load event, so a stale handler does not fire on the new page body.
        // ListenerShim is loaded earlier in src/bootstrap/index.html.
        if (globalThis.ListenerShim && typeof globalThis.ListenerShim.clearPageLifecycleListeners === 'function') {
            globalThis.ListenerShim.clearPageLifecycleListeners();
        }

        // Custom page-load event (replaces synthetic DOMContentLoaded + window.load).
        // Page scripts register via RoadTrip.onPageLoad(...) in Phase 2.
        document.dispatchEvent(new Event('app:page-load', { bubbles: true, cancelable: true }));

        // AC2.3: notify TripStorage that a saved-trip URL was opened.
        // Defensive: TripStorage may not be loaded; markOpened may throw on storage error.
        if (typeof TripStorage !== 'undefined' && typeof TripStorage.markOpened === 'function') {
            try { TripStorage.markOpened(url); } catch { /* never block render on storage */ }
        }

        // Phase 3: revoke blob URLs minted by rewriteAssetTags. Each <script src=blob:>
        // has loaded (or errored) by now — _recreateScripts awaits onload/onerror per
        // script. Revoke synchronously to avoid leaking memory in the SPA-style shell.
        if (typeof globalThis.AssetCache !== 'undefined' && globalThis.AssetCache._internals && typeof globalThis.AssetCache._internals._revokePendingBlobUrls === 'function') {
            try {
                globalThis.AssetCache._internals._revokePendingBlobUrls();
            } catch (err) {
                // Swallow — leak is preferable to throwing during the render path.
            }
        }
    }

    async function fetchAndSwap(url, options = {}) {
        if (typeof CachedFetch === 'undefined' || typeof CachedFetch.cachedFetch !== 'function') {
            throw new Error('fetchAndSwap: CachedFetch is not loaded');
        }
        const { response } = await CachedFetch.cachedFetch(url, options);
        if (!response.ok) {
            throw new Error(`fetchAndSwap: HTTP ${response.status} for ${url}`);
        }
        const html = await response.text();
        await _swapFromHtml(html, url);
    }

    globalThis.FetchAndSwap = { fetchAndSwap, _swapFromHtml, _APP_BASE: APP_BASE, _executedScriptSrcs };
})();
