'use client';

import { patientFullName, patientGenderAge } from '@/lib/patient-utils';
import { X, AlertTriangle } from '@/components/icons/lucide';
import type { TriageFormState } from './useTriageForm';

export function TriagePatientPicker({ f }: { f: TriageFormState }) {
  const { t, setTriagePatientId, triagePatientSearch, setTriagePatientSearch, setOverrideVitalUrgency, setVitalUrgencyOverrideReason, triagePatientMatches, selectedTriagePatient, resetTriageBookkeeping, lockedPatientId } = f;
  return (
    <>
          {/* Patient picker */}
          <div id="triage-section-patient" className="relative scroll-mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nurse.patient')}</label>
            {selectedTriagePatient ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33, 145, 208,0.25))' }}>
                <div className="flex items-baseline gap-2 min-w-0">
                  <p className="text-sm font-semibold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
                    {patientFullName(selectedTriagePatient)}
                  </p>
                  <p className="text-[11px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                    {selectedTriagePatient.hospitalNumber} · {patientGenderAge(selectedTriagePatient)}
                  </p>
                </div>
                {/* No clear button on the per-patient page: the patient is the
                    page, not a field on it. */}
                {!lockedPatientId && (
                  <button onClick={() => { setTriagePatientId(''); setTriagePatientSearch(''); setOverrideVitalUrgency(false); setVitalUrgencyOverrideReason(''); resetTriageBookkeeping(); }} className="p-1.5 rounded-lg flex-shrink-0" style={{ background: 'var(--overlay-subtle)' }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={triagePatientSearch}
                  onChange={e => setTriagePatientSearch(e.target.value)}
                  placeholder={t('nurse.searchPatientPlaceholder')}
                  className="w-full px-3 py-1 rounded-lg text-[10px]"
                  style={{
                    background: 'var(--overlay-subtle)',
                    border: '1px solid var(--border-light)',
                    color: 'var(--text-primary)',
                  }}
                />
                {triagePatientMatches.length > 0 && (
                  <div className="absolute start-0 end-0 mt-1 rounded-xl overflow-hidden z-10" style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg)' }}>
                    {triagePatientMatches.map(p => (
                      <button
                        key={p._id}
                        onClick={() => { setTriagePatientId(p._id); setTriagePatientSearch(''); setOverrideVitalUrgency(false); setVitalUrgencyOverrideReason(''); resetTriageBookkeeping(); }}
                        className="w-full text-start px-3 py-2 text-xs hover:bg-[var(--overlay-subtle)]"
                        style={{ borderBottom: '1px solid var(--border-light)' }}
                      >
                        <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{patientFullName(p)}</div>
                        <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber} · {p.gender}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
    </>
  );
}

export function TriageChiefComplaint({ f }: { f: TriageFormState }) {
  const { t, triageComplaint, setTriageComplaint, lockedPatientId } = f;
  return (
    <>
          {/* Chief complaint */}
          <div id={lockedPatientId ? 'triage-section-patient' : undefined} className="scroll-mt-3">
            <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>{t('nurse.chiefComplaint')}</label>
            <input
              type="text"
              value={triageComplaint}
              onChange={e => setTriageComplaint(e.target.value)}
              placeholder={t('nurse.chiefComplaintPlaceholder')}
              className="w-full px-3 py-2 rounded-xl text-sm"
              style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
          </div>
    </>
  );
}

export function TriageVitalSafetySummary({ f }: { f: TriageFormState }) {
  const { triageData, overrideVitalUrgency, setOverrideVitalUrgency, vitalUrgencyOverrideReason, setVitalUrgencyOverrideReason, vitalErrors, vitalWarnings, recommendedPriority, recommendationRaisesPriority } = f;
  return (
    <>
          {(Object.keys(vitalErrors).length > 0 || vitalWarnings.length > 0) && (
            <div
              id="triage-vital-safety-summary"
              role="alert"
              aria-live="polite"
              className="p-3 rounded-xl"
              style={{
                background: Object.keys(vitalErrors).length > 0 || vitalWarnings.some(item => item.urgency === 'RED')
                  ? 'rgba(224, 49, 39,0.10)'
                  : 'rgba(255, 127, 0,0.12)',
                border: `1px solid ${Object.keys(vitalErrors).length > 0 || vitalWarnings.some(item => item.urgency === 'RED')
                  ? 'var(--color-danger)'
                  : 'var(--color-warning)'}`,
              }}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: Object.keys(vitalErrors).length > 0 || vitalWarnings.some(item => item.urgency === 'RED') ? 'var(--color-danger)' : 'var(--color-warning)' }} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {Object.keys(vitalErrors).length > 0
                      ? 'Vital signs need correction before Save'
                      : recommendedPriority
                        ? `Clinical safety warning · Recommended ${recommendedPriority}`
                        : 'Clinical safety warning · Complete ABCC to calculate urgency'}
                  </p>
                  {Object.entries(vitalErrors).map(([field, message]) => (
                    <p key={field} className="text-[10px] mt-1" style={{ color: 'var(--color-danger)' }}>{message}</p>
                  ))}
                  {vitalWarnings.map(item => (
                    <p key={item.code} className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                      <strong>{item.urgency}:</strong> {item.message}
                    </p>
                  ))}
                  {recommendationRaisesPriority && !overrideVitalUrgency && (
                    <p className="text-[10px] font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>
                      Save will use {recommendedPriority} instead of the ABCC-only {triageData.priority} priority.
                    </p>
                  )}
                  {recommendationRaisesPriority && (
                    <div className="mt-2 pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
                      <label className="flex items-start gap-2 text-[10px] font-semibold cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                        <input
                          type="checkbox"
                          checked={overrideVitalUrgency}
                          onChange={event => setOverrideVitalUrgency(event.target.checked)}
                          className="mt-0.5"
                        />
                        Override and save at the ABCC-only {triageData.priority} priority
                      </label>
                      {overrideVitalUrgency && (
                        <div className="mt-2">
                          <label htmlFor="triage-vital-override-reason" className="text-[9px] font-semibold uppercase tracking-wider block" style={{ color: 'var(--color-danger)' }}>
                            Clinical reason for override (required)
                          </label>
                          <textarea
                            id="triage-vital-override-reason"
                            rows={2}
                            value={vitalUrgencyOverrideReason}
                            onChange={event => setVitalUrgencyOverrideReason(event.target.value)}
                            placeholder="Document reassessment findings and why the lower urgency is clinically appropriate."
                            className="w-full px-2 py-1.5 rounded-lg text-xs mt-1"
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--color-danger)', color: 'var(--text-primary)' }}
                            required
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
    </>
  );
}
