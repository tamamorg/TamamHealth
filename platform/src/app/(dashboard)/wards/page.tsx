'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Modal from '@/components/Modal';
import PatientName from '@/components/PatientName';
import PatientAvatar from '@/components/patients/PatientAvatar';
import { Plus, X, CheckCircle2, Pill, ArrowRightLeft } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { useWards } from '@/lib/hooks/useWards';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AdmissionDoc } from '@/lib/db-types-ward';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';
import TransferPatientModal from '@/components/patients/TransferPatientModal';
import { roleCan, WARD_ADMIT_ROLES, WARD_BED_ROLES, WARD_DISCHARGE_ROLES } from '@/lib/clinical-flow/ward-permissions';

/* The admissions list is the shared appointment/worklist card row — the same
   surface, grid, type scale and status pill the patient registry uses, so a
   ward board and the registry read as one product. Five columns:
   Patient · Admitted · Ward · Diagnosis · Severity.

   The per-row Discharge button is gone (2026-08-24): the ROW is the control
   now. Clicking a patient opens their dialog, where discharging is one of the
   actions rather than the only one the list could offer — and a 132px column
   of identical buttons stopped being the loudest thing in every row. */
const SEVERITY_PILL: Record<AdmissionDoc['severity'], string> = {
  critical: 'status-cancelled',
  severe: 'status-arrived',
  moderate: 'status-scheduled',
  mild: 'status-completed',
};
/** The avatar wants a first/last name; an admission carries one string. The
 *  patient record is preferred when it is loaded — it also carries the photo. */
function avatarNameOf(fullName: string): { firstName: string; surname: string } {
  const parts = fullName.trim().split(/\s+/);
  return { firstName: parts[0] || fullName, surname: parts.length > 1 ? parts[parts.length - 1] : '' };
}

const SEVERITY_LABEL: Record<AdmissionDoc['severity'], string> = {
  critical: 'ward.severityCritical',
  severe: 'ward.severitySevere',
  moderate: 'ward.severityModerate',
  mild: 'ward.severityMild',
};

export default function WardsPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { patients } = usePatients();
  const { wards, beds, activeAdmissions, totalBeds, occupiedBeds, availableBeds, occupancyRate, admit, discharge, reassignBed, markBedReady } = useWards();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const admitFromQueryRef = useRef(false);

  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeFor, setDischargeFor] = useState<AdmissionDoc | null>(null);
  const [transferFor, setTransferFor] = useState<AdmissionDoc | null>(null);
  const [filterWard, setFilterWard] = useState<string>('');
  const [admissionSearch, setAdmissionSearch] = useState('');
  const activeFilterCount = filterWard ? 1 : 0;
  const clearFilters = () => { setFilterWard(''); };

  const [admitForm, setAdmitForm] = useState({
    patientId: '',
    admittingDiagnosis: '',
    severity: 'moderate' as AdmissionDoc['severity'],
    wardId: '',
    bedId: '',
    isolationRequired: false,
    encounterId: '',
  });

  const [dischargeForm, setDischargeForm] = useState({
    dischargeType: 'normal' as NonNullable<AdmissionDoc['dischargeType']>,
    dischargeDiagnosis: '',
    dischargeSummary: '',
    followUpRequired: false,
    followUpDate: '',
    followUpInstructions: '',
    medicationReconciled: false,
  });
  const [placementWardId, setPlacementWardId] = useState('');
  const [placementBedId, setPlacementBedId] = useState('');

  useEffect(() => {
    setPlacementWardId(dischargeFor?.wardId || '');
    setPlacementBedId('');
  }, [dischargeFor]);

  // Deep link from consultation (?admitPatientId=&diagnosis=&encounterId=): open
  // the admit modal pre-filled with the patient, diagnosis, and the open visit
  // just captured there, instead of leaving the clinician to reselect both
  // from scratch — and losing the encounterId means the admission never closes
  // the OPD visit it grew out of.
  useEffect(() => {
    const admitPatientId = searchParams?.get('admitPatientId');
    if (!admitPatientId || admitFromQueryRef.current) return;
    if (!patients.some(p => p._id === admitPatientId)) return;
    admitFromQueryRef.current = true;
    const diagnosis = searchParams?.get('diagnosis') || '';
    const encounterId = searchParams?.get('encounterId') || '';
    setAdmitForm(prev => ({ ...prev, patientId: admitPatientId, admittingDiagnosis: diagnosis, encounterId }));
    setAdmitOpen(true);
  }, [searchParams, patients]);

  const facilityId = currentUser?.hospitalId || currentUser?.hospital?._id;
  const canAdmit = roleCan(currentUser?.role, WARD_ADMIT_ROLES);
  const canManageBeds = roleCan(currentUser?.role, WARD_BED_ROLES);
  const canDischarge = roleCan(currentUser?.role, WARD_DISCHARGE_ROLES);
  const facilityWards = useMemo(
    () => facilityId ? wards.filter(w => w.facilityId === facilityId) : wards,
    [wards, facilityId],
  );
  const filteredAdmissions = useMemo(
    () => {
      const q = admissionSearch.trim().toLowerCase();
      return activeAdmissions.filter(a => {
        const matchesWard = !filterWard || a.wardId === filterWard;
        const haystack = `${a.patientName} ${a.admittingDiagnosis} ${a.wardName} ${a.bedNumber || ''} ${a.severity}`.toLowerCase();
        const matchesSearch = !q || q.split(/\s+/).every(term => haystack.includes(term));
        return matchesWard && matchesSearch;
      });
    },
    [activeAdmissions, filterWard, admissionSearch],
  );

  // Beds actually free in the chosen ward — without this the admit modal's
  // bed field was free text, `bedId` never got set, `updateBedStatus` never
  // ran, and ward occupancy sat at 0% no matter how many patients were admitted.
  const availableBedsForWard = useMemo(
    () => admitForm.wardId ? beds.filter(b => b.wardId === admitForm.wardId && b.status === 'available') : [],
    [beds, admitForm.wardId],
  );
  const availablePlacementBeds = useMemo(
    () => placementWardId
      ? beds.filter(bed => bed.wardId === placementWardId && bed.status === 'available')
      : [],
    [beds, placementWardId],
  );
  const cleaningBeds = useMemo(
    () => beds.filter(bed => bed.status === 'cleaning' && (!facilityId || bed.facilityId === facilityId)),
    [beds, facilityId],
  );

  const handleAdmit = async () => {
    const patient = patients.find(p => p._id === admitForm.patientId);
    const ward = facilityWards.find(w => w._id === admitForm.wardId);
    if (!patient || !ward) {
      showToast(t('ward.selectPatientAndWard'), 'error');
      return;
    }
    if (!admitForm.admittingDiagnosis.trim()) {
      showToast(t('ward.diagnosisRequiredToast'), 'error');
      return;
    }
    if (!currentUser) return;
    const bed = admitForm.bedId ? beds.find(b => b._id === admitForm.bedId) : undefined;
    try {
      await admit({
        patientId: patient._id,
        patientName: `${patient.firstName} ${patient.surname}`.trim(),
        hospitalNumber: patient.hospitalNumber,
        admittingDiagnosis: admitForm.admittingDiagnosis.trim(),
        severity: admitForm.severity,
        admittedBy: currentUser._id || currentUser.username || 'unknown',
        admittedByName: currentUser.name,
        wardId: ward._id,
        wardName: ward.name,
        bedId: bed?._id,
        bedNumber: bed?.bedNumber,
        facilityId: ward.facilityId,
        facilityName: ward.facilityName,
        facilityLevel: ward.facilityLevel,
        attendingPhysician: currentUser._id || currentUser.username || 'unknown',
        attendingPhysicianName: currentUser.name,
        isolationRequired: admitForm.isolationRequired,
        // Prefer patient's geographic state; fall back to the admitting
        // facility's state. Previously this fell back to `ward.facilityName`,
        // which would write the hospital's name into the geographic state
        // field — corrupting downstream surveillance/analytics joins that
        // expect a state code (e.g. "Central Equatoria"), not a hospital
        // ("Juba Teaching Hospital").
        state: patient.state || currentUser.hospital?.state || '',
        // Closes the OPD visit this admission grew out of, when the admit
        // modal was opened from one (deep-linked ?encounterId=). Best-effort
        // on the service side — an admission never fails because of this.
        encounterId: admitForm.encounterId || undefined,
      });
      showToast(t('ward.admittedToast', { name: `${patient.firstName} ${patient.surname}`, ward: ward.name }), 'success');
      setAdmitOpen(false);
      setAdmitForm({ patientId: '', admittingDiagnosis: '', severity: 'moderate', wardId: '', bedId: '', isolationRequired: false, encounterId: '' });
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : t('ward.admitFailedToast'), 'error');
    }
  };

  const handleDischarge = async () => {
    if (!dischargeFor || !currentUser) return;
    try {
      await discharge(dischargeFor._id, {
        dischargeType: dischargeForm.dischargeType,
        dischargeDiagnosis: dischargeForm.dischargeDiagnosis.trim(),
        dischargeSummary: dischargeForm.dischargeSummary.trim(),
        dischargedBy: currentUser._id || currentUser.username || 'unknown',
        dischargedByName: currentUser.name,
        followUpRequired: dischargeForm.followUpRequired,
        followUpDate: dischargeForm.followUpRequired ? dischargeForm.followUpDate : undefined,
        followUpInstructions: dischargeForm.followUpRequired ? dischargeForm.followUpInstructions.trim() : undefined,
        medicationReconciled: dischargeForm.medicationReconciled,
      });
      showToast(t('ward.dischargedToast', { name: dischargeFor.patientName }), 'success');
      const deathPatientId = dischargeForm.dischargeType === 'death' ? dischargeFor.patientId : null;
      const deathEncounterId = dischargeForm.dischargeType === 'death' ? dischargeFor.encounterId : null;
      setDischargeFor(null);
      setDischargeForm({
        dischargeType: 'normal', dischargeDiagnosis: '', dischargeSummary: '',
        followUpRequired: false, followUpDate: '', followUpInstructions: '',
        medicationReconciled: false,
      });
      if (deathPatientId) {
        const query = new URLSearchParams({ patientId: deathPatientId });
        if (deathEncounterId) query.set('encounterId', deathEncounterId);
        router.push(`/deaths?${query.toString()}`);
      }
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : t('ward.dischargeFailedToast'), 'error');
    }
  };

  const handleMoveBed = async () => {
    if (!dischargeFor || !placementBedId) return;
    const ward = facilityWards.find(candidate => candidate._id === placementWardId);
    const bed = availablePlacementBeds.find(candidate => candidate._id === placementBedId);
    if (!ward || !bed) return;
    try {
      const updated = await reassignBed(dischargeFor._id, {
        wardId: ward._id,
        wardName: ward.name,
        bedId: bed._id,
        bedNumber: bed.bedNumber,
      });
      setDischargeFor(updated);
      setPlacementBedId('');
      showToast(t('ward.patientMovedToast', { name: updated.patientName, ward: updated.wardName, bed: updated.bedNumber || '' }), 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('ward.moveFailedToast'), 'error');
    }
  };

  return (
    <>
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div className="card-elevated overflow-hidden flex flex-col" data-tour="ward-admissions" style={{ flex: 1, minHeight: 0 }}>
          <EhrListHeader
            title={t('ward.currentAdmissions')}
            stats={[
              { label: t('ward.kpiTotalBeds'), value: totalBeds, color: LIST_STAT_COLORS.muted },
              { label: t('ward.kpiOccupied'), value: occupiedBeds, color: LIST_STAT_COLORS.blue },
              { label: t('ward.kpiAvailable'), value: availableBeds, color: LIST_STAT_COLORS.green },
              { label: t('ward.kpiOccupancy'), value: `${occupancyRate}%`, color: occupancyRate > 90 ? 'var(--color-danger-text)' : occupancyRate > 75 ? LIST_STAT_COLORS.amber : LIST_STAT_COLORS.blue },
            ]}
            search={{
              value: admissionSearch,
              onChange: setAdmissionSearch,
              placeholder: 'Search by patient, ward, or diagnosis…',
              // Ward choice folded into the field beside it: the input already
              // narrows this list, and a second control that also narrowed it
              // said nothing about what it narrowed by.
              ...(facilityWards.length > 0 ? {
                filters: {
                  activeCount: activeFilterCount,
                  onClear: clearFilters,
                  label: 'Filter by ward',
                  children: (
                    <Select
                      value={filterWard}
                      onChange={e => setFilterWard(e.target.value)}
                      style={{ width: 'auto', minWidth: '100%', height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)', fontSize: 13 }}
                    >
                      <option value="">All wards</option>
                      {facilityWards.map(w => (
                        <option key={w._id} value={w._id}>{w.name} ({w.occupiedBeds}/{w.totalBeds})</option>
                      ))}
                    </Select>
                  ),
                },
              } : {}),
            }}
            actions={
              <>
                {canAdmit && <button
                  onClick={() => setAdmitOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px', borderRadius: 999, background: 'var(--accent-primary)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  <Plus className="w-4 h-4" /> {t('ward.admitPatient')}
                </button>}
              </>
            }
          />
          <ol className="ward-journey" aria-label={t('ward.journeyLabel')}>
            {[
              ['1', t('ward.journeyAdmit')],
              ['2', t('ward.journeyPlace')],
              ['3', t('ward.journeyTreat')],
              ['4', t('ward.journeyHandoff')],
              ['5', t('ward.journeyDischarge')],
            ].map(([step, label]) => (
              <li key={step}><span>{step}</span>{label}</li>
            ))}
          </ol>
          {canManageBeds && cleaningBeds.length > 0 && (
            <section className="ward-turnover" aria-label={t('ward.turnoverTitle')}>
              <div>
                <strong>{t('ward.turnoverTitle')}</strong>
                <span>{t('ward.turnoverHint', { count: cleaningBeds.length })}</span>
              </div>
              <div className="ward-turnover-list">
                {cleaningBeds.map(bed => (
                  <button
                    key={bed._id}
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        await markBedReady(bed._id, { id: currentUser?._id, name: currentUser?.name });
                        showToast(t('ward.bedReadyToast', { ward: bed.wardName, bed: bed.bedNumber }), 'success');
                      } catch (error) {
                        showToast(error instanceof Error ? error.message : t('ward.bedReadyFailed'), 'error');
                      }
                    }}
                  >{bed.wardName} · {bed.bedNumber} — {t('ward.markReady')}</button>
                ))}
              </div>
            </section>
          )}
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
            <div className="appointment-card-surface wards-list-surface">
              <div className="appointment-card-flow">
                {/* The column head is the board's frame, not a label for the
                    rows that happen to be loaded: it stays put when a filter
                    matches nothing, so the list never collapses into a bare
                    message. */}
                <div className="appointment-card-head" aria-hidden="true">
                  <span>{t('ward.colPatient')}</span>
                  <span>{t('ward.colAdmitted')}</span>
                  <span>{t('ward.colWard')}</span>
                  <span>{t('ward.colDiagnosis')}</span>
                  <span>{t('ward.severity')}</span>
                </div>

                {filteredAdmissions.length === 0 && (
                  <div className="appointment-card-empty">
                    {filterWard ? t('ward.noActiveAdmissionsInWard') : t('ward.noActiveAdmissions')}
                  </div>
                )}

                {filteredAdmissions.map(a => {
                  const days = Math.max(1, Math.ceil((Date.now() - new Date(a.admissionDate).getTime()) / 86400000));
                  const patient = patients.find(p => p._id === a.patientId);
                  const open = () => setDischargeFor(a);
                  return (
                    <div
                      key={a._id}
                      className="ehr-appointment-row appointment-card-row"
                      role="button"
                      tabIndex={0}
                      aria-label={t('ward.openAdmission', { name: a.patientName })}
                      /* The name inside is a real link to the chart, so both
                         handlers step aside when the event started on it —
                         cheaper and more honest than a wrapper that swallows
                         every event around it. */
                      onClick={e => { if (!(e.target as HTMLElement).closest('a')) open(); }}
                      onKeyDown={e => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        if ((e.target as HTMLElement).closest('a')) return;
                        e.preventDefault();
                        open();
                      }}
                    >
                      <div className="ehr-appointment-identity">
                        <PatientAvatar patient={patient ?? avatarNameOf(a.patientName)} size={40} />
                        <div className="ehr-appointment-main appointment-card-patient">
                          {/* The name still opens the chart — `PatientName`
                              renders its own link when given an id; the rest
                              of the row opens the actions. */}
                          <PatientName patientId={a.patientId} name={a.patientName} nameClassName="" />
                          <p>{a.hospitalNumber || t('ward.noHospitalNumber')}</p>
                        </div>
                      </div>

                      <div className="ehr-appointment-time">
                        <strong>{a.admissionDate.slice(0, 10)}</strong>
                        <span>{t('ward.dayCount', { day: days })}</span>
                      </div>

                      <div className="appointment-card-provider">
                        <strong>{a.wardName}</strong>
                        <span>{a.bedNumber ? t('ward.bedShort', { bed: a.bedNumber }) : t('ward.noBed')}</span>
                      </div>

                      <div className="appointment-card-provider">
                        <strong>{a.admittingDiagnosis}</strong>
                        <span>{a.attendingPhysicianName || t('ward.attendingUnassigned')}</span>
                      </div>

                      <div className="appointment-card-status">
                        <span className={`appointment-status-pill ${SEVERITY_PILL[a.severity]}`}>
                          {t(SEVERITY_LABEL[a.severity])}
                        </span>
                        <small>{a.isolationRequired ? t('ward.isolation') : ''}</small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Admit modal */}
        {admitOpen && (
          <Modal onClose={() => setAdmitOpen(false)}>
            <div className="modal-content card-elevated p-6 max-w-lg w-full" style={{ maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">{t('ward.admitPatient')}</h3>
                <button onClick={() => setAdmitOpen(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.patientRequired')}</label>
                  {/* Changing the patient drops the deep-linked visit — an
                      encounterId belongs to the patient it arrived with. */}
                  <Select value={admitForm.patientId} onChange={e => setAdmitForm({ ...admitForm, patientId: e.target.value, encounterId: '' })}>
                    <option value="">{t('ward.selectPatient')}</option>
                    {patients.slice(0, 200).map(p => (
                      <option key={p._id} value={p._id}>{p.firstName} {p.surname} · {p.hospitalNumber}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.admittingDiagnosisRequired')}</label>
                  <input type="text" value={admitForm.admittingDiagnosis} onChange={e => setAdmitForm({ ...admitForm, admittingDiagnosis: e.target.value })} placeholder={t('ward.admittingDiagnosisPlaceholder')} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.severity')}</label>
                    <Select value={admitForm.severity} onChange={e => setAdmitForm({ ...admitForm, severity: e.target.value as AdmissionDoc['severity'] })}>
                      <option value="mild">{t('ward.severityMild')}</option>
                      <option value="moderate">{t('ward.severityModerate')}</option>
                      <option value="severe">{t('ward.severitySevere')}</option>
                      <option value="critical">{t('ward.severityCritical')}</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.wardRequired')}</label>
                    <Select value={admitForm.wardId} onChange={e => setAdmitForm({ ...admitForm, wardId: e.target.value, bedId: '' })}>
                      <option value="">{t('ward.selectWard')}</option>
                      {facilityWards.filter(w => w.availableBeds > 0).map(w => (
                        <option key={w._id} value={w._id}>{t('ward.wardFree', { name: w.name, count: w.availableBeds })}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('ward.bedNumber')}</label>
                    <Select value={admitForm.bedId} onChange={e => setAdmitForm({ ...admitForm, bedId: e.target.value })} disabled={!admitForm.wardId}>
                      <option value="">{admitForm.wardId ? t('ward.optional') : t('ward.selectWard')}</option>
                      {availableBedsForWard.map(b => (
                        <option key={b._id} value={b._id}>{b.bedNumber}</option>
                      ))}
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 mt-5 text-sm" style={{ color: 'var(--text-primary)' }}>
                    <input type="checkbox" checked={admitForm.isolationRequired} onChange={e => setAdmitForm({ ...admitForm, isolationRequired: e.target.checked })} />
                    {t('ward.isolationRequired')}
                  </label>
                </div>
              </div>
              <hr className="section-divider" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setAdmitOpen(false)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
                <button onClick={handleAdmit} className="btn btn-primary flex-1">{t('ward.admit')}</button>
              </div>
            </div>
          </Modal>
        )}

        {/* ═══ The patient's dialog — opened by the row, not by a button ═══
             It states who is admitted and where before it offers anything, so
             the discharge form reads as an action ON a patient rather than a
             form that happens to name one.

             Everything is scoped `wdis-`: this stylesheet's bare `label` rule
             force-uppercases every <label> (block, bold, tracked, 6px bottom
             margin), which is what left the follow-up checkbox shouting in
             caps on a line of its own, half a row out of alignment with its
             box. Labels stay real labels — the scope just takes the cascade
             back off them. */}
        {dischargeFor && (
          <Modal onClose={() => setDischargeFor(null)} width={520} labelledBy="ward-discharge-title">
            <div className="modal-content card-elevated wdis">
              <header className="wdis-head">
                <div className="wdis-id">
                  <PatientAvatar
                    patient={patients.find(p => p._id === dischargeFor.patientId) ?? avatarNameOf(dischargeFor.patientName)}
                    size={38}
                  />
                  <div className="min-w-0">
                    <h3 id="ward-discharge-title">{dischargeFor.patientName}</h3>
                    <p>
                      {dischargeFor.wardName}
                      {dischargeFor.bedNumber ? ` · ${t('ward.bedShort', { bed: dischargeFor.bedNumber })}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="wdis-close"
                  onClick={() => setDischargeFor(null)}
                  aria-label={t('action.close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </header>

              {/* The admission, before the form that ends it. */}
              <dl className="wdis-facts">
                <div>
                  <dt>{t('ward.colAdmitted')}</dt>
                  <dd>{dischargeFor.admissionDate.slice(0, 10)}</dd>
                </div>
                <div>
                  <dt>{t('ward.colDiagnosis')}</dt>
                  <dd>{dischargeFor.admittingDiagnosis}</dd>
                </div>
                <div>
                  <dt>{t('ward.severity')}</dt>
                  <dd>
                    <span className={`appointment-status-pill ${SEVERITY_PILL[dischargeFor.severity]}`}>
                      {t(SEVERITY_LABEL[dischargeFor.severity])}
                    </span>
                  </dd>
                </div>
              </dl>

              <nav className="wdis-care-actions" aria-label={t('ward.careActions')}>
                <button type="button" onClick={() => router.push(`/wards/mar/${dischargeFor._id}`)}>
                  <Pill className="w-4 h-4" />
                  <span><b>{t('ward.openMar')}</b><small>{t('ward.openMarHint')}</small></span>
                </button>
                <button type="button" onClick={() => router.push('/wards/handoff')}>
                  <ArrowRightLeft className="w-4 h-4" />
                  <span><b>{t('ward.openHandoff')}</b><small>{t('ward.openHandoffHint')}</small></span>
                </button>
              </nav>

              {canManageBeds && <section className="wdis-placement" aria-labelledby="ward-placement-title">
                <div>
                  <h4 id="ward-placement-title">{t('ward.placementTitle')}</h4>
                  <p>{t('ward.placementHint')}</p>
                </div>
                <div className="wdis-placement-controls">
                  <Select
                    aria-label={t('ward.wardRequired')}
                    value={placementWardId}
                    onChange={event => { setPlacementWardId(event.target.value); setPlacementBedId(''); }}
                  >
                    {facilityWards.map(ward => <option key={ward._id} value={ward._id}>{ward.name}</option>)}
                  </Select>
                  <Select
                    aria-label={t('ward.bedNumber')}
                    value={placementBedId}
                    onChange={event => setPlacementBedId(event.target.value)}
                  >
                    <option value="">{t('ward.selectAvailableBed')}</option>
                    {availablePlacementBeds.map(bed => <option key={bed._id} value={bed._id}>{bed.bedNumber}</option>)}
                  </Select>
                  <button type="button" className="btn btn-secondary" disabled={!placementBedId} onClick={handleMoveBed}>
                    {t('ward.movePatient')}
                  </button>
                </div>
              </section>}

              {canDischarge && <div className="wdis-body">
                <div className="wdis-sectionhead">
                  <h4>{t('ward.endAdmissionTitle')}</h4>
                  <p>{t('ward.endAdmissionHint')}</p>
                </div>
                <div className="wdis-field">
                  <label htmlFor="ward-discharge-type">{t('ward.dischargeType')}</label>
                  <Select
                    id="ward-discharge-type"
                    value={dischargeForm.dischargeType}
                    onChange={e => setDischargeForm({ ...dischargeForm, dischargeType: e.target.value as NonNullable<AdmissionDoc['dischargeType']> })}
                  >
                    <option value="normal">{t('ward.dischargeTypeNormal')}</option>
                    <option value="against_medical_advice">{t('ward.dischargeTypeAma')}</option>
                    <option value="absconded">{t('ward.dischargeTypeAbsconded')}</option>
                  </Select>
                </div>

                <div className="wdis-field">
                  <label htmlFor="ward-discharge-diagnosis">{t('ward.dischargeDiagnosis')}</label>
                  <input
                    id="ward-discharge-diagnosis"
                    value={dischargeForm.dischargeDiagnosis}
                    onChange={e => setDischargeForm({ ...dischargeForm, dischargeDiagnosis: e.target.value })}
                    placeholder={t('ward.dischargeDiagnosisPlaceholder')}
                  />
                </div>

                <div className="wdis-field">
                  <label htmlFor="ward-discharge-summary">{t('ward.dischargeSummary')}</label>
                  <textarea
                    id="ward-discharge-summary"
                    rows={3}
                    value={dischargeForm.dischargeSummary}
                    onChange={e => setDischargeForm({ ...dischargeForm, dischargeSummary: e.target.value })}
                    placeholder={t('ward.dischargeSummaryPlaceholder')}
                  />
                </div>

                <label className="wdis-check" htmlFor="ward-discharge-followup">
                  <input
                    id="ward-discharge-followup"
                    type="checkbox"
                    checked={dischargeForm.followUpRequired}
                    onChange={e => setDischargeForm({ ...dischargeForm, followUpRequired: e.target.checked })}
                  />
                  <span>{t('ward.followUpRequired')}</span>
                </label>

                <label className="wdis-check" htmlFor="ward-medication-reconciled">
                  <input
                    id="ward-medication-reconciled"
                    type="checkbox"
                    checked={dischargeForm.medicationReconciled}
                    onChange={e => setDischargeForm({ ...dischargeForm, medicationReconciled: e.target.checked })}
                  />
                  <span>{t('ward.medicationReconciled')}</span>
                </label>

                <p className="wdis-note is-ok">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {t('ward.bedReleasedNotice')}
                </p>

                {dischargeForm.followUpRequired && (
                  <div className="wdis-followup">
                    <div className="wdis-field">
                      <label htmlFor="ward-follow-up-date">{t('ward.followUpDate')}</label>
                      <input
                        id="ward-follow-up-date"
                        type="date"
                        value={dischargeForm.followUpDate}
                        onChange={e => setDischargeForm({ ...dischargeForm, followUpDate: e.target.value })}
                      />
                    </div>
                    <div className="wdis-field">
                      <label htmlFor="ward-follow-up-instructions">{t('ward.followUpInstructions')}</label>
                      <textarea
                        id="ward-follow-up-instructions"
                        rows={2}
                        value={dischargeForm.followUpInstructions}
                        onChange={e => setDischargeForm({ ...dischargeForm, followUpInstructions: e.target.value })}
                        placeholder={t('ward.followUpInstructionsPlaceholder')}
                      />
                    </div>
                  </div>
                )}
              </div>}

              <footer className="wdis-actions">
                <button type="button" className="btn btn-secondary" onClick={() => router.push(`/patients/${dischargeFor.patientId}?tab=overview`)}>
                  {t('ward.openChart')}
                </button>
                <span className="wdis-actions-end">
                  {canDischarge && <button type="button" className="btn btn-secondary" onClick={() => setTransferFor(dischargeFor)}>{t('ward.startTransfer')}</button>}
                  {canDischarge && <button type="button" className="btn btn-secondary" onClick={() => router.push(`/deaths?patientId=${encodeURIComponent(dischargeFor.patientId)}${dischargeFor.encounterId ? `&encounterId=${encodeURIComponent(dischargeFor.encounterId)}` : ''}`)}>{t('ward.recordDeath')}</button>}
                  <button type="button" className="btn btn-secondary" onClick={() => setDischargeFor(null)}>{t('action.cancel')}</button>
                  {canDischarge && <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleDischarge}
                    disabled={
                      !dischargeForm.dischargeDiagnosis.trim()
                      || !dischargeForm.dischargeSummary.trim()
                      || !dischargeForm.medicationReconciled
                      || (dischargeForm.followUpRequired && (!dischargeForm.followUpDate || !dischargeForm.followUpInstructions.trim()))
                    }
                  >{t('ward.discharge')}</button>}
                </span>
              </footer>
            </div>
          </Modal>
        )}
        {transferFor && (() => {
          const patient = patients.find(candidate => candidate._id === transferFor.patientId);
          return patient ? <TransferPatientModal patient={patient} onClose={() => setTransferFor(null)} /> : null;
        })()}
      </main>
    </>
  );
}
