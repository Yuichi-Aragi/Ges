// src/index.js

export default {
  async fetch(request, env) {
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

async function handleAuth(request, env) {
  try {
    const { code } = await request.json();

    if (!code) {
      return new Response(JSON.stringify({ error: 'Authorization code is missing.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: code,
        client_id: env.CLIENT_ID,
        client_secret: env.CLIENT_SECRET,
        // CORRECTED: This URI must be authorized in your Google Cloud Console
        // and must match what the Google Identity Services library uses.
        redirect_uri: 'https://accounts.google.com/gsi/client',
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
        console.error('Google API Error:', tokenData);
        return new Response(JSON.stringify({ error: tokenData.error_description || 'Failed to fetch tokens from Google.' }), {
            status: tokenResponse.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }

    return new Response(JSON.stringify(tokenData), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Worker Error:', error);
    return new Response(JSON.stringify({ error: 'An internal server error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yuichi-aragi.github.io', // Best practice: Restrict to your frontend's domain
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    return new Response(null, { headers: corsHeaders });
  } else {
    return new Response(null, { headers: { Allow: 'POST, OPTIONS' } });
  }
}
