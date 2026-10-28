'use client';

import { Loader2 } from '@/components/icons/lucide';
import { formatRxSig, humanizeStatus } from '@/lib/format-utils';
import Badge, { toneForStatus } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';

export default function MobileMedicationsTab({ patientId }: { patientId: string }) {
  const { prescriptions, loading } = usePrescriptions();

  if (loading) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const mine = prescriptions.filter((rx) => rx.patientId === patientId);
  if (mine.length === 0) {
    return <EmptyState title="No medications" message="Prescriptions for this patient will appear here." />;
  }

  return (
    <div className="mobile-chart-tab-body">
      {mine.map((rx) => (
        <div key={rx._id} className="mobile-chart-card mobile-chart-row-card">
          <div>
            <strong>{rx.medication}</strong>
            <small>{formatRxSig(rx)}</small>
          </div>
          <Badge tone={toneForStatus(rx.status)} size="sm">{humanizeStatus(rx.status)}</Badge>
        </div>
      ))}
    </div>
  );
}
