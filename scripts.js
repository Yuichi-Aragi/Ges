document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const config = {
        clientId: '909976441907-avv9kfpdhkrutuul0ded4gej2u8dq85l.apps.googleusercontent.com', // This will be replaced by the GitHub Action
        scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.profile',
        tokenUrl: 'https://oauth2.googleapis.com/token',
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
            // Don't initialize if the placeholder is still there
            console.error("Google Client ID has not been replaced. Check your GitHub Action setup.");
            return;
        }

        googleClient = google.accounts.oauth2.initCodeClient({
            client_id: config.clientId,
            scope: config.scope,
            callback: (response) => {
                // This callback is triggered after the user signs in and grants consent.
                // The 'response.code' is the authorization code we need.
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
        // Trigger the official Google sign-in flow
        googleClient.requestCode();
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('token_expires_at');
        updateUI(false);
    });

    async function handleAuthCode(code) {
        // We have a code, so show the loading spinner
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
            
            // Now that we have tokens, update the UI
            await fetchUserInfo(tokens.access_token);
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
        const response = await fetch(config.tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: window.location.origin + window.location.pathname, // Must match what's in Google Console
                code: code,
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
        // This function runs on page load to see if we're already logged in
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
