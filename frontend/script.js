// frontend/script.js

const config = {
    // IMPORTANT: Replace with your actual Google Cloud Client ID
    clientId: '909976441907-avv9kfpdhkrutuul0ded4gej2u8dq85l.apps.googleusercontent.com',
    // The exact redirect URI you authorized in the Google Cloud Console
    redirectUri: 'https://ges.yukag.workers.dev/',
    // The scopes your application needs
    scope: 'https://www.googleapis.com/auth/drive.readonly'
};

document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const accessTokenEl = document.getElementById('accessToken');
    const refreshTokenEl = document.getElementById('refreshToken');
    const refreshTokenWarning = document.getElementById('refreshTokenWarning');

    // When the user clicks login, construct the auth URL and redirect them
    loginButton.addEventListener('click', () => {
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${config.clientId}` +
            `&redirect_uri=${encodeURIComponent(config.redirectUri)}` +
            `&response_type=code` +
            `&scope=${encodeURIComponent(config.scope)}` +
            `&access_type=offline` + // Important: prompts for refresh token
            `&prompt=consent`;      // Important: ensures refresh token is sent every time
        
        window.location.href = authUrl;
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('googleAuthTokens');
        showLoggedOut();
    });

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
    function showLoggedIn() {
        loggedOutView.classList.add('hidden');
        loggedInView.classList.remove('hidden');
    }

    function showLoggedOut() {
        loggedInView.classList.add('hidden');
        loggedOutView.classList.remove('hidden');
    }

    // On page load, check if tokens were stored by the redirect page
    const storedTokens = localStorage.getItem('googleAuthTokens');
    if (storedTokens) {
        displayTokens(JSON.parse(storedTokens));
        showLoggedIn();
    } else {
        showLoggedOut();
    }

    // Add copy to clipboard functionality
    document.querySelectorAll('.copy-button').forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.target;
            const textarea = document.getElementById(targetId);
            textarea.select();
            document.execCommand('copy');
            button.textContent = 'Copied!';
            setTimeout(() => { button.textContent = 'Copy'; }, 2000);
        });
    });
});
