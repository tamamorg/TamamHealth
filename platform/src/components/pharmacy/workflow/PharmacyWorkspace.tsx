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
import { isMedicationCurrent } from '@/lib/services/prescription-service';
import FormSlider from '@/components/overlay/FormSlider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { DispensingReportSheet, ReportView } from '@/components/reports/clinical-reports';
import { formatRxSig } from '@/lib/format-utils';
import PharmacyWorkflowPanel from './PharmacyWorkflowPanel';

export default function PharmacyWorkspace({
  patientId,
  patientName,
  canPrescribe,
  canRecordMedications = false,
  canWork,
  onAdd,
  focusId,
  noKnownMedications,
  reconciliation,
  reconciledAt,
  currentUser,
  hospitalNumber,
}: {
  patientId: string;
  patientName: string;
  canPrescribe: boolean;
  /** Record a medicine the patient already takes (no order is placed). */
  canRecordMedications?: boolean;
  /** Dispensing permission — without it the walkthrough is read-only. */
  canWork: boolean;
  onAdd: () => void;
  focusId?: string;
  noKnownMedications?: boolean;
  reconciliation?: string;
  reconciledAt?: string;
  currentUser?: React.ComponentProps<typeof MedicationsSection>['currentUser'];
  /** The patient's number, for the dispensing record's Patient Information. */
  hospitalNumber?: string;
}) {
  const { t } = useTranslation();
  const { prescriptions } = usePrescriptions(patientId);
  const [selectedId, setSelectedId] = useState<string | undefined>(focusId);

  // A fresh deep link (?focus=…) overrides whatever was open.
  useEffect(() => { if (focusId) setSelectedId(focusId); }, [focusId]);

  const selected = selectedId ? (prescriptions || []).find(rx => rx._id === selectedId) : undefined;
  // A dispensed prescription read as its dispensing record ("View report").
  const [reportId, setReportId] = useState<string | undefined>();
  const report = reportId ? (prescriptions || []).find(rx => rx._id === reportId) : undefined;

  /**
   * The patient's other active medicines — what the safety review checks the
   * new one against. Excludes the script being worked, or every prescription
   * would flag as a duplicate of itself.
   */
  const activeMedications = useMemo(
    () => (prescriptions || [])
      .filter(rx => rx.patientId === patientId && rx._id !== selectedId && isMedicationCurrent(rx))
      .map(rx => rx.medication)
      .filter(Boolean),
    [prescriptions, patientId, selectedId],
  );

  const close = () => setSelectedId(undefined);

  // The list stays in place; the picked script opens beside it as a slider,
  // the way every other chart workspace opens.
  return (
    <>
      {report ? (
        <ReportView
          backLabel={t('rxFlow.backToMedications')}
          onBack={() => setReportId(undefined)}
          openLabel={t('chart.medicationOpenWorkflow')}
          onOpen={() => setSelectedId(report._id)}
          documentLabel={t('report.dispensingRecord')}
          date={report.dispensedAt || report.createdAt}
        >
          <DispensingReportSheet rx={report} hospitalNumber={hospitalNumber} />
        </ReportView>
      ) : (
        <MedicationsSection
          patientId={patientId}
          patientName={patientName}
          canPrescribe={canPrescribe}
          canRecordMedications={canRecordMedications}
          onAdd={onAdd}
          focusId={focusId}
          noKnownMedications={noKnownMedications}
          reconciliation={reconciliation}
          reconciledAt={reconciledAt}
          currentUser={currentUser}
          onSelect={setSelectedId}
          onViewReport={setReportId}
        />
      )}
      {selected && (
        <FormSlider
          title={selected.medication}
          subtitle={formatRxSig(selected) || undefined}
          className="tamam-dialog"
          width={560}
          flush
          onClose={close}
        >
          {/* Fills the slider and pins its own footer, as DispenseSlider does. */}
          <PharmacyWorkflowPanel
            key={selected._id}
            rx={selected}
            canWork={canWork}
            activeMedications={activeMedications}
            onClose={close}
          />
        </FormSlider>
      )}
    </>
  );
}
