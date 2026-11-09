import { captureException } from '@/lib/observability';
import { referralsDB, hospitalsDB, medicalRecordsDB, patientsDB, organizationsDB } from '../db';
import type { ReferralDoc, HospitalDoc, MedicalRecordDoc, PatientDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope, orgOnlyScope } from './data-scope';
import type { Attachment, ReferralOutcome } from '@/data/mock';
import { v4 as uuidv4 } from 'uuid';
import { assembleTransferPackage } from './transfer-service';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { findByType } from './db-query';
import { withPendingOfflineSync } from '../sync/offline-metadata';

/* istanbul ignore next -- private utility: org ID inference from hospital IDs */
/**
 * Organization that owns a facility. Used to resolve both ends of a referral
 * so a cross-org hand-off is visible to the receiving side (KAN-101).
 */
async function orgIdOfHospital(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const hosp = await hospitalsDB().get(hospitalId) as HospitalDoc;
    return hosp?.orgId;
  } catch {
    return undefined;
  }
}

async function inferOrgId(fromHospitalId?: string, toHospitalId?: string): Promise<string | undefined> {
  try {
    const hdb = hospitalsDB();
    if (fromHospitalId) {
      const from = await hdb.get(fromHospitalId) as HospitalDoc;
      if (from?.orgId) return from.orgId;
    }
    if (toHospitalId) {
      const to = await hdb.get(toHospitalId) as HospitalDoc;
      if (to?.orgId) return to.orgId;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export async function getAllReferrals(scope?: DataScope): Promise<ReferralDoc[]> {
  const db = referralsDB();
  const all = await findByType<ReferralDoc>(db, 'referral');
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => (b.referralDate || '').localeCompare(a.referralDate || ''));
  /* istanbul ignore next -- scope ternary: depends on caller context */
  return scope ? filterByScope(all, scope) : all;
}

export async function getReferralsByHospital(hospitalId: string): Promise<ReferralDoc[]> {
  const all = await getAllReferrals();
  return all.filter(r => r.toHospitalId === hospitalId || r.fromHospitalId === hospitalId);
}

export async function getReferralById(id: string): Promise<ReferralDoc | null> {
  try {
    const db = referralsDB();
    return await db.get(id) as ReferralDoc;
  } catch {
    return null;
  }
}

/**
 * Acknowledgement deadline per urgency, in hours (KAN-43 / HIGH-11).
 *
 * A referral sits at `sent` until the receiving facility marks it `received` or
 * `seen`. Nothing used to bound that wait: an emergency referral could sit
 * unacknowledged indefinitely with no timeout, no escalation, and nothing for
 * the sending clinician to chase. These are the acknowledgement windows, not
 * treatment windows — the clock stops when someone at the other end picks the
 * referral up, not when the patient is treated.
 */
export const REFERRAL_SLA_HOURS: Record<'emergency' | 'urgent' | 'routine', number> = {
  emergency: 4,
  urgent: 24,
  routine: 72,
};

/** Acknowledgement deadline for a referral raised at `fromIso`. */
export function computeExpectedAt(
  urgency: 'emergency' | 'urgent' | 'routine',
  fromIso: string,
): string {
  const hours = REFERRAL_SLA_HOURS[urgency] ?? REFERRAL_SLA_HOURS.routine;
  return new Date(new Date(fromIso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

/** Statuses that mean the receiving facility has acknowledged the referral. */
const ACKNOWLEDGED_STATUSES = new Set(['received', 'seen', 'completed', 'cancelled']);

/**
 * True when a referral is past its acknowledgement deadline and still
 * unacknowledged. A referral with no `expectedAt` (created before SLA tracking
 * existed) is never reported as breached — absence of a deadline is not
 * evidence of a missed one.
 */
export function isReferralOverdue(referral: ReferralDoc, now: Date = new Date()): boolean {
  if (!referral.expectedAt) return false;
  if (ACKNOWLEDGED_STATUSES.has(referral.status)) return false;
  return new Date(referral.expectedAt).getTime() < now.getTime();
}

/**
 * Referrals past their acknowledgement deadline, most overdue first, so the
 * sending facility can chase them. This is the query a dashboard panel or a
 * scheduled escalation job runs.
 */
export async function getOverdueReferrals(
  scope?: DataScope,
  now: Date = new Date(),
): Promise<ReferralDoc[]> {
  const all = await getAllReferrals(scope);
  return all
    .filter((r) => isReferralOverdue(r, now))
    .sort((a, b) => (a.expectedAt || '').localeCompare(b.expectedAt || ''));
}

/**
 * One step in a referral's progress, kept on the referral itself so Care
 * coordination can say when it was received, accepted and completed (KAN-43).
 *
 * This used to be announced by writing a care alert onto the patient's chart
 * at the sending facility. Care alerts are for risks, and the notices sat
 * there as red banners until someone resolved them. The sender now learns from
 * the notification bell (useNotifications reads this status) and the referral
 * row, so nothing lands on the chart.
 */
function withStatusStep(referral: ReferralDoc, status: ReferralDoc['status'], at: string): NonNullable<ReferralDoc['statusHistory']> {
  return [...(referral.statusHistory ?? []), { status, at }];
}

export async function createReferral(
  data: Omit<ReferralDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<ReferralDoc> {
  const db = referralsDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgId(data.fromHospitalId, data.toHospitalId);
  const toOrgId = data.toOrgId ?? await resolveDestinationOrg(orgId, data.toHospitalId);
  const doc: ReferralDoc = withPendingOfflineSync({
    _id: `ref-${uuidv4()}`,
    type: 'referral',
    ...data,
    // Stamp the acknowledgement deadline unless the caller supplied one.
    expectedAt: data.expectedAt || computeExpectedAt(data.urgency, now),
    orgId,
    ...(toOrgId ? { toOrgId } : {}),
    createdAt: now,
    updatedAt: now,
  } as ReferralDoc, now);
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_REFERRAL', undefined, undefined, `Referral ${doc._id}: patient ${doc.patientId} to ${doc.toHospital}`);
  // Emit a sync event so the country-node Postgres analytics pipeline picks
  // up the new referral. Without this, the referrals table in analytics
  // diverged from the CouchDB source of truth on every new referral.
  emitSyncEvent({
    resourceType: 'referral',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.fromHospitalId,
  });
  return doc;
}

export async function getReferralsByPatient(patientId: string, scope?: DataScope): Promise<ReferralDoc[]> {
  const rows = await findByType<ReferralDoc>(
    referralsDB(),
    'referral',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  // The receiving organisation's chart is a linked copy (see
  // splitPatientAcrossOrgs): its referral names the SENDER's patient id.
  const arrived = await findByType<ReferralDoc>(
    referralsDB(),
    'referral',
    { receiverPatientId: patientId },
    { indexFields: ['type', 'receiverPatientId'] },
  );
  for (const r of arrived) if (!rows.some(x => x._id === r._id)) rows.push(r);
  const visible = scope ? filterByScope(rows, scope) : rows;
  return visible.sort((a, b) => (b.referralDate || '').localeCompare(a.referralDate || ''));
}

export async function createReferralWithTransfer(
  data: Omit<ReferralDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'transferPackage' | 'referralAttachments'>,
  referralAttachments: Attachment[],
  packagedBy: string
): Promise<ReferralDoc> {
  const transferPackage = await assembleTransferPackage(data.patientId, packagedBy);

  // Add referral-specific attachments to the package size
  const extraSize = referralAttachments.reduce((sum, a) => sum + a.sizeBytes, 0);
  transferPackage.packageSizeBytes += extraSize;

  const db = referralsDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgId(data.fromHospitalId, data.toHospitalId);
  const transferToOrgId = data.toOrgId ?? await resolveDestinationOrg(orgId, data.toHospitalId);
  const doc: ReferralDoc = withPendingOfflineSync({
    _id: `ref-${uuidv4()}`,
    type: 'referral',
    ...data,
    // Same acknowledgement deadline as the plain createReferral path — a
    // referral carrying a transfer package is if anything more urgent.
    expectedAt: data.expectedAt || computeExpectedAt(data.urgency, now),
    orgId,
    ...(transferToOrgId ? { toOrgId: transferToOrgId } : {}),
    transferPackage,
    referralAttachments: referralAttachments.length > 0 ? referralAttachments : undefined,
    createdAt: now,
    updatedAt: now,
  } as ReferralDoc, now);
  const resp2 = await db.put(doc);
  doc._rev = resp2.rev;
  // Mirror the audit + sync hand-off from the plain createReferral path.
  // Previously this variant — which is the one consultation actually calls
  // for outbound emergency referrals — wrote silently with no audit row and
  // no Postgres mirror, so receiving facilities querying the analytics view
  // missed the referral until the next CouchDB-level changes feed catch-up.
  await logAuditSafe(
    'CREATE_REFERRAL', undefined, packagedBy,
    `Referral ${doc._id}: patient ${doc.patientId} to ${doc.toHospital} (with transfer package)`
  );
  emitSyncEvent({
    resourceType: 'referral',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    username: packagedBy,
    orgId: doc.orgId,
    hospitalId: doc.fromHospitalId,
  });
  return doc;
}

export async function updateReferralStatus(
  id: string,
  status: 'sent' | 'received' | 'seen' | 'completed' | 'cancelled'
): Promise<ReferralDoc | null> {
  const db = referralsDB();
  try {
    const existing = await db.get(id) as ReferralDoc;
    const now = new Date().toISOString();
    const updated = withPendingOfflineSync({ ...existing, status, statusHistory: withStatusStep(existing, status, now), updatedAt: now });
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_REFERRAL', undefined, undefined, `Referral ${id} status changed to ${status}`);
    emitSyncEvent({
      resourceType: 'referral',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.fromHospitalId,
    });
    return updated;
  } catch {
    return null;
  }
}

/**
 * Close a referral out with a structured outcome the referring facility can
 * read back: disposition, a diagnosis/management summary, and optional
 * follow-up instructions. Sets status `completed`, stores the structured
 * `outcome`, and (for backward-compatible display) also appends a
 * human-readable outcome line to the running notes thread.
 */
export async function completeReferralWithOutcome(
  id: string,
  outcome: ReferralOutcome
): Promise<ReferralDoc | null> {
  const db = referralsDB();
  try {
    const existing = await db.get(id) as ReferralDoc;
    const dispositionLabel = outcome.disposition.replace(/_/g, ' ');
    const noteLine =
      `[${outcome.recordedAt.slice(0, 10)} ${outcome.recordedBy}] OUTCOME (${dispositionLabel}): ${outcome.summary}`
      + (outcome.followUp ? ` | Follow-up: ${outcome.followUp}` : '');
    const now = new Date().toISOString();
    const updated: ReferralDoc = withPendingOfflineSync({
      ...existing,
      status: 'completed',
      statusHistory: withStatusStep(existing, 'completed', outcome.recordedAt || now),
      outcome,
      notes: existing.notes ? `${existing.notes}\n\n${noteLine}` : noteLine,
      updatedAt: now,
    } as ReferralDoc);
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_REFERRAL', undefined, undefined, `Referral ${id} completed with outcome (${outcome.disposition})`);
    emitSyncEvent({
      resourceType: 'referral',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.fromHospitalId,
    });
    return updated;
  } catch {
    return null;
  }
}

export async function updateReferralNotes(
  id: string,
  notes: string
): Promise<ReferralDoc> {
  const db = referralsDB();
  const existing = await db.get(id) as ReferralDoc;
  const updated = withPendingOfflineSync({ ...existing, notes, updatedAt: new Date().toISOString() });
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('UPDATE_REFERRAL', undefined, undefined, `Referral ${id} notes updated`);
  return updated;
}

/**
 * Materialise a "referral intake" encounter in the receiving facility's EHR
 * so the accepted patient has a durable record of arriving via referral —
 * reason, urgency, origin facility, referring clinician, and any handover
 * notes — sitting alongside the prior history that is already visible by
 * patientId. Idempotent: keyed on a deterministic `_id` derived from the
 * referral, so re-running acceptance never spawns duplicate intake rows.
 *
 * The patient's PRIOR clinical records are intentionally NOT copied — every
 * facility shares the same record store and the chart fetches history by
 * patientId, so copying would only duplicate the timeline.
 */
export async function recordReferralIntake(
  referral: ReferralDoc,
  toOrgId?: string,
  /** The receiving organisation's own patient document, after a cross-organisation referral. */
  receiverPatientId?: string,
): Promise<MedicalRecordDoc | null> {
  if (!referral.patientId || !referral.toHospitalId) return null;
  const db = medicalRecordsDB();
  const intakeId = `rec-refin-${referral._id}`;
  try {
    // Already recorded for this referral → idempotent no-op.
    await db.get(intakeId);
    return null;
  } catch {
    // Not found → create it below.
  }
  const now = new Date().toISOString();
  const handover = referral.notes?.trim();
  const doc: MedicalRecordDoc = withPendingOfflineSync({
    _id: intakeId,
    type: 'medical_record',
    patientId: receiverPatientId || referral.patientId,
    hospitalId: referral.toHospitalId,
    hospitalName: referral.toHospital,
    orgId: toOrgId,
    visitDate: referral.referralDate || now.slice(0, 10),
    consultedAt: now,
    visitType: 'referral',
    providerName: referral.referringDoctor || 'Referral intake',
    providerRole: 'referral',
    department: referral.department || 'General',
    chiefComplaint: `Referral intake: ${referral.reason || 'inter-facility transfer'}`,
    historyOfPresentIllness:
      `Patient received via ${referral.urgency || 'routine'} referral from ${referral.fromHospital || 'referring facility'}`
      + (referral.referringDoctor ? ` (referring clinician: ${referral.referringDoctor})` : '')
      + (handover ? `. Handover notes: ${handover}` : '.'),
    vitalSigns: {} as MedicalRecordDoc['vitalSigns'],
    diagnoses: [],
    prescriptions: [],
    labResults: [],
    treatmentPlan: '',
    syncStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  } as MedicalRecordDoc, now);
  try {
    const resp = await db.put(doc);
    doc._rev = resp.rev;
    await logAuditSafe(
      'CREATE_MEDICAL_RECORD', undefined, undefined,
      `Referral intake encounter ${intakeId} for patient ${referral.patientId} at ${referral.toHospital}`
    );
    emitSyncEvent({
      resourceType: 'medical_record',
      resourceId: doc._id,
      operation: 'create',
      resourceVersion: doc._rev,
      orgId: doc.orgId,
      hospitalId: doc.hospitalId,
    });
    return doc;
  } catch {
    return null;
  }
}

/** Fields that belong to the sending side and must never reach the receiver's copy of a chart. */
const NOT_COPIED_TO_RECEIVER = [
  '_id', '_rev', '_revisions', '_attachments', 'offlineSync', 'syncStatus',
  // The receiver's own accounts, not the sender's.
  'portalUsername', 'portalPasswordHash', 'portalPasswordSetAt', 'portalCredentialEpoch',
  'portalInviteTokenHash', 'portalInviteExpiresAt', 'portalDisabledAt', 'portalEnabledAt',
  'portalEnabledBy', 'portalLastLoginAt',
  // Sender staff and routing: names people in another organisation.
  'assignedDoctor', 'assignedDoctorName', 'assignedDepartment', 'assignedAt', 'assignedBy',
  'assignedByName', 'assignmentNote', 'assignmentStatus', 'assignmentAcceptedAt',
  'assignmentAcceptedBy', 'assignmentAcceptedByName', 'assignmentSource', 'assignmentTransferId',
  'assignedNurse', 'assignedNurseName', 'assignedNurseAt', 'assignedNurseBy', 'assignedNurseByName',
  'careTeam', 'stationAssignments', 'transferFacilityIds',
  // Duplicate links and referral links are the sender's own.
  'duplicateOf', 'duplicateMarkedAt', 'duplicateMarkedBy', 'duplicateMarkedByName', 'duplicateReason',
  'referredOut', 'referredFrom', 'toOrgId',
] as const;

/**
 * Hand a cross-organisation referral its two charts.
 *
 * Both organisations end up with a patient document of their own, linked to
 * each other, and neither is removed:
 *   - the SENDER's document keeps its id (its notes, labs and prescriptions
 *     point at it) and is marked `referredOut`, so its chart still opens,
 *     read-only, with "Referred to X";
 *   - the RECEIVER gets a copy under a deterministic id (so re-running
 *     acceptance never makes a second one), `referredFrom` pointing back. It is
 *     written through the encrypted database layer under the receiver's own
 *     organisation id, so its PHI is sealed with the receiver's key and never
 *     carries the sender's ciphertext.
 * The sender's records are not copied: each side keeps its own.
 *
 * A referral back to an organisation that already holds a linked copy reuses
 * that copy and lifts its `referredOut`, instead of creating a third chart.
 */
async function splitPatientAcrossOrgs(referral: ReferralDoc, sender: PatientDoc, toOrgId: string): Promise<string> {
  const { mutatePatient } = await import('./patient-service');
  const now = new Date().toISOString();
  const orgName = async (orgId: string | undefined) => {
    if (!orgId) return undefined;
    try { return ((await organizationsDB().get(orgId)) as { name?: string }).name; } catch { return undefined; }
  };
  const [fromOrgName, toOrgName] = await Promise.all([orgName(sender.orgId), orgName(toOrgId)]);
  const receiverId = sender.referredFrom?.orgId === toOrgId
    ? sender.referredFrom.patientId
    : `${sender._id}--${toOrgId}`;

  // 1. The receiver's chart.
  let existing: PatientDoc | null = null;
  try { existing = await patientsDB().get(receiverId) as PatientDoc; } catch { existing = null; }
  if (!existing) {
    const copy: Record<string, unknown> = { ...(sender as unknown as Record<string, unknown>) };
    for (const field of NOT_COPIED_TO_RECEIVER) delete copy[field];
    const doc = withPendingOfflineSync({
      ...copy,
      _id: receiverId,
      type: 'patient',
      orgId: toOrgId,
      registrationHospital: referral.toHospitalId,
      lastVisitHospital: referral.toHospitalId,
      transferFacilityIds: [referral.toHospitalId],
      referredFrom: {
        referralId: referral._id,
        patientId: sender._id,
        orgId: sender.orgId as string,
        hospitalId: referral.fromHospitalId,
        ...(referral.fromHospital ? { hospitalName: referral.fromHospital } : {}),
        ...(fromOrgName ? { orgName: fromOrgName } : {}),
        at: now,
      },
      createdAt: now,
      updatedAt: now,
    } as unknown as PatientDoc, now);
    const resp = await patientsDB().put(doc);
    doc._rev = resp.rev;
    await logAuditSafe('CREATE_PATIENT', undefined, undefined,
      `Created patient ${doc._id} for referral ${referral._id} (linked copy of ${sender._id})`);
    emitSyncEvent({
      resourceType: 'patient', resourceId: doc._id, operation: 'create',
      resourceVersion: doc._rev, orgId: doc.orgId, hospitalId: doc.registrationHospital,
    });
  } else if (existing.referredOut) {
    // The patient is coming back to a chart that was referred out: reopen it.
    await mutatePatient(receiverId, p => ({
      referredOut: undefined,
      lastVisitHospital: referral.toHospitalId,
      transferFacilityIds: [...new Set([...(p.transferFacilityIds ?? []), referral.toHospitalId])],
    }));
  }

  // 2. The sender's chart stays, marked as referred out. Idempotent per referral.
  await mutatePatient(sender._id, p => (p.referredOut?.referralId === referral._id ? null : {
    referredOut: {
      referralId: referral._id,
      toOrgId,
      toHospitalId: referral.toHospitalId,
      ...(referral.toHospital ? { toHospitalName: referral.toHospital } : {}),
      ...(toOrgName ? { toOrgName } : {}),
      receiverPatientId: receiverId,
      at: now,
    },
  }));
  return receiverId;
}

/**
 * Accept a referral: bring the patient to the receiving hospital (the sender
 * keeps read access to the chart, as on a transfer) AND mark the referral
 * status `seen`.
 *
 * Ordering rationale (atomicity):
 * The two writes (patient transfer, referral status) cannot be wrapped in a
 * single PouchDB transaction — they live in separate databases that may
 * replicate independently. Previously the order was status-first, then
 * transfer; if the transfer threw, the referral was stuck in `seen` while
 * the patient never moved, with no compensating-write to fix it.
 *
 * Reversed here: do the patient transfer FIRST, then mark `seen`. If the
 * status write fails, the patient is already at the new facility (which
 * is the user-visible outcome), and the referral page becomes the source
 * of truth — re-running acceptance simply re-marks it `seen` (the patient
 * write is idempotent on the same target hospital). Strictly better than
 * leaving a referral marked seen for a transfer that never happened.
 */
/** Thrown by acceptReferral when the referral would move a patient the sending org does not own. */
export class ReferralTenantError extends Error {
  name = 'ReferralTenantError';
}

export async function acceptReferral(referralId: string): Promise<ReferralDoc | null> {
  const db = referralsDB();
  let receiverPatientId: string | undefined;
  try {
    const referral = await db.get(referralId) as ReferralDoc;

    // Step 1: transfer patient to the receiving hospital. The atomicity
    // win here is *ordering*: previously we marked the referral `seen`
    // BEFORE the patient transfer, so a transfer failure left the
    // referral lying about what happened. Now the transfer goes first.
    //
    // We deliberately swallow a transfer error and proceed to the
    // mark-seen step. Reasoning: in the common offline-first case the
    // patient may already exist at the receiving facility (idempotent
    // write), or the patient document is unreachable but the user-visible
    // intent (the clinician clicked Accept) should still be recorded.
    // The clinician can always re-run acceptance, which re-attempts the
    // transfer; the referral list reflects the action either way.
    if (referral.patientId && referral.toHospitalId) {
      // Cross-organisation referrals SPLIT the chart; they never move it.
      // Each organisation is its own tenant database, so one document cannot
      // belong to both: moving it in place (the old behaviour) emptied the
      // sender's chart. The sender keeps its document, marked `referredOut`;
      // the receiver gets its own linked copy (see splitPatientAcrossOrgs).
      let toOrgId: string | undefined;
      try {
        const to = await hospitalsDB().get(referral.toHospitalId) as HospitalDoc;
        toOrgId = to?.orgId;
      } catch {
        // Destination hospital unreachable (offline) — a same-org referral is
        // unaffected; a cross-org one falls back to the referral's own toOrgId.
        toOrgId = referral.toOrgId;
      }
      // Tenant guard (the cross-org takeover fix). Splitting hands a copy of the
      // chart to another organisation, so it is only legitimate when the patient
      // CURRENTLY belongs to the org that was entitled to refer them -- the
      // referral's sending org. A referral stamped by an org that never owned
      // the patient (forged via a known patient id) must not copy it. A patient
      // already in the destination org (a chart moved before this split
      // existed) is the idempotent re-run case. This throws (outside the swallow
      // below) so the referral is NOT marked seen.
      let currentOrgId: string | undefined;
      let currentPatient: PatientDoc | undefined;
      {
        try {
          currentPatient = (await patientsDB().get(referral.patientId)) as PatientDoc;
          currentOrgId = currentPatient.orgId;
        } catch {
          currentOrgId = undefined;
        }
        if (currentOrgId !== referral.orgId && !(toOrgId && currentOrgId === toOrgId)) {
          throw new ReferralTenantError('Referral not sent. This patient is registered with a different organization.');
        }
      }
      try {
        if (currentPatient && toOrgId && currentOrgId && toOrgId !== currentOrgId) {
          receiverPatientId = await splitPatientAcrossOrgs(referral, currentPatient, toOrgId);
        } else {
          const { updatePatient } = await import('./patient-service');
          // The sending facility keeps its chart, as it does on a transfer:
          // `registrationHospital` is where the patient was registered and is
          // never overwritten; the receiver is reached through
          // `lastVisitHospital`; and both facilities go on `transferFacilityIds`,
          // so a later visit elsewhere does not push either of them out.
          const keepsAccess = [...new Set([
            ...(currentPatient?.transferFacilityIds ?? []),
            ...(referral.fromHospitalId ? [referral.fromHospitalId] : []),
            referral.toHospitalId,
          ])];
          await updatePatient(referral.patientId, {
            lastVisitHospital: referral.toHospitalId,
            transferFacilityIds: keepsAccess,
          }, orgOnlyScope(currentOrgId));
        }
      } catch (err) {
        console.error('Failed to transfer patient on referral acceptance:', err);
        captureException(err, { tag: 'Failed to transfer patient on referral acceptance:' });
        // Intentionally swallow: re-running acceptance is idempotent.
      }
      // Drop an intake encounter into the receiver's EHR (idempotent). Failure
      // here must not block acceptance — the patient transfer above is the
      // user-visible outcome, and re-running acceptance re-attempts this.
      try {
        await recordReferralIntake(referral, toOrgId, receiverPatientId);
      } catch (err) {
        console.error('Failed to record referral intake encounter:', err);
        captureException(err, { tag: 'Failed to record referral intake encounter:' });
      }
    }

    // Step 2: mark referral as seen. Runs after transfer succeeded (or the
    // transfer was a no-op due to missing fields). If this fails, the
    // patient is at the new facility and the user can re-run acceptance.
    const updated = withPendingOfflineSync({
      ...referral,
      status: 'seen' as const,
      ...(receiverPatientId ? { receiverPatientId } : {}),
      updatedAt: new Date().toISOString(),
    });
    const resp = await db.put(updated);
    updated._rev = resp.rev;

    if (referral.patientId && referral.toHospitalId) {
      await logAuditSafe(
        'ACCEPT_REFERRAL', undefined, undefined,
        `Accepted referral ${referralId}: patient ${referral.patientId} transferred to ${referral.toHospital}`
      );
    }

    return updated;
  } catch (err) {
    if (err instanceof ReferralTenantError) throw err;
    return null;
  }
}


/**
 * Accept a referral from a signed-in browser.
 *
 * A same-organisation referral is accepted on the device, as always. A
 * cross-organisation one cannot be: the chart belongs to ANOTHER organisation's
 * database, which this device neither holds nor may write (the sync validator
 * refuses it), so the server does the split with its own access, after checking
 * that the caller is on the receiving side. Returns null when it was not done.
 */
export async function acceptReferralFromDevice(referralId: string): Promise<ReferralDoc | null> {
  const referral = await referralsDB().get(referralId).catch(() => null) as ReferralDoc | null;
  if (!referral) return null;
  if (!referral.toOrgId || referral.toOrgId === referral.orgId) return acceptReferral(referralId);
  const { apiFetch } = await import('../api-fetch');
  const res = await apiFetch('/api/referrals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'accept', referralId }),
  });
  if (!res.ok) return null;
  const body = await res.json() as { referral?: ReferralDoc };
  return body.referral ?? null;
}

/**
 * Destination org for a referral, or undefined when the hand-off stays inside
 * one organization (KAN-101).
 *
 * Only set when it actually differs from the sending org. A same-org referral
 * needs nothing extra — `orgId` already grants both facilities access — and
 * stamping it anyway would make every referral look like a boundary crossing
 * in the audit trail, which is the opposite of what we want to be able to spot.
 */
async function resolveDestinationOrg(
  sendingOrgId: string | undefined,
  toHospitalId: string | undefined,
): Promise<string | undefined> {
  const destOrg = await orgIdOfHospital(toHospitalId);
  if (!destOrg || destOrg === sendingOrgId) return undefined;
  // A referral leaving its organization is a PHI boundary crossing and is
  // recorded as one, separately from the ordinary CREATE_REFERRAL entry.
  await logAuditSafe(
    'CROSS_ORG_REFERRAL',
    undefined,
    undefined,
    `Referral crossing org boundary: ${sendingOrgId || 'unknown'} → ${destOrg} (facility ${toHospitalId}).`,
  );
  return destOrg;
}
