'use client';

/**
 * Medications tab content — Tamam-style medication list. Reads from the
 * same `usePrescriptions()` collection the Order Basket drawer panel and
 * PrescribeModal already write to (switched from the legacy per-visit
 * `record.prescriptions` embed so newly-added orders actually show up here).
 * "Add" reuses the existing PrescribeModal via the page's
 * `setShowPrescribeModal` for prescribers. Nursing roles cannot place an order
 * (`canPrescribe`; the `prescription` sync row refuses them too) but can record
 * what the patient already takes — `ReportedMedications`, a history entry that
 * reaches no pharmacy queue. A role holding both gets a small menu.
 *
 * Row actions (Renew / Discontinue) call the prescription service directly,
 * the same way MedicationsModal's row actions do — `usePrescriptions`'s live
 * PouchDB subscription picks up the write and refreshes this list without an
 * explicit reload here.
 */

import { hasSafetyStop, safetyStopPrompt } from '@/lib/pharmacy/rx-safety';
import { useEffect, useMemo, useState } from 'react';
import ChartSection, { OmrsEmptyState } from '../ChartSection';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { formatDate, formatRxSig } from '@/lib/format-utils';
import { useToast } from '@/components/Toast';
import { FileText, Pill } from '@/components/icons/lucide';
import type { PrescriptionDoc } from '@/lib/db-types';
import RowActionsMenu from '@/components/RowActionsMenu';
import PrescriptionCopyDialog from '@/components/patient-handover/PrescriptionCopyDialog';
import { isScriptable } from '@/lib/prescription-script';
import { useConfirmPrompt } from '@/components/ConfirmDialog';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PrescriptionCreateInput } from '@/lib/services/prescription-service';
import { useHistoryEntries } from '@/lib/hooks/useHistoryEntries';
import { MEDICATION_HISTORY_DOMAIN, historyForDomain } from '@/lib/clinical/patient-history';
import ReportedMedications from './ReportedMedications';
import { describeError } from '@/lib/user-facing-error';
import { useColumnSort } from '@/components/table/useColumnSort';

const PAGE_SIZE = 8;

/** Clinician-facing labels — "pending" is pharmacy workflow state, not a
 *  clinical status, so the list says what it means for the patient. */
const RX_STATUS_LABEL: Record<string, string> = {
  pending: 'Prescribed',
  dispensed: 'Dispensed',
  discontinued: 'Stopped',
};

/**
 * A script for an outside pharmacy is never "dispensed" here, so its status is
 * whether the patient has been given it — the thing checkout waits on.
 */
export function rxStatusLabel(rx: PrescriptionDoc, t: (key: string) => string): string {
  if (rx.status === 'pending' && rx.fulfilment === 'external') {
    return rx.issuedToPatientAt ? 'Script given to patient' : 'Script not yet given';
  }
  // Once the pharmacy has acted on an in-house order, say where it is
  // ("Cleared for dispensing", "Held for clarification") instead of a flat
  // "Prescribed" — the prescriber otherwise can't see the pharmacist's step.
  if (rx.status === 'pending' && rx.orderStatus && !PRE_PHARMACY_STAGES.has(rx.orderStatus)) {
    return t(`rxFlow.stage_${rx.orderStatus}`);
  }
  return RX_STATUS_LABEL[rx.status] || rx.status;
}

/** Stages before the pharmacy has done anything: still just "Prescribed". */
const PRE_PHARMACY_STAGES = new Set<string>(['prescribed', 'received_in_pharmacy_queue']);

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
  /** Record a medicine the patient already takes (nursing roles and clinicians). */
  canRecordMedications?: boolean;
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
  patientId, patientName, canPrescribe, canRecordMedications = false, onAdd, noKnownMedications, reconciliation, reconciledAt, currentUser, focusId, onSelect,
}: MedicationsSectionProps) {
  const { prescriptions } = usePrescriptions(patientId);
  const scope = useDataScope();
  const { showToast } = useToast();
  const confirmPrompt = useConfirmPrompt();
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [tableSearch, setTableSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The order whose copy is being handed to the patient (print or text). */
  const [copyFor, setCopyFor] = useState<PrescriptionDoc | null>(null);
  const { entries: historyEntries, error: historyFailed, markInError } = useHistoryEntries(patientId);
  const reportedMeds = useMemo(
    () => historyForDomain(historyEntries, MEDICATION_HISTORY_DOMAIN),
    [historyEntries],
  );
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [recordingMed, setRecordingMed] = useState(false);

  // One Add control: straight to the only action a role has, or a menu when it
  // has both. Undefined (no button) when it has neither.
  const handleAdd = canPrescribe && canRecordMedications
    ? () => setAddMenuOpen(v => !v)
    : canPrescribe ? onAdd
    : canRecordMedications ? () => setRecordingMed(true)
    : undefined;

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
  const columnSort = useColumnSort<PrescriptionDoc>();

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

  const pageRows = columnSort.sort(filteredRx).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';

  const handleDiscontinue = async (rx: PrescriptionDoc, reason: string) => {
    setBusyId(rx._id);
    try {
      const { updatePrescription } = await import('@/lib/services/prescription-service');
      const stopped = await updatePrescription(rx._id, {
        status: 'discontinued',
        stoppedAt: new Date().toISOString(),
        stoppedBy: currentUser?._id,
        stoppedByName: userName,
        stoppedSource: 'clinician',
        stoppedReason: reason.trim() || 'Discontinued from the Medications tab',
      });
      // updatePrescription returns null when the write fails.
      if (!stopped) throw new Error('Change not saved. Try again.');
      showToast(t('msg.discontinued', { medication: rx.medication }), 'success');
    } catch (err) {
      showToast(describeError(err, t('msg.medicationNotDiscontinuedTryAgain')), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const promptDiscontinue = async (rx: PrescriptionDoc) => {
    const reason = await confirmPrompt({
      title: t('chart.medicationDiscontinueTitle', { medication: rx.medication }),
      inputLabel: t('chart.medicationDiscontinueReason'),
      inputRequired: true,
      confirmLabel: t('chart.medicationDiscontinue'),
      tone: 'danger',
    });
    if (reason?.trim()) await handleDiscontinue(rx, reason);
  };

  const handleRenew = async (rx: PrescriptionDoc) => {
    setBusyId(rx._id);
    try {
      const { assessPrescriptionSafety, createPrescription } = await import('@/lib/services/prescription-service');
      if (!scope) throw new Error('Your account is not linked to an organization. Sign in again, or contact your administrator.');
      const safety = await assessPrescriptionSafety(patientId, rx.medication, scope);
      if (safety.allergyCheckUnavailable) showToast(t('prescribe.allergyCheckUnavailable'), 'error');
      let medicationSafetyAcknowledgement: PrescriptionCreateInput['medicationSafetyAcknowledgement'];
      if (hasSafetyStop(safety)) {
        const reason = await confirmPrompt({
          ...safetyStopPrompt(t, rx.medication, safety),
          inputLabel: t('prescribe.overrideReason'),
          confirmLabel: t('prescribe.overrideConfirm'),
          tone: 'danger',
        });
        if (reason === null) return;
        if (reason.trim().length < 10) {
          showToast(t('prescribe.overrideReasonRequired'), 'error');
          return;
        }
        medicationSafetyAcknowledgement = { reviewedBy: userName, reason: reason.trim() };
      }
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
        medicationSafetyAcknowledgement,
        // Deliberately not set — a renewal from the chart isn't tied to the
        // encounter the original order came from.
      } as PrescriptionCreateInput, scope);
      if (result.allergyWarnings?.length) {
        showToast(
          t('msg.allergyAlertRenewedAgainstA', { value: result.allergyWarnings
            .map(a => `${a.allergy} → ${a.medication}`)
            .join(', ') }),
          'error',
        );
      } else if (result.interactionWarnings?.hasInteractions) {
        showToast(t('msg.renewedInteractionWarningReviewBefore', { value: result.interactionWarnings.interactions.map(i => `${i.drug1} ↔ ${i.drug2}`).join(', ') }), 'warning');
      } else {
        showToast(t('msg.renewed', { medication: rx.medication }), 'success');
      }
    } catch (err) {
      showToast(describeError(err, t('msg.medicationNotRenewedTryAgain')), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
    <ChartSection
      title="Medications"
      addLabel="Add"
      onAdd={handleAdd}
      searchValue={tableSearch}
      onSearchChange={value => { setTableSearch(value); setPage(1); }}
      pagination={{ page, pageSize: PAGE_SIZE, total: filteredRx.length, onPageChange: setPage }}
    >
      {addMenuOpen && (
        <div style={{ position: 'relative' }}>
          <div
            style={{ position: 'absolute', right: 0, top: -6, zIndex: 20 }}
            className="tamam-actions-menu"
            role="menu"
          >
            <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); onAdd(); }}>
              <FileText /> {t('meds.add.prescribe')}
            </button>
            <button type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); setRecordingMed(true); }}>
              <Pill /> {t('meds.add.reported')}
            </button>
          </div>
        </div>
      )}

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

      {patientRx.length === 0 && reportedMeds.length === 0 && !noKnownMedications ? (
        <OmrsEmptyState itemLabel="medications" actionLabel="Record medications" onAction={handleAdd} disabledReason={handleAdd ? undefined : 'Requires clinical permission'} />
      ) : patientRx.length === 0 ? null : (
        <table data-sort="data" className="tamam-table tamam-table--interactive tamam-table--medications">
          <colgroup>
            <col /><col /><col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th {...columnSort.headerProps(0, rx => rx.medication)}>Medication</th>
              <th {...columnSort.headerProps(1, rx => formatRxSig(rx))}>Dosage instructions</th>
              <th {...columnSort.headerProps(2, rx => rx.createdAt || '')}>Start date</th>
              <th {...columnSort.headerProps(3, rx => rxStatusLabel(rx, t))}>Status</th>
              <th>{t('chart.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(rx => (
              <tr
                key={rx._id}
                id={`rx-row-${rx._id}`}
                style={{
                  ...(rx._id === focusId ? { background: 'var(--accent-light)', boxShadow: 'inset 3px 0 0 var(--accent-primary)' } : {}),
                }}
              >
                <td style={{ fontWeight: 600 }}>{rx.medication}</td>
                <td>{formatRxSig(rx)}</td>
                <td>{formatDate(rx.createdAt)}</td>
                <td><span className={STATUS_BADGE[rx.status] || 'tamam-panel-badge tamam-panel-badge--active'}>{rxStatusLabel(rx, t)}</span></td>
                <td>
                  {/* Every action lives in the ⋮ — the row itself already
                      shows what a detail dialog would. Discontinue asks only
                      for its reason, which it requires. */}
                  <RowActionsMenu
                    ariaLabel={t('chart.medicationRowActions', { name: rx.medication })}
                    actions={[
                      ...(onSelect && rx.fulfilment !== 'external' ? [
                        { key: 'workflow', label: t('chart.medicationOpenWorkflow'), onClick: () => onSelect(rx._id) },
                      ] : []),
                      // Only while the order is still a script: a stopped or
                      // fully dispensed one would print as a second valid course.
                      ...(canPrescribe && isScriptable(rx) ? [
                        { key: 'copy', label: t('chart.medicationGiveToPatient'), disabled: busyId === rx._id, onClick: () => setCopyFor(rx) },
                      ] : []),
                      ...(canPrescribe ? [
                        { key: 'renew', label: t('chart.medicationRenew'), disabled: busyId === rx._id, onClick: () => void handleRenew(rx) },
                        { key: 'stop', label: t('chart.medicationDiscontinue'), tone: 'danger' as const, disabled: busyId === rx._id || rx.status === 'discontinued', onClick: () => void promptDiscontinue(rx) },
                      ] : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ReportedMedications
        patientId={patientId}
        patientName={patientName}
        medications={reportedMeds}
        entries={historyEntries}
        loadFailed={historyFailed}
        canRecord={canRecordMedications}
        currentUser={currentUser}
        adding={recordingMed}
        onCloseAdd={() => setRecordingMed(false)}
        markInError={markInError}
      />
    </ChartSection>
    {copyFor && (
      <PrescriptionCopyDialog
        prescriptions={[copyFor]}
        // The rest of the patient's active orders, so one script can carry them.
        alsoOffer={patientRx.filter(rx => rx._id !== copyFor._id && rx.status === 'pending')}
        patientId={patientId}
        patientName={patientName}
        currentUser={currentUser ?? null}
        onClose={() => setCopyFor(null)}
      />
    )}
    </>
  );
}
