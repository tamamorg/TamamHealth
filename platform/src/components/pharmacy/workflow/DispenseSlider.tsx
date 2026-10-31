'use client';

/**
 * One prescription in the right-hand slider — the dashboard's way in. The same
 * form the chart's Dispense workspace renders.
 */

import FormSlider from '@/components/overlay/FormSlider';
import { usePermissions } from '@/lib/hooks/usePermissions';
import type { PrescriptionDoc } from '@/lib/db-types';
import PharmacyWorkflowPanel, { type RxIntent } from './PharmacyWorkflowPanel';

export default function DispenseSlider({ rx, patientName, activeMedications, intent, onClose }: {
  rx: PrescriptionDoc;
  patientName: string;
  activeMedications: string[];
  intent?: RxIntent;
  onClose: () => void;
}) {
  const { canDispense } = usePermissions();
  return (
    <FormSlider title={rx.medication} subtitle={patientName} className="tamam-dialog" width={560} flush onClose={onClose}>
      <PharmacyWorkflowPanel key={rx._id} rx={rx} canWork={canDispense} activeMedications={activeMedications} onClose={onClose} intent={intent} />
    </FormSlider>
  );
}
