import { patientsDB, medicalRecordsDB, labResultsDB } from '../db';
import type { PatientDoc, MedicalRecordDoc, LabResultDoc } from '../db-types';
import type { TransferPackage, Attachment } from '@/data/mock';
import { findByType } from './db-query';

export async function assembleTransferPackage(
  patientId: string,
  packagedBy: string
): Promise<TransferPackage> {
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
  packageSizeBytes += (cleanRecords.length + labResults.length) * 1024;

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
