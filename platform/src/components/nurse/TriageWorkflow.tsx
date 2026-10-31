'use client';

import { AlertTriangle, X } from '@/components/icons/lucide';
import { todayIso } from '@/lib/date-utils';
import { countActiveRedTriage } from './triage-queue';
import { ACCENT } from './shared';
import { useTriageForm } from './triage/useTriageForm';
import type { TriageWorkflowProps } from './triage/types';
import { TriageRail } from './triage/TriageRail';
import { TriagePatientPicker, TriageChiefComplaint, TriageVitalSafetySummary } from './triage/TriageIntakeSections';
import { TriageAbccAssessment, TriageDangerSigns, TriagePriorityResult } from './triage/TriageAssessmentSections';
import { TriageVitalsSection, TriageIntakeHistory, TriageVisitContext, TriageHandoffSection, TriageNotesSection, TriageFormActions } from './triage/TriageDetailSections';
import { TriageRecentList } from './triage/TriageRecentList';
import { O3Layout } from '@/components/forms/O3Form';
import '@/components/forms/o3-form.css';

export { mayAutoResume } from './triage/triage-helpers';

export default function TriageWorkflow(props: TriageWorkflowProps) {
  const f = useTriageForm(props);
  const { t, triageHistory, draftRestoredNotice, setDraftRestoredNotice, clearForm, lockedPatientId } = f;
  const embedded = !!props.embedded;

  // In a slider or the chart workspace the assessment is an O3 form: its
  // sections become pages and sections of the O3 frame, Save / Cancel sit
  // under the page list. The questions are the station's own components, so
  // every rule they carry (vital safety, auto-priority, drafts) is unchanged.
  if (embedded && lockedPatientId) {
    const { editingTriageId, triageData, triageSubmitting, selectedTriagePatient, handleSubmitTriage, clearForm } = f;
    return (
      <O3Layout
        className="o3f-triage"
        notice={draftRestoredNotice ? (
          <div className="o3f-notice o3f-triage-draft">
            <span>{t('nurse.draftRestoredNotice')}</span>
            <button type="button" onClick={() => clearForm({ discardDraft: true })}>{t('nurse.discardDraft')}</button>
            <button type="button" onClick={() => setDraftRestoredNotice(false)}>{t('action.dismiss')}</button>
          </div>
        ) : undefined}
        pages={[
          { id: 'complaint', label: t('triageO3.pageComplaint'), sections: [
            { id: 'cc', label: t('triageO3.chiefComplaint'), body: <TriageChiefComplaint f={f} /> },
          ] },
          { id: 'etat', label: t('triageO3.pageEtat'), sections: [
            { id: 'abcc', label: t('triageO3.abcc'), body: <TriageAbccAssessment f={f} /> },
            { id: 'danger', label: t('triageO3.dangerSigns'), body: <TriageDangerSigns f={f} /> },
            { id: 'priority', label: t('triageO3.priority'), body: <TriagePriorityResult f={f} /> },
          ] },
          { id: 'vitals', label: t('triageO3.pageVitals'), sections: [
            // The safety summary reads the observations, so it sits with them
            // (it renders nothing until a vital is out of range).
            { id: 'vitals', label: t('triageO3.vitalSigns'), body: <><TriageVitalSafetySummary f={f} /><TriageVitalsSection f={f} /></> },
          ] },
          { id: 'history', label: t('triageO3.pageHistory'), sections: [
            { id: 'intake', label: t('triageO3.intakeHistory'), body: <TriageIntakeHistory f={f} /> },
            { id: 'visit', label: t('triageO3.visitContext'), body: <TriageVisitContext f={f} /> },
          ] },
          { id: 'handoff', label: t('triageO3.pageHandoff'), sections: [
            { id: 'handoff', label: t('triageO3.handoff'), body: <TriageHandoffSection f={f} /> },
            { id: 'notes', label: t('triageO3.notes'), body: <><TriageNotesSection f={f} /><TriageFormActions f={f} showActions={false} /></> },
          ] },
        ]}
        onSave={() => void handleSubmitTriage()}
        saveDisabled={!triageData.priority || !selectedTriagePatient}
        saveLabel={editingTriageId ? t('action.saveChanges') : t('nurse.saveTriage')}
        saving={triageSubmitting}
        onCancel={props.onCancel ?? (() => clearForm({ discardDraft: true }))}
      />
    );
  }

  return (
    <div className={lockedPatientId ? `tamam-reg triage-reg${embedded ? ' triage-reg--embedded' : ''}` : 'flex flex-col lg:flex-row gap-4'} style={{ flex: 1, minHeight: 0 }}>
      {!embedded && <TriageRail f={f} />}

      <div data-tour="triage-form" className={lockedPatientId ? 'tamam-reg-form patient-registration-shell triage-reg-form' : 'lg:flex-[2] dash-card overflow-hidden flex flex-col'} style={{ padding: lockedPatientId ? 0 : undefined, minHeight: 0 }}>
        {!lockedPatientId && (
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: '#FF9933' }} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.etatTriageAssessment')}</h3>
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {/* RED count is every RED triage the department still owes
                  attention to — pending, or seen but not yet in an active
                  consultation — not just status==='pending'. The old
                  predicate dropped a RED patient from this count the instant
                  a nurse marked them 'seen', long before a doctor picked them
                  up, understating how many critical patients were still
                  waiting. */}
              {t('nurse.triageHeaderSummary', { today: triageHistory.filter(ti => (ti.triagedAt || '').startsWith(todayIso())).length, red: countActiveRedTriage(triageHistory) })}
            </span>
          </div>
        )}
        <div className={lockedPatientId ? 'patient-registration-card-body' : 'p-4 space-y-4 flex-1 overflow-y-auto'}>
          <div className={lockedPatientId ? 'tamam-reg-section' : 'space-y-4'}>
            {lockedPatientId && <div className="tamam-reg-sectionhead"><h2>ETAT assessment</h2><p>Record the patient identity, immediate risk, observations, and handoff context.</p></div>}
            <div className={lockedPatientId ? 'tamam-reg-fields space-y-4' : 'space-y-4'}>
          {draftRestoredNotice && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33,145,208,0.25))' }}>
              <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>
                {t('nurse.draftRestoredNotice')}
              </span>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => clearForm({ discardDraft: true })}
                  className="text-[10px] font-semibold"
                  style={{ color: 'var(--color-danger)' }}
                >
                  {t('nurse.discardDraft')}
                </button>
                <button
                  type="button"
                  onClick={() => setDraftRestoredNotice(false)}
                  className="text-[10px] font-semibold inline-flex items-center gap-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-3 h-3" /> {t('action.dismiss')}
                </button>
              </div>
            </div>
          )}
          {!lockedPatientId && <>
          <TriagePatientPicker f={f} />
          </>}

          <TriageChiefComplaint f={f} />

          <TriageVitalSafetySummary f={f} />

          <TriageAbccAssessment f={f} />

          <TriageDangerSigns f={f} />

          <TriagePriorityResult f={f} />

          <TriageVitalsSection f={f} />

          <TriageIntakeHistory f={f} />

          <TriageVisitContext f={f} />

          <TriageHandoffSection f={f} />

          <TriageNotesSection f={f} />

          <TriageFormActions f={f} showActions={!lockedPatientId || embedded} />
          </div>
          </div>
        </div>
      </div>

      <TriageRecentList f={f} />
    </div>
  );
}
