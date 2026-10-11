/**
 * Monotonic per-database document counter (KAN-54 / MED-05).
 *
 * Generalised from `patient-service.nextHospitalSequence()`, which replaced a
 * `db.allDocs().total_rows` count for the same reasons that apply to invoice
 * and bill numbers:
 *
 *   1. **O(N) on every allocation.** `allDocs()` walks the whole database just
 *      to learn how many rows it holds. At 10,000 invoices that is a full scan
 *      on every single billing action.
 *
 *   2. **Numbers get reused.** This is the serious one. `total_rows` falls when
 *      a document is deleted, so the next allocation reissues an identifier
 *      that already belongs to a different record. A duplicate invoice number
 *      is a financial-integrity problem: two distinct bills that reconcile to
 *      the same reference, and a payment that could be matched to either.
 *
 * `_local/` documents are deliberate: they are NOT replicated, so each facility
 * node keeps its own sequence and two nodes can never fight over the same
 * counter revision. Identifiers are already namespaced (by facility prefix or
 * by date), so per-node counters are the correct model. The trade-off is that
 * two facilities can mint the same sequence — acceptable because the namespace
 * differs, and far better than a replicated counter whose conflicts would need
 * resolving on every write.
 */

interface CounterDoc {
  _id: string;
  _rev?: string;
  seq: number;
}

type CounterDB = {
  get: (id: string) => Promise<unknown>;
  put: (doc: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Atomically allocate the next sequence for `key` in `db`.
 *
 * `seedFrom` is called only when the counter does not yet exist, and should
 * return the highest sequence already in use. Without it a fresh counter on an
 * existing dataset (seeded or migrated) would start at 1 and collide with
 * every identifier already issued.
 *
 * Retries on PouchDB conflict — two tabs allocating at once both write the same
 * `_rev`, one loses, re-reads, and takes the next number.
 */
export async function nextSequence(
  db: CounterDB,
  key: string,
  seedFrom?: () => Promise<number>,
  maxAttempts = 12,
): Promise<number> {
  const counterId = `_local/counter_${key}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let current: CounterDoc;
    try {
      current = (await db.get(counterId)) as CounterDoc;
    } catch (err) {
      const e = err as { name?: string; status?: number } | undefined;
      if (!e || (e.name !== 'not_found' && e.status !== 404)) throw err;
      current = { _id: counterId, seq: seedFrom ? await seedFrom() : 0 };
    }

    const next: CounterDoc = { ...current, seq: current.seq + 1 };
    try {
      await db.put(next as unknown as Record<string, unknown>);
      return next.seq;
    } catch (err) {
      const e = err as { name?: string; status?: number } | undefined;
      // Another tab/worker incremented first — re-read and try again.
      if (!e || (e.name !== 'conflict' && e.status !== 409)) throw err;

      // Jittered backoff. A bare retry loop livelocks under contention: every
      // loser re-reads at the same instant, collides again, and the whole set
      // burns its attempts in lockstep. Randomising spreads the retries so one
      // wins each round. Measured need — 8 concurrent allocations exhausted a
      // fixed 5-attempt loop with no delay.
      const backoffMs = Math.min(50, 2 ** attempt) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw new Error(`Could not allocate a sequence for "${key}" after ${maxAttempts} attempts`);
}

/**
 * Per-device identifier segment, minted once and kept in a `_local/` document
 * (never replicated). `nextSequence` counters are per-device too, so the
 * sequence alone does not make an identifier unique across devices or
 * facilities: two workstations both reach "0007" on the same day. Appending
 * this code is what stops them issuing the same invoice number. Same scheme
 * as the patient hospital-number device code (4 base-36 characters).
 */
export async function getDeviceCode(db: CounterDB): Promise<string> {
  const id = '_local/invoice_device_code';
  const read = async (): Promise<string | null> => {
    try {
      const doc = (await db.get(id)) as { code?: string };
      return typeof doc.code === 'string' && doc.code.length > 0 ? doc.code : null;
    } catch {
      return null;
    }
  };
  const existing = await read();
  if (existing) return existing;

  const raw = `${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`.padEnd(8, '0');
  const code = parseInt(raw.slice(0, 8), 16).toString(36).toUpperCase().padStart(4, '0').slice(-4);
  try {
    await db.put({ _id: id, code } as Record<string, unknown>);
  } catch {
    // A concurrent tab won the race; agree on its code.
    return (await read()) ?? code;
  }
  return code;
}
