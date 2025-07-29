document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const config = {
        // This is public and safe to have in the code.
        clientId: '909976441907-avv9kfpdhkrutuul0ded4gej2u8dq85l.apps.googleusercontent.com', // PASTE YOUR PUBLIC CLIENT ID
        // The URL of the worker you will deploy.
        workerUrl: 'https://5386efc7-ges.yukag.workers.dev/', // PASTE YOUR WORKER URL
        redirectUri: window.location.origin + window.location.pathname,
        scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo'
    };


    // --- UI ELEMENTS ---
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const loadingSpinner = document.getElementById('loadingSpinner');
    
    let googleClient;

    // This function is called after the Google Identity Services library is loaded
    window.onload = () => {
        if (config.clientId.includes('__GOOGLE_CLIENT_ID__')) {
            console.error("Google Client ID has not been replaced. Check your GitHub Action setup.");
            alert("Configuration error: Client ID not set. Deployment may have failed.");
            return;
        }

        // Initialize the official Google Code Client.
        googleClient = google.accounts.oauth2.initCodeClient({
            client_id: config.clientId,
            scope: config.scope,
            ux_mode: 'popup',
            callback: (response) => {
                if (response.code) {
                    handleAuthCode(response.code);
                }
            },
        });

        // Check if we are already logged in from a previous session
        init();
    };

    // --- OAUTH LOGIC ---
    loginButton.addEventListener('click', () => {
        if (googleClient) {
            googleClient.requestCode();
        } else {
            alert("Google client not initialized. Please wait a moment and try again.");
        }
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('token_expires_at');
        updateUI(false);
    });

    async function handleAuthCode(code) {
        loggedOutView.classList.add('hidden');
        loggedInView.classList.add('hidden');
        loadingSpinner.classList.remove('hidden');

        try {
            const tokens = await exchangeCodeForToken(code);
            const expiresAt = Date.now() + (tokens.expires_in * 1000);
            localStorage.setItem('access_token', tokens.access_token);
            localStorage.setItem('token_expires_at', expiresAt);
            if (tokens.refresh_token) {
                localStorage.setItem('refresh_token', tokens.refresh_token);
            }
            
            updateUI(true, {
                access_token: tokens.access_token,
                refresh_token: localStorage.getItem('refresh_token')
            });
        } catch (error) {
            console.error(error);
            alert(`Error: ${error.message}`);
            updateUI(false);
        }
    }

    async function exchangeCodeForToken(code) {
        const response = await fetch(config.workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                redirect_uri: config.redirectUri
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to exchange code via worker.');
        }
        return data;
    }
    
    // --- UI LOGIC ---
    function updateUI(isLoggedIn, tokens = {}) {
        loadingSpinner.classList.add('hidden');
        if (isLoggedIn) {
            loggedOutView.classList.add('hidden');
            loggedInView.classList.remove('hidden');

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
        }
    }
    
    // --- INITIALIZATION ---
    function init() {
        const accessToken = localStorage.getItem('access_token');
        const expiresAt = localStorage.getItem('token_expires_at');
        if (accessToken && expiresAt && Date.now() < expiresAt) {
            updateUI(true, {
                access_token: accessToken,
                refresh_token: localStorage.getItem('refresh_token')
            });
        } else {
            updateUI(false);
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
});
