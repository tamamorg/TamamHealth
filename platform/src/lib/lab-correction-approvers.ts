/**
 * Who may approve or reject a proposed correction to a filed lab result.
 *
 * Four eyes: the proposer never approves their own correction. A lab tech
 * proposes; any OTHER lab tech at the facility may approve, and so may a
 * clinician at the same facility, so a facility with a single lab tech can
 * still correct a result. One list, shared by the chart UI and the CouchDB
 * validator (write-permissions.ts), so the two never drift. No imports: the
 * validator image copies this file by name.
 */
export const LAB_CORRECTION_CLINICIAN_APPROVERS: readonly string[] = [
  'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
];

export function isLabCorrectionApproverRole(role: string | undefined | null): boolean {
  return role === 'lab_tech' || (!!role && LAB_CORRECTION_CLINICIAN_APPROVERS.includes(role));
}
