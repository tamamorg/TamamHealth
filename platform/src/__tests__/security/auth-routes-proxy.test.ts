/**
 * @jest-environment node
 *
 * L2 / L3 at the proxy: the /api/auth/* routes get the same Origin check as
 * the rest of /api and accept only JSON bodies; authenticated /api responses
 * are never cacheable.
 */
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

const HOST = 'app.example.org';
function post(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${HOST}${path}`, { method: 'POST', headers: { host: HOST, ...headers } });
}

describe('Origin check on /api/auth/*', () => {
  const AUTH_POSTS = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/accept-invite',
    '/api/auth/forgot-password',
  ];

  it.each(AUTH_POSTS)('refuses a cross-site POST to %s', async (path) => {
    const res = await proxy(post(path, { origin: 'https://evil.example.com', 'content-type': 'application/json' }));
    expect(res.status).toBe(403);
  });

  it('lets a same-origin JSON login through to the route', async () => {
    const res = await proxy(post('/api/auth/login', { origin: `https://${HOST}`, 'content-type': 'application/json' }));
    expect(res.status).toBe(200);
  });

  it('accepts a JSON content type with a charset', async () => {
    const res = await proxy(post('/api/auth/login', { origin: `https://${HOST}`, 'content-type': 'application/json; charset=utf-8' }));
    expect(res.status).toBe(200);
  });
});

describe('content type on /api/auth/* POSTs', () => {
  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])(
    'refuses %s on login with 415',
    async (contentType) => {
      const res = await proxy(post('/api/auth/login', { origin: `https://${HOST}`, 'content-type': contentType }));
      expect(res.status).toBe(415);
    },
  );

  it('refuses a login with no content type', async () => {
    const res = await proxy(post('/api/auth/login', { origin: `https://${HOST}` }));
    expect(res.status).toBe(415);
  });

  it('lets the bare logout the app sends (no body, no content type) through', async () => {
    const res = await proxy(post('/api/auth/logout', { origin: `https://${HOST}` }));
    expect(res.status).toBe(200);
  });

  it('still refuses a logout posted as text/plain', async () => {
    const res = await proxy(post('/api/auth/logout', { origin: `https://${HOST}`, 'content-type': 'text/plain' }));
    expect(res.status).toBe(415);
  });

  it('does not require a body type on GET /api/auth/me', async () => {
    const res = await proxy(new NextRequest(`https://${HOST}/api/auth/me`, { headers: { host: HOST } }));
    expect(res.status).toBe(200);
  });
});

describe('Cache-Control on /api', () => {
  it('marks an authenticated route refusal no-store, private', async () => {
    const res = await proxy(new NextRequest(`https://${HOST}/api/patients`, { headers: { host: HOST } }));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store, private');
  });

  it('marks the auth endpoints no-store, private', async () => {
    const res = await proxy(new NextRequest(`https://${HOST}/api/auth/me`, { headers: { host: HOST } }));
    expect(res.headers.get('cache-control')).toBe('no-store, private');
  });

  it.each(['/api/booking/practice/clinic', '/api/terminology/CodeSystem', '/api/fhir/metadata', '/api/health'])(
    'leaves intentionally cacheable public route %s alone',
    async (path) => {
      const res = await proxy(new NextRequest(`https://${HOST}${path}`, { headers: { host: HOST } }));
      expect(res.headers.get('cache-control')).toBeNull();
    },
  );

  it('does not add the header to page routes', async () => {
    const res = await proxy(new NextRequest(`https://${HOST}/login`, { headers: { host: HOST } }));
    expect(res.headers.get('cache-control')).toBeNull();
  });
});
