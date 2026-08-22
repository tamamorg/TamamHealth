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
jest.mock('@/lib/services/organization-service', () => ({
  getAllOrganizations: jest.fn(),
  createOrganization: jest.fn(async (input: Record<string, unknown>) => ({
    _id: `org-${input.slug}`, type: 'organization', ...input,
  })),
}));

import { POST } from '@/app/api/organizations/route';
import { createOrganization, getAllOrganizations } from '@/lib/services/organization-service';

const mockGetAllOrganizations = getAllOrganizations as jest.MockedFunction<typeof getAllOrganizations>;
const mockCreateOrganization = createOrganization as jest.MockedFunction<typeof createOrganization>;
const originalSingleOrgMode = process.env.SINGLE_ORG_MODE;

function request() {
  return new NextRequest('https://app.example.org/api/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Tamam Health', slug: 'tamam', contactEmail: 'admin@tamamhealth.org', country: 'South Sudan',
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SINGLE_ORG_MODE = 'true';
});

afterAll(() => {
  if (originalSingleOrgMode === undefined) delete process.env.SINGLE_ORG_MODE;
  else process.env.SINGLE_ORG_MODE = originalSingleOrgMode;
});

it('allows the first organization to bootstrap a single-org deployment', async () => {
  mockGetAllOrganizations.mockResolvedValueOnce([]);
  const response = await POST(request());

  expect(response.status).toBe(201);
  expect(mockCreateOrganization).toHaveBeenCalledTimes(1);
});

it('rejects a second organization in single-org mode', async () => {
  mockGetAllOrganizations.mockResolvedValueOnce([{ _id: 'org-existing' }] as never);
  const response = await POST(request());

  expect(response.status).toBe(409);
  expect(mockCreateOrganization).not.toHaveBeenCalled();
});
