/**
 * getSyncEventStats must scope its roll-up to the caller's tenant. /api/admin/
 * sync-health called it with no scope, so an org-level admin saw a cross-tenant
 * outbox + per-facility rollup (security audit 2026-11-05).
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { syncEventsDB } from '@/lib/db';
import { getSyncEventStats } from '@/lib/services/sync-event-service';
import type { DataScope } from '@/lib/services/data-scope';

async function seed(id: string, orgId: string, syncStatus: string) {
  await putDoc(syncEventsDB(), {
    _id: id, type: 'sync_event', orgId, hospitalId: 'h-' + orgId,
    resourceType: 'prescription', resourceId: 'rx-' + id, operation: 'create',
    syncStatus, occurredAt: '2026-11-05T10:00:00.000Z',
  } as never);
}

beforeEach(async () => {
  await seed('e1', 'org-a', 'pending');
  await seed('e2', 'org-a', 'synced');
  await seed('e3', 'org-b', 'failed');
});
afterEach(async () => { await teardownTestDBs(); });

describe('getSyncEventStats scoping', () => {
  it('an org admin sees only their own org', async () => {
    const scope = { role: 'org_admin', orgId: 'org-a' } as DataScope;
    const stats = await getSyncEventStats(scope);
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(1);
    expect(stats.synced).toBe(1);
    expect(stats.failed).toBe(0); // org-b's failure is NOT visible
  });

  it('super_admin sees every org', async () => {
    const stats = await getSyncEventStats({ role: 'super_admin' } as DataScope);
    expect(stats.total).toBe(3);
    expect(stats.failed).toBe(1);
  });
});
