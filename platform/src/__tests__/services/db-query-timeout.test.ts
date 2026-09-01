/**
 * `findByType` must never hang forever on a wedged local database.
 *
 * On a device still completing its initial sync, a PouchDB operation on the
 * patients database can stop responding under IndexedDB contention. The failure
 * observed in QA: `createIndex()` behind the duplicate scan stopped settling,
 * and because `ensureIndex` only caches the index name AFTER `createIndex`
 * resolves, every later `getAllPatients()` re-issued the same stuck build and
 * hung with it — the patient list, the front-desk board and "Register patient"
 * all stalled together, "Saving…" forever, with no error surfaced.
 *
 * Bounding the two database operations turns an unbounded await into a defined
 * outcome: a wedged index build falls back to a full scan (this module's
 * documented contract — correct, just slower), and a wedged query rejects with
 * a typed timeout the caller can handle instead of spinning.
 */

jest.mock('@/lib/db', () => ({
  getDB: jest.fn(),
  isClosingConnectionError: (err: unknown) =>
    err instanceof Error && err.name === 'InvalidStateError' && /connection is closing/i.test(err.message),
}));

import { findByType, isLocalQueryTimeoutError, LocalQueryTimeoutError } from '@/lib/services/db-query';

/** A promise that never settles — models a wedged IndexedDB operation. */
function forever(): Promise<never> {
  return new Promise<never>(() => {});
}

describe('findByType bounds a wedged local database', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('never builds a type-only index — the wedge-prone, benefit-free case is skipped outright', async () => {
    // The patient scan (findByType(db, 'patient') with no extra selector) derives
    // ['type'], which this schema cannot narrow by. Building it is what wedged
    // registration, so it must not be attempted; find() still returns data.
    const db = {
      name: 'tamamhealth_patients',
      createIndex: jest.fn(() => forever()),
      find: jest.fn(async () => ({ docs: [{ _id: 'pat-1' }] })),
    };

    await expect(findByType(db, 'patient')).resolves.toEqual([{ _id: 'pat-1' }]);
    expect(db.createIndex).not.toHaveBeenCalled();
    expect(db.find).toHaveBeenCalledTimes(1);
  });

  it('falls back to a scan when a real (compound) index build never settles', async () => {
    // A selective query DOES want its index; if that build wedges, the timeout
    // must let find() scan rather than hang the caller forever.
    const db = {
      name: 'tamamhealth_records',
      createIndex: jest.fn(() => forever()),
      find: jest.fn(async () => ({ docs: [{ _id: 'rec-1' }] })),
    };

    const p = findByType(db, 'medical_record', { patientId: 'pat-1' });
    await jest.advanceTimersByTimeAsync(8_000);

    await expect(p).resolves.toEqual([{ _id: 'rec-1' }]);
    expect(db.find).toHaveBeenCalledTimes(1);
  });

  it('does not re-issue a compound index that already timed out on the next call', async () => {
    // The cache-after-timeout is load-bearing: without it every later call would
    // re-hang on the same stuck build. createIndex must be attempted at most once.
    const db = {
      name: 'tamamhealth_records_once',
      createIndex: jest.fn(() => forever()),
      find: jest.fn(async () => ({ docs: [] })),
    };

    const first = findByType(db, 'medical_record', { patientId: 'pat-1' });
    await jest.advanceTimersByTimeAsync(8_000);
    await first;

    const second = findByType(db, 'medical_record', { patientId: 'pat-2' });
    await second; // no timer advance needed — index is cached, straight to find()

    expect(db.createIndex).toHaveBeenCalledTimes(1);
    expect(db.find).toHaveBeenCalledTimes(2);
  });

  it('rejects with a typed timeout when the query itself never settles', async () => {
    const db = {
      name: 'tamamhealth_patients',
      createIndex: jest.fn(async () => {}),
      find: jest.fn(() => forever()),
    };

    const p = findByType(db, 'patient');
    // Surface the rejection to the microtask queue before we assert on it, so an
    // unhandled-rejection warning is never emitted between the timer and the await.
    const settled = p.then(() => 'resolved', (e) => e);
    await jest.advanceTimersByTimeAsync(20_000);

    const err = await settled;
    expect(isLocalQueryTimeoutError(err)).toBe(true);
    expect(err).toBeInstanceOf(LocalQueryTimeoutError);
    expect((err as Error).message).toMatch(/did not respond within 20s/);
  });
});
