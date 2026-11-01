'use client';

/**
 * The chart's transfer history — the answer to "who was responsible for this
 * patient, when, and why did it move?"
 *
 * Renders the append-only event trail on each transfer rather than a summary
 * line, because the summary can be superseded (a temporary transfer that
 * expired reads as `expired` today, but the fact that Dr A held the patient for
 * a fortnight in March is only visible in the events).
 */
import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import FormField from '@/components/overlay/FormField';
import FormSlider from '@/components/overlay/FormSlider';
import { useAuth } from '@/lib/context';
import { usePatientTransfers } from '@/lib/hooks/usePatientTransfers';
import { useWards } from '@/lib/hooks/useWards';
import {
  describeTransferRoute, isTransferOverdue,
} from '@/lib/services/patient-transfer-service';
import {
  canDecideTransfer, canCancelTransfer, canContributeTransfer,
} from '@/lib/services/patient-transfer-permissions';
import TransferPatientModal from './TransferPatientModal';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import type {
  PatientDoc, PatientTransferDoc, PatientTransferStatus, PatientTransferVitals,
} from '@/lib/db-types';
import { formatDateTime } from '@/lib/format-utils';
import {
  ArrowRightLeft, Check, X, Clock, AlertTriangle, ChevronDown, ChevronUp,
} from '@/components/icons/lucide';
import Select from '@/components/Select';
import { describeError } from '@/lib/user-facing-error';
import { resultWithUnit } from '@/components/lab/workflow/lab-workflow-types';

const STATUS_STYLE: Record<PatientTransferStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: 'transfers.statusDraft', bg: 'var(--border-light)', fg: 'var(--text-muted)' },
  requested: { label: 'transfers.statusRequested', bg: 'var(--gold-100, #FFFAE9)', fg: 'var(--gold-800, #a65300)' },
  accepted: { label: 'transfers.statusAccepted', bg: 'var(--iris-100, #c9f4ff)', fg: 'var(--iris-800, #015697)' },
  rejected: { label: 'transfers.statusRejected', bg: 'var(--rose-100, #fae6e4)', fg: 'var(--rose-800, #a65300)' },
  cancelled: { label: 'transfers.statusWithdrawn', bg: 'var(--border-light)', fg: 'var(--text-muted)' },
  completed: { label: 'transfers.statusCompleted', bg: 'var(--green-100, #ecf6f3)', fg: 'var(--green-800, #0A6E4A)' },
  expired: { label: 'transfers.statusLapsed', bg: 'var(--border-light)', fg: 'var(--text-muted)' },
};

const TYPE_LABEL: Record<string, string> = {
  permanent: 'transfers.typePermanent',
  temporary: 'transfers.typeTemporary',
  shared_care: 'transfers.typeSharedCare',
};

const PHYSICAL_LABEL: Record<string, string> = {
  not_scheduled: 'transfers.physNotScheduled',
  bed_reserved: 'transfers.physBedReserved',
  ready_for_transport: 'transfers.physReady',
  departed: 'transfers.physDeparted',
  in_transit: 'transfers.physInTransit',
  arrived: 'transfers.physArrived',
  closed: 'transfers.physClosed',
};

function StatusChip({ status }: { status: PatientTransferStatus }) {
  const { t } = useTranslation();
  const s = STATUS_STYLE[status];
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
      style={{ background: s.bg, color: s.fg }}>
      {t(s.label)}
    </span>
  );
}

function TransferCard({
  transfer,
  showClinicalDetail,
  onAccept,
  onReject,
  onCancel,
  onComplete,
  onLogistics,
  onArrive,
  onClose,
}: {
  transfer: PatientTransferDoc;
  /** False for non-clinical roles: they may see WHO is accountable and when it
   *  changed, but not the clinical picture that motivated the move. */
  showClinicalDetail: boolean;
  onAccept: (id: string, notes?: string) => Promise<unknown>;
  onReject: (id: string, notes: string) => Promise<unknown>;
  onCancel: (id: string, reason?: string) => Promise<unknown>;
  onComplete: (id: string) => Promise<unknown>;
  onLogistics: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  onArrive: (id: string, assessment?: Record<string, unknown>) => Promise<unknown>;
  onClose: (id: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  // From another hospital this card is the receiver's only view of the patient's
  // problems and medications there, so it starts open.
  const fromAnotherHospital = Boolean(transfer.to.facilityId) && transfer.to.facilityId !== transfer.hospitalId;
  const [expanded, setExpanded] = useState(transfer.status === 'requested' || fromAnotherHospital);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const auth = currentUser ? {
    sub: currentUser._id,
    username: currentUser.username,
    role: currentUser.role,
    name: currentUser.name || currentUser.username,
    hospitalId: currentUser.hospitalId,
    orgId: currentUser.orgId,
  } : null;

  const decide = auth ? canDecideTransfer(auth, transfer) : { allowed: false };
  const withdraw = auth ? canCancelTransfer(auth, transfer) : { allowed: false };
  const contribute = auth ? canContributeTransfer(auth, transfer) : { allowed: false };
  const overdue = isTransferOverdue(transfer);

  // A future-dated transfer that has been accepted but whose date has arrived
  // can be confirmed by hand when auto-complete is off.
  const awaitingConfirm = transfer.status === 'accepted'
    && transfer.autoCompleteOnEffectiveDate === false;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setRejecting(false);
      setRejectNote('');
    } catch (e) {
      setError(describeError(e, t('msg.changeNotSavedTryAgain')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded border" style={{ borderColor: 'var(--border-light)' }}>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusChip status={transfer.status} />
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--border-light)', color: 'var(--text-muted)' }}>
                {TYPE_LABEL[transfer.transferType] ? t(TYPE_LABEL[transfer.transferType]) : transfer.transferType}
              </span>
              {transfer.forced && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: 'var(--rose-100, #fae6e4)', color: 'var(--rose-800, #a65300)' }}
                  title={t('transfers.forcedTitle')}>
                  {t('transfers.forced')}
                </span>
              )}
              {overdue && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1"
                  style={{ background: 'var(--rose-100, #fae6e4)', color: 'var(--rose-800, #a65300)' }}>
                  <Clock className="w-3 h-3" /> {t('transfers.overdue')}
                </span>
              )}
            </div>
            <div className="text-[13px] font-semibold mt-1.5 truncate">
              {describeTransferRoute(transfer, { id: currentUser?._id, hospitalId: currentUser?.hospitalId }, { to: t('transfers.routeTo'), from: t('transfers.routeFrom') })}
            </div>
            {showClinicalDetail && (
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {transfer.reason}
              </div>
            )}
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('transfers.requestedBy', { name: transfer.requestedByName || t('transfers.unknown') })}
              {transfer.requestedAt ? ` · ${formatDateTime(transfer.requestedAt)}` : ''}
              {transfer.expiresAt ? ` · ${t('transfers.ends', { date: formatDateTime(transfer.expiresAt) })}` : ''}
            </div>
          </div>
          <button
            className="p-1 rounded hover:bg-black/5 shrink-0"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? t('transfers.collapse') : t('transfers.expand')}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Decision controls, only where the viewer actually has standing. */}
        {transfer.status === 'requested' && (decide.allowed || withdraw.allowed) && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {decide.allowed && !rejecting && (
              <>
                <button
                  className="btn btn-primary text-[12px] inline-flex items-center gap-1"
                  disabled={busy}
                  onClick={() => act(() => onAccept(transfer._id))}
                >
                  <Check className="w-3.5 h-3.5" /> {t('transfers.accept')}
                </button>
                <button
                  className="btn btn-secondary text-[12px] inline-flex items-center gap-1"
                  disabled={busy}
                  onClick={() => setRejecting(true)}
                >
                  <X className="w-3.5 h-3.5" /> {t('transfers.reject')}
                </button>
              </>
            )}
            {withdraw.allowed && !rejecting && (
              <button
                className="btn btn-secondary text-[12px]"
                disabled={busy}
                onClick={() => act(() => onCancel(transfer._id, 'Withdrawn by sender'))}
              >
                {t('transfers.withdraw')}
              </button>
            )}
          </div>
        )}

        {rejecting && (
          <FormSlider
            title={t('transfers.rejectTitle')}
            subtitle={describeTransferRoute(transfer, { id: currentUser?._id, hospitalId: currentUser?.hospitalId }, { to: t('transfers.routeTo'), from: t('transfers.routeFrom') })}
            className="tamam-dialog"
            onClose={() => { setRejecting(false); setRejectNote(''); }}
            busy={busy}
            footer={<>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setRejecting(false); setRejectNote(''); }}>{t('action.cancel')}</button>
              <button type="button" className="btn btn-primary" disabled={busy || !rejectNote.trim()} onClick={() => act(() => onReject(transfer._id, rejectNote.trim()))}>{t('transfers.confirmReject')}</button>
            </>}
          >
            <FormField label={t('transfers.rejectReason')} required hint={t('transfers.rejectHint')}>
              {control => <textarea {...control} rows={4} value={rejectNote} onChange={e => setRejectNote(e.target.value)} />}
            </FormField>
          </FormSlider>
        )}

        {awaitingConfirm && decide.allowed && (
          <button
            className="btn btn-primary text-[12px] mt-3"
            disabled={busy}
            onClick={() => act(() => onComplete(transfer._id))}
          >
            {t('transfers.confirmArrived')}
          </button>
        )}

        {error && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--rose-700, #b4180f)' }}>{error}</p>
        )}
      </div>

      {expanded && (
        <div className="border-t px-3 py-2.5 space-y-3" style={{ borderColor: 'var(--border-light)' }}>
          {showClinicalDetail && transfer.handoffNotes && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}>{t('transfers.handoffNotes')}</div>
              <p className="text-[12px] mt-0.5 whitespace-pre-wrap">{transfer.handoffNotes}</p>
            </div>
          )}

          {/* The snapshot the receiver decided on, kept as evidence. */}
          {showClinicalDetail && transfer.summary && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(transfer.summary.activeProblems?.length ?? 0) > 0 && (
                <SummaryList label={t('transfers.activeProblems')} items={transfer.summary.activeProblems!} />
              )}
              {(transfer.summary.activeMedications?.length ?? 0) > 0 && (
                <SummaryList label={t('transfers.activeMedications')} items={transfer.summary.activeMedications!} />
              )}
              {(transfer.summary.allergies?.length ?? 0) > 0 && (
                <SummaryList label={t('transfers.allergies')} items={transfer.summary.allergies!} />
              )}
              {(transfer.summary.riskFlags?.length ?? 0) > 0 && (
                <SummaryList label={t('transfers.riskFlags')} items={transfer.summary.riskFlags!} />
              )}
              {typeof transfer.summary.openTaskCount === 'number' && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}>{t('transfers.openTasks')}</div>
                  <div className="text-[12px] mt-0.5">{transfer.summary.openTaskCount}</div>
                </div>
              )}
            </div>
          )}

          {showClinicalDetail && (transfer.status === 'accepted' || transfer.status === 'completed') && (
            <TransferOperations
              transfer={transfer}
              canEdit={contribute.allowed}
              busy={busy}
              onLogistics={onLogistics}
              onArrive={onArrive}
              onClose={onClose}
              onError={setError}
            />
          )}

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mb-1"
              style={{ color: 'var(--text-muted)' }}>{t('transfers.auditTrail')}</div>
            <ol className="space-y-1.5">
              {transfer.events.map(ev => (
                <li key={ev.id} className="text-[11px] flex gap-2">
                  <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {formatDateTime(ev.createdAt)}
                  </span>
                  <span>
                    {ev.message}
                    {ev.actorName ? ` — ${ev.actorName}` : ''}
                    {showClinicalDetail && ev.notes ? ` (${ev.notes})` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

function TransferOperations({
  transfer, canEdit, busy, onLogistics, onArrive, onClose, onError,
}: {
  transfer: PatientTransferDoc;
  canEdit: boolean;
  busy: boolean;
  onLogistics: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  onArrive: (id: string, assessment?: Record<string, unknown>) => Promise<unknown>;
  onClose: (id: string) => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [wardName, setWardName] = useState(transfer.destination?.wardName || '');
  const [bedNumber, setBedNumber] = useState(transfer.destination?.bedNumber || '');
  const [wardId, setWardId] = useState(transfer.destination?.wardId || '');
  const [bedId, setBedId] = useState(transfer.destination?.bedId || '');
  const { wards, beds } = useWards();
  const selectedWardBeds = beds.filter(b => b.wardId === wardId && (b.status === 'available' || b._id === bedId));
  const [patientInformed, setPatientInformed] = useState(Boolean(transfer.communication?.patientInformedAt));
  const [familyContacted, setFamilyContacted] = useState(Boolean(transfer.communication?.familyContactedAt));
  const [familyMethod, setFamilyMethod] = useState(transfer.communication?.familyContactMethod || 'phone');
  const physical = transfer.physicalStatus || 'not_scheduled';
  const saveDestination = async () => {
    try {
      await onLogistics(transfer._id, {
        physicalStatus: wardName || bedNumber ? 'bed_reserved' : physical,
        destination: { wardId: wardId || undefined, wardName: wardName.trim() || undefined, bedId: bedId || undefined, bedNumber: bedNumber.trim() || undefined },
      });
    } catch (e) { onError(e instanceof Error ? e.message : t('transfers.errSaveDestination')); }
  };
  const markReady = async () => {
    try {
      await onLogistics(transfer._id, {
        physicalStatus: 'ready_for_transport',
        clinicalReadiness: {
          vitalsReviewed: true,
          medicationsReconciled: true,
          linesTubesDrainsReviewed: true,
          oxygenAndMonitoringReviewed: true,
          precautionsReviewed: true,
          equipmentReady: true,
        },
        transport: { ...(transfer.transport || { status: 'not_requested' }), status: 'ready' },
      });
    } catch (e) { onError(e instanceof Error ? e.message : t('transfers.errMarkReady')); }
  };
  const saveCommunication = async () => {
    try {
      const now = new Date().toISOString();
      await onLogistics(transfer._id, {
        communication: {
          patientInformedAt: patientInformed ? (transfer.communication?.patientInformedAt || now) : undefined,
          patientInformedById: patientInformed ? transfer.communication?.patientInformedById : undefined,
          familyContactedAt: familyContacted ? (transfer.communication?.familyContactedAt || now) : undefined,
          familyContactedById: familyContacted ? transfer.communication?.familyContactedById : undefined,
          familyContactMethod: familyContacted ? familyMethod : undefined,
        },
      });
    } catch (e) { onError(e instanceof Error ? e.message : t('transfers.errSaveCommunication')); }
  };
  const markArrived = async () => {
    try {
      await onArrive(transfer._id, {
        receiverAssessedAt: new Date().toISOString(),
        receiverAssessmentNotes: 'Receiving assessment completed from transfer panel',
      });
    } catch (e) { onError(e instanceof Error ? e.message : t('transfers.errConfirmArrival')); }
  };
  return (
    <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-subtle, rgba(0,0,0,.02))' }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('transfers.transferProgress')}</div>
          <div className="text-[12px] font-semibold mt-1 capitalize">{PHYSICAL_LABEL[physical] ? t(PHYSICAL_LABEL[physical]) : physical.replace(/_/g, ' ')}</div>
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {transfer.arrivedAt ? t('transfers.arrivedAt', { date: formatDateTime(transfer.arrivedAt) }) : t('transfers.arrivalNotConfirmed')}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[11px]">{t('transfers.destinationWard')}
          {wards.length > 0 ? <Select className="form-input w-full mt-1 text-[12px]" value={wardId} disabled={!canEdit || busy} onChange={e => { const next = wards.find(w => w._id === e.target.value); setWardId(e.target.value); setWardName(next?.name || ''); setBedId(''); setBedNumber(''); }}><option value="">{t('transfers.selectWard')}</option>{wards.map(w => <option key={w._id} value={w._id}>{t('transfers.wardAvailable', { name: w.name, count: w.availableBeds })}</option>)}</Select> : <input className="form-input w-full mt-1 text-[12px]" value={wardName} disabled={!canEdit || busy} onChange={e => setWardName(e.target.value)} placeholder={t('transfers.wardPlaceholder')} />}
        </label>
        <label className="text-[11px]">{t('transfers.roomBed')}
          {selectedWardBeds.length > 0 ? <Select className="form-input w-full mt-1 text-[12px]" value={bedId} disabled={!canEdit || busy} onChange={e => { const next = selectedWardBeds.find(b => b._id === e.target.value); setBedId(e.target.value); setBedNumber(next?.bedNumber || ''); }}><option value="">{t('transfers.selectBed')}</option>{selectedWardBeds.map(b => <option key={b._id} value={b._id}>{b.bedNumber}</option>)}</Select> : <input className="form-input w-full mt-1 text-[12px]" value={bedNumber} disabled={!canEdit || busy} onChange={e => setBedNumber(e.target.value)} placeholder={t('transfers.bedPlaceholder')} />}
        </label>
      </div>
      <div className="rounded border p-2 space-y-2" style={{ borderColor: 'var(--border-light)' }}>
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{t('transfers.communication')}</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={patientInformed} disabled={!canEdit || busy} onChange={e => setPatientInformed(e.target.checked)} /> {t('transfers.patientInformed')}</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={familyContacted} disabled={!canEdit || busy} onChange={e => setFamilyContacted(e.target.checked)} /> {t('transfers.familyContacted')}</label>
          {familyContacted && <Select className="form-input text-[11px]" value={familyMethod} disabled={!canEdit || busy} onChange={e => setFamilyMethod(e.target.value as typeof familyMethod)}><option value="phone">{t('transfers.contactPhone')}</option><option value="in_person">{t('transfers.contactInPerson')}</option><option value="portal">{t('transfers.contactPortal')}</option><option value="not_available">{t('transfers.contactNotAvailable')}</option></Select>}
          {canEdit && <button className="btn btn-secondary text-[11px]" disabled={busy} onClick={saveCommunication}>{t('transfers.saveCommunication')}</button>}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary text-[11px]" disabled={busy || (!wardName.trim() && !bedNumber.trim())} onClick={saveDestination}>{t('transfers.reserveDestination')}</button>
          <button className="btn btn-secondary text-[11px]" disabled={busy} onClick={markReady}>{t('transfers.markReady')}</button>
          {physical !== 'closed' && <button className="btn btn-primary text-[11px]" disabled={busy} onClick={markArrived}>{t('transfers.confirmArrival')}</button>}
          {physical === 'arrived' && <button className="btn btn-secondary text-[11px]" disabled={busy} onClick={() => onClose(transfer._id)}>{t('transfers.closeTransfer')}</button>}
        </div>
      )}
      <div className="flex flex-wrap gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {['bed_reserved', 'ready_for_transport', 'departed', 'in_transit', 'arrived', 'closed'].map(step => (
          <span key={step} className="px-1.5 py-0.5 rounded" style={{ background: step === physical ? 'var(--green-100, #ecf6f3)' : 'var(--border-light)' }}>{PHYSICAL_LABEL[step] ? t(PHYSICAL_LABEL[step]) : step.replace(/_/g, ' ')}</span>
        ))}
      </div>
    </section>
  );
}

function SummaryList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-[12px] mt-0.5">{items.join(', ')}</div>
    </div>
  );
}

function vitalsLine(v: PatientTransferVitals): string {
  return [
    v.systolic && v.diastolic ? `BP ${v.systolic}/${v.diastolic} mmHg` : '',
    v.pulse ? `HR ${v.pulse} bpm` : '',
    v.respiratoryRate ? `RR ${v.respiratoryRate}/min` : '',
    v.temperature ? `${v.temperature} °C` : '',
    v.oxygenSaturation ? `SpO2 ${v.oxygenSaturation}%` : '',
    v.weight ? `${v.weight} kg` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * What the sending hospital knew, on the chart tabs a receiving doctor reads
 * first. Their records stay there, so these tabs are otherwise empty on the day
 * a patient arrives. It is the copy made when the transfer was sent, and says so.
 */
export function TransferredRecords({ patient }: { patient: PatientDoc }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { transfers } = usePatientTransfers(patient._id);
  const here = currentUser?.hospitalId;
  const latest = transfers
    .filter(x => x.status === 'completed' && x.to.facilityId === here && x.hospitalId !== here)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))[0];
  const summary = latest?.summary;
  if (!summary) return null;

  const hospital = latest.from.facilityName || t('transfers.sendingHospital');
  const vitals = summary.latestVitals ? vitalsLine(summary.latestVitals) : '';
  const results = (summary.recentResults ?? []).map(r => [
    `${r.testName}: ${resultWithUnit(r.result, r.unit)}`,
    r.critical ? `(${t('lab.criticalLabel')})` : r.abnormal ? `(${t('lab.abnormal')})` : '',
  ].filter(Boolean).join(' '));
  // Never a blank: an empty medication list would read as "takes nothing".
  const section = (name: NonNullable<typeof summary.unavailable>[number], items: string[]) => {
    if (summary.unavailable?.includes(name)) return [t('transfers.recordsUnreadable', { hospital })];
    return items.length ? items : [t('transfers.recordsNoneListed', { hospital })];
  };

  return (
    <section className="tamam-transfer-records" aria-label={t('transfers.recordsTitle', { hospital })}>
      <h3>{t('transfers.recordsTitle', { hospital })}</h3>
      <p>{t('transfers.recordsNote', { hospital, date: formatDateTime(latest.requestedAt || latest.createdAt) })}</p>
      {summary.senderStillSyncing && <p role="alert" className="tamam-transfer-records-warn">{t('transfers.recordsMayBeIncomplete', { hospital })}</p>}
      <div className="tamam-transfer-records-grid">
        <SummaryList label={t('transfers.recordsProblems')} items={section('problems', summary.activeProblems ?? [])} />
        <SummaryList label={t('transfers.recordsMedications')} items={section('medications', summary.activeMedications ?? [])} />
        <SummaryList label={t('transfers.recordsVitals')} items={section('vitals', vitals ? [vitals] : [])} />
        <SummaryList label={t('transfers.recordsResults')} items={section('results', results)} />
      </div>
    </section>
  );
}

/**
 * Shown in place of "Patient not found" once this hospital has accepted the
 * patient. Their chart reaches this device after the server applies the move,
 * and until then the doctor who just accepted them has a chart that seems lost.
 */
export function TransferArriving({ patientId, fallback }: { patientId: string; fallback: string }) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { transfers } = usePatientTransfers(patientId);
  const arriving = transfers.find(x => x.to.facilityId === currentUser?.hospitalId
    && (x.status === 'accepted' || x.status === 'completed'));
  return <>{arriving ? t('transfers.chartArriving', { name: arriving.patientName || t('transfers.thisPatient') }) : fallback}</>;
}

export default function TransferHistoryPanel({
  patient,
  canViewClinical = true,
}: {
  patient: PatientDoc;
  /**
   * Non-clinical roles (front desk, cashier, records) legitimately need to know
   * who is accountable for a patient — it is the question they field on the
   * phone. They do not need the clinical reason behind the move, so the panel
   * redacts reason / hand-off notes / the clinical snapshot rather than hiding
   * the tab outright. "Minimum necessary", applied per-field.
   */
  canViewClinical?: boolean;
}) {
  const { t } = useTranslation();
  const { transfers, loading, accept, reject, cancel, complete, updateLogistics, arrive, close } = usePatientTransfers(patient._id);
  const [showModal, setShowModal] = useState(false);

  // The chart's own section — the same title, underline and Add as every
  // other tab — not a card with a header of its own.
  return (
    <>
    <ChartSection
      title={t('chartRows.careCoordination')}
      addLabel={t('transfers.title')}
      onAdd={canViewClinical ? () => setShowModal(true) : undefined}
    >
      {loading && (
        <p className="tamam-cell-sub" style={{ padding: '12px 0' }}>{t('transfers.loading')}</p>
      )}
      {!loading && transfers.length === 0 && (
        <OmrsEmptyState
          itemLabel={t('transfers.itemLabel')}
          actionLabel={t('transfers.title')}
          onAction={canViewClinical ? () => setShowModal(true) : undefined}
        />
      )}
      {transfers.length > 0 && (
        <div className="space-y-3" style={{ paddingTop: 4 }}>
          {transfers.map(tr => (
            <TransferCard
              key={tr._id}
              transfer={tr}
              showClinicalDetail={canViewClinical}
              onAccept={accept}
              onReject={reject}
              onCancel={cancel}
              onComplete={complete}
              onLogistics={updateLogistics}
              onArrive={arrive}
              onClose={close}
            />
          ))}
        </div>
      )}
    </ChartSection>

      {showModal && canViewClinical && (
        <TransferPatientModal patient={patient} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}

/**
 * Compact chart banner. Shown above the chart whenever there is a pending
 * request or a live time-boxed grant, so a clinician opening the record cannot
 * miss that responsibility is in flight or that their access is about to lapse.
 */
export function TransferBanner({
  patient,
  onOpenHistory,
}: {
  patient: PatientDoc;
  onOpenHistory?: () => void;
}) {
  const { t } = useTranslation();
  const { activeTransfer } = usePatientTransfers(patient._id);
  const { currentUser } = useAuth();
  if (!activeTransfer) return null;

  const tr = activeTransfer;
  const pending = tr.status === 'requested';
  const overdue = isTransferOverdue(tr);

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2 rounded mb-3 text-[12px]"
      style={{
        background: overdue ? 'var(--rose-50, #fceeed)' : 'var(--gold-50, #fcfef3)',
        border: `1px solid ${overdue ? 'var(--rose-200, #f9dddb)' : 'var(--gold-200, #FFF7DC)'}`,
      }}
    >
      {overdue
        ? <AlertTriangle className="w-4 h-4 shrink-0 mt-px" style={{ color: 'var(--rose-700, #b4180f)' }} />
        : <ArrowRightLeft className="w-4 h-4 shrink-0 mt-px" style={{ color: 'var(--gold-800, #a65300)' }} />}
      <div className="min-w-0">
        <strong>
          {pending
            ? (overdue ? t('transfers.bannerAwaitingOverdue') : t('transfers.bannerAwaiting'))
            : tr.status === 'accepted'
              ? t('transfers.bannerAccepted')
              : t('transfers.bannerAccessInForce', { type: TYPE_LABEL[tr.transferType] ? t(TYPE_LABEL[tr.transferType]) : tr.transferType })}
        </strong>
        <span> · {describeTransferRoute(tr, { id: currentUser?._id, hospitalId: currentUser?.hospitalId }, { to: t('transfers.routeTo'), from: t('transfers.routeFrom') })}</span>
        {tr.expiresAt && <span> · {t('transfers.ends', { date: formatDateTime(tr.expiresAt) })}</span>}
        {onOpenHistory && (
          <button className="ms-2 underline" onClick={onOpenHistory}>{t('transfers.view')}</button>
        )}
      </div>
    </div>
  );
}
