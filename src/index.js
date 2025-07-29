const CONFIG = {
  MAX_RETRIES: 2,
  INITIAL_RETRY_DELAY: 200,
  MAX_RETRY_DELAY: 2000,
  REQUEST_TIMEOUT: 8000,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_TIMEOUT: 30000,
  MAX_REQUEST_BODY_SIZE: 1024 * 10,
  VALID_CONTENT_TYPES: ['application/json'],
  ALLOWED_ORIGIN: 'https://yuichi-aragi.github.io',
  REDIRECT_URI: 'https://yuichi-aragi.github.io/Ges/redirect.html',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': CONFIG.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin'
};

class CircuitBreaker {
  constructor() {
    this.reset();
  }
  
  reset() {
    this.isOpen = false;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
  
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.isOpen = true;
    }
  }
  
  isClosed() {
    if (!this.isOpen) return true;
    
    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    if (timeSinceLastFailure > CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT) {
      this.reset();
      return true;
    }
    
    return false;
  }
}

const circuitBreaker = new CircuitBreaker();

function generateRequestId() {
  return 'req-' + 
    Math.random().toString(36).substr(2, 9) +
    '-' + Date.now().toString(36);
}

function createErrorResponse(message, status, errorCode = 'INTERNAL_ERROR', details = {}, requestId) {
  const errorResponse = {
    error: {
      code: errorCode,
      message,
      ...(requestId && { requestId })
    }
  };
  
  return new Response(JSON.stringify(errorResponse), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      ...corsHeaders 
    },
  });
}

function isValidContentType(request) {
  const contentType = request.headers.get('Content-Type') || '';
  return CONFIG.VALID_CONTENT_TYPES.some(type => 
    contentType.toLowerCase().includes(type)
  );
}

function safeParseJSON(text, maxSize) {
  if (text.length > maxSize) {
    throw new Error('Request body exceeds maximum size');
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid JSON format');
  }
}

function handleOptions(request) {
  const origin = request.headers.get('Origin');
  const requestMethod = request.headers.get('Access-Control-Request-Method');
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');
  
  if (origin && requestMethod && requestHeaders) {
    return new Response(null, {
      headers: { ...corsHeaders },
    });
  } else {
    return new Response(null, {
      headers: {
        Allow: 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400'
      },
    });
  }
}

function timeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Request timed out'));
    }, ms);
  });
}

async function fetchWithRetry(url, options, context) {
  const { requestId } = context;
  
  if (!circuitBreaker.isClosed()) {
    throw new Error('Service temporarily unavailable');
  }

  let lastError;
  
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = await Promise.race([
        fetch(url, options),
        timeout(CONFIG.REQUEST_TIMEOUT)
      ]);
      
      if (!response) {
        throw new Error('Empty response from Google API');
      }
      
      if (!response.ok) {
        circuitBreaker.recordFailure();
        
        if (response.status >= 500) {
          if (attempt < CONFIG.MAX_RETRIES) {
            const delay = Math.min(
              CONFIG.INITIAL_RETRY_DELAY * Math.pow(2, attempt),
              CONFIG.MAX_RETRY_DELAY
            );
            
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        return response;
      }
      
      circuitBreaker.reset();
      return response;
      
    } catch (error) {
      lastError = error;
      
      circuitBreaker.recordFailure();
      
      if (attempt >= CONFIG.MAX_RETRIES) {
        throw error;
      }
    }
  }
  
  throw lastError;
}

async function handleAuth(request, env) {
  const requestId = generateRequestId();
  
  try {
    if (request.method !== 'POST') {
      return createErrorResponse(
        'Method not allowed',
        405,
        'METHOD_NOT_ALLOWED',
        { allowed: 'POST' },
        requestId
      );
    }
    
    if (!isValidContentType(request)) {
      return createErrorResponse(
        'Invalid Content-Type. Must be application/json',
        415,
        'INVALID_CONTENT_TYPE',
        { expected: CONFIG.VALID_CONTENT_TYPES.join(', ') },
        requestId
      );
    }
    
    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength) > CONFIG.MAX_REQUEST_BODY_SIZE) {
      return createErrorResponse(
        'Request body too large',
        413,
        'PAYLOAD_TOO_LARGE',
        { maxSize: CONFIG.MAX_REQUEST_BODY_SIZE },
        requestId
      );
    }
    
    let requestBody;
    try {
      const text = await request.text();
      
      if (text.length > CONFIG.MAX_REQUEST_BODY_SIZE) {
        return createErrorResponse(
          'Request body too large',
          413,
          'PAYLOAD_TOO_LARGE',
          { maxSize: CONFIG.MAX_REQUEST_BODY_SIZE },
          requestId
        );
      }
      
      requestBody = safeParseJSON(text, CONFIG.MAX_REQUEST_BODY_SIZE);
    } catch (error) {
      return createErrorResponse(
        'Invalid JSON in request body',
        400,
        'INVALID_JSON',
        {},
        requestId
      );
    }
    
    const { code } = requestBody;
    
    if (!code || typeof code !== 'string') {
      return createErrorResponse(
        'Authorization code must be a string',
        400,
        'INVALID_CODE_TYPE',
        {},
        requestId
      );
    }
    
    const sanitizedCode = code.trim();
    
    const tokenResponse = await fetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        code: sanitizedCode,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: CONFIG.REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    }, { requestId });
    
    let tokenData;
    try {
      tokenData = await tokenResponse.json();
    } catch (e) {
      return createErrorResponse(
        'Invalid response from authentication service',
        502,
        'BAD_GATEWAY',
        {},
        requestId
      );
    }
    
    if (!tokenResponse.ok) {
      const errorStatusMap = {
        'invalid_request': 400,
        'invalid_client': 401,
        'invalid_grant': 400,
        'unauthorized_client': 401,
        'unsupported_grant_type': 400,
        'invalid_scope': 400
      };
      
      const status = errorStatusMap[tokenData.error] || tokenResponse.status;
      const errorCode = tokenData.error || 'GOOGLE_API_ERROR';
      const message = tokenData.error_description || 'Failed to fetch tokens from Google';
      
      return createErrorResponse(
        message,
        status,
        errorCode,
        {},
        requestId
      );
    }
    
    return new Response(JSON.stringify({
      ...tokenData,
      requestId
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders,
        'Cache-Control': 'no-store'
      },
    });
    
  } catch (error) {
    if (error.message.includes('Service temporarily unavailable')) {
      return createErrorResponse(
        'Service temporarily unavailable due to high error rates. Please try again later.',
        503,
        'SERVICE_UNAVAILABLE',
        { reason: 'circuit_breaker_open' },
        requestId
      );
    }
    
    if (error.message.includes('timed out')) {
      return createErrorResponse(
        'Request to authentication service timed out',
        504,
        'GATEWAY_TIMEOUT',
        {},
        requestId
      );
    }
    
    return createErrorResponse(
      'An internal server error occurred',
      500,
      'INTERNAL_SERVER_ERROR',
      {},
      requestId
    );
  }
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }
      
      const url = new URL(request.url);
      
      if (url.pathname === '/auth' && request.method === 'POST') {
        return handleAuth(request, env);
      }
      
      return new Response('Not Found', { 
        status: 404,
        headers: corsHeaders
      });
      
    } catch (error) {
      console.error('[CRITICAL] Unhandled worker error');
      
      return new Response(JSON.stringify({
        error: {
          code: 'WORKER_CRITICAL_FAILURE',
          message: 'Service unavailable'
        }
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          ...corsHeaders 
        },
      });
    }
  },
};
