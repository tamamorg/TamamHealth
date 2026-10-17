'use client';

import { Wind, Activity, Heart, Brain, AlertTriangle, TrendingUp } from '@/components/icons/lucide';
import Select from '@/components/Select';
import { IITT_RED_CRITERIA, IITT_YELLOW_CRITERIA, INFECTION_RISK_SIGNS } from '@/lib/clinical/iitt';
import { patientFullName } from '@/lib/patient-utils';
import type { TriageFormState } from './useTriageForm';

export function TriageAbccAssessment({ f }: { f: TriageFormState }) {
  const { t, triageData, setTriageData, resetVitalOverride } = f;
  return (
    <>
          {/* ABCC Assessment */}
          <div id="triage-section-assessment" className="grid grid-cols-1 sm:grid-cols-2 gap-3 scroll-mt-3">
            {/* Airway */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Wind className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.airway')}</span>
              </div>
              <div className="flex gap-2">
                {(['clear', 'obstructed'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setTriageData(prev => ({ ...prev, airway: prev.airway === opt ? '' : opt })); resetVitalOverride(); }}
                    title={triageData.airway === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.airway === opt
                        ? (opt === 'clear' ? 'rgba(79, 199, 155,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.airway === opt
                        ? (opt === 'clear' ? 'var(--color-success)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.airway === opt
                        ? (opt === 'clear' ? 'rgba(79, 199, 155,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt === 'clear' ? t('nurse.airwayClear') : t('nurse.airwayObstructed')}
                  </button>
                ))}
              </div>
            </div>

            {/* Breathing */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4" style={{ color: 'var(--chart-3)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.breathing')}</span>
              </div>
              <div className="flex gap-2">
                {(['normal', 'distressed', 'absent'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setTriageData(prev => ({ ...prev, breathing: prev.breathing === opt ? '' : opt })); resetVitalOverride(); }}
                    title={triageData.breathing === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.breathing === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.2)' : opt === 'distressed' ? 'rgba(255, 210, 166,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.breathing === opt
                        ? (opt === 'normal' ? 'var(--color-success)' : opt === 'distressed' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.breathing === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.3)' : opt === 'distressed' ? 'rgba(255, 210, 166,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt === 'normal' ? t('nurse.breathingNormal') : opt === 'distressed' ? t('nurse.breathingDistressed') : t('nurse.breathingAbsent')}
                  </button>
                ))}
              </div>
            </div>

            {/* Circulation */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Heart className="w-4 h-4" style={{ color: 'var(--chart-2)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.circulation')}</span>
              </div>
              <div className="flex gap-2">
                {(['normal', 'impaired', 'absent'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setTriageData(prev => ({ ...prev, circulation: prev.circulation === opt ? '' : opt })); resetVitalOverride(); }}
                    title={triageData.circulation === opt ? t('action.deselect') : undefined}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.circulation === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.2)' : opt === 'impaired' ? 'rgba(255, 210, 166,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.circulation === opt
                        ? (opt === 'normal' ? 'var(--color-success)' : opt === 'impaired' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.circulation === opt
                        ? (opt === 'normal' ? 'rgba(79, 199, 155,0.3)' : opt === 'impaired' ? 'rgba(255, 210, 166,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt === 'normal' ? t('nurse.circulationNormal') : opt === 'impaired' ? t('nurse.circulationImpaired') : t('nurse.circulationAbsent')}
                  </button>
                ))}
              </div>
            </div>

            {/* Consciousness (AVPU) */}
            <div className="p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nurse.consciousnessAvpu')}</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 keep-cols">
                {([
                  { key: 'alert' as const, label: t('nurse.avpuAlert') },
                  { key: 'verbal' as const, label: t('nurse.avpuVerbal') },
                  { key: 'pain' as const, label: t('nurse.avpuPain') },
                  { key: 'unresponsive' as const, label: t('nurse.avpuUnresponsive') },
                ]).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { setTriageData(prev => ({ ...prev, consciousness: prev.consciousness === opt.key ? '' : opt.key })); resetVitalOverride(); }}
                    title={triageData.consciousness === opt.key ? t('action.deselect') : undefined}
                    className="px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'rgba(79, 199, 155,0.2)' : opt.key === 'verbal' ? 'rgba(255, 210, 166,0.2)' : 'rgba(224, 49, 39,0.2)')
                        : 'var(--bg-card)',
                      color: triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'var(--color-success)' : opt.key === 'verbal' ? 'var(--color-warning)' : 'var(--color-danger)')
                        : 'var(--text-secondary)',
                      border: `1px solid ${triageData.consciousness === opt.key
                        ? (opt.key === 'alert' ? 'rgba(79, 199, 155,0.3)' : opt.key === 'verbal' ? 'rgba(255, 210, 166,0.3)' : 'rgba(224, 49, 39,0.3)')
                        : 'var(--border-light)'}`,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
    </>
  );
}

export function TriageDangerSigns({ f }: { f: TriageFormState }) {
  const { t, presentationCategory, setPresentationCategory, redCriteria, setRedCriteria, yellowCriteria, setYellowCriteria, capillaryRefillSeconds, setCapillaryRefillSeconds, setPregnancyStatus, gestationalAgeWeeks, setGestationalAgeWeeks, injuryMechanism, setInjuryMechanism, infectionRiskSigns, setInfectionRiskSigns, isolationRequired, setIsolationRequired, preArrivalCare, setPreArrivalCare, immediateInterventions, setImmediateInterventions, triagePathway, recordedPregnancyStatus, resetVitalOverride } = f;
  return (
    <>
          {/* WHO/ICRC/MSF Interagency Integrated Triage Tool. ABCC alone does
              not capture trauma, obstetric, exposure, infection or the full
              adult/paediatric danger-sign screen used at first contact. */}
          <div id="triage-section-danger" className="p-3 rounded-xl scroll-mt-3 space-y-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <div>
                <span className="block text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>IITT danger-sign screen</span>
                <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {triagePathway === 'pediatric_under_12' ? 'Pediatric pathway (under 12)' : 'Adult pathway (12+)'} · Any red sign requires immediate high-acuity care.
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label htmlFor="triage-presentation-category" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Presentation</label>
                <Select id="triage-presentation-category" value={presentationCategory} onChange={event => setPresentationCategory(event.target.value as typeof presentationCategory)} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="medical">Medical</option>
                  <option value="trauma">{t('triageForm.trauma')}</option>
                  <option value="obstetric">Obstetric</option>
                  <option value="mental_health">{t('triageForm.mentalHealth')}</option>
                  <option value="other">Other</option>
                </Select>
              </div>
              <div>
                <label htmlFor="triage-capillary-refill" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Capillary refill (seconds)</label>
                <input id="triage-capillary-refill" type="text" inputMode="decimal" value={capillaryRefillSeconds} onChange={event => { setCapillaryRefillSeconds(event.target.value); resetVitalOverride(); }} placeholder="2" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label htmlFor="triage-pregnancy-status" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('imgFlow.pregnancy')}</label>
                <Select id="triage-pregnancy-status" value={recordedPregnancyStatus} onChange={event => { setPregnancyStatus(event.target.value as typeof f.pregnancyStatus); resetVitalOverride(); }} style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  <option value="unknown">Unknown</option>
                  <option value="not_applicable">{t('imgFlow.pregnancyNA')}</option>
                  <option value="not_pregnant">{t('triageForm.notPregnant')}</option>
                  <option value="pregnant">Pregnant</option>
                  <option value="postpartum">Postpartum</option>
                </Select>
              </div>
              {recordedPregnancyStatus === 'pregnant' && (
                <div>
                  <label htmlFor="triage-gestational-age" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>Gestational age (weeks)</label>
                  <input id="triage-gestational-age" type="text" inputMode="numeric" value={gestationalAgeWeeks} onChange={event => setGestationalAgeWeeks(event.target.value)} placeholder="28" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
                </div>
              )}
              {presentationCategory === 'trauma' && (
                <div className="sm:col-span-2">
                  <label htmlFor="triage-injury-mechanism" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('triageForm.injuryMechanism')}</label>
                  <input id="triage-injury-mechanism" type="text" value={injuryMechanism} onChange={event => setInjuryMechanism(event.target.value)} placeholder="Road traffic crash, fall, penetrating injury…" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
                </div>
              )}
            </div>

            <fieldset className="rounded-lg p-2" style={{ border: '1px solid rgba(224,49,39,0.3)', background: 'var(--bg-card)' }}>
              <legend className="px-1 text-[10px] font-bold" style={{ color: 'var(--color-danger)' }}>Red — immediate</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {IITT_RED_CRITERIA.map(([code, label]) => (
                  <label key={code} className="flex items-start gap-2 text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={redCriteria.includes(code)} onChange={event => { setRedCriteria(current => event.target.checked ? [...current, code] : current.filter(item => item !== code)); resetVitalOverride(); }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-lg p-2" style={{ border: '1px solid rgba(255,153,51,0.4)', background: 'var(--bg-card)' }}>
              <legend className="px-1 text-[10px] font-bold" style={{ color: 'var(--color-warning)' }}>Yellow — urgent review</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {IITT_YELLOW_CRITERIA.map(([code, label]) => (
                  <label key={code} className="flex items-start gap-2 text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={yellowCriteria.includes(code)} onChange={event => { setYellowCriteria(current => event.target.checked ? [...current, code] : current.filter(item => item !== code)); resetVitalOverride(); }} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-lg p-2" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
              <legend className="px-1 text-[10px] font-bold" style={{ color: 'var(--text-primary)' }}>{t('triageForm.outbreakScreen')}</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {INFECTION_RISK_SIGNS.map(([code, label]) => (
                  <label key={code} className="flex items-start gap-2 text-[10px] leading-tight" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={infectionRiskSigns.includes(code)} onChange={event => setInfectionRiskSigns(current => event.target.checked ? [...current, code] : current.filter(item => item !== code))} />
                    <span>{label}</span>
                  </label>
                ))}
                <label className="flex items-start gap-2 text-[10px] font-semibold leading-tight" style={{ color: 'var(--color-danger)' }}>
                  <input type="checkbox" checked={isolationRequired} onChange={event => setIsolationRequired(event.target.checked)} />
                  <span>Separate immediately and apply facility isolation / IPC pathway</span>
                </label>
              </div>
            </fieldset>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label htmlFor="triage-pre-arrival-care" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('triageForm.preArrivalCare')}</label>
                <input id="triage-pre-arrival-care" type="text" value={preArrivalCare} onChange={event => setPreArrivalCare(event.target.value)} placeholder="First aid, medicines, fluids, referral treatment…" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label htmlFor="triage-immediate-interventions" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>{t('triageForm.immediateInterventions')}</label>
                <input id="triage-immediate-interventions" type="text" value={immediateInterventions} onChange={event => setImmediateInterventions(event.target.value)} placeholder="Airway manoeuvre, oxygen, bleeding control, glucose…" style={{ width: '100%', padding: '5px 8px', borderRadius: 6, fontSize: 12, background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }} />
              </div>
            </div>
          </div>
    </>
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
              <div className="flex gap-2">
                {manualRaiseOptions.map(option => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setManualPriorityRaise(current => current === option ? '' : option)}
                    className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                    style={{
                      background: effectiveManualPriorityRaise === option ? triagePriorityColor(option).bg : 'var(--bg-card)',
                      color: effectiveManualPriorityRaise === option ? triagePriorityColor(option).text : 'var(--text-secondary)',
                      border: `1px solid ${effectiveManualPriorityRaise === option ? triagePriorityColor(option).bg : 'var(--border-light)'}`,
                    }}
                  >
                    {t('nurse.raiseTo', { label: triagePriorityColor(option).label })}
                  </button>
                ))}
              </div>
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
