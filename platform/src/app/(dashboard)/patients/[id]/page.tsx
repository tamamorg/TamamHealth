'use client';

import PatientDetailPage from '@/components/patients/PatientDetailPage';
import { ConfirmLayoutProvider } from '@/components/ConfirmDialog';

/** Every question asked on the patient chart opens as a right-hand slider,
 *  like the chart's other workspaces. */
export default function PatientChartPage() {
  return (
    <ConfirmLayoutProvider layout="slider">
      <PatientDetailPage />
    </ConfirmLayoutProvider>
  );
}
