/**
 * Shared helper for the patient-chart "embedded list" services — allergies,
 * directives and care alerts all store an array of `{ id }` records on the
 * patient document and mutate it through the same flow:
 *
 *   read latest patient → transform the array → persist via mutatePatient
 *   (optimistic-concurrency retry) → write an audit entry → return the new array.
 *
 * This collapses that triplicated boilerplate into one place so the individual
 * services only express their own add/update/remove transform.
 */
import type { PatientDoc } from '../db-types';
import { getPatientById, mutatePatient } from './patient-service';
import type { DataScope } from './data-scope';
import { logAuditSafe } from './audit-service';

export interface ListMutationAudit {
  action: string;
  by?: string;
  byName?: string;
  detail: string;
}

/**
 * Atomically apply a change to one of a patient's embedded list fields.
 *
 * `compute` receives the LATEST persisted patient (re-invoked on a write
 * conflict) and returns the field patch plus the resulting entries — or `null`
 * to abort as a no-op (e.g. the target id was not found). Returns the new
 * entries, or `null` when the patient is missing, OUT OF `scope` (indistinguishable
 * from missing, like every scoped read) or the change was aborted.
 *
 * The scope check runs BEFORE any write: `mutatePatient` reads by raw id, so
 * without it any caller who knew a patient id could edit another org's chart.
 */
export async function mutatePatientListField<T>(
  patientId: string,
  scope: DataScope,
  compute: (patient: PatientDoc) => { patch: Partial<PatientDoc>; entries: T[] } | null,
  audit: ListMutationAudit,
): Promise<T[] | null> {
  if (!(await getPatientById(patientId, scope))) return null;
  let entries: T[] | null = null;
  const updated = await mutatePatient(patientId, (patient) => {
    const result = compute(patient);
    if (!result) return null;
    entries = result.entries;
    return result.patch;
  });
  if (!updated || entries === null) return null;
  await logAuditSafe(audit.action, audit.by, audit.byName, audit.detail);
  return entries;
}
