'use client';

import { Loader2 } from '@/components/icons/lucide';
import Badge, { toneForStatus } from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function MobileLabsTab({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const { results, loading } = useLabResults();

  if (loading) {
    return (
      <div className="mobile-shell-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const mine = results.filter((r) => r.patientId === patientId);
  if (mine.length === 0) {
    return <EmptyState title={t('ui.noLabResults')} message="Results for this patient will appear here." />;
  }

  return (
    <div className="mobile-chart-tab-body">
      {mine.map((r) => (
        <div key={r._id} className="mobile-chart-card mobile-chart-row-card">
          <div>
            <strong>{r.testName}</strong>
            <small>{r.result ? `${r.result} ${r.unit || ''}`.trim() : r.specimen}</small>
          </div>
          <Badge tone={r.critical ? 'danger' : toneForStatus(r.status)} size="sm">
            {r.status === 'completed' && r.abnormal ? 'Abnormal' : r.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}
