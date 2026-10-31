'use client';

/**
 * Register an ANC visit — one form, two homes. The ANC register (/anc) opens
 * it as a slider over its list of mothers; the patient chart opens it in the
 * workspace (Clinical forms → ANC Visit) with the mother already linked, so
 * recording a visit from the chart no longer leaves the chart.
 *
 * Correcting a saved visit is AncVisitEditor's job, not this form's.
 */

import { O3Layout, O3MultiSelectField } from '@/components/forms/O3Form';
import { useEffect, useMemo, useRef, useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import FormNotices from '@/components/overlay/FormNotices';
import Select from '@/components/Select';
import { Users } from '@/components/icons/lucide';
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
import './anc-visit-form.css';

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

  // Callers go through submit(), which has already stopped on any gap.
  const save = async () => {
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

  // ── Steps ──
  // The form is long (five groups, twelve required answers), so it is walked
  // one group at a time with Back / Next, as the triage form is. Each step
  // names the required fields it owns: Next stops on a step with one missing
  // and marks it, instead of a bare "complete the required fields" at the end
  // with nothing on screen to say which.
  const steps: { id: string; label: string; required: string[] }[] = [
    { id: 'mother', label: t('anc.motherInformation'), required: ['motherName', 'motherAge', 'gravida', 'parity', 'gestationalAge'] },
    { id: 'clinical', label: t('anc.clinicalAssessment'), required: ['urineProtein', 'bloodGroup', 'rhFactor'] },
    { id: 'lab', label: t('anc.labInterventions'), required: ['ironFolateGiven', 'tetanusVaccine', 'iptpDose'] },
    { id: 'risk', label: t('anc.riskAssessment'), required: ['riskLevel'] },
    { id: 'visit', label: t('anc.visitDate'), required: [] },
  ];
  const FIELD_LABEL: Record<string, string> = {
    motherName: t('anc.motherName'), motherAge: t('anc.age'), gravida: t('anc.gravida'), parity: t('anc.parity'),
    gestationalAge: t('anc.gaWeeks'), urineProtein: t('anc.urineProtein'), bloodGroup: t('anc.bloodGroup'),
    rhFactor: t('anc.rhFactor'), ironFolateGiven: t('anc.ironFolate'), tetanusVaccine: t('anc.tetanusVaccine'),
    iptpDose: t('anc.iptpDose').replace(/:$/, ''), riskLevel: t('anc.riskLevel'),
  };
  // Fields to mark as missing — set when Save stops on them.
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const missing = new Set(missingAncRequiredFields(form));
  const missingIn = (i: number) => steps[i].required.filter(f => missing.has(f));

  const stopOn = (fields: string[]) => {
    setFlagged(new Set(fields));
    showToast(t('anc.visitNotRegistered', { fields: fields.map(f => FIELD_LABEL[f]).join(', ') }), 'error');
  };
  const submit = () => {
    const first = steps.findIndex((_, i) => missingIn(i).length > 0);
    if (first >= 0) {
      stopOn(missingIn(first));
      document.querySelector(`[data-page="${steps[first].id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    void save();
  };

  // A required label, red with its field once a stop has flagged it. The
  // flag clears as soon as the field is answered.
  const req = (field: string) => ({
    className: `field-required${flagged.has(field) && missing.has(field) ? ' anc-field-missing' : ''}`,
  });
  const box = (field: string) => (flagged.has(field) && missing.has(field) ? 'anc-field-missing' : undefined);

  // The O3 frame's grey section body is the group, so no card.
  const groupClass = '';
  const groupStyle = undefined;
  // Counted answers are a choice of their range, not a typed number.
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const countSelect = (field: 'gravida' | 'parity' | 'gestationalAge' | 'iptpDose', from: number, to: number) => (
    <Select className={box(field)} value={form[field] === '' ? '' : String(form[field])}
      onChange={e => setForm({ ...form, [field]: e.target.value === '' ? '' : parseInt(e.target.value, 10) })}>
      <option value="" disabled>{t('o3form.chooseOption')}</option>
      {range(from, to).map(n => <option key={n} value={n}>{n}</option>)}
    </Select>
  );

  const linkBox = !lockedPatient && (
    <div className="rounded-lg p-3" style={{ background: 'var(--accent-light)', border: '1px solid var(--accent-border, rgba(33, 145, 208,0.25))' }}>
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
    </div>
  );

  const stepBody = [
    // 1 — Mother
    <div key="mother" className="space-y-4">
      {linkBox}
      <div className={groupClass} style={groupStyle}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label {...req('motherName')}>{t('anc.motherName')}</label>
            <input className={box('motherName')} type="text" value={form.motherName} onChange={e => setForm({ ...form, motherName: e.target.value })} placeholder={t('anc.fullNamePlaceholder')} />
          </div>
          <div>
            <label {...req('motherAge')}>{t('anc.age')}</label>
            <input className={box('motherAge')} type="number" step="1" min={14} max={55} value={form.motherAge} onChange={e => setForm({ ...form, motherAge: e.target.value === '' ? '' : parseInt(e.target.value, 10) })} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <div>
            <label {...req('gravida')}>{t('anc.gravida')}</label>
            {countSelect('gravida', 1, 20)}
          </div>
          <div>
            <label {...req('parity')}>{t('anc.parity')}</label>
            {countSelect('parity', 0, 20)}
          </div>
          <div>
            <label>{t('anc.visitNumberLabel')}</label>
            <Select value={String(form.visitNumber || 1)} onChange={e => setForm({ ...form, visitNumber: parseInt(e.target.value, 10) })}>
              {range(1, 12).map(n => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
          <div>
            <label {...req('gestationalAge')}>{t('anc.gaWeeks')}</label>
            {countSelect('gestationalAge', 4, 44)}
          </div>
        </div>
      </div>
    </div>,

    // 2 — Clinical assessment
    <div key="clinical" className={groupClass} style={groupStyle}>
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
          <label {...req('urineProtein')}>{t('anc.urineProtein')}</label>
          <Select className={box('urineProtein')} value={form.urineProtein} onChange={e => setForm({ ...form, urineProtein: e.target.value })}>
            <option value="" disabled>{t('o3form.chooseOption')}</option><option value="Not tested">{t('anc.optNotTested')}</option><option value="Negative">{t('anc.optNegative')}</option><option value="Trace">{t('anc.optTrace')}</option><option>+</option><option>++</option><option>+++</option>
          </Select>
        </div>
        <div>
          <label {...req('bloodGroup')}>{t('anc.bloodGroup')}</label>
          <Select className={box('bloodGroup')} value={form.bloodGroup} onChange={e => setForm({ ...form, bloodGroup: e.target.value })}>
            <option value="" disabled>{t('o3form.chooseOption')}</option><option value="Unknown">{t('anc.optUnknown')}</option><option>O</option><option>A</option><option>B</option><option>AB</option>
          </Select>
        </div>
        <div>
          <label {...req('rhFactor')}>{t('anc.rhFactor')}</label>
          <Select className={box('rhFactor')} value={form.rhFactor} onChange={e => setForm({ ...form, rhFactor: e.target.value })}>
            <option value="" disabled>{t('o3form.chooseOption')}</option><option value="Unknown">{t('anc.optUnknown')}</option><option>+</option><option>-</option>
          </Select>
        </div>
      </div>
    </div>,

    // 3 — Lab & interventions (stored values stay English; labels translate)
    <div key="lab" className={groupClass} style={groupStyle}>
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
          <label {...req('ironFolateGiven')}>{t('anc.ironFolate')}</label>
          <Select className={box('ironFolateGiven')} value={form.ironFolateGiven === null ? '' : String(form.ironFolateGiven)} onChange={e => setForm({ ...form, ironFolateGiven: e.target.value === '' ? null : e.target.value === 'true' })}>
            <option value="" disabled>{t('o3form.chooseOption')}</option><option value="true">{t('anc.optGiven')}</option><option value="false">{t('anc.optNotGiven')}</option>
          </Select>
        </div>
        <div>
          <label {...req('tetanusVaccine')}>{t('anc.tetanusVaccine')}</label>
          <Select className={box('tetanusVaccine')} value={form.tetanusVaccine === null ? '' : String(form.tetanusVaccine)} onChange={e => setForm({ ...form, tetanusVaccine: e.target.value === '' ? null : e.target.value === 'true' })}>
            <option value="" disabled>{t('o3form.chooseOption')}</option><option value="true">{t('anc.optGiven')}</option><option value="false">{t('anc.optNotGiven')}</option>
          </Select>
        </div>
        <div>
          <label {...req('iptpDose')}>{FIELD_LABEL.iptpDose}</label>
          {countSelect('iptpDose', 0, 5)}
        </div>
      </div>
    </div>,

    // 4 — Risk
    <div key="risk" className={groupClass} style={groupStyle}>
      <div className="mb-3">
        <label {...req('riskLevel')}>{t('anc.riskLevel')}</label>
        <Select className={box('riskLevel')} value={form.riskLevel} onChange={e => setForm({ ...form, riskLevel: e.target.value as AncRiskLevel })}>
          <option value="" disabled>{t('o3form.chooseOption')}</option>
          <option value="low">{t('anc.riskLevelLow')}</option>
          <option value="moderate">{t('anc.riskLevelModerate')}</option>
          <option value="high">{t('anc.riskLevelHigh')}</option>
        </Select>
      </div>
      {/* Tick-all-that-apply as a dropdown, like every clinical form. */}
      <O3MultiSelectField
        id="anc-risk-factors"
        label={t('anc.riskFactors')}
        values={form.riskFactors}
        options={RISK_FACTOR_OPTIONS.map(rf => ({ value: rf, label: rf.replace(/_/g, ' ') }))}
        onChange={next => setForm({ ...form, riskFactors: next })}
        tone="danger"
      />
    </div>,

    // 5 — Visit date & notes
    <div key="visit" className="space-y-4">
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
        <textarea rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={t('anc.clinicalNotesPlaceholder')} />
      </div>
    </div>,
  ];

  // The visit is the O3 frame every clinical form shares, in the chart and on
  // the ANC register's slider alike: the five steps are its pages, listed on
  // the left; Save checks every page and stops on the first one with a gap
  // (flagged in red).
  const frame = (
    <O3Layout
      className="o3f-module anc-visit-form"
      pages={steps.map((s, i) => ({
        id: s.id,
        label: s.label,
        sections: [{ id: s.id, label: s.label, body: stepBody[i] }],
      }))}
      notice={<FormNotices />}
      onSave={submit}
      saveLabel={t('anc.registerVisit')}
      saving={saving}
      onCancel={onClose}
    />
  );

  if (layout === 'workspace') return frame;
  return (
    <FormSlider title={t('anc.registerModalTitle')} width={880} onClose={onClose} busy={saving} flush>
      {frame}
    </FormSlider>
  );
}
