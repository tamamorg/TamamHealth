/**
 * @jest-environment node
 *
 * Scheduled jobs must be able to reach their endpoints — and nothing else.
 *
 * The proxy rejects state-changing API calls three ways: a missing `Origin`
 * header (in production), a missing/mismatched CSRF cookie+header pair, and a
 * missing session cookie. A cron `curl` trips all three, so before the
 * machine-caller exemption existed the reminder-dispatch and transfer-sweep
 * jobs 403/401'd on every run and the work they drive silently never happened.
 *
 * These tests pin the exemption's shape: it is keyed on the secret HEADER being
 * present on a KNOWN job path, so it cannot be claimed by an ordinary API call
 * and cannot be used to reach any other route.
 */
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test'; // 40 chars

import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { createToken } from '@/modules/identity/core/auth-token';

const SWEEP = 'https://app.example.org/api/patient-transfers/sweep';
const DISPATCH = 'https://app.example.org/api/patient-reminders/dispatch';

function post(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: 'POST', headers });
}

describe('machine-caller exemption', () => {
  it('lets a cron reach the transfer sweep with no session, Origin or CSRF token', async () => {
    const res = await proxy(post(SWEEP, { 'x-transfer-sweep-secret': 'whatever' }));
    // NextResponse.next() carries no error status — the request is handed to
    // the route, which then verifies the secret itself.
    expect(res.status).toBe(200);
  });

  it('lets a cron reach the reminder dispatch the same way', async () => {
    const res = await proxy(post(DISPATCH, { 'x-reminder-dispatch-secret': 'whatever' }));
    expect(res.status).toBe(200);
  });

  it('still blocks the job path with no secret header and no session', async () => {
    const res = await proxy(post(SWEEP, { origin: 'https://app.example.org', host: 'app.example.org' }));
    expect(res.status).toBe(401);
  });

  it("cannot be CSRF'd: a logged-in admin with no CSRF token is still refused", async () => {
    // The real attack shape — the victim HAS a valid session cookie, and the
    // attacker's cross-site request simply cannot supply the CSRF pair. The
    // machine-caller exemption must not have opened a hole here.
    const token = await createToken({
      _id: 'admin-1', username: 'admin', role: 'org_admin', name: 'Org Admin',
    });
    const req = new NextRequest(SWEEP, {
      method: 'POST',
      headers: {
        origin: 'https://app.example.org',
        host: 'app.example.org',
        cookie: `tamamhealth-token=${token}`,
      },
    });
    const res = await proxy(req);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/CSRF/i) });
  });

  it('does not let the secret header unlock any other API route', async () => {
    const res = await proxy(post('https://app.example.org/api/patients', {
      'x-transfer-sweep-secret': 'whatever',
      origin: 'https://app.example.org',
      host: 'app.example.org',
    }));
    // No session, no CSRF pair → still rejected. The exemption is path-scoped.
    expect([401, 403]).toContain(res.status);
  });

  it('does not let the WRONG job secret unlock the other job path', async () => {
    const res = await proxy(post(SWEEP, {
      'x-reminder-dispatch-secret': 'whatever',
      origin: 'https://app.example.org',
      host: 'app.example.org',
    }));
    expect([401, 403]).toContain(res.status);
  });

  it('still enforces Origin/Host agreement for ordinary API calls', async () => {
    const res = await proxy(post('https://app.example.org/api/patients', {
      origin: 'https://evil.example.com',
      host: 'app.example.org',
    }));
    expect(res.status).toBe(403);
  });

  it('rejects a CSRF header/cookie pair that disagrees, even from the right origin', async () => {
    const token = await createToken({
      _id: 'nurse-1', username: 'nurse.jane', role: 'nurse', name: 'Jane',
    });
    const req = new NextRequest('https://app.example.org/api/patients', {
      method: 'POST',
      headers: {
        origin: 'https://app.example.org',
        host: 'app.example.org',
        cookie: `tamamhealth-token=${token}; tamamhealth-csrf=cookie-value`,
        'x-csrf-token': 'a-different-header-value',
      },
    });
    const res = await proxy(req);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/CSRF/i) });
  });

  it('GET requests are never blocked by the CSRF gate, even with no token at all', async () => {
    const token = await createToken({
      _id: 'nurse-1', username: 'nurse.jane', role: 'nurse', name: 'Jane',
    });
    const req = new NextRequest('https://app.example.org/api/patients', {
      method: 'GET',
      headers: {
        origin: 'https://app.example.org',
        host: 'app.example.org',
        cookie: `tamamhealth-token=${token}`,
      },
    });
    const res = await proxy(req);
    expect(res.status).not.toBe(403);
  });
});

describe('public infrastructure API hand-off', () => {
  it('allows both health probes without a staff session', async () => {
    expect((await proxy(new NextRequest('https://app.example.org/api/health'))).status).toBe(200);
    expect((await proxy(new NextRequest('https://app.example.org/api/health/live'))).status).toBe(200);
  });

  it.each(['airtel', 'flutterwave', 'mpesa'])('lets the %s provider reach its signed webhook route', async provider => {
    const res = await proxy(post(`https://app.example.org/api/webhooks/${provider}`));
    expect(res.status).toBe(200);
  });

  it('returns JSON 401 instead of redirecting an API caller with a bad token', async () => {
    const req = new NextRequest('https://app.example.org/api/patients', {
      headers: { cookie: 'tamamhealth-token=not-a-valid-jwt' },
    });
    const res = await proxy(req);
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});
