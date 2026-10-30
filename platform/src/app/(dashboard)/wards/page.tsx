'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/Modal';
import PatientName from '@/components/PatientName';
import PatientAvatar from '@/components/patients/PatientAvatar';
import { Plus, X, CheckCircle2, Pill, ArrowRightLeft, ClipboardList } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import WardAdmitForm from '@/components/wards/WardAdmitForm';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useWards } from '@/lib/hooks/useWards';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AdmissionDoc } from '@/lib/db-types-ward';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import Select from '@/components/Select';
import TransferPatientModal from '@/components/patients/TransferPatientModal';
import { roleCan, WARD_ADMIT_ROLES, WARD_BED_ROLES, WARD_DISCHARGE_ROLES } from '@/lib/clinical-flow/ward-permissions';
import { useNow } from '@/lib/hooks/useNow';
import { describeError } from '@/lib/user-facing-error';

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
  // Length of stay counts days against the clock — an input, not a mid-render
  // reading (see useNow).
  const now = useNow(60_000);
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { patients } = usePatients();
  const { wards, beds, activeAdmissions, totalBeds, occupiedBeds, availableBeds, occupancyRate, discharge, reassignBed, markBedReady } = useWards();
  const { showToast } = useToast();

  const [admitOpen, setAdmitOpen] = useState(false);
  const [dischargeFor, setDischargeFor] = useState<AdmissionDoc | null>(null);
  const [transferFor, setTransferFor] = useState<AdmissionDoc | null>(null);
  const [filterWard, setFilterWard] = useState<string>('');
  const [admissionSearch, setAdmissionSearch] = useState('');
  const activeFilterCount = filterWard ? 1 : 0;
  const clearFilters = () => { setFilterWard(''); };


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
      showToast(describeError(err, t('ward.dischargeFailedToast')), 'error');
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
      showToast(describeError(error, t('ward.moveFailedToast')), 'error');
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
                  /* `text-white` is the globals.css escape hatch for icons on a
                     coloured fill: the icon shim writes a literal brand-blue
                     `stroke` attribute, so without it the Plus sat blue on the
                     blue button — present but invisible. */
                  className="text-white"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px', borderRadius: 999, background: 'var(--accent-primary)', color: '#fff', border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  <Plus className="w-4 h-4" /> {t('ward.admitPatient')}
                </button>}
              </>
            }
          />
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
                        showToast(describeError(error, t('ward.bedReadyFailed')), 'error');
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
                  const days = Math.max(1, Math.ceil((now - new Date(a.admissionDate).getTime()) / 86400000));
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
                          {/* `ehr-row-name` takes the name out of the cell's span-as-pill
                              rule (written for status badges), which floated it right
                              and over the avatar. */}
                          <PatientName patientId={a.patientId} name={a.patientName} nameClassName="" className="ehr-row-name" />
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

        {/* Admit form — shared with the patient chart's workspace. */}
        {admitOpen && (
          <WardAdmitForm
            layout="slider"
            onClose={() => setAdmitOpen(false)}
          />
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
          <Modal variant="slider" onClose={() => setDischargeFor(null)} width={640} labelledBy="ward-discharge-title">
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
                {(dischargeFor.admissionDepositRequired ?? 0) > 0 && <div>
                  <dt>{t('ward.admissionDeposit')}</dt>
                  <dd>{dischargeFor.admissionDepositPaid ?? 0} / {dischargeFor.admissionDepositRequired} {dischargeFor.tariffCurrency || 'SSP'} · {t(`ward.depositStatus.${dischargeFor.admissionDepositStatus || 'due'}`)}</dd>
                </div>}
              </dl>

              <nav className="wdis-care-actions" aria-label={t('ward.careActions')}>
                {(dischargeFor.admissionDepositRequired ?? 0) > 0 && <button type="button" onClick={async () => { if (!scope) return; try { const { ensureAdmissionDepositBill } = await import('@/lib/services/ward-service'); const row = await ensureAdmissionDepositBill(dischargeFor._id, scope); if (row.admissionDepositBillId) router.push(`/billing/${encodeURIComponent(row.admissionDepositBillId)}`); } catch (error) { showToast(String(error), 'error'); } }}>
                  <ClipboardList className="w-4 h-4" />
                  <span><b>{t('ward.openDepositBill')}</b><small>{t('ward.openDepositBillHint')}</small></span>
                </button>}
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
                  <label className="field-required" htmlFor="ward-discharge-diagnosis">{t('ward.dischargeDiagnosis')}</label>
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
                      <label className="field-required" htmlFor="ward-follow-up-date">{t('ward.followUpDate')}</label>
                      <input
                        id="ward-follow-up-date"
                        type="date"
                        value={dischargeForm.followUpDate}
                        onChange={e => setDischargeForm({ ...dischargeForm, followUpDate: e.target.value })}
                      />
                    </div>
                    <div className="wdis-field">
                      <label className="field-required" htmlFor="ward-follow-up-instructions">{t('ward.followUpInstructions')}</label>
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
