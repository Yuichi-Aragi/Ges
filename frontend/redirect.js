// frontend/redirect.js

// IMPORTANT: Replace with the URL of your deployed Cloudflare worker
const workerUrl = 'https://ges.yukag.workers.dev'; 

window.onload = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code) {
        try {
            const response = await fetch(`${workerUrl}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to exchange code for tokens');
            }

            const tokens = await response.json();
            // Store the tokens in localStorage so the main page can access them
            localStorage.setItem('googleAuthTokens', JSON.stringify(tokens));

            // Redirect back to the main page
            window.location.href = '/Ges/';

        } catch (error) {
            console.error('Error during authentication:', error);
            document.body.innerHTML = `<div class="container"><h1>Error</h1><p>Authentication failed: ${error.message}. Please try again.</p></div>`;
        }
    } else {
        // Handle cases where the user lands here without a code
        document.body.innerHTML = '<div class="container"><h1>Error</h1><p>No authorization code found. Please initiate sign-in from the main page.</p></div>';
    }
};
