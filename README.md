# Ges - A Simple Google OAuth Token Generator

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)
[![Privacy First](https://img.shields.io/badge/privacy-first-ff69b4.svg)](#privacy--security)

Ges is a minimalist, secure, and fully transparent web application for generating Google API access and refresh tokens. It's designed for developers, power-users, and anyone who needs programmatic access to their Google Drive without compromising their privacy.

## The Problem: Trusting the Token Tool

Getting Google API tokens, especially long-lived `refresh tokens`, can be a hassle. The official OAuth 2.0 flow is complex to set up for a one-off project, and many users turn to third-party websites or tools to simplify the process.

However, this introduces a significant privacy risk:
*   **How do you know the tool isn't storing your tokens?**
*   **Can you be sure your credentials aren't being logged or misused?**
*   **Is the service secure from data breaches?**

When you authorize an opaque, closed-source application, you are placing complete trust in its developers to handle your credentials responsibly.

## The Solution: Radical Transparency

Ges was born from a simple idea: **you shouldn't have to trade privacy for convenience.**

This project provides an easy-to-use interface for generating tokens while giving you the ability to verify exactly what's happening with your data at every step.

### Key Principles

*   **Fully Open Source:** Every line of code—from the frontend HTML/CSS/JS to the backend Cloudflare Worker—is available for inspection in this repository. There are no hidden scripts or secret server-side logic.
*   **No Server-Side Storage:** The backend's only job is to perform the one-time exchange of an authorization code for your tokens. It immediately returns the tokens to your browser and **does not store, log, or cache them.**
*   **Client-Side Control:** Your tokens are delivered directly to your browser and are only ever stored in your browser's `localStorage`. You have full control and can clear them at any time by clicking "Logout" or clearing your site data.
*   **Minimalist Scope:** The application requests only the permissions it needs to function (currently, Google Drive access), as stated in the [Privacy Policy](./privacy.html).

## How It Works

The application uses the standard OAuth 2.0 Authorization Code Flow, which is the most secure method for web applications.

1.  **You Click "Sign In"**: You are redirected to Google's official sign-in and consent screen. You are authenticating directly with Google; this application never sees your password.
2.  **You Grant Permission**: You approve the request for the application to access your Google Drive data.
3.  **Google Redirects You**: Google sends you back to a `redirect.html` page with a temporary, one-time `authorization_code`.
4.  **Code-for-Token Exchange**: The JavaScript on the redirect page sends this `authorization_code` to our lightweight Cloudflare Worker backend.
5.  **Secure Backend Exchange**: The Cloudflare Worker securely exchanges the `code` (along with its client secret) with Google's servers to get your `access_token` and `refresh_token`.
6.  **Tokens Returned to You**: The worker immediately sends the tokens back to your browser, which then displays them on the screen for you to copy.

At no point are your tokens saved on any server. The entire process is designed to be auditable and trustworthy.

## How to Use

1.  Navigate to the deployed application URL.
2.  Click the **Sign In with Google** button.
3.  Choose your Google Account and grant the requested permissions on the Google consent screen.
4.  You will be redirected back to the main page, where you will see two tokens:
    *   **Access Token**: A short-lived (1-hour) token used to make direct API calls.
    *   **Refresh Token**: A long-lived token you can use to generate new access tokens without needing to log in again. **Store this securely!** It is typically only provided the first time you authorize the application.
5.  Use the "Copy" buttons to get your tokens for use in your scripts or applications (e.g., `rclone`, Python scripts, etc.).

## Privacy & Security

This project's primary feature is its commitment to your privacy.

*   **No Databases:** There is no database or permanent storage on the backend.
*   **Ephemeral Data:** The Cloudflare Worker only holds your data in memory for the few seconds it takes to complete the token exchange.
*   **Full Transparency:** We encourage you to read the [Privacy Policy](./privacy.html) and inspect the source code.

## For Self-Hosters & Developers

You can easily deploy your own instance of this application.

### Prerequisites

1.  A Cloudflare account.
2.  A clone of this repository.
3.  A Google OAuth 2.0 Client ID and Client Secret. You can create these in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
    *   When creating your credentials, you must add your final deployment URL to the "Authorized JavaScript origins" and your redirect URI (e.g., `https://your-app.pages.dev/redirect.html`) to the "Authorized redirect URIs".

### Method 1: Deployment via Wrangler CLI (Recommended)

This method gives you the most control over the deployment process.

1.  Install the Wrangler CLI: `npm install -g wrangler`.
2.  Log in to your Cloudflare account: `wrangler login`.
3.  In the project root, create a `.dev.vars` file and add your Google secrets. **Do not commit this file.**
    ```
    GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
    GOOGLE_CLIENT_SECRET="your-client-secret"
    ```
4.  Run `wrangler deploy`. This will deploy the worker and static assets for the first time. The command will output your application's URL (e.g., `https://ges.your-worker.workers.dev`).
5.  Open `frontend/redirect.js` and update the `workerUrl` constant with the full URL of your deployed worker.
6.  Run `wrangler deploy` one more time to deploy the updated frontend with the correct worker URL. Done!

### Method 2: Deployment via Cloudflare Dashboard

This is a great alternative if you prefer a user interface.

1.  Complete the **Prerequisites** listed above.
2.  Log in to the Cloudflare dashboard, go to **Workers & Pages**, and select **Create application**.
3.  Import your forked/cloned Git repository.
4.  In the project settings:
    *   Set the **Framework preset** to `None`.
    *   Set the **Root directory** to `/`.
    *   Go to **Settings** -> **Environment Variables** and add your `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Make sure to click "Encrypt" for the secret.
5.  Deploy the project. Cloudflare will give you the production URL (e.g., `https://your-project.pages.dev`).
6.  Copy this URL and paste it into the `workerUrl` variable in `frontend/redirect.js`.
7.  Commit and push this change to your repository. Cloudflare will automatically detect the change and re-deploy your application. You are good to go.
