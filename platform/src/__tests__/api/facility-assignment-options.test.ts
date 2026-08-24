/** @jest-environment node */

import { NextRequest } from 'next/server';

const mockGetAuthPayload = jest.fn();
const mockGetAllHospitals = jest.fn();

jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: (...args: unknown[]) => mockGetAuthPayload(...args),
  unauthorized: () => Response.json({ error: 'unauthorized' }, { status: 401 }),
  forbidden: () => Response.json({ error: 'forbidden' }, { status: 403 }),
  hasRole: (auth: { role: string }, roles: string[]) => roles.includes(auth.role),
  serverError: () => Response.json({ error: 'server' }, { status: 500 }),
  logApiError: jest.fn(),
}));

jest.mock('@/lib/services/hospital-service', () => ({
  getAllHospitals: (...args: unknown[]) => mockGetAllHospitals(...args),
  isFacilityActive: (facility: { isActive?: boolean }) => facility.isActive !== false,
}));

import { GET } from '@/app/api/hospitals/assignment-options/route';

const facility = (id: string, orgId: string, isActive?: boolean) => ({
  _id: id, type: 'hospital', name: id, orgId, isActive,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAllHospitals.mockResolvedValue([
    facility('central-a', 'org-a'),
    facility('retired-a', 'org-a', false),
    facility('central-b', 'org-b'),
  ]);
});

it('offers only active, centrally resolved facilities in the requested organization', async () => {
  mockGetAuthPayload.mockResolvedValue({ sub: 'admin', username: 'admin', role: 'super_admin' });
  const response = await GET(new NextRequest('https://app.example/api/hospitals/assignment-options?orgId=org-a'));
  expect(response.status).toBe(200);
  expect((await response.json()).facilities.map((item: { _id: string }) => item._id)).toEqual(['central-a']);
});

it('ignores another organization requested by a tenant administrator', async () => {
  mockGetAuthPayload.mockResolvedValue({ sub: 'org-admin', username: 'oa', role: 'org_admin', orgId: 'org-a' });
  const response = await GET(new NextRequest('https://app.example/api/hospitals/assignment-options?orgId=org-b'));
  expect(response.status).toBe(200);
  expect(mockGetAllHospitals).toHaveBeenCalledWith({ role: 'org_admin', orgId: 'org-a' });
  expect((await response.json()).facilities.map((item: { _id: string }) => item._id)).toEqual(['central-a']);
});
