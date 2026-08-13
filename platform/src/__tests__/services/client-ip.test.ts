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
  test('prefers x-real-ip over any client-supplied X-Forwarded-For', () => {
    expect(getClientIp(req({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('9.9.9.9');
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
