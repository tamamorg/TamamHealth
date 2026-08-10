/**
 * Ward Management Service — handles ward/bed tracking, admissions,
 * discharges, and bed occupancy for inpatient facilities.
 *
 * Applicable to Level 3+ facilities (County, State, National hospitals).
 */
import { getDB } from '../db';
import type { WardDoc, BedDoc, AdmissionDoc, BedStatus } from '../db-types-ward';
import type { UserRole } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { withPendingOfflineSync } from '../sync/offline-metadata';

const wardDB = () => getDB('tamamhealth_wards');

// ===== Ward Operations =====

export async function getAllWards(scope?: DataScope): Promise<WardDoc[]> {
  const db = wardDB();
  const all = (await findByType<WardDoc>(db, 'ward'))
    .sort((a, b) => a.name.localeCompare(b.name));
  return scope ? filterByScope(all, scope) : all;
}

export async function getWardById(id: string): Promise<WardDoc | null> {
  try {
    const db = wardDB();
    return await db.get(id) as WardDoc;
  } catch {
    return null;
  }
}

export async function createWard(data: Omit<WardDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'occupiedBeds' | 'availableBeds'>): Promise<WardDoc> {
  const db = wardDB();
  const now = new Date().toISOString();
  const doc: WardDoc = withPendingOfflineSync({
    _id: `ward-${uuidv4().slice(0, 8)}`,
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

export async function getBedsByWard(wardId: string): Promise<BedDoc[]> {
  const db = wardDB();
  const rows = await findByType<BedDoc>(db, 'bed', { wardId }, { indexFields: ['type', 'wardId'] });
  return rows
    .sort((a, b) => a.bedNumber.localeCompare(b.bedNumber));
}

export async function getAvailableBeds(wardId: string): Promise<BedDoc[]> {
  const beds = await getBedsByWard(wardId);
  return beds.filter(b => b.status === 'available');
}

export async function updateBedStatus(bedId: string, status: BedStatus, patientId?: string, patientName?: string, admissionId?: string): Promise<BedDoc | null> {
  const db = wardDB();
  try {
    const bed = await db.get(bedId) as BedDoc;
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
    const resp = await db.put(pendingBed);
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
  } catch {
    return null;
  }
}

// ===== Admission Operations =====

export async function getAllAdmissions(scope?: DataScope): Promise<AdmissionDoc[]> {
  const db = wardDB();
  const all = await findByType<AdmissionDoc>(db, 'admission');
  /* istanbul ignore next -- defensive null-safety in sort */
  all.sort((a, b) => (b.admissionDate || '').localeCompare(a.admissionDate || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getActiveAdmissions(scope?: DataScope): Promise<AdmissionDoc[]> {
  const all = await getAllAdmissions(scope);
  return all.filter(a => a.status === 'admitted');
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

  const doc: AdmissionDoc = withPendingOfflineSync({
    _id: `adm-${uuidv4().slice(0, 8)}`,
    type: 'admission',
    ...data,
    encounterId,
    admissionDate: now,
    isolationRequired: data.isolationRequired || false,
    status: 'admitted',
    followUpRequired: false,
    createdAt: now,
    updatedAt: now,
  }, now);

  const resp = await db.put(doc);
  doc._rev = resp.rev;

  // Update bed status if a bed was assigned
  if (data.bedId) {
    await updateBedStatus(data.bedId, 'occupied', data.patientId, data.patientName, doc._id);
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

  return doc;
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

  const now = new Date().toISOString();
  if (admission.bedId) await updateBedStatus(admission.bedId, 'cleaning');
  const updated = withPendingOfflineSync({
    ...admission,
    wardId: destination.wardId,
    wardName: destination.wardName,
    bedId: destination.bedId,
    bedNumber: destination.bedNumber,
    updatedAt: now,
  }, now);
  const response = await db.put(updated);
  updated._rev = response.rev;
  await updateBedStatus(destination.bedId, 'occupied', admission.patientId, admission.patientName, admission._id);
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
  }
): Promise<AdmissionDoc | null> {
  const db = wardDB();
  try {
    const admission = await db.get(admissionId) as AdmissionDoc;
    const now = new Date().toISOString();

    admission.status = dischargeData.dischargeType === 'death' ? 'deceased' : 'discharged';
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

    // Calculate length of stay
    const admDate = new Date(admission.admissionDate);
    const discDate = new Date(now);
    admission.lengthOfStay = Math.max(1, Math.ceil((discDate.getTime() - admDate.getTime()) / (1000 * 60 * 60 * 24)));

    admission.updatedAt = now;
    const pendingAdmission = withPendingOfflineSync(admission, now);
    const resp = await db.put(pendingAdmission);
    admission._rev = resp.rev;
    admission.offlineSync = pendingAdmission.offlineSync;

    // Free the bed
    if (admission.bedId) {
      await updateBedStatus(admission.bedId, 'cleaning');
    }

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
  } catch {
    return null;
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
export async function getOccupancyStats(facilityId: string): Promise<{
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  occupancyRate: number;
  wardBreakdown: { wardName: string; wardType: string; totalBeds: number; occupiedBeds: number; availableBeds: number }[];
}> {
  const wards = await getAllWards();
  const facilityWards = wards.filter(w => w.facilityId === facilityId && w.isActive);

  const totalBeds = facilityWards.reduce((s, w) => s + w.totalBeds, 0);
  const occupiedBeds = facilityWards.reduce((s, w) => s + w.occupiedBeds, 0);
  const availableBeds = totalBeds - occupiedBeds;

  return {
    totalBeds,
    occupiedBeds,
    availableBeds,
    occupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
    wardBreakdown: facilityWards.map(w => ({
      wardName: w.name,
      wardType: w.wardType,
      totalBeds: w.totalBeds,
      occupiedBeds: w.occupiedBeds,
      availableBeds: w.availableBeds,
    })),
  };
}
