'use client';

/**
 * The lab dashboard: the doctor's workspace in bench terms (LabHomeView), plus
 * the one station job the chart cannot do — entering a whole run of one test.
 */

import { useState } from 'react';
import LabHomeView from '@/components/dashboards/LabHomeView';
import LabBatchEntry from '@/components/lab/LabBatchEntry';

export default function LabDashboardPage() {
  const [batchOpen, setBatchOpen] = useState(false);
  return (
    <>
      <LabHomeView onBatchEntry={() => setBatchOpen(true)} />
      {batchOpen && <LabBatchEntry onClose={() => setBatchOpen(false)} />}
    </>
  );
}
