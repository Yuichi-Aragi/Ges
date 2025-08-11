// Cloudflare worker, index.js
// Updated for improved robustness, speed, quality, reliability, resilience, precision and accuracy.
// Backwards-compatible: same endpoints, same response shapes, same config keys.

const CONFIG = {
  MAX_RETRIES: 2,
  INITIAL_RETRY_DELAY: 200,        // base ms for exponential backoff
  MAX_RETRY_DELAY: 2000,
  REQUEST_TIMEOUT: 8000,           // ms per attempt
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_TIMEOUT: 30000, // ms to attempt half-open
  CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD: 1, // success count to close
  MAX_REQUEST_BODY_SIZE: 1024 * 10,
  VALID_CONTENT_TYPES: ['application/json'],
  ALLOWED_ORIGIN: 'https://yuichi-aragi.github.io',
  REDIRECT_URI: 'https://yuichi-aragi.github.io/Ges/redirect.html',
};

// Base CORS headers template (will be copied per-response to avoid mutation)
const BASE_CORS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
};

// Utility: create per-response CORS headers (allows only configured origin)
function buildCorsHeaders(origin) {
  const allowedOrigin = origin === CONFIG.ALLOWED_ORIGIN ? origin : CONFIG.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    ...BASE_CORS,
  };
}

// --- Circuit Breaker (CLOSED / OPEN / HALF_OPEN) ---
class CircuitBreaker {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.openUntil = 0;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // immediate trip back to OPEN
      this.state = 'OPEN';
      this.openUntil = Date.now() + CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT;
    } else if (this.failureCount >= CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.state = 'OPEN';
      this.openUntil = Date.now() + CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT;
    }
  }

  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= CONFIG.CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD) {
        // Healthy again
        this.reset();
      }
    } else {
      // in CLOSED, keep failures reset on success
      this.failureCount = 0;
    }
  }

  isAvailable() {
    // Returns true if we can make a request (CLOSED or HALF_OPEN)
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      if (Date.now() >= this.openUntil) {
        // move to half-open for trial
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        // allow a trial request
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') return true;

    return false;
  }

  getState() {
    return this.state;
  }
}

const circuitBreaker = new CircuitBreaker();

// --- Request ID generation (secure when possible) ---
function generateRequestId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `req-${crypto.randomUUID()}`;
    }
  } catch (e) {
    // fallthrough to fallback
  }
  // Fallback: reasonably-unique id
  const rnd = () => Math.random().toString(36).slice(2, 10);
  return `req-${rnd()}-${Date.now().toString(36)}`;
}

// --- Error response helper ---
function createErrorResponse(message, status, errorCode = 'INTERNAL_ERROR', details = {}, requestId, origin) {
  const body = {
    error: {
      code: errorCode,
      message,
      ...(requestId && { requestId }),
      ...(details && Object.keys(details).length ? { details } : {}),
    },
  };

  const headers = {
    'Content-Type': 'application/json',
    ...buildCorsHeaders(origin),
  };

  return new Response(JSON.stringify(body), { status, headers });
}

// --- Content-Type validation ---
function isValidContentType(request) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  // Accept e.g. "application/json; charset=utf-8"
  return CONFIG.VALID_CONTENT_TYPES.some((allowed) => ct.startsWith(allowed));
}

// --- Safe JSON parse with clear errors ---
function safeParseJSON(text, maxSize) {
  if (typeof text !== 'string') {
    throw new Error('Request body must be a string');
  }
  if (text.length > maxSize) {
    const err = new Error('Request body exceeds maximum size');
    err.code = 'PAYLOAD_TOO_LARGE';
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON format');
    err.code = 'INVALID_JSON';
    throw err;
  }
}

// --- OPTIONS handler ---
function handleOptions(request) {
  const origin = request.headers.get('Origin');
  const requestMethod = request.headers.get('Access-Control-Request-Method');
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');

  if (origin && requestMethod && requestHeaders) {
    return new Response(null, { headers: buildCorsHeaders(origin) });
  } else {
    return new Response(null, {
      headers: {
        Allow: 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
}

// --- Timeout helper using AbortController for fetch ---
function abortableFetch(url, options = {}, timeoutMs = CONFIG.REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Do not mutate the original options object
  const opts = { ...options, signal };

  return fetch(url, opts)
    .finally(() => clearTimeout(timer));
}

// --- Exponential backoff with jitter helper ---
function backoffDelay(attempt) {
  const base = CONFIG.INITIAL_RETRY_DELAY * Math.pow(2, attempt);
  const capped = Math.min(base, CONFIG.MAX_RETRY_DELAY);
  // Add jitter up to 30% of delay
  const jitter = Math.floor(Math.random() * (capped * 0.3));
  return capped + jitter;
}

// --- Custom error classes for clarity ---
class CircuitOpenError extends Error {
  constructor(message = 'Service temporarily unavailable (circuit open)') {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

// --- fetch with retry, timeout (per attempt), circuit breaker awareness ---
async function fetchWithRetry(url, options = {}, context = {}) {
  const { requestId, origin } = context || {};

  if (!circuitBreaker.isAvailable()) {
    // Circuit is open and not ready for trial
    throw new CircuitOpenError();
  }

  let lastError = null;

  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    // If circuit switched to OPEN while looping, break early
    if (!circuitBreaker.isAvailable()) {
      throw new CircuitOpenError();
    }

    try {
      // ensure headers object exists
      const attemptOptions = { ...(options || {}) };

      // Use AbortController per attempt for precise timeouts
      const response = await abortableFetch(url, attemptOptions, CONFIG.REQUEST_TIMEOUT);

      if (!response) {
        throw new Error('Empty response from upstream service');
      }

      // If 5xx, consider retrying
      if (!response.ok && response.status >= 500) {
        circuitBreaker.recordFailure();
        lastError = new Error(`Upstream server error: ${response.status}`);
        if (attempt < CONFIG.MAX_RETRIES) {
          const delay = backoffDelay(attempt);
          await new Promise((res) => setTimeout(res, delay));
          continue;
        }
        // last attempt -> return response so caller can parse error body if desired
        return response;
      }

      // For other non-ok statuses (4xx), do not treat as circuit failure, but return
      if (!response.ok) {
        return response;
      }

      // Success
      circuitBreaker.recordSuccess();
      return response;
    } catch (err) {
      lastError = err;

      // If aborted due to timeout, treat as transient
      const isTimeout = err.name === 'AbortError' || /timed out|timeout/i.test(err.message);
      // For network failures or timeouts, count a failure
      circuitBreaker.recordFailure();

      // If we've exhausted attempts, surface the error
      if (attempt >= CONFIG.MAX_RETRIES) {
        throw err;
      }

      // Otherwise wait with backoff + jitter
      const delay = backoffDelay(attempt);
      await new Promise((res) => setTimeout(res, delay));
      // continue to next attempt
    }
  }

  // If somehow reached here, throw last error
  throw lastError || new Error('Unknown error during fetchWithRetry');
}

// --- Main handler for /auth ---
async function handleAuth(request, env) {
  const requestId = generateRequestId();
  const origin = request.headers.get('Origin') || CONFIG.ALLOWED_ORIGIN;

  // Basic env validation (fail fast and clearly)
  if (!env || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.error(`[${requestId}] Missing Google OAuth env vars`);
    return createErrorResponse(
      'Server configuration error',
      500,
      'CONFIGURATION_ERROR',
      { required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] },
      requestId,
      origin
    );
  }

  // Only allow POST (we keep exact behaviour)
  if (request.method !== 'POST') {
    return createErrorResponse(
      'Method not allowed',
      405,
      'METHOD_NOT_ALLOWED',
      { allowed: 'POST' },
      requestId,
      origin
    );
  }

  // Validate content-type
  if (!isValidContentType(request)) {
    return createErrorResponse(
      'Invalid Content-Type. Must be application/json',
      415,
      'INVALID_CONTENT_TYPE',
      { expected: CONFIG.VALID_CONTENT_TYPES.join(', ') },
      requestId,
      origin
    );
  }

  // Quick Content-Length check before reading body to avoid memory pressure
  const contentLengthHeader = request.headers.get('Content-Length');
  if (contentLengthHeader) {
    const parsed = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(parsed) && parsed > CONFIG.MAX_REQUEST_BODY_SIZE) {
      return createErrorResponse(
        'Request body too large',
        413,
        'PAYLOAD_TOO_LARGE',
        { maxSize: CONFIG.MAX_REQUEST_BODY_SIZE },
        requestId,
        origin
      );
    }
  }

  let text = '';
  try {
    // Read body (safeParseJSON will re-check size)
    text = await request.text();

    if (text.length > CONFIG.MAX_REQUEST_BODY_SIZE) {
      return createErrorResponse(
        'Request body too large',
        413,
        'PAYLOAD_TOO_LARGE',
        { maxSize: CONFIG.MAX_REQUEST_BODY_SIZE },
        requestId,
        origin
      );
    }
  } catch (err) {
    console.error(`[${requestId}] Error reading request body:`, err);
    return createErrorResponse(
      'Unable to read request body',
      400,
      'BAD_REQUEST',
      {},
      requestId,
      origin
    );
  }

  let requestBody;
  try {
    requestBody = safeParseJSON(text, CONFIG.MAX_REQUEST_BODY_SIZE);
  } catch (err) {
    const code = err && err.code === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON';
    const status = code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return createErrorResponse(
      err.message || 'Invalid JSON in request body',
      status,
      code,
      {},
      requestId,
      origin
    );
  }

  const { code } = requestBody || {};
  if (!code || typeof code !== 'string') {
    return createErrorResponse(
      'Authorization code must be a string',
      400,
      'INVALID_CODE_TYPE',
      {},
      requestId,
      origin
    );
  }

  const sanitizedCode = code.trim();

  // Build token request body exactly as before (keeps API compatibility)
  const tokenRequestBody = JSON.stringify({
    code: sanitizedCode,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: CONFIG.REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  // Prepare headers
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Attempt to fetch token with retry and circuit-breaker awareness
  let tokenResponse;
  try {
    tokenResponse = await fetchWithRetry(
      'https://oauth2.googleapis.com/token',
      { method: 'POST', headers, body: tokenRequestBody },
      { requestId, origin }
    );
  } catch (err) {
    // Circuit open
    if (err instanceof CircuitOpenError) {
      console.warn(`[${requestId}] Circuit open, rejecting request`);
      return createErrorResponse(
        'Service temporarily unavailable due to high error rates. Please try again later.',
        503,
        'SERVICE_UNAVAILABLE',
        { reason: 'circuit_breaker_open' },
        requestId,
        origin
      );
    }

    // Abort / timeout
    if (err.name === 'AbortError' || /timed out|timeout/i.test(err.message)) {
      console.error(`[${requestId}] Upstream request timed out`);
      return createErrorResponse(
        'Request to authentication service timed out',
        504,
        'GATEWAY_TIMEOUT',
        {},
        requestId,
        origin
      );
    }

    console.error(`[${requestId}] Upstream request failed:`, err);
    return createErrorResponse(
      'An internal server error occurred while contacting authentication service',
      502,
      'BAD_GATEWAY',
      {},
      requestId,
      origin
    );
  }

  // Parse token response body (be defensive)
  let tokenData;
  try {
    // Use .json() to parse; if it's invalid JSON, catch and return 502
    tokenData = await tokenResponse.json();
  } catch (err) {
    console.error(`[${requestId}] Invalid JSON from token endpoint:`, err);
    return createErrorResponse(
      'Invalid response from authentication service',
      502,
      'BAD_GATEWAY',
      {},
      requestId,
      origin
    );
  }

  // If token endpoint responded with error (4xx/5xx or error object), map to appropriate status
  if (!tokenResponse.ok) {
    const errorStatusMap = {
      invalid_request: 400,
      invalid_client: 401,
      invalid_grant: 400,
      unauthorized_client: 401,
      unsupported_grant_type: 400,
      invalid_scope: 400,
    };

    const status = (tokenData && tokenData.error && errorStatusMap[tokenData.error]) || tokenResponse.status || 400;
    const errorCode = (tokenData && tokenData.error) || 'GOOGLE_API_ERROR';
    const message = (tokenData && (tokenData.error_description || tokenData.error)) || 'Failed to fetch tokens from Google';

    return createErrorResponse(
      message,
      status,
      errorCode,
      {},
      requestId,
      origin
    );
  }

  // Successful response; include requestId as before
  const responseBody = {
    ...tokenData,
    requestId,
  };

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...buildCorsHeaders(origin),
      'Cache-Control': 'no-store',
    },
  });
}

// --- Worker entry point ---
export default {
  async fetch(request, env) {
    const requestId = generateRequestId();
    const origin = request.headers.get('Origin') || CONFIG.ALLOWED_ORIGIN;

    try {
      // Fast-path OPTIONS
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }

      const url = new URL(request.url);
      // Strictly preserve original behaviour: only POST /auth is handled
      if (url.pathname === '/auth' && request.method === 'POST') {
        // delegate
        return await handleAuth(request, env);
      }

      // Not found
      return new Response('Not Found', {
        status: 404,
        headers: buildCorsHeaders(origin),
      });
    } catch (error) {
      // Last-resort: catch everything and return stable error response
      console.error(`[${requestId}] Unhandled worker error:`, error);
      return new Response(JSON.stringify({
        error: {
          code: 'WORKER_CRITICAL_FAILURE',
          message: 'Service unavailable',
          requestId,
        }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...buildCorsHeaders(origin),
        },
      });
    }
  },
};
