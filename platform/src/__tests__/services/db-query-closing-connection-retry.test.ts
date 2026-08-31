/**
 * `findByType` must survive the IndexedDB "connection is closing" race.
 *
 * The cached PouchDB instance a caller was handed can be destroyed out from
 * under it by a concurrent background wipe (logout / session-expiry / device
 * handover — `lib/security/local-wipe.ts`) — most visibly when a fast
 * re-login on the same device (lock screen -> "Switch User" -> sign back in)
 * lands the new session's first data-hook loads in the same tick as the old
 * session's cleanup. Before this retry, that produced an uncaught
 * `InvalidStateError` that data hooks (usePatients, useTriage,
 * useAppointments, ...) swallowed into a silently EMPTY result — a patient
 * list or triage queue with real records reading as zero, which for a
 * clinical EHR is a trust problem, not a cosmetic one.
 */

jest.mock('@/lib/db', () => ({
  getDB: jest.fn(),
  isClosingConnectionError: (err: unknown) =>
    err instanceof Error && err.name === 'InvalidStateError' && /connection is closing/i.test(err.message),
}));

import { findByType } from '@/lib/services/db-query';
import { getDB } from '@/lib/db';

function closingError(): Error {
  const err = new Error(
    "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
  );
  err.name = 'InvalidStateError';
  return err;
}

function fakeDb(name: string | undefined, find: jest.Mock) {
  return { name, createIndex: jest.fn(async () => {}), find };
}

describe('findByType survives a closing-connection race', () => {
  beforeEach(() => {
    (getDB as jest.Mock).mockReset();
  });

  it('retries once against a freshly-fetched instance and returns the real data', async () => {
    const stale = fakeDb('tamamhealth_patients', jest.fn(async () => { throw closingError(); }));
    const fresh = fakeDb('tamamhealth_patients', jest.fn(async () => ({ docs: [{ _id: 'pat-1' }] })));
    (getDB as jest.Mock).mockReturnValue(fresh);

    const result = await findByType(stale, 'patient');

    expect(result).toEqual([{ _id: 'pat-1' }]);
    expect(getDB).toHaveBeenCalledWith('tamamhealth_patients');
    expect(fresh.find).toHaveBeenCalledTimes(1);
    // The stale instance is never touched again after it throws.
    expect(stale.find).toHaveBeenCalledTimes(1);
  });

  it('does not mask an unrelated error with a retry', async () => {
    const db = fakeDb('tamamhealth_triage', jest.fn(async () => { throw new Error('network down'); }));

    await expect(findByType(db, 'triage')).rejects.toThrow('network down');
    expect(getDB).not.toHaveBeenCalled();
  });

  it('gives up rather than retry when the database has no name to re-fetch by', async () => {
    const db = fakeDb(undefined, jest.fn(async () => { throw closingError(); }));

    await expect(findByType(db, 'appointment')).rejects.toThrow(/connection is closing/);
    expect(getDB).not.toHaveBeenCalled();
  });
});
