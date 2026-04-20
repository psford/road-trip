// pattern: Imperative Shell
(function () {
    // Prod App Service origin. The iOS shell only ships against prod; dev/staging
    // variants are out of scope for the offline-shell design (see plan Phase 3 §
    // Module contract). Exposed as _APP_BASE for test inspection, not configuration.
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net/';

    async function _recreateScripts(scriptsInOrder, parentNode) {
        for (const oldScript of scriptsInOrder) {
            const fresh = document.createElement('script');
            for (const attr of oldScript.attributes) {
                fresh.setAttribute(attr.name, attr.value);
            }
            if (oldScript.src) {
                // External script: await load or error before continuing (sequential).
                // jsdom won't fetch remote URLs, so onerror fires; that's fine for unit tests.
                // Real execution is verified by Task 1's spike + Phase 7's on-device matrix.
                await new Promise((resolve) => {
                    fresh.onload = () => resolve();
                    fresh.onerror = () => resolve();
                    parentNode.appendChild(fresh);
                });
            } else {
                // Inline script: textContent set, append. Browsers execute synchronously on append.
                fresh.textContent = oldScript.textContent;
                parentNode.appendChild(fresh);
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
        const parsed = new DOMParser().parseFromString(html, 'text/html');

        // Inject <base href> if not already present (AC1.4)
        if (!parsed.head.querySelector('base[href]')) {
            const base = parsed.createElement('base');
            base.setAttribute('href', APP_BASE);
            parsed.head.insertBefore(base, parsed.head.firstChild);
        }

        // Strip scripts from the parsed doc — they'd be inert if included via innerHTML
        // (parser-inserted + already-started). They're recreated in Task 3.
        const scriptsInOrder = Array.from(parsed.querySelectorAll('script'));
        scriptsInOrder.forEach((s) => s.remove());

        // Swap document content
        document.head.innerHTML = parsed.head.innerHTML;
        document.body.innerHTML = parsed.body.innerHTML;

        // Task 3: Recreate scripts. All scripts are appended to document.body
        // regardless of their original parent. Browsers execute scripts synchronously
        // on append in source order, so execution semantics are preserved. The DOM
        // shape differs from the fetched page (head-origin scripts live in body
        // post-swap); this is acceptable for the offline-shell's current consumers
        // (postUI.js, mapUI.js) which do not query `head > script`.
        await _recreateScripts(scriptsInOrder, document.body);

        // Task 4: Synthetic DOMContentLoaded for handlers attached during script execution.
        // Scripts that self-init via document.readyState === 'complete' have already run;
        // this dispatch covers handlers like postUI.js that listen unconditionally.
        document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
        window.dispatchEvent(new Event('load'));

        // AC2.3: notify TripStorage that a saved-trip URL was opened.
        // Defensive: TripStorage may not be loaded; markOpened may throw on storage error.
        if (typeof TripStorage !== 'undefined' && typeof TripStorage.markOpened === 'function') {
            try { TripStorage.markOpened(url); } catch { /* never block render on storage */ }
        }
    }

    globalThis.FetchAndSwap = { fetchAndSwap, _APP_BASE: APP_BASE };
})();
