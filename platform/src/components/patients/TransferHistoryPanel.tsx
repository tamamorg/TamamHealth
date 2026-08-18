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
import { useAuth } from '@/lib/context';
import { usePatientTransfers } from '@/lib/hooks/usePatientTransfers';
import { useWards } from '@/lib/hooks/useWards';
import {
  describeAssignment, isTransferOverdue,
} from '@/lib/services/patient-transfer-service';
import {
  canDecideTransfer, canCancelTransfer, canContributeTransfer,
} from '@/lib/services/patient-transfer-permissions';
import TransferPatientModal from './TransferPatientModal';
import type {
  PatientDoc, PatientTransferDoc, PatientTransferStatus,
} from '@/lib/db-types';
import { formatDateTime } from '@/lib/format-utils';
import {
  ArrowRightLeft, Check, X, Clock, AlertTriangle, ChevronDown, ChevronUp, Plus,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

const STATUS_STYLE: Record<PatientTransferStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: 'var(--border-light)', fg: 'var(--text-muted)' },
  requested: { label: 'Awaiting acceptance', bg: 'var(--gold-100, #fef3c7)', fg: 'var(--gold-800, #92400e)' },
  accepted: { label: 'Accepted', bg: 'var(--iris-100, #e0e7ff)', fg: 'var(--iris-800, #3730a3)' },
  rejected: { label: 'Rejected', bg: 'var(--rose-100, #ffe4e6)', fg: 'var(--rose-800, #9f1239)' },
  cancelled: { label: 'Withdrawn', bg: 'var(--border-light)', fg: 'var(--text-muted)' },
  completed: { label: 'Completed', bg: 'var(--green-100, #dcfce7)', fg: 'var(--green-800, #166534)' },
  expired: { label: 'Lapsed', bg: 'var(--border-light)', fg: 'var(--text-muted)' },
};

const TYPE_LABEL: Record<string, string> = {
  permanent: 'Permanent',
  temporary: 'Temporary',
  shared_care: 'Shared care',
};

function StatusChip({ status }: { status: PatientTransferStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
      style={{ background: s.bg, color: s.fg }}>
      {s.label}
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
  const { currentUser } = useAuth();
  const [expanded, setExpanded] = useState(transfer.status === 'requested');
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
      setError(e instanceof Error ? e.message : 'Action failed');
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
                {TYPE_LABEL[transfer.transferType] ?? transfer.transferType}
              </span>
              {transfer.forced && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: 'var(--rose-100, #ffe4e6)', color: 'var(--rose-800, #9f1239)' }}
                  title="Applied by an administrator without the receiving team accepting">
                  Forced
                </span>
              )}
              {overdue && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1"
                  style={{ background: 'var(--rose-100, #ffe4e6)', color: 'var(--rose-800, #9f1239)' }}>
                  <Clock className="w-3 h-3" /> Overdue
                </span>
              )}
            </div>
            <div className="text-[13px] font-semibold mt-1.5 truncate">
              {describeAssignment(transfer.from)} → {describeAssignment(transfer.to)}
            </div>
            {showClinicalDetail && (
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {transfer.reason}
              </div>
            )}
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Requested by {transfer.requestedByName || 'unknown'}
              {transfer.requestedAt ? ` · ${formatDateTime(transfer.requestedAt)}` : ''}
              {transfer.expiresAt ? ` · ends ${formatDateTime(transfer.expiresAt)}` : ''}
            </div>
          </div>
          <button
            className="p-1 rounded hover:bg-black/5 shrink-0"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
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
                  <Check className="w-3.5 h-3.5" /> Accept
                </button>
                <button
                  className="btn btn-secondary text-[12px] inline-flex items-center gap-1"
                  disabled={busy}
                  onClick={() => setRejecting(true)}
                >
                  <X className="w-3.5 h-3.5" /> Reject
                </button>
              </>
            )}
            {withdraw.allowed && !rejecting && (
              <button
                className="btn btn-secondary text-[12px]"
                disabled={busy}
                onClick={() => act(() => onCancel(transfer._id, 'Withdrawn by sender'))}
              >
                Withdraw
              </button>
            )}
          </div>
        )}

        {rejecting && (
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="text-[11px] font-semibold">
                Why are you rejecting this transfer?
              </span>
              <textarea
                className="form-input w-full mt-1 text-[12px]"
                rows={2}
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                placeholder="The sending clinician gets the patient back — tell them what to fix."
              />
            </label>
            <div className="flex gap-2">
              <button
                className="btn btn-primary text-[12px]"
                disabled={busy || !rejectNote.trim()}
                onClick={() => act(() => onReject(transfer._id, rejectNote.trim()))}
              >
                Confirm rejection
              </button>
              <button
                className="btn btn-secondary text-[12px]"
                onClick={() => { setRejecting(false); setRejectNote(''); }}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {awaitingConfirm && decide.allowed && (
          <button
            className="btn btn-primary text-[12px] mt-3"
            disabled={busy}
            onClick={() => act(() => onComplete(transfer._id))}
          >
            Confirm patient has arrived
          </button>
        )}

        {error && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--rose-700, #b91c1c)' }}>{error}</p>
        )}
      </div>

      {expanded && (
        <div className="border-t px-3 py-2.5 space-y-3" style={{ borderColor: 'var(--border-light)' }}>
          {showClinicalDetail && transfer.handoffNotes && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}>Hand-off notes</div>
              <p className="text-[12px] mt-0.5 whitespace-pre-wrap">{transfer.handoffNotes}</p>
            </div>
          )}

          {/* The snapshot the receiver decided on, kept as evidence. */}
          {showClinicalDetail && transfer.summary && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(transfer.summary.activeProblems?.length ?? 0) > 0 && (
                <SummaryList label="Active problems" items={transfer.summary.activeProblems!} />
              )}
              {(transfer.summary.activeMedications?.length ?? 0) > 0 && (
                <SummaryList label="Active medications" items={transfer.summary.activeMedications!} />
              )}
              {(transfer.summary.allergies?.length ?? 0) > 0 && (
                <SummaryList label="Allergies" items={transfer.summary.allergies!} />
              )}
              {(transfer.summary.riskFlags?.length ?? 0) > 0 && (
                <SummaryList label="Risk flags" items={transfer.summary.riskFlags!} />
              )}
              {typeof transfer.summary.openTaskCount === 'number' && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}>Open tasks at hand-off</div>
                  <div className="text-[12px] mt-0.5">{transfer.summary.openTaskCount}</div>
                </div>
              )}
            </div>
          )}

          {(transfer.checklist?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-1"
                style={{ color: 'var(--text-muted)' }}>Hand-off checklist</div>
              <div className="flex flex-wrap gap-1.5">
                {transfer.checklist!.map(item => (
                  <span key={item.key}
                    className="text-[11px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                    style={{
                      background: item.done ? 'var(--green-100, #dcfce7)' : 'var(--border-light)',
                      color: item.done ? 'var(--green-800, #166534)' : 'var(--text-muted)',
                    }}>
                    {item.done ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {item.label}
                  </span>
                ))}
              </div>
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
              style={{ color: 'var(--text-muted)' }}>Audit trail</div>
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
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not save destination'); }
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
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not mark ready'); }
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
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not save communication status'); }
  };
  const markArrived = async () => {
    try {
      await onArrive(transfer._id, {
        receiverAssessedAt: new Date().toISOString(),
        receiverAssessmentNotes: 'Receiving assessment completed from transfer panel',
      });
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not confirm arrival'); }
  };
  return (
    <section className="rounded border p-3 space-y-2" style={{ borderColor: 'var(--border-light)', background: 'var(--bg-subtle, rgba(0,0,0,.02))' }}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Transfer progress</div>
          <div className="text-[12px] font-semibold mt-1 capitalize">{physical.replace(/_/g, ' ')}</div>
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {transfer.arrivedAt ? `Arrived ${formatDateTime(transfer.arrivedAt)}` : 'Arrival not confirmed'}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[11px]">Destination ward
          {wards.length > 0 ? <Select className="form-input w-full mt-1 text-[12px]" value={wardId} disabled={!canEdit || busy} onChange={e => { const next = wards.find(w => w._id === e.target.value); setWardId(e.target.value); setWardName(next?.name || ''); setBedId(''); setBedNumber(''); }}><option value="">Select ward</option>{wards.map(w => <option key={w._id} value={w._id}>{w.name} ({w.availableBeds} available)</option>)}</Select> : <input className="form-input w-full mt-1 text-[12px]" value={wardName} disabled={!canEdit || busy} onChange={e => setWardName(e.target.value)} placeholder="Ward or unit" />}
        </label>
        <label className="text-[11px]">Room / bed
          {selectedWardBeds.length > 0 ? <Select className="form-input w-full mt-1 text-[12px]" value={bedId} disabled={!canEdit || busy} onChange={e => { const next = selectedWardBeds.find(b => b._id === e.target.value); setBedId(e.target.value); setBedNumber(next?.bedNumber || ''); }}><option value="">Select available bed</option>{selectedWardBeds.map(b => <option key={b._id} value={b._id}>{b.bedNumber}</option>)}</Select> : <input className="form-input w-full mt-1 text-[12px]" value={bedNumber} disabled={!canEdit || busy} onChange={e => setBedNumber(e.target.value)} placeholder="Room or bed number" />}
        </label>
      </div>
      <div className="rounded border p-2 space-y-2" style={{ borderColor: 'var(--border-light)' }}>
        <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Patient and family communication</div>
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={patientInformed} disabled={!canEdit || busy} onChange={e => setPatientInformed(e.target.checked)} /> Patient informed</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={familyContacted} disabled={!canEdit || busy} onChange={e => setFamilyContacted(e.target.checked)} /> Family contacted</label>
          {familyContacted && <Select className="form-input text-[11px]" value={familyMethod} disabled={!canEdit || busy} onChange={e => setFamilyMethod(e.target.value as typeof familyMethod)}><option value="phone">Phone</option><option value="in_person">In person</option><option value="portal">Portal</option><option value="not_available">Not available</option></Select>}
          {canEdit && <button className="btn btn-secondary text-[11px]" disabled={busy} onClick={saveCommunication}>Save communication</button>}
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary text-[11px]" disabled={busy || (!wardName.trim() && !bedNumber.trim())} onClick={saveDestination}>Reserve destination</button>
          <button className="btn btn-secondary text-[11px]" disabled={busy} onClick={markReady}>Mark ready for transport</button>
          {physical !== 'closed' && <button className="btn btn-primary text-[11px]" disabled={busy} onClick={markArrived}>Confirm arrival and assessment</button>}
          {physical === 'arrived' && <button className="btn btn-secondary text-[11px]" disabled={busy} onClick={() => onClose(transfer._id)}>Close transfer</button>}
        </div>
      )}
      <div className="flex flex-wrap gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {['bed_reserved', 'ready_for_transport', 'departed', 'in_transit', 'arrived', 'closed'].map(step => (
          <span key={step} className="px-1.5 py-0.5 rounded" style={{ background: step === physical ? 'var(--green-100, #dcfce7)' : 'var(--border-light)' }}>{step.replace(/_/g, ' ')}</span>
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
  const { transfers, loading, accept, reject, cancel, complete, updateLogistics, arrive, close } = usePatientTransfers(patient._id);
  const [showModal, setShowModal] = useState(false);

  return (
    <div className="card-elevated overflow-hidden">
      <div className="px-5 py-3 border-b flex items-center justify-between gap-3"
        style={{ borderColor: 'var(--border-light)' }}>
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4" /> Transfers
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Every change of care ownership for this patient, with who approved it and why.
          </p>
        </div>
        {canViewClinical && (
          <button
            className="btn btn-primary text-[12px] inline-flex items-center gap-1 shrink-0"
            onClick={() => setShowModal(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Transfer patient
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {loading && (
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Loading transfers…</p>
        )}
        {!loading && transfers.length === 0 && (
          <div className="text-center py-6">
            <ArrowRightLeft className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              This patient has never been transferred.
            </p>
          </div>
        )}
        {transfers.map(t => (
          <TransferCard
            key={t._id}
            transfer={t}
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

      {showModal && canViewClinical && (
        <TransferPatientModal patient={patient} onClose={() => setShowModal(false)} />
      )}
    </div>
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
  const { activeTransfer } = usePatientTransfers(patient._id);
  if (!activeTransfer) return null;

  const t = activeTransfer;
  const pending = t.status === 'requested';
  const overdue = isTransferOverdue(t);

  return (
    <div
      className="flex items-start gap-2.5 px-3 py-2 rounded mb-3 text-[12px]"
      style={{
        background: overdue ? 'var(--rose-50, #fef2f2)' : 'var(--gold-50, #fffbeb)',
        border: `1px solid ${overdue ? 'var(--rose-200, #fecaca)' : 'var(--gold-200, #fde68a)'}`,
      }}
    >
      {overdue
        ? <AlertTriangle className="w-4 h-4 shrink-0 mt-px" style={{ color: 'var(--rose-700, #b91c1c)' }} />
        : <ArrowRightLeft className="w-4 h-4 shrink-0 mt-px" style={{ color: 'var(--gold-800, #92400e)' }} />}
      <div className="min-w-0">
        <strong>
          {pending
            ? `Transfer awaiting acceptance${overdue ? ' — overdue' : ''}`
            : t.status === 'accepted'
              ? 'Transfer accepted, not yet in effect'
              : `${TYPE_LABEL[t.transferType]} access in force`}
        </strong>
        <span> · {describeAssignment(t.from)} → {describeAssignment(t.to)}</span>
        {t.expiresAt && <span> · ends {formatDateTime(t.expiresAt)}</span>}
        {onOpenHistory && (
          <button className="ms-2 underline" onClick={onOpenHistory}>View</button>
        )}
      </div>
    </div>
  );
}
