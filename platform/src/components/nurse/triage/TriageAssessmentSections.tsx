'use client';

/**
 * The triage ETAT questions, drawn as O3 form fields (components/forms/O3Form):
 * every choice a dropdown — one answer a select, a sign list a multi-select —
 * on the white field with one bottom rule. The rules behind each answer
 * (auto-priority, vital overrides) are the form hook's and unchanged.
 */

import Select from '@/components/Select';
import { TrendingUp } from '@/components/icons/lucide';
import { O3MultiSelectField, O3SelectField, O3TextField } from '@/components/forms/O3Form';
import { IITT_RED_CRITERIA, IITT_YELLOW_CRITERIA, INFECTION_RISK_SIGNS } from '@/lib/clinical/iitt';
import { patientFullName } from '@/lib/patient-utils';
import type { TriageFormState } from './useTriageForm';

const asOptions = (list: readonly (readonly [string, string])[]) => list.map(([value, label]) => ({ value, label }));

export function TriageAbccAssessment({ f }: { f: TriageFormState }) {
  const { t, triageData, setTriageData, resetVitalOverride } = f;
  const set = (key: 'airway' | 'breathing' | 'circulation' | 'consciousness') => (value: string) => {
    setTriageData(prev => ({ ...prev, [key]: value }));
    resetVitalOverride();
  };
  return (
    <div id="triage-section-assessment" className="o3f-fields scroll-mt-3">
      <O3SelectField id="triage-airway" label={t('nurse.airway')} value={triageData.airway} onChange={set('airway')}
        options={[{ value: 'clear', label: t('nurse.airwayClear') }, { value: 'obstructed', label: t('nurse.airwayObstructed') }]} />
      <O3SelectField id="triage-breathing" label={t('nurse.breathing')} value={triageData.breathing} onChange={set('breathing')}
        options={[
          { value: 'normal', label: t('nurse.breathingNormal') },
          { value: 'distressed', label: t('nurse.breathingDistressed') },
          { value: 'absent', label: t('nurse.breathingAbsent') },
        ]} />
      <O3SelectField id="triage-circulation" label={t('nurse.circulation')} value={triageData.circulation} onChange={set('circulation')}
        options={[
          { value: 'normal', label: t('nurse.circulationNormal') },
          { value: 'impaired', label: t('nurse.circulationImpaired') },
          { value: 'absent', label: t('nurse.circulationAbsent') },
        ]} />
      <O3SelectField id="triage-consciousness" label={t('nurse.consciousnessAvpu')} value={triageData.consciousness} onChange={set('consciousness')}
        options={[
          { value: 'alert', label: t('nurse.avpuAlert') },
          { value: 'verbal', label: t('nurse.avpuVerbal') },
          { value: 'pain', label: t('nurse.avpuPain') },
          { value: 'unresponsive', label: t('nurse.avpuUnresponsive') },
        ]} />
    </div>
  );
}

export function TriageDangerSigns({ f }: { f: TriageFormState }) {
  const { t, presentationCategory, setPresentationCategory, redCriteria, setRedCriteria, yellowCriteria, setYellowCriteria, capillaryRefillSeconds, setCapillaryRefillSeconds, setPregnancyStatus, gestationalAgeWeeks, setGestationalAgeWeeks, injuryMechanism, setInjuryMechanism, infectionRiskSigns, setInfectionRiskSigns, isolationRequired, setIsolationRequired, preArrivalCare, setPreArrivalCare, immediateInterventions, setImmediateInterventions, triagePathway, recordedPregnancyStatus, resetVitalOverride } = f;
  // WHO/ICRC/MSF Interagency Integrated Triage Tool. ABCC alone does not
  // capture trauma, obstetric, exposure, infection or the full adult /
  // paediatric danger-sign screen used at first contact.
  return (
    <div id="triage-section-danger" className="o3f-fields scroll-mt-3">
      <p className="o3f-caption">
        {triagePathway === 'pediatric_under_12' ? t('triageO3.pathwayChild') : t('triageO3.pathwayAdult')}
      </p>
      <O3SelectField id="triage-presentation-category" label={t('triageO3.presentation')} value={presentationCategory} placeholder={null}
        onChange={value => setPresentationCategory(value as typeof presentationCategory)}
        options={[
          { value: 'medical', label: t('triageO3.medical') },
          { value: 'trauma', label: t('triageForm.trauma') },
          { value: 'obstetric', label: t('triageO3.obstetric') },
          { value: 'mental_health', label: t('triageForm.mentalHealth') },
          { value: 'other', label: t('triageO3.other') },
        ]} />
      <O3SelectField id="triage-pregnancy-status" label={t('imgFlow.pregnancy')} value={recordedPregnancyStatus} placeholder={null}
        onChange={value => { setPregnancyStatus(value as typeof f.pregnancyStatus); resetVitalOverride(); }}
        options={[
          { value: 'unknown', label: t('triageO3.unknown') },
          { value: 'not_applicable', label: t('imgFlow.pregnancyNA') },
          { value: 'not_pregnant', label: t('triageForm.notPregnant') },
          { value: 'pregnant', label: t('triageO3.pregnant') },
          { value: 'postpartum', label: t('triageO3.postpartum') },
        ]} />
      <O3TextField id="triage-capillary-refill" label={t('triageO3.capillaryRefill')} value={capillaryRefillSeconds} inputMode="decimal" placeholder="2"
        onChange={value => { setCapillaryRefillSeconds(value); resetVitalOverride(); }} />
      {recordedPregnancyStatus === 'pregnant' && (
        <O3TextField id="triage-gestational-age" label={t('triageO3.gestationalAge')} value={gestationalAgeWeeks} inputMode="numeric" placeholder="28"
          onChange={setGestationalAgeWeeks} />
      )}
      {presentationCategory === 'trauma' && (
        <O3TextField id="triage-injury-mechanism" label={t('triageForm.injuryMechanism')} value={injuryMechanism} wide
          placeholder={t('triageO3.injuryPlaceholder')} onChange={setInjuryMechanism} />
      )}
      <O3MultiSelectField id="triage-red-criteria" label={t('triageO3.redSigns')} tone="danger"
        values={redCriteria} options={asOptions(IITT_RED_CRITERIA)}
        onChange={next => { setRedCriteria(next as typeof redCriteria); resetVitalOverride(); }} />
      <O3MultiSelectField id="triage-yellow-criteria" label={t('triageO3.yellowSigns')} tone="warning"
        values={yellowCriteria} options={asOptions(IITT_YELLOW_CRITERIA)}
        onChange={next => { setYellowCriteria(next as typeof yellowCriteria); resetVitalOverride(); }} />
      <O3MultiSelectField id="triage-infection-signs" label={t('triageForm.outbreakScreen')}
        values={infectionRiskSigns} options={asOptions(INFECTION_RISK_SIGNS)}
        onChange={next => setInfectionRiskSigns(next as typeof infectionRiskSigns)} />
      <O3SelectField id="triage-isolation" label={t('triageO3.isolation')} value={isolationRequired ? 'yes' : 'no'} placeholder={null}
        onChange={value => setIsolationRequired(value === 'yes')}
        options={[{ value: 'no', label: t('action.no') }, { value: 'yes', label: t('triageO3.isolateNow') }]} />
      <O3TextField id="triage-pre-arrival-care" label={t('triageForm.preArrivalCare')} value={preArrivalCare}
        placeholder={t('triageO3.preArrivalPlaceholder')} onChange={setPreArrivalCare} />
      <O3TextField id="triage-immediate-interventions" label={t('triageForm.immediateInterventions')} value={immediateInterventions}
        placeholder={t('triageO3.interventionsPlaceholder')} onChange={setImmediateInterventions} />
    </div>
  );
}

export function TriagePriorityResult({ f }: { f: TriageFormState }) {
  const { t, triageData, overrideVitalUrgency, setManualPriorityRaise, manualUpgradeReason, setManualUpgradeReason, selectedTriagePatient, recommendedPriority, recommendationRaisesPriority, effectivePriority, manualRaiseOptions, effectiveManualPriorityRaise, finalPriority, triagePriorityColor } = f;
  return (
    <>
          {/* Triage Result */}
          {triageData.priority && effectivePriority && (
            <div
              className="p-4 rounded-2xl text-center transition-all"
              style={{
                background: triagePriorityColor(finalPriority).bg,
                color: triagePriorityColor(finalPriority).text,
              }}
            >
              <p className="text-base font-bold">{triagePriorityColor(finalPriority).label}</p>
              {recommendationRaisesPriority && (
                <p className="text-[10px] mt-1 font-semibold opacity-90">
                  {overrideVitalUrgency
                    ? `Override selected · recommended ${recommendedPriority}`
                    : `Escalated from ABCC ${triageData.priority} by IITT danger signs or vital-sign warning`}
                </p>
              )}
              {effectiveManualPriorityRaise && (
                <p className="text-[10px] mt-1 font-semibold opacity-90">
                  {t('nurse.raisedByNurse', { reason: manualUpgradeReason.trim() || '—' })}
                </p>
              )}
              {selectedTriagePatient && (
                <p className="text-xs mt-1 opacity-80">{t('nurse.patientLabel', { name: patientFullName(selectedTriagePatient) })}</p>
              )}
            </div>
          )}

          {/* Manual priority raise — the complement of the vital-urgency
              override above. That control only ever lets a nurse save BELOW
              the computed recommendation (with a reason); this is the only
              path in the other direction, for a concern nothing structured on
              the form captures. Not offered once already RED — there is
              nothing higher to raise to. */}
          {triageData.priority && manualRaiseOptions.length > 0 && (
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-danger)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.raisePriorityAboveComputed')}</span>
              </div>
              <Select
                id="triage-manual-raise"
                className="o3f-input"
                value={effectiveManualPriorityRaise || ''}
                onChange={e => setManualPriorityRaise(e.target.value as '' | 'RED' | 'YELLOW')}
              >
                <option value="">{t('triageO3.noRaise')}</option>
                {manualRaiseOptions.map(option => (
                  <option key={option} value={option}>{t('nurse.raiseTo', { label: triagePriorityColor(option).label })}</option>
                ))}
              </Select>
              {effectiveManualPriorityRaise && (
                <div className="mt-2">
                  <label htmlFor="triage-manual-raise-reason" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--color-danger)' }}>
                    {t('nurse.raiseReasonLabel')}
                  </label>
                  <textarea
                    id="triage-manual-raise-reason"
                    rows={2}
                    value={manualUpgradeReason}
                    onChange={event => setManualUpgradeReason(event.target.value)}
                    placeholder="What did you observe that the ABCC and danger-sign screen above didn't capture?"
                    className="w-full px-2 py-1.5 rounded-lg text-xs mt-1"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--color-danger)', color: 'var(--text-primary)' }}
                    required
                  />
                </div>
              )}
            </div>
          )}
    </>
  );
}
