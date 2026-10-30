'use client';

/**
 * Admit a patient to a ward — one form, two homes. The Wards page opens it as
 * a slider over its admissions list; the patient chart opens it in the
 * workspace (Clinical forms → Ward Admission) with the patient fixed, so
 * admitting from the chart no longer leaves the chart.
 *
 * `encounterId` is the open visit the admission grew out of: admission closes
 * it. It belongs to the patient it arrived with, so changing the patient
 * drops it.
 */

import { useCallback, useMemo, useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import FormNotices from '@/components/overlay/FormNotices';
import CodedSearchField from '@/components/CodedSearchField';
import Select from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { patientFullName } from '@/lib/patient-utils';
import { describeError } from '@/lib/user-facing-error';
import type { PatientDoc } from '@/lib/db-types';
import type { AdmissionDoc, WardDoc } from '@/lib/db-types-ward';
import '@/components/ehr/chart/panels/start-visit-panel.css';

export default function WardAdmitForm({
  layout, encounterId, lockedPatient, onClose, onAdmitted,
}: {
  /** 'slider' on the Wards page; 'workspace' in the chart drawer. */
  layout: 'slider' | 'workspace';
  /** The open visit to close on admission (chart only). */
  encounterId?: string;
  /** The chart's patient — fixed, and resolved even when outside the scoped list. */
  lockedPatient?: PatientDoc;
  onClose: () => void;
  onAdmitted?: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const facilitySettings = useSettings();
  const { patients } = usePatients();
  const { wards, beds, admit } = useWards();
  const [saving, setSaving] = useState(false);

  const [patientQuery, setPatientQuery] = useState('');
  const patientOptions = useMemo(() => patients.map(p => ({
    code: p._id,
    name: `${patientFullName(p)} · ${p.hospitalNumber}`,
    meta: [p.gender, p.dateOfBirth].filter(Boolean).join(' · '),
    keywords: [p.hospitalNumber, p.phone].filter(Boolean) as string[],
  })), [patients]);
  const [form, setForm] = useState({
    patientId: lockedPatient?._id || '',
    admittingDiagnosis: '',
    severity: 'moderate' as AdmissionDoc['severity'],
    wardId: '',
    bedId: '',
    isolationRequired: false,
    encounterId: encounterId || '',
  });
  const patient = lockedPatient
    || (form.patientId ? patients.find(p => p._id === form.patientId) : undefined);

  const facilityId = currentUser?.hospitalId || currentUser?.hospital?._id;
  const facilityWards = useMemo(
    () => facilityId ? wards.filter(w => w.facilityId === facilityId) : wards,
    [wards, facilityId],
  );
  // Beds actually free in the chosen ward — without this the bed field was
  // free text, `bedId` never got set, and ward occupancy sat at 0%.
  const availableBedsForWard = useMemo(
    () => form.wardId ? beds.filter(b => b.wardId === form.wardId && b.status === 'available') : [],
    [beds, form.wardId],
  );
  // Free beds for a ward, resilient to two data models: a facility that tracks
  // individual bed documents (count the available ones) and one that keeps only
  // a denormalised `availableBeds` tally on the ward. The tally alone hid every
  // ward whose count had drifted to 0 while beds were in fact free.
  const wardFreeBeds = useCallback((w: WardDoc) => {
    const hasBedDocs = beds.some(b => b.wardId === w._id);
    return hasBedDocs
      ? beds.filter(b => b.wardId === w._id && b.status === 'available').length
      : (w.availableBeds ?? 0);
  }, [beds]);
  const admittableWards = useMemo(
    () => facilityWards.filter(w => w.isActive !== false && wardFreeBeds(w) > 0),
    [facilityWards, wardFreeBeds],
  );

  const handleAdmit = async () => {
    const ward = facilityWards.find(w => w._id === form.wardId);
    if (!patient || !ward) {
      showToast(t('ward.selectPatientAndWard'), 'error');
      return;
    }
    if (!form.admittingDiagnosis.trim()) {
      showToast(t('ward.diagnosisRequiredToast'), 'error');
      return;
    }
    if (!currentUser) return;
    const bed = form.bedId ? beds.find(b => b._id === form.bedId) : undefined;
    const roomClassCode = bed?.roomClass ?? ward.roomClass ?? 'standard';
    const configuredClass = facilitySettings.roomClasses.find(item => item.code === roomClassCode && item.active);
    setSaving(true);
    try {
      await admit({
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.surname}`.trim(),
        hospitalNumber: patient.hospitalNumber,
        admittingDiagnosis: form.admittingDiagnosis.trim(),
        severity: form.severity,
        admittedBy: currentUser._id || currentUser.username || 'unknown',
        admittedByName: currentUser.name,
        wardId: ward._id,
        wardName: ward.name,
        bedId: bed?._id,
        bedNumber: bed?.bedNumber,
        roomClass: roomClassCode,
        nightlyTariff: bed?.nightlyTariff ?? ward.nightlyTariff ?? configuredClass?.nightlyTariff,
        tariffCurrency: bed?.tariffCurrency ?? ward.tariffCurrency ?? configuredClass?.currency,
        admissionDepositRequired: bed?.admissionDeposit ?? ward.admissionDeposit ?? configuredClass?.admissionDeposit,
        facilityId: ward.facilityId,
        facilityName: ward.facilityName,
        facilityLevel: ward.facilityLevel,
        orgId: ward.orgId || currentUser.orgId,
        attendingPhysician: currentUser._id || currentUser.username || 'unknown',
        attendingPhysicianName: currentUser.name,
        isolationRequired: form.isolationRequired,
        // The patient's geographic state, else the admitting facility's —
        // never the facility's name, which corrupted surveillance joins.
        state: patient.state || currentUser.hospital?.state || '',
        // Closes the OPD visit this admission grew out of, when there is one.
        // Best-effort on the service side — an admission never fails on it.
        encounterId: form.encounterId || undefined,
      });
      showToast(t('ward.admittedToast', { name: `${patient.firstName} ${patient.surname}`, ward: ward.name }), 'success');
      onAdmitted?.();
      onClose();
    } catch (err) {
      console.error(err);
      showToast(describeError(err, t('ward.admitFailedToast')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const labelClass = 'text-xs font-semibold uppercase tracking-wider mb-1 block';
  const labelStyle = { color: 'var(--text-muted)' };
  const fields = (
    <div className="space-y-3">
      <div>
        <label className={`field-required ${labelClass}`} style={labelStyle}>{t('ward.patientRequired')}</label>
        {/* Search, not a list: a dropdown of the first 200 patients left most
            of a large facility unadmittable from here. */}
        {patient ? (
          <div className="tamam-panel-picked-chip">
            <span>{patientFullName(patient)} <span style={{ color: 'var(--text-muted)' }}>· {patient.hospitalNumber}</span></span>
            {!lockedPatient && (
              <button type="button" onClick={() => setForm({ ...form, patientId: '', encounterId: '' })}>{t('ward.changePatient')}</button>
            )}
          </div>
        ) : (
          <CodedSearchField
            label=""
            placeholder={t('ward.selectPatient')}
            options={patientOptions}
            value={patientQuery}
            onChange={setPatientQuery}
            onSelect={option => { setForm({ ...form, patientId: option.code, encounterId: '' }); setPatientQuery(''); }}
            showCodeBadge={false}
          />
        )}
      </div>
      <div>
        <label className={`field-required ${labelClass}`} style={labelStyle}>{t('ward.admittingDiagnosisRequired')}</label>
        <input type="text" value={form.admittingDiagnosis} onChange={e => setForm({ ...form, admittingDiagnosis: e.target.value })} placeholder={t('ward.admittingDiagnosisPlaceholder')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} style={labelStyle}>{t('ward.severity')}</label>
          <Select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as AdmissionDoc['severity'] })}>
            <option value="mild">{t('ward.severityMild')}</option>
            <option value="moderate">{t('ward.severityModerate')}</option>
            <option value="severe">{t('ward.severitySevere')}</option>
            <option value="critical">{t('ward.severityCritical')}</option>
          </Select>
        </div>
        <div>
          <label className={`field-required ${labelClass}`} style={labelStyle}>{t('ward.wardRequired')}</label>
          <Select value={form.wardId} onChange={e => setForm({ ...form, wardId: e.target.value, bedId: '' })}>
            <option value="">{t('ward.selectWard')}</option>
            {admittableWards.length === 0 && (
              <option value="" disabled>{t('ward.noWardsAvailable')}</option>
            )}
            {admittableWards.map(w => (
              <option key={w._id} value={w._id}>{t('ward.wardFree', { name: w.name, count: wardFreeBeds(w) })}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 items-end">
        <div>
          <label className={labelClass} style={labelStyle}>{t('ward.bedNumber')}</label>
          <Select value={form.bedId} onChange={e => setForm({ ...form, bedId: e.target.value })} disabled={!form.wardId}>
            <option value="">{form.wardId ? t('ward.optional') : t('ward.selectWardFirst')}</option>
            {availableBedsForWard.map(b => (
              <option key={b._id} value={b._id}>{b.bedNumber} · {t(`facilitySettings.roomClass.${b.roomClass ?? 'standard'}`)}</option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 h-10 text-sm" style={{ color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={form.isolationRequired} onChange={e => setForm({ ...form, isolationRequired: e.target.checked })} />
          {t('ward.isolationRequired')}
        </label>
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
          <button type="button" className="sv-footer-btn sv-footer-btn--primary" onClick={() => void handleAdmit()} disabled={saving}>
            {t('ward.admit')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <FormSlider
      title={t('ward.admitPatient')}
      onClose={onClose}
      busy={saving}
      footer={<>
        <button onClick={onClose} className="btn btn-secondary" disabled={saving}>{t('action.cancel')}</button>
        <button onClick={() => void handleAdmit()} className="btn btn-primary" disabled={saving}>{t('ward.admit')}</button>
      </>}
    >
      <div className="space-y-4">{fields}</div>
    </FormSlider>
  );
}
