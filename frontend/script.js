// frontend/script.js

const config = {
    // IMPORTANT: Replace with your actual Google Cloud Client ID
    clientId: '909976441907-avv9kfpdhkrutuul0ded4gej2u8dq85l.apps.googleusercontent.com', 
    // IMPORTANT: Replace with the URL of your deployed Cloudflare worker
    workerUrl: 'https://ges.yukag.workers.dev/' 
};

document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const accessTokenEl = document.getElementById('accessToken');
    const refreshTokenEl = document.getElementById('refreshToken');
    const refreshTokenWarning = document.getElementById('refreshTokenWarning');

    // Initialize Google Identity Services
    const client = google.accounts.oauth2.initCodeClient({
        client_id: config.clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly', // Or any other scopes you need
        ux_mode: 'popup',
        callback: (response) => {
            if (response.code) {
                showLoading();
                exchangeCodeForTokens(response.code);
            } else {
                console.error('Google did not return an authorization code.');
                showLoggedOut();
            }
        },
    });

    loginButton.addEventListener('click', () => {
        client.requestCode();
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('googleAuthTokens');
        showLoggedOut();
    });

    // Function to exchange authorization code for tokens via the worker
    async function exchangeCodeForTokens(code) {
        try {
            const response = await fetch(`${config.workerUrl}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to exchange code for tokens');
            }

            const tokens = await response.json();
            localStorage.setItem('googleAuthTokens', JSON.stringify(tokens));
            displayTokens(tokens);
            showLoggedIn();

        } catch (error) {
            console.error('Error exchanging code for tokens:', error);
            alert(`Error: ${error.message}`);
            showLoggedOut();
        }
    }

    function displayTokens(tokens) {
        accessTokenEl.value = tokens.access_token;
        if (tokens.refresh_token) {
            refreshTokenEl.value = tokens.refresh_token;
            refreshTokenWarning.classList.add('hidden');
        } else {
            refreshTokenEl.value = 'Not provided in this sign-in.';
            refreshTokenWarning.classList.remove('hidden');
        }
    }
    
    // UI state management
    function showLoading() {
        loggedOutView.classList.add('hidden');
        loggedInView.classList.add('hidden');
        loadingSpinner.classList.remove('hidden');
    }

    function showLoggedIn() {
        loadingSpinner.classList.add('hidden');
        loggedOutView.classList.add('hidden');
        loggedInView.classList.remove('hidden');
    }

    function showLoggedOut() {
        loadingSpinner.classList.add('hidden');
        loggedInView.classList.add('hidden');
        loggedOutView.classList.remove('hidden');
    }

    // Check for stored tokens on page load
    const storedTokens = localStorage.getItem('googleAuthTokens');
    if (storedTokens) {
        displayTokens(JSON.parse(storedTokens));
        showLoggedIn();
    }

    // Add copy to clipboard functionality
    document.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.target;
            const textarea = document.getElementById(targetId);
            textarea.select();
            document.execCommand('copy');
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = 'Copy';
            }, 2000);
        });
    });
});
