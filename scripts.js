document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const config = {
        clientId: '909976441907-1gfhvgfi8emjj34ta1tpgstu7uqc4ooe.apps.googleusercontent.com', // This will be replaced by the GitHub Action
        redirectUri: window.location.origin + window.location.pathname,
        scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo'
    };

    // --- UI ELEMENTS ---
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const loadingSpinner = document.getElementById('loadingSpinner');
    
    // --- PKCE HELPER FUNCTIONS ---
    async function generateCodeChallenge(codeVerifier) {
        const data = new TextEncoder().encode(codeVerifier);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    function generateCodeVerifier() {
        const randomBytes = new Uint8Array(32);
        window.crypto.getRandomValues(randomBytes);
        return btoa(String.fromCharCode.apply(null, randomBytes))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }
    
    // --- OAUTH LOGIC ---
    loginButton.addEventListener('click', async () => {
        const codeVerifier = generateCodeVerifier();
        sessionStorage.setItem('code_verifier', codeVerifier);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: 'code',
            scope: config.scope,
            code_challenge: codeChallenge,
            code_challenge_method: 'S-256',
            access_type: 'offline', // Necessary to get a refresh token
            prompt: 'consent' // Ensures the user is prompted for consent, needed for refresh token
        });

        window.location.href = `${config.authUrl}?${params}`;
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('token_expires_at');
        updateUI(false);
    });

    async function exchangeCodeForToken(code) {
        const codeVerifier = sessionStorage.getItem('code_verifier');
        if (!codeVerifier) {
            throw new Error('Code verifier not found.');
        }

        const response = await fetch(config.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: config.redirectUri,
                code: code,
                code_verifier: codeVerifier,
                grant_type: 'authorization_code'
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error_description || 'Failed to exchange code for token.');
        }
        return await response.json();
    }
    
    // --- UI LOGIC ---
    function updateUI(isLoggedIn, tokens = {}) {
        if (isLoggedIn) {
            loggedOutView.classList.add('hidden');
            loggedInView.classList.remove('hidden');
            loadingSpinner.classList.add('hidden');

            document.getElementById('accessToken').value = tokens.access_token || 'N/A';
            const refreshTokenTextarea = document.getElementById('refreshToken');
            const refreshTokenWarning = document.getElementById('refreshTokenWarning');

            if (tokens.refresh_token) {
                refreshTokenTextarea.value = tokens.refresh_token;
                refreshTokenWarning.classList.add('hidden');
            } else {
                refreshTokenTextarea.value = 'Not provided on this login.';
                refreshTokenWarning.classList.remove('hidden');
            }
        } else {
            loggedOutView.classList.remove('hidden');
            loggedInView.classList.add('hidden');
            loadingSpinner.classList.add('hidden');
        }
    }

    async function fetchUserInfo(accessToken) {
        const response = await fetch(config.userInfoUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error('Failed to fetch user info.');
        const data = await response.json();
        document.getElementById('userName').textContent = data.name;
        document.getElementById('userEmail').textContent = data.email;
        document.getElementById('userAvatar').src = data.picture;
    }
    
    // --- INITIALIZATION ---
    async function init() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');

        if (code) {
            // We have a code, so we are in the redirect phase
            loggedOutView.classList.add('hidden');
            loadingSpinner.classList.remove('hidden');
            
            try {
                const tokens = await exchangeCodeForToken(code);
                const expiresAt = Date.now() + (tokens.expires_in * 1000);
                localStorage.setItem('access_token', tokens.access_token);
                localStorage.setItem('token_expires_at', expiresAt);
                if (tokens.refresh_token) {
                    localStorage.setItem('refresh_token', tokens.refresh_token);
                }
                
                // Clean the URL
                window.history.replaceState({}, document.title, window.location.pathname);
                
                // Now that we have tokens, update the UI
                await fetchUserInfo(tokens.access_token);
                updateUI(true, {
                    access_token: tokens.access_token,
                    refresh_token: localStorage.getItem('refresh_token') // Use stored one if available
                });
            } catch (error) {
                console.error(error);
                alert(`Error: ${error.message}`);
                updateUI(false);
            }
        } else {
            // Standard page load, check if we are already logged in
            const accessToken = localStorage.getItem('access_token');
            const expiresAt = localStorage.getItem('token_expires_at');
            if (accessToken && expiresAt && Date.now() < expiresAt) {
                await fetchUserInfo(accessToken);
                updateUI(true, {
                    access_token: accessToken,
                    refresh_token: localStorage.getItem('refresh_token')
                });
            } else {
                updateUI(false);
            }
        }
    }

    // Add copy button functionality
    document.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', (e) => {
            const targetId = e.target.dataset.target;
            const textarea = document.getElementById(targetId);
            textarea.select();
            document.execCommand('copy');
            e.target.textContent = 'Copied!';
            setTimeout(() => { e.target.textContent = 'Copy'; }, 2000);
        });
    });

    init();
});
