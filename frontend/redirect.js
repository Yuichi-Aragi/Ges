// frontend/redirect.js
// Improved: robust fetch with timeout & simple retry/backoff, better error handling,
// validates state against sessionStorage (anti-CSRF, optional), preserves backwards compatibility
// with original worker POST contract: { code }

(() => {
    'use strict';

    // IMPORTANT: Replace with the URL of your deployed Cloudflare worker
    const workerUrl = 'https://ges.yukag.workers.dev';

    // Configurable small constants
    const FETCH_TIMEOUT_MS = 8000; // per-request timeout
    const MAX_RETRIES = 2;         // try a couple times for transient network failures
    const RETRY_BASE_DELAY_MS = 500; // exponential backoff base

    function qs() {
        return new URLSearchParams(window.location.search || window.location.hash.replace('#', '?'));
    }

    function showErrorHtml(title, message) {
        document.body.innerHTML = `<div class="container"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>`;
    }

    function escapeHtml(s) {
        if (!s && s !== '') return '';
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    async function fetchWithTimeoutAndRetries(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS, retries = MAX_RETRIES) {
        let attempt = 0;
        while (true) {
            attempt++;
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const resp = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(id);
                return resp;
            } catch (err) {
                clearTimeout(id);
                const isAbort = err && err.name === 'AbortError';
                const isNetwork = err && (err instanceof TypeError || /network/i.test(err.message || ''));
                // Only retry for network/timeouts
                if (attempt > retries || (!isAbort && !isNetwork)) {
                    throw err;
                }
                // back off slightly before retrying
                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }

    // Main logic on load
    window.addEventListener('load', async () => {
        const params = qs();
        const code = params.get('code');
        const returnedState = params.get('state');

        if (!code) {
            showErrorHtml('Error', 'No authorization code found. Please initiate sign-in from the main page.');
            return;
        }

        // Optional: validate state if present in sessionStorage
        try {
            const storedState = sessionStorage.getItem('google_oauth_state');
            if (storedState && returnedState && storedState !== returnedState) {
                showErrorHtml('Error', 'State mismatch detected — possible CSRF. Authentication aborted.');
                return;
            }
            // If we had stored a state but none returned, treat as suspicious but allow fallback
            if (storedState && !returnedState) {
                console.warn('State was set before redirect but not returned. Continuing, but consider investigating.');
            }
        } catch (e) {
            console.warn('Could not access sessionStorage to validate state. Continuing anyway.');
        }

        // Exchange code for tokens by calling our worker endpoint
        if (!workerUrl) {
            showErrorHtml('Configuration error', 'No workerUrl configured in redirect.js. Please set workerUrl to your backend endpoint.');
            return;
        }

        const endpoint = `${workerUrl.replace(/\/$/, '')}/auth`;

        try {
            const resp = await fetchWithTimeoutAndRetries(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            // Non-JSON bodies or error codes: try to read JSON error message gracefully
            const text = await resp.text();
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }

            if (!resp.ok) {
                const errMsg = (json && (json.error_description || json.error || json.message)) || resp.statusText || 'Failed to exchange code for tokens';
                throw new Error(errMsg);
            }

            // Expect tokens object (backward-compatible)
            const tokens = json || {};
            // Basic sanity check
            if (!tokens.access_token && !tokens.refresh_token) {
                // still accept it (some backends may return other shape) but warn and store raw response
                console.warn('Token exchange succeeded but no access_token/refresh_token found, storing raw response.');
            }

            // Save tokens into localStorage (key matches previous implementation)
            try {
                localStorage.setItem('googleAuthTokens', JSON.stringify(tokens));
            } catch (e) {
                // Failure to persist should be surfaced to user
                showErrorHtml('Storage error', 'Failed to save authentication tokens locally (localStorage unavailable). Please enable storage in your browser and try again.');
                return;
            }

            // Cleanup stored state (if any)
            try { sessionStorage.removeItem('google_oauth_state'); } catch (e) { /* ignore */ }

            // Redirect back to main app. Use absolute or relative path from your original app.
            // Backward-compatible default path used in original script.
            window.location.href = '/Ges/';

        } catch (err) {
            console.error('Authentication exchange failed:', err);
            showErrorHtml('Error', `Authentication failed: ${err && err.message ? err.message : 'Unknown error'}. Please try again.`);
        }
    });
})();
