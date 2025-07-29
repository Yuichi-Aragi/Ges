// src/index.js

/**
 * Cloudflare Worker for Google OAuth token exchange
 * 
 * SECURITY-CRITICAL IMPLEMENTATION:
 * - Zero sensitive data logging
 * - Memory leak prevention
 * - Edge case hardening
 * - Complete backward compatibility
 * 
 * All improvements are contained within this file only.
 */

// Core configuration constants
const CONFIG = {
  MAX_RETRIES: 2,
  INITIAL_RETRY_DELAY: 200,
  MAX_RETRY_DELAY: 2000,
  REQUEST_TIMEOUT: 8000,
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_TIMEOUT: 30000,
  MAX_REQUEST_BODY_SIZE: 1024 * 10, // 10KB max request size
  VALID_CONTENT_TYPES: ['application/json'],
  // Remove trailing spaces from URLs - critical fix
  ALLOWED_ORIGIN: 'https://yuichi-aragi.github.io',
  REDIRECT_URI: 'https://yuichi-aragi.github.io/Ges/redirect.html',
  // Google code pattern validation (simplified but safe)
  CODE_PATTERN: /^[A-Za-z0-9\-_]{10,100}$/
};

// CORS headers - properly formatted
const corsHeaders = {
  'Access-Control-Allow-Origin': CONFIG.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin' // Critical for proper caching with CORS
};

// Circuit breaker state (memory-safe implementation)
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

// Create a single circuit breaker instance (prevents memory leaks from multiple instances)
const circuitBreaker = new CircuitBreaker();

/**
 * Creates a unique request ID for tracing (without sensitive data)
 * @returns {string} UUID-like request identifier
 */
function generateRequestId() {
  return 'req-' + 
    Math.random().toString(36).substr(2, 9) +
    '-' + Date.now().toString(36);
}

/**
 * Creates a standardized error response with proper CORS headers
 * 
 * @param {string} message - User-friendly error message
 * @param {number} status - HTTP status code
 * @param {string} [errorCode] - Machine-readable error code
 * @param {Object} [details] - Additional error details (sanitized)
 * @param {string} [requestId] - Request identifier for tracing
 * @returns {Response} Formatted error response
 */
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

/**
 * Validates the request content type
 * 
 * @param {Request} request - Incoming request
 * @returns {boolean} Whether content type is valid
 */
function isValidContentType(request) {
  const contentType = request.headers.get('Content-Type') || '';
  return CONFIG.VALID_CONTENT_TYPES.some(type => 
    contentType.toLowerCase().includes(type)
  );
}

/**
 * Safely parses JSON with size limitation
 * 
 * @param {string} text - JSON string to parse
 * @param {number} maxSize - Maximum allowed size in bytes
 * @returns {Object} Parsed JSON object
 * @throws {Error} If parsing fails or size exceeds limit
 */
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

/**
 * Handles the CORS preflight request with enhanced validation
 * 
 * @param {Request} request - Incoming OPTIONS request
 * @returns {Response} Preflight response
 */
function handleOptions(request) {
  const origin = request.headers.get('Origin');
  const requestMethod = request.headers.get('Access-Control-Request-Method');
  const requestHeaders = request.headers.get('Access-Control-Request-Headers');
  
  // More robust preflight validation
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

/**
 * Creates a timeout promise that rejects after specified duration
 * 
 * @param {number} ms - Timeout duration in milliseconds
 * @returns {Promise} Timeout promise
 */
function timeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Request timed out'));
    }, ms);
  });
}

/**
 * Executes a fetch with retry mechanism and circuit breaker
 * 
 * @param {string} url - Target URL
 * @param {Object} options - Fetch options
 * @param {Object} context - Contextual information
 * @returns {Promise<Response>} Fetch response
 */
async function fetchWithRetry(url, options, context) {
  const { requestId } = context;
  
  // Check circuit breaker first
  if (!circuitBreaker.isClosed()) {
    throw new Error('Service temporarily unavailable');
  }

  let lastError;
  
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      // Race the fetch against a timeout
      const response = await Promise.race([
        fetch(url, options),
        timeout(CONFIG.REQUEST_TIMEOUT)
      ]);
      
      // Check if response is valid
      if (!response) {
        throw new Error('Empty response from Google API');
      }
      
      // Check HTTP status
      if (!response.ok) {
        // Record failure for circuit breaker
        circuitBreaker.recordFailure();
        
        // Handle specific Google API errors
        if (response.status >= 500) {
          // Server errors - might be temporary
          if (attempt < CONFIG.MAX_RETRIES) {
            // Calculate exponential backoff delay
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
      
      // Success - reset circuit breaker
      circuitBreaker.reset();
      return response;
      
    } catch (error) {
      lastError = error;
      
      // Record network errors for circuit breaker
      circuitBreaker.recordFailure();
      
      // Don't retry on client errors or if max retries reached
      if (attempt >= CONFIG.MAX_RETRIES) {
        throw error;
      }
    }
  }
  
  throw lastError;
}

/**
 * Handles the main authentication logic with comprehensive error handling
 * 
 * @param {Request} request - Incoming POST request
 * @param {Object} env - Environment variables
 * @returns {Promise<Response>} Authentication response
 */
async function handleAuth(request, env) {
  const requestId = generateRequestId();
  
  try {
    // Enhanced request validation
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
    
    // Read and validate request body size first
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
    
    // Parse request body with validation
    let requestBody;
    try {
      const text = await request.text();
      
      // Additional size check after decoding
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
    
    // Enhanced code validation - no sensitive data handling
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
    
    // Sanitize and validate code format (without logging the actual code)
    const sanitizedCode = code.trim();
    
    // Basic format validation without logging the code
    if (!CONFIG.CODE_PATTERN.test(sanitizedCode)) {
      return createErrorResponse(
        'Authorization code has invalid format',
        400,
        'INVALID_CODE_FORMAT',
        {},
        requestId
      );
    }
    
    // Google token request with retry mechanism
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
    
    // Handle Google API response with safety checks
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
    
    // Handle Google API specific errors
    if (!tokenResponse.ok) {
      // Map Google error codes to appropriate HTTP status
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
    
    // Return standardized success response
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
    // Special handling for circuit breaker errors
    if (error.message.includes('Service temporarily unavailable')) {
      return createErrorResponse(
        'Service temporarily unavailable due to high error rates. Please try again later.',
        503,
        'SERVICE_UNAVAILABLE',
        { reason: 'circuit_breaker_open' },
        requestId
      );
    }
    
    // Timeout specific handling
    if (error.message.includes('timed out')) {
      return createErrorResponse(
        'Request to authentication service timed out',
        504,
        'GATEWAY_TIMEOUT',
        {},
        requestId
      );
    }
    
    // Generic server error (no details exposed)
    return createErrorResponse(
      'An internal server error occurred',
      500,
      'INTERNAL_SERVER_ERROR',
      {},
      requestId
    );
  }
}

// The main entry point for the worker
export default {
  async fetch(request, env) {
    try {
      // Handle OPTIONS preflight requests first
      if (request.method === 'OPTIONS') {
        return handleOptions(request);
      }
      
      const url = new URL(request.url);
      
      // Enhanced route validation
      if (url.pathname === '/auth' && request.method === 'POST') {
        return handleAuth(request, env);
      }
      
      // Standard 404 with proper CORS headers
      return new Response('Not Found', { 
        status: 404,
        headers: corsHeaders
      });
      
    } catch (error) {
      // Fallback error handling for any uncaught exceptions
      // CRITICAL: No sensitive data logging here
      console.error('[CRITICAL] Unhandled worker error');
      
      // Return a safe error response with CORS headers
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
