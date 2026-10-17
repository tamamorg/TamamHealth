/**
 * Clinical fields a caller may write on a medical record through the HTTP API.
 * Shared by POST (create) and PATCH so the two cannot drift: lifecycle and
 * attestation fields (documentStatus, signed*, cosigned*, addenda, type,
 * createdAt, updatedAt) are server-owned and never accepted from a body.
 */
export const RECORD_EDITABLE_FIELDS = [
  'visitDate', 'consultedAt', 'startedAt', 'visitType', 'visitDisposition', 'department',
  'chiefComplaint', 'historyOfPresentIllness', 'chiefComplaints', 'reviewOfSystems',
  'pastMedicalHistory', 'familyHistory', 'socialHistory', 'drugHistory', 'vitalSigns',
  'triageVitals', 'physicalExamination', 'diagnoses', 'prescriptions', 'labResults',
  'treatmentPlan', 'attachments', 'followUp', 'fluidBalance',
  'labOrderIds', 'prescriptionIds',
] as const;

/** Extra fields accepted only at creation: the patient link and the visit links. */
export const RECORD_CREATE_ONLY_FIELDS = ['patientId', 'encounterId', 'triageId'] as const;
