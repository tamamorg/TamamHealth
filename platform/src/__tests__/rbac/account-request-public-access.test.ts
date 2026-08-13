/**
 * @jest-environment node
 *
 * Public reachability of the request-an-account flow through the proxy.
 *
 * Runs in the node environment (not the default jsdom) because NextResponse
 * needs the real fetch primitives — Response.json, Headers — which jsdom
 * does not provide.
 *
 * The whole feature was dark for months because /signup and the two public
 * API entry points fell through to the "all other routes require
 * authentication" gate: the page redirected to /login and the API calls
 * 401'd before the route's own `?public=organizations` branch could run.
 * The CSRF exemption for /api/account-requests/submit was necessary but not
 * sufficient — it is evaluated after the auth gate. These tests pin the
 * proxy-level contract so the flow cannot silently regress to
 * authenticated-only again.
 */
import type { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

function anonRequest(path: string, method = 'GET'): NextRequest {
  const url = `https://app.example.org${path}`;
  const headers = new Map([
    ['host', 'app.example.org'],
    ['origin', 'https://app.example.org'],
  ]);
  return {
    method,
    url,
    nextUrl: new URL(url),
    headers: { get: (name: string) => headers.get(name.toLowerCase()) || null },
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

/** NextResponse.next() marks pass-through with this header. */
function passesThrough(response: Response): boolean {
  return response.headers.get('x-middleware-next') === '1';
}

describe('account-request public access through the proxy', () => {
  it('lets an anonymous visitor load the /signup page', async () => {
    const response = await proxy(anonRequest('/signup'));
    expect(passesThrough(response)).toBe(true);
  });

  it('lets the signup form load the public organization directory', async () => {
    const response = await proxy(anonRequest('/api/account-requests?public=organizations'));
    expect(passesThrough(response)).toBe(true);
  });

  it('lets an anonymous applicant POST a submission', async () => {
    const response = await proxy(anonRequest('/api/account-requests/submit', 'POST'));
    expect(passesThrough(response)).toBe(true);
  });

  it('still 401s the reviewer list without a session', async () => {
    const response = await proxy(anonRequest('/api/account-requests'));
    expect(response.status).toBe(401);
  });

  it('still 401s approve/reject on the collection route without a session', async () => {
    const response = await proxy(anonRequest('/api/account-requests', 'POST'));
    expect(response.status).toBe(401);
  });

  it('does not let the public query open a POST hole on the collection route', async () => {
    const response = await proxy(anonRequest('/api/account-requests?public=organizations', 'POST'));
    expect(response.status).toBe(401);
  });

  it('keeps unknown signup sub-paths behind the login redirect', async () => {
    const response = await proxy(anonRequest('/signup/extra'));
    expect(passesThrough(response)).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get('location')).toContain('/login');
  });
});
