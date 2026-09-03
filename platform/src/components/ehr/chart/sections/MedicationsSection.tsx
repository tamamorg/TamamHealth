'use client';

/**
 * Medications tab content — Tamam-style medication list. Reads from the
 * same `usePrescriptions()` collection the Order Basket drawer panel and
 * PrescribeModal already write to (switched from the legacy per-visit
 * `record.prescriptions` embed so newly-added orders actually show up here).
 * "Add" reuses the existing PrescribeModal via the page's
 * `setShowPrescribeModal` — no new add flow.
 *
 * Row actions (Renew / Discontinue) call the prescription service directly,
 * the same way MedicationsModal's row actions do — `usePrescriptions`'s live
 * PouchDB subscription picks up the write and refreshes this list without an
 * explicit reload here.
 */

import { useEffect, useMemo, useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import Modal from '@/components/Modal';
import PopupHeader from '@/components/PopupHeader';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { formatDate, formatRxSig } from '@/lib/format-utils';
import { useToast } from '@/components/Toast';
import { RefreshCw, Ban } from '@/components/icons/lucide';
import type { PrescriptionDoc } from '@/lib/db-types';
import { clickable } from '@/lib/a11y';

const PAGE_SIZE = 8;

/** Clinician-facing labels — "pending" is pharmacy workflow state, not a
 *  clinical status, so the list says what it means for the patient. */
const RX_STATUS_LABEL: Record<string, string> = {
  pending: 'Prescribed',
  dispensed: 'Dispensed',
  discontinued: 'Stopped',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'tamam-panel-badge tamam-panel-badge--pending',
  dispensed: 'tamam-panel-badge tamam-panel-badge--done',
  discontinued: 'tamam-panel-badge tamam-panel-badge--muted',
};

interface MedicationsSectionProps {
  patientId: string;
  /** Needed to write a renewal's `patientName` the same way PrescribeModal does. */
  patientName: string;
  canPrescribe: boolean;
  onAdd: () => void;
  /** "No known medications", attested at a medication review. */
  noKnownMedications?: boolean;
  /** Reconciliation outcome and when it was recorded, from the same review. */
  reconciliation?: string;
  reconciledAt?: string;
  /** Signed-in user — attributed on Discontinue/Renew writes. */
  currentUser?: {
    _id: string; name?: string; username?: string;
    orgId?: string; hospitalId?: string; hospitalName?: string;
  } | null;
  /** When set (e.g. deep-linked from elsewhere in the chart), the row with
   *  this prescription `_id` is paged-to, scrolled into view and highlighted. */
  focusId?: string;
  /** Set by PharmacyWorkspace: makes rows pickable, opening the counter
   *  workflow for that prescription. Unset elsewhere, so the list stays a
   *  plain read for screens that only display medicines. */
  onSelect?: (prescriptionId: string) => void;
}

export default function MedicationsSection({
  patientId, patientName, canPrescribe, onAdd, noKnownMedications, reconciliation, reconciledAt, currentUser, focusId, onSelect,
}: MedicationsSectionProps) {
  const { prescriptions } = usePrescriptions(patientId);
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const [tableSearch, setTableSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedRx, setSelectedRx] = useState<PrescriptionDoc | null>(null);
  const [showStopReason, setShowStopReason] = useState(false);
  const [stopReason, setStopReason] = useState('');

  const patientRx = useMemo(
    () => (prescriptions || [])
      .filter(rx => rx.patientId === patientId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [prescriptions, patientId],
  );
  const filteredRx = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    return query ? patientRx.filter(rx => `${rx.medication} ${formatRxSig(rx)} ${rx.status}`.toLowerCase().includes(query)) : patientRx;
  }, [patientRx, tableSearch]);

  // Deep-link focus: jump to the page holding the focused prescription once
  // the data loads, then scroll it into view and let the highlight draw
  // attention — same pattern as ResultsSection.
  useEffect(() => {
    if (!focusId) return;
    const idx = patientRx.findIndex(rx => rx._id === focusId);
    if (idx < 0) return;
    setPage(Math.floor(idx / PAGE_SIZE) + 1);
  }, [focusId, patientRx]);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`rx-row-${focusId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, page]);

  const pageRows = filteredRx.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';

  const handleDiscontinue = async (rx: PrescriptionDoc, reason: string) => {
    setBusyId(rx._id);
    try {
      const { updatePrescription } = await import('@/lib/services/prescription-service');
      await updatePrescription(rx._id, {
        status: 'discontinued',
        stoppedAt: new Date().toISOString(),
        stoppedBy: currentUser?._id,
        stoppedByName: userName,
        stoppedSource: 'clinician',
        stoppedReason: reason.trim() || 'Discontinued from the Medications tab',
      });
      showToast(`${rx.medication} discontinued.`, 'success');
      setSelectedRx(null);
      setShowStopReason(false);
      setStopReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not discontinue this medication.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRenew = async (rx: PrescriptionDoc) => {
    setBusyId(rx._id);
    try {
      const { createPrescription } = await import('@/lib/services/prescription-service');
      const result = await createPrescription({
        patientId,
        patientName,
        medication: rx.medication,
        dose: rx.dose,
        route: rx.route,
        frequency: rx.frequency,
        duration: rx.duration,
        prescribedBy: userName,
        status: 'pending',
        orderStatus: 'prescribed',
        orgId: currentUser?.orgId,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        // Deliberately not set — a renewal from the chart isn't tied to the
        // encounter the original order came from.
      } as Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>);
      if (result.allergyWarnings?.length) {
        showToast(
          `ALLERGY ALERT — renewed against a recorded allergy: ${result.allergyWarnings
            .map(a => `${a.allergy} → ${a.medication}`)
            .join(', ')}. Review before sending.`,
          'error',
        );
      } else if (result.interactionWarnings?.hasInteractions) {
        showToast(`Renewed with interaction warning: ${result.interactionWarnings.interactions.map(i => `${i.drug1} ↔ ${i.drug2}`).join(', ')}`, 'error');
      } else {
        showToast(`${rx.medication} renewed.`, 'success');
      }
      setSelectedRx(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not renew this medication.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
    <ChartSection
      title="Medications"
      addLabel="Add"
      onAdd={canPrescribe ? onAdd : undefined}
      searchValue={tableSearch}
      onSearchChange={value => { setTableSearch(value); setPage(1); }}
      pagination={{ page, pageSize: PAGE_SIZE, total: filteredRx.length, onPageChange: setPage }}
    >
      {/* What the medication review concluded, when it concluded something.
          Without this the chart cannot tell "nobody has asked" from "asked,
          and the patient takes nothing". */}
      {(reconciliation || (patientRx.length === 0 && noKnownMedications)) && (
        <p className="tamam-attestation">
          {patientRx.length === 0 && noKnownMedications && <strong>No known medications. </strong>}
          {reconciliation && (
            <>Medication reconciliation: {reconciliation}{reconciledAt ? ` · ${formatDate(reconciledAt)}` : ''}.</>
          )}
        </p>
      )}

      {patientRx.length === 0 && !noKnownMedications ? (
        <OmrsEmptyState itemLabel="medications" actionLabel="Record medications" onAction={canPrescribe ? onAdd : undefined} disabledReason={canPrescribe ? undefined : 'Requires prescribing permission'} />
      ) : patientRx.length === 0 ? null : (
        <table className="tamam-table tamam-table--interactive tamam-table--medications">
          <colgroup>
            <col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th>Medication</th>
              <th>Dosage instructions</th>
              <th>Start date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(rx => (
              <tr
                key={rx._id}
                id={`rx-row-${rx._id}`}
                {...clickable(() => {
                  setSelectedRx(rx);
                  setShowStopReason(false);
                  setStopReason('');
                }, { label: `Open medication — ${rx.medication}` })}
                className="tamam-clickable-row"
                style={{
                  ...(rx._id === focusId ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : {}),
                }}
              >
                <td style={{ fontWeight: 600 }}>{rx.medication}</td>
                <td>{formatRxSig(rx)}</td>
                <td>{formatDate(rx.createdAt)}</td>
                <td><span className={STATUS_BADGE[rx.status] || 'tamam-panel-badge tamam-panel-badge--active'}>{RX_STATUS_LABEL[rx.status] || rx.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ChartSection>
    {selectedRx && (
      <Modal onClose={() => busyId !== selectedRx._id && setSelectedRx(null)} width={620} labelledBy="medication-row-title">
        <div className="modal-panel p-6 space-y-5">
          <PopupHeader
            title={selectedRx.medication}
            titleId="medication-row-title"
            subtitle={`${formatRxSig(selectedRx)} · ${RX_STATUS_LABEL[selectedRx.status] || selectedRx.status}`}
            onClose={() => setSelectedRx(null)}
            surface="panel"
          />
          <div className="clinical-row-dialog__facts">
            <div><span>Medication</span><strong>{selectedRx.medication}</strong></div>
            <div><span>Dosage instructions</span><strong>{formatRxSig(selectedRx)}</strong></div>
            <div><span>Status</span><strong>{RX_STATUS_LABEL[selectedRx.status] || selectedRx.status}</strong></div>
            <div><span>Start date</span><strong>{formatDate(selectedRx.createdAt)}</strong></div>
          </div>
          {showStopReason && (
            <label className="clinical-row-dialog__field" htmlFor="medication-stop-reason">
              <span>Reason for discontinuing</span>
              <textarea
                id="medication-stop-reason"
                value={stopReason}
                onChange={event => setStopReason(event.target.value)}
                rows={3}
                placeholder="Document why this medication is being stopped"
                autoFocus
              />
            </label>
          )}
          <div className="clinical-row-dialog__actions">
            {onSelect && !showStopReason && (
              <button className="btn btn-sm btn-primary" onClick={() => { const id = selectedRx._id; setSelectedRx(null); onSelect(id); }}>
                Open medication workflow
              </button>
            )}
            {canPrescribe && !showStopReason && (
              <>
                <button className="btn btn-sm btn-secondary" disabled={busyId === selectedRx._id} onClick={() => void handleRenew(selectedRx)}>
                  <RefreshCw className="w-3.5 h-3.5" /> Renew
                </button>
                <button className="btn btn-sm btn-secondary" disabled={busyId === selectedRx._id || selectedRx.status === 'discontinued'} onClick={() => setShowStopReason(true)}>
                  <Ban className="w-3.5 h-3.5" /> Discontinue
                </button>
              </>
            )}
            {showStopReason && (
              <>
                <button className="btn btn-sm btn-secondary" disabled={busyId === selectedRx._id} onClick={() => { setShowStopReason(false); setStopReason(''); }}>Back</button>
                <button className="btn btn-sm btn-primary" disabled={busyId === selectedRx._id || !stopReason.trim()} onClick={() => void handleDiscontinue(selectedRx, stopReason)}>
                  {busyId === selectedRx._id ? 'Saving…' : 'Discontinue medication'}
                </button>
              </>
            )}
          </div>
        </div>
      </Modal>
    )}
    </>
  );
}
