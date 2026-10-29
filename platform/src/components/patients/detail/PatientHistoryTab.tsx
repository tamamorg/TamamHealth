'use client';
import type { ANCVisitDoc } from '@/lib/db-types';
import RecordSignatureBar from '@/components/patients/RecordSignatureBar';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import type { AppointmentDoc, ImmunizationDoc, LabResultDoc, MedicalRecordDoc, PrescriptionDoc, TriageDoc } from '@/lib/db-types';
import { PatientTimeline } from './lazy-panels';
import { useUrlView } from '@/lib/navigation/use-url-view';
import VisitsTable from './VisitsTable';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PatientDoc, ProblemDoc } from '@/lib/db-types';
import type { VitalsTimelineEntry } from '@/lib/clinical/vitals';
import type { ReferralDoc } from '@/lib/db-types';
export default function PatientHistoryTab({ patient, patientProblems, vitalsTimeline, facilityName, records, clinicalNotes, allLabResults, allPrescriptions, allImmunizations, patientReferrals, patientANC, patientAppointments, patientTriages, canViewClinical, focusId }: {
  patient: PatientDoc;
  patientProblems: ProblemDoc[];
  vitalsTimeline: VitalsTimelineEntry[];
  facilityName?: string;
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
  const { t } = useTranslation();
  // Visits (one row per visit, O3) by default; a deep link to one event
  // (?focus=) lands on All encounters, the view that can highlight it.
  const [view, setView] = useUrlView(['visits', 'all'] as const, focusId ? 'all' : 'visits');
  return (
    <div>
      <div className="vt-tabs" role="tablist" aria-label={t('visits.views')}>
        <button type="button" role="tab" aria-selected={view === 'visits'} className={view === 'visits' ? 'is-active' : ''} onClick={() => setView('visits')}>{t('visits.tabVisits')}</button>
        <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>{t('visits.tabAll')}</button>
      </div>
      {view === 'visits' ? (
        <VisitsTable
          patient={patient}
          facilityName={facilityName}
          records={records}
          notes={clinicalNotes}
          labs={allLabResults}
          prescriptions={allPrescriptions}
          problems={patientProblems}
          triages={patientTriages}
          appointments={patientAppointments}
          vitalsTimeline={vitalsTimeline}
          canViewClinical={canViewClinical}
        />
      ) : (
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
      )}
    </div>
  );
}
