'use client';
import type { ANCVisitDoc } from '@/lib/db-types';
import RecordSignatureBar from '@/components/patients/RecordSignatureBar';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import type { AppointmentDoc, ImmunizationDoc, LabResultDoc, MedicalRecordDoc, PrescriptionDoc, TriageDoc } from '@/lib/db-types';
import { PatientTimeline } from './lazy-panels';
import type { ReferralDoc } from '@/lib/db-types';
export default function PatientHistoryTab({ records, clinicalNotes, allLabResults, allPrescriptions, allImmunizations, patientReferrals, patientANC, patientAppointments, patientTriages, canViewClinical, focusId }: {
  records: MedicalRecordDoc[];
  clinicalNotes: ClinicalNoteDoc[];
  allLabResults: LabResultDoc[];
  allPrescriptions: PrescriptionDoc[];
  allImmunizations: ImmunizationDoc[];
  patientReferrals: ReferralDoc[];
  patientANC: ANCVisitDoc[];
  patientAppointments: AppointmentDoc[];
  patientTriages: TriageDoc[];
  canViewClinical: boolean;
  focusId: string | undefined;
}) {
  return (
            <PatientTimeline
              medicalRecords={records}
              clinicalNotes={clinicalNotes}
              labResults={allLabResults || []}
              prescriptions={allPrescriptions || []}
              immunizations={allImmunizations || []}
              referrals={patientReferrals}
              ancVisits={patientANC}
              appointments={patientAppointments}
              triages={patientTriages}
              // Consultation records carry a full sign / co-sign / addendum
              // lifecycle that no screen had ever mounted, so visits were never
              // attested or locked. The controls belong on the visit itself.
              renderRecordSignature={canViewClinical ? recordId => {
                const rec = records.find(r => r._id === recordId);
                return rec ? <RecordSignatureBar record={rec} /> : null;
              } : undefined}
              focusId={focusId}
            />
  );
}
