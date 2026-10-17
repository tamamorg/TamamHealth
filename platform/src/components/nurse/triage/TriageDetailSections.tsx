'use client';

import { Activity, Clock, Send, X } from '@/components/icons/lucide';
import { VitalInputField } from './VitalInputField';
import { TRIAGE_CHRONIC_CONDITIONS } from './constants';
import { ACCENT } from '../shared';
import Select from '@/components/Select';
import { type TriageDisposition } from '@/lib/db-types';
import type { TriageFormState } from './useTriageForm';

export function TriageVitalsSection({ f }: { f: TriageFormState }) {
  const { t, triageVitals, setTriageVitals, unmeasuredVitalReasons, setUnmeasuredVitalReasons, vitalErrors, warningByVital, calculatedBmi, resetVitalOverride } = f;
  return (
    <>
          {/* Vitals at triage */}
          <div id="triage-section-vitals" className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.vitalsAtTriage')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
              <div data-vital-field="bmi">
                <label htmlFor="triage-bmi" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('vitals.bmi')} kg/m²</label>
                <output id="triage-bmi" aria-live="polite" className="flex items-center" style={{ width: '100%', minHeight: 30, padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: calculatedBmi ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {calculatedBmi || 'Calculated from height and weight'}
                </output>
              </div>
            </div>
          </div>
    </>
  );
}

export function TriageIntakeHistory({ f }: { f: TriageFormState }) {
  const { t, currentMedications, setCurrentMedications, chronicConditionsSelected, setChronicConditionsSelected } = f;
  return (
    <>
          {/* Current medications + chronic conditions — light-touch intake.
              TriageDoc has no dedicated column for either (that data lives on
              PatientDoc as a standing record, not this visit's snapshot), so
              both fold into the saved notes as clearly labelled lines — see
              the implementation report. */}
          <div className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="triage-current-medications" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('triageForm.currentMedications')}</label>
                <input
                  id="triage-current-medications"
                  type="text"
                  value={currentMedications}
                  onChange={event => setCurrentMedications(event.target.value)}
                  placeholder="What is the patient already taking?"
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('triageForm.chronicConditions')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {TRIAGE_CHRONIC_CONDITIONS.map(condition => {
                    const selected = chronicConditionsSelected.includes(condition);
                    return (
                      <button
                        key={condition}
                        type="button"
                        onClick={() => setChronicConditionsSelected(current =>
                          selected ? current.filter(item => item !== condition) : [...current, condition])}
                        className="px-2 py-1 rounded-lg text-[10px] font-semibold transition-all"
                        style={{
                          background: selected ? 'var(--accent-light)' : 'var(--bg-card)',
                          color: selected ? ACCENT : 'var(--text-secondary)',
                          border: `1px solid ${selected ? 'var(--accent-border, rgba(33,145,208,0.3))' : 'var(--border-light)'}`,
                        }}
                      >
                        {condition}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
    </>
  );
}

export function TriageVisitContext({ f }: { f: TriageFormState }) {
  const { t, triageContext, setTriageContext } = f;
  return (
    <>
          {/* Triage context */}
          <div id="triage-section-context" className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.triageContext')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.modeOfArrival')}</label>
                <Select value={triageContext.modeOfArrival} onChange={e => setTriageContext({ ...triageContext, modeOfArrival: e.target.value as typeof triageContext.modeOfArrival })} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="">{t('nurse.modeSelectPlaceholder')}</option>
                  <option value="walk-in">{t('nurse.modeWalkIn')}</option>
                  <option value="ambulance">{t('nurse.modeAmbulance')}</option>
                  <option value="referral">{t('nurse.modeReferral')}</option>
                  <option value="police">{t('nurse.modePolice')}</option>
                  <option value="other">{t('nurse.modeOther')}</option>
                </Select>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.symptomDuration')}</label>
                <input type="text" value={triageContext.symptomDuration} onChange={e => setTriageContext({ ...triageContext, symptomDuration: e.target.value })} placeholder={t('nurse.symptomDurationPlaceholder')} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.referralSource')}</label>
                <input type="text" value={triageContext.referralSource} onChange={e => setTriageContext({ ...triageContext, referralSource: e.target.value })} placeholder={t('nurse.referralSourcePlaceholder')} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('nurse.knownAllergies')}</label>
                <input type="text" value={triageContext.knownAllergies} onChange={e => setTriageContext({ ...triageContext, knownAllergies: e.target.value })} placeholder={t('nurse.knownAllergiesPlaceholder')} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>
    </>
  );
}

export function TriageHandoffSection({ f }: { f: TriageFormState }) {
  const { t, triageDisposition, setTriageDisposition, destinationClinic, setDestinationClinic, assignedProviderId, setAssignedProviderId, handoffNote, setHandoffNote, availableProviders, destinationOptions } = f;
  return (
    <>
          {/* Disposition and provider handoff */}
          <div id="triage-section-handoff" className="p-3 rounded-xl scroll-mt-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Send className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <div>
                <span className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('triageForm.handoffHeading')}</span>
                <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Tell the care team where this patient goes next.</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Destination</label>
                <Select value={triageDisposition} onChange={event => setTriageDisposition(event.target.value as TriageDisposition)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="emergency">{t('triageForm.emergencyCare')}</option>
                  <option value="general_clinic">{t('triageForm.generalClinic')}</option>
                  <option value="specialty_clinic">{t('triageForm.specialtyClinic')}</option>
                  <option value="home_care">{t('triageForm.homeCare')}</option>
                </Select>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('triageForm.clinicOrService')}</label>
                <input type="text" value={destinationClinic || destinationOptions[0] || ''} onChange={event => setDestinationClinic(event.target.value)} placeholder={destinationOptions[0] || 'Destination clinic'} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('triageForm.receivingProvider')}</label>
                <Select value={assignedProviderId} onChange={event => setAssignedProviderId(event.target.value)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="">{t('triageForm.assignProviderLater')}</option>
                  {availableProviders.map(provider => <option key={provider._id} value={provider._id}>{provider.name}{provider.specialty ? ` · ${provider.specialty}` : ''}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('triageForm.handoffNote')}</label>
                <input type="text" value={handoffNote} onChange={event => setHandoffNote(event.target.value)} placeholder="What should the provider know first?" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>
    </>
  );
}

export function TriageNotesSection({ f }: { f: TriageFormState }) {
  const { t, triageNotes, setTriageNotes } = f;
  return (
    <>
          {/* Notes */}
          <div id="triage-section-notes" className="scroll-mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nurse.notesOptional')}</label>
            <textarea
              rows={2}
              value={triageNotes}
              onChange={e => setTriageNotes(e.target.value)}
              placeholder={t('nurse.additionalObservations')}
              className="w-full px-3 py-2 rounded-xl text-sm"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
          </div>
    </>
  );
}

export function TriageFormActions({ f }: { f: TriageFormState }) {
  const { t, editingTriageId, triageData, triageSubmitting, selectedTriagePatient, clearForm, handleSubmitTriage, lockedPatientId } = f;
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

          {/* Actions remain at the bottom of the station form. The focused
              patient flow places them in the registration-style rail. */}
          {!lockedPatientId && <div className="flex gap-2">
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
