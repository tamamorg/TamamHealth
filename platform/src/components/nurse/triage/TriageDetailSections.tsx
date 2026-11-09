'use client';
import { useState } from 'react';

import { O3MultiSelectField, O3Question, O3SelectField, O3TextField } from '@/components/forms/O3Form';
import { X } from '@/components/icons/lucide';
import { VitalInputField } from './VitalInputField';
import { TRIAGE_CHRONIC_CONDITIONS } from './constants';
import { ACCENT } from '../shared';
import { type TriageDisposition } from '@/lib/db-types';
import type { TriageFormState } from './useTriageForm';

import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { updateAllergy, removeAllergy } from '@/lib/services/allergy-service';
import { describeError } from '@/lib/user-facing-error';
import type { PatientDoc } from '@/lib/db-types';

/**
 * Triage's allergy review of what the patient told the desk at registration.
 * Each unverified entry is confirmed (stays, no longer marked unverified) or
 * removed with the review reason on record. Renders nothing when there is none.
 */
function ReportedAllergyReview({ patient, t }: { patient: PatientDoc | null; t: (key: string) => string }) {
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = (patient?.structuredAllergies ?? []).filter(
    a => a.status === 'active' && a.verified === false && !handled.has(a.id),
  );
  if (!patient || pending.length === 0) return null;
  const actor = { id: currentUser?._id, name: currentUser?.name || currentUser?.username };

  async function review(id: string, action: 'confirm' | 'remove') {
    if (!scope || !patient) return;
    setBusyId(id);
    try {
      if (action === 'confirm') {
        await updateAllergy(patient._id, scope, id, {
          verified: true,
          ...(actor.id ? { updatedBy: actor.id } : {}),
          ...(actor.name ? { updatedByName: actor.name } : {}),
        });
      } else {
        await removeAllergy(patient._id, scope, id, t('triage.allergyRemoveReason'), 'entered_in_error', actor);
      }
      setHandled(prev => new Set(prev).add(id));
    } catch (e) {
      showToast(describeError(e, t('msg.allergyReviewNotSaved')), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div id="triage-reported-allergies" style={{ gridColumn: '1 / -1' }}>
      <p style={{ fontWeight: 600, margin: '0 0 2px' }}>{t('triage.allergyReviewHeading')}</p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>{t('triage.allergyReviewHint')}</p>
      {pending.map(a => (
        <div key={a.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-light)' }}>
          <span style={{ flex: '1 1 100%', minWidth: 0 }}>
            <strong>{a.substance}</strong>{a.reaction ? ` · ${a.reaction}` : ''}
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busyId === a.id} onClick={() => review(a.id, 'confirm')}>
            {t('allergy.confirm')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === a.id} onClick={() => review(a.id, 'remove')}>
            {t('action.remove')}
          </button>
        </div>
      ))}
    </div>
  );
}

export function TriageVitalsSection({ f }: { f: TriageFormState }) {
  const { t, triageVitals, setTriageVitals, unmeasuredVitalReasons, setUnmeasuredVitalReasons, vitalErrors, warningByVital, calculatedBmi, resetVitalOverride } = f;
  return (
    <div id="triage-section-vitals" className="o3f-fields scroll-mt-3">
      {([
        { field: 'temperature', label: t('nurse.tempC'), placeholder: '37.0', inputMode: 'decimal' },
        { field: 'pulse', label: t('nurse.pulse'), placeholder: '80', inputMode: 'numeric' },
        { field: 'respiratoryRate', label: t('nurse.rr'), placeholder: '18', inputMode: 'numeric' },
        { field: 'oxygenSaturation', label: t('nurse.spo2Pct'), placeholder: '98', inputMode: 'numeric' },
        { field: 'systolic', label: t('nurse.sysBp'), placeholder: '120', inputMode: 'numeric' },
        { field: 'diastolic', label: t('nurse.diaBp'), placeholder: '80', inputMode: 'numeric' },
        { field: 'weight', label: t('nurse.weightKg'), placeholder: '65', inputMode: 'decimal' },
        { field: 'height', label: `${t('vitals.height')} cm`, placeholder: '170', inputMode: 'decimal' },
        { field: 'painScore', label: t('nurse.painScore'), placeholder: '0', inputMode: 'numeric' },
        { field: 'bloodGlucose', label: t('nurse.bloodGlucose'), placeholder: '5.5', inputMode: 'decimal' },
        { field: 'gcs', label: t('nurse.gcs'), placeholder: '15', inputMode: 'numeric' },
        { field: 'muac', label: t('nurse.muac'), placeholder: '23.5', inputMode: 'decimal' },
      ] as const).map(item => (
        <VitalInputField
          key={item.field}
          {...item}
          value={triageVitals[item.field]}
          error={vitalErrors[item.field]}
          warning={warningByVital.get(item.field)}
          unmeasuredReason={unmeasuredVitalReasons[item.field]}
          onChange={value => {
            setTriageVitals(previous => ({ ...previous, [item.field]: value }));
            resetVitalOverride();
          }}
          onUnmeasuredReasonChange={reason => {
            setUnmeasuredVitalReasons(previous => {
              const next = { ...previous };
              if (reason === undefined) delete next[item.field];
              else next[item.field] = reason;
              return next;
            });
            // A reading the nurse can no longer vouch for either way —
            // clear it so a stale number doesn't silently get saved
            // once the field is disabled and out of sight.
            if (reason !== undefined) setTriageVitals(previous => ({ ...previous, [item.field]: '' }));
            resetVitalOverride();
          }}
        />
      ))}
      <O3Question label={`${t('vitals.bmi')} kg/m²`} htmlFor="triage-bmi">
        <output id="triage-bmi" aria-live="polite" className="o3f-input o3f-output">
          {calculatedBmi || t('triageO3.bmiCalculated')}
        </output>
      </O3Question>
    </div>
  );
}

export function TriageIntakeHistory({ f }: { f: TriageFormState }) {
  const { t, currentMedications, setCurrentMedications, chronicConditionsSelected, setChronicConditionsSelected, selectedTriagePatient } = f;
  // Chronic conditions — light-touch intake with no TriageDoc column (that data
  // lives on PatientDoc as a standing record), folded into the saved notes as
  // a labelled line. What the patient takes is the Medication list review
  // below once the patient is known; the old free-text box stays only before
  // that, or while it still holds text (a restored draft), so nothing typed
  // into it is lost — it folds into the notes as before.
  const showFreeTextMedications = !selectedTriagePatient || Boolean(currentMedications.trim());
  return (
    <div className="o3f-fields">
      {showFreeTextMedications && (
        <O3TextField id="triage-current-medications" label={t('triageForm.currentMedications')} value={currentMedications}
          placeholder={t('triageO3.medicationsPlaceholder')} onChange={setCurrentMedications} />
      )}
      <O3MultiSelectField
        id="triage-chronic-conditions"
        label={t('triageForm.chronicConditions')}
        values={chronicConditionsSelected}
        options={TRIAGE_CHRONIC_CONDITIONS.map(c => ({ value: c, label: c }))}
        onChange={next => setChronicConditionsSelected(next)}
        wide={false}
      />
    </div>
  );
}

export function TriageVisitContext({ f }: { f: TriageFormState }) {
  const { t, triageContext, setTriageContext } = f;
  return (
    <div className="o3f-fields">
      <O3SelectField id="triage-mode-of-arrival" label={t('nurse.modeOfArrival')} value={triageContext.modeOfArrival}
        onChange={value => setTriageContext({ ...triageContext, modeOfArrival: value as typeof triageContext.modeOfArrival })}
        options={[
          { value: 'walk-in', label: t('nurse.modeWalkIn') },
          { value: 'ambulance', label: t('nurse.modeAmbulance') },
          { value: 'referral', label: t('nurse.modeReferral') },
          { value: 'police', label: t('nurse.modePolice') },
          { value: 'other', label: t('nurse.modeOther') },
        ]} />
      <O3TextField id="triage-symptom-duration" label={t('nurse.symptomDuration')} value={triageContext.symptomDuration}
        placeholder={t('nurse.symptomDurationPlaceholder')} onChange={value => setTriageContext({ ...triageContext, symptomDuration: value })} />
      <O3TextField id="triage-referral-source" label={t('nurse.referralSource')} value={triageContext.referralSource}
        placeholder={t('nurse.referralSourcePlaceholder')} onChange={value => setTriageContext({ ...triageContext, referralSource: value })} />
      <ReportedAllergyReview patient={f.selectedTriagePatient} t={t} />
      <O3TextField id="triage-known-allergies" label={t('nurse.knownAllergies')} value={triageContext.knownAllergies}
        placeholder={t('nurse.knownAllergiesPlaceholder')} onChange={value => setTriageContext({ ...triageContext, knownAllergies: value })} />
    </div>
  );
}

export function TriageHandoffSection({ f }: { f: TriageFormState }) {
  const { t, triageDisposition, setTriageDisposition, destinationClinic, setDestinationClinic, assignedProviderId, setAssignedProviderId, handoffNote, setHandoffNote, availableProviders, destinationOptions } = f;
  const clinic = destinationClinic || destinationOptions[0] || '';
  return (
    <div id="triage-section-handoff" className="o3f-fields scroll-mt-3">
      <p className="o3f-caption">{t('triageO3.handoffCaption')}</p>
      <O3SelectField id="triage-destination" label={t('triageO3.destination')} value={triageDisposition} placeholder={null}
        onChange={value => setTriageDisposition(value as TriageDisposition)}
        options={[
          { value: 'emergency', label: t('triageForm.emergencyCare') },
          { value: 'general_clinic', label: t('triageForm.generalClinic') },
          { value: 'specialty_clinic', label: t('triageForm.specialtyClinic') },
          { value: 'home_care', label: t('triageForm.homeCare') },
        ]} />
      {/* The disposition's clinics are a known list — a choice, not typing. */}
      {destinationOptions.length > 0 ? (
        <O3SelectField id="triage-destination-clinic" label={t('triageForm.clinicOrService')} value={clinic} placeholder={null}
          onChange={setDestinationClinic}
          options={[...new Set([...destinationOptions, ...(clinic ? [clinic] : [])])].map(o => ({ value: o, label: o }))} />
      ) : (
        <O3TextField id="triage-destination-clinic" label={t('triageForm.clinicOrService')} value={clinic} onChange={setDestinationClinic} />
      )}
      <O3SelectField id="triage-receiving-provider" label={t('triageForm.receivingProvider')} value={assignedProviderId}
        placeholder={t('triageForm.assignProviderLater')} onChange={setAssignedProviderId}
        options={availableProviders.map(p => ({ value: p._id, label: `${p.name}${p.specialty ? ` · ${p.specialty}` : ''}` }))} />
      <O3TextField id="triage-handoff-note" label={t('triageForm.handoffNote')} value={handoffNote}
        placeholder={t('triageO3.handoffPlaceholder')} onChange={setHandoffNote} />
    </div>
  );
}

export function TriageNotesSection({ f }: { f: TriageFormState }) {
  const { t, triageNotes, setTriageNotes } = f;
  return (
    <div id="triage-section-notes" className="o3f-fields scroll-mt-3">
      <O3TextField id="triage-notes" label={t('nurse.notesOptional')} value={triageNotes} multiline
        placeholder={t('nurse.additionalObservations')} onChange={setTriageNotes} />
    </div>
  );
}

export function TriageFormActions({ f, showActions }: { f: TriageFormState; showActions: boolean }) {
  const { t, editingTriageId, triageData, triageSubmitting, selectedTriagePatient, clearForm, handleSubmitTriage } = f;
  return (
    <>
          {/* Editing-an-existing-record banner — makes it clear the next save
              corrects a saved triage rather than creating a new one. */}
          {editingTriageId && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33,145,208,0.25))' }}>
              <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>{t('action.edit')}</span>
              <button
                onClick={() => clearForm({ discardDraft: true })}
                className="text-[10px] font-semibold inline-flex items-center gap-1"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-3 h-3" /> {t('action.cancel')}
              </button>
            </div>
          )}

          {/* Actions sit at the bottom of the station form and of an embedded
              one. The focused patient page places them in its rail. */}
          {showActions && <div className="flex gap-2">
            <button
              onClick={() => clearForm({ discardDraft: true })}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: 'var(--overlay-subtle)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-light)',
              }}
              disabled={triageSubmitting}
            >
              {t('nurse.reset')}
            </button>
            <button
              onClick={handleSubmitTriage}
              disabled={triageSubmitting || !triageData.priority || !selectedTriagePatient}
              className="flex-1 py-2 rounded-xl text-xs font-semibold transition-all btn btn-primary"
            >
              {triageSubmitting ? t('nurse.saving') : editingTriageId ? t('action.saveChanges') : t('nurse.saveTriage')}
            </button>
          </div>}
    </>
  );
}
