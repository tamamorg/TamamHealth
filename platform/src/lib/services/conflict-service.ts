/**
 * Conflict-queue service.
 *
 * PouchDB's default replication resolves document conflicts by most-recent-rev
 * wins. For high-risk clinical data (allergies, active medications, referrals,
 * discharge status) that default is unsafe — a lost edit can mask a real
 * change in a patient's chart.
 *
 * This service captures conflicts on those tracked resources into an explicit
 * queue so a human (medical_superintendent / hrio) reconciles them instead.
 *
 * Risk tiering (matches the spec):
 *   low     — demographic corrections, non-clinical metadata → auto-merge OK
 *   medium  — active medication lists, problem lists → version-check merge
 *   high    — allergies, referrals, discharge status, legally sensitive → queue
 */
import { conflictQueueDB, getDB } from '../db';
import type { ConflictQueueDoc } from '../db-types';
import { findByType } from './db-query';
import { DATABASE_DOCUMENT_TYPES } from '../sync/sync-config';
import { RETAINED_RECORD_TYPES, isAppendOnlyDatabase } from '../sync/write-permissions';

/** Resource types that must never auto-merge on conflict. */
export const HIGH_RISK_RESOURCES: ReadonlySet<string> = new Set([
  'referral',
  // Inpatient operational state is clinical state: silently choosing one bed
  // claim can double-book a bed, and choosing one prescription revision can
  // erase a bedside administration recorded by another nurse.
  'bed',
  'admission',
  'prescription',
  'medication_administration',
  'shift_handoff',

  // ── Added Aug 2026, after an audit found these settling their own ────────
  //
  // Everything absent from this list takes PouchDB's most-recent-revision-wins
  // default, silently. That is fine for a preference and wrong for a record
  // two devices can write at once — which, in a system built to work through
  // outages, is every clinical document.
  //
  // The controlled-substance register is the one that made the case: a
  // narcotics count that quietly discards a revision is a controlled-drugs
  // accountability failure, and it is precisely the register an inspector
  // asks to see. Births and deaths are legally reportable vital events, and a
  // lost revision there is a lost notification. The rest are clinical
  // decisions or identity: a lab result, a triage acuity, an encounter, a
  // procedure, an immunisation, a patient's own demographics, and the
  // transfer that moves their care to someone else.
  'controlled_substance_log',
  'lab_result',
  'birth',
  'death',
  'clinical_encounter',
  'triage',
  'procedure',
  'immunization',
  'patient',
  'patient_transfer',
  // Standing history is corrected in place, and social history holds one
  // answer per factor — so two devices editing "Tobacco" offline is a real
  // case, and most-recent-wins would silently drop one clinician's correction
  // from a line every later note copies.
  'history_entry',

  // ── Added Oct 2026: money and the chart itself ───────────────────────────
  // Every name here is a real document type (DATABASE_DOCUMENT_TYPES), pinned
  // by a test. The earlier entries 'allergy', 'discharge', 'medication_allergy'
  // and 'adverse_event' matched no document type — allergies and discharge
  // status live inside patient/admission documents, which are listed — so
  // they could never fire and are gone.
  'billing',
  'payment',
  'charge',
  'medical_record',
  'clinical_note',
  'appointment',
  'problem',
]);

export const MEDIUM_RISK_RESOURCES: ReadonlySet<string> = new Set([
  'medication',
  'problem_list',
  'diagnosis',
]);

export function riskFor(resourceType: string): ConflictQueueDoc['risk'] {
  if (HIGH_RISK_RESOURCES.has(resourceType)) return 'high';
  if (MEDIUM_RISK_RESOURCES.has(resourceType)) return 'medium';
  return 'low';
}

/** Delays between retry attempts in milliseconds. */
const ENQUEUE_RETRY_DELAYS = [500, 2000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify a PouchDB/CouchDB error as retryable or not.
 *  - 409 conflict is handled by the caller as a success (idempotent put).
 *  - 4xx auth/validation errors (400, 401, 403) are permanent — never retry.
 *  - 5xx server errors and undefined-status network errors are transient.
 */
function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  if (status === undefined) return true; // network-style, no HTTP envelope
  if (status >= 500) return true;
  return false;
}

function isConflictError(err: unknown): boolean {
  const e = err as { status?: number; name?: string } | null;
  return e?.status === 409 || e?.name === 'conflict';
}

/**
 * Run `op` with up to 3 attempts (immediate, +500ms, +2000ms). A 409 conflict
 * is treated as success (the doc already exists) and resolves to `undefined`.
 * Non-retryable errors (401/403/400) rethrow immediately.
 */
async function withEnqueueRetry<T>(op: () => Promise<T>): Promise<T | undefined> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (isConflictError(err)) {
        // Doc already enqueued for this (resourceType, resourceId, winningRev)
        // — treat as success and return silently.
        return undefined;
      }
      if (!isRetryableError(err)) {
        throw err;
      }
      lastErr = err;
      const wait = ENQUEUE_RETRY_DELAYS[attempt];
      if (wait !== undefined) await delay(wait);
    }
  }
  throw lastErr;
}

export function conflictQueueId(resourceType: string, resourceId: string, winningRev: string): string {
  return `conflict:${resourceType}:${resourceId}:${winningRev}`;
}

/**
 * Record a detected conflict into the queue. Idempotent on
 * (resourceType, resourceId, winningRev).
 */
export async function enqueueConflict(input: {
  resourceType: string;
  resourceId: string;
  winningRev: string;
  losingRevs: string[];
  orgId?: string;
  countryId?: string;
}): Promise<ConflictQueueDoc> {
  const db = conflictQueueDB();

  // A retained record (message, conversation, history_entry) is never
  // tombstoned on resolution, so its competing branches stay in the revision
  // tree as _conflicts. Detection then sees a new winning revision (the one
  // the admin's choice created) and would mint a new row for a conflict that
  // was already resolved. If every currently-losing revision is a leaf an
  // earlier resolution recorded as handled, there is nothing new to decide.
  if (input.losingRevs.length > 0) {
    try {
      const prefix = `conflict:${input.resourceType}:${input.resourceId}:`;
      const res = await db.allDocs({ startkey: prefix, endkey: `${prefix}\ufff0`, include_docs: true });
      const handled = new Set<string>();
      let prior: ConflictQueueDoc | undefined;
      for (const r of res.rows) {
        const d = r.doc as (ConflictQueueDoc & { resolvedLeafRevs?: string[] }) | undefined;
        if (d && d.status === 'resolved' && Array.isArray(d.resolvedLeafRevs)) {
          for (const rev of d.resolvedLeafRevs) handled.add(rev);
          prior = d;
        }
      }
      if (prior && input.losingRevs.every((rev) => handled.has(rev))) return prior;
    } catch {
      // the lookup is an optimisation against re-enqueueing; fall through
    }
  }

  const now = new Date().toISOString();
  const doc: ConflictQueueDoc = {
    // Deterministic, so the 409 dedupe below actually fires: the same conflict
    // detected again (every pull re-surfaces it) maps to the same row.
    _id: conflictQueueId(input.resourceType, input.resourceId, input.winningRev),
    type: 'conflict_queue',
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    risk: riskFor(input.resourceType),
    winningRev: input.winningRev,
    losingRevs: input.losingRevs,
    status: 'pending',
    orgId: input.orgId,
    countryId: input.countryId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await withEnqueueRetry(() => db.put(doc));
  if (resp) {
    doc._rev = resp.rev;
  }
  return doc;
}

/** Who is asking. Tenant scoping is mandatory: there is no implicit "all orgs". */
export interface ConflictScope {
  /** The caller's organization. */
  orgId?: string;
  /** Platform operators may see and act on every organization's queue. */
  superAdmin?: boolean;
}

function inScope(row: { orgId?: string }, scope: ConflictScope): boolean {
  if (scope.superAdmin) return true;
  // A row without an org belongs to no tenant an org caller can name.
  return !!scope.orgId && row.orgId === scope.orgId;
}

/** List queued conflicts, newest first. A caller with no org and no super-admin scope sees nothing. */
export async function listConflicts(filter: {
  status?: ConflictQueueDoc['status'];
  risk?: ConflictQueueDoc['risk'];
  orgId?: string;
  superAdmin?: boolean;
} = {}): Promise<ConflictQueueDoc[]> {
  const scope: ConflictScope = { orgId: filter.orgId, superAdmin: filter.superAdmin };
  if (!scope.superAdmin && !scope.orgId) return [];
  const db = conflictQueueDB();
  const rows = await findByType<ConflictQueueDoc>(db, 'conflict_queue');
  return rows
    .filter((d) => {
      if (!d || d.type !== 'conflict_queue') return false;
      if (!inScope(d, scope)) return false;
      if (filter.status && d.status !== filter.status) return false;
      if (filter.risk && d.risk !== filter.risk) return false;
      return true;
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export type ConflictActionError =
  | 'not_found'        // no such row, or not the caller's tenant (indistinguishable on purpose)
  | 'already_closed'   // the row is no longer pending
  | 'invalid_rev'      // chosenRev is not a live revision of the target
  | 'unsupported'      // no safe generic way to apply a choice for this type
  | 'target_missing'   // the document the row points at is gone
  | 'failed';

export type ConflictActionResult =
  | { ok: true; conflict: ConflictQueueDoc }
  | { ok: false; error: ConflictActionError; message: string };

function fail(error: ConflictActionError, message: string): ConflictActionResult {
  return { ok: false, error, message };
}

function localDatabaseFor(resourceType: string): string | null {
  for (const [name, types] of Object.entries(DATABASE_DOCUMENT_TYPES)) {
    if (types.includes(resourceType)) return name;
  }
  return null;
}

/**
 * Make `chosenRev` the winner on the target document.
 *
 *  - Ordinary types: the chosen revision's content becomes the head (a new
 *    revision on top when it was a losing branch) and every other live branch
 *    is closed with a tombstone, so the document has exactly one leaf again.
 *  - Retained records (message, conversation, history_entry): the record must
 *    never be destroyed, and the gateway polices deletions there. The chosen
 *    content is written as a NEW revision on top of the current head and
 *    nothing is deleted; the competing branches stay in the revision tree.
 *  - Append-only databases (audit, controlled substances, MAR, ledger) refuse
 *    any amendment, so a choice cannot be applied: explicit error, row stays
 *    pending.
 */
type QueueRow = ConflictQueueDoc & {
  /** Set before the target is touched so a half-finished resolve can be resumed. */
  resolveInProgress?: { chosenRev: string; startedAt: string };
  /** Every leaf revision that existed when this row was resolved. */
  resolvedLeafRevs?: string[];
};

interface ApplyHooks {
  /** Persist the in-progress marker on the queue row (called once, before the first target write). */
  mark: () => Promise<void>;
  /** Already marked by an earlier, interrupted attempt for this same choice. */
  resumed: boolean;
  /** Filled with every leaf revision that existed, for the resolved row. */
  leafRevs: string[];
}

/** Signed/amended documents are locked against in-place edits. */
function isLockedDoc(resourceType: string, doc: Record<string, unknown>): boolean {
  // Mirrors isRecordLocked (medical-record-service) and the clinical-note
  // NoteStatus; inlined so the sync-facing queue does not import the record service.
  const status = resourceType === 'medical_record' ? doc.documentStatus
    : resourceType === 'clinical_note' ? doc.status
    : undefined;
  return status === 'signed' || status === 'amended';
}

/** Strip bookkeeping that differs between revisions of the same content. */
function stripRevMeta(doc: Record<string, unknown>): Record<string, unknown> {
  const { _conflicts: _c, _rev: _r, _revisions: _rv, _rev_tree: _rt, ...content } = doc;
  void _c; void _r; void _rv; void _rt;
  return content;
}

async function applyChoice(
  row: QueueRow,
  chosenRev: string,
  hooks: ApplyHooks,
): Promise<ConflictActionResult | null> {
  const dbName = localDatabaseFor(row.resourceType);
  if (!dbName) return fail('unsupported', `No database is known for ${row.resourceType} documents.`);
  if (isAppendOnlyDatabase(dbName)) {
    return fail('unsupported', `${row.resourceType} records are append-only and cannot be amended; the queue entry was left pending.`);
  }
  const retained = RETAINED_RECORD_TYPES.includes(row.resourceType);
  const db = getDB(dbName);

  let head: Record<string, unknown> & { _id: string; _rev: string; _conflicts?: string[] };
  try {
    head = await db.get(row.resourceId, { conflicts: true }) as typeof head;
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    if (status === 404) return fail('target_missing', 'The document this conflict refers to no longer exists.');
    throw err;
  }
  // The row's tenant must own the document it points at.
  const docOrg = head.orgId as string | undefined;
  if (row.orgId && docOrg && docOrg !== row.orgId) {
    return fail('not_found', 'Conflict not found.');
  }

  const losers = head._conflicts ?? [];
  const live = [head._rev, ...losers];

  // Re-entrant finish. The resolve is several writes (head, then tombstones),
  // and the chosen branch is tombstoned last. If an earlier attempt for this
  // same choice got that far, the chosen revision is no longer a leaf but the
  // head already carries its content: close whatever is left and finish,
  // instead of reporting invalid_rev with the row stuck pending.
  if (!live.includes(chosenRev)) {
    if (!hooks.resumed) return fail('invalid_rev', 'That revision is no longer a live version of the document.');
    hooks.leafRevs.push(...live, chosenRev);
    if (!retained) {
      for (const rev of losers) await db.put({ _id: head._id, _rev: rev, _deleted: true } as never);
    }
    return null;
  }

  let chosen: Record<string, unknown>;
  if (chosenRev === head._rev) {
    chosen = head;
  } else {
    chosen = await db.get(row.resourceId, { rev: chosenRev }) as unknown as Record<string, unknown>;
  }

  // A signed/locked record must not be replaced by a pre-signature branch.
  if (isLockedDoc(row.resourceType, head) && !isLockedDoc(row.resourceType, chosen)) {
    return fail('unsupported', 'The current version of this record is signed and locked; an unsigned version cannot replace it. Choose the signed version or add an addendum. The queue entry was left pending.');
  }

  hooks.leafRevs.push(...live);
  const toClose = live.filter((r) => r !== head._rev && r !== chosenRev);
  const closeChosenLast = chosenRev !== head._rev;
  const writesHead = chosenRev !== head._rev;
  if (!writesHead && (retained || toClose.length === 0)) return null; // chosen already the sole winner: nothing to write

  await hooks.mark();

  if (writesHead) {
    // Chosen content goes on top of the current head.
    const content = stripRevMeta(chosen);
    if (row.resourceType === 'patient') {
      // Portal credentials/suspension are authoritative on the head: an older
      // branch must never restore a cleared epoch, an old hash or a lifted
      // suspension.
      for (const k of Object.keys(content)) if (k.startsWith('portal')) delete content[k];
      for (const k of Object.keys(head)) if (k.startsWith('portal')) content[k] = head[k];
    }
    await db.put({ ...content, _id: head._id, _rev: head._rev, updatedAt: new Date().toISOString() } as never);
  }
  if (!retained) {
    for (const rev of toClose) await db.put({ _id: head._id, _rev: rev, _deleted: true } as never);
    if (closeChosenLast) await db.put({ _id: head._id, _rev: chosenRev, _deleted: true } as never);
  }
  return null;
}

export async function resolveConflict(
  id: string,
  resolver: { userId?: string; username?: string; chosenRev: string; note?: string },
  scope: ConflictScope,
): Promise<ConflictActionResult> {
  const db = conflictQueueDB();
  let existing: ConflictQueueDoc;
  try {
    existing = await db.get(id) as ConflictQueueDoc;
  } catch {
    return fail('not_found', 'Conflict not found.');
  }
  if (!existing || existing.type !== 'conflict_queue' || !inScope(existing, scope)) {
    return fail('not_found', 'Conflict not found.');
  }
  if (existing.status !== 'pending') return fail('already_closed', 'This conflict has already been closed.');

  const row = existing as QueueRow;
  const hooks: ApplyHooks = {
    resumed: row.resolveInProgress?.chosenRev === resolver.chosenRev,
    leafRevs: [],
    mark: async () => {
      if (row.resolveInProgress?.chosenRev === resolver.chosenRev) return;
      row.resolveInProgress = { chosenRev: resolver.chosenRev, startedAt: new Date().toISOString() };
      const resp = await db.put(row);
      row._rev = resp.rev;
    },
  };
  try {
    const applied = await applyChoice(row, resolver.chosenRev, hooks);
    if (applied) return applied;
  } catch (err) {
    return fail('failed', `The document could not be updated (${err instanceof Error ? err.message : 'error'}); the queue entry was left pending.`);
  }

  const now = new Date().toISOString();
  const { resolveInProgress: _rip, ...rowRest } = row;
  void _rip;
  const resolvedLeafRevs = Array.from(new Set([...(row.resolvedLeafRevs ?? []), ...hooks.leafRevs, resolver.chosenRev]));
  const updated: QueueRow = {
    ...rowRest,
    status: 'resolved',
    resolvedBy: resolver.username || resolver.userId,
    resolvedAt: now,
    resolvedRev: resolver.chosenRev,
    resolvedLeafRevs,
    resolutionNote: resolver.note,
    updatedAt: now,
  };
  try {
    const resp = await db.put(updated);
    updated._rev = resp.rev;
  } catch {
    return fail('failed', 'The choice was applied but the queue entry could not be closed; retry to finish.');
  }
  return { ok: true, conflict: updated };
}

export async function dismissConflict(
  id: string,
  resolver: { userId?: string; username?: string; note?: string },
  scope: ConflictScope,
): Promise<ConflictActionResult> {
  const db = conflictQueueDB();
  let existing: ConflictQueueDoc;
  try {
    existing = await db.get(id) as ConflictQueueDoc;
  } catch {
    return fail('not_found', 'Conflict not found.');
  }
  if (!existing || existing.type !== 'conflict_queue' || !inScope(existing, scope)) {
    return fail('not_found', 'Conflict not found.');
  }
  if (existing.status !== 'pending') return fail('already_closed', 'This conflict has already been closed.');
  const now = new Date().toISOString();
  const updated: ConflictQueueDoc = {
    ...existing,
    status: 'dismissed',
    resolvedBy: resolver.username || resolver.userId,
    resolvedAt: now,
    resolutionNote: resolver.note,
    updatedAt: now,
  };
  try {
    const resp = await db.put(updated);
    updated._rev = resp.rev;
  } catch {
    return fail('failed', 'The queue entry could not be updated.');
  }
  return { ok: true, conflict: updated };
}
