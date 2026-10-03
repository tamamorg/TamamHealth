'use client';

/**
 * "Prescribe Medications" — writing a prescription from inside the note.
 *
 * Layout follows the reference: a collapsible form (Drug Info → Pharmacy Info
 * → Patient Cost) beside a drug panel, over a Cancel / Print / Add Rx / Send
 * Medication footer. "Add Rx" writes the prescription and clears the form for
 * the next one; "Send Medication" writes it into the pharmacy queue and
 * closes — the difference is who acts next, so they are two buttons rather
 * than one with a mode.
 *
 * This component owns the draft, the loads and the writes; each block of the
 * form is its own presentational component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Maximize2, X } from '@/components/icons/lucide';
import { useRouter } from 'next/navigation';
import { expandHref } from '@/lib/navigation/expand-to-page';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { cannotFillOnSite, stockPositionFor } from '@/lib/pharmacy-stock-position';
import PrescriptionCopyDialog from '@/components/patient-handover/PrescriptionCopyDialog';
import CollapsibleSection from './CollapsibleSection';
import DrugInfoSection from './DrugInfoSection';
import PharmacyInfoSection from './PharmacyInfoSection';
import PatientCostSection from './PatientCostSection';
import DrugMonographPanel, { type MonographWarning } from './DrugMonographPanel';
import { emptyDraft, type RxDraft } from './types';
import type { PatientDoc, PharmacyInventoryDoc, PrescriptionDoc, ProblemDoc } from '@/lib/db-types';
import { escapeHtml, openIsolatedHtmlWindow } from '@/lib/safe-html';
import { buildClinicalPrintDocument } from '@/lib/print-document';
import './../clinical-notes.css';

/** The destination that hands the script to the patient instead of a queue. */
const OUTSIDE_PHARMACY = 'Outside pharmacy (patient takes the script)';

/** Strength fragment from a formulary name, for the stored dose. */
function doseFrom(name: string): string {
  const m = name.match(/\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|%|iu)(?:\/\S+)?/i);
  return m ? m[0] : 'As directed';
}

interface PrescribeModalProps {
  patientId: string;
  patientName: string;
  currentUser: {
    _id: string; name?: string; username?: string;
    orgId?: string; hospitalId?: string; hospitalName?: string;
  } | null;
  /** The visit this prescription belongs to, when prescribing from a note/consult. */
  encounterId?: string;
  onClose: () => void;
  /** Fired after each write so the host list can refresh. */
  onPrescribed?: () => void;
  /**
   * 'page' drops the dialog frame so `/patients/[id]/prescriptions/new` can
   * host the same two columns — this popup's Expand control routes there.
   */
  presentation?: 'modal' | 'page';
}

export default function PrescribeModal({
  patientId, patientName, currentUser, encounterId, onClose, onPrescribed, presentation = 'modal',
}: PrescribeModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const scope = useDataScope();
  // Facility policy: a clinic with no dispensary has no queue to send to, so
  // every prescription is issued to the patient as a script.
  const onSitePharmacy = useSettings().clinicalPolicy.onSitePharmacy;
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';
  const facility = currentUser?.hospitalName || 'This facility';
  const pharmacyName = `${facility} Pharmacy`;

  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [problems, setProblems] = useState<ProblemDoc[]>([]);
  const [activeRx, setActiveRx] = useState<PrescriptionDoc[]>([]);
  const [inventory, setInventory] = useState<PharmacyInventoryDoc[]>([]);
  const [observations, setObservations] = useState('');
  const [balance, setBalance] = useState<number | null>(null);

  const [draft, setDraft] = useState<RxDraft>(() => emptyDraft(facility));
  const [query, setQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  // The prescriber's pick, when they have made one. With no on-site pharmacy
  // there is nothing to pick: facility settings hydrate after first paint, and
  // a dialog opened in that window must not keep offering a pharmacy the
  // facility does not have — so the destination is derived, not stored.
  const [pickedPharmacy, setPharmacy] = useState<string | null>(null);
  const pharmacy = onSitePharmacy ? (pickedPharmacy ?? pharmacyName) : OUTSIDE_PHARMACY;
  const external = pharmacy === OUTSIDE_PHARMACY;
  // Outside-pharmacy scripts written in this sitting, handed over together.
  const [toHandOver, setToHandOver] = useState<PrescriptionDoc[]>([]);
  const [handingOver, setHandingOver] = useState(false);
  const [warnings, setWarnings] = useState<MonographWarning[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [busy, setBusy] = useState(false);

  const [openDrug, setOpenDrug] = useState(true);
  const [openPharmacy, setOpenPharmacy] = useState(true);
  const [openCost, setOpenCost] = useState(false);
  const [showSigs, setShowSigs] = useState(true);
  const [showReasons, setShowReasons] = useState(false);

  const patch = useCallback((p: Partial<RxDraft>) => setDraft(d => ({ ...d, ...p })), []);

  // ── Chart context. Each source fails independently: a missing ledger or
  //    inventory must not stop a prescriber writing a prescription. ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getPatientById } = await import('@/lib/services/patient-service');
        const pt = await getPatientById(patientId, scope);
        if (!cancelled) setPatient(pt);
      } catch { /* cost panel falls back to out-of-pocket */ }
      try {
        const { getProblemsByPatient } = await import('@/lib/services/problem-service');
        const rows = await getProblemsByPatient(patientId, scope);
        if (!cancelled) setProblems(rows.filter(p => p.status === 'active' || p.status === 'chronic'));
      } catch { /* Reason For Rx offers nothing to cite */ }
      try {
        const { getPrescriptionsByPatient } = await import('@/lib/services/prescription-service');
        const rx = await getPrescriptionsByPatient(patientId, scope);
        if (!cancelled) setActiveRx(rx.filter(r => r.status !== 'discontinued'));
      } catch { /* the save-time interaction check still runs */ }
      try {
        const { getAllInventory } = await import('@/lib/services/pharmacy-inventory-service');
        const items = await getAllInventory(scope);
        if (!cancelled) setInventory(items);
      } catch { /* Cautions says "not stocked" */ }
      try {
        const { getPatientBalance } = await import('@/lib/services/ledger-service');
        const value = await getPatientBalance(patientId, scope);
        if (!cancelled) setBalance(value);
      } catch { if (!cancelled) setBalance(0); }
      try {
        const { loadChartSnapshot } = await import('@/lib/clinical-notes/chart-snapshot');
        const snap = await loadChartSnapshot(patientId, scope);
        const vitals = snap.vitalsRecord?.vitalSigns as { weight?: number } | undefined;
        const triage = snap.vitalsRecord?.triageVitals as { weight?: string | number } | undefined;
        const weight = vitals?.weight ?? (triage?.weight ? Number(triage.weight) : undefined);
        if (!cancelled && Number.isFinite(weight)) setObservations(`Weight ${weight} kg — dose weight-based medicines against this.`);
      } catch { /* "No patient observations available." */ }
    })();
    return () => { cancelled = true; };
  }, [patientId, scope]);

  // ── Live safety check for the picked drug ──
  useEffect(() => {
    let cancelled = false;
    const drug = draft.drug;
    if (!drug) { setWarnings([]); return; }
    (async () => {
      const found: MonographWarning[] = [];
      try {
        const { checkNewPrescription } = await import('@/lib/services/drug-interaction-service');
        const result = checkNewPrescription(drug.name, activeRx.map(r => r.medication));
        for (const i of result.interactions) {
          found.push({
            severity: i.severity,
            text: `${i.severity.toUpperCase()}: ${i.drug1} ↔ ${i.drug2} — ${i.description}`,
          });
        }
      } catch { /* no interaction data bundled */ }
      for (const a of (patient?.structuredAllergies || []).filter(e => e.status === 'active')) {
        const stem = a.substance.split(/[\s(]/)[0].toLowerCase();
        if (stem.length > 3 && drug.name.toLowerCase().includes(stem)) {
          found.push({
            severity: 'allergy',
            text: `ALLERGY: recorded ${a.substance} allergy${a.reaction ? ` — ${a.reaction}` : ''}.`,
          });
        }
      }
      if (!cancelled) setWarnings(found);
    })();
    return () => { cancelled = true; };
  }, [draft.drug, activeRx, patient]);

  // ── Favourite state for the picked drug ──
  useEffect(() => {
    let cancelled = false;
    const drug = draft.drug;
    if (!drug || !currentUser?._id) { setFavorite(false); return; }
    (async () => {
      try {
        const { isFavorite } = await import('@/lib/services/clinical-favorites-service');
        const yes = await isFavorite(currentUser._id, 'medication', drug.name);
        if (!cancelled) setFavorite(yes);
      } catch { if (!cancelled) setFavorite(false); }
    })();
    return () => { cancelled = true; };
  }, [draft.drug, currentUser?._id]);

  // Where the picked drug stands on this facility's shelf, at the quantity
  // being typed. Null when there is no on-site pharmacy to have a shelf.
  // A prescriber with no facility of their own (an org-level role) has no
  // shelf: their scope spans several hospitals, and summing those would report
  // another site's stock as "in stock here". They get "not tracked" instead.
  const shelf = useMemo(
    () => (currentUser?.hospitalId ? inventory : []),
    [inventory, currentUser?.hospitalId],
  );
  const stock = useMemo(() => {
    if (!draft.drug || !onSitePharmacy) return null;
    return stockPositionFor(draft.drug.name, shelf, Math.max(1, parseInt(draft.quantity, 10) || 1), {
      facilityId: currentUser?.hospitalId,
    });
  }, [draft.drug, draft.quantity, shelf, onSitePharmacy, currentUser?.hospitalId]);

  const handleToggleFavorite = useCallback(async () => {
    const drug = draft.drug;
    if (!drug || !currentUser?._id) return;
    try {
      const { toggleFavorite } = await import('@/lib/services/clinical-favorites-service');
      const now = await toggleFavorite({
        userId: currentUser._id,
        kind: 'medication',
        code: drug.name,
        label: drug.name,
        meta: {
          dosage: doseFrom(drug.name),
          frequency: draft.instructions || undefined,
          durationDays: draft.daysSupply ? Number(draft.daysSupply) : undefined,
          category: drug.category,
        },
        orgId: currentUser.orgId,
        hospitalId: currentUser.hospitalId,
      });
      setFavorite(now);
      showToast(now ? `${drug.name} added to your favorites.` : `${drug.name} removed from your favorites.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update favorites.', 'error');
    }
  }, [draft.drug, draft.instructions, draft.daysSupply, currentUser, showToast]);

  const write = useCallback(async (send: boolean): Promise<PrescriptionDoc | null> => {
    const drug = draft.drug;
    if (!drug) { showToast('Pick the drug first.', 'error'); return null; }
    if (!draft.instructions.trim()) { showToast('Patient instructions are required.', 'error'); return null; }
    setBusy(true);
    try {
      const { createPrescription } = await import('@/lib/services/prescription-service');
      const result = await createPrescription({
        patientId,
        patientName,
        // Ties the prescription to the visit it was written in — without it
        // the Rx is orphaned from the encounter and the checkout gate.
        encounterId,
        medication: drug.name,
        dose: doseFrom(drug.name),
        route: drug.form || '',
        frequency: draft.instructions.trim(),
        duration: draft.daysSupply ? `${draft.daysSupply} days` : '',
        prescribedBy: userName,
        status: 'pending',
        // A script for an outside pharmacy never enters this facility's queue.
        orderStatus: send && !external ? 'received_in_pharmacy_queue' : 'prescribed',
        fulfilment: external ? 'external' : undefined,
        quantityToDispense: Math.max(1, parseInt(draft.quantity, 10) || 1),
        indication: draft.reason || undefined,
        allowSubstitution: draft.allowSubstitution,
        refills: parseInt(draft.refills, 10) || 0,
        effectiveOn: draft.effectiveOn,
        pharmacyInstructions: draft.pharmacyNote.trim() || undefined,
        hospitalId: currentUser?.hospitalId,
        hospitalName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
      } as Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>);

      if (result.allergyWarnings?.length) {
        // The loudest of the three checks: a recorded allergy matched the drug
        // just written. Surfaced after the write (the service is advisory),
        // so the prescriber can discontinue immediately.
        showToast(
          `ALLERGY ALERT — patient has a recorded allergy: ${result.allergyWarnings
            .map(a => `${a.allergy} → ${a.medication}${a.reaction ? ` (${a.reaction})` : ''}`)
            .join(', ')}. Review before sending.`,
          'error',
        );
      }
      if (result.interactionWarnings?.hasInteractions) {
        showToast(
          `Written with an interaction warning: ${result.interactionWarnings.interactions.map(i => `${i.drug1} ↔ ${i.drug2}`).join(', ')}`,
          'error',
        );
      }
      if (result.duplicateWarnings?.length) {
        showToast(
          `Possible duplicate: ${result.duplicateWarnings.join(', ')} is already active for this patient.`,
          'error',
        );
      }
      // A host may leave the screen on this signal (the full-page route goes
      // back to the chart). An outside-pharmacy script still has to be handed
      // to the patient first, so its signal waits for the handover to close.
      if (!external && toHandOver.length === 0) onPrescribed?.();
      return result.prescription;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not write the prescription.', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [draft, patientId, patientName, encounterId, userName, currentUser, onPrescribed, showToast, external, toHandOver.length]);

  // Every way out of the dialog goes through here. Scripts already saved for
  // an outside pharmacy still have to reach the patient, so leaving — Cancel,
  // Close, Escape, Expand, or sending a later order to the on-site pharmacy —
  // offers the handover first instead of dropping it. Returns whether the
  // dialog actually closed.
  const finish = (): boolean => {
    if (toHandOver.length > 0 && !handingOver) { setHandingOver(true); return false; }
    onClose();
    return true;
  };
  const requestClose = () => { finish(); };

  const handleAddRx = async () => {
    const rx = await write(false);
    if (!rx) return;
    showToast(`${rx.medication} added.`, 'success');
    setActiveRx(prev => [rx, ...prev]);
    if (external) setToHandOver(prev => [...prev, rx]);
    setDraft(emptyDraft(facility));
    setQuery('');
  };

  const handleSend = async () => {
    // The shelf cannot fill this as written. Say so before it joins a queue
    // where the patient would only find out at the pharmacy window.
    if (stock && cannotFillOnSite(stock)) {
      const proceed = await confirm({
        title: 'The pharmacy cannot fill this as written',
        message: stock.state === 'short'
          ? `${facility} has ${stock.available} ${stock.unit || 'units'} of ${draft.drug?.name} in stock and this prescription asks for ${stock.requested}. Send it to the pharmacy anyway, or go back and issue it for an outside pharmacy.`
          : `${draft.drug?.name} is not available at ${facility}. Send it to the pharmacy anyway, or go back and issue it for an outside pharmacy.`,
        confirmLabel: 'Send to pharmacy anyway',
        cancelLabel: 'Go back',
        tone: 'warning',
      });
      if (!proceed) return;
    }
    const rx = await write(true);
    if (!rx) return;
    showToast(`${rx.medication} sent to ${pharmacy}.`, 'success');
    finish();
  };

  // Outside pharmacy: the order is saved, then the patient is given the
  // script — on paper or by text — together with any others added just now.
  const handleIssue = async () => {
    const rx = await write(false);
    if (!rx) return;
    setActiveRx(prev => [rx, ...prev]);
    setToHandOver(prev => [...prev, rx]);
    setDraft(emptyDraft(facility));
    setQuery('');
    setHandingOver(true);
  };


  const handlePrintDraft = () => {
    if (!draft.drug) { showToast('Pick the drug before printing the prescription draft.', 'error'); return; }
    if (!draft.instructions.trim()) { showToast('Add patient instructions before printing the prescription draft.', 'error'); return; }
    const e = escapeHtml;
    const allergyNames = (patient?.structuredAllergies || [])
      .filter(allergy => allergy.status === 'active')
      .map(allergy => allergy.substance);
    const safetyRows = warnings.length
      ? warnings.map(warning => `<li><strong>${e(warning.severity.toUpperCase())}</strong> — ${e(warning.text)}</li>`).join('')
      : '<li>No interaction or formulary warning was surfaced by the current check.</li>';
    const body = `
      <p class="notice status-alert"><strong>DRAFT — NOT YET ISSUED.</strong> This paper does not replace the saved and signed medication order.</p>
      <section class="section keep"><h2 class="section-title">Medication order</h2>
        <table><tbody>
          <tr><td class="muted">Medication</td><td><strong>${e(draft.drug.name)}</strong></td></tr>
          <tr><td class="muted">Dose / form</td><td>${e(doseFrom(draft.drug.name))}${draft.drug.form ? ` · ${e(draft.drug.form)}` : ''}</td></tr>
          <tr><td class="muted">Directions for patient</td><td><strong>${e(draft.instructions.trim())}</strong></td></tr>
          <tr><td class="muted">Quantity</td><td>${e(draft.quantity || '1')}</td></tr>
          <tr><td class="muted">Days supply</td><td>${e(draft.daysSupply ? `${draft.daysSupply} days` : 'Not specified')}</td></tr>
          <tr><td class="muted">Refills</td><td>${e(draft.refills || '0')}</td></tr>
          <tr><td class="muted">Effective date</td><td>${e(draft.effectiveOn || '—')}</td></tr>
          <tr><td class="muted">Substitution</td><td>${draft.allowSubstitution ? 'Permitted' : 'Do not substitute'}</td></tr>
          ${draft.reason ? `<tr><td class="muted">Indication</td><td>${e(draft.reason)}</td></tr>` : ''}
          ${draft.pharmacyNote.trim() ? `<tr><td class="muted">Pharmacy instructions</td><td>${e(draft.pharmacyNote.trim())}</td></tr>` : ''}
        </tbody></table>
      </section>
      <section class="section"><h2 class="section-title">Safety context</h2>
        <p><strong>Recorded allergies:</strong> ${e(allergyNames.join(', ') || 'None recorded')}</p><ul>${safetyRows}</ul>
      </section>
      <div class="signatures"><div><div class="signature"></div><div class="signature-label">Prescriber signature · ${e(userName)}</div></div><div><div class="signature"></div><div class="signature-label">Date and time issued</div></div></div>`;
    const html = buildClinicalPrintDocument({
      title: patientName,
      documentLabel: 'Prescription draft',
      facilityName: facility,
      meta: [
        { label: 'Patient ID', value: patient?.hospitalNumber || patientId },
        { label: 'Date of birth', value: patient?.dateOfBirth || '—' },
        { label: 'Prescriber', value: userName },
        { label: 'Pharmacy', value: pharmacy },
        { label: 'Encounter', value: encounterId || 'Not linked' },
      ],
      safeBodyHtml: body,
      footer: 'Draft prescription. Valid only after the corresponding medication order is saved and signed in the clinical record.',
    });
    openIsolatedHtmlWindow(html, '', true);
  };

  const panel = (
      <div className="cn-meds">
        <div className="cn-meds-header modal-no-headband">
          <h2 className="cn-meds-title" id="cn-rx-title">Prescribe Medications</h2>
          {/* One group, so the header's space-between has two children — left
              loose, Expand was the middle of three and sat dead centre. */}
          <div className="cn-meds-header-actions">
            {presentation === 'modal' && (
              <button
                type="button"
                className="cn-meds-close"
                onClick={() => {
                  if (!finish()) return;
                  const query = encounterId ? `?encounter=${encodeURIComponent(encounterId)}` : '';
                  router.push(expandHref(`/patients/${encodeURIComponent(patientId)}/prescriptions/new${query}`));
                }}
                aria-label="Open full page"
                title="Open full page"
                data-action="popup-expand"
              >
                <Maximize2 size={18} />
              </button>
            )}
            <button type="button" className="cn-meds-close" onClick={requestClose} aria-label="Close prescribe medications" title="Close" data-action="popup-close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="cn-meds-body">
          <div className="cn-meds-left">
            <CollapsibleSection title="Drug Info" open={openDrug} onToggle={() => setOpenDrug(v => !v)}>
              <DrugInfoSection
                draft={draft}
                onChange={patch}
                query={query}
                onQueryChange={setQuery}
                advanced={advanced}
                onToggleAdvanced={() => setAdvanced(v => !v)}
                problems={problems}
                serviceLocations={[facility]}
                isFavorite={favorite}
                onToggleFavorite={() => void handleToggleFavorite()}
                showSigs={showSigs}
                onToggleSigs={() => setShowSigs(v => !v)}
                showReasons={showReasons}
                onToggleReasons={() => setShowReasons(v => !v)}
                inventory={onSitePharmacy ? shelf : undefined}
                facilityId={currentUser?.hospitalId}
                facilityName={facility}
                stock={stock}
                onIssueOutside={external ? undefined : () => setPharmacy(OUTSIDE_PHARMACY)}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Pharmacy Info" open={openPharmacy} onToggle={() => setOpenPharmacy(v => !v)}>
              <PharmacyInfoSection
                draft={draft}
                onChange={patch}
                pharmacies={onSitePharmacy ? [pharmacyName, OUTSIDE_PHARMACY] : [OUTSIDE_PHARMACY]}
                pharmacy={pharmacy}
                onPharmacyChange={setPharmacy}
                note={external
                  ? `${onSitePharmacy ? '' : `${facility} has no on-site pharmacy. `}The patient is given the prescription, printed or by text, to fill at a pharmacy of their choice${patient?.preferredPharmacy?.name ? ` (preferred: ${patient.preferredPharmacy.name})` : ''}.`
                  : undefined}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Patient Cost" open={openCost} onToggle={() => setOpenCost(v => !v)}>
              <PatientCostSection patient={patient} balance={balance} />
            </CollapsibleSection>

            <div className="cn-meds-footer">
              <button type="button" className="cn-btn" onClick={requestClose}>Cancel</button>
              <button type="button" className="cn-btn" onClick={handlePrintDraft}>Print draft</button>
              <button type="button" className="cn-btn" onClick={handleAddRx} disabled={busy}>Add Rx</button>
              {external ? (
                <button type="button" className="cn-btn cn-btn-primary" onClick={handleIssue} disabled={busy}>
                  Issue to patient
                </button>
              ) : (
                <button type="button" className="cn-btn cn-btn-primary" onClick={handleSend} disabled={busy}>
                  Send Medication
                </button>
              )}
            </div>
          </div>

          <div className="cn-meds-right">
            <DrugMonographPanel
              drug={draft.drug}
              warnings={warnings}
              observations={observations}
              stock={stock}
              currentMedications={activeRx.map(r => `${r.medication}${r.dose ? ` · ${r.dose}` : ''}`)}
            />
          </div>
        </div>
      </div>
  );

  // The handover for scripts issued in this sitting. Closing it closes the
  // prescribing dialog too: the orders are saved, and the copy dialog records
  // whatever was printed or texted.
  const handover = handingOver && toHandOver.length > 0 && (
    <PrescriptionCopyDialog
      prescriptions={toHandOver}
      patientId={patientId}
      patientName={patientName}
      currentUser={currentUser}
      onClose={() => { setHandingOver(false); setToHandOver([]); onPrescribed?.(); onClose(); }}
    />
  );

  if (presentation === 'page') return <>{panel}{handover}</>;

  return (
    <>
      <Modal onClose={requestClose} width={1140} labelledBy="cn-rx-title">
        {panel}
      </Modal>
      {handover}
    </>
  );
}
