/**
 * Shared indexed-query helpers.
 *
 * Replaces the `allDocs({ include_docs: true })` + JS `.filter(d => d.type ===
 * …)` pattern (a full database scan streamed into memory) with a Mango `find()`
 * scoped by document `type`. The backing index is created once per process per
 * database. If the index can't be created (older CouchDB / view conflict),
 * PouchDB's `find()` falls back to an in-memory scan, so callers always get
 * correct results — they just lose the speed-up.
 *
 * `pouchdb-find` is registered by `loadPouchDB()` in src/lib/db.ts for both the
 * browser and server runtimes, so `createIndex`/`find` are always available.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

// db name -> set of "field1,field2" index keys already created this process.
const created = new Map<string, Set<string>>();

function dbName(db: AnyDB): string {
  return (db as { name?: string }).name || 'unknown';
}

/** Idempotently create a Mango index on the given fields (once per process/DB). */
export async function ensureIndex(db: AnyDB, fields: string[]): Promise<void> {
  const name = dbName(db);
  let set = created.get(name);
  if (!set) {
    set = new Set<string>();
    created.set(name, set);
  }
  const key = fields.join(',');
  if (set.has(key)) return;
  try {
    await db.createIndex({ index: { fields } });
  } catch {
    // Index unavailable — find() will scan. Cache so we don't retry each call.
  }
  set.add(key);
}

/**
 * Index fields for a query, derived from what it actually filters on.
 *
 * The old default was `['type']` for every call, which reads like an index and
 * behaves like none: `DATABASE_DOCUMENT_TYPES` gives each browser database
 * exactly one document type, so a `type` index has a single key covering every
 * row and Mango walks the whole database anyway — the very scan `findByType`
 * was written to replace. 178 of the 279 call sites used that default.
 *
 * `type` stays as the leading column so the index shape matches the selector
 * (and the explicit `['type', 'patientId']` fields already passed at ~20 call
 * sites). What follows are the equality keys the caller narrowed by, which is
 * where the selectivity actually is — `patientId` on a chart read, `status` on
 * a work queue.
 *
 * Operator selectors (`{$in: …}`, `{$gt: …}`) are skipped: Mango can only use
 * an index for a range on the LAST indexed field, so including them in the
 * middle of a compound index silently prevents it being used at all.
 */
function derivedIndexFields(extraSelector: Record<string, unknown>): string[] {
  const equalityKeys = Object.keys(extraSelector).filter((key) => {
    // A primitive is an equality match; an object or array is an operator
    // expression (`{$in: […]}`, `{$gt: …}`) and is not indexed here.
    const valueType = typeof extraSelector[key];
    return valueType === 'string' || valueType === 'number' || valueType === 'boolean';
  });
  return equalityKeys.length ? ['type', ...equalityKeys] : ['type'];
}

/**
 * Return all docs of a given `type` in `db`, optionally narrowed by an extra
 * selector. Uses an indexed Mango query instead of a full-DB scan.
 *
 * `limit` is a safety ceiling, not a page size — it exists so a runaway query
 * cannot stream an entire database into memory, and callers that genuinely
 * page should pass their own.
 */
export async function findByType<T>(
  db: AnyDB,
  type: string,
  extraSelector: Record<string, unknown> = {},
  options: { limit?: number; indexFields?: string[] } = {},
): Promise<T[]> {
  await ensureIndex(db, options.indexFields ?? derivedIndexFields(extraSelector));
  const res = (await db.find({
    selector: { type, ...extraSelector },
    limit: options.limit ?? 100_000,
  })) as { docs: T[] };
  return (res.docs || []) as T[];
}
