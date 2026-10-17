'use client';

import { patientFullName, initials, patientGenderAge } from '@/lib/patient-utils';
import type { TriageFormState } from './useTriageForm';

export function TriageRail({ f }: { f: TriageFormState }) {
  const { t, router, editingTriageId, triageData, triageSubmitting, activeSection, selectedTriagePatient, clearForm, handleSubmitTriage, triageSections, goToTriageSection, lockedPatientId } = f;
  return (
    <>
      {lockedPatientId && (
        <aside className="tamam-reg-rail" aria-label="Triage progress">
          <h1 className="tamam-reg-title">{t('triageForm.railTitle')}</h1>
          {selectedTriagePatient && (
            <div className="triage-rail-patient">
              <div className="triage-patient-photo">
                <div className="triage-patient-photo-frame">
                  {(selectedTriagePatient as { photoUrl?: string }).photoUrl
                    // eslint-disable-next-line @next/next/no-img-element -- patient photo from the record; the host is not known at build time, and this frame is CSS-sized rather than a fixed width/height next/image could take.
                    ? <img src={(selectedTriagePatient as { photoUrl?: string }).photoUrl} alt={patientFullName(selectedTriagePatient)} />
                    : <span className="text-3xl font-semibold" style={{ color: 'var(--accent-primary)' }}>{initials(patientFullName(selectedTriagePatient))}</span>}
                </div>
                <span className="triage-patient-photo-label">{t('photoCapture.patientPhotoAlt')}</span>
              </div>
              <strong>{patientFullName(selectedTriagePatient)}</strong>
              <span>{[selectedTriagePatient.hospitalNumber, patientGenderAge(selectedTriagePatient)].filter(Boolean).join(' · ')}</span>
              <button type="button" onClick={() => router.push(`/patients/${selectedTriagePatient._id}`)} className="triage-rail-chart-link">
                {t('appointments.openChart')}
              </button>
            </div>
          )}
          <p className="tamam-reg-railnote">Complete the assessment from top to bottom, then save the triage record.</p>
          <p className="tamam-reg-jump">{t('triageForm.assessmentSteps')}</p>
          <nav className="tamam-reg-nav" aria-label="Triage sections">
            {triageSections.map(section => {
              const isCurrent = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => goToTriageSection(section.id)}
                  className={`tamam-reg-navitem${isCurrent ? ' is-current' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span className="tamam-reg-navarrow" aria-hidden>↳</span>
                  <span className="tamam-reg-navlabel">{section.label}</span>
                  <span className="tamam-reg-navmeta">{section.detail}</span>
                </button>
              );
            })}
          </nav>
          <div className="tamam-reg-railactions">
            <button
              type="button"
              onClick={handleSubmitTriage}
              disabled={triageSubmitting || !triageData.priority || !selectedTriagePatient}
              className="btn btn-primary"
            >
              {triageSubmitting ? t('nurse.saving') : editingTriageId ? t('action.saveChanges') : t('nurse.saveTriage')}
            </button>
            <button type="button" onClick={() => clearForm({ discardDraft: true })} disabled={triageSubmitting} className="btn btn-secondary">
              {t('nurse.reset')}
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
