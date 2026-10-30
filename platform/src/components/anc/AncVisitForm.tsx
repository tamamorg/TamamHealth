'use client';

/**
 * Register an ANC visit — one form, two homes. The ANC register (/anc) opens
 * it as a slider over its list of mothers; the patient chart opens it in the
 * workspace (Clinical forms → ANC Visit) with the mother already linked, so
 * recording a visit from the chart no longer leaves the chart.
 *
 * Correcting a saved visit is AncVisitEditor's job, not this form's.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import FormNotices from '@/components/overlay/FormNotices';
import Select from '@/components/Select';
import { HeartPulse, Users } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { useANC } from '@/lib/hooks/useANC';
import { usePatients } from '@/lib/hooks/usePatients';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { patientAge } from '@/lib/patient-utils';
import { todayIso } from '@/lib/date-utils';
import { describeError } from '@/lib/user-facing-error';
import {
  createAncRegistrationForm,
  deriveAncPatientPrefill,
  missingAncRequiredFields,
  type AncRiskLevel,
} from '@/lib/forms/anc-form-policy';
import type { ANCVisitDoc, PatientDoc } from '@/lib/db-types';
import '@/components/ehr/chart/panels/start-visit-panel.css';

const RISK_FACTOR_OPTIONS = [
  'hypertension', 'anemia', 'previous_csection', 'multiple_pregnancy',
  'hiv_positive', 'rh_negative', 'primigravida', 'diabetes',
  'preeclampsia', 'bleeding', 'malaria_in_pregnancy', 'proteinuria',
];

export default function AncVisitForm({ layout, lockedPatient, onClose, onSaved }: {
  /** 'slider' on the ANC register; 'workspace' in the chart drawer. */
  layout: 'slider' | 'workspace';
  /** The chart's patient — linked and fixed; the link box is not shown. */
  lockedPatient?: PatientDoc;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { visits, register } = useANC();
  const { patients } = usePatients();
  const [saving, setSaving] = useState(false);

  const [patientLookup, setPatientLookup] = useState('');
  const [form, setForm] = useState(() => createAncRegistrationForm(todayIso()));
  const [linkedPatientId, setLinkedPatientId] = useState<string | undefined>(undefined);

  const unlink = () => {
    setForm(createAncRegistrationForm(todayIso()));
    setLinkedPatientId(undefined);
    setPatientLookup('');
  };

  // Female patients of childbearing age (10–55) for the lookup.
  const patientMatches = useMemo(() => {
    if (!patientLookup || patientLookup.length < 2) return [];
    const q = patientLookup.toLowerCase();
    return (patients || [])
      .filter(p => {
        if (p.gender !== 'Female') return false;
        const age = patientAge(p) ?? 0;
        if (age < 10 || age > 55) return false;
        return (
          `${p.firstName} ${p.surname}`.toLowerCase().includes(q) ||
          (p.hospitalNumber || '').toLowerCase().includes(q)
        );
      })
      .slice(0, 6);
  }, [patientLookup, patients]);

  const linkPatient = (p: PatientDoc) => {
    const age = patientAge(p);
    setLinkedPatientId(p._id);
    setForm(current => deriveAncPatientPrefill(current, {
      patientId: p._id,
      patientName: `${p.firstName || ''} ${p.surname || ''}`.trim(),
      age: age ?? undefined,
    }, visits));
    setPatientLookup('');
  };

  // Link the chart's mother. Re-run when `visits` first arrives so the visit
  // number and obstetric history prefill from her earlier visits.
  const prefilledRef = useRef<string | null>(null);
  const visitsReady = visits.length > 0;
  useEffect(() => {
    const target = lockedPatient;
    if (!target) return;
    const key = `${target._id}:${visitsReady}`;
    if (prefilledRef.current === key) return;
    prefilledRef.current = key;
    linkPatient(target);
    // linkPatient is recreated each render; the inputs above are the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedPatient, visitsReady]);

  const save = async () => {
    if (missingAncRequiredFields(form).length > 0) {
      showToast(t('patientNew.toastFillRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      await register({
        motherId: form.motherId || `mother-new-${Date.now()}`,
        motherName: form.motherName,
        motherAge: Number(form.motherAge),
        gravida: Number(form.gravida),
        parity: Number(form.parity),
        visitNumber: form.visitNumber,
        visitDate: form.visitDate,
        gestationalAge: Number(form.gestationalAge),
        facilityId: currentUser?.hospitalId || '',
        facilityName: currentUser?.hospitalName || '',
        state: currentUser?.hospital?.state || '',
        bloodPressure: form.bloodPressure,
        weight: Number(form.weight),
        fundalHeight: Number(form.fundalHeight),
        fetalHeartRate: Number(form.fetalHeartRate),
        hemoglobin: Number(form.hemoglobin),
        urineProtein: form.urineProtein,
        bloodGroup: form.bloodGroup,
        rhFactor: form.rhFactor,
        hivStatus: form.hivStatus,
        malariaTest: form.malariaTest,
        syphilisTest: form.syphilisTest,
        ironFolateGiven: form.ironFolateGiven === true,
        tetanusVaccine: form.tetanusVaccine === true,
        iptpDose: Number(form.iptpDose),
        riskFactors: form.riskFactors,
        riskLevel: form.riskLevel as ANCVisitDoc['riskLevel'],
        birthPlan: { facility: form.birthPlanFacility, transport: form.birthPlanTransport, bloodDonor: form.birthPlanBloodDonor },
        nextVisitDate: form.nextVisitDate,
        notes: form.notes,
        attendedBy: currentUser?.name || '',
        attendedByRole: currentUser?.role || 'doctor',
        patientId: linkedPatientId,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      // Keep the form open: a refused save (e.g. no facility/organisation) must not look saved.
      showToast(describeError(err, t('msg.ancVisitNotSavedTry')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const linked = linkedPatientId ? patients.find(p => p._id === linkedPatientId) : undefined;
  const groupClass = 'p-3 rounded-lg';
  const groupStyle = { background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' };
  const groupTitle = (text: string) => (
    <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>{text}</p>
  );

  const fields = (
    <div className="space-y-4">
      {/* Link to an existing patient (recommended). In the chart the mother is
          the chart's patient, already named in its header — no box. */}
      {!lockedPatient && <div className="rounded-lg p-3" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33, 145, 208,0.25))' }}>
        <label className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--accent-primary)', textTransform: 'uppercase' }}>
          <Users className="w-3 h-3" />
          {t('anc.linkExistingMother')}
        </label>
        {linked ? (
          <div className="flex items-center justify-between p-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
            <div className="text-xs">
              <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{linked.firstName} {linked.surname}</p>
              <p style={{ color: 'var(--text-muted)' }}>{linked.hospitalNumber}{linked.estimatedAge ? ` · ${linked.estimatedAge}y` : ''}</p>
            </div>
            <button type="button" onClick={unlink} className="text-[10px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{t('anc.unlink')}</button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={patientLookup}
              onChange={e => setPatientLookup(e.target.value)}
              placeholder={t('anc.searchFemalePatientPlaceholder')}
              className="w-full text-xs p-2 rounded-lg outline-none"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
            />
            {patientMatches.length > 0 && (
              <div className="mt-1.5 rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-light)' }}>
                {patientMatches.map(p => (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => linkPatient(p)}
                    className="w-full px-2.5 py-2 text-start text-xs hover:bg-[var(--overlay-subtle)] transition-colors"
                    style={{ borderBottom: '1px solid var(--border-light)' }}
                  >
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{p.firstName} {p.surname}</p>
                    <p style={{ color: 'var(--text-muted)' }}>{p.hospitalNumber}{p.estimatedAge ? ` · ${p.estimatedAge}y` : ''}</p>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{t('anc.linkingNote')}</p>
          </>
        )}
            </div>}

      {/* Mother */}
      <div className={groupClass} style={groupStyle}>
        {groupTitle(t('anc.motherInformation'))}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="field-required">{t('anc.motherName')}</label>
            <input type="text" required value={form.motherName} onChange={e => setForm({ ...form, motherName: e.target.value })} placeholder={t('anc.fullNamePlaceholder')} />
          </div>
          <div>
            <label>{t('anc.age')}</label>
            <input type="number" step="1" required min={14} max={55} value={form.motherAge} onChange={e => setForm({ ...form, motherAge: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <div>
            <label>{t('anc.gravida')}</label>
            <input type="number" step="1" required min={1} max={20} value={form.gravida} onChange={e => setForm({ ...form, gravida: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
          <div>
            <label>{t('anc.parity')}</label>
            <input type="number" step="1" required min={0} max={20} value={form.parity} onChange={e => setForm({ ...form, parity: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
          <div>
            <label>{t('anc.visitNumberLabel')}</label>
            <input type="number" step="1" min={1} max={20} value={form.visitNumber} onChange={e => setForm({ ...form, visitNumber: parseInt(e.target.value, 10) || 0 })} />
          </div>
          <div>
            <label>{t('anc.gaWeeks')}</label>
            <input type="number" step="1" required min={4} max={44} value={form.gestationalAge} onChange={e => setForm({ ...form, gestationalAge: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
        </div>
      </div>

      {/* Clinical assessment */}
      <div className={groupClass} style={groupStyle}>
        {groupTitle(t('anc.clinicalAssessment'))}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label>{t('anc.bpMmhg')}</label>
            <input type="text" value={form.bloodPressure} onChange={e => setForm({ ...form, bloodPressure: e.target.value })} placeholder="120/80" />
          </div>
          <div>
            <label>{t('anc.weightKg')}</label>
            <input type="number" step="0.1" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
          </div>
          <div>
            <label>{t('anc.fundalHeight')}</label>
            <input type="number" step="any" value={form.fundalHeight} onChange={e => setForm({ ...form, fundalHeight: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
          <div>
            <label>{t('anc.fetalHrBpm')}</label>
            <input type="number" step="1" value={form.fetalHeartRate} onChange={e => setForm({ ...form, fetalHeartRate: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <div>
            <label>{t('anc.hemoglobin')}</label>
            <input type="number" step="0.1" value={form.hemoglobin} onChange={e => setForm({ ...form, hemoglobin: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
          </div>
          <div>
            <label>{t('anc.urineProtein')}</label>
            <Select required value={form.urineProtein} onChange={e => setForm({ ...form, urineProtein: e.target.value })}>
              <option value="" disabled>{t('common.select')}</option><option value="Not tested">{t('anc.optNotTested')}</option><option value="Negative">{t('anc.optNegative')}</option><option value="Trace">{t('anc.optTrace')}</option><option>+</option><option>++</option><option>+++</option>
            </Select>
          </div>
          <div>
            <label>{t('anc.bloodGroup')}</label>
            <Select required value={form.bloodGroup} onChange={e => setForm({ ...form, bloodGroup: e.target.value })}>
              <option value="" disabled>{t('common.select')}</option><option value="Unknown">{t('anc.optUnknown')}</option><option>O</option><option>A</option><option>B</option><option>AB</option>
            </Select>
          </div>
          <div>
            <label>{t('anc.rhFactor')}</label>
            <Select required value={form.rhFactor} onChange={e => setForm({ ...form, rhFactor: e.target.value })}>
              <option value="" disabled>{t('common.select')}</option><option value="Unknown">{t('anc.optUnknown')}</option><option>+</option><option>-</option>
            </Select>
          </div>
        </div>
      </div>

      {/* Lab & interventions — stored values stay English; labels translate. */}
      <div className={groupClass} style={groupStyle}>
        {groupTitle(t('anc.labInterventions'))}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label>{t('anc.hivStatus')}</label>
            <Select value={form.hivStatus} onChange={e => setForm({ ...form, hivStatus: e.target.value })}>
              <option value="Not tested">{t('anc.optNotTested')}</option>
              <option value="Negative">{t('anc.optNegative')}</option>
              <option value="Positive">{t('anc.optPositive')}</option>
              <option value="Positive (on ART)">{t('anc.optPositiveOnArt')}</option>
            </Select>
          </div>
          <div>
            <label>{t('anc.malariaTest')}</label>
            <Select value={form.malariaTest} onChange={e => setForm({ ...form, malariaTest: e.target.value })}>
              <option value="Negative">{t('anc.optNegative')}</option>
              <option value="Positive">{t('anc.optPositive')}</option>
              <option value="Not tested">{t('anc.optNotTested')}</option>
            </Select>
          </div>
          <div>
            <label>{t('anc.syphilisTest')}</label>
            <Select value={form.syphilisTest} onChange={e => setForm({ ...form, syphilisTest: e.target.value })}>
              <option value="Non-reactive">{t('anc.optNonReactive')}</option>
              <option value="Reactive">{t('anc.optReactive')}</option>
              <option value="Not tested">{t('anc.optNotTested')}</option>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div>
            <label>{t('anc.ironFolate')}</label>
            <Select required value={form.ironFolateGiven === null ? '' : String(form.ironFolateGiven)} onChange={e => setForm({ ...form, ironFolateGiven: e.target.value === '' ? null : e.target.value === 'true' })}>
              <option value="" disabled>{t('common.select')}</option><option value="true">{t('anc.optGiven')}</option><option value="false">{t('anc.optNotGiven')}</option>
            </Select>
          </div>
          <div>
            <label>{t('anc.tetanusVaccine')}</label>
            <Select required value={form.tetanusVaccine === null ? '' : String(form.tetanusVaccine)} onChange={e => setForm({ ...form, tetanusVaccine: e.target.value === '' ? null : e.target.value === 'true' })}>
              <option value="" disabled>{t('common.select')}</option><option value="true">{t('anc.optGiven')}</option><option value="false">{t('anc.optNotGiven')}</option>
            </Select>
          </div>
          <div>
            <label>{t('anc.iptpDose')}</label>
            <input type="number" step="1" required min={0} max={5} value={form.iptpDose} onChange={e => setForm({ ...form, iptpDose: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
        </div>
      </div>

      {/* Risk */}
      <div className={groupClass} style={groupStyle}>
        {groupTitle(t('anc.riskAssessment'))}
        <div className="mb-3">
          <label>{t('anc.riskLevel')}</label>
          <Select required value={form.riskLevel} onChange={e => setForm({ ...form, riskLevel: e.target.value as AncRiskLevel })}>
            <option value="" disabled>{t('common.select')}</option>
            <option value="low">{t('anc.riskLevelLow')}</option>
            <option value="moderate">{t('anc.riskLevelModerate')}</option>
            <option value="high">{t('anc.riskLevelHigh')}</option>
          </Select>
        </div>
        <div className="flex items-center justify-between mb-1">
          <label style={{ marginBottom: 0 }}>{t('anc.riskFactors')}</label>
          {form.riskFactors.length > 0 && (
            <button type="button" onClick={() => setForm({ ...form, riskFactors: [] })} className="text-[10px] font-semibold" style={{ color: 'var(--accent-primary)' }}>
              {t('action.clear')}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {RISK_FACTOR_OPTIONS.map(rf => {
            const on = form.riskFactors.includes(rf);
            return (
              <button
                key={rf}
                type="button"
                aria-pressed={on}
                onClick={() => setForm({ ...form, riskFactors: on ? form.riskFactors.filter(r => r !== rf) : [...form.riskFactors, rf] })}
                className="text-xs px-2 py-1 rounded-full border transition-colors"
                style={{
                  borderColor: on ? 'var(--color-danger)' : 'var(--border-light)',
                  background: on ? 'rgba(224, 49, 39,0.12)' : 'transparent',
                  color: on ? 'var(--color-danger-text)' : 'var(--text-muted)',
                }}
              >
                {rf.replace(/_/g, ' ')}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dates & notes */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="field-required">{t('anc.visitDate')}</label>
          <input type="date" required value={form.visitDate} onChange={e => setForm({ ...form, visitDate: e.target.value })} />
        </div>
        <div>
          <label>{t('anc.nextVisitDate')}</label>
          <input type="date" value={form.nextVisitDate} onChange={e => setForm({ ...form, nextVisitDate: e.target.value })} />
        </div>
      </div>
      <div>
        <label>{t('anc.notes')}</label>
        <textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t('anc.clinicalNotesPlaceholder')} />
      </div>
    </div>
  );

  if (layout === 'workspace') {
    return (
      <div className="sv-root">
        <div className="sv-body ws-module-form">{fields}</div>
        <FormNotices />
        <div className="sv-footer">
          <button type="button" className="sv-footer-btn sv-footer-btn--discard" onClick={onClose} disabled={saving}>
            {t('action.cancel')}
          </button>
          <button type="button" className="sv-footer-btn sv-footer-btn--primary" onClick={() => void save()} disabled={saving}>
            {t('anc.registerVisit')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <FormSlider
      title={t('anc.registerModalTitle')}
      width={672}
      onClose={onClose}
      busy={saving}
      footer={<>
        <button type="button" onClick={onClose} className="btn btn-secondary" disabled={saving}>{t('action.cancel')}</button>
        <button type="button" onClick={() => void save()} className="btn btn-primary" disabled={saving}>
          <HeartPulse className="w-4 h-4" /> {t('anc.registerVisit')}
        </button>
      </>}
    >
      {fields}
    </FormSlider>
  );
}
