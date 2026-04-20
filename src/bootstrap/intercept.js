// pattern: Imperative Shell
(function () {
    const APP_BASE = 'https://app-roadtripmap-prod.azurewebsites.net';

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
        history.pushState({}, '', result.url);
        FetchAndSwap.fetchAndSwap(result.url).catch((err) => {
            // Phase 5's loader-level error handler renders fallback.html when needed.
            console.error('Intercept: fetchAndSwap failed for', result.url, err);
        });
    }
    function _onSubmit(_event) { /* Task 3 */ }
    function _onPopState(_event) { /* Task 4 */ }

    globalThis.Intercept = {
        installIntercept,
        _internals: { _classifyClick, _classifySubmit, _isExternalUrl, _isHashOnlyNav, _isOptedOut, _isModifiedClick, _isMiddleClick },
        APP_BASE
    };
})();
