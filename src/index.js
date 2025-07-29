// src/index.js

// Define the CORS headers object. This explicitly tells the browser
// that your frontend origin is allowed to make requests.
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yuichi-aragi.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', // Allow POST for your auth call and OPTIONS for the preflight
  'Access-Control-Allow-Headers': 'Content-Type',   // Allow the 'Content-Type' header which you send
};

/**
 * Handles the CORS preflight request sent by the browser.
 * This is crucial for non-simple requests like POST with a JSON body.
 */
function handleOptions(request) {
  // Make sure the request is a valid CORS preflight request.
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // This is a preflight request. Respond with the CORS headers.
    // The browser will see these headers and then send the actual POST request.
    return new Response(null, {
      headers: corsHeaders,
    });
  } else {
    // This is a standard OPTIONS request, not a CORS preflight.
    // It's good practice to still respond with what methods are allowed.
    return new Response(null, {
      headers: {
        Allow: 'POST, OPTIONS',
      },
    });
  }
}

/**
 * Handles the main authentication logic.
 */
async function handleAuth(request, env) {
  try {
    const { code } = await request.json();

    if (!code) {
      // Always include CORS headers in every response
      return new Response(JSON.stringify({ error: 'Authorization code is missing.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://yuichi-aragi.github.io/Ges/redirect.html',
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Google API Error:', tokenData);
      // Always include CORS headers in every response
      return new Response(JSON.stringify({ error: tokenData.error_description || 'Failed to fetch tokens from Google.' }), {
        status: tokenResponse.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Always include CORS headers in every response, especially the success case!
    return new Response(JSON.stringify(tokenData), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Worker Error:', error);
    // Always include CORS headers in every response
    return new Response(JSON.stringify({ error: 'An internal server error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

// The main entry point for the worker
export default {
  async fetch(request, env) {
    // IMPORTANT: Handle the OPTIONS preflight request first!
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    if (url.pathname === '/auth' && request.method === 'POST') {
      return handleAuth(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};
