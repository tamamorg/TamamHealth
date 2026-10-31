'use client';

/**
 * One test's bench work in the right-hand slider — the dashboard's way in. The
 * same workflow the chart's Lab orders workspace renders, and it stays open
 * from step to step, Collect through to the report.
 */

import FormSlider from '@/components/overlay/FormSlider';
import { usePermissions } from '@/lib/hooks/usePermissions';
import type { LabResultDoc } from '@/lib/db-types';
import LabWorkflowPanel from './LabWorkflowPanel';

export default function LabBenchSlider({ order, patientName, intent, onClose }: {
  order: LabResultDoc;
  patientName: string;
  intent?: 'reject';
  onClose: () => void;
}) {
  const { canEnterLabResults } = usePermissions();
  return (
    <FormSlider
      title={order.testName}
      subtitle={patientName}
      className="tamam-dialog"
      width={560}
      flush
      onClose={onClose}
    >
      <LabWorkflowPanel key={order._id} order={order} canWork={canEnterLabResults} onClose={onClose} hideTitle intent={intent} />
    </FormSlider>
  );
}
