import { patientsDB, medicalRecordsDB, labResultsDB } from '../db';
import type { PatientDoc, MedicalRecordDoc, LabResultDoc } from '../db-types';
import type { TransferPackage, Attachment } from '@/data/mock';
import { findByType } from './db-query';

/** One signed clinical note, as carried in a transfer package. */
export interface TransferPackageClinicalNote {
  id: string;
  noteType: string;
  serviceDate: string;
  serviceTime?: string;
  hospitalName?: string;
  authorName?: string;
  signedByName?: string;
  signedAt?: string;
  sections: { sectionId: string; text?: string }[];
}

/** One problem-list entry, as carried in a transfer package. */
export interface TransferPackageProblem {
  id: string;
  name: string;
  icd11Code?: string;
  status: string;
  onsetDate?: string;
  severity?: string;
}

/** One active prescription, as carried in a transfer package. */
export interface TransferPackagePrescription {
  id: string;
  medication: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  prescribedBy: string;
  status: string;
  indication?: string;
}

/**
 * `TransferPackage` (data/mock.ts) predates the notes/problem-list/pharmacy
 * modules and only carries legacy MedicalRecordDoc + LabResultDoc data. A
 * receiving facility got a referral with no clinical narrative, no problem
 * list and no current medications whenever the sending visit was documented
 * (as every visit now is) through the notes module instead of the legacy
 * consultation path. Extending the shape here — rather than editing the
 * shared mock.ts type this fix's scope did not cover — keeps every existing
 * caller (typed on plain `TransferPackage`) working unchanged, since this is
 * a structural superset of it.
 */
export interface TransferPackageWithClinicalHistory extends TransferPackage {
  clinicalNotes: TransferPackageClinicalNote[];
  problems: TransferPackageProblem[];
  activePrescriptions: TransferPackagePrescription[];
}

export async function assembleTransferPackage(
  patientId: string,
  packagedBy: string
): Promise<TransferPackageWithClinicalHistory> {
  // Get patient demographics
  const pDb = patientsDB();
  // Direct fetch by _id. This previously pulled EVERY patient document into
  // memory and then ran Array.find over them to locate one known id — an O(N)
  // scan of the whole patient database to answer a primary-key lookup.
  let patientDoc: PatientDoc | undefined;
  try {
    patientDoc = await pDb.get(patientId) as PatientDoc;
  } catch {
    patientDoc = undefined;
  }

  if (!patientDoc) {
    throw new Error(`Patient ${patientId} not found`);
  }

  // Get all medical records for patient
  const mrDb = medicalRecordsDB();
  const medicalRecords = (await findByType<MedicalRecordDoc>(mrDb, 'medical_record', { patientId }, { indexFields: ['type', 'patientId'] }))
    .sort((a, b) => (b.visitDate || '').localeCompare(a.visitDate || ''));

  // Get all lab results for patient
  const labDb = labResultsDB();
  const labResults = (await findByType<LabResultDoc>(labDb, 'lab_result', { patientId }, { indexFields: ['type', 'patientId'] }))
    .map(lab => ({
      testName: lab.testName,
      result: lab.result,
      unit: lab.unit,
      referenceRange: lab.referenceRange,
      abnormal: lab.abnormal,
      critical: lab.critical,
      date: lab.completedAt || lab.orderedAt,
      hospitalName: undefined as string | undefined,
    }));

  // Also collect inline lab results from medical records
  for (const rec of medicalRecords) {
    for (const lab of rec.labResults || []) {
      labResults.push({
        testName: lab.testName,
        result: lab.result,
        unit: lab.unit,
        referenceRange: lab.referenceRange,
        abnormal: lab.abnormal,
        critical: lab.critical,
        date: lab.date,
        hospitalName: rec.hospitalName,
      });
    }
  }

  // Collect all attachments from medical records
  const allAttachments: Attachment[] = [];
  for (const rec of medicalRecords) {
    if (rec.attachments) {
      allAttachments.push(...rec.attachments);
    }
  }

  // Signed clinical notes — the current documentation path (medical_record is
  // the legacy consultation flow no browser UI writes to any more). Only
  // attested notes travel with the referral: an unsigned draft is not yet a
  // record of what happened at this visit.
  const { getNotesByPatient } = await import('../clinical-notes/note-service');
  const clinicalNotes: TransferPackageClinicalNote[] = (await getNotesByPatient(patientId))
    .filter(n => n.status === 'signed' || n.status === 'amended')
    .map(n => ({
      id: n._id,
      noteType: n.noteType,
      serviceDate: n.serviceDate,
      serviceTime: n.serviceTime,
      hospitalName: n.hospitalName,
      authorName: n.authorName,
      signedByName: n.signedByName,
      signedAt: n.signedAt,
      sections: n.sections.map(s => ({ sectionId: s.sectionId, text: s.text })),
    }));

  // The problem list — chronic/ongoing conditions a receiving clinician needs
  // regardless of which visit is being referred.
  const { getProblemsByPatient } = await import('./problem-service');
  const problems: TransferPackageProblem[] = (await getProblemsByPatient(patientId)).map(p => ({
    id: p._id,
    name: p.name,
    icd11Code: p.icd11Code,
    status: p.status,
    onsetDate: p.onsetDate,
    severity: p.severity,
  }));

  // Active prescriptions — 'pending' is this codebase's existing definition
  // of "active" (see prescription-service's own duplicate/interaction
  // checks): an order still outstanding, not yet dispensed or discontinued.
  const { getPrescriptionsByPatient } = await import('./prescription-service');
  const activePrescriptions: TransferPackagePrescription[] = (await getPrescriptionsByPatient(patientId))
    .filter(rx => rx.status === 'pending')
    .map(rx => ({
      id: rx._id,
      medication: rx.medication,
      dose: rx.dose,
      route: rx.route,
      frequency: rx.frequency,
      duration: rx.duration,
      prescribedBy: rx.prescribedBy,
      status: rx.status,
      indication: rx.indication,
    }));

  // Convert records to plain objects (strip PouchDB fields)
  const cleanRecords = medicalRecords.map(rec => ({
    id: rec._id,
    patientId: rec.patientId,
    hospitalId: rec.hospitalId,
    hospitalName: rec.hospitalName,
    visitDate: rec.visitDate,
    visitType: rec.visitType,
    providerName: rec.providerName,
    providerRole: rec.providerRole,
    department: rec.department,
    chiefComplaint: rec.chiefComplaint,
    historyOfPresentIllness: rec.historyOfPresentIllness,
    vitalSigns: rec.vitalSigns,
    diagnoses: rec.diagnoses,
    prescriptions: rec.prescriptions,
    labResults: rec.labResults,
    treatmentPlan: rec.treatmentPlan,
    attachments: rec.attachments,
    followUp: rec.followUp,
    syncStatus: rec.syncStatus,
  }));

  // Estimate package size (rough: base64 data of attachments + JSON overhead)
  let packageSizeBytes = 0;
  for (const att of allAttachments) {
    packageSizeBytes += att.sizeBytes;
  }
  // Add estimated JSON overhead (~1KB per record)
  packageSizeBytes += (cleanRecords.length + labResults.length
    + clinicalNotes.length + problems.length + activePrescriptions.length) * 1024;

  return {
    patientDemographics: {
      id: patientDoc._id,
      hospitalNumber: patientDoc.hospitalNumber,
      firstName: patientDoc.firstName,
      middleName: patientDoc.middleName,
      surname: patientDoc.surname,
      dateOfBirth: patientDoc.dateOfBirth,
      gender: patientDoc.gender,
      phone: patientDoc.phone,
      state: patientDoc.state,
      county: patientDoc.county,
      tribe: patientDoc.tribe,
      bloodType: patientDoc.bloodType,
      allergies: patientDoc.allergies,
      chronicConditions: patientDoc.chronicConditions,
      nokName: patientDoc.nokName,
      nokPhone: patientDoc.nokPhone,
      nokRelationship: patientDoc.nokRelationship,
    },
    medicalRecords: cleanRecords,
    labResults,
    attachments: allAttachments,
    clinicalNotes,
    problems,
    activePrescriptions,
    packagedAt: new Date().toISOString(),
    packagedBy,
    packageSizeBytes,
  };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix to get pure base64
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function attachmentToDataUrl(attachment: Attachment): string {
  return `data:${attachment.mimeType};base64,${attachment.base64Data}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
