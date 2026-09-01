/**
 * `findByType` must index on what the query actually filters by.
 *
 * Each browser database holds exactly one document `type`, so an index on
 * `type` alone has a single key spanning every row — Mango cannot narrow with
 * it and scans the database, which is what `findByType` exists to avoid. That
 * was the default for 178 of 279 call sites.
 */
import { findByType, ensureIndex } from '@/lib/services/db-query';

function fakeDB(name: string) {
  const created: string[][] = [];
  return {
    name,
    created,
    createIndex: jest.fn(async ({ index }: { index: { fields: string[] } }) => {
      created.push(index.fields);
    }),
    find: jest.fn(async () => ({ docs: [] })),
  };
}

describe('findByType index derivation', () => {
  it('indexes the equality field a chart read narrows by', async () => {
    const db = fakeDB('t_records_1');
    await findByType(db, 'medical_record', { patientId: 'pat-1' });
    expect(db.created).toEqual([['type', 'patientId']]);
  });

  it('indexes several equality fields together', async () => {
    const db = fakeDB('t_appts_1');
    await findByType(db, 'appointment', { hospitalId: 'hosp-1', status: 'scheduled' });
    expect(db.created[0]).toEqual(['type', 'hospitalId', 'status']);
  });

  it('builds no index when nothing narrows the query — a type-only index is worthless here', async () => {
    // A lone `type` column spans every row (one type per database), so Mango
    // scans regardless — find() does the same scan without it, at no cost.
    // Building it is pure downside, and a createIndex on the patients database
    // was observed to wedge every write behind it during initial sync. So the
    // derivation still resolves to ['type'], but ensureIndex must NOT build it;
    // find() still runs with the correct selector.
    const db = fakeDB('t_plain_1');
    const res = await findByType(db, 'patient');
    expect(db.created).toEqual([]);
    expect(db.createIndex).not.toHaveBeenCalled();
    expect(db.find).toHaveBeenCalledWith(expect.objectContaining({ selector: { type: 'patient' } }));
    expect(res).toEqual([]);
  });

  it('leaves operator selectors out of the index', async () => {
    // Mango can only range-scan the LAST indexed field, so an operator in the
    // middle of a compound index stops it being usable at all.
    const db = fakeDB('t_ops_1');
    await findByType(db, 'lab_result', {
      patientId: 'pat-1',
      status: { $in: ['pending', 'in_progress'] },
      collectedAt: { $gt: '2026-01-01' },
    });
    expect(db.created[0]).toEqual(['type', 'patientId']);
  });

  it('still honours an explicit indexFields override', async () => {
    const db = fakeDB('t_explicit_1');
    await findByType(db, 'bed', { wardId: 'w-1' }, { indexFields: ['type', 'wardId'] });
    expect(db.created[0]).toEqual(['type', 'wardId']);
  });

  it('passes the full selector to find(), indexed or not', async () => {
    const db = fakeDB('t_selector_1');
    await findByType(db, 'lab_result', { patientId: 'p-1', status: { $in: ['pending'] } });
    expect(db.find).toHaveBeenCalledWith(expect.objectContaining({
      selector: { type: 'lab_result', patientId: 'p-1', status: { $in: ['pending'] } },
    }));
  });

  it('creates each index shape once per database', async () => {
    const db = fakeDB('t_cache_1');
    await findByType(db, 'problem', { patientId: 'pat-1' });
    await findByType(db, 'problem', { patientId: 'pat-2' });
    await findByType(db, 'problem', { patientId: 'pat-3' });
    expect(db.createIndex).toHaveBeenCalledTimes(1);
  });

  it('survives a database that cannot build indexes', async () => {
    // Older CouchDB or a view conflict: find() falls back to a scan, and the
    // caller still gets correct results.
    const db = {
      name: 't_noindex_1',
      createIndex: jest.fn(async () => { throw new Error('no index support'); }),
      find: jest.fn(async () => ({ docs: [{ _id: 'x' }] })),
    };
    await expect(findByType(db, 'problem', { patientId: 'p-1' })).resolves.toEqual([{ _id: 'x' }]);
  });

  it('does not retry a failed index on every call', async () => {
    const db = {
      name: 't_noretry_1',
      createIndex: jest.fn(async () => { throw new Error('nope'); }),
      find: jest.fn(async () => ({ docs: [] })),
    };
    await ensureIndex(db, ['type', 'patientId']);
    await ensureIndex(db, ['type', 'patientId']);
    expect(db.createIndex).toHaveBeenCalledTimes(1);
  });
});
