/**
 * Charges the push filter used to drop, sent once the role may write them.
 * Runs a real replication between two in-memory databases: what matters is what
 * lands on the other side, and that the checkpoint behaves on a second run.
 */
import { createDBMock, teardownTestDBs } from '../helpers/test-db';
import { SyncService } from '@/lib/sync/sync-service';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const day = 24 * 60 * 60_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * day).toISOString();
const entitlement = { orgId: 'org-a', facilityIds: ['h-1'], allFacilities: false };
const bill = (id: string, daysAgo: number) => ({
  _id: id, type: 'billing', orgId: 'org-a', facilityId: 'h-1', hospitalId: 'h-1', status: 'pending', createdAt: at(daysAgo),
});

function serviceFor(role: string, direction: 'both' | 'pull' = 'both') {
  // Any two distinct in-memory databases will do for the two ends.
  const { billingDB, ledgerDB } = createDBMock() as unknown as Record<string, () => PouchDB.Database>;
  const local = billingDB();
  const remote = ledgerDB();
  const service = new SyncService({
    localDB: local, remoteUrl: 'http://localhost:5984/unused', direction, orgId: 'org-a',
    entitlement, writableRole: role, userId: 'u-1',
  } as never);
  (service as unknown as { remoteDB: unknown }).remoteDB = remote;
  return { local, remote, service };
}

const remoteIds = async (remote: PouchDB.Database) =>
  (await remote.allDocs()).rows.map(row => row.id).sort();

afterEach(teardownTestDBs);

describe('resendRecentCharges', () => {
  it('sends charges inside the window and leaves older ones on the device', async () => {
    const { local, remote, service } = serviceFor('doctor');
    await local.bulkDocs([bill('bill-new', 2), bill('bill-edge', 29), bill('bill-old', 45)]);
    expect(await service.resendRecentCharges(NOW)).toBe(2);
    expect(await remoteIds(remote)).toEqual(['bill-edge', 'bill-new']);
  });

  it('does nothing the second time', async () => {
    const { local, service } = serviceFor('doctor');
    await local.put(bill('bill-new', 2));
    await service.resendRecentCharges(NOW);
    expect(await service.resendRecentCharges(NOW)).toBe(0);
  });

  it('keeps a bill still on the server rather than duplicating it', async () => {
    const { local, remote, service } = serviceFor('doctor');
    await local.put(bill('bill-new', 2));
    await local.replicate.to(remote);
    await service.resendRecentCharges(NOW);
    expect(await remoteIds(remote)).toEqual(['bill-new']);
  });

  it('leaves the checkpoint alone for a role that may not push bills', async () => {
    const desk = serviceFor('front_desk');
    await desk.local.put(bill('bill-new', 2));
    expect(await desk.service.resendRecentCharges(NOW)).toBe(0);
    expect(await serviceFor('doctor').service.resendRecentCharges(NOW)).toBe(1);
  });

  it('still applies the push filter: another facility stays out', async () => {
    const { local, remote, service } = serviceFor('doctor');
    await local.put({ ...bill('bill-other', 2), facilityId: 'h-9', hospitalId: 'h-9' });
    await service.resendRecentCharges(NOW);
    expect(await remoteIds(remote)).toEqual([]);
  });

  it('never offers a payment from a doctor\'s session', async () => {
    const { local, remote, service } = serviceFor('doctor');
    await local.put({
      _id: 'led-pay', type: 'ledger_entry', orgId: 'org-a', facilityId: 'h-1', hospitalId: 'h-1',
      entryType: 'payment', referenceType: 'billing', createdAt: at(1),
    });
    await service.resendRecentCharges(NOW);
    expect(await remoteIds(remote)).toEqual([]);
  });

  it('is skipped on a pull-only database', async () => {
    const { local, service } = serviceFor('doctor', 'pull');
    await local.put(bill('bill-new', 2));
    expect(await service.resendRecentCharges(NOW)).toBe(0);
  });
});
