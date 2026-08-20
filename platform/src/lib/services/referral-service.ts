import { referralsDB, hospitalsDB, medicalRecordsDB } from '../db';
import type { ReferralDoc, HospitalDoc, MedicalRecordDoc } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
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
 * Tell the sending facility their referral has been picked up (KAN-43).
 *
 * Written as a care alert on the patient's own record rather than a message to
 * a named user: the referring clinician may be off shift, and the next person
 * to open that patient's chart at the sending facility is the one who needs to
 * know. It travels with the patient, which a direct message would not.
 *
 * Best-effort — a failure here must not roll back the status change. The
 * receiving facility has done the right thing by acknowledging; losing the
 * notification is a lesser harm than rejecting their update.
 */
async function notifySendingFacility(
  referral: ReferralDoc,
  status: 'received' | 'seen' | 'completed',
  outcome?: ReferralOutcome,
): Promise<void> {
  try {
    const { addCareAlert } = await import('./care-alert-service');
    let message: string;
    if (status === 'completed') {
      // The loop's closing moment: tell the sender what actually happened,
      // not just that the status flipped — a disposition on its own
      // ("treated discharged") is a fact the sending clinician has to be
      // able to read without opening the referral.
      const dispositionLabel = outcome?.disposition.replace(/_/g, ' ') ?? 'completed';
      message = `Referral to ${referral.toHospital} (${referral.department}, ${referral.urgency}) has been completed`
        + ` — ${dispositionLabel}${outcome?.summary ? `: ${outcome.summary}` : ''}.`;
    } else {
      const verb = status === 'received' ? 'received' : 'been seen at';
      message = `Referral to ${referral.toHospital} (${referral.department}, ${referral.urgency}) has ${verb} the receiving facility.`;
    }
    await addCareAlert(referral.patientId, {
      category: 'administrative',
      // Emergency and urgent referrals are the ones a sending clinician is
      // actively waiting on, so they surface at high priority.
      priority: referral.urgency === 'routine' ? 'normal' : 'high',
      message,
      recordedByName: referral.toHospital,
    });
  } catch (err) {
    console.warn('[referral] could not notify the sending facility (status change was saved):', err);
  }
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

export async function getReferralsByPatient(patientId: string): Promise<ReferralDoc[]> {
  const all = await getAllReferrals();
  return all.filter(r => r.patientId === patientId);
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
    const updated = withPendingOfflineSync({ ...existing, status, updatedAt: new Date().toISOString() });
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_REFERRAL', undefined, undefined, `Referral ${id} status changed to ${status}`);
    // Close the loop back to the sending facility (KAN-43). The referring
    // clinician previously had no way to learn their patient had been picked
    // up short of opening the referral and looking.
    if (status === 'received' || status === 'seen') {
      await notifySendingFacility(existing, status);
    }
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
    const updated: ReferralDoc = withPendingOfflineSync({
      ...existing,
      status: 'completed',
      outcome,
      notes: existing.notes ? `${existing.notes}\n\n${noteLine}` : noteLine,
      updatedAt: new Date().toISOString(),
    } as ReferralDoc);
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('UPDATE_REFERRAL', undefined, undefined, `Referral ${id} completed with outcome (${outcome.disposition})`);
    // Close the loop back to the sending facility (KAN-43) — this is the
    // loop's closing moment, and previously nothing told the referring
    // clinician what happened to their patient short of reopening the
    // referral to look. Best-effort: the outcome is already durably written.
    await notifySendingFacility(existing, 'completed', outcome);
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
  toOrgId?: string
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
    patientId: referral.patientId,
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

/**
 * Accept a referral: transfer the patient to the receiving hospital AND
 * mark the referral status `seen`.
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
export async function acceptReferral(referralId: string): Promise<ReferralDoc | null> {
  const db = referralsDB();
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
      // Re-home the patient to the receiving hospital AND its org. Passing
      // only the hospital fields is not enough for a cross-org referral:
      // updatePatient keeps the existing orgId, and data-scope filters on
      // orgId first — so the patient would stay invisible to the receiving
      // org's users. Look up the destination org and hand it over explicitly.
      let toOrgId: string | undefined;
      try {
        const to = await hospitalsDB().get(referral.toHospitalId) as HospitalDoc;
        toOrgId = to?.orgId;
      } catch {
        // Destination hospital unreachable (offline) — fall back to leaving
        // the orgId as-is; same-org referrals are unaffected.
      }
      try {
        const { updatePatient } = await import('./patient-service');
        await updatePatient(referral.patientId, {
          registrationHospital: referral.toHospitalId,
          lastVisitHospital: referral.toHospitalId,
          ...(toOrgId ? { orgId: toOrgId } : {}),
        });
      } catch (err) {
        console.error('Failed to transfer patient on referral acceptance:', err);
        // Intentionally swallow: re-running acceptance is idempotent.
      }
      // Drop an intake encounter into the receiver's EHR (idempotent). Failure
      // here must not block acceptance — the patient transfer above is the
      // user-visible outcome, and re-running acceptance re-attempts this.
      try {
        await recordReferralIntake(referral, toOrgId);
      } catch (err) {
        console.error('Failed to record referral intake encounter:', err);
      }
    }

    // Step 2: mark referral as seen. Runs after transfer succeeded (or the
    // transfer was a no-op due to missing fields). If this fails, the
    // patient is at the new facility and the user can re-run acceptance.
    const updated = withPendingOfflineSync({ ...referral, status: 'seen' as const, updatedAt: new Date().toISOString() });
    const resp = await db.put(updated);
    updated._rev = resp.rev;

    if (referral.patientId && referral.toHospitalId) {
      await logAuditSafe(
        'ACCEPT_REFERRAL', undefined, undefined,
        `Accepted referral ${referralId}: patient ${referral.patientId} transferred to ${referral.toHospital}`
      );
    }

    return updated;
  } catch {
    return null;
  }
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
