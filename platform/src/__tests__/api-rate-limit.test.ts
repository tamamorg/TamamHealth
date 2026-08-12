import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/api-security';
import { _resetRateLimitForTest } from '@/lib/rate-limit';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (_body: unknown, init?: { status?: number }) => {
      const values = new Map<string, string>();
      return {
        status: init?.status ?? 200,
        headers: {
          set: (name: string, value: string) => values.set(name.toLowerCase(), value),
          get: (name: string) => values.get(name.toLowerCase()) ?? null,
        },
      };
    },
  },
}));

describe('shared API rate-limit adapter', () => {
  const requestFrom = (ip: string) => ({
    headers: { get: (name: string) => name.toLowerCase() === 'x-forwarded-for' ? ip : null },
  }) as unknown as NextRequest;

  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    _resetRateLimitForTest();
  });

  it('returns 429 after the configured per-IP endpoint allowance', async () => {
    const request = requestFrom('203.0.113.5');
    expect(await checkRateLimit(request, 'test-write', 2)).toBeNull();
    expect(await checkRateLimit(request, 'test-write', 2)).toBeNull();
    const blocked = await checkRateLimit(request, 'test-write', 2);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('keeps endpoint and IP buckets independent', async () => {
    const first = requestFrom('203.0.113.5');
    const second = requestFrom('203.0.113.6');
    expect(await checkRateLimit(first, 'endpoint-a', 1)).toBeNull();
    expect((await checkRateLimit(first, 'endpoint-a', 1))?.status).toBe(429);
    expect(await checkRateLimit(first, 'endpoint-b', 1)).toBeNull();
    expect(await checkRateLimit(second, 'endpoint-a', 1)).toBeNull();
  });
});
