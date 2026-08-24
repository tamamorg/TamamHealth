/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('@/lib/audit/with-audit', () => ({ withAuditLog: (handler: unknown) => handler }));
jest.mock('@/lib/api-security', () => ({ checkRateLimit: jest.fn(async () => null) }));
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => ({
    sub: 'user-superadmin', username: 'superadmin', name: 'Admin', role: 'super_admin',
  })),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn(() => true),
  serverError: jest.fn(() => Response.json({ error: 'server' }, { status: 500 })),
  logApiError: jest.fn(),
}));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(async (id: string) => ({
    _id: id,
    name: id === 'hosp-a' ? 'Canonical Hospital' : `Facility ${id}`,
    orgId: id === 'hosp-outside' ? 'org-b' : 'org-a',
  })),
}));
jest.mock('@/lib/services/organization-service', () => ({
  getOrganizationById: jest.fn(async (id: string) => id === 'org-a'
    ? { _id: 'org-a', name: 'Organization A', isActive: true }
    : null),
}));
jest.mock('@/modules/identity/services/user-service', () => ({
  createUser: jest.fn(async (input: Record<string, unknown>) => ({
    _id: `user-${input.username}`, type: 'user', ...input, passwordHash: 'redacted',
  })),
  redactUserForClient: jest.fn((user: Record<string, unknown>) => {
    const { passwordHash: _secret, ...safe } = user;
    void _secret;
    return safe;
  }),
  getUserById: jest.fn(),
}));

import { POST } from '@/app/api/users/route';
import { createUser } from '@/modules/identity/services/user-service';
import { getOrganizationById } from '@/lib/services/organization-service';

const mockCreateUser = createUser as jest.MockedFunction<typeof createUser>;
const mockGetOrganizationById = getOrganizationById as jest.MockedFunction<typeof getOrganizationById>;

function post(body: Record<string, unknown>) {
  return new NextRequest('https://app.example.org/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => jest.clearAllMocks());

it('preserves the exact temporary password while canonicalizing tenant assignment', async () => {
  const password = 'Pa<script>ss!9';
  const response = await POST(post({
    username: 'doctor.one', name: 'Doctor One', role: 'doctor', password,
    orgId: 'org-a', hospitalId: 'hosp-a', hospitalName: 'Forged Hospital',
  }));

  expect(response.status).toBe(201);
  expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({
    password,
    orgId: 'org-a',
    hospitalId: 'hosp-a',
    hospitalName: 'Canonical Hospital',
  }), 'user-superadmin', 'superadmin');
});

it('rejects an org administrator that could not delegate within any organization', async () => {
  const response = await POST(post({
    username: 'orphan.admin', name: 'Orphan Admin', role: 'org_admin', password: 'TempPass!123',
  }));

  expect(response.status).toBe(400);
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(await response.json()).toEqual(expect.objectContaining({
    error: expect.stringMatching(/assigned to an organization/i),
  }));
});

it('rejects an org administrator assigned to a missing organization', async () => {
  mockGetOrganizationById.mockResolvedValueOnce(null);
  const response = await POST(post({
    username: 'dangling.admin', name: 'Dangling Admin', role: 'org_admin',
    password: 'TempPass!123', orgId: 'org-missing',
  }));

  expect(response.status).toBe(400);
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(await response.json()).toEqual(expect.objectContaining({
    error: expect.stringMatching(/not found or is inactive/i),
  }));
});

it('rejects invisible leading or trailing spaces instead of storing a different password', async () => {
  const response = await POST(post({
    username: 'doctor.two', name: 'Doctor Two', role: 'doctor', password: ' TempPass!123 ',
    orgId: 'org-a', hospitalId: 'hosp-a',
  }));

  expect(response.status).toBe(400);
  expect(mockCreateUser).not.toHaveBeenCalled();
});

it('canonicalizes explicit multi-facility grants and removes the home-site duplicate', async () => {
  const response = await POST(post({
    username: 'doctor.cover', name: 'Doctor Cover', role: 'doctor', password: 'TempPass!123',
    orgId: 'org-a', hospitalId: 'hosp-a',
    facilityIds: ['hosp-b', 'hosp-b', 'hosp-a'],
  }));

  expect(response.status).toBe(201);
  expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({
    hospitalId: 'hosp-a',
    facilityIds: ['hosp-b'],
  }), 'user-superadmin', 'superadmin');
});

it('rejects an additional facility owned by another organization', async () => {
  const response = await POST(post({
    username: 'doctor.escape', name: 'Doctor Escape', role: 'doctor', password: 'TempPass!123',
    orgId: 'org-a', hospitalId: 'hosp-a', facilityIds: ['hosp-outside'],
  }));

  expect(response.status).toBe(400);
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(await response.json()).toEqual(expect.objectContaining({
    code: 'FACILITY_NOT_ASSIGNABLE', reason: 'wrong_organization',
  }));
});
