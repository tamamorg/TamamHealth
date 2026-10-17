export {};

/**
 * getClientIp must resist X-Forwarded-For spoofing — the leftmost XFF entry is
 * attacker-controlled, so a rotating fake there must not become the rate-limit
 * key. See the per-IP login lockout in /api/auth/login.
 */
import { getClientIp } from '@/lib/request-utils';
import type { NextRequest } from 'next/server';

function req(headers: Record<string, string>): NextRequest {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (n: string) => lower.get(n.toLowerCase()) ?? null } } as unknown as NextRequest;
}

describe('getClientIp anti-spoofing', () => {
  test('a client-sent x-real-ip cannot override what the proxy wrote', () => {
    // The host-level Caddy rewrites X-Forwarded-For but passes x-real-ip
    // through untouched, so x-real-ip is only a fallback.
    expect(getClientIp(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '8.8.8.8' }))).toBe('8.8.8.8');
    expect(getClientIp(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  test('counts back the declared number of proxies', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    try {
      // client, then the load balancer's view appended by Caddy.
      expect(getClientIp(req({ 'x-forwarded-for': '6.6.6.6, 8.8.8.8, 10.0.0.2' }))).toBe('8.8.8.8');
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  test('with no proxy declared, no header is believed', () => {
    process.env.TRUST_PROXY_HEADERS = 'false';
    try {
      expect(getClientIp(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '8.8.8.8' }))).toBe('unknown');
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });

  test('uses the rightmost (closest-proxy) XFF entry, not the spoofable leftmost', () => {
    // Client injected 6.6.6.6; the trusted edge appended the real 8.8.8.8.
    expect(getClientIp(req({ 'x-forwarded-for': '6.6.6.6, 8.8.8.8' }))).toBe('8.8.8.8');
  });

  test('a rotating fake leftmost IP does not change the derived key', () => {
    const a = getClientIp(req({ 'x-forwarded-for': 'fake-a, 8.8.8.8' }));
    const b = getClientIp(req({ 'x-forwarded-for': 'fake-b, 8.8.8.8' }));
    expect(a).toBe(b);
    expect(a).toBe('8.8.8.8');
  });

  test('falls back to a stable literal when no headers are present', () => {
    expect(getClientIp(req({}))).toBe('unknown');
  });
});
