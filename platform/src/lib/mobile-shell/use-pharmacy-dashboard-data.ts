'use client';

import { useMemo } from 'react';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import type { PrescriptionDoc } from '@/lib/db-types';
import type { MobileDashboardData, MobileLane, MobileOutstandingItem } from './dashboard-strategy';
import { pharmacyStage, pharmacyStageGroup } from '@/lib/pharmacy-workflow';
import { APPOINTMENT_STATUS_GROUP_LABELS } from '@/lib/appointment-status';

/**
 * Pharmacy-archetype dashboard (pharmacist): lanes grouped by the granular
 * `orderStatus` lifecycle (order-lifecycles.ts PRESCRIPTION_TRANSITIONS) via
 * the same pharmacyStageGroup the desktop pharmacy dashboard's tabs use,
 * falling back to the coarse `status` field for older records that predate
 * orderStatus. "Completed" means actually dispensed/counseled/complete, not
 * merely cleared-for-dispensing — the medication hasn't left the pharmacy
 * until then.
 */
export function usePharmacyDashboardData(): MobileDashboardData {
  const { prescriptions, loading: rxLoading } = usePrescriptions();
  const { items: inventory, loading: invLoading } = usePharmacyInventory();

  const lanes = useMemo<MobileLane<PrescriptionDoc>[]>(() => {
    const group = (rx: PrescriptionDoc) => pharmacyStageGroup(pharmacyStage(rx));
    const scheduled = prescriptions.filter((rx) => group(rx) === 'scheduled');
    const inOffice = prescriptions.filter((rx) => group(rx) === 'in_office');
    const finished = prescriptions.filter((rx) => group(rx) === 'finished');
    return [
      { key: 'scheduled', label: `${scheduled.length} ${APPOINTMENT_STATUS_GROUP_LABELS.scheduled}`, tone: 'info', items: scheduled },
      { key: 'in_office', label: `${inOffice.length} ${APPOINTMENT_STATUS_GROUP_LABELS.in_office}`, tone: 'warning', items: inOffice },
      { key: 'finished', label: `${finished.length} ${APPOINTMENT_STATUS_GROUP_LABELS.finished}`, tone: 'success', items: finished },
    ];
  }, [prescriptions]);

  const outstanding = useMemo<MobileOutstandingItem[]>(() => {
    const lowStock = inventory.filter((i) => i.stockLevel <= i.reorderLevel).length;
    return [{ key: 'low_stock', label: 'Low stock / reorder', count: lowStock, href: '/pharmacy' }];
  }, [inventory]);

  return { lanes, outstanding, loading: rxLoading || invLoading };
}
