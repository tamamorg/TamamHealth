'use client';

/**
 * Admit a patient to a ward — one form, two homes. The Wards page opens it as
 * a slider over its admissions list; the patient chart opens it in the
 * workspace (Clinical forms → Ward Admission) with the patient fixed, so
 * admitting from the chart no longer leaves the chart.
 *
 * In the chart it is the O3 "Ward Request" (O3Form, one page): a Ward
 * Details section — the inpatient disposition, the ward, then the bed,
 * diagnosis, severity and isolation the admission needs — over Cancel | Save.
 *
 * `encounterId` is the open visit the admission grew out of: admission closes
 * it. It belongs to the patient it arrived with, so changing the patient
 * drops it.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import O3Form, { o3MissingRequired, type O3Page } from '@/components/forms/O3Form';
import InlineBanner from '@/components/overlay/InlineBanner';
import CodedSearchField from '@/components/CodedSearchField';
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

  // The patient: fixed in the chart; on the Wards page a search (not a list:
  // a dropdown of the first 200 patients left most of a large facility
  // unadmittable from here).
  const patientPicker = !lockedPatient && (
    <div className="o3f-notice o3f-field o3f-field--wide">
      <span className="o3f-label">{t('ward.patientRequired')}<span className="o3f-required" aria-hidden>*</span></span>
      {patient ? (
        <div className="tamam-panel-picked-chip">
          <span>{patientFullName(patient)} <span style={{ color: 'var(--text-muted)' }}>· {patient.hospitalNumber}</span></span>
          <button type="button" onClick={() => setForm({ ...form, patientId: '', encounterId: '' })}>{t('ward.changePatient')}</button>
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
  );

  // One form in both homes: the O3 "Ward Request".
  const request = (
    <WardRequestForm
      form={form}
      setForm={setForm}
      wards={admittableWards}
      wardLabel={w => t('ward.wardFree', { name: w.name, count: wardFreeBeds(w) })}
      beds={availableBedsForWard}
      saving={saving}
      onSave={() => void handleAdmit()}
      onCancel={onClose}
      lead={patientPicker || undefined}
    />
  );

  if (layout === 'workspace') return request;
  return (
    <FormSlider title={t('ward.admitPatient')} onClose={onClose} busy={saving} width={640} flush>
      {request}
    </FormSlider>
  );
}

type AdmitFormState = {
  patientId: string;
  admittingDiagnosis: string;
  severity: AdmissionDoc['severity'];
  wardId: string;
  bedId: string;
  isolationRequired: boolean;
  encounterId: string;
};

const SEVERITIES: AdmissionDoc['severity'][] = ['mild', 'moderate', 'severe', 'critical'];
const SEVERITY_KEY: Record<AdmissionDoc['severity'], string> = {
  mild: 'ward.severityMild', moderate: 'ward.severityModerate', severe: 'ward.severitySevere', critical: 'ward.severityCritical',
};

/** The chart's Ward Request: the admit form's state drawn as one O3 page.
 *  O3 choices are their labels, so wards, beds and severities map back to ids. */
function WardRequestForm({ form, setForm, wards, wardLabel, beds, saving, onSave, onCancel, lead }: {
  form: AdmitFormState;
  setForm: (next: AdmitFormState) => void;
  wards: WardDoc[];
  wardLabel: (ward: WardDoc) => string;
  beds: { _id: string; bedNumber: string; roomClass?: string }[];
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
  /** Above the questions — the patient search on the Wards page. */
  lead?: ReactNode;
}) {
  const { t } = useTranslation();
  const [disposition, setDisposition] = useState('');
  const [notice, setNotice] = useState('');
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const admitOption = t('o3form.ward.admitToHospital');
  const yes = t('action.yes');
  const no = t('action.no');
  const bedLabel = (b: { bedNumber: string; roomClass?: string }) => `${b.bedNumber} · ${t(`facilitySettings.roomClass.${b.roomClass ?? 'standard'}`)}`;

  const pages: O3Page[] = [{
    id: 'ward-request',
    label: t('o3form.ward.title'),
    sections: [{
      id: 'ward-details',
      label: t('o3form.ward.details'),
      caption: t('o3form.ward.disposition'),
      fields: [
        { id: 'disposition', label: t('o3form.ward.dispositionQuestion'), kind: 'radio', options: [admitOption], required: true },
        { id: 'ward', label: t('ward.wardRequired'), kind: 'select', options: wards.map(wardLabel), required: true },
        { id: 'bed', label: t('ward.bedNumber'), kind: 'select', options: beds.map(bedLabel) },
        { id: 'diagnosis', label: t('ward.admittingDiagnosisRequired'), kind: 'text', required: true },
        { id: 'severity', label: t('ward.severity'), kind: 'radio', options: SEVERITIES.map(sv => t(SEVERITY_KEY[sv])) },
        { id: 'isolation', label: t('ward.isolationRequired'), kind: 'select', options: [no, yes] },
      ],
    }],
  }];

  const ward = wards.find(w => w._id === form.wardId);
  const bed = beds.find(b => b._id === form.bedId);
  const values: Record<string, string> = {
    disposition,
    ward: ward ? wardLabel(ward) : '',
    bed: bed ? bedLabel(bed) : '',
    diagnosis: form.admittingDiagnosis,
    severity: t(SEVERITY_KEY[form.severity]),
    isolation: form.isolationRequired ? yes : no,
  };
  const change = (id: string, value: string) => {
    setNotice('');
    switch (id) {
      case 'disposition': setDisposition(value); break;
      case 'ward': setForm({ ...form, wardId: wards.find(w => wardLabel(w) === value)?._id ?? '', bedId: '' }); break;
      case 'bed': setForm({ ...form, bedId: beds.find(b => bedLabel(b) === value)?._id ?? '' }); break;
      case 'diagnosis': setForm({ ...form, admittingDiagnosis: value }); break;
      case 'severity': setForm({ ...form, severity: SEVERITIES.find(sv => t(SEVERITY_KEY[sv]) === value) ?? 'moderate' }); break;
      case 'isolation': setForm({ ...form, isolationRequired: value === yes }); break;
    }
  };
  const save = () => {
    const missing = o3MissingRequired(pages, values);
    if (missing.length) {
      setInvalid(new Set(missing.map(f => f.id)));
      setNotice(t('o3form.missingRequired', { count: missing.length }));
      return;
    }
    onSave();
  };

  return (
    <O3Form
      pages={pages}
      values={values}
      onChange={change}
      onSave={save}
      onCancel={onCancel}
      saving={saving}
      invalid={invalid}
      notice={<>
        {lead}
        {(notice || wards.length === 0) && (
          <div className="o3f-notice"><InlineBanner tone={notice ? 'danger' : 'warning'}>{notice || t('ward.noWardsAvailable')}</InlineBanner></div>
        )}
      </>}
    />
  );
}
