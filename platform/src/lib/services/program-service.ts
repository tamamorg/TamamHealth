/**
 * Care-program enrollment service.
 *
 * Tracks which clinical programs (ART/HIV care, TB (DS/DR), PMTCT, ANC,
 * Nutrition (OTP/SFP), EPI/Immunization, NCD clinic, or a free-text "other")
 * a patient is currently — or was previously — enrolled in. Anchored to the
 * patient (not an encounter), same shape/lifecycle as the Problem List
 * service (`problem-service.ts`), which this file mirrors closely.
 */
import { programEnrollmentsDB, hospitalsDB } from '../db';
import type { ProgramEnrollmentDoc, HospitalDoc, ProgramEnrollmentStatus } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { todayIso } from '@/lib/date-utils';

async function inferOrgIdFromHospital(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const hosp = await hospitalsDB().get(hospitalId) as HospitalDoc;
    return hosp.orgId;
  } catch {
    return undefined;
  }
}

export async function getAllProgramEnrollments(scope?: DataScope): Promise<ProgramEnrollmentDoc[]> {
  const db = programEnrollmentsDB();
  const all = (await findByType<ProgramEnrollmentDoc>(db, 'program_enrollment'))
    .sort((a, b) => (b.enrollmentDate || b.createdAt || '').localeCompare(a.enrollmentDate || a.createdAt || ''));
  return scope ? filterByScope(all, scope) : all;
}

export async function getProgramEnrollmentsByPatient(patientId: string): Promise<ProgramEnrollmentDoc[]> {
  const all = await getAllProgramEnrollments();
  return all.filter(p => p.patientId === patientId);
}

export async function createProgramEnrollment(
  data: Omit<ProgramEnrollmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
): Promise<ProgramEnrollmentDoc> {
  const db = programEnrollmentsDB();
  const now = new Date().toISOString();
  const orgId = data.orgId || await inferOrgIdFromHospital(data.hospitalId);
  const doc: ProgramEnrollmentDoc = {
    _id: `program-enrollment-${uuidv4()}`,
    type: 'program_enrollment',
    ...data,
    orgId,
    createdAt: now,
    updatedAt: now,
  } as ProgramEnrollmentDoc;
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe(
    'PROGRAM_ENROLLMENT_CREATED',
    undefined,
    data.recordedByName,
    `Program enrollment ${doc._id}: ${doc.programName} for ${doc.patientName || doc.patientId} (${doc.status})`,
  );
  emitSyncEvent({
    resourceType: 'program_enrollment',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    orgId: doc.orgId,
    hospitalId: doc.hospitalId,
  });
  return doc;
}

export async function updateProgramEnrollment(id: string, data: Partial<ProgramEnrollmentDoc>): Promise<ProgramEnrollmentDoc | null> {
  const db = programEnrollmentsDB();
  try {
    const existing = await db.get(id) as ProgramEnrollmentDoc;
    const updated: ProgramEnrollmentDoc = {
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      type: 'program_enrollment',
      updatedAt: new Date().toISOString(),
    };
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    await logAuditSafe('PROGRAM_ENROLLMENT_UPDATED', undefined, undefined, `Program enrollment ${id} status: ${updated.status}`);
    emitSyncEvent({
      resourceType: 'program_enrollment',
      resourceId: updated._id,
      operation: 'update',
      resourceVersion: updated._rev,
      orgId: updated.orgId,
      hospitalId: updated.hospitalId,
    });
    return updated;
  } catch {
    return null;
  }
}

export async function deleteProgramEnrollment(id: string): Promise<boolean> {
  const db = programEnrollmentsDB();
  try {
    const doc = await db.get(id);
    const typed = doc as unknown as ProgramEnrollmentDoc;
    await db.remove(doc);
    await logAuditSafe('DELETE_PROGRAM_ENROLLMENT', undefined, undefined, `Program enrollment ${id}: ${typed.programName} for ${typed.patientName || typed.patientId}`);
    emitSyncEvent({
      resourceType: 'program_enrollment',
      resourceId: id,
      operation: 'delete',
      orgId: typed.orgId,
      hospitalId: typed.hospitalId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Transition an enrollment's status. Non-active (terminal) statuses stamp
 * `outcomeDate` with today; moving back to `active` (e.g. a patient returns
 * to care after being lost to follow-up) clears it.
 */
export async function setProgramEnrollmentStatus(id: string, status: ProgramEnrollmentStatus): Promise<ProgramEnrollmentDoc | null> {
  const patch: Partial<ProgramEnrollmentDoc> = { status };
  patch.outcomeDate = status === 'active' ? undefined : todayIso();
  return updateProgramEnrollment(id, patch);
}
