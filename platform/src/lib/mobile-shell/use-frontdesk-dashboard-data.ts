'use client';

import { useMemo } from 'react';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useReferrals } from '@/lib/hooks/useReferrals';
import type { AppointmentDoc } from '@/lib/db-types';
import type { MobileDashboardData, MobileLane, MobileOutstandingItem } from './dashboard-strategy';
import { computeClinicalLanes } from './use-clinical-dashboard-data';

function todayIso(): string {
  // Local calendar date, not UTC — see the identical helper + rationale in
  // use-clinical-dashboard-data.ts.
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Front-desk archetype dashboard (front_desk/central_registration_clerk/
 * clinic_clerk): today's appointment board in the shared three-lane
 * vocabulary, which is the surface the desk actually works — the same lane
 * split `computeClinicalLanes` gives the clinical archetype and the desktop
 * front-desk board, so one visit files into the same lane everywhere.
 */
export function useFrontDeskDashboardData(): MobileDashboardData {
  const { appointments, loading: apptLoading } = useAppointments();
  const { referrals, loading: referralsLoading } = useReferrals();

  const today = todayIso();

  const lanes = useMemo<MobileLane<AppointmentDoc>[]>(
    () => computeClinicalLanes(appointments, today),
    [appointments, today],
  );

  const outstanding = useMemo<MobileOutstandingItem[]>(() => {
    // Public bookings land as 'requested' and stay out of the clinician's
    // confirmed diary until someone at the desk approves them — that queue is
    // the desk's, so it is the tile that belongs here.
    const toConfirm = appointments.filter((a) => a.status === 'requested').length;
    const openReferrals = referrals.filter((r) => ['sent', 'received', 'seen'].includes(r.status)).length;
    return [
      { key: 'to_confirm', label: 'Appointments to confirm', count: toConfirm, href: '/appointments' },
      { key: 'referrals', label: 'Open referrals', count: openReferrals, href: '/referrals' },
    ];
  }, [appointments, referrals]);

  return { lanes, outstanding, loading: apptLoading || referralsLoading };
}
