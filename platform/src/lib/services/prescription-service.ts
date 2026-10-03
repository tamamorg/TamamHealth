import { prescriptionsDB, hospitalsDB } from '../db';
import { findByType } from './db-query';
import type { PrescriptionDoc, PrescriptionPatientCopy, UserRole, HospitalDoc } from '../db-types';
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
import { canRerouteToOutsidePharmacy } from '../prescription-script';
import { holdsVisitAtPharmacy, isOutsidePharmacyOrder } from '../pharmacy-workflow';
import {
  getAdministrationEvents,
  getAdministrationEventsForPrescriptions,
  mergeAdministrationEvents,
  recordAdministration as recordAdministrationEvent,
  voidAdministration as voidAdministrationEvent,
  type AdministrationInput,
} from './medication-administration-service';

import { getSettings } from '../settings/settings-store';
import { getRoleFlag } from '../settings/role-settings-store';
import { getUserById } from '@/modules/identity/services/user-service';

/**
 * Roles allowed to clear a medication order for dispensing — the one state
 * dispenseMedication() (dispensing-service.ts) trusts as its sole proof that
 * review already happened. Kept as its own constant here (rather than
 * imported from dispensing-service.ts) because that file already imports
 * from this one — importing it back would be circular.
 */
const CLEARANCE_ROLES: UserRole[] = ['pharmacist'];

/** Why an outside-pharmacy script cannot be worked or dispensed on site. */
export const OUTSIDE_PHARMACY_REFUSAL =
  'This prescription was issued for an outside pharmacy, and the patient holds the script. '
  + 'To dispense it here, ask the prescriber to renew it for this pharmacy.';

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

/** Machine-readable reason `advancePrescription` refused a clearance. */
export type PrescriptionClearanceErrorCode = 'ACTOR_NOT_FOUND' | 'NOT_A_PHARMACIST';

/**
 * Thrown by `advancePrescription` when a `cleared_for_dispensing` transition
 * is refused. `ACTOR_NOT_FOUND` is an infrastructure/lookup failure (neither
 * the local users store nor the API could resolve the signed-in actor at
 * all) — distinct from `NOT_A_PHARMACIST`, a real safety refusal (the actor
 * exists but is inactive or holds the wrong role). Collapsing the two used to
 * mean a pharmacist got the same wording whether the offline caching layer
 * ate their session or they genuinely lacked permission, and a raw fetch
 * error from an unreachable `/api/users` could surface as neither.
 */
export class PrescriptionClearanceError extends Error {
  constructor(message: string, public readonly code: PrescriptionClearanceErrorCode) {
    super(message);
    this.name = 'PrescriptionClearanceError';
  }
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
 *
 * The actor lookup (`getUserById`) is itself local-first in the browser (the
 * PouchDB users store, not a network round trip) precisely so this check
 * keeps working when the API is unreachable — see the browser branch of
 * `getUserById`. If neither the local store nor the API can resolve the
 * actor at all, that is reported as `ACTOR_NOT_FOUND` rather than refusing
 * with the same wording a genuine non-pharmacist gets, and never as a raw
 * fetch/JSON error escaping this function.
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
  // The patient is holding a signed script for this order. Moving it through
  // this facility's dispensing stages as well would supply the course twice.
  if (existing.fulfilment === 'external' && from !== to) {
    throw new Error(OUTSIDE_PHARMACY_REFUSAL);
  }
  if (to === 'cleared_for_dispensing') {
    const actor = actorId ? await getUserById(actorId) : null;
    if (!actor) {
      throw new PrescriptionClearanceError(
        'Could not verify the signed-in pharmacist. Check your connection and try again.',
        'ACTOR_NOT_FOUND',
      );
    }
    if (actor.isActive === false || !CLEARANCE_ROLES.includes(actor.role)) {
      throw new PrescriptionClearanceError(
        'Only a pharmacist may clear a medication order for dispensing.',
        'NOT_A_PHARMACIST',
      );
    }
  }
  return updatePrescription(id, { ...extra, orderStatus: to, status: coarseFromRxStatus(to) });
}

export async function getAllPrescriptions(scope?: DataScope): Promise<PrescriptionDoc[]> {
  const db = prescriptionsDB();
  const all = await findByType<PrescriptionDoc>(db, 'prescription');
  const events = await getAdministrationEvents(scope);
  const eventsByPrescription = new Map<string, typeof events>();
  for (const event of events) {
    const rows = eventsByPrescription.get(event.prescriptionId) || [];
    rows.push(event);
    eventsByPrescription.set(event.prescriptionId, rows);
  }
  for (const prescription of all) {
    const prescriptionEvents = eventsByPrescription.get(prescription._id) || [];
    if (prescriptionEvents.length > 0) prescription.administrations = mergeAdministrationEvents(prescription.administrations, prescriptionEvents);
  }
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getPrescriptionsByPatient(patientId: string, scope?: DataScope): Promise<PrescriptionDoc[]> {
  const rows = await findByType<PrescriptionDoc>(
    prescriptionsDB(),
    'prescription',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  const visible = scope ? filterByScope(rows, scope) : rows;
  const events = await getAdministrationEventsForPrescriptions(visible.map(row => row._id), scope);
  const eventsByPrescription = new Map<string, typeof events>();
  for (const event of events) {
    const prescriptionEvents = eventsByPrescription.get(event.prescriptionId) || [];
    prescriptionEvents.push(event);
    eventsByPrescription.set(event.prescriptionId, prescriptionEvents);
  }
  for (const prescription of visible) {
    const prescriptionEvents = eventsByPrescription.get(prescription._id) || [];
    if (prescriptionEvents.length > 0) {
      prescription.administrations = mergeAdministrationEvents(prescription.administrations, prescriptionEvents);
    }
  }
  return visible.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/**
 * Internal sentinel: a safety check the prescriber has switched off. Thrown to
 * leave the surrounding try/catch — which already treats every failure as
 * "advisory check unavailable" — rather than duplicating the block.
 */
class SkipCheck extends Error {}

/**
 * Is the facility's "Allergy hard stop" switched on?
 *
 * Reads the facility's own `facility_settings` document, falling back to the
 * in-memory store. The store is hydrated in the browser and holds defaults on
 * the server, so asking it alone made the policy client-dependent: a hard stop
 * a facility had enabled was enforced in the app and ignored by
 * `/api/prescriptions`. Asking the facility means both paths get the same
 * answer, and a clinician prescribing for a patient at another site gets THAT
 * site's policy rather than their own.
 *
 * Failure is not a refusal: an unreadable settings document leaves the
 * advisory behaviour in place rather than blocking care.
 */
/**
 * Whether the facility an order is written at runs its own dispensary
 * (`clinicalPolicy.onSitePharmacy`). Asked of the facility's settings document
 * for the same reason the allergy policy is; an unreadable document leaves the
 * long-standing behaviour — an on-site pharmacy — in place.
 */
async function onSitePharmacyAvailable(hospitalId?: string): Promise<boolean> {
  if (hospitalId) {
    try {
      const { getFacilitySettings } = await import('../settings/settings-service');
      return (await getFacilitySettings(hospitalId)).clinicalPolicy.onSitePharmacy !== false;
    } catch { /* fall through to the in-memory store */ }
  }
  try {
    return getSettings().clinicalPolicy.onSitePharmacy !== false;
  } catch {
    return true;
  }
}

async function allergyHardStopEnabled(hospitalId?: string): Promise<boolean> {
  if (hospitalId) {
    try {
      const { getFacilitySettings } = await import('../settings/settings-service');
      return (await getFacilitySettings(hospitalId)).clinicalPolicy.allergyHardStop;
    } catch { /* fall through to the in-memory store */ }
  }
  try {
    return getSettings().clinicalPolicy.allergyHardStop;
  } catch {
    return false;
  }
}

/**
 * A documented allergy blocked this order.
 *
 * Only thrown when the facility has "Allergy hard stop" enabled
 * (`clinicalPolicy.allergyHardStop`). With it off — the shipped default and
 * the platform's long-standing behaviour — the same match comes back as an
 * advisory `allergyWarnings` entry and the prescription is written.
 *
 * Callers should surface `message` to the prescriber; it names the drug and
 * the allergy so the refusal is actionable rather than mysterious.
 *
 * Enforced on BOTH paths. The policy is read from the facility's own
 * `facility_settings` document rather than only from the browser's hydrated
 * settings singleton — server-side that singleton holds the defaults, so an
 * API write (mobile, an integration, a cron job) used to sail past a hard stop
 * the facility had deliberately switched on. A safety control that only one
 * client honours is not a control.
 */
export class AllergyHardStopError extends Error {
  readonly alerts: StructuredAllergyAlert[];
  constructor(medication: string, alerts: StructuredAllergyAlert[]) {
    super(
      `${medication} is blocked by a documented allergy: ` +
      `${alerts.map(a => `${a.allergy} (${a.criticality})`).join(', ')}. ` +
      'Facility policy does not allow this to be overridden.',
    );
    this.name = 'AllergyHardStopError';
    this.alerts = alerts;
  }
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

  // Check for drug interactions with patient's active prescriptions.
  // "Interaction warnings" is the prescriber's own setting (`rx.interactions`)
  // — off means they do not want the prompt, so the check is skipped rather
  // than run and discarded.
  let interactionWarnings: InteractionCheckResult | null = null;
  let duplicateWarnings: string[] | null = null;
  try {
    if (!getRoleFlag('rx.interactions', true)) throw new SkipCheck();
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
  let allergyHardStop: StructuredAllergyAlert[] | null = null;
  try {
    if (!getRoleFlag('rx.allergyCheck', true)) throw new SkipCheck();
    const { getActiveAllergies } = await import('./allergy-service');
    const active = await getActiveAllergies(data.patientId);
    const alerts = checkAllergiesStructured([data.medication], active);
    allergyWarnings = alerts.length ? alerts : null;
    const overrides = alerts.filter(a => a.requiresOverride);
    if (overrides.length) {
      await logAuditSafe(
        'DRUG_ALLERGY_WARNING',
        undefined,
        data.prescribedBy,
        `Allergy alert: ${data.medication} for patient ${data.patientName} — ` +
        alerts.map(a => `${a.allergy} (${a.criticality})`).join(', ')
      );
      // Facility policy — "Allergy hard stop" turns the advisory alert into a
      // refusal. Collected here and thrown after the audit entry is written,
      // so a blocked order still leaves a record of why.
      if (await allergyHardStopEnabled(data.hospitalId)) allergyHardStop = overrides;
    }
  } catch (err) {
    // Advisory — a failed lookup must not block the prescription. A hard stop
    // is not a failure, so it is re-thrown rather than swallowed here.
    if (err instanceof AllergyHardStopError) throw err;
  }

  if (allergyHardStop) {
    throw new AllergyHardStopError(data.medication, allergyHardStop);
  }

  const db = prescriptionsDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgIdFromHospital(data.hospitalId);
  let admissionId = data.admissionId;
  // An outside-pharmacy script is for the patient to take away (discharge
  // medicines, say) — it is not a ward order and must not land on the MAR.
  if (!admissionId && data.hospitalId && data.fulfilment !== 'external') {
    // A medication ordered from the chart while the patient is admitted is an
    // inpatient order even when the generic prescribing modal did not know the
    // admission id. Resolve it once at write time so it appears on exactly one
    // MAR; never make the MAR guess from every pending outpatient prescription.
    try {
      const { getActiveAdmissions } = await import('./admission-query-service');
      admissionId = (await getActiveAdmissions()).find(admission =>
        admission.patientId === data.patientId
        && admission.facilityId === data.hospitalId
        && (!orgId || admission.orgId === orgId)
      )?._id;
    } catch { /* an outpatient order remains outpatient when the ward store is unavailable */ }
  }
  // At a facility with no dispensary an outpatient order can only ever be a
  // script the patient takes away. Decided here, not in one dialog, because
  // orders are written from several screens (the quick prescribe form, a
  // renewal, the note's medication list) and every one of them would
  // otherwise create an order for a queue nobody works — invisible to the
  // patient and a permanent hold on checkout. Ward orders (an admission) are
  // administered from ward stock and stay as they are.
  const external = data.fulfilment === 'external'
    || (!data.fulfilment && !admissionId && !(await onSitePharmacyAvailable(data.hospitalId)));
  const doc: PrescriptionDoc = withPendingOfflineSync({
    _id: `rx-${uuidv4()}`,
    type: 'prescription',
    ...data,
    ...(external ? { fulfilment: 'external' as const, orderStatus: 'prescribed' as const } : {}),
    // Stamped at write time, not derived on read: the tier is what the queue
    // sorts on and what the checkout safety flag reads, and both must agree
    // with what the prescriber saw. A later formulary edit reclassifying a
    // drug must not silently retier orders already sitting in the queue.
    criticalityTier: resolvePrescriptionTier(data.medication, data.criticalityTier),
    admissionId,
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
  //
  // Neither applies to an outside-pharmacy script. It is not this pharmacy's
  // work, so parking the visit would hold it for a dispense that cannot happen
  // here; and it is not this facility's sale, so billing it would charge the
  // patient for a medicine they buy elsewhere — a balance the checkout gate
  // then waits on.
  if (!isOutsidePharmacyOrder(doc)) {
    await parkVisitAtPharmacy(doc);
    await billPrescription(doc);
  }

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

/** Write one change to a prescription, re-reading on a revision conflict. */
async function amendPrescription(
  id: string,
  change: (existing: PrescriptionDoc) => Partial<PrescriptionDoc> | null,
): Promise<PrescriptionDoc | null> {
  const db = prescriptionsDB();
  for (let attempt = 0; attempt < 5; attempt++) {
    let existing: PrescriptionDoc;
    try {
      existing = await db.get(id) as PrescriptionDoc;
    } catch {
      return null;
    }
    const patch = change(existing);
    if (!patch) return existing;
    const updated = withPendingOfflineSync({ ...existing, ...patch, updatedAt: new Date().toISOString() });
    try {
      const resp = await db.put(updated);
      updated._rev = resp.rev;
      emitSyncEvent({
        resourceType: 'prescription',
        resourceId: updated._id,
        operation: 'update',
        resourceVersion: updated._rev,
        hospitalId: updated.hospitalId,
        orgId: updated.orgId,
      });
      return updated;
    } catch (err) {
      // The pharmacy and the prescriber can both be writing the same order.
      if ((err as { status?: number }).status === 409 && attempt < 4) continue;
      throw err;
    }
  }
  return null;
}

/**
 * Turn an on-site order into a script the patient fills at an outside
 * pharmacy — the shelf could not fill it, or the patient prefers their own
 * pharmacy. Refused (the order is returned unchanged) once the order is on a
 * pharmacist's bench; see `canRerouteToOutsidePharmacy`.
 */
export async function rerouteToOutsidePharmacy(
  id: string,
  actor: { id?: string; name: string },
): Promise<PrescriptionDoc | null> {
  let rerouted = false;
  const updated = await amendPrescription(id, existing => {
    if (existing.fulfilment === 'external' || !canRerouteToOutsidePharmacy(existing)) return null;
    rerouted = true;
    // A copy may already have been given while the order was still on-site
    // (a text is recorded when the gateway accepts it, which can precede this
    // write). That copy is the handover, so it counts from when it was given.
    const firstCopy = existing.patientCopies?.[0];
    return {
      fulfilment: 'external',
      ...(firstCopy ? {
        issuedToPatientAt: existing.issuedToPatientAt || firstCopy.at,
        issuedToPatientBy: existing.issuedToPatientBy || firstCopy.byName,
      } : {}),
    };
  });
  if (updated && rerouted) {
    await logAuditSafe('PRESCRIPTION_REROUTED', actor.id, actor.name,
      `Rx ${id}: ${updated.medication} — to be filled at an outside pharmacy`);
    // The order was written as on-site, so it was billed and the visit was
    // parked at the pharmacy. Neither holds once the patient takes it away.
    await cancelPrescriptionCharge(updated, actor);
    await releaseVisitFromPharmacy(updated, actor.id);
  }
  return updated;
}

/**
 * Reverse the pharmacy charge raised when an order was written, for an order
 * that is now filled outside the facility. Each prescription is billed on its
 * own invoice (`billPrescription`), so that invoice is cancelled — which the
 * billing service refuses once any payment has been taken, leaving a paid
 * charge for the cashier to refund rather than silently rewriting money.
 * Best-effort: the re-route is the clinical fact and stands regardless.
 */
async function cancelPrescriptionCharge(rx: PrescriptionDoc, actor: { id?: string; name: string }): Promise<void> {
  try {
    const { getBillsByPatient, cancelBill } = await import('./billing-service');
    const bills = await getBillsByPatient(rx.patientId);
    for (const bill of bills) {
      const isThisOrder = bill.items.length > 0 && bill.items.every(
        item => item.referenceType === 'prescription' && item.referenceId === rx._id);
      if (!isThisOrder) continue;
      await cancelBill(bill._id, actor.id || actor.name, actor.name, 'Prescription sent to an outside pharmacy');
    }
  } catch (err) {
    console.warn('[prescription] could not cancel the charge for a re-routed order:', err);
  }
}

/**
 * Move a visit on from `awaiting_pharmacy` when nothing is left for this
 * pharmacy to fill and the note is signed — the same closing move a final
 * dispense makes (`advanceEncounterAfterPharmacyClear`), reached here because
 * the last on-site order was sent out with the patient instead. A visit with
 * another order still to dispense, or an unsigned note, stays where it is;
 * signing the note later makes the same check.
 */
async function releaseVisitFromPharmacy(rx: PrescriptionDoc, actorId?: string): Promise<void> {
  if (!rx.encounterId) return;
  try {
    const { getEncounter, transitionEncounter } = await import('./encounter-service');
    const encounter = await getEncounter(rx.encounterId);
    if (!encounter || encounter.status !== 'awaiting_pharmacy') return;

    const rxs = await getPrescriptionsByPatient(rx.patientId);
    if (rxs.some(other => other.encounterId === rx.encounterId && holdsVisitAtPharmacy(other))) return;

    const { getNotesByPatient } = await import('../clinical-notes/note-service');
    const notes = await getNotesByPatient(rx.patientId);
    const signed = notes.some(note =>
      note.encounterId === rx.encounterId && (note.status === 'signed' || note.status === 'amended'));
    if (!signed) return;

    await transitionEncounter(rx.encounterId, 'ready_for_clinic_checkout', { actorId });
  } catch (err) {
    console.warn('[prescription] could not release the visit from the pharmacy stage:', err);
  }
}

/**
 * Record that a copy of the prescription was given to the patient — printed or
 * texted. For a script the patient fills outside the facility this is the
 * handover itself: it stamps `issuedToPatientAt`, which is what releases the
 * order from the checkout gate.
 *
 * A texted copy is recorded once per message: a retried send must not log the
 * same text twice.
 */
export async function recordPrescriptionPatientCopy(
  id: string,
  copy: PrescriptionPatientCopy,
): Promise<PrescriptionDoc | null> {
  let recorded = false;
  const updated = await amendPrescription(id, existing => {
    const copies = existing.patientCopies || [];
    if (copy.messageId && copies.some(c => c.messageId === copy.messageId)) return null;
    recorded = true;
    const external = existing.fulfilment === 'external';
    return {
      patientCopies: [...copies, copy],
      issuedToPatientAt: external ? (existing.issuedToPatientAt || copy.at) : existing.issuedToPatientAt,
      issuedToPatientBy: external ? (existing.issuedToPatientBy || copy.byName) : existing.issuedToPatientBy,
    };
  });
  if (updated && recorded) {
    await logAuditSafe('PRESCRIPTION_COPY_GIVEN', copy.byId, copy.byName,
      `Rx ${id}: ${updated.medication} — ${copy.channel === 'sms' ? 'texted to' : 'printed for'} the patient`
      + (updated.fulfilment === 'external' ? ' (outside pharmacy)' : ''));
  }
  return updated;
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
// Each administration/correction is persisted as an independent append-only
// document. These wrappers keep the existing service API while returning the
// refreshed prescription projection expected by older callers.
export type { AdministrationInput } from './medication-administration-service';
export { MedicationAdministrationError } from './medication-administration-service';

export async function recordAdministration(input: AdministrationInput): Promise<PrescriptionDoc> {
  await recordAdministrationEvent(input);
  const refreshed = await prescriptionsDB().get(input.prescriptionId) as PrescriptionDoc;
  const events = await getAdministrationEvents();
  refreshed.administrations = mergeAdministrationEvents(
    refreshed.administrations,
    events.filter(event => event.prescriptionId === refreshed._id),
  );
  return refreshed;
}

export async function voidAdministration(
  prescriptionId: string,
  administrationId: string,
  voidedBy: string,
  voidedByName: string,
  reason: string,
): Promise<PrescriptionDoc> {
  await voidAdministrationEvent(prescriptionId, administrationId, voidedBy, voidedByName, reason);
  const refreshed = await prescriptionsDB().get(prescriptionId) as PrescriptionDoc;
  const events = await getAdministrationEvents();
  refreshed.administrations = mergeAdministrationEvents(
    refreshed.administrations,
    events.filter(event => event.prescriptionId === prescriptionId),
  );
  return refreshed;
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
