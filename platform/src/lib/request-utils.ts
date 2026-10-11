import type { NextRequest } from 'next/server';

/**
 * Client IP extraction for API routes, used as a rate-limit / lockout key.
 *
 * SECURITY: a client controls any header it sends, so which header is believed
 * depends on what the proxy in front of the app overwrites:
 *   - `X-Forwarded-For` is APPENDED to by each proxy, so the entry written by
 *     the closest trusted proxy is the client address. That is the rightmost
 *     entry for one proxy (Caddy, Vercel), or `TRUSTED_PROXY_HOPS` from the
 *     right when a load balancer sits in front of it. The LEFTMOST entry is
 *     attacker-supplied and is never used.
 *   - `x-real-ip` is used only when there is no `X-Forwarded-For`. It was
 *     preferred once, but the host-level Caddy this deploys behind does not
 *     set it, so a client-sent value passed straight through and reset the
 *     per-IP login lockout on every request.
 *
 * TRUST: the app is published on loopback only (docker-compose binds 127.0.0.1)
 * and reached through a reverse proxy, so forwarded headers are believed by
 * default. `TRUST_PROXY_HEADERS=false` declares there is NO proxy; every
 * caller then shares one bucket, which is strict rather than spoofable. It is
 * not the default because an unset variable would silently turn the per-IP
 * login limit into a limit for the whole facility.
 *
 * Runtime note: `request.ip` is not available in every Next.js runtime
 * (Edge vs. Node.js), which is why we rely on headers.
 */
function trustProxyHeaders(): boolean {
  const v = (process.env.TRUST_PROXY_HEADERS || '').trim().toLowerCase();
  return !(v === 'false' || v === '0');
}

/** How many trusted proxies append to X-Forwarded-For. Default 1. */
function trustedProxyHops(): number {
  const n = Number.parseInt(process.env.TRUSTED_PROXY_HOPS || '', 10);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1;
}

export function getClientIp(request: NextRequest): string {
  if (!trustProxyHeaders()) return 'unknown';

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    // Fewer entries than declared hops means the chain is not what the
    // operator described; take the outermost entry a proxy could have written.
    if (parts.length) return parts[Math.max(0, parts.length - trustedProxyHops())];
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();
  return 'unknown';
}
