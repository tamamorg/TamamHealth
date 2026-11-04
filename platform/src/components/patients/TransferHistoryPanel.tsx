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
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import FormNotices from '@/components/overlay/FormNotices';
import FormSlider from '@/components/overlay/FormSlider';
import { ObfSelectField, ObfTextField, ObfValue } from '@/components/ehr/chart/panels/order-basket/ObfFields';
import '@/components/lab/order/lab-order.css';
import '@/components/lab/workflow/lab-workflow.css';
import { useAuth } from '@/lib/context';
import { finishOnServer, usePatientTransfers } from '@/lib/hooks/usePatientTransfers';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { getPatientById } from '@/lib/services/patient-service';
import { useWards } from '@/lib/hooks/useWards';
import {
  TRANSFER_PROGRESS_ORDER, describeTransferRoute, isTransferOverdue, transferProgress, transferProgressRank,
} from '@/lib/services/patient-transfer-service';
import {
  canDecideTransfer, canCancelTransfer, canContributeTransfer,
} from '@/lib/services/patient-transfer-permissions';
import TransferPatientModal from './TransferPatientModal';
import ChartSection, { OmrsEmptyState } from '@/components/ehr/chart/ChartSection';
import type {
  PatientDoc, PatientTransferDoc, PatientTransferPhysicalStatus, PatientTransferStatus, PatientTransferVitals,
} from '@/lib/db-types';
import { formatDateTime } from '@/lib/format-utils';
import {
  ArrowRightLeft, Clock, AlertTriangle,
} from '@/components/icons/lucide';
import RowActionsMenu from '@/components/RowActionsMenu';
import { useToast } from '@/components/Toast';
import { clickable } from '@/lib/a11y';
import { describeError } from '@/lib/user-facing-error';
import { resultWithUnit } from '@/components/lab/workflow/lab-workflow-types';
import { requestReload } from '@/lib/unsaved/unsaved-registry';

// The same pills as the referrals table beside it.
const STATUS_STYLE: Record<PatientTransferStatus, { label: string; badge: string }> = {
  draft: { label: 'transfers.statusDraft', badge: 'ref-cancelled' },
  requested: { label: 'transfers.statusRequested', badge: 'ref-received' },
  accepted: { label: 'transfers.statusAccepted', badge: 'ref-sent' },
  rejected: { label: 'transfers.statusRejected', badge: 'ref-cancelled' },
  cancelled: { label: 'transfers.statusWithdrawn', badge: 'ref-cancelled' },
  completed: { label: 'transfers.statusCompleted', badge: 'ref-completed' },
  expired: { label: 'transfers.statusLapsed', badge: 'ref-cancelled' },
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

const PROGRESS_STEPS = TRANSFER_PROGRESS_ORDER.filter(step => step in PHYSICAL_LABEL);

function StatusChip({ status }: { status: PatientTransferStatus }) {
  const { t } = useTranslation();
  const s = STATUS_STYLE[status];
  return <span className={`badge ${s.badge}`}>{t(s.label)}</span>;
}

/** The history as a reader takes it: an entry repeated in a row shows once. */
function collapseRepeats(events: PatientTransferDoc['events']) {
  const rows: { event: PatientTransferDoc['events'][number]; count: number }[] = [];
  for (const event of events) {
    const last = rows[rows.length - 1];
    if (last && last.event.message === event.message && last.event.actorId === event.actorId) last.count += 1;
    else rows.push({ event, count: 1 });
  }
  return rows;
}

/** The frame every station form shares: scrolling body, pinned footer. */
function TransferForm({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  return (
    <div className="station-form-slider obk-root lwf">
      <div className="obf-form">
        <div className="obf-form-body"><div className="obf-pad">{children}</div></div>
        <FormNotices />
        <div className="obk-footer">{footer}</div>
      </div>
    </div>
  );
}

function TransferSection({ title, stacked = false, children }: { title?: string; stacked?: boolean; children: ReactNode }) {
  return (
    <div className="obf-section">
      {title && <div className="obf-section-head lwf-section-head">{title}</div>}
      <div className="lwf-section-body">{stacked ? children : <div className="obf-row">{children}</div>}</div>
    </div>
  );
}

function TransferDetailSlider({
  transfer, showClinicalDetail, canUpdate, onClose, onUpdate, actions,
}: {
  transfer: PatientTransferDoc;
  /** False for non-clinical roles: they see who is accountable and when it
   *  changed, not the clinical picture that motivated the move. */
  showClinicalDetail: boolean;
  canUpdate: boolean;
  onClose: () => void;
  onUpdate: () => void;
  actions: ReactNode;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const progress = transferProgress(transfer);
  const summary = transfer.summary;
  const route = describeTransferRoute(transfer, { id: currentUser?._id, hospitalId: currentUser?.hospitalId }, { to: t('transfers.routeTo'), from: t('transfers.routeFrom') });
  const place = [transfer.destination?.wardName, transfer.destination?.bedNumber].filter(Boolean).join(' · ');
  const communication = transfer.communication;
  const list = (items: string[]) => items.join(', ');

  return (
    <FormSlider title={t('transfers.detailsTitle')} subtitle={route} className="tamam-dialog" width={560} flush onClose={onClose}>
      <TransferForm footer={<>
        <button type="button" className="obk-footer-btn obk-footer-btn--secondary" onClick={onClose}>{t('action.close')}</button>
        {actions}
        {canUpdate && <button type="button" className="obk-footer-btn obk-footer-btn--primary" onClick={onUpdate}>{t('transfers.update')}</button>}
      </>}>
        <TransferSection>
          <ObfValue label={t('transfers.colStatus')} value={<StatusChip status={transfer.status} />} />
          <ObfValue label={t('transfers.colType')} value={TYPE_LABEL[transfer.transferType] ? t(TYPE_LABEL[transfer.transferType]) : transfer.transferType} />
          <ObfValue label={t('transfers.colRequested')} value={`${transfer.requestedByName || t('transfers.unknown')}${transfer.requestedAt ? ` · ${formatDateTime(transfer.requestedAt)}` : ''}`} />
          {transfer.expiresAt && <ObfValue label={t('transfers.endsLabel')} value={formatDateTime(transfer.expiresAt)} />}
          {transfer.forced && <ObfValue label={t('transfers.forced')} value={t('transfers.forcedTitle')} />}
          {isTransferOverdue(transfer) && <ObfValue label={t('transfers.overdue')} value={<Clock className="w-3 h-3" />} />}
          {showClinicalDetail && <ObfValue label={t('transfers.reason')} value={transfer.reason} />}
          {showClinicalDetail && transfer.handoffNotes && <ObfValue label={t('transfers.handoffNotes')} value={transfer.handoffNotes} />}
        </TransferSection>

        {showClinicalDetail && (transfer.status === 'accepted' || transfer.status === 'completed') && (
          <TransferSection title={t('transfers.transferProgress')}>
            <ObfValue label={t('transfers.colProgress')} value={t(PHYSICAL_LABEL[progress] ?? 'transfers.physNotScheduled')} />
            <ObfValue label={t('transfers.arrival')} value={transfer.arrivedAt ? formatDateTime(transfer.arrivedAt) : t('transfers.arrivalNotConfirmed')} />
            <ObfValue label={t('transfers.destinationWard')} value={place} />
            <ObfValue label={t('transfers.patientInformed')} value={communication?.patientInformedAt && formatDateTime(communication.patientInformedAt)} />
            <ObfValue label={t('transfers.familyContacted')} value={communication?.familyContactedAt && formatDateTime(communication.familyContactedAt)} />
          </TransferSection>
        )}

        {/* The snapshot the receiver decided on, kept as evidence. */}
        {showClinicalDetail && summary && (
          <TransferSection title={t('transfers.summaryTitle')}>
            {(summary.activeProblems?.length ?? 0) > 0 && <ObfValue label={t('transfers.activeProblems')} value={list(summary.activeProblems!)} />}
            {(summary.activeMedications?.length ?? 0) > 0 && <ObfValue label={t('transfers.activeMedications')} value={list(summary.activeMedications!)} />}
            {summary.unavailable?.includes('allergies') && <ObfValue label={t('transfers.allergies')} value={t('transfers.allergiesUnreadable')} />}
            {(summary.allergies?.length ?? 0) > 0 && <ObfValue label={t('transfers.allergies')} value={list(summary.allergies!)} />}
            {(summary.riskFlags?.length ?? 0) > 0 && <ObfValue label={t('transfers.riskFlags')} value={list(summary.riskFlags!)} />}
            {typeof summary.openTaskCount === 'number' && <ObfValue label={t('transfers.openTasks')} value={String(summary.openTaskCount)} />}
          </TransferSection>
        )}

        <TransferSection title={t('transfers.auditTrail')} stacked>
          {collapseRepeats(transfer.events).map(({ event, count }) => (
            <ObfValue
              key={event.id}
              label={formatDateTime(event.createdAt)}
              value={[event.message, event.actorName, count > 1 ? `(${t('transfers.timesRepeated', { count })})` : '', showClinicalDetail && event.notes ? `(${event.notes})` : ''].filter(Boolean).join(' · ')}
            />
          ))}
        </TransferSection>
      </TransferForm>
    </FormSlider>
  );
}

/** Everything that changes as a patient moves, on one form with one Save. */
function TransferUpdateSlider({
  transfer, onClose, onLogistics, onArrive, onCloseTransfer,
}: {
  transfer: PatientTransferDoc;
  onClose: () => void;
  onLogistics: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  onArrive: (id: string, assessment?: Record<string, unknown>) => Promise<unknown>;
  onCloseTransfer: (id: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { currentUser } = useAuth();
  const current = transferProgress(transfer);
  const [progress, setProgress] = useState<PatientTransferPhysicalStatus>(current);
  const [wardName, setWardName] = useState(transfer.destination?.wardName || '');
  const [bedNumber, setBedNumber] = useState(transfer.destination?.bedNumber || '');
  const [wardId, setWardId] = useState(transfer.destination?.wardId || '');
  const [bedId, setBedId] = useState(transfer.destination?.bedId || '');
  const { wards, beds } = useWards();
  const wardBeds = beds.filter(b => b.wardId === wardId && (b.status === 'available' || b._id === bedId));
  const [patientInformed, setPatientInformed] = useState(Boolean(transfer.communication?.patientInformedAt));
  const [familyContacted, setFamilyContacted] = useState(Boolean(transfer.communication?.familyContactedAt));
  const [familyMethod, setFamilyMethod] = useState(transfer.communication?.familyContactMethod || 'phone');
  const [medsReconciled, setMedsReconciled] = useState(Boolean(transfer.clinicalReadiness?.medicationsReconciled));
  const [busy, setBusy] = useState(false);
  const betweenHospitals = Boolean(transfer.to.facilityId) && transfer.to.facilityId !== transfer.hospitalId;

  // Only forward, and closing only once the transfer has completed.
  const steps = PROGRESS_STEPS.filter(step => transferProgressRank(step) >= transferProgressRank(current)
    && (step !== 'closed' || transfer.status === 'completed')
    && (step !== 'not_scheduled' || current === 'not_scheduled'));

  const save = async () => {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const beforeArrival = transferProgressRank(progress) < transferProgressRank('arrived');
      const reserved = progress === 'not_scheduled' && Boolean(wardName.trim() || bedNumber.trim());
      const moving = progress === 'ready_for_transport' || progress === 'departed' || progress === 'in_transit';
      await onLogistics(transfer._id, {
        ...(beforeArrival ? { physicalStatus: reserved ? 'bed_reserved' : progress } : {}),
        destination: { wardId: wardId || undefined, wardName: wardName.trim() || undefined, bedId: bedId || undefined, bedNumber: bedNumber.trim() || undefined },
        clinicalReadiness: { medicationsReconciled: medsReconciled },
        communication: {
          patientInformedAt: patientInformed ? (transfer.communication?.patientInformedAt || now) : undefined,
          patientInformedById: patientInformed ? (transfer.communication?.patientInformedById || currentUser?._id) : undefined,
          familyContactedAt: familyContacted ? (transfer.communication?.familyContactedAt || now) : undefined,
          familyContactedById: familyContacted ? (transfer.communication?.familyContactedById || currentUser?._id) : undefined,
          familyContactMethod: familyContacted ? familyMethod : undefined,
        },
        ...(moving ? { transport: {
          ...(transfer.transport || { status: 'not_requested' }),
          status: progress === 'ready_for_transport' ? 'ready' : 'departed',
          ...(progress === 'ready_for_transport' ? {} : { departedAt: transfer.transport?.departedAt || now }),
        } } : {}),
      });
      if (!beforeArrival && !transfer.arrivedAt) {
        // Stored as written, like the rest of the transfer's record.
        await onArrive(transfer._id, { receiverAssessedAt: now, receiverAssessmentNotes: 'Receiving assessment completed from transfer panel' });
      }
      if (progress === 'closed') await onCloseTransfer(transfer._id);
      showToast(t('transfers.updated'), 'success', { placement: 'corner' });
      onClose();
    } catch (e) {
      showToast(describeError(e, t('msg.changeNotSavedTryAgain')), 'error', { placement: 'corner' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSlider
      title={t('transfers.update')}
      subtitle={describeTransferRoute(transfer, { id: currentUser?._id, hospitalId: currentUser?.hospitalId }, { to: t('transfers.routeTo'), from: t('transfers.routeFrom') })}
      className="tamam-dialog"
      width={560}
      flush
      onClose={onClose}
    >
      <TransferForm footer={<>
        <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={busy} onClick={onClose}>{t('action.cancel')}</button>
        <button type="button" className="obk-footer-btn obk-footer-btn--primary" disabled={busy} onClick={() => void save()}>{t('action.save')}</button>
      </>}>
        <TransferSection title={t('transfers.transferProgress')}>
          <ObfSelectField
            id="transfer-progress"
            label={t('transfers.colProgress')}
            value={progress}
            placeholder={null}
            options={steps.map(step => ({ value: step, label: t(PHYSICAL_LABEL[step]) }))}
            onChange={value => setProgress(value as PatientTransferPhysicalStatus)}
          />
        </TransferSection>

        <TransferSection title={t('transfers.destination')}>
          {wards.length > 0
            ? (
              <ObfSelectField
                id="transfer-ward"
                label={t('transfers.destinationWard')}
                value={wardId}
                placeholder={t('transfers.selectWard')}
                options={wards.map(w => ({ value: w._id, label: t('transfers.wardAvailable', { name: w.name, count: w.availableBeds }) }))}
                onChange={value => { setWardId(value); setWardName(wards.find(w => w._id === value)?.name || ''); setBedId(''); setBedNumber(''); }}
              />
            )
            : <ObfTextField id="transfer-ward" label={t('transfers.destinationWard')} value={wardName} onChange={setWardName} placeholder={t('transfers.wardPlaceholder')} />}
          {wardBeds.length > 0
            ? (
              <ObfSelectField
                id="transfer-bed"
                label={t('transfers.roomBed')}
                value={bedId}
                placeholder={t('transfers.selectBed')}
                options={wardBeds.map(b => ({ value: b._id, label: b.bedNumber }))}
                onChange={value => { setBedId(value); setBedNumber(wardBeds.find(b => b._id === value)?.bedNumber || ''); }}
              />
            )
            : <ObfTextField id="transfer-bed" label={t('transfers.roomBed')} value={bedNumber} onChange={setBedNumber} placeholder={t('transfers.bedPlaceholder')} />}
        </TransferSection>

        <TransferSection title={t('transfers.communication')}>
          <label className="obf-check"><input type="checkbox" checked={patientInformed} onChange={e => setPatientInformed(e.target.checked)} /> {t('transfers.patientInformed')}</label>
          <label className="obf-check"><input type="checkbox" checked={familyContacted} onChange={e => setFamilyContacted(e.target.checked)} /> {t('transfers.familyContacted')}</label>
          {familyContacted && (
            <ObfSelectField
              id="transfer-family-method"
              label={t('transfers.contactMethod')}
              value={familyMethod}
              placeholder={null}
              options={[
                { value: 'phone', label: t('transfers.contactPhone') },
                { value: 'in_person', label: t('transfers.contactInPerson') },
                { value: 'portal', label: t('transfers.contactPortal') },
                { value: 'not_available', label: t('transfers.contactNotAvailable') },
              ]}
              onChange={value => setFamilyMethod(value as typeof familyMethod)}
            />
          )}
          {betweenHospitals && (
            <label className="obf-check"><input type="checkbox" checked={medsReconciled} onChange={e => setMedsReconciled(e.target.checked)} /> {t('transfers.medsReconciled')}</label>
          )}
        </TransferSection>
      </TransferForm>
    </FormSlider>
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
  const scope = useDataScope();
  const arriving = transfers.find(x => x.to.facilityId === currentUser?.hospitalId
    && (x.status === 'accepted' || x.status === 'completed'));
  const arrivingId = arriving?._id;
  const stillAccepted = arriving?.status === 'accepted';

  // A reload ends the retries started on accepting, so pick them up here.
  useEffect(() => {
    if (arrivingId && stillAccepted) void finishOnServer(arrivingId);
  }, [arrivingId, stillAccepted]);

  // This page holds no live feed on a patient it cannot see, so watch for the
  // chart and open it, as the message promises.
  useEffect(() => {
    if (!arrivingId || !scope) return;
    const timer = setInterval(() => {
      void getPatientById(patientId, scope).then(patient => {
        if (!patient) return;
        clearInterval(timer);
        // Asks first while a form holds unsaved text (lib/unsaved).
        requestReload('reload.reason.chartArrived');
      }, () => { /* still on its way */ });
    }, 15_000);
    return () => clearInterval(timer);
  }, [arrivingId, patientId, scope]);

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
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [open, setOpen] = useState<{ id: string; view: 'details' | 'update' | 'reject' } | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  const auth = currentUser ? {
    sub: currentUser._id,
    username: currentUser.username,
    role: currentUser.role,
    name: currentUser.name || currentUser.username,
    hospitalId: currentUser.hospitalId,
    orgId: currentUser.orgId,
  } : null;
  const viewer = { id: currentUser?._id, hospitalId: currentUser?.hospitalId };
  const words = { to: t('transfers.routeTo'), from: t('transfers.routeFrom') };
  const selected = open ? transfers.find(tr => tr._id === open.id) : undefined;

  const decideAllowed = (tr: PatientTransferDoc) => tr.status === 'requested' && Boolean(auth && canDecideTransfer(auth, tr).allowed);
  const withdrawAllowed = (tr: PatientTransferDoc) => tr.status === 'requested' && Boolean(auth && canCancelTransfer(auth, tr).allowed);
  // A future-dated transfer past its date can be confirmed by hand when auto-complete is off.
  const confirmAllowed = (tr: PatientTransferDoc) => tr.status === 'accepted' && tr.autoCompleteOnEffectiveDate === false && Boolean(auth && canDecideTransfer(auth, tr).allowed);
  const updateAllowed = (tr: PatientTransferDoc) => canViewClinical && (tr.status === 'accepted' || tr.status === 'completed')
    && transferProgress(tr) !== 'closed' && Boolean(auth && canContributeTransfer(auth, tr).allowed);

  const act = async (fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    try {
      await fn();
      done?.();
    } catch (e) {
      showToast(describeError(e, t('msg.changeNotSavedTryAgain')), 'error', { placement: 'corner' });
    } finally {
      setBusy(false);
    }
  };

  const backToDetails = () => {
    if (selected) setOpen({ id: selected._id, view: 'details' });
    setRejectNote('');
  };

  const decisionButtons = (tr: PatientTransferDoc) => <>
    {withdrawAllowed(tr) && <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={busy} onClick={() => void act(() => cancel(tr._id, 'Withdrawn by sender'), () => setOpen(null))}>{t('transfers.withdraw')}</button>}
    {decideAllowed(tr) && <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={busy} onClick={() => setOpen({ id: tr._id, view: 'reject' })}>{t('transfers.reject')}</button>}
    {decideAllowed(tr) && <button type="button" className="obk-footer-btn obk-footer-btn--primary" disabled={busy} onClick={() => void act(() => accept(tr._id))}>{t('transfers.accept')}</button>}
    {confirmAllowed(tr) && <button type="button" className="obk-footer-btn obk-footer-btn--primary" disabled={busy} onClick={() => void act(() => complete(tr._id))}>{t('transfers.confirmArrived')}</button>}
  </>;

  const rowActions = (tr: PatientTransferDoc) => [
    { key: 'details', label: t('transfers.viewDetails'), onClick: () => setOpen({ id: tr._id, view: 'details' }) },
    ...(updateAllowed(tr) ? [{ key: 'update', label: t('transfers.update'), onClick: () => setOpen({ id: tr._id, view: 'update' as const }) }] : []),
    ...(decideAllowed(tr) ? [
      { key: 'accept', label: t('transfers.accept'), tone: 'success' as const, onClick: () => void act(() => accept(tr._id)) },
      { key: 'reject', label: t('transfers.reject'), tone: 'danger' as const, onClick: () => setOpen({ id: tr._id, view: 'reject' as const }) },
    ] : []),
    ...(confirmAllowed(tr) ? [{ key: 'confirm', label: t('transfers.confirmArrived'), onClick: () => void act(() => complete(tr._id)) }] : []),
    ...(withdrawAllowed(tr) ? [{ key: 'withdraw', label: t('transfers.withdraw'), tone: 'danger' as const, onClick: () => void act(() => cancel(tr._id, 'Withdrawn by sender')) }] : []),
  ];

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
        <table className="tamam-table tamam-transfer-table">
          <thead>
            <tr>
              <th>{t('transfers.colTransfer')}</th>
              <th>{t('transfers.colType')}</th>
              <th>{t('transfers.colRequested')}</th>
              <th>{t('transfers.colProgress')}</th>
              <th>{t('transfers.colStatus')}</th>
              <th className="tamam-col-actions">{t('chart.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {transfers.map(tr => {
              const progress = transferProgress(tr);
              return (
                <tr key={tr._id} {...clickable(() => setOpen({ id: tr._id, view: 'details' }))}>
                  <td>
                    <span className="tamam-cell-strong">{describeTransferRoute(tr, viewer, words)}</span>
                    {canViewClinical && tr.reason && <span className="tamam-cell-sub">{tr.reason}</span>}
                  </td>
                  <td>{TYPE_LABEL[tr.transferType] ? t(TYPE_LABEL[tr.transferType]) : tr.transferType}</td>
                  <td>{tr.requestedAt ? formatDateTime(tr.requestedAt) : '—'}</td>
                  <td>{t(PHYSICAL_LABEL[progress] ?? 'transfers.physNotScheduled')}</td>
                  <td><StatusChip status={tr.status} /></td>
                  <td onClick={e => e.stopPropagation()}>
                    <RowActionsMenu ariaLabel={t('chart.actions')} actions={rowActions(tr)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </ChartSection>

      {selected && open?.view === 'details' && (
        <TransferDetailSlider
          transfer={selected}
          showClinicalDetail={canViewClinical}
          canUpdate={updateAllowed(selected)}
          onClose={() => setOpen(null)}
          onUpdate={() => setOpen({ id: selected._id, view: 'update' })}
          actions={decisionButtons(selected)}
        />
      )}
      {selected && open?.view === 'update' && (
        <TransferUpdateSlider
          key={selected._id}
          transfer={selected}
          onClose={() => setOpen({ id: selected._id, view: 'details' })}
          onLogistics={updateLogistics}
          onArrive={arrive}
          onCloseTransfer={close}
        />
      )}
      {selected && open?.view === 'reject' && (
        <FormSlider title={t('transfers.rejectTitle')} subtitle={describeTransferRoute(selected, viewer, words)} className="tamam-dialog" width={560} flush onClose={backToDetails}>
          <TransferForm footer={<>
            <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={busy} onClick={backToDetails}>{t('action.cancel')}</button>
            <button type="button" className="obk-footer-btn obk-footer-btn--primary" disabled={busy || !rejectNote.trim()} onClick={() => void act(() => reject(selected._id, rejectNote.trim()), () => { setOpen(null); setRejectNote(''); })}>{t('transfers.confirmReject')}</button>
          </>}>
            <TransferSection title={t('transfers.rejectTitle')}>
              <ObfTextField id="transfer-reject-reason" label={t('transfers.rejectReason')} required multiline value={rejectNote} onChange={setRejectNote} />
              <p className="labord-help">{t('transfers.rejectHint')}</p>
            </TransferSection>
          </TransferForm>
        </FormSlider>
      )}

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
          <button type="button" className="ms-2 underline" style={{ color: 'var(--accent-primary)', fontWeight: 600 }} onClick={onOpenHistory}>{t('transfers.view')}</button>
        )}
      </div>
    </div>
  );
}
