// frontend/script.js

const config = {
    // IMPORTANT: Replace with your actual Google Cloud Client ID
    clientId: '909976441907-avv9kfpdhkrutuul0ded4gej2u8dq85l.apps.googleusercontent.com',
    // The exact redirect URI you authorized in the Google Cloud Console
    redirectUri: 'https://yuichi-aragi.github.io/Ges/redirect.html',
    // The scopes your application needs
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    // Local storage key used by the redirect handler too (keep unchanged for compatibility)
    storageKey: 'googleAuthTokens',
    // How long to show "Copied!" state (ms)
    copyUiTimeout: 2000
};

(function () {
    'use strict';

    // Utility helpers =================================================================
    const $ = (id) => document.getElementById(id);
    const qsAll = (sel) => Array.from(document.querySelectorAll(sel));

    function log(...args) {
        // Toggle console.debug easily here if needed
        console.debug('[auth]', ...args);
    }

    function safeJsonParse(text) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    function buildAuthUrl({ clientId, redirectUri, scope, includeGrantedScopes, prompt, state } = {}) {
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope,
            access_type: 'offline'
        });

        if (includeGrantedScopes) params.set('include_granted_scopes', 'true');
        if (prompt) params.set('prompt', prompt);
        if (state) params.set('state', state);

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    function warnIfMisconfigured() {
        if (!config.clientId || config.clientId.includes('REPLACE') || config.clientId.length < 20) {
            // Non-fatal: warn the developer early
            console.warn('Google clientId appears missing or placeholder in frontend/script.js. Replace with a real clientId.');
        }
        if (!config.redirectUri) {
            console.warn('redirectUri appears missing in config.');
        }
    }

    // UI helpers ======================================================================
    function setText(el, text) {
        if (!el) return;
        if ('value' in el) el.value = text;
        else el.textContent = text;
    }

    function showElement(el) {
        if (!el) return;
        el.classList.remove('hidden');
    }

    function hideElement(el) {
        if (!el) return;
        el.classList.add('hidden');
    }

    function formatExpiry(expiresInSeconds) {
        if (!expiresInSeconds || isNaN(expiresInSeconds)) return 'unknown';
        const when = Date.now() + Number(expiresInSeconds) * 1000;
        return new Date(when).toLocaleString();
    }

    // Clipboard (modern with fallback) =================================================
    async function writeToClipboard(text) {
        if (!text && text !== '') return false;
        // Try modern API
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (e) {
            // continue to fallback
            console.warn('navigator.clipboard.writeText failed, falling back.', e);
        }

        // Legacy fallback: select a temporary textarea
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            // Avoid scrolling to bottom
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const success = document.execCommand && document.execCommand('copy');
            document.body.removeChild(ta);
            return !!success;
        } catch (e) {
            console.error('Fallback clipboard failed', e);
            return false;
        }
    }

    // Token UI display =================================================================
    function displayTokens(tokens) {
        const accessTokenEl = $('accessToken');
        const refreshTokenEl = $('refreshToken');
        const refreshTokenWarning = $('refreshTokenWarning');

        if (!accessTokenEl || !refreshTokenEl) return;

        setText(accessTokenEl, tokens.access_token || '');
        if (tokens.refresh_token) {
            setText(refreshTokenEl, tokens.refresh_token);
            hideElement(refreshTokenWarning);
        } else {
            setText(refreshTokenEl, 'Not provided in this sign-in.');
            if (refreshTokenWarning) showElement(refreshTokenWarning);
        }

        // Show expiry if provided
        const expiresEl = $('tokenExpiry');
        if (expiresEl) {
            if (tokens.expires_in) {
                setText(expiresEl, formatExpiry(tokens.expires_in));
            } else {
                setText(expiresEl, 'unknown');
            }
        }
    }

    // UI state ========================================================================
    function showLoggedIn() {
        const loggedOutView = $('loggedOutView');
        const loggedInView = $('loggedInView');
        hideElement(loggedOutView);
        showElement(loggedInView);
    }

    function showLoggedOut() {
        const loggedOutView = $('loggedOutView');
        const loggedInView = $('loggedInView');
        hideElement(loggedInView);
        showElement(loggedOutView);
    }

    // Logout + revocation (best-effort) =================================================
    async function revokeToken(token) {
        if (!token) return;
        const revUrl = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`;
        try {
            // best-effort, no blocking of UI. small timeout.
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000);
            const resp = await fetch(revUrl, { method: 'POST', signal: controller.signal });
            clearTimeout(id);
            // Google returns 200 on success. we don't strictly require success.
            if (!resp.ok) {
                log('token revocation returned', resp.status);
            }
        } catch (e) {
            log('revocation error (ignored):', e && e.message);
        }
    }

    // Main initialization =============================================================
    document.addEventListener('DOMContentLoaded', () => {
        warnIfMisconfigured();

        const loginButton = $('loginButton');
        const logoutButton = $('logoutButton');

        // wire up login
        if (loginButton) {
            loginButton.addEventListener('click', (ev) => {
                ev.preventDefault();

                // Generate anti-forgery state and save it in sessionStorage. This is optional
                // and backward-compatible because the redirect handler will validate it.
                const state = `s_${Math.random().toString(36).slice(2)}_${Date.now()}`;
                try {
                    sessionStorage.setItem('google_oauth_state', state);
                } catch (e) {
                    // sessionStorage may be disabled; proceed without state (less secure)
                    console.warn('sessionStorage not available; continuing without state.');
                }

                const authUrl = buildAuthUrl({
                    clientId: config.clientId,
                    redirectUri: config.redirectUri,
                    scope: config.scope,
                    includeGrantedScopes: config.includeGrantedScopes,
                    prompt: config.prompt,
                    state
                });

                // Navigate (fast, simple)
                window.location.href = authUrl;
            });
        }

        // logout flow: attempt token revocation then clear storage and UI
        if (logoutButton) {
            logoutButton.addEventListener('click', async (ev) => {
                ev.preventDefault();
                const stored = localStorage.getItem(config.storageKey);
                let parsed = null;
                try { parsed = JSON.parse(stored); } catch (e) { parsed = null; }

                // best-effort revoke access token and/or refresh token
                if (parsed && parsed.access_token) {
                    await revokeToken(parsed.access_token);
                }
                if (parsed && parsed.refresh_token) {
                    await revokeToken(parsed.refresh_token);
                }

                localStorage.removeItem(config.storageKey);
                // also remove state (just in case)
                try { sessionStorage.removeItem('google_oauth_state'); } catch (e) {}

                showLoggedOut();
            });
        }

        // On load: if tokens were stored by redirect page, show them.
        try {
            const storedTokens = localStorage.getItem(config.storageKey);
            if (storedTokens) {
                let parsed = null;
                try { parsed = JSON.parse(storedTokens); } catch (e) { parsed = null; }
                if (parsed) {
                    displayTokens(parsed);
                    showLoggedIn();
                } else {
                    // malformed -> remove
                    localStorage.removeItem(config.storageKey);
                    showLoggedOut();
                }
            } else {
                showLoggedOut();
            }
        } catch (e) {
            console.error('Error while reading stored tokens:', e);
            showLoggedOut();
        }

        // Copy buttons (uses modern clipboard API with fallback)
        qsAll('.copy-button').forEach(button => {
            button.addEventListener('click', async (ev) => {
                ev.preventDefault();
                const targetId = button.dataset && button.dataset.target;
                if (!targetId) return;
                const textarea = document.getElementById(targetId);
                if (!textarea) return;
                const text = ('value' in textarea) ? textarea.value : textarea.textContent || '';

                const ok = await writeToClipboard(text);
                if (ok) {
                    const prev = button.textContent;
                    button.textContent = 'Copied!';
                    button.disabled = true;
                    setTimeout(() => {
                        button.textContent = prev || 'Copy';
                        button.disabled = false;
                    }, config.copyUiTimeout);
                } else {
                    // graceful fallback: select content so user can copy manually
                    if (textarea.select) {
                        try {
                            textarea.select();
                        } catch (e) { /* ignore */ }
                    }
                    button.textContent = 'Copy failed';
                    setTimeout(() => { button.textContent = 'Copy'; }, config.copyUiTimeout);
                }
            });
        });

    }); // DOMContentLoaded
})();
