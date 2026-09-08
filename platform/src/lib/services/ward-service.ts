/**
 * Ward Management Service — handles ward/bed tracking, admissions,
 * discharges, and bed occupancy for inpatient facilities.
 *
 * Applicable to Level 3+ facilities (County, State, National hospitals).
 */
import { getDB } from '../db';
import type { WardDoc, BedDoc, AdmissionDoc, BedStatus } from '../db-types-ward';
import type { UserRole } from '../db-types';
import type { PaymentMethodType } from '../db-types-payments';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { withPendingOfflineSync } from '../sync/offline-metadata';
import { getAllAdmissions } from './admission-query-service';

export { getAllAdmissions, getActiveAdmissions } from './admission-query-service';

const wardDB = () => getDB('tamamhealth_wards');

// ===== Ward Operations =====

export async function getAllWards(scope?: DataScope): Promise<WardDoc[]> {
  const db = wardDB();
  const all = (await findByType<WardDoc>(db, 'ward'))
    .sort((a, b) => a.name.localeCompare(b.name));
  return scope ? filterByScope(all, scope) : all;
}

export async function getWardById(id: string, scope?: DataScope): Promise<WardDoc | null> {
  try {
    const db = wardDB();
    const ward = await db.get(id) as WardDoc;
    return !scope || filterByScope([ward], scope).length > 0 ? ward : null;
  } catch {
    return null;
  }
}

export async function createWard(data: Omit<WardDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'occupiedBeds' | 'availableBeds'>): Promise<WardDoc> {
  const db = wardDB();
  const now = new Date().toISOString();
  const doc: WardDoc = withPendingOfflineSync({
    _id: `ward-${uuidv4()}`,
    type: 'ward',
    ...data,
    occupiedBeds: 0,
    availableBeds: data.totalBeds,
    createdAt: now,
    updatedAt: now,
  }, now);
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('WARD_CREATED', undefined, undefined, `Ward ${doc.name} created at ${doc.facilityName}`);
  emitSyncEvent({
    resourceType: 'ward',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });
  return doc;
}

// ===== Bed Operations =====

export async function getBedsByWard(wardId: string, scope?: DataScope): Promise<BedDoc[]> {
  const db = wardDB();
  const rows = await findByType<BedDoc>(db, 'bed', { wardId }, { indexFields: ['type', 'wardId'] });
  const visible = scope ? filterByScope(rows, scope) : rows;
  return visible
    .sort((a, b) => a.bedNumber.localeCompare(b.bedNumber));
}

export async function getBedById(id: string, scope?: DataScope): Promise<BedDoc | null> {
  try {
    const bed = await wardDB().get(id) as BedDoc;
    return !scope || filterByScope([bed], scope).length > 0 ? bed : null;
  } catch {
    return null;
  }
}

/** Beds visible through the same ward scope as admissions. */
export async function getAllBeds(scope?: DataScope): Promise<BedDoc[]> {
  const db = wardDB();
  const [beds, wards] = await Promise.all([
    findByType<BedDoc>(db, 'bed'),
    getAllWards(scope),
  ]);
  const wardIds = new Set(wards.map(ward => ward._id));
  return beds
    .filter(bed => wardIds.has(bed.wardId))
    .sort((a, b) => `${a.wardName}:${a.bedNumber}`.localeCompare(`${b.wardName}:${b.bedNumber}`));
}

export async function getAvailableBeds(wardId: string): Promise<BedDoc[]> {
  const beds = await getBedsByWard(wardId);
  return beds.filter(b => b.status === 'available');
}

export class WardWorkflowError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'BED_NOT_AVAILABLE'
      | 'BED_ASSIGNMENT_FAILED'
      | 'ADMISSION_NOT_FOUND'
      | 'ADMISSION_NOT_ACTIVE'
      | 'DUPLICATE_ADMISSION'
      | 'DISCHARGE_INCOMPLETE'
      | 'WORKFLOW_CONFLICT',
  ) {
    super(message);
    this.name = 'WardWorkflowError';
  }
}

function isConflict(error: unknown): boolean {
  const candidate = error as { name?: string; status?: number } | undefined;
  return candidate?.name === 'conflict' || candidate?.status === 409;
}

export async function updateBedStatus(bedId: string, status: BedStatus, patientId?: string, patientName?: string, admissionId?: string): Promise<BedDoc> {
  const db = wardDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    const bed = await db.get(bedId) as BedDoc;
    if (
      (status === 'occupied' || status === 'reserved')
      && bed.status !== 'available'
      && bed.currentAdmissionId !== admissionId
    ) {
      throw new WardWorkflowError(
        `${bed.wardName} bed ${bed.bedNumber} is no longer available. Refresh the ward board and choose another bed.`,
        'BED_NOT_AVAILABLE',
      );
    }
    bed.status = status;
    bed.currentPatientId = patientId;
    bed.currentPatientName = patientName;
    bed.currentAdmissionId = admissionId;
    if (status === 'available') {
      bed.currentPatientId = undefined;
      bed.currentPatientName = undefined;
      bed.currentAdmissionId = undefined;
      bed.lastCleanedAt = new Date().toISOString();
    }
    bed.updatedAt = new Date().toISOString();
    const pendingBed = withPendingOfflineSync(bed);
    let resp: Awaited<ReturnType<typeof db.put>>;
    try {
      resp = await db.put(pendingBed);
    } catch (error) {
      if (isConflict(error) && attempt < 2) continue;
      throw error;
    }
    bed._rev = resp.rev;
    bed.offlineSync = pendingBed.offlineSync;
    emitSyncEvent({
      resourceType: 'bed',
      resourceId: bed._id,
      operation: 'update',
      resourceVersion: bed._rev,
      orgId: bed.orgId,
      hospitalId: bed.facilityId,
    });
    return bed;
  }
  throw new WardWorkflowError('The bed changed on another workstation. Refresh and try again.', 'WORKFLOW_CONFLICT');
}

export async function completeBedTurnover(
  bedId: string,
  actor?: { id?: string; name?: string },
): Promise<BedDoc> {
  const bed = await wardDB().get(bedId) as BedDoc;
  if (bed.status !== 'cleaning') {
    throw new WardWorkflowError('Only a bed awaiting cleaning can be marked ready.', 'BED_NOT_AVAILABLE');
  }
  const ready = await updateBedStatus(bedId, 'available');
  await logAuditSafe('BED_TURNOVER_COMPLETED', actor?.id, actor?.name, `Marked ${bed.wardName} bed ${bed.bedNumber} clean and ready`);
  return ready;
}

async function releaseBedIfOwned(bedId: string, admissionId: string): Promise<void> {
  const db = wardDB();
  const bed = await db.get(bedId) as BedDoc;
  if (bed.currentAdmissionId !== admissionId) return;
  await updateBedStatus(bedId, 'available');
}

/** Restore our patient's claim after a discharge write failed. */
async function restoreBedClaimIfUnassigned(bedId: string, admission: AdmissionDoc): Promise<void> {
  const db = wardDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    const bed = await db.get(bedId) as BedDoc;
    // A later workflow now owns or changed this bed; never overwrite it while
    // compensating for our failed discharge.
    if (bed.currentAdmissionId || bed.status !== 'cleaning') return;
    const now = new Date().toISOString();
    const restored = withPendingOfflineSync({
      ...bed,
      status: 'occupied' as const,
      currentPatientId: admission.patientId,
      currentPatientName: admission.patientName,
      currentAdmissionId: admission._id,
      updatedAt: now,
    }, now);
    try {
      const response = await db.put(restored);
      emitSyncEvent({
        resourceType: 'bed',
        resourceId: restored._id,
        operation: 'update',
        resourceVersion: response.rev,
        orgId: restored.orgId,
        hospitalId: restored.facilityId,
      });
      return;
    } catch (error) {
      if (isConflict(error) && attempt < 2) continue;
      throw error;
    }
  }
}

// ===== Admission Operations =====

export async function getAdmissionById(id: string, scope?: DataScope): Promise<AdmissionDoc | null> {
  try {
    const admission = await wardDB().get(id) as AdmissionDoc;
    return !scope || filterByScope([admission], scope).length > 0 ? admission : null;
  } catch {
    return null;
  }
}

export async function getAdmissionsByPatient(patientId: string): Promise<AdmissionDoc[]> {
  const all = await getAllAdmissions();
  return all.filter(a => a.patientId === patientId);
}

export interface AdmitPatientInput {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  admittingDiagnosis: string;
  icd11Code?: string;
  severity: AdmissionDoc['severity'];
  admittedBy: string;
  admittedByName: string;
  wardId: string;
  wardName: string;
  bedId?: string;
  bedNumber?: string;
  roomClass?: AdmissionDoc['roomClass'];
  nightlyTariff?: number;
  tariffCurrency?: string;
  admissionDepositRequired?: number;
  facilityId: string;
  facilityName: string;
  facilityLevel: AdmissionDoc['facilityLevel'];
  attendingPhysician: string;
  attendingPhysicianName: string;
  nurseAssigned?: string;
  nurseAssignedName?: string;
  dietaryRequirements?: string;
  isolationRequired?: boolean;
  isolationReason?: string;
  state: string;
  county?: string;
  orgId?: string;
  /**
   * The outpatient encounter this admission grew out of, when admitting
   * directly from an open visit (e.g. the consultation's "Admit" action).
   * Stamped onto the AdmissionDoc, and used to close the OPD encounter
   * (status `admitted`) so it stops being reusable as "the patient's open
   * visit" by a later same-day arrival.
   */
  encounterId?: string;
}

export async function admitPatient(
  data: AdmitPatientInput,
  actor?: { id?: string; role?: UserRole },
): Promise<AdmissionDoc> {
  const db = wardDB();
  const now = new Date().toISOString();

  const active = (await getAllAdmissions()).find(admission =>
    admission.patientId === data.patientId
    && admission.facilityId === data.facilityId
    && admission.status === 'admitted'
  );
  if (active) {
    throw new WardWorkflowError(
      `${data.patientName} already has an active admission in ${active.wardName}${active.bedNumber ? `, bed ${active.bedNumber}` : ''}.`,
      'DUPLICATE_ADMISSION',
    );
  }

  // Verify the visit link BEFORE anything is written: `encounterId` arrives
  // from a URL param via the admit form, and a stale one surviving a patient
  // swap must neither be stamped as this admission's lineage nor close a
  // different patient's visit.
  let encounterId = data.encounterId;
  if (encounterId) {
    try {
      const { resolvePatientEncounter } = await import('./encounter-service');
      encounterId = (await resolvePatientEncounter(encounterId, data.patientId))?._id;
    } catch {
      encounterId = undefined;
    }
    if (!encounterId) {
      console.warn('[ward] admission encounterId does not belong to the admitted patient — link dropped');
    }
  }

  const admissionId = `adm-${uuidv4()}`;
  const doc: AdmissionDoc = withPendingOfflineSync({
    _id: admissionId,
    type: 'admission',
    ...data,
    encounterId,
    admissionDate: now,
    isolationRequired: data.isolationRequired || false,
    status: 'admitted',
    admissionDepositPaid: 0,
    admissionDepositStatus: data.admissionDepositRequired && data.admissionDepositRequired > 0 ? 'due' : 'not_required',
    followUpRequired: false,
    createdAt: now,
    updatedAt: now,
  }, now);

  // Claim the bed before publishing the admission. PouchDB's document revision
  // check makes this a compare-and-swap on one device: two tabs cannot both
  // observe the same available bed and silently occupy it. If the admission
  // write then fails, the compensating release below returns only OUR claim.
  if (data.bedId) {
    await updateBedStatus(data.bedId, 'occupied', data.patientId, data.patientName, admissionId);
  }

  try {
    const resp = await db.put(doc);
    doc._rev = resp.rev;
  } catch (error) {
    if (data.bedId) {
      try { await releaseBedIfOwned(data.bedId, admissionId); } catch { /* reconciliation will surface the stale claim */ }
    }
    throw error;
  }

  // Update ward occupancy
  await updateWardOccupancy(data.wardId);

  await logAuditSafe(
    'PATIENT_ADMITTED', data.admittedBy, data.admittedByName,
    `Admitted ${data.patientName} to ${data.wardName} (${data.admittingDiagnosis})`
  );

  emitSyncEvent({
    resourceType: 'admission',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.facilityId,
  });

  // Close the OPD encounter this admission grew out of (best-effort). Admit
  // closes the visit: `admitted` is a TERMINAL_STATUS, legal from
  // `with_clinician`, `awaiting_facility_checkout`, `in_facility_checkout`
  // and `escalated_to_emergency`. If the encounter sits somewhere else the
  // transition throws — caught here so a workflow quirk never undoes a real
  // admission that has already been written and the bed already assigned.
  //
  // (Already verified against the admitted patient above.)
  if (encounterId) {
    try {
      const { transitionEncounter } = await import('./encounter-service');
      await transitionEncounter(encounterId, 'admitted', {
        actorId: actor?.id ?? data.admittedBy,
        actorRole: actor?.role,
      });
    } catch (err) {
      console.warn('[ward] could not close the encounter on admission (admission was saved):', err);
    }
  }

  // A configured deposit becomes a real, linked bill. Billing failure must
  // never roll back a clinically valid admission or release its bed, so this
  // happens after the admission transaction and remains retryable through
  // ensureAdmissionDepositBill().
  if ((doc.admissionDepositRequired ?? 0) > 0) {
    try { return await ensureAdmissionDepositBillForAdmission(doc); }
    catch (error) { console.warn('[ward] admission saved but deposit bill could not be created:', error); }
  }
  return doc;
}

/**
 * Idempotently create/link the invoice for an admission deposit, then mirror
 * its collected amount onto the admission for ward/reception visibility.
 */
async function ensureAdmissionDepositBillForAdmission(admission: AdmissionDoc): Promise<AdmissionDoc> {
  const required = admission.admissionDepositRequired ?? 0;
  if (required <= 0) {
    if (admission.admissionDepositStatus === 'not_required') return admission;
    const updated = { ...admission, admissionDepositStatus: 'not_required' as const, admissionDepositPaid: 0, admissionDepositReconciledAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const response = await wardDB().put(updated); updated._rev = response.rev; return updated;
  }

  const { createBill, getBillById, getBillsByPatient } = await import('./billing-service');
  let bill = admission.admissionDepositBillId ? await getBillById(admission.admissionDepositBillId) : null;
  if (!bill) {
    const existing = (await getBillsByPatient(admission.patientId)).find((candidate) =>
      candidate.items.some((item) => item.category === 'admission_deposit' && item.referenceId === admission._id));
    bill = existing ?? await createBill({
      patientId: admission.patientId,
      patientName: admission.patientName,
      hospitalNumber: admission.hospitalNumber,
      facilityId: admission.facilityId,
      facilityName: admission.facilityName,
      facilityLevel: admission.facilityLevel,
      encounterDate: admission.admissionDate,
      encounterId: admission.encounterId,
      items: [{
        id: uuidv4(), category: 'admission_deposit', description: `${admission.roomClass?.replaceAll('_', ' ') || 'Inpatient'} admission deposit`,
        quantity: 1, unitPrice: required, billingUnit: 'each', totalPrice: required,
        referenceId: admission._id, referenceType: 'admission',
      }],
      currency: admission.tariffCurrency || 'SSP', generatedBy: admission.admittedBy,
      generatedByName: admission.admittedByName, state: admission.state,
      county: admission.county, orgId: admission.orgId,
      notes: `Admission deposit for ${admission._id}`,
    });
  }
  const paid = Math.max(0, Math.min(required, bill.amountPaid || 0));
  const updated: AdmissionDoc = {
    ...admission,
    admissionDepositBillId: bill._id,
    admissionDepositPaid: paid,
    admissionDepositStatus: ['refund_due', 'refunded', 'forfeited', 'waived'].includes(admission.admissionDepositStatus || '')
      ? admission.admissionDepositStatus : paid >= required ? 'paid' : paid > 0 ? 'partial' : 'due',
    admissionDepositReconciledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const response = await wardDB().put(updated);
  updated._rev = response.rev;
  emitSyncEvent({ resourceType: 'admission', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.facilityId });
  return updated;
}

export async function ensureAdmissionDepositBill(admissionId: string, scope: DataScope): Promise<AdmissionDoc> {
  const admission = await getAdmissionById(admissionId, scope);
  if (!admission) throw new Error('Admission not found in your authorized scope');
  return ensureAdmissionDepositBillForAdmission(admission);
}

/** Record the locally-authorized discharge decision; never assumes deposits are refundable. */
export async function assessAdmissionDeposit(input: {
  admissionId: string;
  scope: DataScope;
  decision: 'refund' | 'forfeit' | 'waive';
  refundAmount?: number;
  reason: string;
  actor: { id: string; name: string };
}): Promise<AdmissionDoc> {
  if (!['super_admin', 'org_admin', 'hospital_manager', 'medical_superintendent', 'cashier', 'medical_biller'].includes(input.scope.role)) throw new Error('Your role cannot assess deposits');
  const admission = await ensureAdmissionDepositBill(input.admissionId, input.scope);
  if (admission.admissionDepositPendingRefund) throw new Error('Complete the pending refund before changing its decision');
  const reason = input.reason.trim();
  if (!reason) throw new Error('A deposit decision requires a reason');
  const paid = admission.admissionDepositPaid ?? 0;
  const alreadyRefunded = admission.admissionDepositRefunded ?? 0;
  const available = Math.max(0, paid - alreadyRefunded);
  const refundDue = input.decision === 'refund' ? input.refundAmount ?? available : 0;
  if (!Number.isFinite(refundDue) || refundDue < 0 || refundDue > available) throw new Error('Refund amount exceeds the collected, unrefunded deposit');

  const updated: AdmissionDoc = {
    ...admission,
    admissionDepositStatus: input.decision === 'refund' ? 'refund_due' : input.decision === 'forfeit' ? 'forfeited' : 'waived',
    admissionDepositRefundDue: refundDue,
    admissionDepositDecisionReason: reason,
    admissionDepositReconciledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const response = await wardDB().put(updated);
  updated._rev = response.rev;
  await logAuditSafe('ADMISSION_DEPOSIT_ASSESSED', input.actor.id, input.actor.name, `Admission ${admission._id} deposit marked ${updated.admissionDepositStatus}: ${reason}`);
  emitSyncEvent({ resourceType: 'admission', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.facilityId });
  return updated;
}

/** Issue a real payment refund, then close or reduce the admission's refund due. */
export async function refundAdmissionDeposit(input: {
  admissionId: string;
  scope: DataScope;
  paymentId: string;
  amount: number;
  method: PaymentMethodType;
  reason: string;
  actor: { id: string; name: string };
}): Promise<AdmissionDoc> {
  let admission = await getAdmissionById(input.admissionId, input.scope);
  if (!admission) throw new Error('Admission not found in your authorized scope');
  if (!['super_admin', 'org_admin', 'hospital_manager', 'medical_superintendent', 'cashier', 'medical_biller'].includes(input.scope.role)) throw new Error('Your role cannot refund deposits');
  if (admission.admissionDepositStatus !== 'refund_due') throw new Error('The admission deposit has not been approved for refund');
  const due = admission.admissionDepositRefundDue ?? 0;
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > due) throw new Error('Refund amount must be positive and no greater than the approved refund due');
  const { issueRefund, getRefundsByPatient } = await import('./payment-service');
  const { getBillById } = await import('./billing-service');
  if (!input.reason.trim()) throw new Error('A refund requires a reason');
  const bill = admission.admissionDepositBillId ? await getBillById(admission.admissionDepositBillId) : null;
  const payment = bill?.payments.find(item => item.id === input.paymentId);
  if (!bill || !payment || bill.patientId !== admission.patientId || bill.orgId !== admission.orgId || bill.facilityId !== admission.facilityId || bill.currency !== (admission.tariffCurrency || 'SSP')) throw new Error('Select a payment recorded on this admission deposit invoice');
  let pending = admission.admissionDepositPendingRefund;
  if (pending && (pending.paymentId !== input.paymentId || pending.amount !== input.amount || pending.method !== input.method || pending.reason !== input.reason.trim())) throw new Error('Retry the pending refund with its original details');
  const refunds = await getRefundsByPatient(admission.patientId, input.scope);
  const refunded = refunds.filter(item => item.paymentId === payment.id && item._id !== (pending ? `ref-${encodeURIComponent(pending.id)}` : '')).reduce((sum, item) => sum + item.amount, 0);
  if (input.amount > payment.amount - refunded) throw new Error('Refund exceeds the remaining amount of the selected payment');
  if (!pending) {
    pending = { id: uuidv4(), paymentId: input.paymentId, amount: input.amount, method: input.method, reason: input.reason.trim() };
    const reserved = { ...admission, admissionDepositPendingRefund: pending };
    const response = await wardDB().put(reserved);
    admission = { ...reserved, _rev: response.rev };
  }
  const refund = await issueRefund({ idempotencyKey: pending.id, paymentId: pending.paymentId, patientId: admission.patientId, patientName: admission.patientName, amount: pending.amount, currency: admission.tariffCurrency || 'SSP', method: pending.method, reason: pending.reason, processedBy: input.actor.id, processedByName: input.actor.name, facilityId: admission.facilityId, orgId: admission.orgId });
  const remaining = Math.max(0, due - input.amount);
  const updated: AdmissionDoc = {
    ...admission,
    admissionDepositRefunded: (admission.admissionDepositRefunded ?? 0) + input.amount,
    admissionDepositRefundDue: remaining,
    admissionDepositRefundId: refund._id,
    admissionDepositPendingRefund: undefined,
    admissionDepositStatus: remaining === 0 ? 'refunded' : 'refund_due',
    admissionDepositReconciledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const response = await wardDB().put(updated);
  updated._rev = response.rev;
  emitSyncEvent({ resourceType: 'admission', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.facilityId });
  return updated;
}

/** Move an admitted patient to another available ward bed. */
export async function reassignAdmissionBed(
  admissionId: string,
  destination: { wardId: string; wardName: string; bedId: string; bedNumber: string },
  actor?: { id?: string; name?: string },
): Promise<AdmissionDoc> {
  const db = wardDB();
  const admission = await db.get(admissionId) as AdmissionDoc;
  const nextBed = await db.get(destination.bedId) as BedDoc;
  if (nextBed.status !== 'available' && nextBed.currentAdmissionId !== admissionId) {
    throw new Error('The selected bed is not available.');
  }
  if (admission.bedId === destination.bedId && admission.wardId === destination.wardId) return admission;

  if (admission.status !== 'admitted') {
    throw new WardWorkflowError('Only an active admission can be moved to another bed.', 'ADMISSION_NOT_ACTIVE');
  }

  const now = new Date().toISOString();
  // Claim the destination first. Releasing the old bed first creates a window
  // where a failed destination write leaves the patient with no bed at all.
  await updateBedStatus(destination.bedId, 'occupied', admission.patientId, admission.patientName, admission._id);
  const updated = withPendingOfflineSync({
    ...admission,
    wardId: destination.wardId,
    wardName: destination.wardName,
    bedId: destination.bedId,
    bedNumber: destination.bedNumber,
    updatedAt: now,
  }, now);
  let response: Awaited<ReturnType<typeof db.put>>;
  try {
    response = await db.put(updated);
  } catch (error) {
    try { await releaseBedIfOwned(destination.bedId, admission._id); } catch { /* surface original conflict */ }
    throw error;
  }
  updated._rev = response.rev;
  if (admission.bedId) await updateBedStatus(admission.bedId, 'cleaning');
  if (admission.wardId !== destination.wardId) {
    await updateWardOccupancy(admission.wardId);
    await updateWardOccupancy(destination.wardId);
  } else {
    await updateWardOccupancy(destination.wardId);
  }
  await logAuditSafe('PATIENT_BED_REASSIGNED', actor?.id, actor?.name, `Moved ${admission.patientName} to ${destination.wardName} (${destination.bedNumber})`);
  emitSyncEvent({ resourceType: 'admission', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.facilityId });
  return updated;
}

export async function dischargePatient(
  admissionId: string,
  dischargeData: {
    dischargeType: AdmissionDoc['dischargeType'];
    dischargeDiagnosis?: string;
    dischargeIcd11?: string;
    dischargeSummary?: string;
    dischargedBy: string;
    dischargedByName: string;
    followUpRequired?: boolean;
    followUpDate?: string;
    followUpInstructions?: string;
    medicationReconciled?: boolean;
  }
): Promise<AdmissionDoc> {
  const db = wardDB();
  const admission = await db.get(admissionId).catch(() => null) as AdmissionDoc | null;
  if (!admission) {
    throw new WardWorkflowError('Admission not found. Refresh the ward board before trying again.', 'ADMISSION_NOT_FOUND');
  }
  if (admission.status !== 'admitted') {
    throw new WardWorkflowError(`This admission is already ${admission.status}.`, 'ADMISSION_NOT_ACTIVE');
  }
  if (dischargeData.dischargeType === 'transfer') {
    throw new WardWorkflowError(
      'Use the patient transfer workflow so the receiving facility can accept the handover before this admission closes.',
      'DISCHARGE_INCOMPLETE',
    );
  }
  if (dischargeData.dischargeType === 'death') {
    throw new WardWorkflowError(
      'Record the death first. The death register will close the admission with the required cause and certification details.',
      'DISCHARGE_INCOMPLETE',
    );
  }
  if (!dischargeData.dischargeDiagnosis?.trim() || !dischargeData.dischargeSummary?.trim()) {
    throw new WardWorkflowError(
      'Record the final diagnosis and discharge summary before ending the admission.',
      'DISCHARGE_INCOMPLETE',
    );
  }
  if (dischargeData.followUpRequired && (!dischargeData.followUpDate || !dischargeData.followUpInstructions?.trim())) {
    throw new WardWorkflowError(
      'Follow-up needs a date and patient instructions before discharge.',
      'DISCHARGE_INCOMPLETE',
    );
  }
  if (!dischargeData.medicationReconciled) {
    throw new WardWorkflowError(
      'Complete medication reconciliation before ending the admission.',
      'DISCHARGE_INCOMPLETE',
    );
  }

  // Reconcile medication before releasing the bed. Every inpatient order is
  // explicitly closed; discharge prescriptions for home are separate orders.
  // Retry is safe because already-discontinued rows are skipped.
  const { getPrescriptionsByPatient, updatePrescription } = await import('./prescription-service');
  const inpatientOrders = (await getPrescriptionsByPatient(admission.patientId))
    .filter(order => order.admissionId === admissionId && order.status !== 'discontinued');
  for (const order of inpatientOrders) {
    const stopped = await updatePrescription(order._id, {
      status: 'discontinued',
      stoppedAt: new Date().toISOString(),
      stoppedReason: 'Inpatient course reconciled at discharge',
      stoppedBy: dischargeData.dischargedBy,
      stoppedByName: dischargeData.dischargedByName,
      stoppedSource: 'clinician',
    });
    if (!stopped) {
      throw new WardWorkflowError(
        `Medication reconciliation could not close ${order.medication}. Retry before discharge.`,
        'WORKFLOW_CONFLICT',
      );
    }
  }

  // Write the follow-up before ending the admission. If the admission write
  // later conflicts, retry finds this sourceVisitId and does not duplicate it.
  if (dischargeData.followUpRequired) {
    const { createFollowUp, getFollowUpsByPatient } = await import('./follow-up-service');
    const existing = (await getFollowUpsByPatient(admission.patientId))
      .find(followUp => followUp.sourceVisitId === admissionId && followUp.status === 'active');
    if (!existing) {
      await createFollowUp({
        patientId: admission.patientId,
        patientName: admission.patientName,
        encounterId: admission.encounterId,
        hospitalId: admission.facilityId,
        assignedWorker: dischargeData.dischargedBy,
        assignedWorkerName: dischargeData.dischargedByName,
        status: 'active',
        condition: dischargeData.dischargeDiagnosis!.trim(),
        facilityLevel: admission.facilityLevel,
        scheduledDate: `${dischargeData.followUpDate}T00:00:00+02:00`,
        notes: dischargeData.followUpInstructions?.trim(),
        state: admission.state,
        county: admission.county || '',
        sourceVisitId: admissionId,
        orgId: admission.orgId,
      });
    }
  }

  const originalBedId = admission.bedId;
  if (originalBedId) {
    const bed = await db.get(originalBedId) as BedDoc;
    if (bed.currentAdmissionId && bed.currentAdmissionId !== admissionId) {
      throw new WardWorkflowError(
        `Bed ${bed.bedNumber} is assigned to a different admission. Resolve the bed conflict before discharge.`,
        'BED_ASSIGNMENT_FAILED',
      );
    }
    await updateBedStatus(originalBedId, 'cleaning');
  }

  try {
    const now = new Date().toISOString();

    admission.status = dischargeData.dischargeType === 'absconded' ? 'absconded' : 'discharged';
    admission.dischargeDate = now;
    admission.dischargeType = dischargeData.dischargeType;
    admission.dischargeDiagnosis = dischargeData.dischargeDiagnosis;
    admission.dischargeIcd11 = dischargeData.dischargeIcd11;
    admission.dischargeSummary = dischargeData.dischargeSummary;
    admission.dischargedBy = dischargeData.dischargedBy;
    admission.dischargedByName = dischargeData.dischargedByName;
    admission.followUpRequired = dischargeData.followUpRequired || false;
    admission.followUpDate = dischargeData.followUpDate;
    admission.followUpInstructions = dischargeData.followUpInstructions;
    admission.medicationReconciled = true;
    admission.medicationReconciledAt = now;

    // Calculate length of stay
    const admDate = new Date(admission.admissionDate);
    const discDate = new Date(now);
    admission.lengthOfStay = Math.max(1, Math.ceil((discDate.getTime() - admDate.getTime()) / (1000 * 60 * 60 * 24)));

    admission.updatedAt = now;
    const pendingAdmission = withPendingOfflineSync(admission, now);
    const resp = await db.put(pendingAdmission);
    admission._rev = resp.rev;
    admission.offlineSync = pendingAdmission.offlineSync;

    // Update ward occupancy
    await updateWardOccupancy(admission.wardId);

    await logAuditSafe(
      'PATIENT_DISCHARGED', dischargeData.dischargedBy, dischargeData.dischargedByName,
      `Discharged ${admission.patientName} from ${admission.wardName} (LOS: ${admission.lengthOfStay}d)`
    );

    emitSyncEvent({
      resourceType: 'admission',
      resourceId: admission._id,
      operation: 'update',
      resourceVersion: admission._rev,
      orgId: admission.orgId,
      hospitalId: admission.facilityId,
    });

    return admission;
  } catch (error) {
    // The admission did not close, so restore the bed to this patient when our
    // own release is still the latest state. Never overwrite another user's
    // subsequent assignment.
    if (originalBedId) {
      try {
        await restoreBedClaimIfUnassigned(originalBedId, admission);
      } catch { /* the original error is the actionable one */ }
    }
    throw error;
  }
}

/** Close the active bed episode after the death register is the source of truth. */
export async function closeAdmissionForDeath(
  admissionId: string,
  death: { id: string; cause: string; certifiedBy: string },
): Promise<AdmissionDoc> {
  const db = wardDB();
  const admission = await db.get(admissionId) as AdmissionDoc;
  if (admission.status === 'deceased') return admission;
  if (admission.status !== 'admitted') {
    throw new WardWorkflowError('Only an active admission can be closed from a death record.', 'ADMISSION_NOT_ACTIVE');
  }
  const originalBedId = admission.bedId;
  if (originalBedId) await updateBedStatus(originalBedId, 'cleaning');
  const now = new Date().toISOString();
  const updated = withPendingOfflineSync({
    ...admission,
    status: 'deceased' as const,
    dischargeDate: now,
    dischargeType: 'death' as const,
    dischargeDiagnosis: death.cause,
    dischargeSummary: `Death registered as ${death.id}.`,
    dischargedBy: death.certifiedBy,
    dischargedByName: death.certifiedBy,
    followUpRequired: false,
    medicationReconciled: true,
    medicationReconciledAt: now,
    lengthOfStay: Math.max(1, Math.ceil((Date.now() - new Date(admission.admissionDate).getTime()) / 86_400_000)),
    updatedAt: now,
  }, now);
  try {
    const response = await db.put(updated);
    updated._rev = response.rev;
    await updateWardOccupancy(updated.wardId);
    await logAuditSafe('ADMISSION_CLOSED_AFTER_DEATH', death.certifiedBy, death.certifiedBy, `Closed ${updated.patientName}'s admission from death record ${death.id}`);
    emitSyncEvent({ resourceType: 'admission', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.facilityId });
    return updated;
  } catch (error) {
    if (originalBedId) await restoreBedClaimIfUnassigned(originalBedId, admission).catch(() => undefined);
    throw error;
  }
}

export async function closeAdmissionForTransfer(
  admissionId: string,
  transfer: { id: string; destinationName: string; reason: string; actorId?: string; actorName?: string },
): Promise<AdmissionDoc> {
  const db = wardDB();
  const admission = await db.get(admissionId) as AdmissionDoc;
  if (admission.status === 'transferred') return admission;
  if (admission.status !== 'admitted') throw new WardWorkflowError('Only an active admission can be transferred.', 'ADMISSION_NOT_ACTIVE');
  const originalBedId = admission.bedId;
  if (originalBedId) await updateBedStatus(originalBedId, 'cleaning');
  const now = new Date().toISOString();
  const updated = withPendingOfflineSync({
    ...admission,
    status: 'transferred' as const,
    dischargeDate: now,
    dischargeType: 'transfer' as const,
    dischargeDiagnosis: admission.admittingDiagnosis,
    dischargeSummary: `Transferred through ${transfer.id}. ${transfer.reason}`.trim(),
    dischargedBy: transfer.actorId,
    dischargedByName: transfer.actorName,
    transferredTo: transfer.destinationName,
    transferReason: transfer.reason,
    followUpRequired: false,
    medicationReconciled: true,
    medicationReconciledAt: now,
    lengthOfStay: Math.max(1, Math.ceil((Date.now() - new Date(admission.admissionDate).getTime()) / 86_400_000)),
    updatedAt: now,
  }, now);
  try {
    const response = await db.put(updated);
    updated._rev = response.rev;
    await updateWardOccupancy(updated.wardId);
    await logAuditSafe('ADMISSION_TRANSFERRED', transfer.actorId, transfer.actorName, `Closed ${updated.patientName}'s admission for transfer ${transfer.id}`);
    emitSyncEvent({ resourceType: 'admission', resourceId: updated._id, operation: 'update', resourceVersion: updated._rev, orgId: updated.orgId, hospitalId: updated.facilityId });
    return updated;
  } catch (error) {
    if (originalBedId) await restoreBedClaimIfUnassigned(originalBedId, admission).catch(() => undefined);
    throw error;
  }
}

/**
 * Recalculate and update ward occupancy counts.
 */
async function updateWardOccupancy(wardId: string): Promise<void> {
  const db = wardDB();
  try {
    const ward = await db.get(wardId) as WardDoc;
    const beds = await getBedsByWard(wardId);
    ward.occupiedBeds = beds.filter(b => b.status === 'occupied').length;
    ward.availableBeds = ward.totalBeds - ward.occupiedBeds;
    ward.updatedAt = new Date().toISOString();
    const pendingWard = withPendingOfflineSync(ward);
    const resp = await db.put(pendingWard);
    ward._rev = resp.rev;
    ward.offlineSync = pendingWard.offlineSync;
    emitSyncEvent({
      resourceType: 'ward',
      resourceId: ward._id,
      operation: 'update',
      resourceVersion: ward._rev,
      orgId: ward.orgId,
      hospitalId: ward.facilityId,
    });
  } catch {
    // Ward occupancy update is best-effort
  }
}

/**
 * Get occupancy statistics across all wards for a facility.
 */
export async function getOccupancyStats(facilityId: string, scope?: DataScope): Promise<{
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  occupancyRate: number;
  wardBreakdown: { wardName: string; wardType: string; totalBeds: number; occupiedBeds: number; availableBeds: number }[];
}> {
  const wards = await getAllWards(scope);
  const facilityWards = wards.filter(w => w.facilityId === facilityId && w.isActive);
  const bedRows = await Promise.all(facilityWards.map(async ward => ({
    ward,
    beds: await getBedsByWard(ward._id, scope),
  })));
  const totalBeds = bedRows.reduce((sum, row) => sum + (row.beds.length || row.ward.totalBeds), 0);
  const occupiedBeds = bedRows.reduce((sum, row) => sum + row.beds.filter(bed => bed.status === 'occupied').length, 0);
  const availableBeds = bedRows.reduce((sum, row) => sum + row.beds.filter(bed => bed.status === 'available').length, 0);

  return {
    totalBeds,
    occupiedBeds,
    availableBeds,
    occupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
    wardBreakdown: bedRows.map(({ ward, beds }) => ({
      wardName: ward.name,
      wardType: ward.wardType,
      totalBeds: beds.length || ward.totalBeds,
      occupiedBeds: beds.filter(bed => bed.status === 'occupied').length,
      availableBeds: beds.filter(bed => bed.status === 'available').length,
    })),
  };
}
