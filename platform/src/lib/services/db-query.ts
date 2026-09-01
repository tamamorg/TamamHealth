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

import { getDB, isClosingConnectionError } from '../db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

/**
 * A local PouchDB read that never settles wedges every caller behind it — a
 * registration's duplicate scan, a data hook loading on mount — as an infinite
 * spinner with no error (DEF-2). Observed during a device's initial sync:
 * `createIndex()` on the patients database stopped responding while replication
 * streamed documents into the same IndexedDB, and because `ensureIndex` only
 * caches the index name *after* `createIndex` resolves, every subsequent
 * `getAllPatients()` re-issued the same wedged `createIndex` and hung with it —
 * so the patient list, the front-desk board and "Register patient" all stalled
 * together with no error surfaced.
 *
 * Bounding the two database operations converts an unbounded await into a
 * defined outcome: a wedged index build falls back to a full scan (correct, per
 * this module's contract — just slower), and a wedged query rejects so the
 * caller can retry or surface an error instead of spinning forever.
 *
 * The ceilings are deliberately far above any healthy local operation — a Mango
 * index build or scan over a browser database is sub-second in steady state —
 * so a legitimately slow device is never tripped; only a genuinely stuck handle
 * is.
 */
const INDEX_BUILD_TIMEOUT_MS = 8_000;
const QUERY_TIMEOUT_MS = 20_000;

export class LocalQueryTimeoutError extends Error {
  constructor(op: string, ms: number) {
    super(`Local database operation "${op}" did not respond within ${Math.round(ms / 1000)}s`);
    this.name = 'LocalQueryTimeoutError';
  }
}

export function isLocalQueryTimeoutError(err: unknown): boolean {
  return err instanceof LocalQueryTimeoutError;
}

/**
 * Reject if `p` has not settled within `ms`. The underlying PouchDB promise
 * cannot be cancelled, so on timeout it is left pending (and ignored) rather
 * than aborted — the point is to unblock the awaiting caller, not the DB.
 */
function withTimeout<T>(p: Promise<T>, ms: number, op: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LocalQueryTimeoutError(op, ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

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
  // A lone `type` column is not a useful index in this schema and must not be
  // built. `DATABASE_DOCUMENT_TYPES` gives each browser database essentially one
  // document type (see `derivedIndexFields`), so a `type` index holds a single
  // key spanning every row and Mango scans the whole database regardless —
  // find() does the exact same scan without it, at no extra cost. Building it is
  // therefore pure downside, and a downside with teeth: during a device's
  // initial sync, `createIndex` on the patients database was observed to wedge,
  // holding a readwrite transaction that stalled every write queued behind it —
  // the `_local` hospital-number counter, then the patient document itself — so
  // "Register patient" hung on "Saving…" with nothing ever written. Skip it:
  // cache the key so it is never attempted, and let find() scan directly.
  if (fields.length === 1 && fields[0] === 'type') {
    set.add(key);
    return;
  }
  try {
    await withTimeout(
      db.createIndex({ index: { fields } }),
      INDEX_BUILD_TIMEOUT_MS,
      `createIndex ${name}`,
    );
  } catch {
    // Index unavailable, errored, or timed out (a wedged build during initial
    // sync) — find() will scan, which is correct, just slower. Caching the key
    // regardless is load-bearing: it stops every later call re-issuing the same
    // stuck createIndex and hanging behind it.
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
  const fields = options.indexFields ?? derivedIndexFields(extraSelector);
  const query = (target: AnyDB) => target.find({
    selector: { type, ...extraSelector },
    limit: options.limit ?? 100_000,
  }) as Promise<{ docs: T[] }>;

  await ensureIndex(db, fields);
  try {
    const res = await withTimeout(query(db), QUERY_TIMEOUT_MS, `find ${dbName(db)}`);
    return (res.docs || []) as T[];
  } catch (err) {
    // `db` can be a cached instance that a concurrent background wipe (logout,
    // session expiry, device handover — see lib/security/local-wipe.ts) closed
    // out from under this call, most commonly when a fast re-login on the same
    // device races the previous session's cleanup. Without this retry the
    // caller — often a data hook loading on mount right after login — got an
    // empty result indistinguishable from "no records", which for patients,
    // triage or appointments reads as data loss to clinical staff even though
    // nothing was actually lost. See isClosingConnectionError() in lib/db.ts
    // for why a fresh getDB() call here is guaranteed to return a healthy
    // instance rather than repeat the same failure.
    //
    // A timeout is deliberately NOT retried here: getDB() hands back the same
    // cached handle for a name that is not closing, so re-issuing the query
    // would just wedge on the same stuck instance. The timeout is re-thrown so
    // the caller surfaces it (e.g. registration proceeds without the optional
    // duplicate scan) instead of hanging a second time.
    const name = dbName(db);
    if (!isClosingConnectionError(err) || name === 'unknown') throw err;
    const fresh = getDB(name);
    await ensureIndex(fresh, fields);
    const res = await withTimeout(query(fresh), QUERY_TIMEOUT_MS, `find ${name} (retry)`);
    return (res.docs || []) as T[];
  }
}
