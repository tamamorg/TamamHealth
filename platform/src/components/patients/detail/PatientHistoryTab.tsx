'use client';
import { useRouter } from 'next/navigation';
import type { ANCVisitDoc } from '@/lib/db-types';
import type { ClinicalNoteDoc } from '@/lib/clinical-notes/types';
import type { AppointmentDoc, ImmunizationDoc, LabResultDoc, MedicalRecordDoc, PrescriptionDoc, TriageDoc } from '@/lib/db-types';
import { PatientTimeline } from './lazy-panels';
import { useUrlView } from '@/lib/navigation/use-url-view';
import VisitsTable from './VisitsTable';
import ChartSection from '@/components/ehr/chart/ChartSection';
import ClinicalNoteViewer from '@/components/clinical-notes/ClinicalNoteViewer';
import type { TimelineCategory, TimelineEvent } from '@/components/PatientTimeline';
import RowActionsMenu, { type RowAction } from '@/components/RowActionsMenu';
import { recordSignRights } from '@/lib/clinical-roles';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PatientDoc, ProblemDoc } from '@/lib/db-types';
import type { VitalsTimelineEntry } from '@/lib/clinical/vitals';
import type { ReferralDoc } from '@/lib/db-types';
import type { RecordPanelIntent } from './RecordSignPanel';

/** Where a row that is not a document of its own is opened from. */
const EVENT_TAB: Partial<Record<TimelineCategory, string>> = {
  triage: 'vitals',
  lab: 'labs',
  prescription: 'prescriptions',
  immunization: 'immunizations',
  referral: 'referrals',
  anc: 'anc',
  appointment: 'appointments',
};

export default function PatientHistoryTab({ patient, patientProblems, vitalsTimeline, facilityName, records, clinicalNotes, allLabResults, allPrescriptions, allImmunizations, patientReferrals, patientANC, patientAppointments, patientTriages, canViewClinical, canConsult, focusId, onOpenRecord, noteViewer, setNoteViewer, setChartPanelRequest }: {
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
  canConsult: boolean;
  focusId: string | undefined;
  onOpenRecord: (recordId: string, intent?: RecordPanelIntent) => void;
  noteViewer: { id: string; kind: 'clinical' | 'record' } | null;
  setNoteViewer: (viewer: { id: string; kind: 'clinical' | 'record' } | null) => void;
  setChartPanelRequest: (request: string | null) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { isProvider, canAuthor } = recordSignRights(currentUser?.role);
  // Visits (one row per visit, O3) by default; a deep link to one event
  // (?focus=) lands on All encounters, the view that can highlight it.
  const [view, setView] = useUrlView(['visits', 'all'] as const, focusId ? 'all' : 'visits');

  // Reading a note stays on the chart, as on the Notes tab. A draft opens whole
  // there too, with its Edit and Sign, so it is read before it is signed.
  const openNote = (id: string) => setNoteViewer({ id, kind: 'clinical' });
  const openEvent = (event: TimelineEvent) => {
    if (!event.docId) return;
    if (event.category === 'note') openNote(event.docId);
    else onOpenRecord(event.docId);
  };

  const eventActions = (event: TimelineEvent): RowAction[] => {
    const { docId, sourceId, category } = event;
    if (docId && category === 'consultation') {
      const status = records.find(r => r._id === docId)?.documentStatus ?? 'draft';
      const signed = status === 'signed' || status === 'amended';
      const actions: RowAction[] = [{ key: 'view', label: t('recordSign.view'), onClick: () => onOpenRecord(docId) }];
      if (status === 'draft' && canAuthor) actions.push({ key: 'sign', label: t(isProvider ? 'noteEditor.sign' : 'recordSign.signRoute'), onClick: () => onOpenRecord(docId) });
      if (status === 'awaiting_cosign' && isProvider) actions.push({ key: 'cosign', label: t('recordSign.cosign'), onClick: () => onOpenRecord(docId) });
      if (signed && canAuthor) actions.push({ key: 'addendum', label: t('noteViewer.addAddendum'), onClick: () => onOpenRecord(docId, 'addendum') });
      return actions;
    }
    if (docId && category === 'note') {
      const draft = clinicalNotes.find(n => n._id === docId)?.status === 'draft';
      return [{ key: 'open', label: t(draft && canConsult ? 'noteEditor.sign' : 'timeline.viewNote'), onClick: () => openNote(docId) }];
    }
    const tab = EVENT_TAB[category];
    if (!tab) return [];
    const focus = sourceId ? `&focus=${encodeURIComponent(sourceId)}` : '';
    return [{ key: 'open', label: t('timeline.openRecord'), onClick: () => router.push(`/patients/${patient._id}?tab=${tab}${focus}`) }];
  };

  // The chart's own section, titled like every other tab; the Visits / All
  // encounters switch sits in its controls, where the other tabs put theirs.
  return (
    <ChartSection
      title={t('chart.rail.history')}
      toggleSlot={(
        <div className="vt-tabs" role="tablist" aria-label={t('visits.views')}>
          <button type="button" role="tab" aria-selected={view === 'visits'} className={view === 'visits' ? 'is-active' : ''} onClick={() => setView('visits')}>{t('visits.tabVisits')}</button>
          <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'is-active' : ''} onClick={() => setView('all')}>{t('visits.tabAll')}</button>
        </div>
      )}
    >
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
              // A document's detail, signature and addenda all live in the
              // chart's sidebar; a row only opens it and offers the decision.
              onOpenEvent={canViewClinical ? openEvent : undefined}
              renderEventActions={canViewClinical ? event => <RowActionsMenu actions={eventActions(event)} ariaLabel={t('timeline.actions')} /> : undefined}
              focusId={focusId}
            />
      )}
      {noteViewer && (
        <ClinicalNoteViewer
          presentation="slider"
          noteId={noteViewer.id}
          kind={noteViewer.kind}
          onClose={() => setNoteViewer(null)}
          onEdit={canConsult ? id => { setNoteViewer(null); setChartPanelRequest(`clinical-note:${id}:edit`); } : undefined}
        />
      )}
    </ChartSection>
  );
}
