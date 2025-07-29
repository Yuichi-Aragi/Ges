// This script is deferred, so lucide is guaranteed to be available.
// We call this first to render the initial spinner icon on the page.
try {
    lucide.createIcons();
} catch (e) {
    console.error("Failed to render initial icons on redirect page.", e);
}


const workerUrl = 'https://ges.yukag.workers.dev'.trim();

// Use an immediately-invoked async function to handle the logic.
// This runs after the script is loaded and parsed, thanks to 'defer'.
(async () => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code')?.trim() || null;

        if (!code) {
            return renderError(
                'Invalid Request',
                'No authorization code found. Please return to the main page and try signing in again.'
            );
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        try {
            const response = await fetch(`${workerUrl}/auth`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ code }),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                let errorJson;
                try {
                    errorJson = JSON.parse(errorText);
                } catch {
                    throw new Error(errorText || `Server returned status ${response.status}`);
                }
                throw new Error(errorJson.error || 'Invalid server response');
            }

            const tokens = await response.json();
            
            if (typeof tokens !== 'object' || !tokens.access_token) {
                throw new Error('Received an invalid token response from the server.');
            }

            localStorage.setItem('googleAuthTokens', JSON.stringify(tokens));
            
            // Correctly determine the base path for GitHub Pages
            const pathSegments = window.location.pathname.split('/').filter(Boolean);
            const repoName = pathSegments[0] === 'Ges' ? '/Ges/' : '/';
            window.location.replace(window.location.origin + repoName);

        } catch (error) {
            if (error.name === 'AbortError') {
                renderError(
                    'Request Timeout',
                    'The authentication request took too long. Please check your internet connection and try again.'
                );
            } else {
                renderError(
                    'Authentication Failed',
                    `An error occurred during authentication: ${escapeHtml(error.message || 'Unknown error')}`
                );
            }
            console.error('OAuth redirect handler error:', {
                code: code.substring(0, 4) + '...',
                error: error.message,
                stack: error.stack
            });
        }
    } catch (initError) {
        renderError(
            'System Error',
            'A critical error occurred while initializing the page. Please refresh and try again.'
        );
        console.error('OAuth redirect initialization failed:', initError);
    }
})();


function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, """)
        .replace(/'/g, "'");
}

function renderError(title, message) {
    document.body.innerHTML = `
        <div class="flex min-h-screen w-full items-center justify-center p-4">
            <div class="w-full max-w-md rounded-2xl bg-white p-8 text-center dark:bg-slate-800/50 dark:backdrop-blur-sm dark:border dark:border-slate-700 shadow-2xl shadow-slate-900/10">
                <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                    <i data-lucide="alert-triangle" class="h-6 w-6 text-red-600 dark:text-red-400"></i>
                </div>
                <h1 class="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">${escapeHtml(title)}</h1>
                <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">${message}</p>
                <a href="/Ges/" class="mt-8 inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 dark:focus-visible:ring-slate-400 dark:ring-offset-slate-900">
                    Return to Sign-in
                </a>
            </div>
        </div>
    `;
    // Render the lucide icon we just added to the DOM
    lucide.createIcons();
}