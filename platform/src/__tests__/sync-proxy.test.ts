import type { NextRequest } from 'next/server';
import { isMachineCallerRequest } from '@/proxy';

function requestForSync(method: string, headers: Record<string, string>): NextRequest {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const url = 'https://app.example.org/api/sync';
  return {
    method,
    url,
    nextUrl: new URL(url),
    headers: { get(name: string) { return normalized.get(name.toLowerCase()) || null; } },
    cookies: { get() { return undefined; } },
  } as unknown as NextRequest;
}

describe('sync machine caller proxy routing', () => {
  it('allows a signed machine request to reach the route without a staff cookie', async () => {
    const request = requestForSync('POST', {
      host: 'app.example.org',
      'x-tamamhealth-signature': 'present-but-route-still-verifies-value',
    });
    expect(isMachineCallerRequest('/api/sync', request)).toBe(true);
  });

  it('still rejects an unsigned request without a staff session', async () => {
    const request = requestForSync('GET', { host: 'app.example.org' });
    expect(isMachineCallerRequest('/api/sync', request)).toBe(false);
  });

  it('lets the backup job past the session gate when it carries a signature', () => {
    // Registered in MACHINE_CALLER_ROUTES alongside /api/sync. Without the
    // entry the proxy refuses a correctly signed report before the route runs,
    // and the Risk Center can never stop saying "No backup on record".
    expect(isMachineCallerRequest('/api/admin/backup', requestForSync('POST', {
      host: 'app.example.org',
      'x-tamamhealth-signature': 'present-but-route-still-verifies-value',
    }))).toBe(true);

    expect(isMachineCallerRequest('/api/admin/backup', requestForSync('POST', {
      host: 'app.example.org',
    }))).toBe(false);
  });
});
