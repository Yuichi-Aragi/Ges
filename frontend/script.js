const config = {
    clientId: '909976441907-avv9kfpdhkrutuul0ded4gej2u8dq85l.apps.googleusercontent.com',
    redirectUri: 'https://yuichi-aragi.github.io/Ges/redirect.html',
    scope: 'https://www.googleapis.com/auth/drive.readonly'
};

// The defer attribute on the script tag ensures this code runs after the DOM is ready.
try {
    // Prevents Flash of Unstyled Content (FOUC)
    document.body.classList.add('loaded');

    // DOM element initialization
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const loggedOutView = document.getElementById('loggedOutView');
    const loggedInView = document.getElementById('loggedInView');
    const accessTokenEl = document.getElementById('accessToken');
    const refreshTokenEl = document.getElementById('refreshToken');
    const refreshTokenWarning = document.getElementById('refreshTokenWarning');
    const copyButtons = document.querySelectorAll('.copy-button');

    if (!loginButton || !logoutButton || !loggedOutView || !loggedInView) {
        console.warn('OAuth UI: Critical elements missing, exiting initialization');
        throw new Error('Critical UI elements are missing from the page.');
    }

    const TokenStorage = {
        get() {
            try {
                const raw = localStorage.getItem('googleAuthTokens');
                if (!raw) return null;
                const tokens = JSON.parse(raw);
                if (typeof tokens !== 'object' || !tokens.access_token) {
                    this.clear();
                    return null;
                }
                return tokens;
            } catch (e) {
                this.clear();
                return null;
            }
        },
        clear() {
            localStorage.removeItem('googleAuthTokens');
        }
    };

    const showView = (viewToShow) => {
        loggedOutView.classList.add('hidden');
        loggedInView.classList.add('hidden');
        if (viewToShow) {
            viewToShow.classList.remove('hidden');
        }
    };

    const displayTokens = (tokens) => {
        if (accessTokenEl) accessTokenEl.value = tokens.access_token || '';
        
        if (refreshTokenEl && refreshTokenWarning) {
            if (tokens.refresh_token) {
                refreshTokenEl.value = tokens.refresh_token;
                refreshTokenWarning.classList.add('hidden');
            } else {
                refreshTokenEl.value = 'Not available. This token is only provided on the first authorization.';
                refreshTokenWarning.classList.remove('hidden');
            }
        }
    };

    loginButton.addEventListener('click', () => {
        try {
            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            authUrl.searchParams.append('client_id', config.clientId);
            authUrl.searchParams.append('redirect_uri', config.redirectUri.trim());
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('scope', config.scope.trim());
            authUrl.searchParams.append('access_type', 'offline');
            authUrl.searchParams.append('prompt', 'consent');
            
            window.location.href = authUrl.toString();
        } catch (e) {
            console.error('OAuth: Failed to construct auth URL', e);
            alert('Authentication setup error. Please contact support.');
        }
    });

    logoutButton.addEventListener('click', () => {
        const tokens = TokenStorage.get();
        TokenStorage.clear();
        showView(loggedOutView);
        
        if (tokens?.refresh_token) {
            fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.refresh_token}`)
                .catch(() => {}); // Non-critical, ignore failures
        }
    });

    const setupCopyButtons = () => {
        copyButtons.forEach(button => {
            const targetId = button.dataset.target;
            const targetEl = document.getElementById(targetId);
            const copyIcon = button.querySelector('.copy-icon');
            const checkIcon = button.querySelector('.check-icon');
            
            if (!targetEl || !copyIcon || !checkIcon) return;
            
            button.addEventListener('click', () => {
                navigator.clipboard.writeText(targetEl.value).then(() => {
                    copyIcon.classList.add('hidden');
                    checkIcon.classList.remove('hidden');
                    
                    setTimeout(() => {
                        checkIcon.classList.add('hidden');
                        copyIcon.classList.remove('hidden');
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy text: ', err);
                    // Optional: Add visual feedback for error
                });
            });
        });
    };

    const init = () => {
        const tokens = TokenStorage.get();
        if (tokens) {
            displayTokens(tokens);
            showView(loggedInView);
        } else {
            showView(loggedOutView);
        }
        setupCopyButtons();
        // Render all lucide icons on the page. This is safe now because of 'defer'.
        lucide.createIcons();
    };

    init();

} catch (e) {
    console.error('OAuth initialization failed', e);
    document.body.innerHTML = '<div class="flex min-h-screen items-center justify-center p-4 font-sans text-center text-red-600 dark:text-red-400">A critical error occurred. Please refresh the page or contact support if the problem persists.</div>';
}