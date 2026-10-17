/** @jest-environment node */
/**
 * A server write lands on CouchDB directly. Stamping it "pending" put a stamp
 * at rest that no device was the right one to clear, so every device showed
 * it as pending sync (or re-stamped it and collided with the others).
 */
import { withPendingOfflineSync, localDeviceId } from '@/lib/sync/offline-metadata';

it('stamps a server write synced, with no device', () => {
  const doc = withPendingOfflineSync({ _id: 'rx', type: 'prescription', offlineSync: { status: 'pending', deviceId: 'x' } } as never) as {
    offlineSync: { status: string; deviceId?: string; lastSyncedAt?: string };
  };
  expect(localDeviceId()).toBeUndefined();
  expect(doc.offlineSync.status).toBe('synced');
  expect(doc.offlineSync.deviceId).toBeUndefined();
  expect(doc.offlineSync.lastSyncedAt).toBeDefined();
});
