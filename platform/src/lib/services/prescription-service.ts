import { prescriptionsDB, hospitalsDB } from '../db';
import { findByType } from './db-query';
import type { PrescriptionDoc, MedicationAdministration, UserRole, HospitalDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { validatePrescription, ValidationError } from '../validation';
import {
  checkNewPrescription,
  checkAllergiesStructured,
  findDuplicateMedications,
  type InteractionCheckResult,
  type StructuredAllergyAlert,
} from './drug-interaction-service';
import { prescription as rxLifecycle, type PrescriptionStatus } from '../clinical-flow/order-lifecycles';
import { resolvePrescriptionTier } from '../clinical-flow/medication-tiers';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import { getUserById } from './user-service';

/**
 * Roles allowed to clear a medication order for dispensing — the one state
 * dispenseMedication() (dispensing-service.ts) trusts as its sole proof that
 * review already happened. Kept as its own constant here (rather than
 * imported from dispensing-service.ts) because that file already imports
 * from this one — importing it back would be circular.
 */
const CLEARANCE_ROLES: UserRole[] = ['pharmacist'];

/** Granular pharmacy lifecycle stage, defaulting legacy docs from coarse status. */
export function effectivePrescriptionStatus(
  doc: Pick<PrescriptionDoc, 'orderStatus' | 'status'>,
): PrescriptionStatus {
  // A discontinue can land on a prescription that already carries a stale
  // `orderStatus` (e.g. 'cleared_for_dispensing' from before the prescriber
  // stopped it) — `status` is the more recent write and must win, or the
  // stopped drug keeps resolving to a dispensable/administrable stage.
  if (doc.status === 'discontinued') return 'held_awaiting_clarification';
  if (doc.orderStatus) return doc.orderStatus;
  if (doc.status === 'dispensed') return 'dispensed';
  return 'received_in_pharmacy_queue';
}

/** Coarse `status` derived from the granular lifecycle stage. */
function coarseFromRxStatus(s: PrescriptionStatus): PrescriptionDoc['status'] {
  return (s === 'dispensed' || s === 'counseled' || s === 'complete') ? 'dispensed' : 'pending';
}

/**
 * Advance a prescription to the next lifecycle stage, validated against
 * PRESCRIPTION_TRANSITIONS. Keeps the coarse `status` in sync. Throws on an
 * illegal transition.
 *
 * Lifecycle legality alone used to be the only check here — this validated
 * that `cleared_for_dispensing` was a legal move FROM the order's current
 * stage, but never checked WHO was making it. dispenseMedication() treats
 * `cleared_for_dispensing` as its sole proof that stock/safety review already
 * happened, so any caller able to reach this function (any script, any
 * future UI surface) could clear an order it never reviewed. `actorId` is
 * resolved directory-first — same pattern as the witness/dispenser identity
 * checks in dispensing-service.ts — so the check can't be satisfied by a
 * caller-supplied role string.
 */
export async function advancePrescription(
  id: string,
  to: PrescriptionStatus,
  extra?: Partial<PrescriptionDoc>,
  actorId?: string,
): Promise<PrescriptionDoc | null> {
  const db = prescriptionsDB();
  const existing = await db.get(id) as PrescriptionDoc;
  const from = effectivePrescriptionStatus(existing);
  if (from !== to && !rxLifecycle.can(from, to)) {
    throw new Error(`Illegal prescription transition: ${from} → ${to}`);
  }
  if (to === 'cleared_for_dispensing') {
    const actor = actorId ? await getUserById(actorId) : null;
    if (!actor || actor.isActive === false || !CLEARANCE_ROLES.includes(actor.role)) {
      throw new Error('Only a pharmacist may clear a medication order for dispensing.');
    }
  }
  return updatePrescription(id, { ...extra, orderStatus: to, status: coarseFromRxStatus(to) });
}

export async function getAllPrescriptions(scope?: DataScope): Promise<PrescriptionDoc[]> {
  const db = prescriptionsDB();
  const all = await findByType<PrescriptionDoc>(db, 'prescription');
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getPrescriptionsByPatient(patientId: string, scope?: DataScope): Promise<PrescriptionDoc[]> {
  const rows = await findByType<PrescriptionDoc>(prescriptionsDB(), 'prescription', { patientId }, { indexFields: ['type', 'patientId'] });
  return scope ? filterByScope(rows, scope) : rows;
}

export interface PrescriptionCreateResult {
  prescription: PrescriptionDoc;
  interactionWarnings: InteractionCheckResult | null;
  /**
   * Class-aware matches of the new medication against the patient's recorded
   * ACTIVE allergies (penicillin allergy flags amoxicillin, etc.). Severe and
   * unknown-criticality matches carry `requiresOverride: true`. Advisory:
   * the prescription is written either way — the caller's UI is responsible
   * for confronting the prescriber with these.
   */
  allergyWarnings: StructuredAllergyAlert[] | null;
  /** Same-drug (dose/form-insensitive) matches against the patient's active prescriptions. */
  duplicateWarnings: string[] | null;
}

async function inferOrgIdFromHospital(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const hosp = await hospitalsDB().get(hospitalId) as HospitalDoc;
    return hosp.orgId;
  } catch {
    return undefined;
  }
}

/**
 * Check a proposed medication against a patient's active prescriptions.
 */
export async function checkPrescriptionInteractions(
  patientId: string,
  newMedication: string,
): Promise<InteractionCheckResult> {
  const patientRx = await getPrescriptionsByPatient(patientId);
  const activeRx = patientRx
    .filter(rx => rx.status === 'pending')
    .map(rx => rx.medication);
  return checkNewPrescription(newMedication, activeRx);
}

/**
 * Park the visit at the pharmacy (Stage 8).
 *
 * Ordering a lab already anchors the order to the open encounter and moves it
 * to `awaiting_labs`, so the lab queue and the visit state tell the same story.
 * Prescribing carried an `encounterId` but never transitioned anything, so a
 * patient standing in the pharmacy queue still read as `with_clinician` on
 * every dashboard that reports from the encounter.
 *
 * Only moves when the machine says the move is legal — `awaiting_pharmacy` is
 * reachable from `with_clinician` and from `clinic_complete_awaiting_next_station`
 * and nowhere else — so a prescription written from a chart long after the visit
 * closed, or during a ward admission, changes nothing.
 */
async function parkVisitAtPharmacy(doc: PrescriptionDoc): Promise<void> {
  if (!doc.encounterId) return;
  try {
    const { getEncounter, transitionEncounter } = await import('./encounter-service');
    const { canTransition } = await import('../clinical-flow/encounter-journey');
    const enc = await getEncounter(doc.encounterId);
    if (!enc) return;
    if (enc.status === 'awaiting_pharmacy') return; // second Rx on the same visit
    if (!canTransition(enc.status, 'awaiting_pharmacy')) return;
    await transitionEncounter(doc.encounterId, 'awaiting_pharmacy', {
      reason: `Prescription ${doc._id}: ${doc.medication}`,
    });
  } catch (err) {
    console.warn('[prescription] could not park the visit at pharmacy:', err);
  }
}

/**
 * Charge for the medication (Section 5).
 *
 * Dispensing used to raise no charge anywhere: `chargeForServices` was called
 * only by lab ordering and the manual superbill, and `dispensing-service` has
 * no billing reference at all. The demo looked right only because the seed
 * hand-writes pharmacy charges. The knock-on was worse than the missing
 * revenue — the pharmacy station gates dispensing on
 * `isFinanciallyCleared(balance)`, and a balance that medications never
 * contributed to meant the gate passed vacuously on every medication-only visit.
 *
 * Billed at PRESCRIBING time rather than at dispensing, for the same reason a
 * lab test is billed when ordered and not when resulted: the charge has to
 * exist before the patient reaches the counter, or the pay-first gate has
 * nothing to check. Tier-1 medications are exempt from that gate at the
 * counter, so this cannot strand a patient on a life-sustaining drug.
 *
 * Prices come from the org's fee schedule; an uncatalogued medication is
 * skipped rather than charged zero, exactly as lab tests are.
 */
async function billPrescription(doc: PrescriptionDoc): Promise<void> {
  if (!doc.hospitalId) return; // a bill has to belong to a facility
  try {
    const { chargeForServices } = await import('./fee-schedule-service');
    const { getPatientById } = await import('./patient-service');
    const [patient, hospital] = await Promise.all([
      getPatientById(doc.patientId).catch(() => null),
      hospitalsDB().get(doc.hospitalId).then(h => h as HospitalDoc).catch(() => null),
    ]);

    await chargeForServices(
      {
        patientId: doc.patientId,
        patientName: doc.patientName,
        hospitalNumber: patient?.hospitalNumber,
        facilityId: doc.hospitalId,
        facilityName: hospital?.name || doc.hospitalName || '',
        facilityLevel: 'clinic',
        state: patient?.state || '',
        county: patient?.county,
        orgId: doc.orgId,
        encounterId: doc.encounterId,
        generatedBy: doc.prescribedBy || 'system',
        generatedByName: doc.prescribedBy || 'Prescriber',
        // Admin-role scope over the prescribing facility: the fee schedule is
        // an org-level catalogue, and this runs on behalf of the facility
        // rather than of whoever happens to be signed in.
        scope: { orgId: doc.orgId, hospitalId: doc.hospitalId, role: 'org_admin' },
      },
      [{
        category: 'pharmacy' as const,
        // Exact product first; `priceFor` falls back to the catalogue's generic
        // dispensing fee when the facility has not priced this drug by name.
        serviceCode: doc.medication,
        description: doc.medication,
        quantity: doc.quantityToDispense && doc.quantityToDispense > 0 ? doc.quantityToDispense : 1,
        referenceId: doc._id,
        referenceType: 'prescription',
      }],
    );
  } catch (err) {
    console.warn('[prescription] could not bill the prescription (the order stands):', err);
  }
}

export async function createPrescription(
  data: Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<PrescriptionCreateResult> {
  // Validate required prescription fields
  const errors = validatePrescription(data as unknown as Record<string, unknown>);
  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  // Check for drug interactions with patient's active prescriptions
  let interactionWarnings: InteractionCheckResult | null = null;
  let duplicateWarnings: string[] | null = null;
  try {
    interactionWarnings = await checkPrescriptionInteractions(
      data.patientId,
      data.medication,
    );
    // Log serious interactions to the audit trail
    if (interactionWarnings.hasInteractions &&
        (interactionWarnings.highestSeverity === 'contraindicated' ||
         interactionWarnings.highestSeverity === 'serious')) {
      await logAuditSafe(
        'DRUG_INTERACTION_WARNING',
        undefined,
        data.prescribedBy,
        `${interactionWarnings.highestSeverity?.toUpperCase()} interaction detected: ` +
        `${data.medication} for patient ${data.patientName}. ` +
        `Interactions: ${interactionWarnings.interactions.map(i => `${i.drug1}↔${i.drug2}`).join(', ')}`
      );
    }
  } catch {
    // Drug interaction check is advisory — don't block prescription on failure
  }

  // Same-drug duplicate check against the patient's still-active orders.
  try {
    const activeRx = (await getPrescriptionsByPatient(data.patientId))
      .filter(rx => rx.status === 'pending')
      .map(rx => rx.medication);
    const dupes = findDuplicateMedications([...activeRx, data.medication]);
    duplicateWarnings = dupes.length ? dupes : null;
  } catch {
    // Advisory only.
  }

  // Drug–allergy check against the patient's recorded active allergies. This
  // checker existed but was never wired in, so a recorded severe penicillin
  // allergy raised nothing when amoxicillin was prescribed. Advisory like the
  // interaction check — but severe matches are audit-logged.
  let allergyWarnings: StructuredAllergyAlert[] | null = null;
  try {
    const { getActiveAllergies } = await import('./allergy-service');
    const active = await getActiveAllergies(data.patientId);
    const alerts = checkAllergiesStructured([data.medication], active);
    allergyWarnings = alerts.length ? alerts : null;
    if (alerts.some(a => a.requiresOverride)) {
      await logAuditSafe(
        'DRUG_ALLERGY_WARNING',
        undefined,
        data.prescribedBy,
        `Allergy alert: ${data.medication} for patient ${data.patientName} — ` +
        alerts.map(a => `${a.allergy} (${a.criticality})`).join(', ')
      );
    }
  } catch {
    // Advisory — a failed lookup must not block the prescription.
  }

  const db = prescriptionsDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgIdFromHospital(data.hospitalId);
  const doc: PrescriptionDoc = withPendingOfflineSync({
    _id: `rx-${uuidv4().slice(0, 8)}`,
    type: 'prescription',
    ...data,
    // Stamped at write time, not derived on read: the tier is what the queue
    // sorts on and what the checkout safety flag reads, and both must agree
    // with what the prescriber saw. A later formulary edit reclassifying a
    // drug must not silently retier orders already sitting in the queue.
    criticalityTier: resolvePrescriptionTier(data.medication, data.criticalityTier),
    orgId,
    createdAt: now,
    updatedAt: now,
  } as PrescriptionDoc, now);
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('PRESCRIPTION_CREATED', undefined, doc.prescribedBy,
    `Rx ${doc._id}: ${doc.medication} ${doc.dose} for ${doc.patientName}`
  );
  emitSyncEvent({
    resourceType: 'prescription',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    username: doc.prescribedBy,
    hospitalId: doc.hospitalId,
  });

  // Both of the following are best-effort and deliberately AFTER the write:
  // the prescription is the clinical act, and neither a pricing gap nor an
  // encounter in an unexpected state may cost the patient their medication.
  await parkVisitAtPharmacy(doc);
  await billPrescription(doc);

  return { prescription: doc, interactionWarnings, allergyWarnings, duplicateWarnings };
}

/**
 * Fetch a single prescription by id, or null if absent. Used by the
 * `/api/prescriptions/[id]` route to enforce tenant scope before mutating.
 */
export async function getPrescriptionById(id: string): Promise<PrescriptionDoc | null> {
  try {
    return await prescriptionsDB().get(id) as PrescriptionDoc;
  } catch {
    return null;
  }
}

export async function updatePrescription(id: string, data: Partial<PrescriptionDoc>): Promise<PrescriptionDoc | null> {
  const db = prescriptionsDB();
  try {
    const existing = await db.get(id) as PrescriptionDoc;
    const updated = withPendingOfflineSync({ ...existing, ...data, _id: existing._id, _rev: existing._rev, updatedAt: new Date().toISOString() });
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('PRESCRIPTION_UPDATED', undefined, undefined, `Prescription ${id} status: ${updated.status}`);
    emitSyncEvent({
      resourceType: 'prescription',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      hospitalId: updated.hospitalId,
    });
    return updated;
  } catch {
    return null;
  }
}

/**
 * @deprecated Do not call this from any UI or API surface, and do not add
 * new callers. It marks a prescription 'dispensed' with NO stock movement,
 * NO controlled-substance register entry, and NO actor/role check —
 * `dispenseMedication()` in dispensing-service.ts is the only sanctioned way
 * to dispense medication (stock gate, FEFO decrement, register, rollback on
 * failure, and — since the actor-authorization fix — a directory-verified
 * pharmacist).
 *
 * Confirmed (by grep) to have zero production callers: nothing under
 * src/app or src/components references it. Every real caller today is a
 * test fixture — src/__tests__/integration/{pharmacy-dispensing,
 * patient-journey,triage-to-discharge}.test.ts and
 * src/__tests__/services/{prescription-service,checkout-gate}.test.ts —
 * using it as a shortcut to fake an "already dispensed" prescription for
 * something else the test is actually exercising (billing, MAR, etc.),
 * predating dispenseMedication() existing at all.
 *
 * Intentionally NOT deleted or hardened to throw here: either would break
 * those five test files, which sit outside this change's scope (owned by
 * other in-flight work) and would need a real rewrite — cleared_for_dispensing
 * state, a matching in-stock batch, and a directory-verified pharmacist actor —
 * to go through dispenseMedication() instead. That rewrite is legitimate
 * follow-up work, not something to do opportunistically as a side effect of
 * closing the dispensing-authorization hole this file's other changes address.
 */
export async function dispensePrescription(id: string, dispensedBy?: string): Promise<PrescriptionDoc | null> {
  const now = new Date().toISOString();
  const result = await updatePrescription(id, {
    status: 'dispensed',
    orderStatus: 'dispensed',
    dispensedAt: now,
  });
  if (result) {
    await logAuditSafe('PRESCRIPTION_DISPENSED', undefined, dispensedBy || 'unknown',
      `Dispensed ${result.medication} ${result.dose} to ${result.patientName} (Rx: ${id})`
    );
  }
  return result;
}

// ===== Medication Administration Record (MAR) =====
//
// recordAdministration appends a new row to the prescription's
// administrations[] array. This is the legal bedside record of a nurse
// giving (or refusing/missing) one scheduled dose. Append-only — to
// correct an entry, append a new row with status='corrected'.

export interface AdministrationInput {
  prescriptionId: string;
  scheduledFor: string;          // ISO datetime of the scheduled dose
  status: MedicationAdministration['status'];
  doseGiven?: string;
  route?: string;
  administeredBy: string;
  administeredByName: string;
  witnessId?: string;
  witnessName?: string;
  reason?: string;
  notes?: string;
}

export async function recordAdministration(
  input: AdministrationInput,
): Promise<PrescriptionDoc | null> {
  const db = prescriptionsDB();
  try {
    const existing = await db.get(input.prescriptionId) as PrescriptionDoc;
    const now = new Date().toISOString();
    const entry: MedicationAdministration = {
      id: `madm-${uuidv4().slice(0, 8)}`,
      scheduledFor: input.scheduledFor,
      recordedAt: now,
      status: input.status,
      doseGiven: input.doseGiven || existing.dose,
      route: input.route || existing.route,
      administeredBy: input.administeredBy,
      administeredByName: input.administeredByName,
      witnessId: input.witnessId,
      witnessName: input.witnessName,
      reason: input.reason,
      notes: input.notes,
    };
    const next: PrescriptionDoc = withPendingOfflineSync({
      ...existing,
      administrations: [...(existing.administrations || []), entry],
      updatedAt: now,
    }, now);
    const resp = await db.put(next);
    next._rev = resp.rev;
    await logAuditSafe(
      'MEDICATION_ADMINISTERED',
      undefined,
      input.administeredByName,
      `${entry.status.toUpperCase()} ${existing.medication} ${entry.doseGiven} ` +
      `to ${existing.patientName} (Rx: ${existing._id})` +
      (entry.witnessName ? ` witnessed by ${entry.witnessName}` : ''),
    );
    emitSyncEvent({
      resourceType: 'prescription',
      resourceId: next._id,
      operation: 'update',
      resourceVersion: next._rev,
      hospitalId: next.hospitalId,
      orgId: next.orgId,
    });
    return next;
  } catch {
    return null;
  }
}

/**
 * Void a mis-recorded administration WITHOUT deleting it. The targeted
 * administrations[] entry is marked voided (append-only — history is
 * preserved), so the scheduled dose returns to due/overdue. Mirrors
 * recordAdministration's persistence + audit + sync pattern.
 */
export async function voidAdministration(
  prescriptionId: string,
  administrationId: string,
  voidedBy: string,
  voidedByName: string,
  reason: string,
): Promise<PrescriptionDoc | null> {
  const db = prescriptionsDB();
  try {
    const existing = await db.get(prescriptionId) as PrescriptionDoc;
    const now = new Date().toISOString();
    const target = (existing.administrations || []).find(a => a.id === administrationId);
    if (!target) return null;
    const next: PrescriptionDoc = withPendingOfflineSync({
      ...existing,
      administrations: (existing.administrations || []).map(a =>
        a.id === administrationId
          ? { ...a, voided: true, voidedAt: now, voidedBy, voidedReason: reason }
          : a,
      ),
      updatedAt: now,
    }, now);
    const resp = await db.put(next);
    next._rev = resp.rev;
    await logAuditSafe(
      'MEDICATION_ADMIN_VOIDED',
      undefined,
      voidedByName,
      `Voided ${target.status.toUpperCase()} ${existing.medication} ${target.doseGiven || existing.dose} ` +
      `for ${existing.patientName} (Rx: ${existing._id})${reason ? ` — ${reason}` : ''}`,
    );
    emitSyncEvent({
      resourceType: 'prescription',
      resourceId: next._id,
      operation: 'update',
      resourceVersion: next._rev,
      hospitalId: next.hospitalId,
      orgId: next.orgId,
    });
    return next;
  } catch {
    return null;
  }
}

/**
 * Attach the medical record that documents this prescription.
 *
 * Called after the consultation's record is written — the prescriptions are
 * created first, so `medicalRecordId` cannot be set at creation time. Closing
 * the link here is what lets a dispensed drug be traced back to the diagnosis
 * that justified it, which is what billing and controlled-substance audits ask
 * for. `encounterId` is already set at creation.
 *
 * Idempotent and non-fatal: re-linking the same record is a no-op, and a
 * missing prescription returns null rather than throwing, because the caller
 * treats this as a best-effort step after the visit has already been saved.
 */
export async function linkPrescriptionToRecord(
  prescriptionId: string,
  medicalRecordId: string,
): Promise<PrescriptionDoc | null> {
  const db = prescriptionsDB();
  try {
    const existing = await db.get(prescriptionId) as PrescriptionDoc;
    if (existing.medicalRecordId === medicalRecordId) return existing;

    const now = new Date().toISOString();
    const next = withPendingOfflineSync({
      ...existing,
      medicalRecordId,
      updatedAt: now,
    } as PrescriptionDoc, now);
    const resp = await db.put(next);
    next._rev = resp.rev;
    emitSyncEvent({
      resourceType: 'prescription',
      resourceId: next._id,
      operation: 'update',
      resourceVersion: next._rev,
      hospitalId: next.hospitalId,
      orgId: next.orgId,
    });
    return next;
  } catch {
    return null;
  }
}
