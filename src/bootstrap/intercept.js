// pattern: Imperative Shell
(function () {
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net';

    // Resolve a possibly-relative URL to absolute App Service form before fetch().
    // The iOS shell runs at capacitor://localhost/, so relative URLs would resolve
    // against that origin — hitting the Capacitor internal server. Used by the
    // POST form path (cachedFetch handles this internally for the GET + cache path).
    function _absoluteUrl(url) {
        try {
            return new URL(url, APP_BASE).href;
        } catch {
            return url;
        }
    }

    // Build a same-origin URL for history.pushState. pushState resolves the URL
    // against document.baseURI, which fetchAndSwap sets to APP_BASE via <base href>
    // for AC1.4 (in-page relative URL resolution). In the iOS shell at
    // capacitor://localhost/, that resolution produces a cross-origin URL and
    // pushState SecurityErrors. Resolving explicitly against window.location.href
    // bypasses document.baseURI and stays within the document's actual origin.
    function _sameOriginUrl(path) {
        try {
            return new URL(path, window.location.href).href;
        } catch {
            return path;
        }
    }

    function _isModifiedClick(event) {
        return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    }

    function _isMiddleClick(event) {
        return event.button !== 0;
    }

    function _isOptedOut(element) {
        return element.closest('[data-no-shell="true"]') !== null;
    }

    function _isExternalUrl(url) {
        // Conservative: only paths (starting with /) and same-app absolute URLs are internal.
        // Everything else (other schemes, malformed, etc.) is external.
        if (url.startsWith('/')) {
            return false;  // Path relative to origin → internal.
        }
        // Try to parse as absolute URL. If it has a scheme, check origin.
        try {
            const parsed = new URL(url);
            return parsed.origin !== APP_BASE;
        } catch {
            // Unparseable (malformed) → external.
            return true;
        }
    }

    function _isHashOnlyNav(url) {
        try {
            const target = new URL(url, window.location.href);
            const current = new URL(window.location.href);
            return target.pathname === current.pathname
                && target.search === current.search
                && target.hash !== current.hash;
        } catch {
            return false;
        }
    }

    function _classifyClick(event) {
        if (_isModifiedClick(event)) return { intercept: false, reason: 'modifier-key' };
        if (_isMiddleClick(event)) return { intercept: false, reason: 'non-primary-button' };
        const anchor = event.target.closest('a[href]');
        if (!anchor) return { intercept: false, reason: 'no-anchor' };
        if (anchor.target === '_blank') return { intercept: false, reason: 'target-blank' };
        if (_isOptedOut(anchor)) return { intercept: false, reason: 'data-no-shell' };
        const href = anchor.href;
        if (_isExternalUrl(href)) return { intercept: false, reason: 'external' };
        if (_isHashOnlyNav(href)) return { intercept: false, reason: 'hash-only' };
        const u = new URL(href);
        const url = u.pathname + u.search + u.hash;
        return { intercept: true, url };
    }

    function _classifySubmit(event) {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return { intercept: false, reason: 'not-form' };
        if (_isOptedOut(form)) return { intercept: false, reason: 'data-no-shell' };
        const method = (form.method || 'get').toLowerCase();
        if (method !== 'get' && method !== 'post') return { intercept: false, reason: 'exotic-method' };
        const action = form.action || window.location.href;
        if (_isExternalUrl(action)) return { intercept: false, reason: 'external' };
        const u = new URL(action, APP_BASE);
        return { intercept: true, method, url: u.pathname + u.search, form };
    }

    function installIntercept() {
        if (installIntercept._installed) return;
        installIntercept._installed = true;
        document.addEventListener('click', _onClick, { capture: false });   // Filled by Task 2
        document.addEventListener('submit', _onSubmit, { capture: false }); // Filled by Task 3
        window.addEventListener('popstate', _onPopState);                   // Filled by Task 4
    }

    function _onClick(event) {
        const result = _classifyClick(event);
        if (!result.intercept) return;
        if (typeof FetchAndSwap === 'undefined' || typeof FetchAndSwap.fetchAndSwap !== 'function') {
            return;  // Defensive: if FetchAndSwap isn't loaded yet, fall through to native nav.
        }
        event.preventDefault();
        history.pushState({}, '', _sameOriginUrl(result.url));
        FetchAndSwap.fetchAndSwap(result.url).catch((err) => {
            // Phase 5's loader-level error handler renders fallback.html when needed.
            console.error('Intercept: fetchAndSwap failed for', result.url, err);
        });
    }
    async function _onSubmit(event) {
        const result = _classifySubmit(event);
        if (!result.intercept) return;
        if (typeof FetchAndSwap === 'undefined' || typeof FetchAndSwap.fetchAndSwap !== 'function') return;
        event.preventDefault();
        if (result.method === 'get') {
            const fd = new FormData(result.form);
            const params = new URLSearchParams();
            for (const [k, v] of fd.entries()) {
                if (typeof v === 'string') params.append(k, v);
            }
            const fullUrl = result.url + (params.toString() ? '?' + params.toString() : '');
            history.pushState({}, '', _sameOriginUrl(fullUrl));
            FetchAndSwap.fetchAndSwap(fullUrl).catch((err) => {
                console.error('Intercept: GET form fetchAndSwap failed for', fullUrl, err);
            });
        } else {
            // POST: bypass cache. Raw fetch + _swapFromHtml.
            try {
                const response = await fetch(_absoluteUrl(result.url), {
                    method: 'POST',
                    body: new FormData(result.form)
                });
                if (!response.ok) throw new Error(`POST ${result.url} returned ${response.status}`);
                const html = await response.text();
                history.pushState({}, '', _sameOriginUrl(result.url));
                await FetchAndSwap._swapFromHtml(html, result.url);
            } catch (err) {
                console.error('Intercept: POST form failed for', result.url, err);
            }
        }
    }
    function _onPopState(_event) {
        if (typeof FetchAndSwap === 'undefined' || typeof FetchAndSwap.fetchAndSwap !== 'function') return;
        const url = window.location.pathname + window.location.search;
        // Do NOT pushState here — the browser's history already moved.
        FetchAndSwap.fetchAndSwap(url).catch((err) => {
            console.error('Intercept: popstate fetchAndSwap failed for', url, err);
        });
    }

    globalThis.Intercept = {
        installIntercept,
        _internals: { _classifyClick, _classifySubmit, _isExternalUrl, _isHashOnlyNav, _isOptedOut, _isModifiedClick, _isMiddleClick },
        APP_BASE
    };
})();
