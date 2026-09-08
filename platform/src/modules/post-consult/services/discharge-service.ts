import type { EncounterDoc, UserRole } from '@/lib/db-types';
import { CLINICIANS, NURSING_AND_CLINICIANS, REGISTRATION } from '@/lib/sync/write-permissions';
import { encountersDB } from '@/lib/db';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';
import { logAuditSafe } from '@/lib/services/audit-service';

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
  if (exceptional) await logAuditSafe('CHECKOUT_GATE_OVERRIDDEN', actor.actorId, undefined,
    `Encounter ${id}: ${status}; ${evaluation.blocking.map(b => b.key).join(', ')}; ${actor.reason!.trim()}`);
}
