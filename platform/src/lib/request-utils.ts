import type { NextRequest } from 'next/server';

/**
 * Client IP extraction for API routes, used as a rate-limit / lockout key.
 *
 * SECURITY: the client fully controls the value it puts in `X-Forwarded-For`,
 * and a trusted edge proxy APPENDS to it — so the LEFTMOST entry is
 * attacker-supplied and must never be trusted. An attacker rotating a fake
 * leftmost XFF on each request would otherwise sail past the per-IP login
 * lockout. We therefore:
 *   1. prefer `x-real-ip`, which the edge proxy (Vercel / DO App Platform)
 *      sets to the true client and overwrites on every request, and
 *   2. fall back to the RIGHTMOST `X-Forwarded-For` entry — the one appended
 *      by the closest trusted proxy — never the leftmost.
 *
 * Runtime note: `request.ip` is not available in every Next.js runtime
 * (Edge vs. Node.js), which is why we rely on headers.
 */
export function getClientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return 'unknown';
}
