// pattern: Imperative Shell
(async function bootstrap() {
    try {
        // Set platform-ios class before first paint (preserved from previous loader; AC10.1).
        document.body.classList.add('platform-ios');

        // Wrap FetchAndSwap.fetchAndSwap so every swap re-injects ios.css.
        // (document.head.innerHTML is replaced on every swap, removing any prior <link>.)
        // Note: the wrapper kicks in only AFTER loader.js has run. Phase 3/4 unit tests
        // do NOT exercise this path because they call FetchAndSwap.fetchAndSwap directly
        // before any loader.js eval. The "ios.css applied to every fetched page" intent
        // is verified by Phase 5 Task 5's bootstrap-loader tests + Phase 7's on-device matrix.
        if (FetchAndSwap && typeof FetchAndSwap.fetchAndSwap === 'function') {
            const original = FetchAndSwap.fetchAndSwap;
            FetchAndSwap.fetchAndSwap = async function (url, options) {
                await original(url, options);
                _ensureIosCss();
            };
        } else {
            throw new Error('Bootstrap: FetchAndSwap is not loaded');
        }

        if (typeof TripStorage === 'undefined' || typeof TripStorage.getDefaultTrip !== 'function') {
            throw new Error('Bootstrap: TripStorage is not loaded');
        }

        // Install delegated nav BEFORE the first swap. The <base href> injected by
        // fetchAndSwap makes every internal anchor resolve to a cross-origin URL
        // (capacitor://localhost → https://app-roadtripmap-prod.azurewebsites.net/...).
        // If the user taps an anchor before intercept is attached, native WKWebView
        // navigation fires and Capacitor's default policy kicks the user out to
        // Safari. Intercept is document-level delegation, idempotent, and guards
        // against FetchAndSwap being undefined — safe to install now.
        if (Intercept && typeof Intercept.installIntercept === 'function') {
            Intercept.installIntercept();
        }

        // Boot routing (AC2.1, AC2.2)
        const defaultTrip = TripStorage.getDefaultTrip();
        const bootUrl = defaultTrip ? defaultTrip.postUrl : '/';
        // Update history BEFORE the swap so window.location.pathname matches the
        // content being rendered. Scripts in the fetched page (e.g. postUI.js)
        // read pathname during DOMContentLoaded to extract route params like the
        // trip's secret token. Without this pushState, the shell's original URL
        // (capacitor://localhost/) leaks through and route-parsing fails.
        // Same-origin resolution is safe here: no <base href> has been injected
        // yet (fetchAndSwap does that inside the parsed document), so the shell's
        // capacitor://localhost/ origin is used to resolve the relative bootUrl.
        if (bootUrl !== window.location.pathname + window.location.search) {
            history.pushState({}, '', bootUrl);
        }
        await FetchAndSwap.fetchAndSwap(bootUrl);

        // Remove the bootstrap-progress shim now that the real page has rendered.
        const progress = document.getElementById('bootstrap-progress');
        if (progress) progress.remove();
    } catch (err) {
        console.error('Bootstrap failed:', err);
        await _renderFallback(err);
    }

    function _ensureIosCss() {
        if (!document.head.querySelector('link[data-ios-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/ios.css';
            link.setAttribute('data-ios-css', 'true');
            document.head.appendChild(link);
        }
    }

    async function _renderFallback(_originalError) {
        // AC3.6: offline + cache miss → fallback.html with retry.
        // Resolve explicitly against window.location.origin so the fetch hits the
        // Capacitor local webview (where fallback.html is bundled), not App Service.
        // A <base href="APP_BASE"> is in the document once a swap has happened, and
        // a naked `fetch('fallback.html')` would resolve against that base — trying
        // to load a remote file that doesn't exist on App Service anyway, and failing
        // outright when offline, which is exactly when we need the fallback.
        try {
            const fallbackUrl = window.location.origin + '/fallback.html';
            const res = await fetch(fallbackUrl);
            const html = await res.text();
            document.body.innerHTML = html;
            const retry = document.getElementById('bootstrap-retry');
            if (retry) retry.addEventListener('click', () => location.reload());
        } catch {
            document.body.innerHTML =
                '<div style="padding:2rem;font-family:system-ui">' +
                '<h1>Unable to load</h1>' +
                '<p>Tap anywhere to retry.</p>' +
                '</div>';
            document.body.addEventListener('click', () => location.reload(), { once: true });
        }
    }
})();
