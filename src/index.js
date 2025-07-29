// This is the entire backend. It's stateless and secure.

// Define the CORS headers to allow our GitHub Pages site to call this worker.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // For production, you can restrict this to your specific GitHub Pages URL
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // `env` contains our secrets (GOOGLE_CLIENT_SECRET) and vars (GOOGLE_CLIENT_ID)

    // Handle CORS preflight requests required by browsers
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'This worker only accepts POST requests.' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    try {
      const { code, redirect_uri } = await request.json();

      if (!code) {
        return new Response(JSON.stringify({ error: 'Missing authorization code.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const TOKEN_URL = 'https://oauth2.googleapis.com/token';

      // Prepare the request body to send to Google.
      // The client_id and client_secret are securely fetched from the worker's environment.
      const body = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirect_uri,
      });

      const tokenResponse = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body,
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(tokenData.error_description || 'Failed to fetch token from Google.');
      }

      // Success! Return the tokens to the frontend with CORS headers.
      return new Response(JSON.stringify(tokenData), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
