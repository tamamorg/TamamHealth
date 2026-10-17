/**
 * Sync — proof of delivery behind the "clean" mark the security wipe trusts.
 *
 * A device may only drop a local database when its writes are provably on the
 * server. SyncService.isCleanForWipe() is that proof; these tests drive the
 * push listeners the way PouchDB does.
 */
import { EventEmitter } from 'events';

class FakeRep extends EventEmitter {
  cancel = jest.fn();
}
const reps: FakeRep[] = [];

jest.mock('pouchdb-browser', () => {
  const ctor = jest.fn(() => ({}));
  return { __esModule: true, default: ctor };
});
jest.mock('@/lib/sync/offline-metadata', () => ({
  healStaleOfflineMetadata: jest.fn().mockResolvedValue(undefined),
  markDocsConflicted: jest.fn().mockResolvedValue(undefined),
  markDocsSynced: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/api-fetch', () => ({ apiFetch: jest.fn() }));

import { SyncService } from '@/lib/sync/sync-service';

function makeService(direction: 'push' | 'both' = 'both') {
  reps.length = 0;
  const localDB = {
    name: 'tamamhealth_patients',
    replicate: {
      to: jest.fn(() => { const r = new FakeRep(); reps.push(r); return r; }),
      from: jest.fn(() => new FakeRep()),
    },
  };
  const svc = new SyncService({
    localDB: localDB as never,
    remoteUrl: 'http://x/db',
    direction,
    orgId: 'org-a',
    writableRole: 'doctor',
    pullMode: 'poll',
    pullIntervalMs: 600000,
  });
  svc.startSync();
  return { svc, push: reps[0] };
}

afterEach(() => jest.clearAllTimers());

describe('SyncService.isCleanForWipe', () => {
  it('is not clean before the push has ever gone idle', () => {
    const { svc } = makeService();
    expect(svc.isCleanForWipe()).toBe(false);
    svc.destroy();
  });

  it('is clean once push pauses with no error', () => {
    const { svc, push } = makeService();
    push.emit('paused');
    expect(svc.isCleanForWipe()).toBe(true);
    svc.destroy();
  });

  it('paused WITH an error (offline) is not clean and keeps the error', () => {
    const { svc, push } = makeService();
    push.emit('paused', new Error('offline'));
    expect(svc.isCleanForWipe()).toBe(false);
    expect(svc.status.error).toBe('offline');
    svc.destroy();
  });

  it('new local activity un-cleans it until the next idle', () => {
    const { svc, push } = makeService();
    push.emit('paused');
    push.emit('active');
    expect(svc.isCleanForWipe()).toBe(false);
    push.emit('paused');
    expect(svc.isCleanForWipe()).toBe(true);
    svc.destroy();
  });

  it('a denied document is not overwritten by the next paused', () => {
    const { svc, push } = makeService();
    push.emit('denied', new Error('forbidden'));
    push.emit('paused');
    expect(svc.isCleanForWipe()).toBe(false);
    expect(svc.status.state).toBe('denied');
    svc.destroy();
  });

  it('a replication error is not clean', () => {
    const { svc, push } = makeService();
    push.emit('paused');
    push.emit('error', new Error('boom'));
    expect(svc.isCleanForWipe()).toBe(false);
    svc.destroy();
  });

  it('a stopped service is never clean', () => {
    const { svc, push } = makeService();
    push.emit('paused');
    svc.stopSync();
    expect(svc.isCleanForWipe()).toBe(false);
  });
});
