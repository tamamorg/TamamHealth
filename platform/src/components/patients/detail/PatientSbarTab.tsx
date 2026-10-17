'use client';
import type { PatientShiftHandoff } from '@/lib/hooks/usePatientHandoff';
import type { LabResultDoc, MedicalRecordDoc, PatientDoc, PrescriptionDoc, ProblemDoc, TriageDoc } from '@/lib/db-types';
import { PatientSBAR } from './lazy-panels';
export default function PatientSbarTab({ patient, records, allLabResults, allPrescriptions, patientTriages, patientProblems, latestShiftHandoff }: {
  patient: PatientDoc;
  records: MedicalRecordDoc[];
  allLabResults: LabResultDoc[];
  allPrescriptions: PrescriptionDoc[];
  patientTriages: TriageDoc[];
  patientProblems: ProblemDoc[];
  latestShiftHandoff: PatientShiftHandoff | null;
}) {
  return (
            <>
              <PatientSBAR
                patient={patient}
                records={records}
                labs={(allLabResults || []).filter(l => l.patientId === patient._id)}
                prescriptions={(allPrescriptions || []).filter(r => r.patientId === patient._id)}
                triages={patientTriages}
                problems={patientProblems}
                latestShiftHandoff={latestShiftHandoff}
              />
            </>
  );
}
