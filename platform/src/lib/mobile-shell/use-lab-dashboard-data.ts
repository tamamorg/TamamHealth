'use client';

import { useMemo } from 'react';
import { useLabResults } from '@/lib/hooks/useLabResults';
import type { LabResultDoc } from '@/lib/db-types';
import { APPOINTMENT_STATUS_GROUP_LABELS } from '@/lib/appointment-status';
import type { MobileDashboardData, MobileLane, MobileOutstandingItem } from './dashboard-strategy';
import { useNow } from '@/lib/hooks/useNow';

/** Lab-archetype dashboard (lab_tech): lanes grouped by LabResultDoc.status. */
export function useLabDashboardData(): MobileDashboardData {
  const { results, loading } = useLabResults();

  const lanes = useMemo<MobileLane<LabResultDoc>[]>(() => {
    const scheduled = results.filter((r) => r.status === 'pending');
    const inOffice = results.filter((r) => r.status === 'in_progress');
    const finished = results.filter((r) => r.status === 'completed');
    return [
      { key: 'scheduled', label: `${scheduled.length} ${APPOINTMENT_STATUS_GROUP_LABELS.scheduled}`, tone: 'info', items: scheduled },
      { key: 'in_office', label: `${inOffice.length} ${APPOINTMENT_STATUS_GROUP_LABELS.in_office}`, tone: 'warning', items: inOffice },
      { key: 'finished', label: `${finished.length} ${APPOINTMENT_STATUS_GROUP_LABELS.finished}`, tone: 'success', items: finished },
    ];
  }, [results]);

  const now = useNow(60_000);
  const outstanding = useMemo<MobileOutstandingItem[]>(() => {
    const critical = results.filter((r) => r.critical && r.status !== 'completed').length;
    const agingMs = 2 * 60 * 60 * 1000; // 2h
    const agedPending = results.filter(
      (r) => r.status === 'pending' && r.orderedAt && now - new Date(r.orderedAt).getTime() > agingMs
    ).length;
    return [
      { key: 'critical', label: 'Critical results', count: critical, href: '/lab' },
      { key: 'aged_pending', label: 'Pending > 2h', count: agedPending, href: '/lab' },
    ];
  }, [results, now]);

  return { lanes, outstanding, loading };
}
