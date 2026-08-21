/**
 * Device-side retention for the push-only trails.
 *
 * These databases are never pulled back, so without pruning a tablet that stays
 * signed in accumulates every audit entry it has ever written. The risk in
 * trimming them is the opposite one — deleting an entry that never reached the
 * server, or proposing that deletion to the server, which for an audit trail
 * would be worse than the growth.
 */
const mockGetDB = jest.fn();
const mockGetDirty = jest.fn();

jest.mock('@/lib/db', () => ({ getDB: (name: string) => mockGetDB(name) }));
jest.mock('@/lib/security/local-wipe', () => ({
  getDirtyDatabases: () => mockGetDirty(),
}));

import { pruneLocalAuditTrails, LOCAL_AUDIT_RETENTION_DAYS } from '@/lib/services/audit-retention';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function trailDB(rows: Record<string, unknown>[]) {
  return {
    allDocs: jest.fn(async () => ({ rows: rows.map(doc => ({ doc })) })),
    bulkDocs: jest.fn(async () => []),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDirty.mockResolvedValue([]);
});

describe('local audit retention', () => {
  it('removes entries older than the window', async () => {
    const db = trailDB([
      { _id: 'a1', _rev: '1-a', timestamp: daysAgo(LOCAL_AUDIT_RETENTION_DAYS + 10) },
      { _id: 'a2', _rev: '1-b', timestamp: daysAgo(1) },
    ]);
    mockGetDB.mockReturnValue(db);

    const result = await pruneLocalAuditTrails();

    expect(result.removed['tamamhealth_audit_log']).toBe(1);
    const deleted = (db.bulkDocs.mock.calls as unknown as unknown[][])[0][0] as Record<string, unknown>[];
    expect(deleted).toEqual([{ _id: 'a1', _rev: '1-a', _deleted: true }]);
  });

  it('keeps everything inside the window', async () => {
    const db = trailDB([
      { _id: 'a1', _rev: '1-a', timestamp: daysAgo(5) },
      { _id: 'a2', _rev: '1-b', timestamp: daysAgo(30) },
    ]);
    mockGetDB.mockReturnValue(db);

    await pruneLocalAuditTrails();
    expect(db.bulkDocs).not.toHaveBeenCalled();
  });

  it('never prunes a database holding unsynced entries', async () => {
    // The entry may be the only copy in existence.
    mockGetDirty.mockResolvedValue(['tamamhealth_audit_log']);
    const db = trailDB([{ _id: 'a1', _rev: '1-a', timestamp: daysAgo(999) }]);
    mockGetDB.mockReturnValue(db);

    const result = await pruneLocalAuditTrails();

    expect(result.skipped).toContain('tamamhealth_audit_log');
    expect(db.bulkDocs).not.toHaveBeenCalled();
  });

  it('prunes nothing when sync state cannot be read at all', async () => {
    mockGetDirty.mockRejectedValue(new Error('storage blocked'));
    const db = trailDB([{ _id: 'a1', _rev: '1-a', timestamp: daysAgo(999) }]);
    mockGetDB.mockReturnValue(db);

    const result = await pruneLocalAuditTrails();

    expect(result.removed).toEqual({});
    expect(db.bulkDocs).not.toHaveBeenCalled();
  });

  it('keeps an entry with no usable date rather than guessing', async () => {
    const db = trailDB([
      { _id: 'a1', _rev: '1-a' },
      { _id: 'a2', _rev: '1-b', timestamp: 12345 },
    ]);
    mockGetDB.mockReturnValue(db);

    await pruneLocalAuditTrails();
    expect(db.bulkDocs).not.toHaveBeenCalled();
  });

  it('leaves design documents alone', async () => {
    const db = trailDB([
      { _id: '_design/idx-1', _rev: '1-a', timestamp: daysAgo(999) },
      { _id: 'a1', _rev: '1-b', timestamp: daysAgo(999) },
    ]);
    mockGetDB.mockReturnValue(db);

    await pruneLocalAuditTrails();
    const deleted = (db.bulkDocs.mock.calls as unknown as unknown[][])[0][0] as { _id: string }[];
    expect(deleted.map(d => d._id)).toEqual(['a1']);
  });

  it('covers the controlled-substance register on its own date field', async () => {
    const seen: string[] = [];
    mockGetDB.mockImplementation((name: string) => {
      seen.push(name);
      return trailDB(
        name === 'tamamhealth_controlled_substance_log'
          ? [{ _id: 'c1', _rev: '1-a', createdAt: daysAgo(999) }]
          : [],
      );
    });

    const result = await pruneLocalAuditTrails();

    expect(seen).toContain('tamamhealth_controlled_substance_log');
    expect(result.removed['tamamhealth_controlled_substance_log']).toBe(1);
  });

  it('survives a database that will not open', async () => {
    mockGetDB.mockImplementation(() => { throw new Error('IndexedDB blocked'); });
    await expect(pruneLocalAuditTrails()).resolves.toEqual(
      expect.objectContaining({ removed: {} }),
    );
  });
});
