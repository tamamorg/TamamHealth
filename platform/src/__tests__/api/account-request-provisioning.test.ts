/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/modules/identity/core/api-auth', () => ({
  // The route is wrapped in `withAudit`, which calls `getAuthPayload(request)`
  // and chains `.catch()` on the result. A bare `jest.fn()` returns undefined,
  // so the wrapper threw before the handler ever ran. This is a public,
  // unauthenticated endpoint — no session is the correct answer, but it has to
  // be an unresolved-to-null promise rather than nothing at all.
  getAuthPayload: jest.fn(async () => null),
  unauthorized: jest.fn(),
  forbidden: jest.fn(),
  hasRole: jest.fn(),
  serverError: jest.fn(() => new Response(null, { status: 500 })),
  logApiError: jest.fn(),
}));
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn(async () => ({ allowed: true, resetAt: Date.now() + 60_000 })),
}));
jest.mock('@/lib/request-utils', () => ({ getClientIp: jest.fn(() => '127.0.0.1') }));
jest.mock('@/modules/identity/services/account-request-service', () => ({
  // Returns `{ doc, verificationToken }` since email verification was added.
  createAccountRequest: jest.fn(async () => ({
    doc: { _id: 'acctreq-1' }, verificationToken: 'tok-test',
  })),
  verifyAccountRequestEmail: jest.fn(),
  listAccountRequests: jest.fn(),
  isRequestableRole: jest.fn((role: string) => role === 'nurse'),
}));
jest.mock('@/lib/services/organization-service', () => ({
  getOrganizationById: jest.fn(),
}));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(),
}));

import { POST } from '@/app/api/account-requests/route';
import { createAccountRequest } from '@/modules/identity/services/account-request-service';
import { getOrganizationById } from '@/lib/services/organization-service';
import { getHospitalById } from '@/lib/services/hospital-service';

const mockCreate = createAccountRequest as jest.MockedFunction<typeof createAccountRequest>;
const mockGetOrg = getOrganizationById as jest.MockedFunction<typeof getOrganizationById>;
const mockGetHospital = getHospitalById as jest.MockedFunction<typeof getHospitalById>;

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/account-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOrg.mockResolvedValue({ _id: 'org-a', name: 'Organisation A', isActive: true } as never);
});

it('rejects a facility from another organisation', async () => {
  mockGetHospital.mockResolvedValue({ _id: 'hosp-b', name: 'Facility B', orgId: 'org-b' } as never);

  const response = await POST(request({
    fullName: 'Mary Deng', email: 'mary@example.org', requestedRole: 'nurse',
    orgId: 'org-a', hospitalId: 'hosp-b',
  }));

  expect(response.status).toBe(400);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('stores canonical organisation and facility names with their ids', async () => {
  mockGetHospital.mockResolvedValue({ _id: 'hosp-a', name: 'Facility A', orgId: 'org-a' } as never);

  const response = await POST(request({
    fullName: 'Mary Deng', email: 'mary@example.org', requestedRole: 'nurse',
    orgId: 'org-a', orgName: 'Forged org', hospitalId: 'hosp-a', hospitalName: 'Forged facility',
  }));

  expect(response.status).toBe(202);
  expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
    orgId: 'org-a', orgName: 'Organisation A',
    hospitalId: 'hosp-a', hospitalName: 'Facility A',
  }));
});
