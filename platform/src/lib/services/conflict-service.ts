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
import { conflictQueueDB } from '../db';
import type { ConflictQueueDoc } from '../db-types';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';

/** Resource types that must never auto-merge on conflict. */
export const HIGH_RISK_RESOURCES: ReadonlySet<string> = new Set([
  'allergy',
  'referral',
  'discharge',
  'medication_allergy',
  'adverse_event',
  // Inpatient operational state is clinical state: silently choosing one bed
  // claim can double-book a bed, and choosing one prescription revision can
  // erase a bedside administration recorded by another nurse.
  'bed',
  'admission',
  'prescription',
  'medication_administration',
  'shift_handoff',
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
  const now = new Date().toISOString();
  const doc: ConflictQueueDoc = {
    _id: `conflict-${uuidv4()}`,
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

/** List queued conflicts, newest first. Filters optional. */
export async function listConflicts(filter?: {
  status?: ConflictQueueDoc['status'];
  risk?: ConflictQueueDoc['risk'];
  orgId?: string;
}): Promise<ConflictQueueDoc[]> {
  const db = conflictQueueDB();
  const rows = await findByType<ConflictQueueDoc>(db, 'conflict_queue');
  return rows
    .filter((d) => {
      if (!d || d.type !== 'conflict_queue') return false;
      if (filter?.status && d.status !== filter.status) return false;
      if (filter?.risk && d.risk !== filter.risk) return false;
      if (filter?.orgId && d.orgId !== filter.orgId) return false;
      return true;
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function resolveConflict(
  id: string,
  resolver: { userId?: string; username?: string; chosenRev: string; note?: string }
): Promise<ConflictQueueDoc | null> {
  const db = conflictQueueDB();
  try {
    const existing = await db.get(id) as ConflictQueueDoc;
    const now = new Date().toISOString();
    const updated: ConflictQueueDoc = {
      ...existing,
      status: 'resolved',
      resolvedBy: resolver.username || resolver.userId,
      resolvedAt: now,
      resolvedRev: resolver.chosenRev,
      resolutionNote: resolver.note,
      updatedAt: now,
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    return updated;
  } catch {
    return null;
  }
}

export async function dismissConflict(
  id: string,
  resolver: { userId?: string; username?: string; note?: string }
): Promise<ConflictQueueDoc | null> {
  const db = conflictQueueDB();
  try {
    const existing = await db.get(id) as ConflictQueueDoc;
    const now = new Date().toISOString();
    const updated: ConflictQueueDoc = {
      ...existing,
      status: 'dismissed',
      resolvedBy: resolver.username || resolver.userId,
      resolvedAt: now,
      resolutionNote: resolver.note,
      updatedAt: now,
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    return updated;
  } catch {
    return null;
  }
}
