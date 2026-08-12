/**
 * API Security utilities.
 *
 * CSRF Protection: For state-changing requests (POST, PATCH, PUT, DELETE),
 * verify that the Origin header matches our host. This prevents cross-site
 * request forgery since cookies are SameSite=Strict AND we verify Origin.
 *
 * Rate Limiting: Per-IP throttle for sensitive endpoints.
 */
import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from './rate-limit';
import { getClientIp } from './request-utils';

// ===== CSRF / Origin Verification =====

const ALLOWED_METHODS_WITHOUT_ORIGIN = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Verify that state-changing requests come from the same origin.
 * Returns null if the request is safe, or an error response if rejected.
 */
export function verifyCsrf(request: NextRequest): NextResponse | null {
  const method = request.method.toUpperCase();
  if (ALLOWED_METHODS_WITHOUT_ORIGIN.includes(method)) return null;

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  // In development, allow requests without Origin (e.g., from Postman/curl)
  if (process.env.NODE_ENV !== 'production' && !origin) return null;

  // In production, Origin must be present for state-changing requests
  if (!origin) {
    return NextResponse.json({ error: 'Missing Origin header' }, { status: 403 });
  }

  // Extract the host from the Origin URL
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host;
    if (host && originHost !== host) {
      console.warn(`[CSRF] Origin mismatch: origin=${originHost}, host=${host}`);
      return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid Origin header' }, { status: 403 });
  }

  return null;
}


// ===== Rate Limiting =====

const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1 minute window
const DEFAULT_MAX_REQUESTS = 60;          // 60 requests per minute

/**
 * Check rate limit for a given IP + endpoint combination.
 * Returns null if within limits, or a 429 response if exceeded.
 */
export async function checkRateLimit(
  request: NextRequest,
  endpointKey: string,
  maxRequests: number = DEFAULT_MAX_REQUESTS,
): Promise<NextResponse | null> {
  const verdict = await rateLimit({
    key: `api:${endpointKey}:${getClientIp(request)}`,
    limit: maxRequests,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  if (!verdict.allowed) {
    const retryAfter = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));
    const response = NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
    response.headers.set('Retry-After', String(retryAfter));
    return response;
  }

  return null;
}

/**
 * Validate that a JSON body doesn't exceed size limits.
 * Prevents resource exhaustion from oversized payloads.
 */
export function checkContentLength(request: NextRequest, maxBytes: number = 1024 * 1024): NextResponse | null {
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return NextResponse.json(
      { error: `Request body too large (max ${maxBytes} bytes)` },
      { status: 413 }
    );
  }
  return null;
}
