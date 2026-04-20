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

        // Boot routing (AC2.1, AC2.2)
        const defaultTrip = TripStorage.getDefaultTrip();
        const bootUrl = defaultTrip ? defaultTrip.postUrl : '/';
        await FetchAndSwap.fetchAndSwap(bootUrl);

        // Install delegated nav AFTER first swap (the swapped page is what carries
        // the trip / home links; intercept fires on user clicks from now on).
        if (Intercept && typeof Intercept.installIntercept === 'function') {
            Intercept.installIntercept();
        }

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
        try {
            const res = await fetch('fallback.html');
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
