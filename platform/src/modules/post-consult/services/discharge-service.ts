import type { EncounterDoc, UserRole } from '@/lib/db-types';
import { CLINICIANS, NURSING_AND_CLINICIANS, REGISTRATION } from '@/lib/sync/write-permissions';
import { encountersDB } from '@/lib/db';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';
import { logAudit } from '@/lib/services/audit-service';

export const DISCHARGE_STATUSES = ['discharged', 'discharged_with_referral', 'discharged_with_pending_items', 'dismissed_without_formal_checkout'];
export interface DischargeActor { actorId?: string; actorRole?: UserRole; reason?: string }

/** Authoritative local checkout guard. Replication separately authenticates actor claims. */
export async function assertDischargeAllowed(id: string, status: string, actor: DischargeActor = {}): Promise<void> {
  const doc = await encountersDB().get(id, { conflicts: true }) as EncounterDoc & { _conflicts?: string[] };
  if (doc._conflicts?.length) throw new Error('POST_CONSULT_CONFLICT');
  if (!actor.actorId || !actor.actorRole || ![...NURSING_AND_CLINICIANS, ...REGISTRATION].includes(actor.actorRole)) throw new Error('DISCHARGE_FORBIDDEN');
  const exceptional = status === 'discharged_with_pending_items' || status === 'dismissed_without_formal_checkout';
  if (exceptional && (!CLINICIANS.includes(actor.actorRole) || !actor.reason?.trim() || actor.reason.length > 2000)) throw new Error('DISCHARGE_OVERRIDE_REQUIRES_CLINICIAN_AND_REASON');
  const evaluation = await evaluateCheckoutGate(doc.patientId, doc, {
    userId: actor.actorId, role: actor.actorRole, orgId: doc.orgId, hospitalId: doc.hospitalId,
  });
  if (!exceptional && !evaluation.canDischarge) throw new Error(`CHECKOUT_BLOCKED: ${evaluation.blocking.map(b => b.key).join(', ')}`);
  if (exceptional) await auditOverrideOnce(id, status, actor.actorId,
    `Encounter ${id}: ${status}; ${evaluation.blocking.map(b => b.key).join(', ')}; reason recorded on the visit`);
}

/**
 * One discharge asserts the gate twice (dischargeEncounter, then the
 * transitionEncounter it calls). The override is one decision, so it is
 * audited once: repeats for the same encounter, status and actor inside the
 * window are the same discharge, not a second override.
 */
const OVERRIDE_AUDIT_WINDOW_MS = 10_000;
const recentOverrideAudits = new Map<string, number>();
function isRecentOverride(key: string): boolean {
  const now = Date.now();
  for (const [k, at] of recentOverrideAudits) if (now - at > OVERRIDE_AUDIT_WINDOW_MS) recentOverrideAudits.delete(k);
  return recentOverrideAudits.has(key);
}

/**
 * Audit the override, then (only once the write is known to have succeeded)
 * remember it for the dedupe window. A failed audit write is not remembered,
 * so the next assert retries it instead of being suppressed.
 */
async function auditOverrideOnce(id: string, status: string, actorId: string | undefined, details: string): Promise<void> {
  const key = `${id}|${status}|${actorId ?? ''}`;
  if (isRecentOverride(key)) return;
  try {
    await logAudit('CHECKOUT_GATE_OVERRIDDEN', actorId, undefined, details);
    recentOverrideAudits.set(key, Date.now());
  } catch (err) {
    console.warn(`[AUDIT LOST] CHECKOUT_GATE_OVERRIDDEN: ${err instanceof Error ? err.message : String(err)}`);
  }
}
