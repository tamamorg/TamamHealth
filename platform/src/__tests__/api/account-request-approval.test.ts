/** @jest-environment node
 *
 * Approving an account request.
 *
 * Two things this route did not do, both of which mattered:
 *
 *   1. It never sent the invitation. It called `createUser` directly and handed
 *      the approver a temporary password to relay by phone — to someone who had
 *      typed their email address into the form FOR THIS PURPOSE.
 *   2. It recorded no identity check. Every field on the request is
 *      self-asserted, the approver is the only verification in the flow, and an
 *      approval that was checked looked identical to one that was waved through.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: unknown) => handler,
}));

const actor = {
  sub: 'user-org.admin', username: 'org.admin', name: 'Org Admin',
  role: 'org_admin', orgId: 'org-a',
};
jest.mock('@/lib/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn(() => true),
  serverError: jest.fn(() => Response.json({ error: 'server' }, { status: 500 })),
  logApiError: jest.fn(),
}));

const requestDoc: Record<string, unknown> = {
  _id: 'acctreq-1', type: 'account_request', status: 'pending',
  fullName: 'Mary Nyaboth', email: 'mary@example.org', requestedRole: 'nurse',
  orgId: 'org-a', hospitalId: 'hosp-a', hospitalName: 'Juba Teaching Hospital',
  emailVerifiedAt: '2026-08-20T10:00:00.000Z',
  approverTier: 'org_admin',
};
const decisions: Record<string, unknown>[] = [];

jest.mock('@/lib/services/account-request-service', () => {
  const roles = jest.requireActual('@/lib/account-request-roles');
  return {
    getAccountRequest: jest.fn(async () => requestDoc),
    canDecide: jest.fn(() => true),
    recordDecision: jest.fn(async (id: string, decision: string, who: unknown, extra: unknown) => {
      decisions.push({ id, decision, who, extra });
      return { ...requestDoc, status: decision };
    }),
    suggestUsername: jest.fn(() => 'mary.nyaboth'),
    PLATFORM_APPROVAL_ROLES: roles.PLATFORM_APPROVAL_ROLES,
  };
});
jest.mock('@/lib/services/data-scope', () => ({
  buildScopeFromAuth: jest.fn(() => ({ role: 'org_admin', orgId: 'org-a' })),
}));
jest.mock('@/lib/services/organization-service', () => ({
  getOrganizationById: jest.fn(async () => ({ _id: 'org-a', name: 'Org A', isActive: true })),
}));
jest.mock('@/lib/services/hospital-service', () => ({
  getHospitalById: jest.fn(async () => ({ _id: 'hosp-a', name: 'Juba Teaching Hospital', orgId: 'org-a' })),
}));
jest.mock('@/lib/services/user-service', () => ({
  createUser: jest.fn(async (input: Record<string, unknown>) => ({
    _id: `user-${input.username}`, ...input,
  })),
  getAllUsers: jest.fn(async () => []),
}));
jest.mock('@/lib/services/invite-delivery', () => ({
  deliverAccountInvite: jest.fn(async () => ({
    sent: true, to: 'mary@example.org', expiresAt: '2026-08-25T00:00:00.000Z',
  })),
}));
jest.mock('@/lib/password-policy-server', () => ({ getMinPasswordLength: jest.fn(async () => 12) }));

import { POST } from '@/app/api/account-requests/[id]/route';
import { deliverAccountInvite } from '@/lib/services/invite-delivery';
import { createUser } from '@/lib/services/user-service';

const params = Promise.resolve({ id: 'acctreq-1' });
const post = (body: Record<string, unknown>) => POST(
  new NextRequest('https://app.example.org/api/account-requests/acctreq-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }),
  { params },
);

beforeEach(() => {
  jest.clearAllMocks();
  decisions.length = 0;
  requestDoc.status = 'pending';
});

describe('the identity check', () => {
  it('refuses to approve without one', async () => {
    const response = await post({ action: 'approve' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/how you confirmed/i);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('refuses a value that is not one of the offered methods', async () => {
    // Validated against the list rather than accepted as free text, so the
    // audit trail can be counted rather than read.
    const response = await post({ action: 'approve', identityAttestation: 'I just felt like it' });
    expect(response.status).toBe(400);
  });

  it('records it with the decision', async () => {
    await post({ action: 'approve', identityAttestation: 'register_checked' });
    expect(decisions[0]).toMatchObject({
      decision: 'approved',
      extra: expect.objectContaining({ identityAttestation: 'register_checked' }),
    });
  });

  it('is not demanded to say no', async () => {
    // Refusing access needs no proof of identity, and demanding one would only
    // stop approvers clearing junk out of the queue.
    const response = await post({ action: 'reject', decisionNote: 'Not our staff' });
    expect(response.status).toBe(200);
    expect(decisions[0]).toMatchObject({ decision: 'rejected' });
  });
});

describe('what the approved person receives', () => {
  it('sends the invitation, exactly as an admin-created account gets one', async () => {
    const response = await post({ action: 'approve', identityAttestation: 'known_personally' });
    expect(response.status).toBe(200);
    expect(deliverAccountInvite).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'mary.nyaboth', email: 'mary@example.org' }),
    );
    expect((await response.json()).invitation).toMatchObject({ sent: true });
  });

  it('still returns the temporary password as a fallback', async () => {
    // The approver needs something to hand over when the mail never arrives,
    // and `invitation` tells them honestly which situation they are in.
    const body = await (await post({ action: 'approve', identityAttestation: 'in_person' })).json();
    expect(body.temporaryPassword).toEqual(expect.any(String));
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(body.mustChangePassword).toBe(true);
  });

  it('only closes the request once the account exists', async () => {
    (createUser as jest.Mock).mockRejectedValueOnce(new Error('Username "mary.nyaboth" already exists'));
    const response = await post({ action: 'approve', identityAttestation: 'in_person' });
    expect(response.status).toBe(400);
    expect(decisions).toHaveLength(0);
  });
});
