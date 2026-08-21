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
import { X } from '@/components/icons/lucide';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useDataScope } from '@/lib/hooks/useDataScope';
import CollapsibleSection from './CollapsibleSection';
import DrugInfoSection from './DrugInfoSection';
import PharmacyInfoSection from './PharmacyInfoSection';
import PatientCostSection from './PatientCostSection';
import DrugMonographPanel, { type MonographWarning } from './DrugMonographPanel';
import { emptyDraft, type RxDraft } from './types';
import type { PatientDoc, PharmacyInventoryDoc, PrescriptionDoc, ProblemDoc } from '@/lib/db-types';
import './../clinical-notes.css';

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
}

export default function PrescribeModal({
  patientId, patientName, currentUser, encounterId, onClose, onPrescribed,
}: PrescribeModalProps) {
  const { showToast } = useToast();
  const scope = useDataScope();
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';
  const facility = currentUser?.hospitalName || 'This facility';
  const pharmacyName = `${facility} Pharmacy`;

  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [problems, setProblems] = useState<ProblemDoc[]>([]);
  const [activeRx, setActiveRx] = useState<PrescriptionDoc[]>([]);
  const [inventory, setInventory] = useState<PharmacyInventoryDoc[]>([]);
  // Names the pharmacy can actually fill right now — what the prescriber's
  // "Show only in-stock medicines by default" filters the typeahead against.
  const inStockNames = useMemo(
    () => new Set(inventory.filter(i => i.stockLevel > 0).map(i => i.medicationName.toLowerCase())),
    [inventory],
  );
  const [observations, setObservations] = useState('');
  const [balance, setBalance] = useState<number | null>(null);

  const [draft, setDraft] = useState<RxDraft>(() => emptyDraft(facility));
  const [query, setQuery] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [pharmacy, setPharmacy] = useState(pharmacyName);
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
        const pt = await getPatientById(patientId);
        if (!cancelled) setPatient(pt);
      } catch { /* cost panel falls back to out-of-pocket */ }
      try {
        const { getProblemsByPatient } = await import('@/lib/services/problem-service');
        const rows = await getProblemsByPatient(patientId);
        if (!cancelled) setProblems(rows.filter(p => p.status === 'active' || p.status === 'chronic'));
      } catch { /* Reason For Rx offers nothing to cite */ }
      try {
        const { getPrescriptionsByPatient } = await import('@/lib/services/prescription-service');
        const rx = await getPrescriptionsByPatient(patientId, scope);
        if (!cancelled) setActiveRx(rx.filter(r => r.status !== 'discontinued'));
      } catch { /* the save-time interaction check still runs */ }
      try {
        const { getAllInventory } = await import('@/lib/services/pharmacy-inventory-service');
        const items = await getAllInventory();
        if (!cancelled) setInventory(items);
      } catch { /* Cautions says "not stocked" */ }
      try {
        const { getPatientBalance } = await import('@/lib/services/ledger-service');
        const value = await getPatientBalance(patientId);
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

  const drugInventory = useMemo(() => {
    const drug = draft.drug;
    if (!drug) return null;
    const stem = drug.name.split(/[\s(]/)[0].toLowerCase();
    return inventory.find(i => i.medicationName.toLowerCase().includes(stem)) || null;
  }, [draft.drug, inventory]);

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
        orderStatus: send ? 'received_in_pharmacy_queue' : 'prescribed',
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
      onPrescribed?.();
      return result.prescription;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not write the prescription.', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [draft, patientId, patientName, encounterId, userName, currentUser, onPrescribed, showToast]);

  const handleAddRx = async () => {
    const rx = await write(false);
    if (!rx) return;
    showToast(`${rx.medication} added.`, 'success');
    setActiveRx(prev => [rx, ...prev]);
    setDraft(emptyDraft(facility));
    setQuery('');
  };

  const handleSend = async () => {
    const rx = await write(true);
    if (!rx) return;
    showToast(`${rx.medication} sent to ${pharmacy}.`, 'success');
    onClose();
  };

  return (
    <Modal onClose={onClose} width={1140} align="top" labelledBy="cn-rx-title">
      <div className="cn-meds">
        <div className="cn-meds-header">
          <h2 className="cn-meds-title" id="cn-rx-title">Prescribe Medications</h2>
          <button type="button" className="cn-meds-close" onClick={onClose} aria-label="Close prescribe medications">
            <X size={18} />
          </button>
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
                inStockNames={inStockNames}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Pharmacy Info" open={openPharmacy} onToggle={() => setOpenPharmacy(v => !v)}>
              <PharmacyInfoSection
                draft={draft}
                onChange={patch}
                pharmacies={[pharmacyName]}
                pharmacy={pharmacy}
                onPharmacyChange={setPharmacy}
              />
            </CollapsibleSection>

            <CollapsibleSection title="Patient Cost" open={openCost} onToggle={() => setOpenCost(v => !v)}>
              <PatientCostSection patient={patient} balance={balance} />
            </CollapsibleSection>

            <div className="cn-meds-footer">
              <button type="button" className="cn-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="cn-btn" onClick={() => window.print()}>Print</button>
              <button type="button" className="cn-btn" onClick={handleAddRx} disabled={busy}>Add Rx</button>
              <button type="button" className="cn-btn cn-btn-primary" onClick={handleSend} disabled={busy}>
                Send Medication
              </button>
            </div>
          </div>

          <div className="cn-meds-right">
            <DrugMonographPanel
              drug={draft.drug}
              warnings={warnings}
              observations={observations}
              inventory={drugInventory}
              currentMedications={activeRx.map(r => `${r.medication}${r.dose ? ` · ${r.dose}` : ''}`)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
