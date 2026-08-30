/**
 * `getRecentAuditLogs` used to take no scope at all and return every row in
 * the audit_log store to any caller — the only reader was five super-admin
 * pages, but the function itself had no tenant boundary, so any future
 * caller (or a super-admin session impersonating a lesser role) would leak
 * every org's activity. This pins the fix: a `DataScope` parameter that
 * fails closed like `getAuditLogsForUser` (no scope → no rows), and defers
 * the unscoped "see everything" behaviour to `filterByScope`'s own
 * super_admin/government early return rather than re-implementing it here.
 */
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { auditLogDB } from '@/lib/db';
import { getRecentAuditLogs } from '@/lib/services/audit-service';
import type { AuditLogDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

async function seedRow(overrides: Partial<AuditLogDoc> & { _id: string }): Promise<AuditLogDoc> {
  const doc = {
    type: 'audit_log',
    action: 'patient.create',
    userId: 'user-1',
    username: 'user1',
    details: '{}',
    success: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as AuditLogDoc & { _id: string };
  return putDoc(auditLogDB(), doc);
}

afterEach(async () => {
  await teardownTestDBs();
});

describe('getRecentAuditLogs scoping', () => {
  test('with no scope, fails closed — returns nothing rather than everything', async () => {
    await seedRow({ _id: 'audit-1', orgId: ORG_A });
    const logs = await getRecentAuditLogs(50);
    expect(logs).toEqual([]);
  });

  test('super_admin sees every org, unscoped', async () => {
    await seedRow({ _id: 'audit-a', orgId: ORG_A });
    await seedRow({ _id: 'audit-b', orgId: ORG_B });
    await seedRow({ _id: 'audit-none' }); // no orgId at all (a plain logAudit row)
    const scope: DataScope = { role: 'super_admin' };
    const logs = await getRecentAuditLogs(50, scope);
    expect(logs.map(l => l._id).sort()).toEqual(['audit-a', 'audit-b', 'audit-none'].sort());
  });

  test('government sees every org, unscoped', async () => {
    await seedRow({ _id: 'audit-a', orgId: ORG_A });
    await seedRow({ _id: 'audit-b', orgId: ORG_B });
    const scope: DataScope = { role: 'government' };
    const logs = await getRecentAuditLogs(50, scope);
    expect(logs.map(l => l._id).sort()).toEqual(['audit-a', 'audit-b'].sort());
  });

  test('an org-scoped role only sees its own org\'s rows', async () => {
    await seedRow({ _id: 'audit-a', orgId: ORG_A });
    await seedRow({ _id: 'audit-b', orgId: ORG_B });
    const scope: DataScope = { role: 'org_admin', orgId: ORG_A };
    const logs = await getRecentAuditLogs(50, scope);
    expect(logs.map(l => l._id)).toEqual(['audit-a']);
  });

  test('an org-scoped role never sees a row with no orgId at all', async () => {
    // Most `logAudit`-driven rows (ordinary writes via withAuditLog) carry no
    // orgId. A non-admin scope must not be handed those just because it
    // can't be excluded by tenant — the fail-closed posture means "no
    // determinable tenant" is treated as "not visible", not "visible to all".
    await seedRow({ _id: 'audit-no-org' });
    const scope: DataScope = { role: 'org_admin', orgId: ORG_A };
    const logs = await getRecentAuditLogs(50, scope);
    expect(logs).toEqual([]);
  });

  test('a non-admin scope with no orgId of its own sees nothing', async () => {
    await seedRow({ _id: 'audit-a', orgId: ORG_A });
    const scope: DataScope = { role: 'doctor' };
    const logs = await getRecentAuditLogs(50, scope);
    expect(logs).toEqual([]);
  });

  test('respects the limit after scoping', async () => {
    for (let i = 0; i < 5; i++) {
      await seedRow({ _id: `audit-${i}`, orgId: ORG_A, createdAt: new Date(Date.now() + i).toISOString() });
    }
    const scope: DataScope = { role: 'org_admin', orgId: ORG_A };
    const logs = await getRecentAuditLogs(2, scope);
    expect(logs).toHaveLength(2);
  });
});
