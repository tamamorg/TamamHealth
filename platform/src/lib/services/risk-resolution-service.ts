/**
 * Risk resolutions — the record that a platform risk has been dealt with.
 *
 * The Risk Center's queue is derived, not stored: every row is recomputed from
 * a live signal (a failed audit entry, a pending conflict, a suspended tenant,
 * an overdue backup) each time the page loads. That makes the queue honest, but
 * it also meant nothing could ever be cleared from it. An operator who fixed
 * the underlying problem had no way to say so, and a signal whose source never
 * changes — a login failure last Tuesday — stayed in the queue until it aged
 * out of the seven-day window on its own.
 *
 * These documents are the missing half. They do not modify the signals; they
 * sit alongside them and mark specific occurrences as handled, so the queue can
 * show what is still open without pretending the underlying events unhappened.
 *
 * Reopening is a delete, not a flag: an unresolved risk is the absence of a
 * resolution, so there is exactly one way for the queue to read "open" rather
 * than two that can disagree.
 */

import { platformConfigDB } from '../db';
import { findByType } from './db-query';
import type { RiskResolutionDoc } from '../db-types';

/** Doc ids are derived from the risk id so resolving twice updates one record
 *  instead of racing two. Risk ids are assembled from document ids, which can
 *  carry characters a PouchDB id should not, so anything outside a safe set is
 *  folded to '_' — collisions would need two risk ids differing only in
 *  punctuation, and both would then be the same row to a reader anyway. */
function docId(riskId: string): string {
  return `risk-resolution:${riskId.replace(/[^A-Za-z0-9:_.-]/g, '_')}`;
}

export interface ResolveRiskInput {
  riskId: string;
  signature: string;
  severity: RiskResolutionDoc['severity'];
  source: string;
  signal: string;
  note?: string;
}

export interface RiskActor {
  _id?: string;
  username?: string;
  name?: string;
}

export async function getRiskResolutions(): Promise<RiskResolutionDoc[]> {
  try {
    return await findByType<RiskResolutionDoc>(platformConfigDB(), 'risk_resolution');
  } catch {
    // The platform config DB is unavailable (offline first paint, or a browser
    // with no local replica yet). An empty list is the right answer: it shows
    // every risk as open, which is the safe direction to be wrong in.
    return [];
  }
}

/**
 * Resolve one risk. Idempotent per risk id — resolving an already-resolved risk
 * overwrites the note and timestamp rather than failing on a conflict.
 */
export async function resolveRisk(input: ResolveRiskInput, actor?: RiskActor): Promise<RiskResolutionDoc> {
  const doc = await writeResolution(input, actor);
  const { logAudit } = await import('./audit-service');
  await logAudit(
    'risk_resolved',
    actor?._id,
    actor?.username,
    `Resolved ${input.severity} ${input.source} risk: ${input.signal}${doc.note ? ` — ${doc.note}` : ''}`,
    true,
  );
  return doc;
}

/**
 * Resolve several risks at once — the "resolve everything shown" action.
 *
 * Each resolution is written independently so one failure cannot discard the
 * rest, and the audit trail gets a single summary entry plus nothing per row:
 * one operator decision is one audit event, and the resolved documents
 * themselves record which rows it covered.
 */
export async function resolveRisks(inputs: ResolveRiskInput[], actor?: RiskActor): Promise<{
  resolved: RiskResolutionDoc[];
  failed: number;
}> {
  const results = await Promise.allSettled(inputs.map(input => writeResolution(input, actor)));
  const resolved = results
    .filter((r): r is PromiseFulfilledResult<RiskResolutionDoc> => r.status === 'fulfilled')
    .map(r => r.value);
  const failed = results.length - resolved.length;

  if (resolved.length > 0) {
    const note = inputs.find(i => i.note?.trim())?.note?.trim();
    const { logAudit } = await import('./audit-service');
    await logAudit(
      'risk_resolved_bulk',
      actor?._id,
      actor?.username,
      `Resolved ${resolved.length} risk signal${resolved.length === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}${note ? ` — ${note}` : ''}`,
      failed === 0,
    );
  }
  return { resolved, failed };
}

/** The write half of `resolveRisk`, without the per-row audit entry. */
async function writeResolution(input: ResolveRiskInput, actor?: RiskActor): Promise<RiskResolutionDoc> {
  const db = platformConfigDB();
  const id = docId(input.riskId);
  const now = new Date().toISOString();
  let existing: RiskResolutionDoc | null = null;
  try {
    existing = await db.get(id) as RiskResolutionDoc;
  } catch {
    /* first resolution for this risk */
  }
  const doc: RiskResolutionDoc = {
    ...(existing || {}),
    _id: id,
    _rev: existing?._rev,
    type: 'risk_resolution',
    riskId: input.riskId,
    signature: input.signature,
    severity: input.severity,
    source: input.source,
    signal: input.signal,
    note: input.note?.trim() || undefined,
    resolvedAt: now,
    resolvedById: actor?._id,
    resolvedByName: actor?.name || actor?.username,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  return doc;
}

/** Put a risk back in the open queue. Missing resolutions are not an error —
 *  the caller's intent (this risk should read as open) is already satisfied. */
export async function reopenRisk(riskId: string, actor?: RiskActor): Promise<void> {
  const db = platformConfigDB();
  try {
    const doc = await db.get(docId(riskId)) as RiskResolutionDoc;
    await db.remove({ _id: doc._id, _rev: doc._rev as string });
    const { logAudit } = await import('./audit-service');
    await logAudit('risk_reopened', actor?._id, actor?.username, `Reopened risk: ${doc.signal}`, true);
  } catch {
    /* nothing recorded for this risk — it is already open */
  }
}

/** Resolutions keyed by risk id, for O(1) lookup while rendering a queue. */
export function indexResolutions(docs: RiskResolutionDoc[]): Map<string, RiskResolutionDoc> {
  return new Map(docs.map(d => [d.riskId, d] as const));
}

/**
 * Whether a derived row counts as resolved right now.
 *
 * The signature comparison is what stops a stale resolution from hiding a
 * recurrence: a condition that comes back in a different state produces a
 * different signature, so it reads as open again without anyone having to
 * remember to reopen it.
 */
export function isRiskResolved(
  index: Map<string, RiskResolutionDoc>,
  riskId: string,
  signature: string,
): boolean {
  const found = index.get(riskId);
  return !!found && found.signature === signature;
}
