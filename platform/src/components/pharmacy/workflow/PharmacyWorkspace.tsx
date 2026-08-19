'use client';

/**
 * The chart's Prescriptions tab: the patient's medication list, and — once a
 * row is picked or deep-linked from the pharmacy queue — the counter workflow
 * for that prescription.
 *
 * This is where dispensing now happens. The queue links here rather than
 * opening a popup, so the pharmacist works with the chart around them: the same
 * patient header, the same allergies a prescriber would read. Exactly the shape
 * `LabWorkspace` gives the bench.
 */

import { useEffect, useMemo, useState } from 'react';
import MedicationsSection from '@/components/ehr/chart/sections/MedicationsSection';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ArrowLeft } from '@/components/icons/lucide';
import PharmacyWorkflowPanel from './PharmacyWorkflowPanel';

export default function PharmacyWorkspace({
  patientId,
  patientName,
  canPrescribe,
  canWork,
  onAdd,
  focusId,
  noKnownMedications,
  reconciliation,
  reconciledAt,
  currentUser,
}: {
  patientId: string;
  patientName: string;
  canPrescribe: boolean;
  /** Dispensing permission — without it the walkthrough is read-only. */
  canWork: boolean;
  onAdd: () => void;
  focusId?: string;
  noKnownMedications?: boolean;
  reconciliation?: string;
  reconciledAt?: string;
  currentUser?: React.ComponentProps<typeof MedicationsSection>['currentUser'];
}) {
  const { t } = useTranslation();
  const { prescriptions } = usePrescriptions(patientId);
  const [selectedId, setSelectedId] = useState<string | undefined>(focusId);

  // A fresh deep link (?focus=…) overrides whatever was open.
  useEffect(() => { if (focusId) setSelectedId(focusId); }, [focusId]);

  const selected = selectedId ? (prescriptions || []).find(rx => rx._id === selectedId) : undefined;

  /**
   * The patient's other active medicines — what the safety review checks the
   * new one against. Excludes the script being worked, or every prescription
   * would flag as a duplicate of itself.
   */
  const activeMedications = useMemo(
    () => (prescriptions || [])
      .filter(rx => rx.patientId === patientId && rx._id !== selectedId && rx.status !== 'discontinued')
      .map(rx => rx.medication)
      .filter(Boolean),
    [prescriptions, patientId, selectedId],
  );

  if (!selected) {
    return (
      <MedicationsSection
        patientId={patientId}
        patientName={patientName}
        canPrescribe={canPrescribe}
        onAdd={onAdd}
        focusId={focusId}
        noKnownMedications={noKnownMedications}
        reconciliation={reconciliation}
        reconciledAt={reconciledAt}
        currentUser={currentUser}
        onSelect={setSelectedId}
      />
    );
  }

  return (
    <div>
      <button
        type="button"
        className="labord-btn labord-btn--ghost"
        style={{ marginBottom: 10 }}
        onClick={() => setSelectedId(undefined)}
      >
        <ArrowLeft className="w-4 h-4" aria-hidden /> {t('rxFlow.backToMedications')}
      </button>
      <PharmacyWorkflowPanel
        rx={selected}
        canWork={canWork}
        activeMedications={activeMedications}
        onClose={() => setSelectedId(undefined)}
      />
    </div>
  );
}
