import { hasUnsyncedWrite, type OfflineSyncMeta } from '@/lib/sync/offline-metadata';

const meta = (status: OfflineSyncMeta['status']): OfflineSyncMeta => ({ status });

// The per-row sync chip these helpers were written beside was removed
// 2026-09-01; the registry's "Pending sync" filter and the front-desk count
// still read the same metadata, and they must agree on what counts as
// unsynced.
describe('hasUnsyncedWrite', () => {
  it('is false for a doc with no offlineSync at all', () => {
    expect(hasUnsyncedWrite({})).toBe(false);
    expect(hasUnsyncedWrite(undefined)).toBe(false);
  });

  it('is false once a doc is synced', () => {
    expect(hasUnsyncedWrite({ offlineSync: meta('synced') })).toBe(false);
  });

  it('is true for pending, failed, and conflict', () => {
    expect(hasUnsyncedWrite({ offlineSync: meta('pending') })).toBe(true);
    expect(hasUnsyncedWrite({ offlineSync: meta('failed') })).toBe(true);
    expect(hasUnsyncedWrite({ offlineSync: meta('conflict') })).toBe(true);
  });

  it('counts the declared-but-unassigned "local" status as unsynced', () => {
    expect(hasUnsyncedWrite({ offlineSync: meta('local') })).toBe(true);
  });
});
