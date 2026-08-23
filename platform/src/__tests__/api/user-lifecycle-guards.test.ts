/** @jest-environment node
 *
 * The guards on POST /api/users that stop an administrator locking somebody —
 * or a whole tenant — out, and the audit verb the route reports.
 *
 * `delete` has always refused to self-target. `deactivate` did not, which made
 * the gentler-sounding action the one that could not be undone: the live
 * isActive check in getAuthPayload signs you out on the next request, and if
 * you were the only administrator, the organisation goes with you.
 */

import { NextRequest } from 'next/server';

const auditActions: string[] = [];
jest.mock('@/lib/audit/with-audit', () => ({
  AUDIT_ACTION_HEADER: 'x-audit-action',
  withAuditLog: (handler: (...args: unknown[]) => Promise<Response>) => async (...args: unknown[]) => {
    const response = await handler(...args);
    auditActions.push(response.headers.get('x-audit-action') ?? 'user.create');
    return response;
  },
}));
jest.mock('@/lib/api-security', () => ({ checkRateLimit: jest.fn(async () => null) }));

const actor = {
  sub: 'user-org.admin', username: 'org.admin', name: 'Org Admin',
  role: 'org_admin', orgId: 'org-a',
};
jest.mock('@/modules/identity/core/api-auth', () => ({
  getAuthPayload: jest.fn(async () => actor),
  unauthorized: jest.fn(() => Response.json({ error: 'unauthorized' }, { status: 401 })),
  forbidden: jest.fn((error = 'forbidden') => Response.json({ error }, { status: 403 })),
  hasRole: jest.fn(() => true),
  serverError: jest.fn(() => Response.json({ error: 'server' }, { status: 500 })),
  logApiError: jest.fn(),
}));

const users: Record<string, Record<string, unknown>> = {};
let remainingAdmins = 1;

jest.mock('@/modules/identity/services/user-service', () => ({
  getUserById: jest.fn(async (id: string) => users[id] ?? null),
  createUser: jest.fn(async (input: Record<string, unknown>) => ({ _id: `user-${input.username}`, ...input })),
  deactivateUser: jest.fn(async () => undefined),
  reactivateUser: jest.fn(async () => undefined),
  deleteUser: jest.fn(async () => undefined),
  resetPassword: jest.fn(async () => undefined),
  updateUser: jest.fn(async (id: string, data: Record<string, unknown>) => ({ ...users[id], ...data })),
  countRemainingOrgAdmins: jest.fn(async () => remainingAdmins),
  getAllUsers: jest.fn(async () => Object.values(users)),
  redactUserForClient: jest.fn((user: Record<string, unknown>) => user),
}));
jest.mock('@/modules/identity/services/invite-delivery', () => ({
  deliverAccountInvite: jest.fn(async () => ({ sent: true, to: 'x@example.org', expiresAt: 'later' })),
}));
jest.mock('@/modules/identity/services/offboarding-service', () => ({
  summarizeOpenWork: jest.fn(async () => ({
    futureAppointments: 2, openEncounters: 1, examples: ['Mary Lado'], hasOpenWork: true,
  })),
}));
jest.mock('@/lib/services/organization-service', () => ({
  getOrganizationById: jest.fn(async () => ({ _id: 'org-a', name: 'Org A', isActive: true })),
}));
jest.mock('@/lib/services/tenant-control-service', () => ({
  getTenantAccess: jest.fn(async () => ({ allowed: true })),
}));

import { POST } from '@/app/api/users/route';
import { deactivateUser, deleteUser } from '@/modules/identity/services/user-service';
import { deliverAccountInvite } from '@/modules/identity/services/invite-delivery';

const post = (body: Record<string, unknown>) => new NextRequest('https://app.example.org/api/users', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  auditActions.length = 0;
  remainingAdmins = 1;
  users['user-org.admin'] = {
    _id: 'user-org.admin', username: 'org.admin', name: 'Org Admin',
    role: 'org_admin', orgId: 'org-a', isActive: true, email: 'admin@example.org',
  };
  users['user-nurse'] = {
    _id: 'user-nurse', username: 'nurse.one', name: 'Nurse One',
    role: 'nurse', orgId: 'org-a', isActive: true, email: 'nurse@example.org',
  };
  users['user-other.admin'] = {
    _id: 'user-other.admin', username: 'other.admin', name: 'Other Admin',
    role: 'org_admin', orgId: 'org-a', isActive: true,
  };
});

describe('you cannot lock yourself out', () => {
  it('refuses to deactivate your own account', async () => {
    const response = await POST(post({ action: 'deactivate', userId: 'user-org.admin' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/your own account/);
    expect(deactivateUser).not.toHaveBeenCalled();
  });

  it('still refuses to delete your own account', async () => {
    const response = await POST(post({ action: 'delete', userId: 'user-org.admin' }));
    expect(response.status).toBe(400);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('refuses to change your own role', async () => {
    const response = await POST(post({ action: 'update', userId: 'user-org.admin', role: 'nurse' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/your own role/);
  });
});

describe('you cannot orphan an organisation', () => {
  it('refuses to deactivate the last administrator', async () => {
    remainingAdmins = 0;
    const response = await POST(post({ action: 'deactivate', userId: 'user-other.admin' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/only active administrator/);
  });

  it('refuses to demote the last administrator', async () => {
    // Demotion is deactivation by another name: an org whose only admin
    // becomes a nurse has nobody who can undo it.
    remainingAdmins = 0;
    const response = await POST(post({ action: 'update', userId: 'user-other.admin', role: 'nurse' }));
    expect(response.status).toBe(409);
  });

  it('allows it while another administrator remains', async () => {
    remainingAdmins = 1;
    expect((await POST(post({ action: 'deactivate', userId: 'user-other.admin' }))).status).toBe(200);
    expect(deactivateUser).toHaveBeenCalled();
  });

  it('does not stand in the way of closing an ordinary account', async () => {
    expect((await POST(post({ action: 'deactivate', userId: 'user-nurse' }))).status).toBe(200);
  });
});

describe('offboarding', () => {
  it('reports what the leaver still had open, AFTER revoking access', async () => {
    // Access has to be revocable the moment somebody leaves, whatever is still
    // assigned to them — the point is that the administrator finds out rather
    // than the patient who turns up for the appointment.
    const response = await POST(post({ action: 'deactivate', userId: 'user-nurse' }));
    expect(deactivateUser).toHaveBeenCalled();
    expect((await response.json()).openWork).toMatchObject({ hasOpenWork: true, futureAppointments: 2 });
  });
});

describe('the audit verb', () => {
  it('names the action that actually ran, not "user.create" for everything', async () => {
    await POST(post({ action: 'deactivate', userId: 'user-nurse' }));
    await POST(post({ action: 'reactivate', userId: 'user-nurse' }));
    await POST(post({ action: 'delete', userId: 'user-nurse' }));
    await POST(post({ action: 'reset_password', userId: 'user-nurse', newPassword: 'a-long-enough-one' }));
    await POST(post({ action: 'resend_invite', userId: 'user-nurse' }));
    expect(auditActions).toEqual([
      'user.deactivate', 'user.reactivate', 'user.delete',
      'user.password_reset', 'user.invite_resend',
    ]);
  });
});

describe('resending an invitation', () => {
  it('re-issues the link rather than handing out another password', async () => {
    const response = await POST(post({ action: 'resend_invite', userId: 'user-nurse' }));
    expect(response.status).toBe(200);
    expect(deliverAccountInvite).toHaveBeenCalledWith(expect.objectContaining({ _id: 'user-nurse' }));
    expect((await response.json()).invitation).toMatchObject({ sent: true });
  });

  it('refuses for a closed account', async () => {
    users['user-nurse'].isActive = false;
    const response = await POST(post({ action: 'resend_invite', userId: 'user-nurse' }));
    expect(response.status).toBe(400);
    expect(deliverAccountInvite).not.toHaveBeenCalled();
  });
});

describe('the platform operator is not bound by the tenant guard', () => {
  // The guard's own docstring has always said a super_admin is exempt from
  // rule 2 — "that is the point of a platform operator" — but the check was
  // never written, so the one role that exists to fix a tenant's problems was
  // refused by a rule meant to protect tenants from themselves. Decommissioning
  // a tenant and removing an administrator who should not have one both
  // legitimately leave an organization with no admin; the operator can then
  // appoint one, which nobody inside that organization could do.
  const asOperator = () => {
    actor.sub = 'user-superadmin';
    actor.username = 'superadmin';
    actor.role = 'super_admin';
  };
  const asOrgAdmin = () => {
    actor.sub = 'user-org.admin';
    actor.username = 'org.admin';
    actor.role = 'org_admin';
  };
  afterEach(asOrgAdmin);

  it('deletes the last administrator of an organization', async () => {
    remainingAdmins = 0;
    asOperator();
    expect((await POST(post({ action: 'delete', userId: 'user-other.admin' }))).status).toBe(200);
    expect(deleteUser).toHaveBeenCalled();
  });

  it('deactivates the last administrator of an organization', async () => {
    remainingAdmins = 0;
    asOperator();
    expect((await POST(post({ action: 'deactivate', userId: 'user-other.admin' }))).status).toBe(200);
  });

  it('still cannot lock ITSELF out — rule 1 binds every role', async () => {
    remainingAdmins = 5;
    asOperator();
    const response = await POST(post({ action: 'delete', userId: 'user-superadmin' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/your own account/);
  });

  it('leaves the guard in place for an organization administrator', async () => {
    remainingAdmins = 0;
    const response = await POST(post({ action: 'delete', userId: 'user-other.admin' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/only active administrator/);
  });
});
