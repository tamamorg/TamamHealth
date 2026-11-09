/**
 * Manager override: the approver is a different, real staff member at the
 * facility with an approver role, who proves it with their own password. The
 * password is checked by the sign-in routine and never stored or logged.
 */
const authenticateUser = jest.fn();
const logAuditSafe = jest.fn().mockResolvedValue(undefined);
jest.mock('@/modules/identity', () => ({ authenticateUser: (...a: unknown[]) => authenticateUser(...a) }));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: (...a: unknown[]) => logAuditSafe(...a) }));

import { overrideRefusal } from '@/lib/billing/manager-override-policy';
import { verifyManagerOverride } from '@/lib/services/manager-override-service';

const cashier = { sub: 'u-cashier', username: 'cashier.a', name: 'Cashier A', role: 'cashier', orgId: 'org-a', hospitalId: 'h-1' };
const manager = { _id: 'u-mgr', username: 'mgr.b', name: 'Mary Manager', role: 'hospital_manager', orgId: 'org-a', hospitalId: 'h-1' };

beforeEach(() => { authenticateUser.mockReset(); logAuditSafe.mockClear(); });

describe('overrideRefusal', () => {
  const party = (over: Record<string, unknown> = {}) => ({ id: 'u-mgr', role: 'hospital_manager', orgId: 'org-a', hospitalId: 'h-1', ...over });
  const requester = { id: 'u-cashier', role: 'cashier', orgId: 'org-a', hospitalId: 'h-1' };

  test('accepts a manager or superintendent of the same facility, and an org admin of the org', () => {
    expect(overrideRefusal(party(), requester)).toBeNull();
    expect(overrideRefusal(party({ role: 'medical_superintendent' }), requester)).toBeNull();
    expect(overrideRefusal(party({ role: 'org_admin', hospitalId: undefined }), requester)).toBeNull();
    expect(overrideRefusal(party({ hospitalId: 'h-2', facilityIds: ['h-1'] }), requester)).toBeNull();
  });

  test('refuses yourself, a cashier, another organisation and another facility', () => {
    expect(overrideRefusal(party({ id: 'u-cashier' }), requester)).toBe('self');
    expect(overrideRefusal(party({ role: 'cashier' }), requester)).toBe('role');
    expect(overrideRefusal(party({ role: 'medical_biller' }), requester)).toBe('role');
    expect(overrideRefusal(party({ orgId: 'org-b' }), requester)).toBe('org');
    expect(overrideRefusal(party({ hospitalId: 'h-2' }), requester)).toBe('facility');
  });

  test('a manager who is also the requester is still refused', () => {
    expect(overrideRefusal(party({ id: 'u-mgr' }), { ...requester, id: 'u-mgr', role: 'hospital_manager' })).toBe('self');
  });
});

describe('verifyManagerOverride', () => {
  const run = (username = 'mgr.b', password = 'Secret-pass-1') =>
    verifyManagerOverride({ username, password, purpose: 'waiver of 50 SSP', requester: cashier });

  test('a wrong password is refused and audited without the password', async () => {
    authenticateUser.mockResolvedValue(null);
    expect(await run()).toMatchObject({ ok: false, code: 'BAD_CREDENTIALS' });
    const logged = JSON.stringify(logAuditSafe.mock.calls);
    expect(logged).toContain('manager_override_failed');
    expect(logged).not.toContain('Secret-pass-1');
  });

  test('the cashier typing their own username is refused before any password check', async () => {
    expect(await run('cashier.a')).toMatchObject({ ok: false, code: 'self' });
    expect(authenticateUser).not.toHaveBeenCalled();
  });

  test('a correct password of a non-approver is refused', async () => {
    authenticateUser.mockResolvedValue({ ...manager, role: 'cashier' });
    expect(await run()).toMatchObject({ ok: false, code: 'role' });
  });

  test('a manager at the facility approves: identity, role and time are returned', async () => {
    authenticateUser.mockResolvedValue(manager);
    const result = await run();
    expect(result).toMatchObject({ ok: true, approval: { approvedBy: 'u-mgr', approvedByName: 'Mary Manager', approvedByRole: 'hospital_manager' } });
    expect(result.ok && Date.parse(result.approval.approvedAt)).toBeGreaterThan(0);
    expect(JSON.stringify(logAuditSafe.mock.calls)).toContain('manager_override_granted');
    expect(JSON.stringify(logAuditSafe.mock.calls)).not.toContain('Secret-pass-1');
  });
});
