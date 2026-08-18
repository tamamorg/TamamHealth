/**
 * Tests for the `withAuditLog` route-handler decorator.
 *
 * Covers the contract documented in `lib/audit/with-audit.ts`:
 *   - Wrapper calls `logAudit` exactly once per request.
 *   - `success: false` is recorded for non-2xx responses.
 *   - Authenticated user's `sub` and `username` flow through.
 *   - Unauthenticated request still gets a log row with `username='anonymous'`.
 *   - A `logAudit` failure does NOT surface to the caller — the response
 *     is returned unchanged.
 *   - A throw from the inner handler still emits a log row with
 *     `success=false`, then propagates.
 *   - GET / HEAD / OPTIONS bypass the wrapper (no audit row written).
 *   - Resource extractor errors don't break the request.
 *   - Impersonated super-admin sessions (actualRole) are recorded so
 *     impersonated actions stay a filterable class in the audit trail.
 */

jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    _headers: Map<string, string>;
    constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this._body = body;
      this.status = init?.status ?? 200;
      this._headers = new Map(Object.entries(init?.headers || {}));
    }
    async json() { return this._body; }
    get headers() {
      return {
        get: (k: string) => this._headers.get(k) ?? null,
        set: (k: string, v: string) => this._headers.set(k, v),
      };
    }
    static json(data: unknown, init?: { status?: number }) {
      return new MockNextResponse(data, init);
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

jest.mock('@/lib/services/audit-service', () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  logDataAccess: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/api-auth', () => ({
  getAuthPayload: jest.fn(),
}));

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { withAuditLog } from '@/lib/audit/with-audit';
import { logAudit } from '@/lib/services/audit-service';
import { getAuthPayload } from '@/lib/api-auth';

const mockedLogAudit = logAudit as jest.MockedFunction<typeof logAudit>;
const mockedGetAuthPayload = getAuthPayload as jest.MockedFunction<typeof getAuthPayload>;

// Build a minimal NextRequest stand-in. The wrapper only reads `.method`,
// `.url`, `.cookies`, and `.headers`, all of which `getAuthPayload` is
// mocked away from anyway.
function mockReq(method: string, path = '/api/patients'): NextRequest {
  return {
    method,
    url: `http://localhost${path}`,
    headers: new Map() as unknown as Headers,
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

/** Wait one macrotask so the wrapper's fire-and-forget logAudit call settles. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockedLogAudit.mockReset();
  mockedLogAudit.mockResolvedValue(undefined);
  mockedGetAuthPayload.mockReset();
  mockedGetAuthPayload.mockResolvedValue(null);
});

describe('withAuditLog', () => {
  test('emits exactly one audit row on a successful POST', async () => {
    mockedGetAuthPayload.mockResolvedValueOnce({
      sub: 'user-1', username: 'dr.kuol', role: 'doctor', name: 'Kuol',
    } as unknown as Awaited<ReturnType<typeof getAuthPayload>>);

    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 201 }));
    const wrapped = withAuditLog(handler, { action: 'patient.create' });

    const res = await wrapped(mockReq('POST'));
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
    const [action, userId, username, details, success] = mockedLogAudit.mock.calls[0];
    expect(action).toBe('patient.create');
    expect(userId).toBe('user-1');
    expect(username).toBe('dr.kuol');
    expect(success).toBe(true);
    const parsed = JSON.parse(details);
    expect(parsed.method).toBe('POST');
    expect(parsed.path).toBe('/api/patients');
    expect(parsed.status).toBe(201);
    expect(typeof parsed.durationMs).toBe('number');
  });

  test('records success=false for non-2xx responses', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ error: 'bad' }, { status: 400 }));
    const wrapped = withAuditLog(handler, { action: 'patient.update' });

    await wrapped(mockReq('PATCH'));
    await flush();

    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
    expect(mockedLogAudit.mock.calls[0][4]).toBe(false);
    expect(JSON.parse(mockedLogAudit.mock.calls[0][3]).status).toBe(400);
  });

  test('logs anonymous when getAuthPayload returns null', async () => {
    mockedGetAuthPayload.mockResolvedValueOnce(null);
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ error: 'unauth' }, { status: 401 }));
    const wrapped = withAuditLog(handler, { action: 'patient.create' });

    await wrapped(mockReq('POST'));
    await flush();

    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
    const [, userId, username, , success] = mockedLogAudit.mock.calls[0];
    expect(userId).toBeUndefined();
    expect(username).toBe('anonymous');
    expect(success).toBe(false);
  });

  test('logAudit failure does not surface to the caller', async () => {
    mockedLogAudit.mockImplementationOnce(() => Promise.reject(new Error('couchdb down')));
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withAuditLog(handler, { action: 'patient.create' });

    const res = await wrapped(mockReq('POST'));
    await flush();

    expect(res.status).toBe(200);
    // logAudit was still attempted.
    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
  });

  test('logAudit throwing synchronously does not surface', async () => {
    mockedLogAudit.mockImplementationOnce(() => { throw new Error('module init bug'); });
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withAuditLog(handler, { action: 'patient.create' });

    const res = await wrapped(mockReq('POST'));
    await flush();
    expect(res.status).toBe(200);
  });

  test('handler exceptions still log with success=false and rethrow', async () => {
    const boom = new Error('handler exploded');
    const handler = jest.fn().mockRejectedValue(boom);
    const wrapped = withAuditLog(handler, { action: 'patient.create' });

    await expect(wrapped(mockReq('POST'))).rejects.toBe(boom);
    await flush();

    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
    const [, , , details, success] = mockedLogAudit.mock.calls[0];
    expect(success).toBe(false);
    const parsed = JSON.parse(details);
    expect(parsed.status).toBe(500);
    expect(parsed.error).toBe('Error');
  });

  test('GET requests bypass the wrapper entirely', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuditLog(handler, { action: 'patient.list' });

    await wrapped(mockReq('GET'));
    await flush();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mockedLogAudit).not.toHaveBeenCalled();
  });

  test('HEAD and OPTIONS bypass too', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({}));
    const wrapped = withAuditLog(handler, { action: 'patient.list' });
    await wrapped(mockReq('HEAD'));
    await wrapped(mockReq('OPTIONS'));
    await flush();
    expect(mockedLogAudit).not.toHaveBeenCalled();
  });

  test('resourceId extractor result is included in details', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuditLog(handler, {
      action: 'patient.update',
      resourceId: (_req, ctx) => ctx?.params?.id,
    });
    await wrapped(mockReq('PATCH', '/api/patients/p-123'), { params: { id: 'p-123' } });
    await flush();
    const details = JSON.parse(mockedLogAudit.mock.calls[0][3]);
    expect(details.resourceId).toBe('p-123');
  });

  test('resourceId extractor that throws does not break the request', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuditLog(handler, {
      action: 'patient.update',
      resourceId: () => { throw new Error('boom'); },
    });
    const res = await wrapped(mockReq('PATCH'));
    await flush();
    expect(res.status).toBe(200);
    const details = JSON.parse(mockedLogAudit.mock.calls[0][3]);
    expect(details.resourceId).toBeUndefined();
  });

  test('default category derives from method', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const post = withAuditLog(handler, { action: 'a' });
    const put = withAuditLog(handler, { action: 'b' });
    const patch = withAuditLog(handler, { action: 'c' });
    const del = withAuditLog(handler, { action: 'd' });
    await post(mockReq('POST'));
    await put(mockReq('PUT'));
    await patch(mockReq('PATCH'));
    await del(mockReq('DELETE'));
    await flush();
    const cats = mockedLogAudit.mock.calls.map((c) => JSON.parse(c[3]).category);
    expect(cats).toEqual(['CREATE', 'UPDATE', 'UPDATE', 'DELETE']);
  });

  test('explicit category overrides the method-derived default', async () => {
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuditLog(handler, { action: 'reports.export', category: 'EXPORT' });
    await wrapped(mockReq('POST'));
    await flush();
    expect(JSON.parse(mockedLogAudit.mock.calls[0][3]).category).toBe('EXPORT');
  });

  test('getAuthPayload throwing does not break the request', async () => {
    mockedGetAuthPayload.mockRejectedValueOnce(new Error('jwt parse failed'));
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = withAuditLog(handler, { action: 'patient.create' });
    const res = await wrapped(mockReq('POST'));
    await flush();
    expect(res.status).toBe(200);
    expect(mockedLogAudit).toHaveBeenCalledTimes(1);
    expect(mockedLogAudit.mock.calls[0][2]).toBe('anonymous');
  });

  test('an impersonated super-admin session records the real account role', async () => {
    mockedGetAuthPayload.mockResolvedValueOnce({
      sub: 'user-admin-1', username: 'superadmin', role: 'org_admin',
      actualRole: 'super_admin', name: 'Impersonating Admin',
    } as unknown as Awaited<ReturnType<typeof getAuthPayload>>);
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withAuditLog(handler, { action: 'facility.update' });

    await wrapped(mockReq('PUT'));
    await flush();

    const details = JSON.parse(mockedLogAudit.mock.calls[0][3]);
    expect(details.actualRole).toBe('super_admin');
  });

  test('an ordinary (non-impersonated) session carries no actualRole field', async () => {
    mockedGetAuthPayload.mockResolvedValueOnce({
      sub: 'user-2', username: 'nurse.jane', role: 'nurse', name: 'Jane',
    } as unknown as Awaited<ReturnType<typeof getAuthPayload>>);
    const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
    const wrapped = withAuditLog(handler, { action: 'patient.update' });

    await wrapped(mockReq('PUT'));
    await flush();

    const details = JSON.parse(mockedLogAudit.mock.calls[0][3]);
    expect(details.actualRole).toBeUndefined();
  });
});
