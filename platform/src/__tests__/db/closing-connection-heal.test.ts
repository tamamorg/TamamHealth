/**
 * getDB() survives its IndexedDB connection being closed under it.
 *
 * 2026-11-07 report: "Failed to execute 'transaction' on 'IDBDatabase': The
 * database connection is closing." A wipe (sign-out, session expiry, another
 * user signing in on the device) deletes local databases, which closes every
 * connection to them in every tab. A tab that did not run the wipe kept its
 * cached instance and every read and write on it failed until a reload.
 *
 * jsdom has no IndexedDB, so pouchdb-browser is swapped for the in-memory
 * adapter; "closed" is simulated by making the cached raw instance answer
 * with the exact InvalidStateError the browser raises.
 */
jest.mock('pouchdb-browser', () => {
  const actual = jest.requireActual('pouchdb-browser');
  const PouchDB = actual.default || actual;
  const memory = jest.requireActual('pouchdb-adapter-memory');
  PouchDB.plugin(memory.default || memory);
  return PouchDB.defaults({ adapter: 'memory' });
});

import { getDB, getRawDB } from '@/lib/db';

const NAME = 'tamamhealth_heal_probe';

function closingError(): Error {
  return Object.assign(
    new Error("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing."),
    { name: 'InvalidStateError' },
  );
}

/** Make the cached raw instance behave like one whose connection was closed. */
function closeUnderneath() {
  const dead = getRawDB(NAME) as unknown as Record<string, unknown>;
  for (const method of ['get', 'put', 'bulkDocs', 'allDocs', 'find', 'bulkGet', 'remove', 'post']) {
    dead[method] = jest.fn(() => Promise.reject(closingError()));
  }
  return dead;
}

describe('getDB heals a closed connection', () => {
  it('a read on a closed instance reopens the database and succeeds', async () => {
    const db = getDB(NAME);
    await db.put({ _id: 'doc-1', type: 'probe', value: 1 });
    const dead = closeUnderneath();

    await expect(db.get('doc-1')).resolves.toMatchObject({ _id: 'doc-1', value: 1 });
    expect(getRawDB(NAME)).not.toBe(dead);
  });

  it('a write on a closed instance lands once on the reopened database', async () => {
    const db = getDB(NAME);
    closeUnderneath();
    await db.put({ _id: 'doc-2', type: 'probe' });
    const all = await db.allDocs({ include_docs: true });
    expect(all.rows.filter(r => r.id === 'doc-2')).toHaveLength(1);
  });

  it('later handles for the same name use the healthy instance', async () => {
    const db = getDB(NAME);
    closeUnderneath();
    await db.allDocs();
    await expect(getDB(NAME).get('doc-1')).resolves.toMatchObject({ _id: 'doc-1' });
  });

  it('does not retry other failures', async () => {
    const db = getDB(NAME);
    const raw = getRawDB(NAME) as unknown as Record<string, unknown>;
    const missing = Object.assign(new Error('missing'), { status: 404, name: 'not_found' });
    raw.get = jest.fn(() => Promise.reject(missing));
    await expect(db.get('nope')).rejects.toBe(missing);
    expect(raw.get).toHaveBeenCalledTimes(1);
    expect(getRawDB(NAME)).toBe(raw);
  });

  it('keeps the handle stable, so spies and identity checks still work', () => {
    expect(getDB(NAME)).toBe(getDB(NAME));
  });
});
